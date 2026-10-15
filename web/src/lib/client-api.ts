/**
 * Calling the reports, accounting and inventory routes from the browser. Every call comes back as a plain result with a
 * readable message, never a thrown error, so a screen can always say what went wrong in words.
 */
export interface ApiOk<T> { ok: true; data: T }
export interface ApiFail {
  ok: false
  status: number
  message: string
  /** The database update that adds this feature has not been applied yet. */
  needsUpdate: boolean
  /** The signed-in person's role does not include this. */
  forbidden: boolean
  /** Problems with single fields, by field name. */
  fields: Record<string, string>
  /** Everything else the route sent back (a duplicate bill, a preview token and so on). */
  extra: Record<string, unknown>
}
export type ApiResult<T> = ApiOk<T> | ApiFail

const NO_CONNECTION = 'No connection. Check your internet and try again.'

async function run<T>(path: string, init: RequestInit): Promise<ApiResult<T>> {
  let res: Response
  try {
    res = await fetch(path, { cache: 'no-store', ...init })
  } catch {
    return { ok: false, status: 0, message: NO_CONNECTION, needsUpdate: false, forbidden: false, fields: {}, extra: {} }
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok || body.ok === false) {
    const fallback = res.status === 401 ? 'You were signed out. Refresh the page and sign in again.' : res.status === 403 ? 'Your role does not include this. Ask an owner or manager.' : 'That did not work. Nothing was changed. Try again.'
    const { ok: _ok, error, fields, needsUpdate, ...extra } = body
    void _ok
    return {
      ok: false, status: res.status, message: typeof error === 'string' && error ? error : fallback,
      needsUpdate: needsUpdate === true, forbidden: res.status === 403,
      fields: fields && typeof fields === 'object' ? (fields as Record<string, string>) : {}, extra,
    }
  }
  return { ok: true, data: body as T }
}

export const getJson = <T = Record<string, unknown>>(path: string): Promise<ApiResult<T>> => run<T>(path, {})
export const postJson = <T = Record<string, unknown>>(path: string, body: Record<string, unknown>): Promise<ApiResult<T>> =>
  run<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

/** A fresh key for one send, made when the person opens the confirmation. Sending twice with the same key sends once. */
export function newKey(prefix: string): string {
  const c = typeof crypto !== 'undefined' ? crypto : undefined
  const id = c && 'randomUUID' in c ? c.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}-${id}`
}
