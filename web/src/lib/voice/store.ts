/**
 * Everything the receptionist reads from and writes to the database.
 *
 * Each function takes the database client as an argument, so the same code runs in the webhooks and under test with a fake.
 * Every query is scoped by shop_id. Tables from migrations 037 to 039 may not exist yet: each function reports that
 * (`unavailable`) instead of throwing, so the assistant keeps working with its safe built-in defaults and the screens can
 * say plainly that a database update is needed.
 */
import { normalizeRules, phoneKey, phoneLikePattern } from './rules.ts'
import type { VoiceRules } from './rules.ts'
import type { BookedAppointment } from './hours.ts'
import type { Captured, Outcome } from './engine.ts'

export type Db = { from: (table: string) => any }

export type ErrKind = 'missing' | 'duplicate' | 'other'

/** What kind of database error is this? A missing table or column is not a failure of the request. */
export function errKind(err: unknown): ErrKind | null {
  if (!err) return null
  const e = err as { code?: string; message?: string; details?: string }
  const code = String(e.code || '')
  const text = `${e.message || ''} ${e.details || ''}`.toLowerCase()
  if (code === '23505' || text.includes('duplicate key')) return 'duplicate'
  if (['42P01', '42703', 'PGRST204', 'PGRST205', 'PGRST200'].includes(code)) return 'missing'
  if (text.includes('schema cache') || text.includes('does not exist') || text.includes('could not find the')) return 'missing'
  return 'other'
}

/* ---------------- rules ---------------- */

export interface LoadedRules { rules: VoiceRules; saved: boolean; unavailable: boolean; failed: boolean }

export async function loadRules(db: Db, shopId: string): Promise<LoadedRules> {
  const defaults = normalizeRules(null)
  try {
    const { data, error } = await db.from('voice_rules').select('rules').eq('shop_id', shopId).maybeSingle()
    if (error) {
      const kind = errKind(error)
      return { rules: defaults, saved: false, unavailable: kind === 'missing', failed: kind !== 'missing' }
    }
    if (!data) return { rules: defaults, saved: false, unavailable: false, failed: false }
    return { rules: normalizeRules(data.rules), saved: true, unavailable: false, failed: false }
  } catch {
    return { rules: defaults, saved: false, unavailable: false, failed: true }
  }
}

export type SaveRulesResult = { ok: true } | { ok: false; unavailable: boolean; message: string }

export async function saveRules(db: Db, shopId: string, rules: VoiceRules, userId: string | null): Promise<SaveRulesResult> {
  const row = { shop_id: shopId, rules, updated_by: userId, updated_at: new Date().toISOString() }
  const { error } = await db.from('voice_rules').upsert(row, { onConflict: 'shop_id' })
  if (!error) return { ok: true }
  const kind = errKind(error)
  return kind === 'missing'
    ? { ok: false, unavailable: true, message: 'Saving these rules needs a database update first.' }
    : { ok: false, unavailable: false, message: 'The rules could not be saved. Try again.' }
}

/* ---------------- thread state (pause and needs-a-person) ---------------- */

export interface ThreadState {
  pausedUntil: string | null
  pauseReason: string | null
  needsPerson: boolean
  needsReason: string | null
  needsSince: string | null
  /** A person said "let the assistant answer again". Human texts sent before this no longer pause the assistant. */
  resumedAt: string | null
}

export const EMPTY_THREAD: ThreadState = { pausedUntil: null, pauseReason: null, needsPerson: false, needsReason: null, needsSince: null, resumedAt: null }

export async function getThreadState(db: Db, shopId: string, channel: 'sms' | 'call', key: string): Promise<{ state: ThreadState; unavailable: boolean }> {
  if (!key) return { state: EMPTY_THREAD, unavailable: false }
  try {
    const { data, error } = await db.from('ai_thread_state').select('paused_until,pause_reason,needs_person,needs_reason,needs_since,convo')
      .eq('shop_id', shopId).eq('channel', channel).eq('contact_key', key).maybeSingle()
    if (error) return { state: EMPTY_THREAD, unavailable: errKind(error) === 'missing' }
    if (!data) return { state: EMPTY_THREAD, unavailable: false }
    return {
      state: {
        pausedUntil: data.paused_until || null, pauseReason: data.pause_reason || null,
        needsPerson: data.needs_person === true, needsReason: data.needs_reason || null, needsSince: data.needs_since || null,
        resumedAt: data.convo && typeof data.convo.resumed_at === 'string' ? data.convo.resumed_at : null,
      },
      unavailable: false,
    }
  } catch {
    return { state: EMPTY_THREAD, unavailable: false }
  }
}

export async function setThreadState(db: Db, shopId: string, channel: 'sms' | 'call', key: string, patch: Partial<ThreadState>, userId: string | null = null): Promise<{ ok: boolean; unavailable: boolean }> {
  if (!key) return { ok: false, unavailable: false }
  const row: Record<string, unknown> = { shop_id: shopId, channel, contact_key: key, updated_at: new Date().toISOString(), updated_by: userId }
  if ('pausedUntil' in patch) row.paused_until = patch.pausedUntil
  if ('pauseReason' in patch) row.pause_reason = patch.pauseReason
  if ('needsPerson' in patch) row.needs_person = patch.needsPerson === true
  if ('needsReason' in patch) row.needs_reason = patch.needsReason
  if ('needsSince' in patch) row.needs_since = patch.needsSince
  if ('resumedAt' in patch) row.convo = { resumed_at: patch.resumedAt }
  try {
    const { error } = await db.from('ai_thread_state').upsert(row, { onConflict: 'shop_id,channel,contact_key' })
    if (!error) return { ok: true, unavailable: false }
    return { ok: false, unavailable: errKind(error) === 'missing' }
  } catch {
    return { ok: false, unavailable: false }
  }
}

/* ---------------- text history, rate limits and human takeover ---------------- */

export interface ThreadMsg {
  direction: 'inbound' | 'outbound'
  body: string
  created_at: string
  ai_handled: boolean
  from_address: string
  to_address: string
}

/** The shop's recent text messages (both directions), newest first. Filtered to one contact by the caller. */
export async function recentTexts(db: Db, shopId: string, sinceIso: string, limit = 400): Promise<{ rows: ThreadMsg[]; ok: boolean }> {
  try {
    const { data, error } = await db.from('messages')
      .select('direction,body,created_at,ai_handled,from_address,to_address,channel')
      .eq('shop_id', shopId).gte('created_at', sinceIso).order('created_at', { ascending: false }).limit(limit)
    if (error) return { rows: [], ok: false }
    const rows = ((data || []) as Record<string, unknown>[])
      .filter(r => (r.channel || 'sms') === 'sms')
      .map(r => ({
        direction: (r.direction === 'inbound' ? 'inbound' : 'outbound') as 'inbound' | 'outbound',
        body: String(r.body || ''), created_at: String(r.created_at || ''), ai_handled: r.ai_handled === true,
        from_address: String(r.from_address || ''), to_address: String(r.to_address || ''),
      }))
    return { rows, ok: true }
  } catch {
    return { rows: [], ok: false }
  }
}

export function forContact(rows: ThreadMsg[], key: string): ThreadMsg[] {
  return rows.filter(r => phoneKey(r.direction === 'inbound' ? r.from_address : r.to_address) === key)
}

export interface ThreadFacts {
  /** AI texts sent to this number inside the rate-limit window. */
  aiRepliesInWindow: number
  /** The assistant has texted this number before (so the AI notice was already given). */
  hasPriorAi: boolean
  /** When a person last sent this number a text, if inside the takeover window. */
  humanAt: number | null
  recentAiBodies: string[]
  /** Oldest first, newest last. */
  history: { role: 'user' | 'assistant'; content: string; at: number }[]
}

export function threadFacts(contactRows: ThreadMsg[], rules: VoiceRules, now: Date): ThreadFacts {
  const nowMs = now.getTime()
  const windowMs = rules.max_replies.window_hours * 3_600_000
  const takeoverMs = rules.takeover_hours * 3_600_000
  let aiRepliesInWindow = 0
  let hasPriorAi = false
  let humanAt: number | null = null
  const recentAiBodies: string[] = []
  for (const m of contactRows) {
    const t = Date.parse(m.created_at)
    if (!Number.isFinite(t)) continue
    if (m.direction === 'outbound' && m.ai_handled) {
      hasPriorAi = true
      if (nowMs - t <= windowMs) aiRepliesInWindow += 1
      if (recentAiBodies.length < 6) recentAiBodies.push(m.body)
    } else if (m.direction === 'outbound' && nowMs - t <= takeoverMs) {
      if (humanAt === null || t > humanAt) humanAt = t
    }
  }
  const history = contactRows
    .map(m => ({ role: (m.direction === 'inbound' ? 'user' : 'assistant') as 'user' | 'assistant', content: m.body, at: Date.parse(m.created_at) }))
    .filter(h => Number.isFinite(h.at) && h.content.trim())
    .sort((a, b) => a.at - b.at)
  return { aiRepliesInWindow, hasPriorAi, humanAt, recentAiBodies, history }
}

/* ---------------- who is this, and what is open ---------------- */

export interface CustomerContext { id: string | null; name: string; openJobs: string[] }

export async function customerContext(db: Db, shopId: string, phone: string, allowJobs: boolean): Promise<CustomerContext> {
  const key = phoneKey(phone)
  const empty: CustomerContext = { id: null, name: '', openJobs: [] }
  if (key.length < 10) return empty
  try {
    const { data } = await db.from('customers').select('id,name,phone').eq('shop_id', shopId).ilike('phone', phoneLikePattern(phone)).limit(1)
    const c = (data || [])[0] as { id?: string; name?: string } | undefined
    if (!c?.id) return empty
    let openJobs: string[] = []
    if (allowJobs) {
      const { data: jobs } = await db.from('jobs').select('status,concern,vehicle_year,vehicle_make,vehicle_model')
        .eq('shop_id', shopId).eq('customer_id', c.id).not('status', 'in', '("Paid","Closed")').limit(3)
      openJobs = ((jobs || []) as Record<string, unknown>[]).map(j => `${j.status || 'Open'}: ${j.concern || 'work'} (${[j.vehicle_year, j.vehicle_make, j.vehicle_model].filter(Boolean).join(' ')})`)
    }
    return { id: c.id, name: String(c.name || ''), openJobs }
  } catch {
    return empty
  }
}

export async function upcomingAppointments(db: Db, shopId: string, fromYmd: string, toYmd: string): Promise<BookedAppointment[]> {
  try {
    let res = await db.from('appointments').select('date,time,duration,status').eq('shop_id', shopId).gte('date', fromYmd).lte('date', toYmd).limit(500)
    if (res.error && errKind(res.error) === 'missing') {
      res = await db.from('appointments').select('date,time,status').eq('shop_id', shopId).gte('date', fromYmd).lte('date', toYmd).limit(500)
    }
    if (res.error) return []
    return (res.data || []) as BookedAppointment[]
  } catch {
    return []
  }
}

/* ---------------- interactions ---------------- */

export interface InteractionRow {
  id: string
  shop_id: string
  channel: 'call' | 'sms'
  ref_id: string
  contact_key: string
  contact_phone: string | null
  contact_name: string | null
  customer_id: string | null
  started_at: string
  ended_at: string | null
  outcome: Outcome
  needs_person: boolean
  needs_reason: string | null
  needs_resolved_at: string | null
  summary: string | null
  captured: Partial<Captured>
  rules_fired: string[]
  detail: Record<string, any>
  review: 'good' | 'bad' | null
  seen_at: string | null
  updated_at: string
}

export async function openInteraction(
  db: Db, shopId: string,
  input: { channel: 'call' | 'sms'; refId: string; contactPhone: string; contactName?: string; customerId?: string | null; startedAt?: string },
): Promise<{ row: InteractionRow | null; created: boolean; unavailable: boolean }> {
  const row = {
    shop_id: shopId, channel: input.channel, ref_id: input.refId, contact_key: phoneKey(input.contactPhone),
    contact_phone: input.contactPhone.slice(0, 40), contact_name: input.contactName || null, customer_id: input.customerId || null,
    started_at: input.startedAt || new Date().toISOString(), outcome: 'answered', detail: {},
  }
  try {
    const ins = await db.from('ai_interactions').insert(row).select('*').maybeSingle()
    if (!ins.error && ins.data) return { row: ins.data as InteractionRow, created: true, unavailable: false }
    const kind = errKind(ins.error)
    if (kind === 'missing') return { row: null, created: false, unavailable: true }
    if (kind === 'duplicate') {
      const { data } = await db.from('ai_interactions').select('*').eq('shop_id', shopId).eq('channel', input.channel).eq('ref_id', input.refId).maybeSingle()
      return { row: (data as InteractionRow) || null, created: false, unavailable: false }
    }
    return { row: null, created: false, unavailable: false }
  } catch {
    return { row: null, created: false, unavailable: false }
  }
}

export async function latestSmsInteraction(db: Db, shopId: string, key: string, sinceIso: string): Promise<InteractionRow | null> {
  try {
    const { data, error } = await db.from('ai_interactions').select('*').eq('shop_id', shopId).eq('channel', 'sms').eq('contact_key', key)
      .gte('updated_at', sinceIso).order('updated_at', { ascending: false }).limit(1)
    if (error) return null
    return ((data || [])[0] as InteractionRow) || null
  } catch {
    return null
  }
}

export async function getInteractionByRef(db: Db, shopId: string, channel: 'call' | 'sms', refId: string): Promise<InteractionRow | null> {
  try {
    const { data } = await db.from('ai_interactions').select('*').eq('shop_id', shopId).eq('channel', channel).eq('ref_id', refId).maybeSingle()
    return (data as InteractionRow) || null
  } catch {
    return null
  }
}

export async function patchInteraction(db: Db, shopId: string, id: string, patch: Record<string, unknown>): Promise<boolean> {
  try {
    const { error } = await db.from('ai_interactions').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).eq('shop_id', shopId)
    return !error
  } catch {
    return false
  }
}

/** True for exactly one caller: the one that flips an empty claim column. Makes emails and text-backs safe to retry. */
export async function claim(db: Db, shopId: string, id: string, column: 'summary_emailed_at' | 'alert_emailed_at' | 'textback_sent_at' | 'briefed_at'): Promise<boolean> {
  try {
    const { data, error } = await db.from('ai_interactions').update({ [column]: new Date().toISOString() })
      .eq('id', id).eq('shop_id', shopId).is(column, null).select('id')
    if (error) return false
    return Array.isArray(data) && data.length > 0
  } catch {
    return false
  }
}

export function unionFired(a: string[] | null | undefined, b: string[]): string[] {
  const out = [...(a || [])]
  for (const x of b) if (!out.includes(x)) out.push(x)
  return out.slice(0, 40)
}

/* ---------------- bookings ---------------- */

export interface BookingInput {
  interactionId: string | null
  channel: 'call' | 'sms'
  kind: 'request' | 'booked'
  customerId: string | null
  customerName: string
  phone: string
  vehicle: string
  problem: string
  preferredText: string
  slotDate: string | null
  slotTime: string | null
}

export async function saveBooking(db: Db, shopId: string, b: BookingInput): Promise<{ id: string | null; duplicate: boolean; unavailable: boolean }> {
  const row = {
    shop_id: shopId, interaction_id: b.interactionId, channel: b.channel, kind: b.kind, status: 'pending',
    customer_id: b.customerId, customer_name: b.customerName.slice(0, 80) || null, phone: b.phone.slice(0, 40) || null,
    vehicle: b.vehicle.slice(0, 80) || null, problem: b.problem.slice(0, 400) || null, preferred_text: b.preferredText.slice(0, 160) || null,
    slot_date: b.slotDate, slot_time: b.slotTime,
  }
  try {
    const ins = await db.from('ai_booking_requests').insert(row).select('id').maybeSingle()
    if (!ins.error && ins.data) return { id: String(ins.data.id), duplicate: false, unavailable: false }
    const kind = errKind(ins.error)
    if (kind === 'missing') return { id: null, duplicate: false, unavailable: true }
    if (kind === 'duplicate' && b.interactionId) {
      const { data } = await db.from('ai_booking_requests').select('id').eq('shop_id', shopId).eq('interaction_id', b.interactionId).maybeSingle()
      return { id: data?.id ? String(data.id) : null, duplicate: true, unavailable: false }
    }
    return { id: null, duplicate: false, unavailable: false }
  } catch {
    return { id: null, duplicate: false, unavailable: false }
  }
}

export async function patchBooking(db: Db, shopId: string, id: string, patch: Record<string, unknown>): Promise<boolean> {
  try {
    const { error } = await db.from('ai_booking_requests').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).eq('shop_id', shopId)
    return !error
  } catch {
    return false
  }
}

export interface NewAppointment {
  customerName: string
  customerId: string | null
  phone: string
  vehicle: string
  service: string
  date: string
  time: string
  notes: string
}

/** Puts an appointment on the schedule, in the same shape the Schedule screen and Ask Alpha use. */
export async function insertAppointment(db: Db, shopId: string, a: NewAppointment): Promise<{ id: string | null; error: string }> {
  const now = new Date().toISOString()
  const full = {
    customer_name: a.customerName || 'New customer', customer_id: a.customerId, vehicle: a.vehicle, service: a.service,
    date: a.date, time: a.time, scheduled_date: a.date, scheduled_time: a.time, status: 'Scheduled', notes: a.notes,
    phone: a.phone || null, shop_id: shopId, created_at: now, updated_at: now,
  }
  try {
    let res = await db.from('appointments').insert(full).select('id').maybeSingle()
    if (res.error && errKind(res.error) === 'missing') {
      const { scheduled_date: _d, scheduled_time: _t, ...lean } = full
      void _d; void _t
      res = await db.from('appointments').insert(lean).select('id').maybeSingle()
    }
    if (res.error) return { id: null, error: 'The appointment could not be saved.' }
    return { id: res.data?.id ? String(res.data.id) : null, error: '' }
  } catch {
    return { id: null, error: 'The appointment could not be saved.' }
  }
}
