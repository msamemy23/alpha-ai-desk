/**
 * Deleting a call from the Inbox call log.
 *
 * A call can sit in the log as a Telnyx recording (`rec-…`), an entry from the activity log (`activity-…`) or a call the AI answered (`ai-…`),
 * and the log copies all three in again every time Messages opens. So a delete does three things, in this order:
 *   1. writes the call's id on the "do not bring back" list (`deleted_calls`), so the sync skips it;
 *   2. removes the log row;
 *   3. removes the AI call record, when there is one.
 * If step 1 cannot be written, nothing is deleted: a call that comes back after a delete would be worse than no delete.
 *
 * What stays: the recording at the phone company, the customer, their texts, and the assistant's own note about what it booked or flagged
 * (that is its audit trail). No `@/` imports, so `node --test` runs exactly this code with a fake database.
 */

import { missingSchema } from './schema-missing.ts'

type Db = { from: (table: string) => any }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const AI_ID = /^[A-Za-z0-9:._-]{1,196}$/

/** Calls that ended one way or another. Anything else was still going when it was last written to. */
const FINISHED = ['ended', 'completed', 'complete', 'failed', 'no-answer', 'no_answer', 'busy', 'canceled', 'cancelled', 'error', 'stopped', 'hangup', 'done']
/** A call row nobody finished (a crash, a dropped line) stops counting as live after this long, so it can still be cleaned up. */
export const LIVE_FOR_MS = 3 * 60 * 60 * 1000

/** The time an AI call started, from the shape the column holds: milliseconds, seconds or text. */
export function startedMs(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : /^\d+(\.\d+)?$/.test(String(value)) ? Number(value) : Date.parse(String(value))
  if (!Number.isFinite(n) || n <= 0) return null
  return n < 1e12 ? n * 1000 : n
}

/** True while the AI is still on that call. Deleting it then would pull the record out from under the call. */
export function isLiveCall(status: unknown, started: unknown, now: number): boolean {
  const s = String(status ?? '').toLowerCase().trim()
  if (FINISHED.includes(s)) return false
  const t = startedMs(started)
  if (t === null) return false
  return now - t < LIVE_FOR_MS
}

export type Target = { kind: 'ai'; aiId: string } | { kind: 'log'; logId: string }

/** The id the Inbox sends: `ai-<id>` for a call only the AI knows, or the id of a call-log row. Anything else is refused. */
export function parseTarget(id: unknown): Target | null {
  const s = typeof id === 'string' ? id.trim() : ''
  if (s.startsWith('ai-')) {
    const rest = s.slice(3)
    return AI_ID.test(rest) ? { kind: 'ai', aiId: rest } : null
  }
  return UUID.test(s) ? { kind: 'log', logId: s } : null
}

export type DeleteResult =
  | { ok: true; removed: { log: number; ai: number }; already: boolean }
  | { ok: false; status: number; code: 'bad_id' | 'live' | 'needs_update' | 'failed'; error: string }

const fail = (status: number, code: Extract<DeleteResult, { ok: false }>['code'], error: string): DeleteResult => ({ ok: false, status, code, error })

export async function deleteCallRecord(db: Db, shopId: string, userId: string | null, id: unknown, now: Date = new Date()): Promise<DeleteResult> {
  const target = parseTarget(id)
  if (!target) return fail(400, 'bad_id', 'That call could not be found.')

  // Work out which log ids and which AI call this record stands for.
  let aiId: string | null = target.kind === 'ai' ? target.aiId : null
  const callIds = new Set<string>()
  if (target.kind === 'ai') callIds.add(`ai-${target.aiId}`)
  else {
    const { data, error } = await db.from('call_history').select('id,call_id').eq('shop_id', shopId).eq('id', target.logId).maybeSingle()
    if (error) return fail(500, 'failed', 'The call could not be deleted. Try again.')
    if (data?.call_id) {
      callIds.add(String(data.call_id))
      if (String(data.call_id).startsWith('ai-') && AI_ID.test(String(data.call_id).slice(3))) aiId = String(data.call_id).slice(3)
    }
  }

  if (aiId) {
    const { data: ai, error } = await db.from('ai_calls').select('id,status,started_at').eq('shop_id', shopId).eq('id', aiId).maybeSingle()
    if (error) return fail(500, 'failed', 'The call could not be deleted. Try again.')
    if (ai && isLiveCall(ai.status, ai.started_at, now.getTime())) return fail(409, 'live', 'The assistant is still on this call. Delete it after the call ends.')
  }

  if (callIds.size === 0 && !aiId) return { ok: true, removed: { log: 0, ai: 0 }, already: true }

  // 1. The "do not bring back" list first. Without it the next sync would copy the call straight back in.
  if (callIds.size > 0) {
    const rows = [...callIds].map(call_id => ({ shop_id: shopId, call_id, deleted_by: userId, deleted_at: now.toISOString() }))
    const { error } = await db.from('deleted_calls').upsert(rows, { onConflict: 'shop_id,call_id', ignoreDuplicates: true })
    if (error) {
      if (missingSchema(error)) return fail(503, 'needs_update', 'Deleting calls needs a database update first. Nothing was deleted.')
      return fail(500, 'failed', 'The call could not be deleted. Nothing was removed. Try again.')
    }
  }

  // 2. The log row.
  let log = 0
  if (callIds.size > 0) {
    const { data, error } = await db.from('call_history').delete().eq('shop_id', shopId).in('call_id', [...callIds]).select('id')
    if (error) return fail(500, 'failed', 'The call could not be fully deleted. Try again.')
    log = Array.isArray(data) ? data.length : 0
  }

  // 3. The AI call record.
  let ai = 0
  if (aiId) {
    const { data, error } = await db.from('ai_calls').delete().eq('shop_id', shopId).eq('id', aiId).select('id')
    if (error) return fail(500, 'failed', 'The call could not be fully deleted. Try again.')
    ai = Array.isArray(data) ? data.length : 0
  }

  return { ok: true, removed: { log, ai }, already: log + ai === 0 }
}

/** The ids the owner deleted. A sync drops these before it writes. If the list cannot be read, nothing is dropped (the sync is best-effort anyway). */
export async function loadDeletedCallIds(db: Db, shopId: string): Promise<Set<string>> {
  try {
    const { data, error } = await db.from('deleted_calls').select('call_id').eq('shop_id', shopId).limit(20000)
    if (error || !Array.isArray(data)) return new Set()
    return new Set(data.map((r: { call_id: unknown }) => String(r.call_id)))
  } catch {
    return new Set()
  }
}

/** Rows a sync is about to write, without the ones the owner deleted. */
export function withoutDeleted<T extends { call_id?: unknown }>(rows: T[], gone: Set<string>): T[] {
  return gone.size === 0 ? rows : rows.filter(r => !gone.has(String(r.call_id)))
}

/** Who may delete a call: the people who run the shop. */
export const CAN_DELETE_CALLS = ['owner', 'admin', 'manager']
