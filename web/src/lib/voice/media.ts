/**
 * Pictures and video in texts. Pure rules only: what counts as a safe attachment, and which carrier addresses we will fetch.
 * The actual download and storage live in lib/messaging-media.ts so these rules can be tested without a network.
 */

export interface InboundMedia { url: string; contentType: string; sizeBytes: number | null }

/** Largest attachment we keep a copy of. The stored copy is base64, so this is about 1.6 MB of file. */
export const MAX_MEDIA_BYTES = 1_600_000
/** Attachments per text. Carriers allow more; the inbox shows this many. */
export const MAX_MEDIA_PER_TEXT = 5

const OUTGOING_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'video/mp4', 'video/3gpp', 'video/quicktime'])

export function isMediaType(value: unknown): value is string {
  return typeof value === 'string' && /^(image|video)\/[A-Za-z0-9.+-]{1,40}$/.test(value)
}

export function isOutgoingMediaType(value: unknown): boolean {
  return typeof value === 'string' && OUTGOING_TYPES.has(value.toLowerCase())
}

/** Only the carrier's own storage hosts, over https. Nothing else is ever fetched from a customer's text. */
export function isCarrierMediaUrl(raw: unknown): boolean {
  if (typeof raw !== 'string' || raw.length > 2000) return false
  let u: URL
  try { u = new URL(raw) } catch { return false }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return false
  const host = u.hostname.toLowerCase()
  if (host === 'telnyx.com' || host.endsWith('.telnyx.com')) return true
  if (host === 'telnyxstorage.com' || host.endsWith('.telnyxstorage.com')) return true
  if (host.endsWith('.s3.amazonaws.com') && host.includes('telnyx')) return true
  if ((host === 's3.amazonaws.com' || /^s3[.-][a-z0-9-]+\.amazonaws\.com$/.test(host)) && /^\/telnyx[-_a-z0-9]*\//i.test(u.pathname)) return true
  return false
}

/** Reads the `media` array of a carrier message and keeps only well-formed entries. Never throws. */
export function parseCarrierMedia(raw: unknown): InboundMedia[] {
  if (!Array.isArray(raw)) return []
  const out: InboundMedia[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const url = typeof o.url === 'string' ? o.url : ''
    const contentType = typeof o.content_type === 'string' ? o.content_type.toLowerCase().split(';')[0].trim() : ''
    if (!url || !isMediaType(contentType)) continue
    const size = Number(o.size)
    out.push({ url, contentType, sizeBytes: Number.isFinite(size) && size > 0 ? Math.round(size) : null })
    if (out.length >= MAX_MEDIA_PER_TEXT) break
  }
  return out
}

/** Short, plain description for lists and notifications: "Picture", "2 pictures", "Video". */
export function mediaLabel(types: string[]): string {
  const pics = types.filter(t => t.startsWith('image/')).length
  const vids = types.filter(t => t.startsWith('video/')).length
  const parts: string[] = []
  if (pics) parts.push(pics === 1 ? 'Picture' : `${pics} pictures`)
  if (vids) parts.push(vids === 1 ? 'Video' : `${vids} videos`)
  return parts.join(' and ')
}

/** Random link token for an outgoing attachment. Uses the platform's secure random source. */
export function newMediaToken(): string {
  const bytes = new Uint8Array(24)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

export function tokensMatch(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length < 20 || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Checks the base64 text of an upload before it is stored. Returns the byte size, or an error in plain words. */
export function checkUpload(contentType: unknown, base64: unknown): { ok: true; bytes: number; type: string } | { ok: false; error: string } {
  if (!isOutgoingMediaType(contentType)) return { ok: false, error: 'That kind of file cannot be texted. Use a photo (JPEG, PNG or GIF) or a short MP4 video.' }
  if (typeof base64 !== 'string' || base64.length < 8) return { ok: false, error: 'The file was empty.' }
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return { ok: false, error: 'The file could not be read.' }
  const bytes = Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0)
  if (bytes > MAX_MEDIA_BYTES) return { ok: false, error: 'That file is too big to text. Photos are shrunk automatically; videos must be under 1.5 MB.' }
  return { ok: true, bytes, type: String(contentType).toLowerCase() }
}
