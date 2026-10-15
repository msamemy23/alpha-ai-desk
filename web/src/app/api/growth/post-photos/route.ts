import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { NeedsDatabaseUpdate } from '@/lib/automation-store'
import { checkRateLimit } from '@/lib/rate-limit'
import { getServiceClient } from '@/lib/supabase'
import { loadShopContext } from '@/lib/posts-model'
import { photoLabel, stripImageMetadata } from '@/lib/posts-photos'
import { POST_BUCKET, downloadInspectionPhoto, loadJob, loadJobPhotos, postUrls, refBelongsToJob } from '@/lib/posts-source'
import { createPostStore } from '@/lib/posts-store'
import type { ClearedPhoto } from '@/lib/posts-store'
import { jobSummaries, photoCounts, summarize } from '@/lib/posts-views'
import { cleanPlatforms } from '@/lib/posts-rules'
import type { CheckedPhotoResponse, JobBriefResponse, JobListResponse, JobPhotosResponse } from '@/lib/posts-api-types'

// Photos for repair posts. Reading lists a job's inspection photos with Alpha's proposal; posting saves one cleaned copy.
// A cleaned copy has already been re-encoded in the browser (location and camera data gone) and is cleaned again here before it is stored.
// Nothing here posts anything.

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const WRITERS = new Set(['owner', 'admin', 'manager'])
const UUID = /^[0-9a-f-]{36}$/i
const MAX_UPLOAD = 6 * 1024 * 1024
const NEEDS_DB = 'Repair posts need a database update before photos can be saved for a job. Ask your developer to apply it.'

const fail = (error: string, status: number, extra: Record<string, unknown> = {}) => NextResponse.json({ ok: false, error, ...extra }, { status })

function errorResponse(error: unknown): NextResponse {
  if (error instanceof NeedsDatabaseUpdate) return fail(NEEDS_DB, 409, { needs_database_update: true })
  console.error('[growth/post-photos]', error instanceof Error ? error.message : error)
  return fail('Something went wrong. Try again.', 500)
}

export async function GET(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  const params = req.nextUrl.searchParams
  const jobId = params.get('job_id') || ''
  const ref = params.get('ref') || ''
  if (jobId && !UUID.test(jobId)) return fail('Unknown job.', 400)
  const db = getServiceClient()
  const store = createPostStore(db)
  try {
    // One inspection photo, passed through so the browser can clean it on its own side without any cross-site trouble.
    if (jobId && ref) {
      if (!WRITERS.has(auth.role)) return forbidden()
      const got = await downloadInspectionPhoto(db, auth.shopId, jobId, ref)
      if (!got) return fail('That photo could not be found.', 404)
      return new NextResponse(new Blob([got.bytes as BlobPart], { type: got.contentType }), { headers: { 'Content-Type': got.contentType, 'Cache-Control': 'private, max-age=300' } })
    }

    if (!jobId) {
      const rows = await store.list(auth.shopId).catch(error => { if (error instanceof NeedsDatabaseUpdate) return []; throw error })
      const { available, jobs } = await jobSummaries(db, store, auth.shopId, rows)
      return NextResponse.json({ ok: true, available, jobs } satisfies JobListResponse)
    }

    // Just the posting facts for one job, for the card on the job screen. No photos are signed and nothing calls the AI.
    if (params.get('brief') === '1') {
      const job = await loadJob(db, auth.shopId, jobId)
      if (!job) return fail('That job is not in your shop.', 404)
      const info = await store.jobInfo(auth.shopId, jobId)
      const counts = await photoCounts(db, auth.shopId, [jobId])
      const rows = info === null ? [] : await store.list(auth.shopId).catch(() => [])
      const open = rows.find(r => r.job_id === jobId && ['needs_review', 'ready', 'scheduled', 'posting'].includes(r.state))?.id ?? null
      return NextResponse.json({ ok: true, available: info !== null, can_edit: WRITERS.has(auth.role), job: summarize(job, info, info !== null, counts.get(jobId) ?? 0, open) } satisfies JobBriefResponse)
    }

    const useAi = params.get('ai') === '1'
    if (useAi && !checkRateLimit(`post-photos-ai:${auth.shopId}`, 20, 60 * 60_000).ok) return fail('That is a lot of requests for one hour. Try again later.', 429)
    const shop = await loadShopContext(db, auth.shopId)
    const platforms = cleanPlatforms(params.get('platforms')?.split(',') ?? [])
    const data = await loadJobPhotos({ db, store, shop }, auth.shopId, jobId, platforms, useAi)
    if (!data) return fail('That job is not in your shop.', 404)
    const counts = await photoCounts(db, auth.shopId, [jobId])
    const known = (await store.jobInfo(auth.shopId, jobId)) !== null
    const rows = await store.list(auth.shopId).catch(() => [])
    const open = rows.find(r => r.job_id === jobId && ['needs_review', 'ready', 'scheduled', 'posting'].includes(r.state))?.id ?? null
    const body: JobPhotosResponse = {
      ok: true,
      available: known,
      job: summarize(data.job, data.info, known, counts.get(jobId) ?? data.photos.candidates.length, open),
      photos: data.photos.candidates.map(c => {
        const cleared = data.info.cleared.find(x => x.ref === c.ref)
        return {
          ref: c.ref,
          label: photoLabel(c),
          url: data.urls.get(c.ref) || '',
          rating: c.rating,
          cleared: cleared ? { path: cleared.path, covered: cleared.covered, url: data.clearedUrls.get(cleared.path) || '' } : null,
          proposed: data.proposal.picks.includes(c.ref),
          reason: data.proposal.reasons[c.ref] || data.proposal.leftOut[c.ref] || '',
        }
      }),
      proposal_note: data.proposal.note,
      facts: data.facts,
      caption: data.caption,
      caption_flags: data.captionFlags,
      problems: data.problems,
      ai_used: data.aiUsed,
    }
    return NextResponse.json(body)
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (!WRITERS.has(auth.role)) return forbidden()
  if (!checkRateLimit(`post-photo-upload:${auth.shopId}`, 150, 60 * 60_000).ok) return fail('That is a lot of photos for one hour. Try again later.', 429)

  const form = await req.formData().catch(() => null)
  const file = form?.get('file')
  if (!form || !(file instanceof File)) return fail('Choose a photo first.', 400)
  if (file.size <= 0 || file.size > MAX_UPLOAD) return fail('That photo is too large. Photos must be under 6 MB.', 413)
  const jobId = String(form.get('job_id') || '')
  const ref = String(form.get('ref') || '').slice(0, 300)
  if (jobId && !UUID.test(jobId)) return fail('Unknown job.', 400)

  try {
    const db = getServiceClient()
    const store = createPostStore(db)
    const shopId = auth.shopId

    // The browser already removed the hidden data. This is the second pass, and the file is refused if it cannot be cleaned.
    const cleaned = stripImageMetadata(new Uint8Array(await file.arrayBuffer()))
    if (!cleaned.ok) {
      return fail(cleaned.reason === 'type'
        ? 'Alpha only posts JPEG or PNG photos. Use the Posts screen to pick the photo; it converts it for you.'
        : 'That photo could not be read. Try a different one.', 415)
    }

    if (jobId) {
      if (!(await loadJob(db, shopId, jobId))) return fail('That job is not in your shop.', 404)
      if (ref && !(await refBelongsToJob(db, shopId, jobId, ref))) return fail('That photo is not on this job.', 400)
      if ((await store.jobInfo(shopId, jobId)) === null) return fail(NEEDS_DB, 409, { needs_database_update: true })
    }

    const path = `${shopId}/repair/${randomUUID()}.${cleaned.type === 'png' ? 'png' : 'jpg'}`
    const { error } = await db.storage.from(POST_BUCKET).upload(path, cleaned.bytes, { contentType: cleaned.type === 'png' ? 'image/png' : 'image/jpeg', cacheControl: '3600', upsert: false })
    if (error) {
      console.error('[growth/post-photos] upload failed:', error.message)
      return fail('The photo could not be saved. Try again.', 500)
    }

    if (jobId && ref) {
      const info = await store.jobInfo(shopId, jobId)
      const entry: ClearedPhoto = { ref, path, covered: String(form.get('covered') || '') === '1', label: String(form.get('label') || '').slice(0, 120), by: auth.userId, at: new Date().toISOString() }
      await store.setCleared(shopId, jobId, [...(info?.cleared ?? []).filter(x => x.ref !== ref), entry])
    }

    const url = (await postUrls(db, [path])).get(path) || ''
    return NextResponse.json({ ok: true, path, url, removed: cleaned.removed } satisfies CheckedPhotoResponse)
  } catch (error) {
    return errorResponse(error)
  }
}
