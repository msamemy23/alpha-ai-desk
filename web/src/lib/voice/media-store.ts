/**
 * Keeping and serving pictures and video for texts.
 *   - Inbound: the carrier hosts the file for a limited time, so a copy is kept when it is small enough.
 *   - Outbound: a staff member's picture is stored under a random link token until the carrier has fetched it.
 * Everything is limited to one shop. The only outside address ever fetched is one the carrier itself hosts.
 */
import { errKind } from './store.ts'
import type { Db } from './store.ts'
import { checkUpload, isCarrierMediaUrl, isMediaType, MAX_MEDIA_BYTES, MAX_MEDIA_PER_TEXT, newMediaToken, tokensMatch } from './media.ts'
import type { InboundMedia } from './media.ts'

export type Fetcher = (url: string, init?: { signal?: AbortSignal; redirect?: 'error' | 'manual' | 'follow' }) => Promise<{
  ok: boolean; status: number; headers: { get(name: string): string | null }; arrayBuffer(): Promise<ArrayBuffer>
}>

const toBase64 = (buf: ArrayBuffer): string => Buffer.from(buf).toString('base64')

/** Downloads one carrier-hosted file. Returns null on any problem; the link is still kept so staff can open it. */
async function download(url: string, fetcher: Fetcher): Promise<{ base64: string; bytes: number; contentType: string | null } | null> {
  try {
    const res = await fetcher(url, { signal: AbortSignal.timeout(6000), redirect: 'error' })
    if (!res.ok) return null
    const declared = Number(res.headers.get('content-length'))
    if (Number.isFinite(declared) && declared > MAX_MEDIA_BYTES) return null
    const buf = await res.arrayBuffer()
    if (buf.byteLength === 0 || buf.byteLength > MAX_MEDIA_BYTES) return null
    return { base64: toBase64(buf), bytes: buf.byteLength, contentType: res.headers.get('content-type') }
  } catch {
    return null
  }
}

export async function saveInboundMedia(db: Db, shopId: string, messageId: string, contactKey: string, media: InboundMedia[], fetcher: Fetcher): Promise<number> {
  let saved = 0
  for (const m of media.slice(0, MAX_MEDIA_PER_TEXT)) {
    if (!isCarrierMediaUrl(m.url) || !isMediaType(m.contentType)) continue
    const copy = await download(m.url, fetcher)
    const { error } = await db.from('message_media').insert({
      shop_id: shopId, message_id: messageId, direction: 'inbound', content_type: m.contentType, source_url: m.url,
      data: copy ? copy.base64 : null, size_bytes: copy ? copy.bytes : m.sizeBytes, contact_key: contactKey,
    })
    if (error) { if (errKind(error) === 'missing') return saved; continue }
    saved += 1
  }
  return saved
}

export interface MediaRef { id: string; message_id: string | null; direction: 'inbound' | 'outbound'; content_type: string; has_copy: boolean }

/** Which texts have attachments. Used by the inbox to draw them. */
export async function mediaForMessages(db: Db, shopId: string, messageIds: string[]): Promise<{ items: MediaRef[]; unavailable: boolean }> {
  const ids = Array.from(new Set(messageIds.filter(Boolean))).slice(0, 300)
  if (!ids.length) return { items: [], unavailable: false }
  const { data, error } = await db.from('message_media').select('id,message_id,direction,content_type,data,source_url').eq('shop_id', shopId).in('message_id', ids).limit(1000)
  if (error) return { items: [], unavailable: errKind(error) === 'missing' }
  const items = ((data || []) as Array<{ id: string; message_id: string | null; direction: 'inbound' | 'outbound'; content_type: string; data?: string | null; source_url?: string | null }>)
    .map(r => ({ id: String(r.id), message_id: r.message_id ? String(r.message_id) : null, direction: r.direction, content_type: r.content_type, has_copy: Boolean(r.data) || Boolean(r.source_url) }))
  return { items, unavailable: false }
}

/** The bytes of one attachment for a signed-in staff member of this shop. */
export async function readMedia(db: Db, shopId: string, id: string, fetcher: Fetcher): Promise<{ contentType: string; bytes: Buffer } | null> {
  const { data, error } = await db.from('message_media').select('content_type,data,source_url').eq('shop_id', shopId).eq('id', id).maybeSingle()
  if (error || !data) return null
  if (data.data) return { contentType: String(data.content_type), bytes: Buffer.from(String(data.data), 'base64') }
  if (data.source_url && isCarrierMediaUrl(data.source_url)) {
    const copy = await download(String(data.source_url), fetcher)
    if (copy) return { contentType: String(data.content_type), bytes: Buffer.from(copy.base64, 'base64') }
  }
  return null
}

/** Stores a staff member's picture until the carrier has fetched it. The random token is the link's only key. */
export async function storeOutgoing(db: Db, shopId: string, upload: { contentType: string; base64: string; contactKey: string }): Promise<{ ok: true; id: string; bytes: number } | { ok: false; error: string; unavailable?: boolean }> {
  const check = checkUpload(upload.contentType, upload.base64)
  if (!check.ok) return check
  const token = newMediaToken()
  const { data, error } = await db.from('message_media').insert({
    shop_id: shopId, direction: 'outbound', content_type: check.type, data: upload.base64, size_bytes: check.bytes, token, contact_key: upload.contactKey,
  }).select('id').maybeSingle()
  if (error || !data?.id) {
    return errKind(error) === 'missing'
      ? { ok: false, error: 'Sending pictures needs a database update. Ask your admin to apply the latest update.', unavailable: true }
      : { ok: false, error: 'The picture could not be saved. Try again.' }
  }
  return { ok: true, id: String(data.id), bytes: check.bytes }
}

/** Public links for the carrier to fetch. Only this shop's own unattached pictures are accepted. */
export async function outgoingLinks(db: Db, shopId: string, ids: string[], appUrl: string): Promise<{ ok: true; urls: string[]; types: string[] } | { ok: false; error: string }> {
  const clean = Array.from(new Set(ids.filter(x => typeof x === 'string' && x))).slice(0, MAX_MEDIA_PER_TEXT)
  if (!clean.length) return { ok: true, urls: [], types: [] }
  if (!/^https:\/\//.test(appUrl)) return { ok: false, error: 'Pictures need the shop address to be set up with https.' }
  const { data, error } = await db.from('message_media').select('id,token,content_type,direction,message_id').eq('shop_id', shopId).in('id', clean)
  if (error) return { ok: false, error: 'The pictures could not be loaded.' }
  const rows = (data || []) as Array<{ id: string; token: string | null; content_type: string; direction: string; message_id: string | null }>
  const urls: string[] = []; const types: string[] = []
  for (const id of clean) {
    const r = rows.find(x => String(x.id) === id)
    if (!r || r.direction !== 'outbound' || !r.token || r.message_id) return { ok: false, error: 'One of the pictures is no longer available. Add it again.' }
    urls.push(`${appUrl}/api/sms/media/${encodeURIComponent(id)}?t=${encodeURIComponent(r.token)}`)
    types.push(r.content_type)
  }
  return { ok: true, urls, types }
}

export async function attachOutgoing(db: Db, shopId: string, ids: string[], messageId: string): Promise<void> {
  if (!ids.length || !messageId) return
  try { await db.from('message_media').update({ message_id: messageId }).eq('shop_id', shopId).eq('direction', 'outbound').in('id', ids) } catch { /* the message still went out */ }
}

/** What the carrier is allowed to download: needs the exact token. */
export async function readByToken(db: Db, id: string, token: string): Promise<{ contentType: string; bytes: Buffer } | null> {
  if (!id || !token) return null
  const { data, error } = await db.from('message_media').select('content_type,data,token,direction').eq('id', id).maybeSingle()
  if (error || !data || data.direction !== 'outbound' || !data.data || !data.token) return null
  if (!tokensMatch(String(data.token), token)) return null
  return { contentType: String(data.content_type), bytes: Buffer.from(String(data.data), 'base64') }
}
