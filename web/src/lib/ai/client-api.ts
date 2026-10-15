/**
 * Browser-side helpers shared by the assistant screens (chat, Activity, Settings rules).
 * Every call sends the signed-in session, reports failure as a value instead of throwing,
 * and never makes up success: callers decide what to tell the owner.
 */
import { supabase } from '@/lib/supabase'
import { finalOf, parseNdjsonChunk, type StreamEvent, type StreamProgress } from './ndjson'

export async function authHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...extra }
  try {
    const { data } = await supabase.auth.getSession()
    if (data.session?.access_token) headers.Authorization = `Bearer ${data.session.access_token}`
  } catch { /* the request goes without it and the server says so */ }
  return headers
}

export type ApiResult<T = Record<string, unknown>> = { ok: boolean; status: number; data: T & { error?: string } }

/** A JSON call that never throws. A dropped connection comes back as status 0. */
export async function apiJson<T = Record<string, unknown>>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<ApiResult<T>> {
  try {
    const response = await fetch(path, {
      method: init.method || (init.body === undefined ? 'GET' : 'POST'),
      headers: await authHeaders(init.headers),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
      cache: 'no-store',
    })
    const data = await response.json().catch(() => ({})) as T & { error?: string }
    return { ok: response.ok && (data as { ok?: boolean }).ok !== false, status: response.status, data }
  } catch {
    return { ok: false, status: 0, data: { error: 'Could not reach the server. Check your signal and try again.' } as T & { error?: string } }
  }
}

export function newEventId(prefix = 'evt'): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}-${random}`
}

/** Tell the server something only the browser knows (a declined review, a Stop, an action run elsewhere). */
export async function postActivityEvent(event: 'declined' | 'stopped' | 'external', fields: { action?: string; summary?: string; subject?: string; success?: boolean; error?: string; eventId?: string }): Promise<boolean> {
  const result = await apiJson('/api/ai-activity', { method: 'POST', body: { event, eventId: fields.eventId || newEventId(event), ...fields } })
  return result.ok
}

/** Ask the server to stop this turn between steps. It survives the page dropping the request. */
export async function postServerStop(sessionId: string, turnId: string): Promise<void> {
  try {
    await fetch('/api/ai-workflow/cancel', {
      method: 'POST',
      headers: await authHeaders(),
      body: JSON.stringify({ sessionId, turnId }),
      keepalive: true,
    })
  } catch { /* the browser still stops waiting; the server also stops when the connection closes */ }
}

export type StreamedWorkflow = { ok: boolean; status: number; body: Record<string, unknown> }

/**
 * Call the workflow route and follow its live progress. Falls back to a plain JSON answer when the
 * server (or a proxy in between) does not stream. The result is always a value, never a throw:
 * a stream that ends without its final line is reported as a failure, not as an answer.
 */
export async function streamWorkflow(
  request: Record<string, unknown>,
  options: { headers: Record<string, string>; signal?: AbortSignal; onProgress: (event: StreamProgress) => void },
): Promise<StreamedWorkflow> {
  const response = await fetch('/api/ai-workflow', {
    method: 'POST',
    headers: { ...options.headers, Accept: 'application/x-ndjson, application/json' },
    body: JSON.stringify(request),
    signal: options.signal,
  })
  const type = response.headers.get('content-type') || ''
  if (!type.includes('application/x-ndjson') || !response.body) {
    const body = await response.json().catch(() => ({})) as Record<string, unknown>
    return { ok: response.ok, status: response.status, body }
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  const events: StreamEvent[] = []
  for (;;) {
    const { value, done } = await reader.read()
    pending += decoder.decode(value, { stream: !done })
    const chunk = parseNdjsonChunk(done ? `${pending}\n` : pending)
    pending = chunk.rest
    for (const event of chunk.events) {
      events.push(event)
      if (event.type === 'progress') options.onProgress(event)
    }
    if (done) break
  }
  const final = finalOf(events)
  if (!final) return { ok: false, status: 502, body: { error: 'The answer was cut off before it finished. Nothing was changed. Try again.' } }
  const body = final.body && typeof final.body === 'object' && !Array.isArray(final.body) ? final.body as Record<string, unknown> : {}
  return { ok: final.status >= 200 && final.status < 300, status: final.status, body }
}
