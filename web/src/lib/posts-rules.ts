// The rules for repair posts, as plain functions with no database and no network: the three modes, what a queued post is,
// what stops it from going out, when Auto may post without a tap, the weekly limit, and what can be undone.
// The screen and the server both ask these functions, so they can never disagree.
//
// Pure: relative imports only, so the tests load this file straight from disk.

import { DEFAULT_TIMEZONE } from './automation-rules.ts'
import { captionLimit } from './posts-facts.ts'
import type { PostFacts } from './posts-facts.ts'

/* ---------- places a post can go ---------- */

export const POST_PLATFORMS = ['facebook', 'instagram', 'google'] as const
export type PostPlatform = (typeof POST_PLATFORMS)[number]

export const PLATFORM_LABEL: Record<PostPlatform, string> = { facebook: 'Facebook', instagram: 'Instagram', google: 'Google Business Profile' }

/** The name the connector routes and the connectors table use. */
export const CONNECTOR_OF: Record<PostPlatform, 'facebook' | 'instagram' | 'google_business'> = { facebook: 'facebook', instagram: 'instagram', google: 'google_business' }

export const isPlatform = (v: unknown): v is PostPlatform => (POST_PLATFORMS as readonly unknown[]).includes(v)

export function cleanPlatforms(raw: unknown): PostPlatform[] {
  if (!Array.isArray(raw)) return []
  const out: PostPlatform[] = []
  for (const v of raw) if (isPlatform(v) && !out.includes(v)) out.push(v)
  return out
}

export type Connection = 'connected' | 'not_connected' | 'unknown'

/* ---------- Off, Suggest, Auto ---------- */

export type PostMode = 'off' | 'suggest' | 'auto'
export const POST_MODES: readonly PostMode[] = ['off', 'suggest', 'auto']

export interface PostSettings { mode: PostMode; weeklyCap: number; platforms: PostPlatform[] }

export const MIN_CAP = 1
export const MAX_CAP = 14
export const DEFAULT_POST_SETTINGS: PostSettings = { mode: 'off', weeklyCap: 3, platforms: [] }

export function cleanSettings(raw: unknown): PostSettings {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const mode = POST_MODES.includes(o.mode as PostMode) ? (o.mode as PostMode) : DEFAULT_POST_SETTINGS.mode
  const cap = Math.round(Number(o.weeklyCap ?? o.weekly_cap))
  return {
    mode,
    weeklyCap: Number.isFinite(cap) ? Math.min(MAX_CAP, Math.max(MIN_CAP, cap)) : DEFAULT_POST_SETTINGS.weeklyCap,
    platforms: cleanPlatforms(o.platforms),
  }
}

export const MODE_WORDS: Record<PostMode, { word: string; lamp: 'off' | 'amber' | 'green'; help: string }> = {
  off: { word: 'Off', lamp: 'off', help: 'Alpha does not prepare or post anything by itself. You can still make a post from a job whenever you like.' },
  suggest: { word: 'Suggest', lamp: 'amber', help: 'Alpha prepares posts from finished jobs where the customer said yes. Each one waits for you to check the photos and tap Post.' },
  auto: { word: 'Auto', lamp: 'green', help: 'Alpha posts on its own, but only jobs where the customer said yes, only photos you already checked, only to apps you connected, and never more than your weekly limit. Each post waits in the queue for a review window first.' },
}

export type ModeChange = { mode: PostMode; changed: boolean; needsConfirm: boolean; note: string }

/**
 * What happens when someone asks for a mode. Anything that reaches the public starts in Suggest: asking for Auto from Off
 * lands in Suggest, and going from Suggest to Auto needs a clear yes (`confirmAuto`).
 */
export function resolveMode(current: PostMode, wanted: unknown, confirmAuto: boolean): ModeChange {
  if (!POST_MODES.includes(wanted as PostMode)) return { mode: current, changed: false, needsConfirm: false, note: '' }
  const want = wanted as PostMode
  if (want === 'auto') {
    if (current === 'auto') return { mode: 'auto', changed: false, needsConfirm: false, note: '' }
    if (current === 'off') return { mode: 'suggest', changed: true, needsConfirm: false, note: 'Posts start in Suggest. Check and approve a few, then switch to Auto.' }
    if (!confirmAuto) return { mode: 'suggest', changed: false, needsConfirm: true, note: 'Auto needs your yes first.' }
    return { mode: 'auto', changed: true, needsConfirm: false, note: '' }
  }
  return { mode: want, changed: want !== current, needsConfirm: false, note: '' }
}

/* ---------- the queue ---------- */

export type ItemState = 'needs_review' | 'ready' | 'scheduled' | 'posting' | 'posted' | 'partly_posted' | 'failed' | 'skipped' | 'cancelled'
export const ACTIVE_STATES: readonly ItemState[] = ['needs_review', 'ready', 'scheduled', 'posting']
export const OPEN_STATES: readonly ItemState[] = ['needs_review', 'ready', 'scheduled']
export const POSTED_STATES: readonly ItemState[] = ['posted', 'partly_posted']

/** Who made the post: the owner by hand, Alpha when it prepared one, Ask Alpha when the owner asked for it. */
export type MadeBy = 'owner' | 'alpha' | 'ask_alpha'
/** Who sent it out: the owner's tap, Auto by rule, or Ask Alpha after the owner approved. */
export type DecidedBy = 'owner' | 'auto' | 'ask_alpha'
export type ItemSource = 'job' | 'device'

export interface PostPhoto {
  /** The inspection picture this came from: `storage:<id>/<file>.jpg`. Null for a picture from the owner's device. */
  ref: string | null
  /** The checked copy in the post-media bucket: `<shop id>/<name>.jpg`. Null until the owner has checked the photo. */
  path: string | null
  covered: boolean
  label: string
}

export interface PlatformResult {
  platform: PostPlatform
  status: 'posted' | 'failed' | 'not_connected' | 'skipped' | 'unknown'
  /** The platform's id for the post, when it gave one. */
  id?: string | null
  error?: string | null
  at?: string
}

export interface PostMetrics { likes: number | null; comments: number | null; checked_at: string }

export interface QueueRow {
  id: string
  shop_id: string
  job_id: string | null
  source: ItemSource
  state: ItemState
  caption: string
  facts: PostFacts | null
  photos: PostPhoto[]
  platforms: PostPlatform[]
  flags: string[]
  made_by: MadeBy
  photos_checked_at: string | null
  photos_checked_by: string | null
  approved_by: string | null
  approved_at: string | null
  decided_by: DecidedBy | null
  post_at: string | null
  hold_until: string | null
  attempt: number
  results: PlatformResult[]
  metrics: Partial<Record<PostPlatform, PostMetrics>>
  error: string | null
  posted_at: string | null
  created_by: string | null
  created_at: string
  updated_at: string
}

export const MAX_ITEM_PHOTOS = 10
export const MAX_CAPTION = 5000
/** Alpha-made posts wait this long in the queue before Auto may send them, so the owner always gets a look first. */
export const HOLD_HOURS = 12
/** Alpha does not pile up more than this many posts waiting for a look. */
export const MAX_WAITING = 3
export const WEEK_MS = 7 * 86_400_000

export const photosChecked = (photos: readonly PostPhoto[]): boolean => photos.length > 0 && photos.every(p => Boolean(p.path))
export const uncheckedCount = (photos: readonly PostPhoto[]): number => photos.filter(p => !p.path).length

export type Blocker = { code: 'no_permission' | 'permission_unknown' | 'no_photos' | 'photos_unchecked' | 'no_caption' | 'caption_flags' | 'no_platform' | 'too_long'; words: string }

export interface BlockerContext {
  /** Whether the customer said yes to a post about this job. Null when that could not be read (the database update is missing). */
  permission: boolean | null
}

/** Everything that stops a post from going out, in plain words. Empty means it can. Wording flags are listed apart (the owner may accept them). */
export function blockers(item: Pick<QueueRow, 'source' | 'job_id' | 'caption' | 'photos' | 'platforms'>, ctx: BlockerContext): Blocker[] {
  const out: Blocker[] = []
  if (item.source === 'job' || item.job_id) {
    if (ctx.permission === null) out.push({ code: 'permission_unknown', words: 'Alpha cannot tell whether the customer said yes, because the database update for repair posts has not been applied.' })
    else if (!ctx.permission) out.push({ code: 'no_permission', words: 'The customer has not said yes to a post about this job. Turn on Customer OK to post on the job once they have.' })
  }
  if (item.photos.length === 0) out.push({ code: 'no_photos', words: 'Add at least one photo.' })
  else if (!photosChecked(item.photos)) {
    const n = uncheckedCount(item.photos)
    out.push({ code: 'photos_unchecked', words: `${n} ${n === 1 ? 'photo still needs' : 'photos still need'} your check for license plates, VINs and anything else private.` })
  }
  if (!item.caption.trim()) out.push({ code: 'no_caption', words: 'The post has no words yet.' })
  if (item.platforms.length === 0) out.push({ code: 'no_platform', words: 'Choose where the post goes.' })
  else if (item.caption.trim()) {
    const limit = captionLimit(item.platforms)
    const len = [...item.caption].length
    if (len > limit) out.push({ code: 'too_long', words: `The words are ${len.toLocaleString('en-US')} characters. The places you chose take up to ${limit.toLocaleString('en-US')}.` })
  }
  return out
}

/** Places the post can actually go right now: chosen, and connected. */
export function reachable(platforms: readonly PostPlatform[], connected: Partial<Record<PostPlatform, Connection>>): PostPlatform[] {
  return platforms.filter(p => connected[p] === 'connected')
}

/* ---------- the weekly limit ---------- */

const stamp = (row: Pick<QueueRow, 'posted_at' | 'updated_at'>): number => {
  const t = Date.parse(row.posted_at || row.updated_at)
  return Number.isFinite(t) ? t : 0
}

/** Posts that went out (or are going out) in the last seven days, from any mode. */
export function usedThisWeek(rows: readonly Pick<QueueRow, 'state' | 'posted_at' | 'updated_at'>[], now: number): number {
  return rows.filter(r => (r.state === 'posted' || r.state === 'partly_posted' || r.state === 'posting') && now - stamp(r) < WEEK_MS && now - stamp(r) >= -60_000).length
}

/** "2026-10" for the shop's own calendar month. */
export function monthKey(ms: number, timeZone = DEFAULT_TIMEZONE): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit' }).format(new Date(ms))
}

export function postsThisMonth(rows: readonly Pick<QueueRow, 'state' | 'posted_at'>[], now: number, timeZone = DEFAULT_TIMEZONE): number {
  const key = monthKey(now, timeZone)
  return rows.filter(r => POSTED_STATES.includes(r.state) && r.posted_at && monthKey(Date.parse(r.posted_at), timeZone) === key).length
}

/* ---------- when Auto may post ---------- */

export interface AutoContext {
  settings: PostSettings
  item: QueueRow
  /** The customer's yes, read fresh just now. Null when it could not be read. */
  permission: boolean | null
  jobFinished: boolean
  connected: Partial<Record<PostPlatform, Connection>>
  used: number
  now: number
}

export interface AutoDecision { ok: boolean; reasons: string[]; platforms: PostPlatform[] }

/**
 * Whether Alpha may send this post with no tap. Every one of these must hold: Auto is on, the post was prepared by Alpha
 * from a finished job, the customer said yes, every photo was checked by the owner, the words pass the checker, at least one
 * chosen app is connected, the review window has passed, and the weekly limit has room.
 */
export function autoDecision(ctx: AutoContext): AutoDecision {
  const { settings, item } = ctx
  const reasons: string[] = []
  if (settings.mode !== 'auto') reasons.push('Auto is not turned on.')
  if (item.state !== 'ready') reasons.push('The post is not ready.')
  if (item.made_by !== 'alpha') reasons.push('Posts you made yourself wait for your tap.')
  if (item.source !== 'job' || !item.job_id) reasons.push('Only posts about a finished job go out on their own.')
  else if (!ctx.jobFinished) reasons.push('The job is not finished yet.')
  for (const b of blockers(item, { permission: ctx.permission })) reasons.push(b.words)
  if (item.flags.length > 0) reasons.push('The wording needs your look first.')
  const platforms = reachable(item.platforms.filter(p => settings.platforms.includes(p)), ctx.connected)
  if (platforms.length === 0) reasons.push('None of the chosen apps is connected.')
  if (item.hold_until && ctx.now < Date.parse(item.hold_until)) reasons.push('It is still in the review window, so you get a look first.')
  if (ctx.used >= settings.weeklyCap) reasons.push(`This week’s limit of ${settings.weeklyCap} ${settings.weeklyCap === 1 ? 'post' : 'posts'} is used.`)
  return { ok: reasons.length === 0, reasons: [...new Set(reasons)], platforms }
}

export const holdUntil = (now: number): string => new Date(now + HOLD_HOURS * 3_600_000).toISOString()

/* ---------- words for the screen ---------- */

export type Lamp = 'green' | 'amber' | 'red' | 'blue' | 'off'

export function stateWords(item: Pick<QueueRow, 'state' | 'post_at'>, mode: PostMode): { lamp: Lamp; word: string } {
  switch (item.state) {
    case 'needs_review': return { lamp: 'amber', word: 'Needs your check' }
    case 'ready': return { lamp: 'green', word: mode === 'auto' ? 'Ready, waiting for the review window' : 'Ready for your OK' }
    case 'scheduled': return { lamp: 'blue', word: mode === 'off' ? 'Scheduled, paused while posts are off' : 'Scheduled' }
    case 'posting': return { lamp: 'blue', word: 'Posting now' }
    case 'posted': return { lamp: 'green', word: 'Posted' }
    case 'partly_posted': return { lamp: 'amber', word: 'Posted to some places only' }
    case 'failed': return { lamp: 'red', word: 'Did not post' }
    case 'skipped': return { lamp: 'off', word: 'Skipped' }
    default: return { lamp: 'off', word: 'Cancelled' }
  }
}

export function resultWords(r: PlatformResult): { lamp: Lamp; word: string } {
  const place = PLATFORM_LABEL[r.platform]
  switch (r.status) {
    case 'posted': return { lamp: 'green', word: `Posted to ${place}` }
    case 'not_connected': return { lamp: 'amber', word: `${place}: Not connected` }
    case 'skipped': return { lamp: 'off', word: `${place}: Skipped${r.error ? `. ${r.error}` : ''}` }
    case 'unknown': return { lamp: 'amber', word: `${place}: Alpha could not confirm whether it posted. Check ${place} before trying again.` }
    default: return { lamp: 'red', word: `${place}: Did not post${r.error ? `. ${r.error}` : ''}` }
  }
}

export function madeByWords(by: MadeBy): string {
  return by === 'alpha' ? 'Prepared by Alpha' : by === 'ask_alpha' ? 'Made by Ask Alpha' : 'Made by you'
}

export function decidedByWords(by: DecidedBy | null): string {
  return by === 'auto' ? 'Sent automatically by your Auto rules' : by === 'ask_alpha' ? 'Sent by Ask Alpha after you approved it' : by === 'owner' ? 'Sent after you approved it' : ''
}

const TAKE_DOWN: Record<PostPlatform, string> = {
  facebook: 'Alpha cannot take a Facebook post down. Open your Page on Facebook, find the post and delete it there.',
  instagram: 'Instagram does not let apps delete posts. Open the post in the Instagram app and delete it there.',
  google: 'Alpha cannot take a Google post down. Open your Business Profile on Google, find the post and delete it there.',
}

/** Undo, or an honest "cannot be undone". */
export function undoInfo(item: Pick<QueueRow, 'state' | 'results' | 'platforms'>): { can: boolean; words: string } {
  switch (item.state) {
    case 'needs_review':
    case 'ready': return { can: true, words: 'Nothing has been posted. Skip it any time.' }
    case 'scheduled': return { can: true, words: 'Nothing has been posted yet. Cancel it any time before it goes out.' }
    case 'posting': return { can: false, words: 'It is going out now. Wait for the result.' }
    case 'posted':
    case 'partly_posted': {
      const places = [...new Set(item.results.filter(r => r.status === 'posted').map(r => r.platform))]
      return { can: false, words: `This cannot be undone from Alpha. ${places.map(p => TAKE_DOWN[p]).join(' ')}`.trim() }
    }
    case 'failed': return { can: false, words: item.results.some(r => r.status === 'unknown') ? 'Alpha could not confirm whether it reached every place. Check the apps before you try again.' : 'Nothing was posted.' }
    default: return { can: false, words: 'Nothing was posted.' }
  }
}

/** A short plain sentence about how the post stands against the weekly limit. */
export function capWords(used: number, cap: number): string {
  return `${used} of ${cap} ${cap === 1 ? 'post' : 'posts'} used in the last 7 days.`
}
