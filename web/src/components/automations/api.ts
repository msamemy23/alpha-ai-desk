export interface Reply {
  ok: boolean
  status: number
  data: Record<string, any>
  /** A reason in plain words. Empty when the call worked. */
  error: string
}

/** The reason a change did not go through, in words a shop owner can act on. */
export function problem(status: number, serverText: string): string {
  const t = serverText.trim()
  if (status === 401) return 'You were signed out. Sign in again, then try once more.'
  if (status === 403) return 'Your account cannot change automations. Ask the owner.'
  if (/uncertain|reconcil/i.test(t)) return 'Alpha could not confirm what happened. Refresh the page and check the last run before you try again.'
  if (/could not be safely started/i.test(t)) return 'The server could not start the change. Try again in a moment.'
  if (status === 409 && /already in progress|already completed/i.test(t)) return 'This is already running, or just ran. Wait a minute, then check the last run.'
  if (status === 409 && /approval|confirm/i.test(t)) return 'This needs your confirmation first.'
  if (status === 503 && /not configured|configured/i.test(t)) return t.endsWith('.') ? t : `${t}.`
  if (t && t.length < 180) return t.endsWith('.') ? t : `${t}.`
  return 'Something went wrong. Try again in a moment.'
}

const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`)

/** Posts one change. Every call carries its own Idempotency-Key, so a tap that is sent twice is only done once on the server. */
export async function call(url: string, body: Record<string, unknown>): Promise<Reply> {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': newKey() }, body: JSON.stringify(body) })
    const data = await res.json().catch(() => ({}))
    const err = typeof data.error === 'string' ? data.error : ''
    const ok = res.ok && data.ok !== false && !err
    return { ok, status: res.status, data, error: ok ? '' : problem(res.status, err) }
  } catch {
    return { ok: false, status: 0, data: {}, error: 'No connection. Check your internet and try again.' }
  }
}

/** Reads a list. `ok` is false when the page could not be reached or the server said no. */
export async function load<T>(url: string, pick: (d: Record<string, unknown>) => T): Promise<{ ok: true; value: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { cache: 'no-store' })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.ok === false) return { ok: false, error: problem(res.status, typeof data.error === 'string' ? data.error : '') }
    return { ok: true, value: pick(data) }
  } catch {
    return { ok: false, error: 'No connection. Check your internet and try again.' }
  }
}

/** Why one text or email in a run did not go out, in plain words. */
export function childReason(raw: unknown): string {
  const t = String(raw ?? '').trim()
  if (!t) return 'It did not send.'
  if (/telnyx.*not configured|sms is not configured|not configured.*telnyx/i.test(t)) return 'Texting is not set up for this shop yet.'
  if (/email is not configured/i.test(t)) return 'Email is not set up for this shop yet.'
  if (/opted out/i.test(t)) return 'Replied STOP, so no text was sent.'
  if (/(telnyx|sms|email).*(failed|returned)\D*[45]\d\d/i.test(t)) return 'The carrier or email service turned it down. Check the number or address.'
  if (t.length > 140) return `${t.slice(0, 137)}…`
  return t.endsWith('.') ? t : `${t}.`
}
