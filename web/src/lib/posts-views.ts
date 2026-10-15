// Turns queue rows and jobs into what the screen and Ask Alpha read: every state in words, every blocker spelled out, every
// photo with a picture address. The words come from posts-rules.ts so the screen and the server can never disagree.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { JobSummary, QueueItemView } from '@/lib/posts-api-types'
import { ACTIVE_STATES, blockers, decidedByWords, madeByWords, resultWords, stateWords, undoInfo } from '@/lib/posts-rules'
import type { PostMode, QueueRow } from '@/lib/posts-rules'
import { carLine, jobFinished } from '@/lib/posts-facts'
import { recentJobs, postUrls } from '@/lib/posts-source'
import type { JobRow } from '@/lib/posts-source'
import type { JobInfo, PostDb } from '@/lib/posts-store'

/** Queue rows with their words. `permissions` is read once for all of them. */
export async function itemViews(db: SupabaseClient, store: PostDb, shopId: string, rows: QueueRow[], mode: PostMode): Promise<QueueItemView[]> {
  const jobIds = [...new Set(rows.map(r => r.job_id).filter((x): x is string => Boolean(x)))]
  const infos = jobIds.length ? await store.jobInfos(shopId, jobIds) : new Map<string, JobInfo>()
  const urls = await postUrls(db, rows.flatMap(r => r.photos.map(p => p.path).filter((p): p is string => Boolean(p))))
  return rows.map(r => {
    const permission = r.job_id ? (infos ? infos.get(r.job_id)?.customer_ok === true : null) : true
    const state = stateWords(r, mode)
    return {
      ...r,
      state_lamp: state.lamp,
      state_word: state.word,
      blockers: blockers(r, { permission }),
      undo: undoInfo(r),
      made_by_words: madeByWords(r.made_by),
      decided_by_words: decidedByWords(r.decided_by),
      results_view: r.results.map(x => ({ platform: x.platform, ...resultWords(x), can_confirm: x.status === 'unknown' })),
      photo_urls: r.photos.map(p => (p.path ? urls.get(p.path) || '' : '')),
      title: r.facts?.car || (r.source === 'device' ? 'Photo post' : 'Job post'),
    }
  })
}

const countPhotos = (sections: unknown): number => {
  let n = 0
  for (const s of Array.isArray(sections) ? (sections as Array<Record<string, unknown>>) : []) {
    for (const i of Array.isArray(s?.items) ? (s.items as Array<Record<string, unknown>>) : []) n += Array.isArray(i?.photos) ? i.photos.length : 0
  }
  return n
}

export function summarize(job: JobRow, info: JobInfo | null, known: boolean, photoCount: number, openItemId: string | null): JobSummary {
  return {
    job_id: job.id,
    title: carLine({ vehicle_year: job.vehicle_year, vehicle_make: job.vehicle_make, vehicle_model: job.vehicle_model }) || 'Job',
    customer: job.customer_name,
    status: job.status,
    finished: jobFinished(job.status),
    customer_ok: info?.customer_ok === true,
    customer_ok_known: known,
    photo_count: photoCount,
    cleared_count: info?.cleared.length ?? 0,
    heard_from: info?.heard_from ?? '',
    open_item_id: openItemId,
    updated_at: job.updated_at,
  }
}

/** Photo counts for a set of jobs, from the inspections linked to them. Zero when inspections cannot be read. */
export async function photoCounts(db: SupabaseClient, shopId: string, jobIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!jobIds.length) return out
  const { data, error } = await db.from('dvi').select('job_id,sections').eq('shop_id', shopId).in('job_id', jobIds.slice(0, 100))
  if (error) return out
  for (const r of data || []) {
    const id = String((r as Record<string, unknown>).job_id)
    out.set(id, (out.get(id) ?? 0) + countPhotos((r as Record<string, unknown>).sections))
  }
  return out
}

export async function jobSummaries(db: SupabaseClient, store: PostDb, shopId: string, items: QueueRow[]): Promise<{ available: boolean; jobs: JobSummary[] }> {
  const jobs = await recentJobs(db, shopId, 60)
  const ids = jobs.map(j => j.id)
  const [infos, counts] = await Promise.all([store.jobInfos(shopId, ids), photoCounts(db, shopId, ids)])
  const open = new Map<string, string>()
  for (const i of items) if (i.job_id && ACTIVE_STATES.includes(i.state) && !open.has(i.job_id)) open.set(i.job_id, i.id)
  return {
    available: infos !== null,
    jobs: jobs.map(j => summarize(j, infos?.get(j.id) ?? null, infos !== null, counts.get(j.id) ?? 0, open.get(j.id) ?? null)),
  }
}
