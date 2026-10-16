// The repair-post pipeline: making a post, editing it, approving it, sending it, undoing what can be undone, and the scheduled
// run that prepares posts (Suggest) and sends them without a tap (Auto, only when the owner turned it on).
//
// Pure: the database, the connector calls, the VIN decode and the AI are handed in as `ports`, so every rule is covered by
// tests and nothing here can reach the outside world by itself. Relative imports only.
//
// The promises this file keeps:
//   - a post about a job cannot be made, approved or sent without the customer's yes, read again at the moment it goes out;
//   - nothing goes out with a photo the owner has not checked;
//   - Auto only sends posts Alpha prepared, inside the weekly limit, to apps that are connected;
//   - a result is only ever "posted" when the connector said so, and an unclear answer is shown as unclear.

import { copyFlags } from './posts-checks.ts'
import { captionLimit, joinFacts, vetCaption } from './posts-facts.ts'
import type { PostFacts } from './posts-facts.ts'
import {
  ACTIVE_STATES, MAX_CAPTION, MAX_ITEM_PHOTOS, MAX_WAITING, OPEN_STATES, PLATFORM_LABEL, autoDecision, blockers, cleanPlatforms, holdUntil, reachable,
  resultWords, uncheckedCount, undoInfo, usedThisWeek,
} from './posts-rules.ts'
import type {
  Blocker, Connection, DecidedBy, ItemSource, ItemState, MadeBy, PlatformResult, PostMetrics, PostPhoto, PostPlatform, PostSettings, QueueRow,
} from './posts-rules.ts'
import type { PostErrorCode, RunSummary } from './posts-api-types.ts'

/* ---------- ports ---------- */

export type NewItem = Omit<QueueRow, 'id' | 'created_at' | 'updated_at'>

/** Thrown by the store when a job already has a post waiting. */
export class DuplicateOpenItem extends Error {
  constructor() { super('This job already has a post waiting.') }
}

export interface PostStore {
  list(shopId: string): Promise<QueueRow[]>
  get(shopId: string, id: string): Promise<QueueRow | null>
  insert(row: NewItem): Promise<QueueRow>
  /** Changes the row only if it is still in one of the `from` states. Null when it is not (someone else got there first). */
  update(shopId: string, id: string, patch: Partial<QueueRow>, from: readonly ItemState[]): Promise<QueueRow | null>
  settings(shopId: string): Promise<PostSettings>
  /** Whether the customer said yes to a post about this job. Null when that cannot be read. */
  permission(shopId: string, jobId: string): Promise<boolean | null>
}

export type Prepared =
  | { ok: true; facts: PostFacts; caption: string; photos: PostPhoto[]; note: string; aiUsed: boolean }
  | { ok: false; reason: string }

export interface PostPorts {
  store: PostStore
  now: () => number
  connections(shopId: string): Promise<Record<PostPlatform, Connection>>
  /** Sends the post through the connector routes, one result per platform asked for. Must not throw for a platform that answered. */
  publish(shopId: string, item: QueueRow, platforms: PostPlatform[]): Promise<PlatformResult[]>
  /** Makes a post from a job: facts, caption and the best of the photos the owner already cleared. Never posts. */
  prepare(shopId: string, jobId: string, platforms: PostPlatform[]): Promise<Prepared>
  /** Finished jobs from the last few weeks where the customer said yes and photos are cleared. Newest first. */
  candidateJobs(shopId: string, sinceMs: number, limit: number): Promise<string[]>
  jobFinished(shopId: string, jobId: string): Promise<boolean>
  /** Likes and comments for posts the platforms can report on. Missing ids mean "not recorded". */
  numbers?(shopId: string, items: QueueRow[]): Promise<Record<string, Partial<Record<PostPlatform, PostMetrics>>>>
}

/* ---------- results ---------- */

export type Outcome<T extends object = Record<string, never>> =
  | ({ ok: true; message: string } & T)
  | { ok: false; error: string; code: PostErrorCode; blockers?: Blocker[]; item?: QueueRow }

const fail = (code: PostErrorCode, error: string, extra: { blockers?: Blocker[]; item?: QueueRow } = {}): Outcome<never> => ({ ok: false, error, code, ...extra })

export type Actor = { id: string | null; via: 'owner' | 'ask_alpha' }
const decidedBy = (a: Actor): DecidedBy => a.via

/* ---------- cleaning what comes in ---------- */

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v : '').replace(/\r/g, '').slice(0, max)

/**
 * Photos from a request, made safe. A cleaned copy must live in this shop's own folder, so one shop can never point a post at
 * another shop's file. Anything else is dropped.
 */
export function cleanPhotos(raw: unknown, shopId: string): PostPhoto[] {
  if (!Array.isArray(raw)) return []
  const out: PostPhoto[] = []
  const seen = new Set<string>()
  for (const v of raw) {
    if (!v || typeof v !== 'object') continue
    const o = v as Record<string, unknown>
    const path = typeof o.path === 'string' && o.path.startsWith(`${shopId}/`) && !o.path.includes('..') && o.path.length <= 300 ? o.path : null
    const ref = typeof o.ref === 'string' && o.ref ? o.ref.slice(0, 300) : null
    if (!path && !ref) continue
    const key = path || ref || ''
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ref, path, covered: o.covered === true, label: str(o.label, 120) })
    if (out.length >= MAX_ITEM_PHOTOS) break
  }
  return out
}

/** Wording flags for a caption: strict against the job's facts when there are some, the shared checker otherwise. */
export function captionFlags(caption: string, facts: PostFacts | null, platforms: readonly PostPlatform[]): string[] {
  const text = caption.trim()
  if (!text) return []
  if (facts && (facts.car || facts.repairs.length)) return vetCaption(text, facts, platforms).flags
  const flags = copyFlags(text, facts ? [joinFacts(facts)] : [])
  const limit = captionLimit(platforms)
  if ([...text].length > limit) flags.push(`The wording is ${[...text].length.toLocaleString('en-US')} characters. The places you chose take up to ${limit.toLocaleString('en-US')}.`)
  return flags
}

/** Which of the open states a post belongs in: ready only when nothing blocks it and the wording has no flags. */
export function settle(item: Pick<QueueRow, 'source' | 'job_id' | 'caption' | 'photos' | 'platforms' | 'flags'>, permission: boolean | null): 'needs_review' | 'ready' {
  return blockers(item, { permission }).length === 0 && item.flags.length === 0 ? 'ready' : 'needs_review'
}

const permissionFail = (b: Blocker[]): Outcome<never> => {
  const first = b[0]
  const code: PostErrorCode = first.code === 'no_permission' ? 'no_permission' : first.code === 'permission_unknown' ? 'permission_unknown' : 'blocked'
  return fail(code, first.words, { blockers: b })
}

/** The refusal for a job whose customer has not said yes (or whose answer cannot be read). */
const noPermission = (permission: boolean | null): Outcome<never> =>
  permissionFail(blockers({ source: 'job', job_id: 'job', caption: 'x', photos: [{ ref: null, path: 'x', covered: false, label: '' }], platforms: ['google'] }, { permission }))

/* ---------- making a post ---------- */

export interface CreateInput {
  jobId: string | null
  caption: string
  facts: PostFacts | null
  photos: PostPhoto[]
  platforms: PostPlatform[]
  madeBy: MadeBy
  createdBy: string | null
  /** Auto only: the post waits this long before it may go out. */
  holdForAuto?: boolean
}

export async function createItem(ports: PostPorts, shopId: string, input: CreateInput): Promise<Outcome<{ item: QueueRow }>> {
  const platforms = cleanPlatforms(input.platforms)
  const photos = input.photos.slice(0, MAX_ITEM_PHOTOS)
  const caption = input.caption.replace(/\r/g, '').slice(0, MAX_CAPTION)
  const source: ItemSource = input.jobId ? 'job' : 'device'
  let permission: boolean | null = true
  if (input.jobId) {
    permission = await ports.store.permission(shopId, input.jobId)
    if (permission !== true) return noPermission(permission)
    const existing = (await ports.store.list(shopId)).find(i => i.job_id === input.jobId && ACTIVE_STATES.includes(i.state))
    if (existing) return fail('busy', 'This job already has a post waiting. Open it from the queue instead of making another.', { item: existing })
  }
  const flags = captionFlags(caption, input.facts, platforms)
  const now = ports.now()
  const base = { source, job_id: input.jobId, caption, photos, platforms, flags }
  const row: NewItem = {
    shop_id: shopId, job_id: input.jobId, source, state: settle(base, permission), caption, facts: input.facts, photos, platforms, flags,
    made_by: input.madeBy, photos_checked_at: photos.length > 0 && uncheckedCount(photos) === 0 ? new Date(now).toISOString() : null,
    photos_checked_by: photos.length > 0 && uncheckedCount(photos) === 0 ? input.createdBy : null,
    approved_by: null, approved_at: null, decided_by: null, post_at: null,
    hold_until: input.holdForAuto ? holdUntil(now) : null, attempt: 0, results: [], metrics: {}, error: null, posted_at: null,
    created_by: input.createdBy,
  }
  try {
    const item = await ports.store.insert(row)
    return { ok: true, message: item.state === 'ready' ? 'The post is ready for you to look at.' : 'The post is saved. It still needs a few things before it can go out.', item }
  } catch (e) {
    if (e instanceof DuplicateOpenItem) return fail('busy', 'This job already has a post waiting. Open it from the queue instead of making another.')
    throw e
  }
}

/** Alpha (or the owner, or Ask Alpha) makes a post from a job. Posts nothing. */
export async function prepareJobItem(ports: PostPorts, shopId: string, jobId: string, who: { madeBy: MadeBy; userId: string | null; platforms: PostPlatform[]; holdForAuto?: boolean }): Promise<Outcome<{ item: QueueRow; note: string; aiUsed: boolean }>> {
  const permission = await ports.store.permission(shopId, jobId)
  if (permission !== true) return noPermission(permission)
  const prep = await ports.prepare(shopId, jobId, who.platforms)
  if (!prep.ok) return fail('not_enough', prep.reason)
  const made = await createItem(ports, shopId, { jobId, caption: prep.caption, facts: prep.facts, photos: prep.photos, platforms: who.platforms, madeBy: who.madeBy, createdBy: who.userId, holdForAuto: who.holdForAuto })
  if (!made.ok) return made
  return { ok: true, message: made.message, item: made.item, note: prep.note, aiUsed: prep.aiUsed }
}

/* ---------- editing ---------- */

export interface EditInput { caption?: string; photos?: PostPhoto[]; platforms?: PostPlatform[] }

export async function editItem(ports: PostPorts, shopId: string, id: string, patch: EditInput, userId: string | null): Promise<Outcome<{ item: QueueRow }>> {
  const item = await ports.store.get(shopId, id)
  if (!item) return fail('not_found', 'That post is not in the queue.')
  if (!OPEN_STATES.includes(item.state)) return fail('wrong_state', 'This post is no longer waiting, so it cannot be changed.', { item })
  const caption = patch.caption === undefined ? item.caption : patch.caption.replace(/\r/g, '').slice(0, MAX_CAPTION)
  const photos = patch.photos === undefined ? item.photos : patch.photos.slice(0, MAX_ITEM_PHOTOS)
  const platforms = patch.platforms === undefined ? item.platforms : cleanPlatforms(patch.platforms)
  const permission = item.job_id ? await ports.store.permission(shopId, item.job_id) : true
  const flags = captionFlags(caption, item.facts, platforms)
  const same = JSON.stringify(photos) === JSON.stringify(item.photos)
  const all = photos.length > 0 && uncheckedCount(photos) === 0
  const now = new Date(ports.now()).toISOString()
  const next: Partial<QueueRow> = {
    caption, photos, platforms, flags,
    state: settle({ source: item.source, job_id: item.job_id, caption, photos, platforms, flags }, permission),
    photos_checked_at: all ? (same && item.photos_checked_at ? item.photos_checked_at : now) : null,
    photos_checked_by: all ? (same && item.photos_checked_by ? item.photos_checked_by : userId) : null,
    // Any change takes back an approval, so what was approved is always what goes out.
    approved_by: null, approved_at: null, post_at: null, decided_by: null,
  }
  const saved = await ports.store.update(shopId, id, next, OPEN_STATES)
  if (!saved) return fail('busy', 'This post changed while you were editing. Open it again.')
  return { ok: true, message: saved.state === 'ready' ? 'Saved. The post is ready.' : 'Saved.', item: saved }
}

/* ---------- sending ---------- */

/** What state a post is in after some of its places answered. */
export function foldState(platforms: readonly PostPlatform[], results: readonly PlatformResult[], before: ItemState): ItemState {
  const by = new Map(results.map(r => [r.platform, r]))
  const posted = platforms.filter(p => by.get(p)?.status === 'posted')
  if (platforms.length > 0 && posted.length === platforms.length) return 'posted'
  if (posted.length > 0) return 'partly_posted'
  if (platforms.some(p => by.get(p)?.status === 'unknown')) return 'failed'
  if (platforms.length > 0 && platforms.every(p => by.get(p)?.status === 'not_connected')) return before === 'failed' ? 'failed' : before
  return 'failed'
}

const list = (names: string[]): string => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`)

export function outcomeMessage(platforms: readonly PostPlatform[], results: readonly PlatformResult[]): string {
  const by = new Map(results.map(r => [r.platform, r]))
  const posted = platforms.filter(p => by.get(p)?.status === 'posted').map(p => PLATFORM_LABEL[p])
  const rest = platforms.filter(p => by.get(p)?.status !== 'posted').map(p => by.get(p)).filter((r): r is PlatformResult => Boolean(r)).map(r => resultWords(r).word)
  if (posted.length && !rest.length) return `Posted to ${list(posted)}.`
  if (posted.length) return `Posted to ${list(posted)}. ${rest.join('. ')}`
  return `Nothing was posted. ${rest.join('. ')}`.trim()
}

const SENDABLE: readonly ItemState[] = ['needs_review', 'ready', 'scheduled', 'failed', 'partly_posted']

/**
 * Sends one post to every chosen place that is connected and has not already got it. The caller has already checked the
 * rules (permission, photos, wording); this does the claim, the sends and the honest bookkeeping.
 */
export async function sendItem(ports: PostPorts, shopId: string, item: QueueRow, by: DecidedBy, approver: string | null): Promise<Outcome<{ item: QueueRow }>> {
  const conns = await ports.connections(shopId)
  const prior = new Map(item.results.map(r => [r.platform, r]))
  const wanted = item.platforms.filter(p => prior.get(p)?.status !== 'posted')
  const waiting = wanted.filter(p => prior.get(p)?.status === 'unknown')
  const targets = wanted.filter(p => !waiting.includes(p))
  const live = reachable(targets, conns)
  const missing = targets.filter(p => !live.includes(p))
  const at = new Date(ports.now()).toISOString()
  const notConnected: PlatformResult[] = missing.map(p => ({ platform: p, status: 'not_connected', error: `${PLATFORM_LABEL[p]} is not connected. Connect it in Connected apps.`, at }))

  if (live.length === 0) {
    const results = [...item.results.filter(r => !missing.includes(r.platform)), ...notConnected]
    const words = waiting.length
      ? `Alpha cannot tell whether it posted to ${list(waiting.map(p => PLATFORM_LABEL[p]))}. Check there and tell Alpha what you found.`
      : `Nothing was posted. ${list(missing.map(p => PLATFORM_LABEL[p]))} ${missing.length === 1 ? 'is' : 'are'} not connected. Open Connected apps to connect ${missing.length === 1 ? 'it' : 'them'}, then try again.`
    const saved = await ports.store.update(shopId, item.id, { results, error: words }, SENDABLE)
    return fail(waiting.length ? 'wrong_state' : 'not_connected', words, { item: saved ?? item })
  }

  const claimed = await ports.store.update(shopId, item.id, { state: 'posting', decided_by: by, approved_by: approver, approved_at: at, attempt: item.attempt + 1, error: null }, SENDABLE)
  if (!claimed) return fail('busy', 'This post is already being sent or has changed. Open it again to see where it stands.')

  let got: PlatformResult[]
  try {
    got = await ports.publish(shopId, claimed, live)
  } catch (e) {
    const why = e instanceof Error ? e.message : 'The request ended before an answer came back.'
    got = live.map(p => ({ platform: p, status: 'unknown' as const, error: why.slice(0, 300), at }))
  }
  // Every place we asked gets an entry, even if the publisher forgot one: silence is never read as success.
  const answered = new Map(got.map(r => [r.platform, r]))
  const fresh: PlatformResult[] = live.map(p => answered.get(p) ?? { platform: p, status: 'unknown', error: 'No answer came back.', at })
  const kept = item.results.filter(r => !live.includes(r.platform) && !missing.includes(r.platform))
  const results = [...kept, ...fresh, ...notConnected]
  const state = foldState(item.platforms, results, item.state)
  const anyPosted = results.some(r => r.status === 'posted')
  const errors = results.filter(r => r.status !== 'posted' && r.error).map(r => `${PLATFORM_LABEL[r.platform]}: ${r.error}`).join(' ')
  const saved = await ports.store.update(shopId, item.id, {
    state, results, error: errors ? errors.slice(0, 800) : null, posted_at: anyPosted ? (item.posted_at ?? at) : item.posted_at,
  }, ['posting'])
  const final = saved ?? { ...claimed, state, results }
  const message = outcomeMessage(item.platforms, results)
  if (state === 'posted' || state === 'partly_posted') return { ok: true, message, item: final }
  return fail(live.some(p => answered.get(p)?.status === 'unknown') ? 'wrong_state' : 'blocked', message, { item: final })
}

export interface ApproveOptions { acceptFlags?: boolean; postAt?: string | null }

async function ruleCheck(ports: PostPorts, shopId: string, item: QueueRow, acceptFlags: boolean): Promise<Outcome<never> | null> {
  const permission = item.job_id ? await ports.store.permission(shopId, item.job_id) : true
  const b = blockers(item, { permission })
  if (b.length) return permissionFail(b)
  if (item.flags.length && !acceptFlags) return fail('flags', `The wording needs a look before it goes public: ${item.flags[0]}`, { item })
  return null
}

/** The owner (or Ask Alpha after the owner said yes) approves a post: it goes out now, or is held for a later time. */
export async function approveItem(ports: PostPorts, shopId: string, id: string, actor: Actor, opts: ApproveOptions = {}): Promise<Outcome<{ item: QueueRow }>> {
  const item = await ports.store.get(shopId, id)
  if (!item) return fail('not_found', 'That post is not in the queue.')
  if (!OPEN_STATES.includes(item.state)) return fail('wrong_state', 'This post is not waiting for approval any more.', { item })
  const refused = await ruleCheck(ports, shopId, item, opts.acceptFlags === true)
  if (refused) return { ...refused, item }
  const at = opts.postAt ? Date.parse(opts.postAt) : NaN
  if (Number.isFinite(at) && at > ports.now() + 5 * 60_000) {
    const saved = await ports.store.update(shopId, id, { state: 'scheduled', post_at: new Date(at).toISOString(), approved_by: actor.id, approved_at: new Date(ports.now()).toISOString(), decided_by: decidedBy(actor) }, OPEN_STATES)
    if (!saved) return fail('busy', 'This post changed. Open it again.')
    return { ok: true, message: 'Scheduled. Alpha checks for posts that are due once a day, so it can go out a few hours after the time you chose.', item: saved }
  }
  return sendItem(ports, shopId, item, decidedBy(actor), actor.id)
}

/** Tries again for the places that did not get the post. Places that already have it, or may have it, are left alone. */
export async function retryItem(ports: PostPorts, shopId: string, id: string, actor: Actor): Promise<Outcome<{ item: QueueRow }>> {
  const item = await ports.store.get(shopId, id)
  if (!item) return fail('not_found', 'That post is not in the queue.')
  if (item.state !== 'failed' && item.state !== 'partly_posted') return fail('wrong_state', 'Only a post that did not go out can be tried again.', { item })
  const refused = await ruleCheck(ports, shopId, item, true)
  if (refused) return { ...refused, item }
  return sendItem(ports, shopId, item, decidedBy(actor), actor.id)
}

/** The owner says what they saw on the platform for a result Alpha could not confirm. */
export async function confirmOutcome(ports: PostPorts, shopId: string, id: string, platform: PostPlatform, outcome: 'posted' | 'not_posted'): Promise<Outcome<{ item: QueueRow }>> {
  const item = await ports.store.get(shopId, id)
  if (!item) return fail('not_found', 'That post is not in the queue.')
  const found = item.results.find(r => r.platform === platform)
  if (!found || found.status !== 'unknown') return fail('wrong_state', `Alpha is not waiting to hear about ${PLATFORM_LABEL[platform]} for this post.`, { item })
  const at = new Date(ports.now()).toISOString()
  const changed: PlatformResult = outcome === 'posted'
    ? { platform, status: 'posted', id: null, error: null, at }
    : { platform, status: 'failed', error: 'You checked and it did not post.', at }
  const results = item.results.map(r => (r.platform === platform ? changed : r))
  const state = foldState(item.platforms, results, 'failed')
  const saved = await ports.store.update(shopId, id, {
    results, state, posted_at: results.some(r => r.status === 'posted') ? (item.posted_at ?? at) : item.posted_at,
    error: results.filter(r => r.status !== 'posted' && r.error).map(r => `${PLATFORM_LABEL[r.platform]}: ${r.error}`).join(' ').slice(0, 800) || null,
  }, ['failed', 'partly_posted'])
  if (!saved) return fail('busy', 'This post changed. Open it again.')
  return { ok: true, message: outcome === 'posted' ? `Noted: it is on ${PLATFORM_LABEL[platform]}.` : `Noted: it did not post to ${PLATFORM_LABEL[platform]}. You can try again.`, item: saved }
}

/** Skip a post waiting for a look, or cancel one that is scheduled. A post that already went out cannot be undone from here. */
export async function skipItem(ports: PostPorts, shopId: string, id: string): Promise<Outcome<{ item: QueueRow }>> {
  const item = await ports.store.get(shopId, id)
  if (!item) return fail('not_found', 'That post is not in the queue.')
  if (!OPEN_STATES.includes(item.state)) {
    // Say what is true of this post: still going out, already public (cannot be taken back from here), or simply not waiting any more.
    const words = undoInfo(item).words
    return fail('wrong_state', item.state === 'posting' || item.state === 'posted' || item.state === 'partly_posted' ? words : `This post is not waiting, so there is nothing to skip. ${words}`, { item })
  }
  const to: ItemState = item.state === 'scheduled' ? 'cancelled' : 'skipped'
  const saved = await ports.store.update(shopId, id, { state: to, error: null }, OPEN_STATES)
  if (!saved) return fail('busy', 'This post changed. Open it again.')
  return { ok: true, message: to === 'cancelled' ? 'Cancelled. Nothing was posted.' : 'Skipped. Nothing was posted.', item: saved }
}

/* ---------- the customer's yes ---------- */

/** Takes back a post's chance of going out when the customer's yes is removed. Returns how many posts were cancelled. */
export async function cancelForJob(ports: PostPorts, shopId: string, jobId: string): Promise<number> {
  const open = (await ports.store.list(shopId)).filter(i => i.job_id === jobId && OPEN_STATES.includes(i.state))
  let n = 0
  for (const i of open) {
    const saved = await ports.store.update(shopId, i.id, { state: 'cancelled', error: 'The customer’s yes to a post about this job was taken away.' }, OPEN_STATES)
    if (saved) n += 1
  }
  return n
}

/* ---------- the scheduled run ---------- */

export const PREPARE_PER_RUN = 2
export const SEND_PER_RUN = 3
export const LOOKBACK_DAYS = 21

export const STUCK_MINUTES = 10

/**
 * A post that has said "posting" for ten minutes lost its sender (the server stopped mid-send). Its places are marked unclear,
 * never posted and never failed, so the owner checks the apps before anything is sent again. Returns how many were released.
 */
export async function recoverStuck(ports: Pick<PostPorts, 'store' | 'now'>, shopId: string): Promise<number> {
  const now = ports.now()
  const stuck = (await ports.store.list(shopId)).filter(i => i.state === 'posting' && now - Date.parse(i.updated_at) > STUCK_MINUTES * 60_000)
  let n = 0
  for (const i of stuck) {
    const at = new Date(now).toISOString()
    const results: PlatformResult[] = i.platforms.map(p => {
      const had = i.results.find(r => r.platform === p)
      return had?.status === 'posted' ? had : { platform: p, status: 'unknown', error: 'Alpha lost track of this post while it was going out.', at }
    })
    const saved = await ports.store.update(shopId, i.id, { state: foldState(i.platforms, results, 'failed'), results, error: 'Alpha lost track of this post while it was going out. Check the apps before trying again.' }, ['posting'])
    if (saved) n += 1
  }
  return n
}

export async function runShop(ports: PostPorts, shopId: string): Promise<RunSummary> {
  const settings = await ports.store.settings(shopId)
  const out: RunSummary = { mode: settings.mode, prepared: 0, posted: 0, cancelled: 0, held: 0, notes: [] }
  const released = await recoverStuck(ports, shopId)
  if (released) out.notes.push(`${released} ${released === 1 ? 'post was' : 'posts were'} stuck while going out. Check ${released === 1 ? 'it' : 'them'} in the queue.`)
  if (settings.mode === 'off') { out.notes.push('Posts are off, so nothing was prepared or sent.'); return out }

  let items = await ports.store.list(shopId)

  // 1. A post whose customer took the yes back never goes out.
  for (const i of items.filter(x => x.job_id && OPEN_STATES.includes(x.state))) {
    if ((await ports.store.permission(shopId, i.job_id as string)) === true) continue
    const saved = await ports.store.update(shopId, i.id, { state: 'cancelled', error: 'The customer’s yes to a post about this job could not be confirmed, so the post was cancelled.' }, OPEN_STATES)
    if (saved) out.cancelled += 1
  }
  if (out.cancelled) items = await ports.store.list(shopId)

  // 2. Prepare posts from finished jobs: only jobs with the customer's yes and photos the owner already cleared.
  const waiting = items.filter(i => i.made_by === 'alpha' && OPEN_STATES.includes(i.state)).length
  const room = Math.max(0, Math.min(PREPARE_PER_RUN, MAX_WAITING - waiting))
  if (settings.platforms.length === 0) out.notes.push('Choose where posts go before Alpha can prepare any.')
  else if (room > 0) {
    const have = new Set(items.filter(i => i.job_id).map(i => i.job_id as string))
    const since = ports.now() - LOOKBACK_DAYS * 86_400_000
    for (const jobId of await ports.candidateJobs(shopId, since, 20)) {
      if (out.prepared >= room) break
      if (have.has(jobId)) continue
      have.add(jobId)
      const made = await prepareJobItem(ports, shopId, jobId, { madeBy: 'alpha', userId: null, platforms: settings.platforms, holdForAuto: settings.mode === 'auto' })
      if (made.ok) out.prepared += 1
    }
  } else if (waiting >= MAX_WAITING) out.notes.push(`${waiting} posts are already waiting for you, so Alpha did not prepare more.`)

  // 3. Send. Auto sends Alpha's own ready posts inside the limit; posts the owner scheduled go out when due (a cleared yes is read again).
  items = await ports.store.list(shopId)
  const now = ports.now()
  let used = usedThisWeek(items, now)
  const conns = await ports.connections(shopId)
  let sent = 0

  for (const i of items.filter(x => x.state === 'scheduled' && x.post_at && Date.parse(x.post_at) <= now).sort((a, b) => Date.parse(a.post_at as string) - Date.parse(b.post_at as string))) {
    if (sent >= SEND_PER_RUN) { out.held += 1; continue }
    const refused = await ruleCheck(ports, shopId, i, true)
    if (refused) {
      await ports.store.update(shopId, i.id, { state: 'needs_review', error: refused.error, post_at: null }, ['scheduled'])
      out.held += 1
      continue
    }
    const r = await sendItem(ports, shopId, i, i.decided_by ?? 'owner', i.approved_by)
    sent += 1
    if (r.ok) { out.posted += 1; used += 1 }
  }

  if (settings.mode === 'auto') {
    for (const i of items.filter(x => x.state === 'ready' && x.made_by === 'alpha').sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))) {
      if (sent >= SEND_PER_RUN) { out.held += 1; continue }
      const permission = i.job_id ? await ports.store.permission(shopId, i.job_id) : null
      const finished = i.job_id ? await ports.jobFinished(shopId, i.job_id) : false
      const d = autoDecision({ settings, item: i, permission, jobFinished: finished, connected: conns, used, now })
      if (!d.ok) { out.held += 1; if (out.notes.length < 3) out.notes.push(d.reasons[0]); continue }
      // Only the places Auto may use: the item is sent with exactly those.
      const trimmed = d.platforms.length === i.platforms.length ? i : (await ports.store.update(shopId, i.id, { platforms: d.platforms }, ['ready'])) ?? i
      const r = await sendItem(ports, shopId, trimmed, 'auto', null)
      sent += 1
      if (r.ok) { out.posted += 1; used += 1 } else out.held += 1
    }
  }
  return out
}

/* ---------- numbers the platforms reported ---------- */

export async function refreshNumbers(ports: PostPorts, shopId: string): Promise<Outcome<{ updated: number }>> {
  if (!ports.numbers) return { ok: true, message: 'The connected apps did not report numbers.', updated: 0 }
  const since = ports.now() - 45 * 86_400_000
  const posted = (await ports.store.list(shopId)).filter(i => (i.state === 'posted' || i.state === 'partly_posted') && i.posted_at && Date.parse(i.posted_at) >= since)
  if (posted.length === 0) return { ok: true, message: 'No recent posts to check.', updated: 0 }
  const got = await ports.numbers(shopId, posted)
  let updated = 0
  for (const i of posted) {
    const m = got[i.id]
    if (!m || Object.keys(m).length === 0) continue
    const saved = await ports.store.update(shopId, i.id, { metrics: { ...i.metrics, ...m } }, ['posted', 'partly_posted'])
    if (saved) updated += 1
  }
  return { ok: true, message: updated ? `Numbers updated for ${updated} ${updated === 1 ? 'post' : 'posts'}.` : 'The apps did not report numbers for these posts.', updated }
}
