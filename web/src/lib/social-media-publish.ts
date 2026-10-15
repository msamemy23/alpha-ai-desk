// Several photos in one social post, for the connector routes. A single photo keeps working exactly as before; these helpers
// are only used when a request carries more than one picture.
//
//   Facebook   each photo is uploaded unpublished, then one post attaches them all.
//   Instagram  each photo becomes a carousel item, then one carousel container is published by the route's existing step.
//   Google     a standard post carries one photo, so the first is used.
//
// The `fetch` is passed in so tests can answer it. Nothing here reads the database or knows about shops.

export type Fetcher = (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export interface ProviderResult { ok: boolean; status: number; data: Record<string, unknown> }

export const MAX_POST_PHOTOS = 10

/** Photo addresses from a request: https only, no repeats, at most ten. */
export function cleanMediaUrls(many: unknown, one?: unknown): string[] {
  const raw: unknown[] = Array.isArray(many) ? [...many] : []
  if (typeof one === 'string' && one) raw.unshift(one)
  const out: string[] = []
  for (const v of raw) {
    if (typeof v !== 'string') continue
    const url = v.trim()
    if (!/^https:\/\/[^\s]+$/i.test(url) || url.length > 2000 || out.includes(url)) continue
    out.push(url)
    if (out.length >= MAX_POST_PHOTOS) break
  }
  return out
}

const asData = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})

async function postJson(f: Fetcher, url: string, payload: Record<string, unknown>): Promise<ProviderResult> {
  const r = await f(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  const data = asData(await r.json().catch(() => ({})))
  return { ok: r.ok && !data.error, status: r.status, data }
}

/**
 * One Facebook post with several photos. Photos that were uploaded but never attached stay unpublished, so a failure part
 * of the way through leaves nothing public.
 */
export async function fbPostWithPhotos(f: Fetcher, base: string, targetId: string, token: string, message: string, urls: string[]): Promise<ProviderResult> {
  const ids: string[] = []
  for (const url of urls) {
    const up = await postJson(f, `${base}/${targetId}/photos`, { url, published: false, access_token: token })
    const id = up.data.id
    if (!up.ok || (typeof id !== 'string' && typeof id !== 'number')) return { ok: false, status: up.ok ? 502 : up.status, data: { ...up.data, uploaded: ids.length, failed_at: ids.length + 1 } }
    ids.push(String(id))
  }
  return postJson(f, `${base}/${targetId}/feed`, { message, attached_media: ids.map(media_fbid => ({ media_fbid })), access_token: token })
}

/** The first step of an Instagram carousel: one container holding every photo. The route then publishes it as it does for one photo. */
export async function igCreateCarousel(f: Fetcher, base: string, igId: string, token: string, caption: string, urls: string[]): Promise<ProviderResult> {
  const children: string[] = []
  for (const image_url of urls) {
    const item = await postJson(f, `${base}/${igId}/media`, { image_url, is_carousel_item: true, access_token: token })
    const id = item.data.id
    if (!item.ok || typeof id !== 'string') return { ok: false, status: item.ok ? 502 : item.status, data: { ...item.data, items_made: children.length } }
    children.push(id)
  }
  return postJson(f, `${base}/${igId}/media`, { media_type: 'CAROUSEL', children, caption, access_token: token })
}

/** A Google Business post with a photo. Standard posts take one. */
export function googleMedia(urls: readonly string[]): Array<{ mediaFormat: 'PHOTO'; sourceUrl: string }> | undefined {
  return urls.length ? [{ mediaFormat: 'PHOTO', sourceUrl: urls[0] }] : undefined
}
