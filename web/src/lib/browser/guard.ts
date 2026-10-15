/**
 * Small checks every browser route shares. No database, no session: plain functions so they are easy to test.
 */
import { evaluateUrl } from './policy.ts'
import type { Actor, PolicyContext } from './policy.ts'
import { normalizeHost, parseTarget } from './url.ts'
import { safeFetch } from './safe-fetch.ts'
import type { SafeFetchDeps } from './safe-fetch.ts'
import type { ResourceFetcher } from '../hosted-browser.ts'

/** Requests per person and what each costs. In-memory per server instance, plus a daily count kept in the audit log. */
export const LIMITS = {
  read: { limit: 40, windowMs: 60_000 },
  search: { limit: 20, windowMs: 60_000 },
  image: { limit: 400, windowMs: 60_000 },
  live: { limit: 30, windowMs: 60_000 },
  agent: { limit: 20, windowMs: 60_000 },
  download: { limit: 6, windowMs: 60_000 },
  write: { limit: 30, windowMs: 60_000 },
  host: { limit: 60, windowMs: 60_000 },
  hostClaim: { limit: 8, windowMs: 60_000 },
  /** Pages opened live, per shop, per day. A real browser on a server costs money; this keeps one stuck loop from running up a bill. */
  liveDaily: 1500,
  agentDaily: 400,
}

interface HeaderLike { get(name: string): string | null }

/**
 * Is this request from a page on our own site? Browsers always send Origin on a cross-site POST, so a mismatch is a forged request.
 * A request with no Origin at all (a tool, not a browser tab) is not a cross-site browser attack, so it is allowed.
 */
export function sameOriginRequest(headers: HeaderLike, requestUrl: string): boolean {
  const origin = headers.get('origin')
  const site = headers.get('sec-fetch-site')
  if (site && !['same-origin', 'same-site', 'none'].includes(site.toLowerCase())) return false
  if (!origin) return true
  if (origin === 'null') return false
  try {
    const o = new URL(origin).host.toLowerCase()
    const hostHeader = (headers.get('x-forwarded-host') || headers.get('host') || new URL(requestUrl).host).split(',')[0].trim().toLowerCase()
    return o === hostHeader
  } catch { return false }
}

const OWN_HOST_ENV = ['NEXT_PUBLIC_APP_URL', 'NEXT_PUBLIC_SITE_URL', 'APP_URL', 'SITE_URL', 'VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL', 'NEXT_PUBLIC_SUPABASE_URL']

function hostOf(value: string | undefined): string | null {
  const v = String(value || '').trim()
  if (!v) return null
  try { return normalizeHost(new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`).hostname) || null } catch { return null }
}

/** The hosts that are Alpha itself: the site, this deployment and the database. Read from the environment each time, never stored or shown. */
export function collectOwnHosts(env: Record<string, string | undefined>, requestHost?: string | null): string[] {
  const hosts = new Set<string>()
  for (const key of OWN_HOST_ENV) { const h = hostOf(env[key]); if (h) hosts.add(h) }
  const rh = hostOf(requestHost || undefined)
  if (rh) hosts.add(rh)
  return [...hosts]
}

/**
 * The rule the locked browser applies to every request it makes, including each redirect.
 * The address of the page itself follows the full shop policy. Pictures, scripts and styles the page loads follow the hard
 * blocks, the shop's block list and the default block list, but not the "only sites I allow" list, or no page would draw.
 */
export function makeCheck(ctx: PolicyContext, actor: Actor): (url: string, info: { navigation: boolean }) => string | null {
  const subresource: PolicyContext = { ...ctx, settings: { ...ctx.settings, mode: 'open' } }
  return (url, info) => {
    const decision = info.navigation ? evaluateUrl(url, actor, ctx) : evaluateUrl(url, 'user', subresource)
    return decision.allowed ? null : decision.reason
  }
}

/** How the locked browser gets each thing a page asks for: one pinned, checked fetch. Redirects come back to the browser, which asks again. */
export function makeResourceFetcher(deps: SafeFetchDeps = {}): ResourceFetcher {
  return (url, init) => safeFetch(url, {
    method: init.method === 'POST' ? 'POST' : init.method === 'HEAD' ? 'HEAD' : 'GET',
    headers: init.headers, body: init.body, signal: init.signal, maxBytes: init.maxBytes, timeoutMs: 12_000,
  }, deps)
}

/** The plain-words text for a refused address. Nothing here repeats the address. */
export function describeRefusal(raw: string, ctx: PolicyContext, actor: Actor): string | null {
  const parsed = parseTarget(raw)
  if (!parsed.ok) return parsed.message
  const decision = evaluateUrl(raw, actor, ctx)
  return decision.allowed ? null : decision.reason
}

/** A download name that cannot hide a program or climb out of a folder. */
const PROGRAM_EXTENSIONS = /\.(exe|msi|bat|cmd|com|scr|pif|ps1|psm1|vbs|vbe|js|jse|wsf|wsh|jar|apk|dmg|pkg|app|sh|bash|run|bin|dll|sys|lnk|reg|iso|img|appimage|deb|rpm|hta|cpl|msp|crx)$/i
const SAFE_TYPES: Record<string, string> = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8',
}

export function cleanDownloadName(raw: string): { name: string; program: boolean } {
  const base = String(raw || 'file').split(/[/\\]/).pop() || 'file'
  const name = base.replace(/[\u0000-\u001f\u007f"<>:|?*]/g, '').replace(/\s+/g, ' ').replace(/^\.+/, '').trim().slice(0, 120) || 'file'
  // Every dot-separated piece counts, so "invoice.pdf.exe" is caught as a program.
  const parts = name.split('.').slice(1)
  const program = parts.some(p => PROGRAM_EXTENSIONS.test('.' + p))
  return { name, program }
}

export function downloadType(name: string): string {
  const ext = name.toLowerCase().split('.').pop() || ''
  return SAFE_TYPES[ext] || 'application/octet-stream'
}
