// Gathers what a repair post is made from, on the server: the job, the work done, the engine from the VIN decode, the inspection
// photos and how big each one is. Reads only. The rules for what a caption may say and which photos go together live in the
// pure files (posts-facts.ts, posts-photos.ts); this file only fetches and hands them over.

import type { SupabaseClient } from '@supabase/supabase-js'
import { MEDIA_BUCKET, SIGNED_URL_SECONDS } from '@/lib/dvi-media'
import {
  buildCaption, captionPrompt, carLine, factsProblems, jobFinished, pickEngine, repairLinesFrom, vetCaption, vinMatchesJob, FINISHED_STATUSES,
} from '@/lib/posts-facts'
import type { PostFacts } from '@/lib/posts-facts'
import { MAX_PICKS, aiPickPrompt, applyAiPick, imageInfo, parseAiPick, proposePhotos, stems } from '@/lib/posts-photos'
import type { PhotoCandidate, PhotoRating, Proposal } from '@/lib/posts-photos'
import type { Prepared } from '@/lib/posts-engine'
import type { PostPhoto, PostPlatform } from '@/lib/posts-rules'
import type { JobInfo, PostDb } from '@/lib/posts-store'
import { decodeVin } from '@/lib/vehicles/nhtsa'
import type { FetchLike } from '@/lib/vehicles/nhtsa'
import { cleanVin } from '@/lib/vehicles/vin'

/** The bucket the cleaned copies live in. The same private bucket the Write a post sheet uses. */
export const POST_BUCKET = 'social-post-media'
const MAX_INLINE = 12
const MAX_PHOTOS_READ = 40

export type ModelCall = (system: string, user: string) => Promise<string>

export interface ShopContext { shopName: string; shopPhone: string; city: string; model: ModelCall | null }

export interface SourceDeps { db: SupabaseClient; store: PostDb; shop: ShopContext }

export interface JobRow {
  id: string
  status: string
  customer_name: string
  vehicle_year: string
  vehicle_make: string
  vehicle_model: string
  vehicle_engine: string
  vehicle_vin: string
  vehicle_plate: string
  updated_at: string
}

const text = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '').trim()

/* ---------- the job ---------- */

export async function loadJob(db: SupabaseClient, shopId: string, jobId: string): Promise<JobRow | null> {
  const { data, error } = await db.from('jobs').select('*').eq('shop_id', shopId).eq('id', jobId).maybeSingle()
  if (error) throw new Error('The job could not be loaded.')
  if (!data) return null
  return toJob(data as Record<string, unknown>)
}

const toJob = (r: Record<string, unknown>): JobRow => ({
  id: String(r.id), status: text(r.status), customer_name: text(r.customer_name), vehicle_year: text(r.vehicle_year), vehicle_make: text(r.vehicle_make),
  vehicle_model: text(r.vehicle_model), vehicle_engine: text(r.vehicle_engine), vehicle_vin: text(r.vehicle_vin), vehicle_plate: text(r.vehicle_plate), updated_at: text(r.updated_at),
})

export async function recentJobs(db: SupabaseClient, shopId: string, limit = 60): Promise<JobRow[]> {
  const { data, error } = await db.from('jobs').select('*').eq('shop_id', shopId).order('updated_at', { ascending: false }).limit(limit)
  if (error) throw new Error('Jobs could not be loaded.')
  return (data || []).map(r => toJob(r as Record<string, unknown>))
}

export async function jobIsFinished(db: SupabaseClient, shopId: string, jobId: string): Promise<boolean> {
  const { data } = await db.from('jobs').select('status').eq('shop_id', shopId).eq('id', jobId).maybeSingle()
  return jobFinished((data as { status?: unknown } | null)?.status)
}

/** Finished jobs from the last weeks where the customer said yes and photos are already checked. Newest first. */
export async function candidateJobIds(db: SupabaseClient, store: PostDb, shopId: string, sinceMs: number, limit: number): Promise<string[]> {
  const yes = await store.jobsWithYes(shopId)
  if (!yes || yes.length === 0) return []
  const { data, error } = await db.from('jobs').select('id,status,updated_at').eq('shop_id', shopId).in('id', yes.map(y => y.job_id).slice(0, 100)).in('status', [...FINISHED_STATUSES]).gte('updated_at', new Date(sinceMs).toISOString()).order('updated_at', { ascending: false }).limit(limit)
  if (error) throw new Error('Jobs could not be loaded.')
  return (data || []).map(r => String((r as { id: unknown }).id))
}

/* ---------- the engine ---------- */

const decoded = new Map<string, { engine: string; at: number }>()
const DECODE_KEEP_MS = 24 * 3_600_000

/** The engine from the VIN decode, when the VIN decodes to the car on the job. Empty when NHTSA cannot say. Never throws. */
async function decodedEngine(job: JobRow): Promise<string> {
  const vin = cleanVin(job.vehicle_vin)
  if (vin.length !== 17) return ''
  const hit = decoded.get(vin)
  if (hit && Date.now() - hit.at < DECODE_KEEP_MS) return hit.engine
  try {
    const out = await decodeVin(vin, fetch as unknown as FetchLike, job.vehicle_year)
    const engine = out.ok && out.vehicle && vinMatchesJob(out.vehicle, { vehicle_make: job.vehicle_make, vehicle_year: job.vehicle_year }) ? out.vehicle.engine : ''
    // A failed lookup is not kept: try again next time.
    if (out.ok) decoded.set(vin, { engine, at: Date.now() })
    return engine
  } catch {
    return ''
  }
}

/* ---------- inspection photos ---------- */

interface DviRow { id: string; sections: unknown; customer_decisions: unknown; vehicle: string }

async function loadDvi(db: SupabaseClient, shopId: string, jobId: string): Promise<DviRow[]> {
  const { data, error } = await db.from('dvi').select('id,sections,customer_decisions,vehicle,created_at').eq('shop_id', shopId).eq('job_id', jobId).order('created_at', { ascending: false }).limit(4)
  if (error) {
    // A shop without inspections has no dvi table to read, or no job link yet: no photos, not a failure.
    if (/does not exist|schema cache|could not find/i.test(error.message || '')) return []
    throw new Error('The inspection could not be loaded.')
  }
  return (data || []).map(r => ({ id: String((r as Record<string, unknown>).id), sections: (r as Record<string, unknown>).sections, customer_decisions: (r as Record<string, unknown>).customer_decisions, vehicle: text((r as Record<string, unknown>).vehicle) }))
}

async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }))
  return out
}

async function folderSizes(db: SupabaseClient, dviId: string): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  try {
    const { data } = await db.storage.from(MEDIA_BUCKET).list(dviId, { limit: 200 })
    for (const f of data || []) out.set(f.name, Number((f.metadata as { size?: unknown } | null)?.size) || 0)
  } catch { /* sizes stay unknown */ }
  return out
}

/** Width and height from the first few kilobytes of a stored picture. Null when they cannot be read. */
async function readDims(db: SupabaseClient, path: string): Promise<{ width: number; height: number } | null> {
  try {
    const { data } = await db.storage.from(MEDIA_BUCKET).createSignedUrl(path, 120)
    if (!data?.signedUrl) return null
    const r = await fetch(data.signedUrl, { headers: { Range: 'bytes=0-65535' }, signal: AbortSignal.timeout(8000) })
    if (!r.ok && r.status !== 206) return null
    const info = imageInfo(new Uint8Array(await r.arrayBuffer()))
    return info ? { width: info.width, height: info.height } : null
  } catch {
    return null
  }
}

const RATINGS: PhotoRating[] = ['green', 'yellow', 'red']

export interface InspectionPhotos {
  candidates: PhotoCandidate[]
  /** For pictures kept inside the inspection row: the picture itself. */
  inline: Map<string, string>
  /** Names of findings the customer approved. */
  approved: string[]
  vehicleText: string
}

export async function loadInspectionPhotos(db: SupabaseClient, shopId: string, jobId: string): Promise<InspectionPhotos> {
  const rows = await loadDvi(db, shopId, jobId)
  const candidates: PhotoCandidate[] = []
  const inline = new Map<string, string>()
  const approved: string[] = []
  let order = 0
  for (const dvi of rows) {
    const sizes = await folderSizes(db, dvi.id)
    const decisions = dvi.customer_decisions && typeof dvi.customer_decisions === 'object' ? (dvi.customer_decisions as Record<string, unknown>) : {}
    let inlineN = 0
    const sections = Array.isArray(dvi.sections) ? (dvi.sections as Array<Record<string, unknown>>) : []
    for (const section of sections) {
      const title = text(section?.title)
      const items = Array.isArray(section?.items) ? (section.items as Array<Record<string, unknown>>) : []
      for (const item of items) {
        const name = text(item?.name)
        if (decisions[text(item?.id)] === 'approved' && name) approved.push(name)
        const rating = RATINGS.includes(item?.status as PhotoRating) ? (item.status as PhotoRating) : null
        const photos = Array.isArray(item?.photos) ? (item.photos as unknown[]) : []
        for (const p of photos) {
          if (typeof p !== 'string' || candidates.length >= MAX_PHOTOS_READ) continue
          const base = { dviId: dvi.id, jobId, section: title, itemName: name, rating, note: text(item?.note).slice(0, 200), order: order++ }
          if (p.startsWith('storage:')) {
            const file = p.slice(`storage:${dvi.id}/`.length)
            if (!p.startsWith(`storage:${dvi.id}/`) || !file || file.includes('/')) continue
            candidates.push({ ...base, ref: p, bytes: sizes.get(file) ?? 0, width: null, height: null, inRow: false })
          } else if (p.startsWith('data:image/') && inlineN < MAX_INLINE) {
            const m = /^data:image\/[a-z+.-]+;base64,(.*)$/s.exec(p)
            if (!m) continue
            const ref = `inrow:${dvi.id}:${inlineN++}`
            const info = imageInfo(Buffer.from(m[1].slice(0, 16_000), 'base64'))
            inline.set(ref, p)
            candidates.push({ ...base, ref, bytes: Math.floor((m[1].length * 3) / 4), width: info?.width ?? null, height: info?.height ?? null, inRow: true })
          }
        }
      }
    }
  }
  // Sizes in pixels for the stored pictures, a few at a time.
  const stored = candidates.filter(c => c.ref.startsWith('storage:'))
  const dims = await mapLimit(stored, 6, c => readDims(db, c.ref.slice('storage:'.length)))
  stored.forEach((c, i) => { if (dims[i]) { c.width = dims[i]!.width; c.height = dims[i]!.height } })
  return { candidates, inline, approved, vehicleText: rows[0]?.vehicle || '' }
}

/** Picture addresses good for an hour, for showing the inspection photos on the screen. */
export async function inspectionUrls(db: SupabaseClient, photos: InspectionPhotos): Promise<Map<string, string>> {
  const out = new Map<string, string>(photos.inline)
  const paths = photos.candidates.filter(c => c.ref.startsWith('storage:')).map(c => c.ref.slice('storage:'.length))
  if (paths.length) {
    const { data } = await db.storage.from(MEDIA_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS)
    for (const row of data || []) if (row.signedUrl && row.path) out.set(`storage:${row.path}`, row.signedUrl)
  }
  return out
}

/** Addresses good for an hour for cleaned copies in the post bucket. */
export async function postUrls(db: SupabaseClient, paths: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  const list = [...new Set(paths.filter(Boolean))]
  if (!list.length) return out
  const { data } = await db.storage.from(POST_BUCKET).createSignedUrls(list, SIGNED_URL_SECONDS)
  for (const row of data || []) if (row.signedUrl && row.path) out.set(row.path, row.signedUrl)
  return out
}

/** Whether an inspection photo reference belongs to an inspection of this shop's job. */
export async function refBelongsToJob(db: SupabaseClient, shopId: string, jobId: string, ref: string): Promise<boolean> {
  const m = /^(?:storage:|inrow:)([0-9a-f-]{36})[/:]/i.exec(ref)
  if (!m) return false
  return (await loadDvi(db, shopId, jobId)).some(r => r.id === m[1])
}

/** The bytes of one inspection photo, only if it belongs to this shop's job. Used so the browser can clean it on its own side. */
export async function downloadInspectionPhoto(db: SupabaseClient, shopId: string, jobId: string, ref: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
  const rows = await loadDvi(db, shopId, jobId)
  const sm = /^storage:([0-9a-f-]{36})\/([A-Za-z0-9._-]+)$/i.exec(ref)
  if (sm) {
    if (!rows.some(r => r.id === sm[1])) return null
    const { data, error } = await db.storage.from(MEDIA_BUCKET).download(`${sm[1]}/${sm[2]}`)
    if (error || !data) return null
    const ext = sm[2].split('.').pop()?.toLowerCase()
    return { bytes: new Uint8Array(await data.arrayBuffer()), contentType: ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg' }
  }
  const im = /^inrow:([0-9a-f-]{36}):(\d+)$/i.exec(ref)
  if (im) {
    const photos = await loadInspectionPhotos(db, shopId, jobId)
    const url = photos.inline.get(ref)
    const m = url ? /^data:(image\/[a-z+.-]+);base64,(.*)$/s.exec(url) : null
    if (!m) return null
    return { bytes: new Uint8Array(Buffer.from(m[2], 'base64')), contentType: m[1] }
  }
  return null
}

/* ---------- the facts ---------- */

export async function buildFacts(deps: SourceDeps, shopId: string, job: JobRow, photos: InspectionPhotos): Promise<PostFacts> {
  const { db, shop } = deps
  const { data: docs } = await db.from('documents').select('type,labors,parts,created_at').eq('shop_id', shopId).eq('job_id', job.id).order('created_at', { ascending: false }).limit(12)
  const rank = (t: unknown): number => { const s = text(t).toLowerCase(); return s.includes('invoice') ? 0 : s.includes('receipt') ? 1 : s.includes('estimate') ? 2 : 3 }
  const withWork = (docs || []).filter(d => (Array.isArray(d.labors) && d.labors.length) || (Array.isArray(d.parts) && d.parts.length)).sort((a, b) => rank(a.type) - rank(b.type))
  const doc = withWork[0]
  const name = job.customer_name
  const avoid = [name, ...name.split(/\s+/), job.vehicle_plate, job.vehicle_vin, cleanVin(job.vehicle_vin)].filter(x => x && x.length >= 3)
  const repairs = repairLinesFrom({ docLabors: doc?.labors, docParts: doc?.parts, approvedFindings: photos.approved }, avoid)
  const { engine, source } = pickEngine(await decodedEngine(job), job.vehicle_engine)
  return {
    car: carLine({ vehicle_year: job.vehicle_year, vehicle_make: job.vehicle_make, vehicle_model: job.vehicle_model }, photos.vehicleText),
    engine, engineSource: source, repairs, finished: jobFinished(job.status), shopName: shop.shopName, shopPhone: shop.shopPhone, city: shop.city,
  }
}

/* ---------- choosing photos and words ---------- */

export async function choosePhotos(model: ModelCall | null, cands: readonly PhotoCandidate[], repairLines: readonly string[]): Promise<{ proposal: Proposal; aiUsed: boolean }> {
  const base = proposePhotos(cands, { repairWords: stems(repairLines.join(' ')) })
  const usable = cands.filter(c => !base.unusable.includes(c.ref))
  if (!model || usable.length <= MAX_PICKS) return { proposal: base, aiUsed: false }
  try {
    const pr = aiPickPrompt(usable, repairLines)
    const nums = parseAiPick(await model(pr.system, pr.user), usable.length)
    return nums ? { proposal: applyAiPick(base, usable, nums), aiUsed: true } : { proposal: base, aiUsed: false }
  } catch {
    return { proposal: base, aiUsed: false }
  }
}

/** The caption: written straight from the facts, polished by the AI only when the polished version passes the same checks. */
export async function writeCaption(model: ModelCall | null, facts: PostFacts, platforms: readonly PostPlatform[]): Promise<{ caption: string; flags: string[]; aiUsed: boolean }> {
  const plain = buildCaption(facts)
  if (model) {
    try {
      const pr = captionPrompt(facts, platforms)
      const polished = vetCaption(await model(pr.system, pr.user), facts, platforms)
      if (polished.ok) return { caption: polished.text, flags: [], aiUsed: true }
    } catch { /* fall back to the plain version */ }
  }
  return { caption: plain, flags: vetCaption(plain, facts, platforms).flags, aiUsed: false }
}

/** Makes a post from a job, using only photos the owner already checked. */
export async function prepareJobPost(deps: SourceDeps, shopId: string, jobId: string, platforms: PostPlatform[]): Promise<Prepared> {
  const job = await loadJob(deps.db, shopId, jobId)
  if (!job) return { ok: false, reason: 'That job could not be found.' }
  const info = await deps.store.jobInfo(shopId, jobId)
  if (!info) return { ok: false, reason: 'Repair posts need a database update before they can be made.' }
  const photos = await loadInspectionPhotos(deps.db, shopId, jobId)
  const facts = await buildFacts(deps, shopId, job, photos)
  const problems = factsProblems(facts)
  if (problems.length) return { ok: false, reason: problems[0] }

  const cleared = new Map(info.cleared.map(c => [c.ref, c]))
  const usable = photos.candidates.filter(c => cleared.has(c.ref))
  if (usable.length === 0) {
    return { ok: false, reason: info.cleared.length ? 'The photos you checked for this job are no longer on its inspection. Check the photos again.' : 'Check this job’s photos first: open Pick shop photos, choose the job and check the ones to use.' }
  }
  const picked = await choosePhotos(deps.shop.model, usable, facts.repairs)
  const chosen: PostPhoto[] = picked.proposal.picks.flatMap(ref => {
    const c = cleared.get(ref)
    return c ? [{ ref, path: c.path, covered: c.covered, label: c.label }] : []
  })
  const words = await writeCaption(deps.shop.model, facts, platforms)
  return { ok: true, facts, caption: words.caption, photos: chosen, note: picked.proposal.note, aiUsed: picked.aiUsed || words.aiUsed }
}

/* ---------- what the picker screen shows ---------- */

export interface JobPhotosData {
  job: JobRow
  info: JobInfo
  photos: InspectionPhotos
  urls: Map<string, string>
  clearedUrls: Map<string, string>
  facts: PostFacts
  problems: string[]
  proposal: Proposal
  caption: string
  captionFlags: string[]
  aiUsed: boolean
}

/** Everything the "Pick shop photos" sheet needs for one job, including what Alpha would propose over all of its photos. */
export async function loadJobPhotos(deps: SourceDeps, shopId: string, jobId: string, platforms: PostPlatform[], useAi: boolean): Promise<JobPhotosData | null> {
  const job = await loadJob(deps.db, shopId, jobId)
  if (!job) return null
  const info = (await deps.store.jobInfo(shopId, jobId)) ?? { job_id: jobId, customer_ok: false, ok_note: '', ok_at: null, heard_from: '', cleared: [], updated_at: null }
  const photos = await loadInspectionPhotos(deps.db, shopId, jobId)
  const facts = await buildFacts(deps, shopId, job, photos)
  const model = useAi ? deps.shop.model : null
  const picked = await choosePhotos(model, photos.candidates, facts.repairs)
  const words = await writeCaption(model, facts, platforms.length ? platforms : ['facebook'])
  const [urls, clearedUrls] = await Promise.all([inspectionUrls(deps.db, photos), postUrls(deps.db, info.cleared.map(c => c.path))])
  return { job, info, photos, urls, clearedUrls, facts, problems: factsProblems(facts), proposal: picked.proposal, caption: words.caption, captionFlags: words.flags, aiUsed: picked.aiUsed || words.aiUsed }
}
