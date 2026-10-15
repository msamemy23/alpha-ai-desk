// How a failed browser call is told to the person. Plain words, no database text, no apologies.
// No imports, so it can be tested on its own.

export interface FailureInfo {
  /** Shown to the person as it is. */
  message: string
  /** '' or one of the server's codes: blocked, daily_cap, ai_off, ai_not_set_up, needs_update, type, not_found, timeout ... */
  code: string
  status: number
  /** The database update that adds this part has not been applied yet. */
  setup: boolean
  /** A site rule stopped it. */
  blocked: boolean
  offline: boolean
  forbidden: boolean
  /** Seconds to wait when the server said to slow down. */
  retryAfter: number
}

export const SETUP_DEFAULT = 'This part needs a one-time setup. Ask Alpha’s owner to apply it. Everything else here still works.'

/** "Saving rules needs a one-time setup. Ask Alpha’s owner to apply it." */
export function setupText(what: string): string {
  return `${what} needs a one-time setup. Ask Alpha’s owner to apply it.`
}

const TECHNICAL = /relation "|schema cache|pgrst|postgres|sqlstate|column "|syntax error|violates|duplicate key|stack|undefined|\[object/i
const SETUP_WORDS = /database update|one-time setup|needs a database/i

function pickString(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

function nested(body: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = body[key]
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/** Turn a status and a parsed body (which may be empty) into one clear failure. */
export function describeFailure(input: { status: number; body?: unknown; offline?: boolean; timedOut?: boolean }): FailureInfo {
  const body = input.body && typeof input.body === 'object' && !Array.isArray(input.body) ? (input.body as Record<string, unknown>) : {}
  const status = input.status
  const outcome = nested(body, 'outcome')
  const result = nested(body, 'result')
  const code = pickString(body.code) || pickString(outcome.code) || pickString(result.code)
  const retryAfter = Number.isFinite(Number(body.retryAfter)) ? Math.max(0, Math.round(Number(body.retryAfter))) : 0
  const base = { code, status, offline: false, forbidden: status === 403, retryAfter }

  if (input.offline) {
    return { ...base, status: 0, code: 'offline', offline: true, forbidden: false, setup: false, blocked: false, message: 'No connection. Check your internet and try again.' }
  }
  if (input.timedOut || status === 504 || status === 408) {
    return { ...base, code: code || 'timeout', setup: false, blocked: false, message: 'That took too long. Try again in a moment.' }
  }
  const said = pickString(body.error) || pickString(outcome.message) || pickString(result.message) || pickString(body.message)
  const setup = body.needsUpdate === true || code === 'needs_update' || SETUP_WORDS.test(said)
  if (setup) return { ...base, code: 'needs_update', setup: true, blocked: false, message: SETUP_DEFAULT }
  if (status === 401) {
    return { ...base, setup: false, blocked: false, message: 'You were signed out. Refresh the page and sign in again.' }
  }
  const blocked = code === 'blocked'
  if (said && !TECHNICAL.test(said)) return { ...base, setup: false, blocked, message: said }
  if (status === 403) return { ...base, setup: false, blocked, message: 'Your role does not include this. Ask an owner or manager.' }
  if (status === 429) return { ...base, setup: false, blocked, message: 'You are going a little fast. Wait a moment and try again.' }
  if (status === 404) return { ...base, setup: false, blocked, message: 'That was not found.' }
  return { ...base, setup: false, blocked, message: 'That did not work. Try again in a moment.' }
}
