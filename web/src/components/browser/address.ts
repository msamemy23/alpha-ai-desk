// What was typed in the address bar, and how an address is shown. Uses only the browser's own pure address helpers.
import { displayHost, parseTarget, toAddress } from '../../lib/browser/url.ts'

export type Target = { kind: 'page'; url: string } | { kind: 'search'; query: string }

export type Typed = Target | { kind: 'empty' } | { kind: 'invalid'; message: string }

/**
 * A typed address opens the page. Anything else is a search. An address the browser could never open
 * (numbers only, a private network, a password in it) is said so right away instead of going to the server.
 */
export function resolveTyped(input: string): Typed {
  const a = toAddress(input)
  if (a.kind === 'empty') return { kind: 'empty' }
  if (a.kind === 'search') return { kind: 'search', query: a.query }
  const parsed = parseTarget(a.url)
  if (!parsed.ok) return { kind: 'invalid', message: parsed.message }
  return { kind: 'page', url: parsed.url.toString() }
}

export function sameTarget(a: Target, b: Target): boolean {
  if (a.kind !== b.kind) return false
  return a.kind === 'page' ? a.url === (b as { url: string }).url : a.query.toLowerCase() === (b as { query: string }).query.toLowerCase()
}

/** Compare two page addresses the way a person would: no fragment, no trailing slash, host in lower case. */
export function sameAddress(a: string, b: string): boolean {
  return comparable(a) === comparable(b)
}

function comparable(url: string): string {
  try {
    const u = new URL(url)
    u.hash = ''
    const path = u.pathname.replace(/\/+$/, '')
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}`
  } catch {
    return String(url || '').trim()
  }
}

/** "rockauto.com/catalog/x" for the address bar: no scheme, no www, no root slash. */
export function addressText(url: string): string {
  try {
    const u = new URL(url)
    const host = u.host.toLowerCase().replace(/^www\./, '')
    const path = u.pathname === '/' ? '' : u.pathname
    return `${host}${path}${u.search}`.slice(0, 300)
  } catch {
    return String(url || '').slice(0, 300)
  }
}

/**
 * What the address bar shows for a page. Secure pages drop the scheme and "www.". A page that is not secure keeps its full
 * address so it is plain that it is not, and so pressing Go again opens the same page.
 */
export function shownAddress(url: string): string {
  try {
    return new URL(url).protocol === 'http:' ? String(url).slice(0, 600) : addressText(url)
  } catch {
    return addressText(url)
  }
}

export function targetText(t: Target, finalUrl?: string): string {
  if (t.kind === 'search') return t.query
  return addressText(finalUrl || t.url)
}

/** The short name on a tab. */
export function tabTitle(t: Target | null, title: string): string {
  if (!t) return 'New tab'
  const clean = String(title || '').replace(/\s+/g, ' ').trim()
  if (clean) return clean.slice(0, 60)
  if (t.kind === 'search') return `Search: ${t.query}`.slice(0, 60)
  return displayHost(t.url) || 'Page'
}

/** Only web addresses are ever used as links. Phone links are kept so a number can be tapped to call. */
export function safeLink(href: unknown): { kind: 'web'; url: string } | { kind: 'tel'; url: string } | null {
  const v = String(href ?? '').trim()
  if (/^https?:\/\//i.test(v) && !/[\s\\]/.test(v) && v.length <= 2048) return { kind: 'web', url: v }
  if (/^tel:[+\d]{3,30}$/i.test(v)) return { kind: 'tel', url: v }
  return null
}

/** The picture route address for a picture on a page. Pictures never load straight from the site. */
export function imageSrc(src: string): string | null {
  const link = safeLink(src)
  if (!link || link.kind !== 'web') return null
  return `/api/browser/image?u=${encodeURIComponent(link.url)}`
}

/** Does this address end in a file name that is not a web page? */
export function looksLikeFile(url: string): boolean {
  try {
    return /\.(pdf|zip|rar|7z|gz|tar|exe|msi|dmg|pkg|apk|csv|xlsx?|docx?|pptx?|iso|png|jpe?g|gif|webp|txt)$/i.test(new URL(url).pathname)
  } catch {
    return false
  }
}
