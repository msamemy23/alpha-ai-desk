// Sends a repair post through the existing connector routes (/api/connectors/facebook, /instagram, /google-business), which keep
// their own durable record of every call (lib/social-operation.ts). This file never talks to Facebook, Instagram or Google itself.
//
// It signs the cleaned photos, builds one request per place, and turns each answer into a result that says only what is known:
// "posted" needs the connector's own yes and the platform's id; anything unclear is "unknown".

import type { SupabaseClient } from '@supabase/supabase-js'
import { CONNECTOR_OF, POST_PLATFORMS } from '@/lib/posts-rules'
import type { Connection, PlatformResult, PostMetrics, PostPlatform } from '@/lib/posts-rules'
import { cannotPost, connectorPath, connectorReady, connectorRequest, noAnswer, numbersFrom, parseConnectorResult } from '@/lib/posts-connector'
import type { PostPorts } from '@/lib/posts-engine'
import { postUrls } from '@/lib/posts-source'

type Fetch = typeof fetch

export interface PublisherOptions {
  db: SupabaseClient
  /** The address of this app, so the connector routes are called as the app itself. */
  origin: string
  /** How the connector routes will know who is asking: the signed-in person's cookie, or the scheduled run's secret. */
  authHeaders: Record<string, string>
  fetchImpl?: Fetch
  now?: () => number
}

const CALL_MS = 50_000

/** Whether each place can post right now, from the shop's connected apps. Reads only; the secrets never leave the server. */
export async function readConnections(db: SupabaseClient, shopId: string): Promise<Record<PostPlatform, Connection>> {
  const out: Record<PostPlatform, Connection> = { facebook: 'unknown', instagram: 'unknown', google: 'unknown' }
  const { data, error } = await db.from('connectors').select('service,enabled,page_id,page_access_token,access_token,refresh_token').eq('shop_id', shopId).in('service', POST_PLATFORMS.map(p => CONNECTOR_OF[p]))
  if (error) return out
  for (const p of POST_PLATFORMS) {
    const row = (data || []).find(r => (r as { service?: unknown }).service === CONNECTOR_OF[p])
    out[p] = connectorReady(p, row as Parameters<typeof connectorReady>[1]) ? 'connected' : 'not_connected'
  }
  return out
}

export function createPublisher(opts: PublisherOptions): Pick<PostPorts, 'connections' | 'publish' | 'numbers'> {
  const f: Fetch = opts.fetchImpl ?? fetch
  const clock = opts.now ?? Date.now

  async function call(path: string, body: Record<string, unknown>, key: string | null): Promise<{ status: number; json: unknown }> {
    const res = await f(`${opts.origin}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}), ...opts.authHeaders },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CALL_MS),
      cache: 'no-store',
    })
    return { status: res.status, json: await res.json().catch(() => null) }
  }

  return {
    connections: shopId => readConnections(opts.db, shopId),

    async publish(shopId, item, platforms) {
      const at = new Date(clock()).toISOString()
      const paths = item.photos.map(p => p.path).filter((p): p is string => Boolean(p))
      const signed = await postUrls(opts.db, paths)
      const photoUrls = paths.map(p => signed.get(p)).filter((u): u is string => Boolean(u))
      // A photo that cannot be signed means the post would go out short of what the owner approved: nothing is sent.
      if (photoUrls.length !== paths.length || paths.length !== item.photos.length) {
        return platforms.map(platform => ({ platform, status: 'failed' as const, error: 'The photos could not be prepared, so nothing was sent.', at }))
      }
      const results: PlatformResult[] = []
      for (const platform of platforms) {
        const stop = cannotPost(platform, photoUrls.length)
        if (stop) { results.push({ platform, status: 'failed', error: stop, at }); continue }
        const req = connectorRequest(platform, { itemId: item.id, attempt: item.attempt, shopId, caption: item.caption, photoUrls })
        try {
          const { status, json } = await call(req.path, req.body, req.key)
          results.push(parseConnectorResult(platform, status, json, new Date(clock()).toISOString()))
        } catch (e) {
          // The request may have reached the connector before it stopped, so this is never reported as a failure.
          results.push(noAnswer(platform, e instanceof Error && e.name === 'TimeoutError' ? 'The request took too long.' : 'The request did not finish.', new Date(clock()).toISOString()))
        }
      }
      return results
    },

    async numbers(shopId, items) {
      const out: Record<string, Partial<Record<PostPlatform, PostMetrics>>> = {}
      for (const platform of ['facebook', 'instagram'] as const) {
        const ids = new Map<string, string>()
        for (const i of items) {
          const r = i.results.find(x => x.platform === platform && x.status === 'posted' && x.id)
          if (r?.id) ids.set(r.id, i.id)
        }
        if (ids.size === 0) continue
        try {
          const { status, json } = await call(connectorPath(platform), { action: 'get_posts', shop_id: shopId }, null)
          if (status < 200 || status >= 300) continue
          const found = numbersFrom(platform, json, [...ids.keys()], new Date(clock()).toISOString())
          for (const [postId, metrics] of Object.entries(found)) {
            const itemId = ids.get(postId)
            if (itemId) out[itemId] = { ...out[itemId], [platform]: metrics }
          }
        } catch { /* the app did not answer: nothing is recorded */ }
      }
      return out
    },
  }
}

/** Headers that tell the connector routes who is asking. A scheduled run presents the deployment secret; a person's request forwards their session. */
export function forwardAuth(req: Request, internal: boolean): Record<string, string> {
  if (internal) return { authorization: req.headers.get('authorization') || '' }
  const out: Record<string, string> = {}
  const cookie = req.headers.get('cookie')
  const auth = req.headers.get('authorization')
  if (cookie) out.cookie = cookie
  if (auth) out.authorization = auth
  return out
}
