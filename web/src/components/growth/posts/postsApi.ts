// How the Posts screen talks to /api/growth/post-queue and /api/growth/post-photos.
// It shows the server's own plain sentence whenever there is one, and says "No connection" only when the request never arrived.

import type {
  CheckedPhotoResponse, JobBriefResponse, JobListResponse, JobPhotosResponse, PostAction, PostActionFail, PostActionOk, PostErrorCode, PostOverview,
} from '@/lib/posts-api-types'

const QUEUE = '/api/growth/post-queue'
const PHOTOS = '/api/growth/post-photos'

export type Failure = { ok: false; error: string; status: number; code?: PostErrorCode; needsDb: boolean; fail?: PostActionFail }
export type Done<T> = { ok: true; data: T } | Failure

const SIGNED_OUT = 'You were signed out. Sign in again, then try once more.'
const NO_CONNECTION = 'No connection. Check your internet and try again.'
const GENERIC = 'Something went wrong. Try again in a moment.'

const sentence = (t: string): string => (/[.!?]$/.test(t) ? t : `${t}.`)

/** The reason, in the server's own words when they are short enough to be a sentence. */
export function reasonFor(status: number, serverText: unknown): string {
  const t = typeof serverText === 'string' ? serverText.trim() : ''
  if (status === 401) return SIGNED_OUT
  if (t && t.length <= 400) return sentence(t)
  if (status === 403) return 'Your account cannot change posts. Ask the owner.'
  if (status === 413) return 'That photo is too large.'
  if (status === 429) return 'That is a lot of requests. Try again in a while.'
  return GENERIC
}

async function run<T>(url: string, init: RequestInit | undefined, accept: (d: Record<string, unknown>) => T): Promise<Done<T>> {
  let res: Response
  try {
    res = await fetch(url, { cache: 'no-store', ...init })
  } catch {
    return { ok: false, error: NO_CONNECTION, status: 0, needsDb: false }
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok || data.ok === false) {
    return {
      ok: false,
      status: res.status,
      error: reasonFor(res.status, data.error),
      code: typeof data.code === 'string' ? (data.code as PostErrorCode) : undefined,
      needsDb: data.needs_database_update === true,
      fail: data.ok === false ? (data as unknown as PostActionFail) : undefined,
    }
  }
  return { ok: true, data: accept(data) }
}

export const readOverview = (): Promise<Done<PostOverview>> => run(QUEUE, undefined, d => d as unknown as PostOverview)

export const readJobs = (): Promise<Done<JobListResponse>> => run(PHOTOS, undefined, d => d as unknown as JobListResponse)

export const readJobBrief = (jobId: string): Promise<Done<JobBriefResponse>> => run(`${PHOTOS}?${new URLSearchParams({ job_id: jobId, brief: '1' }).toString()}`, undefined, d => d as unknown as JobBriefResponse)

export function readJobPhotos(jobId: string, opts: { ai?: boolean; platforms?: string[] } = {}): Promise<Done<JobPhotosResponse>> {
  const q = new URLSearchParams({ job_id: jobId })
  if (opts.ai) q.set('ai', '1')
  if (opts.platforms?.length) q.set('platforms', opts.platforms.join(','))
  return run(`${PHOTOS}?${q.toString()}`, undefined, d => d as unknown as JobPhotosResponse)
}

export function sendAction(action: PostAction): Promise<Done<PostActionOk>> {
  return run(QUEUE, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(action) }, d => d as unknown as PostActionOk)
}

export interface CheckedUpload { jobId?: string; ref?: string; covered: boolean; label: string }

/** Sends one photo that has already been cleaned in this browser. The server cleans it again before saving. */
export function uploadChecked(blob: Blob, meta: CheckedUpload): Promise<Done<CheckedPhotoResponse>> {
  const form = new FormData()
  form.set('file', new File([blob], 'photo.jpg', { type: blob.type || 'image/jpeg' }))
  if (meta.jobId) form.set('job_id', meta.jobId)
  if (meta.ref) form.set('ref', meta.ref)
  form.set('covered', meta.covered ? '1' : '0')
  form.set('label', meta.label)
  return run(PHOTOS, { method: 'POST', body: form }, d => d as unknown as CheckedPhotoResponse)
}

/** One inspection photo, fetched through the app so this browser can clean it. */
export async function fetchJobPhoto(jobId: string, ref: string): Promise<Done<Blob>> {
  const q = new URLSearchParams({ job_id: jobId, ref })
  let res: Response
  try {
    res = await fetch(`${PHOTOS}?${q.toString()}`, { cache: 'no-store' })
  } catch {
    return { ok: false, error: NO_CONNECTION, status: 0, needsDb: false }
  }
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
    return { ok: false, status: res.status, error: reasonFor(res.status, data.error), needsDb: false }
  }
  const blob = await res.blob().catch(() => null)
  return blob && blob.size > 0 ? { ok: true, data: blob } : { ok: false, status: res.status, error: 'That photo could not be loaded.', needsDb: false }
}
