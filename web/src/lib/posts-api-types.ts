// The shapes of the repair-post routes, shared by the server, the Growth screen and Ask Alpha.
// Types, plus the list of tools Ask Alpha uses. Nothing here runs.
//
//   GET  /api/growth/post-queue                   -> PostOverview
//   POST /api/growth/post-queue   { action, ... } -> PostActionResponse
//   GET  /api/growth/post-photos                  -> JobListResponse
//   GET  /api/growth/post-photos?job_id=<id>      -> JobPhotosResponse
//   GET  /api/growth/post-photos?job_id=<id>&brief=1 -> JobBriefResponse
//   POST /api/growth/post-photos  (multipart)     -> CheckedPhotoResponse
//
// Ask Alpha: see ASK_ALPHA_TOOLS at the bottom. It calls the same route, with `x-ai-source: ai` on every request and
// `x-ai-approval: confirm` only after the owner said yes in the chat.

import type { PostFacts } from './posts-facts.ts'
import type { Blocker, Connection, Lamp, PostMode, PostPhoto, PostPlatform, PostSettings, QueueRow } from './posts-rules.ts'

/* ---------- reading ---------- */

/** One post in the queue or the log, with the words the screen shows already worked out by the server. */
export interface QueueItemView extends QueueRow {
  state_lamp: Lamp
  state_word: string
  blockers: Blocker[]
  undo: { can: boolean; words: string }
  made_by_words: string
  decided_by_words: string
  results_view: Array<{ platform: PostPlatform; lamp: Lamp; word: string; can_confirm: boolean }>
  /** Picture addresses for the checked photos, good for one hour. Same order as `photos`; empty string when not available. */
  photo_urls: string[]
  /** The job's car for the heading, e.g. "2018 Toyota Camry". Empty for a post made from a device photo. */
  title: string
}

export interface PostOverview {
  ok: true
  /** False when the database update for repair posts has not been applied. The screen then says so in plain words. */
  available: boolean
  can_edit: boolean
  settings: PostSettings
  used_this_week: number
  posts_this_month: number
  /** Whether each place can post right now. */
  connections: Record<PostPlatform, Connection>
  items: QueueItemView[]
  /** Plain sentences about anything the owner should know (for example "Auto cannot run until a Page is connected"). */
  notes: string[]
}

export interface JobSummary {
  job_id: string
  title: string
  /** The customer's name, for the owner's screen only. It never goes into a post. */
  customer: string
  status: string
  finished: boolean
  customer_ok: boolean
  /** Null when the database update is missing and the answer cannot be read. */
  customer_ok_known: boolean
  photo_count: number
  cleared_count: number
  heard_from: string
  open_item_id: string | null
  updated_at: string
}

export interface JobListResponse { ok: true; available: boolean; jobs: JobSummary[] }

/** GET /api/growth/post-photos?job_id=<id>&brief=1 : just the job's posting facts, for the card on the job screen. */
export interface JobBriefResponse { ok: true; available: boolean; can_edit: boolean; job: JobSummary }

export interface JobPhoto {
  ref: string
  label: string
  /** A picture address good for one hour, for showing the photo. Empty when it could not be made. */
  url: string
  rating: 'green' | 'yellow' | 'red' | null
  /** Set when the owner already checked this photo and a cleaned copy exists. */
  cleared: { path: string; covered: boolean; url: string } | null
  proposed: boolean
  reason: string
}

export interface JobPhotosResponse {
  ok: true
  available: boolean
  job: JobSummary
  photos: JobPhoto[]
  proposal_note: string
  /** What the caption would say from the job record, so the owner sees the facts before anything is posted. */
  facts: PostFacts | null
  caption: string
  caption_flags: string[]
  problems: string[]
  ai_used: boolean
}

export interface CheckedPhotoResponse { ok: true; path: string; url: string; removed: string[] }

/* ---------- acting ---------- */

export type PostAction =
  | { action: 'set_settings'; mode?: PostMode; weekly_cap?: number; platforms?: PostPlatform[]; confirm_auto?: boolean }
  | { action: 'prepare_job'; job_id: string; platforms?: PostPlatform[] }
  | { action: 'create'; job_id?: string | null; photos: PostPhoto[]; caption?: string; platforms: PostPlatform[] }
  | { action: 'edit'; id: string; caption?: string; photos?: PostPhoto[]; platforms?: PostPlatform[] }
  | { action: 'approve'; id: string; accept_flags?: boolean; post_at?: string | null }
  | { action: 'skip'; id: string }
  | { action: 'retry'; id: string }
  | { action: 'confirm_outcome'; id: string; platform: PostPlatform; outcome: 'posted' | 'not_posted' }
  | { action: 'set_permission'; job_id: string; ok: boolean; note?: string }
  | { action: 'unclear'; job_id: string; ref: string }
  | { action: 'set_heard_from'; job_id: string; heard_from: string }
  | { action: 'refresh_numbers' }
  | { action: 'run_due' }

export type PostActionName = PostAction['action']

export interface PostActionOk {
  ok: true
  /** One plain sentence about what happened, safe to show as it is. */
  message: string
  item?: QueueItemView
  settings?: PostSettings
  job?: JobSummary
  /** Only for run_due. */
  run?: RunSummary
}

export interface PostActionFail {
  ok: false
  /** A plain sentence for the person. */
  error: string
  code?: PostErrorCode
  needs_database_update?: boolean
  blockers?: Blocker[]
  item?: QueueItemView
}

export type PostActionResponse = PostActionOk | PostActionFail

export type PostErrorCode =
  | 'no_permission' | 'permission_unknown' | 'blocked' | 'flags' | 'not_connected' | 'busy' | 'not_found' | 'wrong_state'
  | 'bad_request' | 'limit' | 'forbidden' | 'needs_owner' | 'confirm_auto' | 'database' | 'not_enough'

export interface RunSummary {
  mode: PostMode
  prepared: number
  posted: number
  cancelled: number
  held: number
  notes: string[]
}

/* ---------- Ask Alpha ---------- */

export interface AskAlphaTool {
  /** The tool name Ask Alpha lists. */
  name: string
  /** The method and route it calls. */
  call: string
  /** The JSON body (for POST) or query string (for GET). */
  input: string
  /** What comes back, in terms of the types above. */
  output: string
  /** What Ask Alpha must do first. */
  rule: string
}

export const ASK_ALPHA_TOOLS: readonly AskAlphaTool[] = [
  { name: 'posts_status', call: 'GET /api/growth/post-queue', input: 'none', output: 'PostOverview: settings, the weekly count, connections, and every post with its state in words', rule: 'Read only. Use it to answer "what is waiting", "what went out" and "is Auto on".' },
  { name: 'posts_jobs', call: 'GET /api/growth/post-photos', input: 'none', output: 'JobListResponse: recent jobs, whether the customer said yes, and how many photos are cleared', rule: 'Read only.' },
  { name: 'posts_job', call: 'GET /api/growth/post-photos?job_id=<id>&brief=1', input: 'job_id', output: 'JobBriefResponse: whether the customer said yes, the photo count, any waiting post', rule: 'Read only. Cheap: no photos are signed and no AI is called.' },
  { name: 'posts_photos', call: 'GET /api/growth/post-photos?job_id=<id>', input: 'job_id', output: 'JobPhotosResponse: the job’s photos, Alpha’s picks with reasons, the facts and the caption it would use', rule: 'Read only. Never add &ai=1 unless the owner asked Alpha to choose again.' },
  { name: 'posts_customer_ok_off', call: 'POST /api/growth/post-queue', input: '{ "action": "set_permission", "job_id": string, "ok": false }', output: 'PostActionResponse with job; waiting posts for that job are cancelled', rule: 'Only taking the customer’s yes away is allowed. Recording a yes is refused: the owner does that on the job.' },
  { name: 'posts_prepare', call: 'POST /api/growth/post-queue', input: '{ "action": "prepare_job", "job_id": string }', output: 'PostActionResponse with the new item, or a plain reason it cannot be made', rule: 'Makes a post for the owner to look at. It posts nothing. It is refused without the customer’s yes.' },
  { name: 'posts_approve', call: 'POST /api/growth/post-queue', input: '{ "action": "approve", "id": string }', output: 'PostActionResponse with the item and where it posted', rule: 'Sends it to the public. Ask the owner first, show the photos and words, and send header x-ai-approval: confirm only after they say yes.' },
  { name: 'posts_skip', call: 'POST /api/growth/post-queue', input: '{ "action": "skip", "id": string }', output: 'PostActionResponse', rule: 'Safe. Nothing is posted.' },
  { name: 'posts_set_mode', call: 'POST /api/growth/post-queue', input: '{ "action": "set_settings", "mode": "off" | "suggest", "weekly_cap"?: number }', output: 'PostActionResponse with settings', rule: 'Ask Alpha can turn posts Off or to Suggest. It cannot turn Auto on: the route refuses and tells the owner to do it on the Posts screen.' },
]
