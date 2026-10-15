/**
 * Reading and checking web addresses for the built-in browser.
 * Imports only ./ip.ts, so it runs in the browser, on the server and under `node --test`.
 * Plain TypeScript only (no enums, no parameter properties).
 */
import { isIpLiteralHost } from './ip.ts'

/** The only ports the browser will open. Everything else (mail, databases, admin panels) is refused. */
export const ALLOWED_PORTS = ['80', '443', '8080', '8443']

export type UrlProblem = 'empty' | 'too_long' | 'bad_url' | 'scheme' | 'credentials' | 'port' | 'internal' | 'ip_literal'

export type ParsedTarget =
  | { ok: true; url: URL; host: string }
  | { ok: false; code: UrlProblem; message: string }

const PROBLEM_TEXT: Record<UrlProblem, string> = {
  empty: 'Type a web address or a search.',
  too_long: 'That web address is too long.',
  bad_url: 'That does not look like a web address.',
  scheme: 'Only http and https pages can be opened.',
  credentials: 'Web addresses with a name or password in them are not allowed.',
  port: 'That web address uses a port the browser does not open.',
  internal: 'Addresses on a private or internal network are not allowed.',
  ip_literal: 'Web addresses made of numbers are not allowed. Use the site name.',
}

function fail(code: UrlProblem): ParsedTarget {
  return { ok: false, code, message: PROBLEM_TEXT[code] }
}

/** Lower case, no brackets, no trailing dot. "Example.COM." and "example.com" are the same site. */
export function normalizeHost(host: string): string {
  return String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '').replace(/\.+$/, '')
}

const INTERNAL_SUFFIXES = [
  'localhost', 'local', 'internal', 'lan', 'home', 'corp', 'intranet', 'localdomain', 'home.arpa', 'private', 'test', 'invalid', 'example', 'onion', 'arpa',
]

/** Names that only make sense on a private network, plus any name with no dot in it. */
export function isInternalHostname(host: string): boolean {
  const h = normalizeHost(host)
  if (!h || !h.includes('.')) return true
  return INTERNAL_SUFFIXES.some(s => h === s || h.endsWith('.' + s))
}

export function parseTarget(raw: unknown, base?: string | URL): ParsedTarget {
  if (typeof raw !== 'string') return fail('bad_url')
  const text = raw.trim()
  if (!text) return fail('empty')
  if (text.length > 2048) return fail('too_long')
  // Spaces, control characters and backslashes are read differently by different URL parsers. Refuse the disagreement.
  if (/[\u0000- \u007f\\]/.test(text)) return fail('bad_url')
  let url: URL
  try { url = base ? new URL(text, base) : new URL(text) } catch { return fail('bad_url') }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return fail('scheme')
  if (url.username || url.password) return fail('credentials')
  const host = normalizeHost(url.hostname)
  if (!host) return fail('bad_url')
  if (isIpLiteralHost(url.hostname)) return fail('ip_literal')
  if (isInternalHostname(host)) return fail('internal')
  if (!/^[a-z0-9.-]+$/.test(host) || host.length > 253 || host.split('.').some(l => !l || l.length > 63 || l.startsWith('-') || l.endsWith('-'))) return fail('bad_url')
  if (/^\d+$/.test(host.split('.').pop() || '')) return fail('bad_url')
  if (url.port && !ALLOWED_PORTS.includes(url.port)) return fail('port')
  // Canonical form: no trailing dot, no fragment. The fragment is never sent to a server anyway.
  if (url.hostname !== host) url.hostname = host
  url.hash = ''
  return { ok: true, url, host }
}

/** Does this look like something typed as a web address (as opposed to words to search for)? */
export function looksLikeUrl(input: string): boolean {
  const t = String(input || '').trim()
  if (!t || /\s/.test(t) || t.includes('@')) return false
  if (/^https?:\/\//i.test(t)) return true
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}(:\d{2,5})?([/?#]\S*)?$/i.test(t)
}

export type AddressInput =
  | { kind: 'empty' }
  | { kind: 'url'; url: string }
  | { kind: 'search'; query: string }

/** What to do with what someone typed in the address bar. */
export function toAddress(input: string): AddressInput {
  const t = String(input || '').trim()
  if (!t) return { kind: 'empty' }
  if (looksLikeUrl(t)) return { kind: 'url', url: /^https?:\/\//i.test(t) ? t : `https://${t}` }
  return { kind: 'search', query: t.slice(0, 300) }
}

const SECRET_KEY = /(token|key|secret|passw|pwd|auth|session|sid|code|sig|otp|jwt|bearer|cookie|credential|ticket|reset)/i
const LOOKS_LIKE_TOKEN = /^[A-Za-z0-9_\-.=+/]{24,}$/

/** The form of an address that is safe to keep in a log: secrets in the path or query are hidden, the fragment is dropped. */
export function redactUrlForLog(input: string | URL): string {
  let url: URL
  try { url = new URL(String(input)) } catch { return String(input || '').slice(0, 200).replace(/[?#].*$/, '') }
  const path = url.pathname.split('/').map(seg => (LOOKS_LIKE_TOKEN.test(seg) && /\d/.test(seg) ? '[hidden]' : seg)).join('/').slice(0, 200)
  const pairs: string[] = []
  url.searchParams.forEach((value, key) => {
    const hidden = SECRET_KEY.test(key) || LOOKS_LIKE_TOKEN.test(value)
    pairs.push(`${encodeURIComponent(key).slice(0, 40)}=${hidden ? '[hidden]' : encodeURIComponent(value).slice(0, 80)}`)
  })
  const query = pairs.length ? `?${pairs.join('&').slice(0, 240)}` : ''
  return `${url.origin}${path}${query}`
}

/** "www.Example.com" for display: no scheme, no www, no path. */
export function displayHost(input: string | URL): string {
  try { return normalizeHost(new URL(String(input)).hostname).replace(/^www\./, '') } catch { return '' }
}

/** Does a site rule ("example.com" or "*.example.com") cover this host? A rule for a site covers its subdomains. */
export function hostMatches(host: string, pattern: string): boolean {
  const h = normalizeHost(host)
  const p = normalizeHost(String(pattern || '').replace(/^\*\./, '').replace(/^\./, ''))
  if (!h || !p) return false
  return h === p || h.endsWith('.' + p)
}

/** A rule typed by a person, cleaned to a bare host ("https://www.Example.com/path" becomes "www.example.com"). */
export function cleanRuleHost(input: string): string | null {
  const t = String(input || '').trim().toLowerCase()
  if (!t) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//.test(t) ? t : `https://${t.replace(/^\*\./, '')}`
  try {
    const u = new URL(withScheme)
    const host = normalizeHost(u.hostname)
    if (!host || isIpLiteralHost(u.hostname) || isInternalHostname(host)) return null
    if (!/^[a-z0-9.-]+$/.test(host) || host.length > 253) return null
    return host.replace(/^www\./, '')
  } catch { return null }
}
