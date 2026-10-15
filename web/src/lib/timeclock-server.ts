/**
 * Server side of the time clock: the punches, breaks, undo, time on a job, pay rules, approvals lock and the PIN check. Both the
 * Team routes and the shop tablet (kiosk) route call these, so a punch behaves the same wherever it is made. Every query is
 * limited to one shop. A table or column from migration 052 that is not there yet is treated as "feature not available", never
 * as a failure of the punch itself.
 */
import { getServiceClient } from '@/lib/supabase'
import { isMissingDbObject } from '@/lib/db-missing'
import { MIN, hoursFor, isOverlong, normalizeEntry, undoableEntry } from '@/lib/timeclock'
import { checkLocation, distanceWords } from '@/lib/geo'
import type { DeviceFix, LocationCheck } from '@/lib/geo'
import { DEFAULT_RULES, normalizeRules } from '@/lib/timerules'
import type { TimeRules } from '@/lib/timerules'
import { afterWrongPin, lockMinutesLeft, MAX_PIN_FAILS, verifyPin } from '@/lib/pin'

export type Db = ReturnType<typeof getServiceClient>
export type Row = Record<string, unknown>
export interface Who { id: number; name: string; active: boolean }
export interface Reply { status: number; body: Row }

export const okReply = (body: Row = {}): Reply => ({ status: 200, body: { ok: true, ...body } })
export const badReply = (status: number, error: string, extra: Row = {}): Reply => ({ status, body: { ok: false, error, ...extra } })

export const iso = (ms: number): string => new Date(ms).toISOString()
export const cleanText = (v: unknown, max: number): string => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

/* ---------- who ---------- */

export async function findPerson(sb: Db, shopId: string, body: Row): Promise<Who | { error: string }> {
  const wanted = Number(body.staff_id)
  if (body.staff_id != null && body.staff_id !== '') {
    if (!Number.isInteger(wanted) || wanted <= 0) return { error: 'That person is not on your team.' }
    const { data, error } = await sb.from('staff').select('id,name,active').eq('shop_id', shopId).eq('id', wanted).maybeSingle()
    if (error) throw error
    if (!data) return { error: 'That person is not on your team.' }
    return { id: Number(data.id), name: String(data.name), active: data.active !== false }
  }
  const name = String(body.staff_name || '').trim().toLowerCase()
  if (!name) return { error: 'Choose who this is for.' }
  const { data, error } = await sb.from('staff').select('id,name,active').eq('shop_id', shopId).eq('active', true)
  if (error) throw error
  const hit = (data || []).find(s => String(s.name).trim().toLowerCase() === name)
  if (!hit) return { error: 'That person is not on your team.' }
  return { id: Number(hit.id), name: String(hit.name), active: true }
}

/** The person's running entry: by id first, then by name for entries made before ids were saved. */
export async function runningEntry(sb: Db, shopId: string, who: Who): Promise<Row | null> {
  const byId = await sb.from('timeclock').select('*').eq('shop_id', shopId).eq('staff_id', who.id).is('clock_out', null).order('clock_in', { ascending: false }).limit(1)
  if (byId.error) throw byId.error
  if (byId.data && byId.data[0]) return byId.data[0] as Row
  const byName = await sb.from('timeclock').select('*').eq('shop_id', shopId).is('staff_id', null).eq('staff_name', who.name).is('clock_out', null).order('clock_in', { ascending: false }).limit(1)
  if (byName.error) throw byName.error
  return (byName.data && byName.data[0]) || null
}

/* ---------- rules ---------- */

export async function loadRules(sb: Db, shopId: string): Promise<{ rules: TimeRules; available: boolean }> {
  const { data, error } = await sb.from('time_rules').select('*').eq('shop_id', shopId).maybeSingle()
  if (error) {
    if (isMissingDbObject(error)) return { rules: DEFAULT_RULES, available: false }
    throw error
  }
  return { rules: data ? normalizeRules(data) : DEFAULT_RULES, available: true }
}

export async function saveRules(sb: Db, shopId: string, userId: string, r: TimeRules): Promise<'saved' | 'unavailable'> {
  const row = {
    shop_id: shopId, week_start: r.weekStart, period_days: r.periodDays, period_anchor: r.periodAnchor || null,
    weekly_ot_min: r.weeklyOtMin, daily_ot_min: r.dailyOtMin, daily_double_min: r.dailyDoubleMin, state: r.state || null,
    location_mode: r.locationMode, geofence_lat: r.geofence ? r.geofence.lat : null, geofence_lng: r.geofence ? r.geofence.lng : null,
    geofence_radius_m: r.geofence ? r.geofence.radiusM : null, require_pin: r.requirePin, updated_by: userId, updated_at: new Date().toISOString(),
  }
  const { error } = await sb.from('time_rules').upsert(row, { onConflict: 'shop_id' })
  if (error) {
    if (isMissingDbObject(error)) return 'unavailable'
    throw error
  }
  return 'saved'
}

/* ---------- approvals lock ---------- */

/** The approved pay period that holds this moment for this person, if there is one. Without the table nothing is ever locked. */
export async function approvedPeriodAt(sb: Db, shopId: string, staffId: number | null, atIso: string): Promise<{ period_start: string } | null> {
  if (staffId === null) return null
  const { data, error } = await sb.from('time_approvals').select('period_start').eq('shop_id', shopId).eq('staff_id', staffId).lte('window_from', atIso).gt('window_to', atIso).limit(1)
  if (error) {
    if (isMissingDbObject(error)) return null
    throw error
  }
  return data && data[0] ? { period_start: String(data[0].period_start) } : null
}

export const lockedReply = (periodStart: string): Reply =>
  badReply(409, `The pay period starting ${periodStart} was approved, so its time is locked. Remove the approval first if something has to change.`, { code: 'locked' })

/* ---------- history ---------- */

export interface Change {
  entryId: number
  staffId: number | null
  staffName: string
  action: 'add' | 'edit' | 'delete' | 'undo_clock_out' | 'restore'
  before: Row | null
  after: Row | null
  reason: string
}

/** Keeps a before and after copy of a punch so a change can be seen later and a deleted punch put back. Never blocks the change itself. */
export async function logChange(sb: Db, shopId: string, userId: string, c: Change): Promise<boolean> {
  const { error } = await sb.from('time_entry_changes').insert({
    shop_id: shopId, entry_id: c.entryId, staff_id: c.staffId, staff_name: c.staffName, action: c.action,
    before_row: c.before, after_row: c.after, reason: c.reason || null, changed_by: userId,
  })
  if (error) {
    if (!isMissingDbObject(error)) console.error('[timeclock] history:', error.code || 'error')
    return false
  }
  return true
}

/* ---------- punching ---------- */

export interface PunchContext {
  nowMs: number
  note: string
  source: 'app' | 'kiosk'
  fix: DeviceFix | null
  rules: TimeRules
}

async function insertEntry(sb: Db, shopId: string, row: Row, extras: Row) {
  if (Object.keys(extras).length) {
    const first = await sb.from('timeclock').insert({ shop_id: shopId, ...row, ...extras }).select().single()
    if (!first.error || !isMissingDbObject(first.error)) return first
  }
  return sb.from('timeclock').insert({ shop_id: shopId, ...row }).select().single()
}

export async function punchIn(sb: Db, shopId: string, who: Who, c: PunchContext): Promise<Reply> {
  if (!who.active) return badReply(400, `${who.name} is no longer on the team.`)
  const open = await runningEntry(sb, shopId, who)
  if (open) {
    return isOverlong({ clock_in: String(open.clock_in), clock_out: null }, c.nowMs)
      ? badReply(409, `${who.name} is still clocked in from an earlier day. Fix that entry in Team, Timesheets first.`, { code: 'needs_fix' })
      : badReply(409, `${who.name} is already clocked in.`)
  }
  let loc: LocationCheck | null = null
  const fence = c.rules.geofence
  if (c.rules.locationMode !== 'off' && fence) {
    loc = checkLocation(fence, c.fix)
    if (c.rules.locationMode === 'require' && loc.status !== 'inside') {
      return badReply(403, loc.status === 'outside'
        ? `This device is ${distanceWords(loc.distanceM ?? 0)} from the shop, so ${who.name} cannot clock in from here.`
        : 'This device did not share where it is, so the shop cannot confirm it is at the shop. Allow location access and try again.', { code: 'location', location: loc.status })
    }
  }
  const extras: Row = { punch_source: c.source }
  if (loc) { extras.in_location = loc.status; extras.in_distance_m = loc.distanceM }
  const { data, error } = await insertEntry(sb, shopId, { staff_id: who.id, staff_name: who.name, clock_in: iso(c.nowMs), clock_out: null, note: c.note || null }, extras)
  if (error) {
    if (error.code === '23505') return badReply(409, `${who.name} is already clocked in.`)
    throw error
  }
  return okReply({ entry: data, location: loc ? loc.status : null })
}

/** Ends the job a person is working on, if any. A shop without the job-time table simply has nothing to end. */
export async function endRunningJob(sb: Db, shopId: string, who: Who, atMs: number): Promise<void> {
  const { error } = await sb.from('job_time').update({ ended_at: iso(atMs) }).eq('shop_id', shopId).eq('staff_id', who.id).is('ended_at', null)
  if (error && !isMissingDbObject(error)) throw error
}

export async function punchOut(sb: Db, shopId: string, who: Who, open: Row, nowMs: number): Promise<Reply> {
  // A day or more on the clock is a forgotten clock-out. Clocking out "now" would record a made-up shift.
  if (isOverlong({ clock_in: String(open.clock_in), clock_out: null }, nowMs)) {
    return badReply(409, `${who.name} has been clocked in for more than 24 hours, so the time looks wrong. An owner or manager can set the real clock-out in Team, Timesheets.`, { code: 'needs_fix' })
  }
  const breaksOn = 'break_minutes' in open
  const startedAt = open.break_started_at ? Date.parse(String(open.break_started_at)) : NaN
  const doneBreak = Math.max(0, Number(open.break_minutes) || 0)
  // A break still running is ended first so its minutes come off the day.
  const owed = !isNaN(startedAt) ? Math.max(0, Math.round((nowMs - startedAt) / MIN)) : 0
  const totalBreak = doneBreak + owed
  const hours = hoursFor(String(open.clock_in), iso(nowMs), totalBreak)
  const patch: Row = { clock_out: iso(nowMs), hours_worked: hours }
  if (breaksOn) { patch.break_minutes = totalBreak; patch.break_started_at = null }
  const { data, error } = await sb.from('timeclock').update(patch).eq('id', open.id as number).eq('shop_id', shopId).is('clock_out', null).select().maybeSingle()
  if (error) throw error
  if (!data) return badReply(409, `${who.name} is not clocked in.`)
  await endRunningJob(sb, shopId, who, nowMs)
  return okReply({ entry: data, hours_worked: hours })
}

export async function breakOp(sb: Db, shopId: string, who: Who, open: Row, op: 'start' | 'end', nowMs: number): Promise<Reply> {
  if (isOverlong({ clock_in: String(open.clock_in), clock_out: null }, nowMs)) {
    return badReply(409, `${who.name} has been clocked in for more than 24 hours, so the time looks wrong. An owner or manager can set the real clock-out in Team, Timesheets.`, { code: 'needs_fix' })
  }
  if (!('break_minutes' in open)) return badReply(400, 'Breaks are not turned on yet.', { code: 'breaks_unavailable' })
  const startedAt = open.break_started_at ? Date.parse(String(open.break_started_at)) : NaN
  const doneBreak = Math.max(0, Number(open.break_minutes) || 0)
  if (op === 'start') {
    if (!isNaN(startedAt)) return badReply(409, `${who.name} is already on a break.`)
    const { data, error } = await sb.from('timeclock').update({ break_started_at: iso(nowMs) }).eq('id', open.id as number).eq('shop_id', shopId).is('clock_out', null).select().maybeSingle()
    if (error) throw error
    if (!data) return badReply(409, `${who.name} is not clocked in.`)
    return okReply({ entry: data })
  }
  if (isNaN(startedAt)) return badReply(409, `${who.name} is not on a break.`)
  const minutes = Math.max(0, Math.round((nowMs - startedAt) / MIN))
  const { data, error } = await sb.from('timeclock').update({ break_minutes: doneBreak + minutes, break_started_at: null }).eq('id', open.id as number).eq('shop_id', shopId).is('clock_out', null).select().maybeSingle()
  if (error) throw error
  if (!data) return badReply(409, `${who.name} is not clocked in.`)
  return okReply({ entry: data })
}

/** Takes back a clock-out made in the last 15 minutes, as long as the person is not clocked in again and the pay period is not approved. */
export async function undoClockOut(sb: Db, shopId: string, userId: string, who: Who, nowMs: number): Promise<Reply> {
  const open = await runningEntry(sb, shopId, who)
  if (open) return badReply(409, `${who.name} is clocked in.`)
  const recent = await sb.from('timeclock').select('*').eq('shop_id', shopId).eq('staff_id', who.id).not('clock_out', 'is', null).order('clock_out', { ascending: false }).limit(3)
  if (recent.error) throw recent.error
  const rows = (recent.data || []) as Row[]
  const target = undoableEntry(rows.map(normalizeEntry), nowMs)
  if (!target) return badReply(409, 'There is no clock-out from the last 15 minutes to undo. An owner or manager can fix the entry in Timesheets.', { code: 'too_late' })
  const before = rows.find(r => Number(r.id) === target.id) as Row
  const locked = await approvedPeriodAt(sb, shopId, who.id, String(before.clock_in))
  if (locked) return lockedReply(locked.period_start)
  const { data, error } = await sb.from('timeclock').update({ clock_out: null, hours_worked: null }).eq('id', target.id).eq('shop_id', shopId).not('clock_out', 'is', null).select().maybeSingle()
  if (error) {
    if (error.code === '23505') return badReply(409, `${who.name} is already clocked in.`)
    throw error
  }
  if (!data) return badReply(409, 'That clock-out was already changed. Reload and look again.')
  await logChange(sb, shopId, userId, { entryId: target.id, staffId: who.id, staffName: who.name, action: 'undo_clock_out', before, after: data as Row, reason: 'Clock-out taken back' })
  return okReply({ entry: data })
}

/* ---------- time on a job ---------- */

export const jobCar = (j: Row): string => [j.vehicle_year, j.vehicle_make, j.vehicle_model].map(v => String(v ?? '').trim()).filter(Boolean).join(' ')
export const jobLabelOf = (j: Row): string => {
  const ro = String(j.ro_number ?? '').trim()
  return [ro ? `RO ${ro.replace(/^RO[-\s]*/i, '')}` : '', jobCar(j)].filter(Boolean).join(', ').slice(0, 300) || 'Repair order'
}

export async function startJob(sb: Db, shopId: string, who: Who, open: Row | null, jobId: string, note: string, nowMs: number): Promise<Reply> {
  if (!open) return badReply(409, `${who.name} needs to be clocked in before starting a job.`, { code: 'not_clocked_in' })
  if (open.break_started_at) return badReply(409, `${who.name} is on a break. End the break first.`, { code: 'on_break' })
  const job = await sb.from('jobs').select('id,ro_number,vehicle_year,vehicle_make,vehicle_model,status').eq('shop_id', shopId).eq('id', jobId).maybeSingle()
  if (job.error) throw job.error
  if (!job.data) return badReply(404, 'That repair order was not found.')
  const running = await sb.from('job_time').select('id,job_id').eq('shop_id', shopId).eq('staff_id', who.id).is('ended_at', null).limit(1)
  if (running.error) {
    if (isMissingDbObject(running.error)) return badReply(400, 'Time on a job needs a database update. Ask whoever set up the app to apply it.', { code: 'jobtime_unavailable' })
    throw running.error
  }
  const current = running.data && running.data[0]
  if (current && String(current.job_id) === jobId) return okReply({ segment: current, already: true })
  // Moving to a different job closes the one before it at the same moment, so no minute is counted twice.
  if (current) await endRunningJob(sb, shopId, who, nowMs)
  const { data, error } = await sb.from('job_time').insert({
    shop_id: shopId, staff_id: who.id, staff_name: who.name, entry_id: Number(open.id), job_id: jobId, job_label: jobLabelOf(job.data as Row),
    started_at: iso(nowMs), note: note || null,
  }).select().single()
  if (error) {
    if (error.code === '23505') return badReply(409, `${who.name} is already on a job. Reload and look again.`)
    throw error
  }
  return okReply({ segment: data })
}

export async function stopJob(sb: Db, shopId: string, who: Who, nowMs: number): Promise<Reply> {
  const { data, error } = await sb.from('job_time').update({ ended_at: iso(nowMs) }).eq('shop_id', shopId).eq('staff_id', who.id).is('ended_at', null).select()
  if (error) {
    if (isMissingDbObject(error)) return badReply(400, 'Time on a job needs a database update. Ask whoever set up the app to apply it.', { code: 'jobtime_unavailable' })
    throw error
  }
  if (!data || data.length === 0) return badReply(409, `${who.name} is not on a job.`)
  return okReply({ segment: data[0] })
}

/* ---------- PINs ---------- */

export type PinCheck = { ok: true } | { ok: false; code: 'no_pin' | 'locked' | 'wrong' | 'unavailable'; error: string }

export async function checkPin(sb: Db, shopId: string, who: Who, pin: string, nowMs: number): Promise<PinCheck> {
  const { data, error } = await sb.from('staff_pins').select('pin_hash,failed_count,locked_until').eq('shop_id', shopId).eq('staff_id', who.id).maybeSingle()
  if (error) {
    if (isMissingDbObject(error)) return { ok: false, code: 'unavailable', error: 'PINs need a database update. Ask whoever set up the app to apply it.' }
    throw error
  }
  if (!data) return { ok: false, code: 'no_pin', error: `${who.name} does not have a PIN yet. Ask a manager to set one in Team, People.` }
  const wait = lockMinutesLeft(data.locked_until as string | null, nowMs)
  if (wait > 0) return { ok: false, code: 'locked', error: `Too many wrong PINs. Try again in ${wait} ${wait === 1 ? 'minute' : 'minutes'}.` }
  if (verifyPin(pin, String(data.pin_hash))) {
    if (Number(data.failed_count) > 0 || data.locked_until) await sb.from('staff_pins').update({ failed_count: 0, locked_until: null }).eq('shop_id', shopId).eq('staff_id', who.id)
    return { ok: true }
  }
  const next = afterWrongPin(Number(data.failed_count) || 0, nowMs)
  await sb.from('staff_pins').update({ failed_count: next.failed, locked_until: next.lockedUntil ? iso(next.lockedUntil) : null }).eq('shop_id', shopId).eq('staff_id', who.id)
  if (next.lockedUntil) return { ok: false, code: 'locked', error: 'Too many wrong PINs. This PIN is locked for 5 minutes.' }
  const left = MAX_PIN_FAILS - next.failed
  return { ok: false, code: 'wrong', error: `That PIN is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` }
}
