/**
 * The uptime check at /api/health.
 *
 * A free uptime monitor (or Aaron's phone) asks one question: is Alpha Desk answering, and can it reach its database?
 * The answer is two words, "up" or "down", plus the time and the short version of the code that is running.
 * It never says what is configured, never names a table or an error, and never touches a customer's record.
 *
 * Nothing in this file imports anything, so the route and the tests use the same rules.
 */

/** A database that has not answered in this long counts as down. A monitor should hear "down" before it gives up waiting. */
export const DB_TIMEOUT_MS = 4000

export interface HealthBody {
  ok: boolean
  database: 'up' | 'down'
  checked_at: string
  /** The first 7 characters of the commit that is running, or empty when the host does not say. */
  version: string
}

/** Only a real commit hash is shown, cut to 7 characters. Anything else (an empty value, a stray word) shows nothing. */
export function shortVersion(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
  return /^[0-9a-f]{7,40}$/.test(s) ? s.slice(0, 7) : ''
}

export function healthBody(databaseUp: boolean, now: Date, commit: unknown): HealthBody {
  return {
    ok: databaseUp,
    database: databaseUp ? 'up' : 'down',
    checked_at: Number.isNaN(now.getTime()) ? '' : now.toISOString(),
    version: shortVersion(commit),
  }
}

/** A monitor treats anything but 200 as an outage, so a database that is down must not answer 200. */
export function healthStatus(body: Pick<HealthBody, 'ok'>): 200 | 503 {
  return body.ok ? 200 : 503
}

export type Timed<T> = { timedOut: true } | { timedOut: false; value: T }

/** Waits for `work`, but gives up after `ms`. The timer is always cleared so a fast answer leaves nothing running. */
export async function withTimeout<T>(work: PromiseLike<T>, ms: number): Promise<Timed<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const late = new Promise<Timed<T>>(resolve => { timer = setTimeout(() => resolve({ timedOut: true }), ms) })
  try {
    return await Promise.race([Promise.resolve(work).then((value): Timed<T> => ({ timedOut: false, value })), late])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
