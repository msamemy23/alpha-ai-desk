// Calling the browser routes from the screen. Every call comes back as a plain result with a readable message, never a
// thrown error, so the screen can always say what went wrong in words. The session travels in the cookie, the same way the
// reports and accounting screens call their routes (see lib/client-api.ts).
import { describeFailure } from './failure'
import type { FailureInfo } from './failure'
import { nameFromDisposition } from './approval'
import { cleanActivity, cleanWaiting } from './activity'
import type { ActivityItem, WaitingApproval } from './activity'
import { cleanAgent, cleanLive, cleanRead, cleanSearch } from './responses'
import { cleanSettingsPayload } from './settings'
import type { BookmarkRow, SettingsPayload, SiteRuleRow } from './settings'
import type { AgentBody } from './agent-state'
import type { LiveBody } from './live'
import type { AgentStepResult } from '../../lib/browser/agent-run'
import type { LiveOutcome } from '../../lib/browser/engine'
import type { ReaderDoc, SearchHit } from '../../lib/browser/reader'

export type ApiResult<T> = { ok: true; data: T } | { ok: false; failure: FailureInfo; /** The screen cancelled it; say nothing. */ aborted: boolean }

interface CallOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  body?: unknown
  signal?: AbortSignal
  timeoutMs?: number
}

const failed = (failure: FailureInfo, aborted = false): { ok: false; failure: FailureInfo; aborted: boolean } => ({ ok: false, failure, aborted })

interface Raw { ok: true; status: number; body: unknown; res: Response }

/** One request. Never throws. Returns the parsed body (or {}) with the response, or a failure. */
async function send(path: string, opts: CallOptions, wantBody: boolean): Promise<Raw | { ok: false; failure: FailureInfo; aborted: boolean }> {
  const method = opts.method || 'GET'
  const ctl = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; ctl.abort() }, opts.timeoutMs ?? 30_000)
  const onAbort = () => ctl.abort()
  if (opts.signal) {
    if (opts.signal.aborted) ctl.abort()
    else opts.signal.addEventListener('abort', onAbort, { once: true })
  }
  try {
    let res: Response
    try {
      res = await fetch(path, {
        method, cache: 'no-store', signal: ctl.signal,
        headers: opts.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      })
    } catch {
      if (opts.signal?.aborted) return failed(describeFailure({ status: 0 }), true)
      return failed(describeFailure({ status: 0, offline: !timedOut, timedOut }))
    }
    if (!res.ok && wantBody === false) {
      const body = await res.json().catch(() => ({}))
      return failed(describeFailure({ status: res.status, body }))
    }
    if (wantBody === false) return { ok: true, status: res.status, body: null, res }
    const text = await res.text().catch(() => '')
    if (opts.signal?.aborted) return failed(describeFailure({ status: 0 }), true)
    let body: unknown = {}
    try { body = text ? JSON.parse(text) : {} } catch { body = {} }
    const said = body && typeof body === 'object' ? (body as Record<string, unknown>).ok : undefined
    if (!res.ok || said === false) return failed(describeFailure({ status: res.status || 500, body }))
    return { ok: true, status: res.status, body, res }
  } finally {
    clearTimeout(timer)
    opts.signal?.removeEventListener('abort', onAbort)
  }
}

const notUnderstood = (): { ok: false; failure: FailureInfo; aborted: boolean } =>
  failed(describeFailure({ status: 502, body: { error: 'Alpha got an answer it could not read. Try again in a moment.' } }))

/* ---------- reading and searching ---------- */

export interface ReadData { doc: ReaderDoc; finalUrl: string; images: boolean }

export async function readPage(url: string, signal?: AbortSignal): Promise<ApiResult<ReadData>> {
  const r = await send('/api/browser/read', { method: 'POST', body: { url }, signal, timeoutMs: 35_000 }, true)
  if (!r.ok) return r
  const data = cleanRead(r.body)
  return data ? { ok: true, data } : notUnderstood()
}

export interface SearchData { query: string; hits: SearchHit[]; hidden: number }

export async function searchWeb(q: string, signal?: AbortSignal): Promise<ApiResult<SearchData>> {
  const r = await send('/api/browser/search', { method: 'POST', body: { q }, signal, timeoutMs: 25_000 }, true)
  if (!r.ok) return r
  const data = cleanSearch(r.body)
  return data ? { ok: true, data } : notUnderstood()
}

/* ---------- live view and Ask Alpha ---------- */

export async function runLive(body: LiveBody, signal?: AbortSignal): Promise<ApiResult<LiveOutcome>> {
  const r = await send('/api/browser/live', { method: 'POST', body, signal, timeoutMs: 75_000 }, true)
  if (!r.ok) return r
  const data = cleanLive(r.body)
  return data ? { ok: true, data } : notUnderstood()
}

export async function runAgentStep(body: AgentBody, signal?: AbortSignal): Promise<ApiResult<AgentStepResult>> {
  const r = await send('/api/browser/agent', { method: 'POST', body, signal, timeoutMs: 75_000 }, true)
  if (!r.ok) return r
  const data = cleanAgent(r.body)
  return data ? { ok: true, data } : notUnderstood()
}

/* ---------- approvals and downloads ---------- */

export async function decideApproval(id: string, decision: 'approved' | 'denied', signal?: AbortSignal): Promise<ApiResult<true>> {
  const r = await send('/api/browser/approvals/approve', { method: 'POST', body: { id, decision }, signal, timeoutMs: 20_000 }, true)
  return r.ok ? { ok: true, data: true } : r
}

export async function listWaiting(signal?: AbortSignal): Promise<ApiResult<{ items: WaitingApproval[]; missing: boolean }>> {
  const r = await send('/api/browser/approvals', { signal, timeoutMs: 20_000 }, true)
  return r.ok ? { ok: true, data: cleanWaiting(r.body) } : r
}

export interface FileData { bytes: Uint8Array; name: string; contentType: string }

/** Save an approved download. The server only hands the file over after it finds the approval for exactly this address. */
export async function fetchApprovedFile(url: string, approvalId: string, signal?: AbortSignal): Promise<ApiResult<FileData>> {
  const r = await send('/api/browser/download', { method: 'POST', body: { url, approvalId }, signal, timeoutMs: 60_000 }, false)
  if (!r.ok) return r
  try {
    const buf = await r.res.arrayBuffer()
    if (signal?.aborted) return failed(describeFailure({ status: 0 }), true)
    return { ok: true, data: { bytes: new Uint8Array(buf), name: nameFromDisposition(r.res.headers.get('content-disposition')), contentType: r.res.headers.get('content-type') || '' } }
  } catch {
    return failed(describeFailure({ status: 502, body: { error: 'The file could not be downloaded.' } }))
  }
}

/* ---------- settings, rules and saved sites ---------- */

export async function loadSettings(signal?: AbortSignal): Promise<ApiResult<SettingsPayload>> {
  const r = await send('/api/browser/settings', { signal, timeoutMs: 20_000 }, true)
  return r.ok ? { ok: true, data: cleanSettingsPayload(r.body) } : r
}

export async function saveSettings(patch: { mode?: 'open' | 'allowlist'; aiEnabled?: boolean; readerImages?: boolean }): Promise<ApiResult<true>> {
  const r = await send('/api/browser/settings', { method: 'PUT', body: patch, timeoutMs: 20_000 }, true)
  return r.ok ? { ok: true, data: true } : r
}

export async function addRule(host: string, rule: 'allow' | 'block', note: string): Promise<ApiResult<SiteRuleRow | null>> {
  const r = await send('/api/browser/rules', { method: 'POST', body: { host, rule, note }, timeoutMs: 20_000 }, true)
  if (!r.ok) return r
  const row = (r.body as { rule?: Record<string, unknown> } | null)?.rule
  return { ok: true, data: row && typeof row.host === 'string' ? { id: String(row.id || ''), host: row.host, rule: row.rule === 'block' ? 'block' : 'allow', note: typeof row.note === 'string' ? row.note : '' } : null }
}

export async function removeRule(id: string): Promise<ApiResult<true>> {
  const r = await send('/api/browser/rules', { method: 'DELETE', body: { id }, timeoutMs: 20_000 }, true)
  return r.ok ? { ok: true, data: true } : r
}

export async function addBookmark(input: { title: string; url: string; kind: 'quick' | 'saved' }): Promise<ApiResult<BookmarkRow | null>> {
  const r = await send('/api/browser/bookmarks', { method: 'POST', body: input, timeoutMs: 20_000 }, true)
  if (!r.ok) return r
  const row = (r.body as { bookmark?: Record<string, unknown> } | null)?.bookmark
  return {
    ok: true,
    data: row && typeof row.url === 'string'
      ? { id: String(row.id || ''), title: String(row.title || row.url), url: row.url, kind: row.kind === 'saved' ? 'saved' : 'quick', position: Number(row.position) || 100, builtin: false }
      : null,
  }
}

export async function removeBookmark(id: string): Promise<ApiResult<true>> {
  const r = await send('/api/browser/bookmarks', { method: 'DELETE', body: { id }, timeoutMs: 20_000 }, true)
  return r.ok ? { ok: true, data: true } : r
}

/* ---------- the log ---------- */

export async function loadActivity(signal?: AbortSignal): Promise<ApiResult<ActivityItem[]>> {
  const r = await send('/api/browser/activity', { signal, timeoutMs: 20_000 }, true)
  return r.ok ? { ok: true, data: cleanActivity(r.body) } : r
}
