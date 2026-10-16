/**
 * What a crash report may carry, and what it may never carry.
 *
 * When a screen breaks in someone's browser, we want to know which page, what kind of error and where in the code,
 * so it can be fixed. We do not want names, phone numbers, email addresses, links with secrets in them, or anything
 * a customer typed. So a report is cut down twice: once in the browser before it is sent, and again on the server
 * before it is written to the log, because the server cannot trust what a browser sends.
 *
 * Nothing in this file imports anything, so the browser, the server and the tests all use the same rules.
 */

export const REPORT_KINDS = ['screen', 'script', 'promise', 'app', 'page'] as const
export type ReportKind = (typeof REPORT_KINDS)[number]

export interface ErrorReport {
  kind: ReportKind
  /** What went wrong, with anything personal taken out. */
  message: string
  /** The top of the call stack, with anything personal taken out. Empty when the browser gave none. */
  stack: string
  /** The page, with ids and tokens in the address replaced by ":id" and the query string dropped. */
  path: string
  /** Next's short reference for a server-side error. It matches a line in the server log. */
  digest: string
}

export const MAX_BODY_BYTES = 4096
const MESSAGE_MAX = 300
const STACK_MAX = 1200
const STACK_LINES = 8
const PATH_MAX = 120
const DIGEST_MAX = 40

/** Takes out the things that must never be written to a log. Order matters: addresses first, then long codes, then numbers. */
export function scrub(raw: unknown, max: number): string {
  let s = typeof raw === 'string' ? raw : ''
  if (!s) return ''
  s = s.slice(0, max * 3)
  s = s.replace(/[^\s@<>()"']+@[^\s@<>()"']+\.[a-z]{2,}/gi, '[email]')
  // Links keep their host and path but lose the query string and the part after #: those are where tokens live.
  s = s.replace(/(https?:\/\/[^\s?#)"']+)[?#][^\s)"']*/gi, '$1')
  // Tokens in a path: a UUID, a long hex string, or any 20+ character run of letters and digits.
  s = s.replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[id]')
  s = s.replace(/\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{24,}\b(?!\.m?js)/g, '[token]')
  s = s.replace(/\b[0-9a-f]{20,}\b/gi, '[token]')
  // Phone numbers, then any other run of 6 or more digits (account numbers, card numbers, ids).
  s = s.replace(/(?:\+?\d[ ().-]{0,2}){10,}/g, '[number]')
  s = s.replace(/\b\d{6,}\b/g, '[number]')
  return s.slice(0, max)
}

/** "/status/9f2c…" becomes "/status/:id". Only short, plain words stay; the query string and hash are dropped. */
export function cleanPath(raw: unknown): string {
  const input = typeof raw === 'string' ? raw : ''
  const noQuery = input.split(/[?#]/)[0] || ''
  if (!noQuery.startsWith('/')) return ''
  const parts = noQuery.split('/').map(part => {
    if (!part) return part
    // A readable word of letters and dashes, short enough to be a page name, stays. Anything else is an id of some kind.
    return /^[a-z][a-z-]{0,29}$/.test(part) ? part : ':id'
  })
  return parts.join('/').slice(0, PATH_MAX)
}

/** A few lines from the top of a stack, with each line cut to the function and the file, not the whole address. */
export function cleanStack(raw: unknown): string {
  const input = typeof raw === 'string' ? raw : ''
  if (!input) return ''
  const lines = input.split('\n').slice(0, STACK_LINES + 1)
  return scrub(lines.join('\n'), STACK_MAX)
}

export function cleanDigest(raw: unknown): string {
  return (typeof raw === 'string' ? raw : '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, DIGEST_MAX)
}

/** Turns whatever a browser sent into a report that is safe to log, or null when it is not a report at all. */
export function cleanReport(raw: unknown): ErrorReport | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  const kind = REPORT_KINDS.find(k => k === r.kind)
  if (!kind) return null
  const message = scrub(r.message, MESSAGE_MAX)
  const digest = cleanDigest(r.digest)
  // A report with nothing to say is noise.
  if (!message && !digest) return null
  return { kind, message, stack: cleanStack(r.stack), path: cleanPath(r.path), digest }
}

/**
 * Errors that are not ours: browser extensions, a cross-origin script that hides its details, a resize notice that
 * browsers raise and nobody can act on. Reporting these would bury the real ones.
 */
export function isNoise(message: unknown, source?: unknown): boolean {
  const m = typeof message === 'string' ? message : ''
  const src = typeof source === 'string' ? source : ''
  if (/^script error\.?$/i.test(m.trim())) return true
  if (/ResizeObserver loop/i.test(m)) return true
  if (/^(chrome|moz|safari-web)-extension:/i.test(src)) return true
  if (/\b(chrome|moz|safari-web)-extension:\/\//i.test(m)) return true
  // The browser went offline mid-request. The offline screen already explains that one.
  if (/^(failed to fetch|load failed|networkerror when attempting to fetch resource\.?)$/i.test(m.trim())) return true
  return false
}

/** A short reference a person can read out over the phone. Falls back to nothing, never a made-up code. */
export function referenceCode(digest: unknown): string {
  const d = cleanDigest(digest)
  return d ? d.slice(0, 10) : ''
}

/** A key for "have I already told the server about this one", so one broken screen is reported once, not once per click. */
export function reportKey(r: Pick<ErrorReport, 'kind' | 'message' | 'path' | 'digest'>): string {
  return [r.kind, r.path, r.digest, r.message.slice(0, 80)].join('|')
}

/** How many reports one page load may send. A loop that throws on every frame must not become a flood. */
export const MAX_REPORTS_PER_PAGE = 5
