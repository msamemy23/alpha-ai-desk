// How a repair post talks to the connector routes: the request each one wants, and what its answer means.
// Pure. The server sends the requests (posts-publish.ts); this file only builds them and reads the answers, so the
// "never call an unclear answer a success" rule is covered by tests.

import { CONNECTOR_OF, PLATFORM_LABEL } from './posts-rules.ts'
import type { PlatformResult, PostPlatform } from './posts-rules.ts'

export const connectorPath = (p: PostPlatform): string => `/api/connectors/${p === 'google' ? 'google-business' : p}`

/** The one key a platform call uses. A new try gets a new number, so a failed call can be retried and a confirmed one cannot repeat. */
export const idempotencyKey = (itemId: string, platform: PostPlatform, attempt: number): string => `repair-post:${itemId}:${platform}:${attempt}`

export interface ConnectorRequest { path: string; key: string; body: Record<string, unknown> }

/** The request for one platform. Facebook always goes to the shop's Page, never to a personal profile. */
export function connectorRequest(platform: PostPlatform, input: { itemId: string; attempt: number; shopId: string; caption: string; photoUrls: string[] }): ConnectorRequest {
  const { caption, photoUrls, shopId } = input
  const key = idempotencyKey(input.itemId, platform, input.attempt)
  const path = connectorPath(platform)
  if (platform === 'facebook') {
    const media = photoUrls.length > 1 ? { photo_urls: photoUrls } : photoUrls.length === 1 ? { photo_url: photoUrls[0] } : {}
    return { path, key, body: { action: 'post', message: caption, target: 'page', ...media, shop_id: shopId } }
  }
  if (platform === 'instagram') {
    const media = photoUrls.length > 1 ? { image_urls: photoUrls } : { image_url: photoUrls[0] ?? '' }
    return { path, key, body: { action: 'post', caption, ...media, shop_id: shopId } }
  }
  return { path, key, body: { action: 'post', summary: caption, ...(photoUrls.length ? { photo_url: photoUrls[0] } : {}), shop_id: shopId } }
}

/** Whether a platform can post this at all, before any request is made. */
export function cannotPost(platform: PostPlatform, photoCount: number): string | null {
  if (platform === 'instagram' && photoCount === 0) return 'Instagram needs at least one photo.'
  return null
}

const asObject = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const text = (v: unknown): string => (typeof v === 'string' ? v : '')

/** The platform's id for the post, from the connector's answer. */
export function postedId(platform: PostPlatform, data: unknown): string | null {
  const d = asObject(data)
  const inner = asObject(d.result ?? d)
  if (platform === 'facebook') {
    const page = asObject(asObject(inner.page).data)
    const id = page.post_id ?? page.id
    return typeof id === 'string' && id ? id : null
  }
  const id = platform === 'instagram' ? inner.id : inner.name
  return typeof id === 'string' && id ? id : null
}

const UNCLEAR = /uncertain|reconcile|could not be saved|without a confirmed|in progress|different publish content|needs reconciliation/i
const RECONNECT = /not connected|reconnect|token (?:is )?missing|not configured/i

/**
 * What the connector's answer means. A post is only "posted" when the connector said ok and gave back the platform's id.
 * Anything unclear is "unknown", which the screen shows as unclear and which blocks a blind retry.
 */
export function parseConnectorResult(platform: PostPlatform, status: number, body: unknown, at: string): PlatformResult {
  const label = PLATFORM_LABEL[platform]
  const b = asObject(body)
  const error = text(b.error)
  if (status >= 200 && status < 300 && b.ok === true) {
    const id = postedId(platform, b.data)
    if (id) return { platform, status: 'posted', id, at }
    return { platform, status: 'unknown', error: `${label} accepted the request but did not return an id for the post.`, at }
  }
  // Any other answer in the 200s is not a clear yes or no.
  if (status >= 200 && status < 300) return { platform, status: 'unknown', error: `${label} gave an answer Alpha could not read.`, at }
  if (status === 401 || RECONNECT.test(error)) return { platform, status: 'not_connected', error: `${label} needs to be connected again. Open Connected apps.`, at }
  if (status === 429) return { platform, status: 'failed', error: `${label} asked to slow down. Try again later.`, at }
  if (UNCLEAR.test(error)) return { platform, status: 'unknown', error: error.slice(0, 300) || `${label} did not confirm the post.`, at }
  if (status >= 500 && !error) return { platform, status: 'unknown', error: `${label} did not answer clearly.`, at }
  return { platform, status: 'failed', error: (plainError(error) || `${label} did not accept the post.`).slice(0, 300), at }
}

/** Provider errors can arrive as JSON text; keep the readable part. */
function plainError(error: string): string {
  if (!error.startsWith('{')) return error
  try {
    const o = asObject(JSON.parse(error))
    const page = asObject(asObject(asObject(o.page).data).error)
    return text(page.message) || text(o.summary) || text(o.profile_error) || ''
  } catch {
    return ''
  }
}

/** A request that never got an answer: the post may or may not exist. */
export const noAnswer = (platform: PostPlatform, reason: string, at: string): PlatformResult =>
  ({ platform, status: 'unknown', error: `${reason} Check ${PLATFORM_LABEL[platform]} before trying again.`.slice(0, 300), at })

export const connectorName = (p: PostPlatform): string => CONNECTOR_OF[p]

/** Whether a connectors row can post: the fields each connector route needs to be present. */
export function connectorReady(platform: PostPlatform, row: { enabled?: unknown; page_id?: unknown; page_access_token?: unknown; access_token?: unknown; refresh_token?: unknown } | null | undefined): boolean {
  if (!row || row.enabled !== true) return false
  if (platform === 'facebook') return Boolean(row.page_id && row.page_access_token)
  if (platform === 'instagram') return Boolean(row.page_id && (row.access_token || row.page_access_token))
  return Boolean(row.refresh_token || row.access_token)
}

/** Numbers from a connector's `get_posts` answer, matched to the posts Alpha sent. Posts the app did not list are left out. */
export function numbersFrom(platform: PostPlatform, data: unknown, ids: readonly string[], at: string): Record<string, { likes: number | null; comments: number | null; checked_at: string }> {
  const out: Record<string, { likes: number | null; comments: number | null; checked_at: string }> = {}
  const d = asObject(data)
  const rows = Array.isArray(asObject(d.data).data) ? (asObject(d.data).data as unknown[]) : Array.isArray(d.data) ? (d.data as unknown[]) : []
  const count = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  for (const r of rows) {
    const o = asObject(r)
    const id = text(o.id)
    if (!id || !ids.includes(id)) continue
    if (platform === 'facebook') {
      out[id] = { likes: count(asObject(asObject(o.likes).summary).total_count), comments: count(asObject(asObject(o.comments).summary).total_count), checked_at: at }
    } else if (platform === 'instagram') {
      out[id] = { likes: count(o.like_count), comments: count(o.comments_count), checked_at: at }
    }
  }
  return out
}
