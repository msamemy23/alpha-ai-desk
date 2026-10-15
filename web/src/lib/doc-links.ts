// Secure customer links for estimates and invoices: how a token is made, what one looks like, and
// how its web address is built. Works on the server and in tests (Web Crypto only).

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'

/** A random link token, 24 characters of 6 bits each: 144 bits, not guessable. */
export function newLinkToken(): string {
  const bytes = new Uint8Array(24)
  globalThis.crypto.getRandomValues(bytes)
  let out = ''
  for (let i = 0; i < bytes.length; i++) out += ALPHABET[bytes[i] & 63]
  return out
}

/** Old links are UUIDs and new links are 24 characters. Anything else is rejected before a database lookup. */
export function isLinkToken(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(v)
}

/** The site address for links in messages. Prefers the configured public address, falls back to the request. */
export function siteOrigin(configured: string | undefined | null, requestOrigin: string): string {
  const raw = (configured || '').trim() || requestOrigin
  return raw.replace(/\/+$/, '')
}

export const signUrl = (origin: string, token: string): string => `${origin}/sign/${token}`
export const logoUrl = (origin: string, token: string): string => `${origin}/api/sign/logo?t=${encodeURIComponent(token)}`
export const pixelUrl = (origin: string, token: string): string => `${origin}/api/sign/pixel?t=${encodeURIComponent(token)}`

/** Days a new customer link stays open. The estimate's own expiry date is separate. */
export const LINK_DAYS = 30
export const linkExpiry = (nowMs: number, days = LINK_DAYS): string => new Date(nowMs + days * 86400000).toISOString()

/** Pull a request's best guess at the caller's address. Used for the signing record, not for access. */
export function clientIp(headers: { get(name: string): string | null }): string {
  const fwd = headers.get('x-forwarded-for') || ''
  const first = fwd.split(',')[0]?.trim()
  return (first || headers.get('x-real-ip') || '').slice(0, 64)
}

/** A short, readable device description from a user agent, for the audit trail. */
export function deviceLabel(ua: string): string {
  const s = ua || ''
  const os = /iPhone|iPad|iPod/.test(s) ? 'iPhone or iPad' : /Android/.test(s) ? 'Android' : /Windows/.test(s) ? 'Windows' : /Mac OS X|Macintosh/.test(s) ? 'Mac' : /Linux/.test(s) ? 'Linux' : 'Unknown device'
  const browser = /Edg\//.test(s) ? 'Edge' : /OPR\/|Opera/.test(s) ? 'Opera' : /Firefox\//.test(s) ? 'Firefox' : /Chrome\//.test(s) || /CriOS\//.test(s) ? 'Chrome' : /Safari\//.test(s) ? 'Safari' : 'a browser'
  return `${browser} on ${os}`
}
