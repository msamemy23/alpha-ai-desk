// Small fetch helper shared by the customer screens that talk to the call and contact-choice routes.
// It always resolves to the parsed JSON object (or null when the body was not JSON) and gives up after a timeout.
// It throws only when the request itself could not be made or was cancelled, so a caller can tell
// "the server answered" apart from "we never heard back".

export interface JsonReply {
  /** True for any 2xx status. */
  ok: boolean
  status: number
  /** The JSON object the server sent, or null if the body was empty, not JSON or not an object. */
  data: Record<string, unknown> | null
}

export const JSON_HEADERS = { 'Content-Type': 'application/json' }

export async function fetchJson(url: string, init: RequestInit = {}, timeoutMs = 20000): Promise<JsonReply> {
  const ctl = new AbortController()
  const outer = init.signal
  const onAbort = () => ctl.abort()
  if (outer) {
    if (outer.aborted) ctl.abort()
    else outer.addEventListener('abort', onAbort, { once: true })
  }
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { ...init, signal: ctl.signal })
    const body: unknown = await res.json().catch(() => null)
    const data = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : null
    return { ok: res.ok, status: res.status, data }
  } finally {
    clearTimeout(timer)
    outer?.removeEventListener('abort', onAbort)
  }
}

export const asText = (v: unknown): string => (typeof v === 'string' ? v : '')

export const asTextList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : []
