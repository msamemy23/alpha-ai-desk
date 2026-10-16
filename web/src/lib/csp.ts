import { cleanPath } from './client-errors.ts'

/**
 * The Content-Security-Policy, in REPORT-ONLY mode.
 *
 * A security policy tells the browser which places a page may load scripts, pictures, calls and frames from, so that
 * a script someone sneaks into a page cannot send customer data to a stranger. Switching one on all at once can
 * break a screen that quietly depends on something nobody listed. So this one only reports: the browser changes
 * nothing, it just sends a note to /api/csp-report each time a page does something the policy would not allow.
 * After a few days of quiet notes the policy can be made to enforce.
 *
 * Known limits, written down so nobody mistakes this for more than it is:
 * - Next.js puts small inline scripts in every page, so `script-src` still allows 'unsafe-inline'. Closing that gap
 *   needs a per-request nonce, which makes every page render on demand. That is the step after this one.
 * - It does not block anything today.
 */

export const CSP_REPORT_PATH = '/api/csp-report'
export const CSP_HEADER = 'Content-Security-Policy-Report-Only'
export const CSP_MAX_BODY_BYTES = 8192

/** The sites the browser itself talks to. Everything else the browser talks to goes through our own server. */
const PHONE_SERVICE_HTTPS = 'https://*.telnyx.com'
const PHONE_SERVICE_SOCKET = 'wss://*.telnyx.com'
/** The inspection screen can show a YouTube explainer for a repair. */
const VIDEO_FRAMES = ['https://www.youtube.com', 'https://www.youtube-nocookie.com']

/** The address of the database as the browser reaches it (https and the matching websocket), or empty when it is not a plain https address. */
export function databaseOrigins(raw: unknown): { http: string; socket: string } | null {
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    const u = new URL(raw.trim())
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    const socket = u.protocol === 'https:' ? 'wss:' : 'ws:'
    return { http: u.origin, socket: `${socket}//${u.host}` }
  } catch {
    return null
  }
}

export function buildCsp(opts: { databaseUrl?: unknown; development?: boolean } = {}): string {
  const db = databaseOrigins(opts.databaseUrl)
  const connect = ["'self'", ...(db ? [db.http, db.socket] : []), PHONE_SERVICE_HTTPS, PHONE_SERVICE_SOCKET, 'blob:', 'data:']
  const script = ["'self'", "'unsafe-inline'", ...(opts.development ? ["'unsafe-eval'"] : [])]
  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    ['script-src', script],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:', 'https:']],
    ['media-src', ["'self'", 'blob:', 'data:', 'https:']],
    ['font-src', ["'self'", 'data:']],
    ['connect-src', connect],
    ['frame-src', ["'self'", ...VIDEO_FRAMES]],
    ['worker-src', ["'self'", 'blob:']],
    ['manifest-src', ["'self'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'self'"]],
  ]
  return [...directives.map(([name, values]) => `${name} ${values.join(' ')}`), `report-uri ${CSP_REPORT_PATH}`].join('; ')
}

export interface CspReport {
  /** The rule that was broken, like "script-src-elem" or "img-src". */
  directive: string
  /** What was blocked: a site name only ("cdn.example.com"), or one of the words inline, eval, data, blob. Never a full address. */
  blocked: string
  /** The page it happened on, ids and tokens replaced by ":id", no query string. */
  page: string
  /** The file that caused it, as a site name only. */
  source: string
  line: number
  disposition: 'report' | 'enforce'
}

const WORDS = new Set(['inline', 'eval', 'wasm-eval', 'data', 'blob', 'self', 'about', 'filesystem'])

/** Browser add-ons trigger notes on every page and there is nothing we can do about them. */
const EXTENSION_SCHEME = /^(chrome|moz|safari|safari-web|ms-browser|edge)-extension:/i

/** An address reduced to its site name. Words like "inline" pass through, and an unreadable value becomes empty. */
export function siteOnly(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : ''
  if (!s) return ''
  const lower = s.toLowerCase()
  if (WORDS.has(lower)) return lower
  if (lower.startsWith('data:')) return 'data'
  if (lower.startsWith('blob:')) return 'blob'
  if (lower.startsWith('about:')) return 'about'
  try {
    const host = new URL(s).hostname.toLowerCase()
    return /^[a-z0-9.-]{1,100}$/.test(host) ? host : ''
  } catch {
    return ''
  }
}

function pick(r: Record<string, unknown>, ...names: string[]): unknown {
  for (const n of names) if (r[n] !== undefined && r[n] !== null) return r[n]
  return undefined
}

function pageOf(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  try {
    return cleanPath(new URL(raw).pathname)
  } catch {
    return cleanPath(raw)
  }
}

/**
 * Turns what a browser sent into a note that is safe to log, or null when it is not a report, or comes from a browser add-on.
 * Handles both shapes browsers use: `{ "csp-report": {...} }` and the newer `[{ type: "csp-violation", body: {...} }]`.
 */
export function cleanCspReport(raw: unknown): CspReport | null {
  let r: Record<string, unknown> | null = null
  if (Array.isArray(raw)) {
    const first = raw.find(x => x && typeof x === 'object' && (x as Record<string, unknown>).type === 'csp-violation') as Record<string, unknown> | undefined
    const body = first?.body
    if (body && typeof body === 'object' && !Array.isArray(body)) r = body as Record<string, unknown>
  } else if (raw && typeof raw === 'object') {
    const inner = (raw as Record<string, unknown>)['csp-report']
    if (inner && typeof inner === 'object' && !Array.isArray(inner)) r = inner as Record<string, unknown>
  }
  if (!r) return null

  const blockedRaw = pick(r, 'blocked-uri', 'blockedURL', 'blockedUri')
  const sourceRaw = pick(r, 'source-file', 'sourceFile')
  for (const v of [blockedRaw, sourceRaw]) if (typeof v === 'string' && EXTENSION_SCHEME.test(v.trim())) return null

  const directiveRaw = String(pick(r, 'effective-directive', 'effectiveDirective', 'violated-directive', 'violatedDirective') ?? '').trim().split(/\s+/)[0].toLowerCase()
  if (!/^[a-z-]{3,40}$/.test(directiveRaw)) return null

  const lineRaw = Number(pick(r, 'line-number', 'lineNumber'))
  const line = Number.isInteger(lineRaw) && lineRaw >= 0 && lineRaw <= 1_000_000 ? lineRaw : 0
  const dispositionRaw = String(pick(r, 'disposition') ?? 'report').toLowerCase()

  return {
    directive: directiveRaw,
    blocked: siteOnly(blockedRaw),
    page: pageOf(pick(r, 'document-uri', 'documentURL', 'documentUri')),
    source: siteOnly(sourceRaw),
    line,
    disposition: dispositionRaw === 'enforce' ? 'enforce' : 'report',
  }
}
