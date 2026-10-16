/**
 * Ask Alpha and repair posts.
 *
 * One tool, `{"tool":"posts","action":"..."}`. Looking is free and runs on its own. Anything that changes a post, the posting mode
 * or a customer's yes stops at the review card first, and the server (api/growth/post-queue) enforces the same limits again:
 *   - Ask Alpha can turn posting Off or to Suggest, never Auto.
 *   - Ask Alpha can take a customer's yes away, never record one.
 *   - Ask Alpha can send a post to the public only after the owner approves the card, and never a post that has wording flags.
 *
 * Pure module: no imports from '@/' and no network. The page passes in a `get` function, so tests can use a fake one.
 */
import type { ReviewRow } from './review.ts'
import { OPEN_STATES, PLATFORM_LABEL, isPlatform, type PostPlatform } from '../posts-rules.ts'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const QUEUE = '/api/growth/post-queue'
const PHOTOS = '/api/growth/post-photos'

export const POSTS_READ_ACTIONS = ['status', 'jobs', 'job', 'photos'] as const
export const POSTS_WRITE_ACTIONS = ['prepare', 'approve', 'skip', 'mode', 'customer_ok_off'] as const
export type PostsAction = (typeof POSTS_READ_ACTIONS)[number] | (typeof POSTS_WRITE_ACTIONS)[number]

/** The id each change is recorded and risk-rated under (see action-risk.ts). */
export const POSTS_ACTION_ID: Record<(typeof POSTS_WRITE_ACTIONS)[number], string> = {
  prepare: 'posts.prepare',
  approve: 'posts.approve',
  skip: 'posts.skip',
  mode: 'posts.mode',
  customer_ok_off: 'posts.customerOkOff',
}

export type PostsGet = (url: string) => Promise<{ ok: boolean; status: number; data: unknown }>

export type PostsOutcome =
  /** Something the assistant looked up, written for the model to read. */
  | { kind: 'answer'; text: string }
  /** The assistant cannot do this (or needs something first). The model explains it to the owner. */
  | { kind: 'stop'; text: string }
  /** A change that is ready for the review card. Nothing has been changed. */
  | { kind: 'review'; actionId: string; title: string; effect: string; body: Record<string, unknown>; rows: ReviewRow[]; blocked: string }

type Rec = Record<string, unknown>
const rec = (v: unknown): Rec => (v && typeof v === 'object' && !Array.isArray(v) ? v as Rec : {})
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const text = (v: unknown, max = 400): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '')

const UPDATE_FIRST = 'Repair posts need a database update before they work. Nothing can be prepared or posted until it is applied.'

function failWords(res: { ok: boolean; status: number; data: unknown }): string {
  const d = rec(res.data)
  if (d.needs_database_update === true) return UPDATE_FIRST
  const error = text(d.error)
  if (error) return error
  if (res.status === 401 || res.status === 403) return 'You do not have permission for repair posts.'
  return `Repair posts could not be reached (HTTP ${res.status || 'no answer'}).`
}

function placesWords(raw: unknown): string {
  const places = list(raw).filter(isPlatform) as PostPlatform[]
  return places.length ? places.map(p => PLATFORM_LABEL[p]).join(', ') : 'No place chosen yet'
}

function whenWords(value: unknown): string {
  const time = typeof value === 'string' ? Date.parse(value) : NaN
  if (Number.isNaN(time)) return ''
  return new Date(time).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/* ---------- what the model reads ---------- */

/** The queue in a few lines: the mode, the weekly count and each post with its id, state and words. Never picture addresses. */
export function summarizeQueue(data: unknown): string {
  const d = rec(data)
  if (d.available === false) return UPDATE_FIRST
  const settings = rec(d.settings)
  const connections = rec(d.connections)
  const lines: string[] = []
  lines.push(`Posting mode: ${text(settings.mode) || 'off'}. Weekly limit ${Number(settings.weeklyCap) || 0}, used this week ${Number(d.used_this_week) || 0}, posts this month ${Number(d.posts_this_month) || 0}.`)
  lines.push(`Where posts go: ${placesWords(settings.platforms)}. Connected: ${Object.entries(connections).filter(([, v]) => v === 'connected').map(([k]) => isPlatform(k) ? PLATFORM_LABEL[k] : k).join(', ') || 'none'}.`)
  for (const note of list(d.notes).slice(0, 4)) if (text(note)) lines.push(`Note: ${text(note)}`)
  const items = list(d.items).map(rec)
  if (items.length === 0) lines.push('No posts in the queue or the log.')
  for (const item of items.slice(0, 12)) {
    const blockers = list(item.blockers).map(b => text(rec(b).words, 160)).filter(Boolean)
    const flags = list(item.flags).map(f => text(f, 120)).filter(Boolean)
    lines.push([
      `- id ${text(item.id, 60)}: ${text(item.state_word) || text(item.state)}`,
      text(item.title) ? ` | ${text(item.title)}` : '',
      ` | to ${placesWords(item.platforms)}`,
      ` | ${list(item.photos).length} photo${list(item.photos).length === 1 ? '' : 's'}`,
      ` | words: "${text(item.caption, 160)}"`,
      blockers.length ? ` | stopped by: ${blockers.join(' ')}` : '',
      flags.length ? ` | wording flags: ${flags.join('; ')}` : '',
    ].join(''))
  }
  if (items.length > 12) lines.push(`(${items.length - 12} older posts not listed.)`)
  return lines.join('\n')
}

function jobWords(job: Rec): string {
  const known = job.customer_ok_known !== false
  return [
    `- job_id ${text(job.job_id, 60)}: ${text(job.title) || 'Untitled job'}`,
    ` | status ${text(job.status) || 'unknown'}${job.finished === true ? ' (finished)' : ''}`,
    ` | customer said yes to a post: ${known ? (job.customer_ok === true ? 'yes' : 'no') : 'unknown'}`,
    ` | photos ${Number(job.photo_count) || 0}, checked ${Number(job.cleared_count) || 0}`,
    text(job.open_item_id, 60) ? ` | waiting post id ${text(job.open_item_id, 60)}` : '',
  ].join('')
}

export function summarizeJobs(data: unknown): string {
  const d = rec(data)
  if (d.available === false) return UPDATE_FIRST
  const jobs = list(d.jobs).map(rec)
  if (jobs.length === 0) return 'No recent jobs to post about.'
  return jobs.slice(0, 15).map(jobWords).join('\n')
}

export function summarizeJob(data: unknown): string {
  const d = rec(data)
  if (d.available === false) return UPDATE_FIRST
  return jobWords(rec(d.job))
}

/** The job's photos and the words Alpha would use. Picture addresses are left out on purpose. */
export function summarizePhotos(data: unknown): string {
  const d = rec(data)
  if (d.available === false) return UPDATE_FIRST
  const lines: string[] = [jobWords(rec(d.job))]
  const photos = list(d.photos).map(rec)
  lines.push(`${photos.length} photo${photos.length === 1 ? '' : 's'} on this job.`)
  for (const p of photos.slice(0, 12)) {
    lines.push(`- ${text(p.label, 80) || 'Photo'}: ${p.rating ? `rated ${text(p.rating)}` : 'not rated'}${p.proposed === true ? ', picked for the post' : ''}${rec(p.cleared).path ? ', owner checked' : ', not checked yet'}${text(p.reason, 160) ? `, ${text(p.reason, 160)}` : ''}`)
  }
  if (text(d.proposal_note)) lines.push(`Note: ${text(d.proposal_note)}`)
  if (text(d.caption, 800)) lines.push(`Words Alpha would use: "${text(d.caption, 800)}"`)
  for (const flag of list(d.caption_flags).slice(0, 6)) if (text(flag)) lines.push(`Wording flag: ${text(flag, 160)}`)
  for (const problem of list(d.problems).slice(0, 6)) if (text(problem)) lines.push(`Problem: ${text(problem, 200)}`)
  return lines.join('\n')
}

/* ---------- what the card shows ---------- */

function photoWords(item: Rec): string {
  const photos = list(item.photos).map(rec)
  const checked = photos.filter(p => Boolean(p.path)).length
  return `${photos.length} photo${photos.length === 1 ? '' : 's'}, ${checked} checked by you`
}

function approveRows(item: Rec): ReviewRow[] {
  const rows: ReviewRow[] = []
  if (text(item.title)) rows.push({ label: 'Job', value: text(item.title) })
  rows.push({ label: 'Posts to', value: placesWords(item.platforms) })
  rows.push({ label: 'The words', value: text(item.caption, 4000) || 'No words yet', kind: 'words' })
  rows.push({ label: 'Photos', value: photoWords(item) })
  if (text(item.made_by_words)) rows.push({ label: 'Made by', value: text(item.made_by_words), kind: 'minor' })
  const post_at = whenWords(item.post_at)
  rows.push({ label: 'When', value: post_at ? `Scheduled for ${post_at}` : 'Right away, once you approve' })
  rows.push({ label: 'Post ID', value: text(item.id, 60), kind: 'minor' })
  return rows
}

/** Why a post cannot be sent from the chat right now, or empty when it can. Wording flags are the owner's call on the Posts screen. */
export function approveBlocked(item: Rec): string {
  const state = text(item.state, 30)
  if (!(OPEN_STATES as readonly string[]).includes(state)) return `This post is "${text(item.state_word) || state}", so it cannot be sent from here.`
  const blockers = list(item.blockers).map(b => text(rec(b).words, 240)).filter(Boolean)
  if (blockers.length) return `Not ready to post: ${blockers.join(' ')} Fix this on the Posts screen.`
  const flags = list(item.flags).map(f => text(f, 160)).filter(Boolean)
  if (flags.length) return `Alpha's wording check flagged: ${flags.join('; ')}. Look at it on the Posts screen and accept it there if it is fine.`
  return ''
}

/* ---------- running one tool call ---------- */

function needId(value: unknown, what: string): { id: string } | { error: string } {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!UUID.test(id)) return { error: `I need the exact ${what} id. Look first (status or jobs), then use the id it returns. Do not guess one.` }
  return { id }
}

/**
 * Run one `posts` tool call. Looking returns text for the model. A change returns the review card's contents and changes nothing.
 * `get` fetches an app route with the signed-in user's headers.
 */
export async function runPostsTool(call: Record<string, unknown>, get: PostsGet): Promise<PostsOutcome> {
  const action = text(call.action, 30) as PostsAction

  if (action === 'status') {
    const res = await get(QUEUE)
    return res.ok ? { kind: 'answer', text: summarizeQueue(res.data) } : { kind: 'stop', text: failWords(res) }
  }
  if (action === 'jobs') {
    const res = await get(PHOTOS)
    return res.ok ? { kind: 'answer', text: summarizeJobs(res.data) } : { kind: 'stop', text: failWords(res) }
  }
  if (action === 'job' || action === 'photos') {
    const job = needId(call.job_id, 'job')
    if ('error' in job) return { kind: 'stop', text: job.error }
    const res = await get(`${PHOTOS}?job_id=${job.id}${action === 'job' ? '&brief=1' : ''}`)
    if (!res.ok) return { kind: 'stop', text: failWords(res) }
    return { kind: 'answer', text: action === 'job' ? summarizeJob(res.data) : summarizePhotos(res.data) }
  }

  if (action === 'mode') {
    const wanted = text(call.mode, 12).toLowerCase()
    if (wanted === 'auto') return { kind: 'stop', text: 'Only the owner can turn Auto on, on the Posts screen. Alpha can set posting to Off or Suggest. Tell the owner to open Posts and turn Auto on there.' }
    if (wanted !== 'off' && wanted !== 'suggest') return { kind: 'stop', text: 'Posting mode can be "off" or "suggest" from here.' }
    const res = await get(QUEUE)
    if (!res.ok) return { kind: 'stop', text: failWords(res) }
    const now = rec(rec(res.data).settings)
    const body: Record<string, unknown> = { action: 'set_settings', mode: wanted }
    const rows: ReviewRow[] = [{ label: 'Now', value: text(now.mode) || 'off' }, { label: 'Will be', value: wanted === 'off' ? 'Off' : 'Suggest' }]
    if (call.weekly_cap !== undefined) {
      const cap = Math.round(Number(call.weekly_cap))
      if (!Number.isFinite(cap) || cap < 1 || cap > 14) return { kind: 'stop', text: 'The weekly limit must be a whole number from 1 to 14.' }
      body.weekly_cap = cap
      rows.push({ label: 'Weekly limit', value: `${Number(now.weeklyCap) || 0} now, ${cap} after` })
    }
    return {
      kind: 'review', actionId: POSTS_ACTION_ID.mode, title: wanted === 'off' ? 'Turn repair posts off?' : 'Set repair posts to Suggest?',
      effect: wanted === 'off' ? 'Alpha stops preparing posts by itself. You can still make a post from a job.' : 'Alpha prepares posts from finished jobs where the customer said yes. Each one waits for your OK before it goes public.',
      body, rows, blocked: '',
    }
  }

  if (action === 'prepare' || action === 'customer_ok_off') {
    const job = needId(call.job_id, 'job')
    if ('error' in job) return { kind: 'stop', text: job.error }
    const res = await get(`${PHOTOS}?job_id=${job.id}&brief=1`)
    if (!res.ok) return { kind: 'stop', text: failWords(res) }
    const found = rec(rec(res.data).job)
    if (!text(found.job_id)) return { kind: 'stop', text: 'That job is not in your shop.' }
    const title = text(found.title) || 'This job'
    const rows: ReviewRow[] = [{ label: 'Job', value: title }]
    if (action === 'customer_ok_off') {
      rows.push({ label: 'Customer said yes now', value: found.customer_ok === true ? 'Yes' : 'No' })
      rows.push({ label: 'Job ID', value: job.id, kind: 'minor' })
      return {
        kind: 'review', actionId: POSTS_ACTION_ID.customer_ok_off, title: `Take the customer's yes away for ${title}?`,
        effect: 'No post will be made about this job, and any post waiting for it is cancelled.',
        body: { action: 'set_permission', job_id: job.id, ok: false }, rows, blocked: '',
      }
    }
    rows.push({ label: 'Customer said yes', value: found.customer_ok_known === false ? 'Unknown' : found.customer_ok === true ? 'Yes' : 'No' })
    rows.push({ label: 'Photos', value: `${Number(found.photo_count) || 0} on the job, ${Number(found.cleared_count) || 0} checked` })
    rows.push({ label: 'What happens', value: 'Alpha writes the words from the job record and picks the checked photos. It goes to the queue to wait for your OK. Nothing is posted.', kind: 'minor' })
    rows.push({ label: 'Job ID', value: job.id, kind: 'minor' })
    const blocked = found.customer_ok_known === false ? UPDATE_FIRST : found.customer_ok === true ? '' : 'The customer has not said yes to a post about this job. Turn on Customer OK on the job first.'
    return {
      kind: 'review', actionId: POSTS_ACTION_ID.prepare, title: `Make a post draft for ${title}?`,
      effect: 'Makes a draft post for you to look at. Nothing is posted.',
      body: { action: 'prepare_job', job_id: job.id }, rows, blocked,
    }
  }

  if (action === 'approve' || action === 'skip') {
    const post = needId(call.id, 'post')
    if ('error' in post) return { kind: 'stop', text: post.error }
    const res = await get(QUEUE)
    if (!res.ok) return { kind: 'stop', text: failWords(res) }
    const item = list(rec(res.data).items).map(rec).find(i => text(i.id, 60) === post.id)
    if (!item) return { kind: 'stop', text: 'That post is not in the queue. Look at the status again for the current ids.' }
    if (action === 'skip') {
      const open = (OPEN_STATES as readonly string[]).includes(text(item.state, 30))
      return {
        kind: 'review', actionId: POSTS_ACTION_ID.skip, title: 'Skip this post?',
        effect: 'Alpha will not post this one. Nothing is posted and nothing is deleted.',
        body: { action: 'skip', id: post.id }, rows: approveRows(item),
        blocked: open ? '' : `This post is "${text(item.state_word) || text(item.state)}", so there is nothing to skip.`,
      }
    }
    return {
      kind: 'review', actionId: POSTS_ACTION_ID.approve, title: 'Post this to the public?',
      effect: 'Sends this post, with these photos and words, to the places listed. Anything posted stays public until you remove it in that app.',
      body: { action: 'approve', id: post.id }, rows: approveRows(item), blocked: approveBlocked(item),
    }
  }

  return { kind: 'stop', text: 'Unknown posts action. Use status, jobs, job, photos, prepare, approve, skip, mode or customer_ok_off.' }
}
