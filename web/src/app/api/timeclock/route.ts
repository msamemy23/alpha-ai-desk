import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { HOUR_MS, entriesFor, hoursFor, normalizeEntry, stampNote, validateEntry, workedMinutes } from '@/lib/timeclock'
import type { ClockEntry } from '@/lib/timeclock'
import { readFix } from '@/lib/geo'
import { isMissingDbObject } from '@/lib/db-missing'
import { audit } from '@/lib/people-audit'
import {
  approvedPeriodAt, breakOp, cleanText, findPerson, iso, loadRules, lockedReply, logChange, punchIn, punchOut, runningEntry, startJob, stopJob, undoClockOut,
} from '@/lib/timeclock-server'
import type { Reply, Who } from '@/lib/timeclock-server'

export const dynamic = 'force-dynamic'

type Db = ReturnType<typeof getServiceClient>
type Row = Record<string, unknown>

/** Changing what was punched is a manager's job. Anyone on the team (not a viewer) can clock people in and out. */
const CAN_EDIT = new Set(['owner', 'admin', 'manager'])
/** Longest window one request may ask for, so a bad request cannot pull the whole table. */
const MAX_RANGE_MS = 100 * 24 * HOUR_MS

const fail = (status: number, error: string, extra: Row = {}) => NextResponse.json({ ok: false, error, ...extra }, { status })
const send = (r: Reply) => NextResponse.json(r.body, { status: r.status })

function problem(e: unknown, what: string) {
  console.error(`[timeclock] ${what}:`, e instanceof Error ? e.message : e)
  return fail(500, 'The time clock could not do that. Try again in a moment.')
}

/** Break columns come from migration 035. Until it is applied the screens hide the break buttons. */
let breaksKnown = false
async function breaksAvailable(sb: Db): Promise<boolean> {
  if (breaksKnown) return true
  const { error } = await sb.from('timeclock').select('break_minutes').limit(1)
  if (!error) breaksKnown = true
  return !error
}

async function entriesInWindow(sb: Db, shopId: string, fromMs: number, toMs: number): Promise<Row[]> {
  const { data, error } = await sb
    .from('timeclock')
    .select('*')
    .eq('shop_id', shopId)
    .or(`clock_out.is.null,and(clock_in.gte.${iso(fromMs)},clock_in.lt.${iso(toMs)})`)
    .order('clock_in', { ascending: true })
    .limit(3000)
  if (error) throw error
  return (data || []) as Row[]
}

/** Time on jobs that started in the window, plus anything still running. Without migration 052 the answer is "not available", not "none". */
async function jobTimeInWindow(sb: Db, shopId: string, fromMs: number, toMs: number): Promise<{ available: boolean; segments: Row[] }> {
  const { data, error } = await sb
    .from('job_time')
    .select('*')
    .eq('shop_id', shopId)
    .or(`ended_at.is.null,and(started_at.gte.${iso(fromMs)},started_at.lt.${iso(toMs)})`)
    .order('started_at', { ascending: true })
    .limit(3000)
  if (error) {
    if (isMissingDbObject(error)) return { available: false, segments: [] }
    throw error
  }
  return { available: true, segments: (data || []) as Row[] }
}

/** All the time ever logged on specific repair orders, so a job billed this week still counts work done last week. */
async function jobTimeForJobs(sb: Db, shopId: string, ids: string[]): Promise<Row[]> {
  const out: Row[] = []
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await sb.from('job_time').select('*').eq('shop_id', shopId).in('job_id', ids.slice(i, i + 100)).limit(5000)
    if (error) throw error
    out.push(...((data || []) as Row[]))
  }
  return out
}

async function approvalsInWindow(sb: Db, shopId: string, fromMs: number, toMs: number): Promise<{ available: boolean; rows: Row[] }> {
  const { data, error } = await sb
    .from('time_approvals')
    .select('staff_id,period_start,period_days,window_from,window_to,minutes_total,approved_by,approved_at,note')
    .eq('shop_id', shopId)
    .lt('window_from', iso(toMs))
    .gt('window_to', iso(fromMs))
    .limit(1000)
  if (error) {
    if (isMissingDbObject(error)) return { available: false, rows: [] }
    throw error
  }
  return { available: true, rows: (data || []) as Row[] }
}

export async function GET(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()

  const params = new URL(req.url).searchParams
  const from = Date.parse(params.get('from') || '')
  const to = Date.parse(params.get('to') || '')
  if (isNaN(from) || isNaN(to) || to <= from) return fail(400, 'Ask for a time range with from and to.')
  if (to - from > MAX_RANGE_MS) return fail(400, 'That range is too long. Ask for 100 days or fewer.')
  const include = new Set((params.get('include') || '').split(',').map(s => s.trim()).filter(Boolean))
  const jobIds = (params.get('jobs') || '').split(',').map(s => s.trim()).filter(s => s && s.length <= 80).slice(0, 300)

  try {
    const sb = getServiceClient()
    const [entries, breaks] = await Promise.all([entriesInWindow(sb, auth.shopId, from, to), breaksAvailable(sb)])
    // Entries still open are always included, even from an earlier day, so a forgotten clock-out is never hidden.
    const body: Row = { ok: true, entries, breaks, now: new Date().toISOString() }
    if (include.has('rules')) {
      const r = await loadRules(sb, auth.shopId)
      body.rules = r.rules
      body.rulesAvailable = r.available
    }
    if (include.has('jobtime')) {
      const w = await jobTimeInWindow(sb, auth.shopId, from, to)
      body.jobTime = { available: w.available, segments: w.segments }
      if (w.available && jobIds.length) body.jobTimeForJobs = await jobTimeForJobs(sb, auth.shopId, jobIds)
    }
    if (include.has('approvals')) body.approvals = await approvalsInWindow(sb, auth.shopId, from, to)
    return NextResponse.json(body)
  } catch (e) {
    return problem(e, 'load')
  }
}

function readTime(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const ms = Date.parse(String(v))
  return isNaN(ms) ? NaN : ms
}

/** Who a stored entry belongs to, even when it only has a name (entries made before ids were saved). */
async function personOfEntry(sb: Db, shopId: string, entry: Row): Promise<Who> {
  const found = await findPerson(sb, shopId, { staff_id: entry.staff_id, staff_name: entry.staff_name })
  return 'error' in found ? { id: 0, name: String(entry.staff_name), active: false } : found
}

/** The punches around an entry, to check a new time against. */
async function neighbours(sb: Db, shopId: string, who: Who, fromMs: number, toMs: number): Promise<ClockEntry[]> {
  const around = await entriesInWindow(sb, shopId, fromMs, toMs)
  return entriesFor(around.map(normalizeEntry), who)
}

export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (auth.role === 'viewer') return forbidden()

  const raw = await req.json().catch(() => null)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail(400, 'Send the request as JSON.')
  const body = raw as Row
  const action = String(body.action || '')
  const shopId = auth.shopId
  const nowMs = Date.now()

  try {
    const sb = getServiceClient()

    /* ---------- punching ---------- */
    if (action === 'clock_in' || action === 'clock_out' || action === 'start_break' || action === 'end_break') {
      const who = await findPerson(sb, shopId, body)
      if ('error' in who) return fail(404, who.error)

      if (action === 'clock_in') {
        const { rules } = await loadRules(sb, shopId)
        return send(await punchIn(sb, shopId, who, { nowMs, note: cleanText(body.note, 200), source: 'app', fix: readFix(body.geo), rules }))
      }
      const open = await runningEntry(sb, shopId, who)
      if (!open) return fail(409, `${who.name} is not clocked in.`)
      if (action === 'clock_out') return send(await punchOut(sb, shopId, who, open, nowMs))
      return send(await breakOp(sb, shopId, who, open, action === 'start_break' ? 'start' : 'end', nowMs))
    }

    /* ---------- taking back a clock-out ---------- */
    if (action === 'undo_clock_out') {
      const who = await findPerson(sb, shopId, body)
      if ('error' in who) return fail(404, who.error)
      const r = await undoClockOut(sb, shopId, auth.userId, who, nowMs)
      if (r.status === 200) await audit(auth, 'timeclock.undo_clock_out', { type: 'timeclock', id: String((r.body.entry as Row)?.id ?? '') }, { staff_id: who.id, staff: who.name })
      return send(r)
    }

    /* ---------- time on a job ---------- */
    if (action === 'start_job' || action === 'stop_job') {
      const who = await findPerson(sb, shopId, body)
      if ('error' in who) return fail(404, who.error)
      if (action === 'stop_job') return send(await stopJob(sb, shopId, who, nowMs))
      const jobId = String(body.job_id || '').trim()
      if (!jobId || jobId.length > 80) return fail(400, 'Choose a repair order.')
      const open = await runningEntry(sb, shopId, who)
      return send(await startJob(sb, shopId, who, open, jobId, cleanText(body.note, 200), nowMs))
    }

    /* ---------- approving a pay period: managers only ---------- */
    if (action === 'approve' || action === 'unapprove') {
      if (!CAN_EDIT.has(auth.role)) return fail(403, 'Only an owner or manager can approve time.')
      const staffId = Number(body.staff_id)
      const periodStart = String(body.period_start || '')
      if (!Number.isInteger(staffId) || staffId <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(periodStart)) return fail(400, 'Choose a person and a pay period.')
      const who = await findPerson(sb, shopId, { staff_id: staffId })
      if ('error' in who) return fail(404, who.error)

      if (action === 'unapprove') {
        const { data, error } = await sb.from('time_approvals').delete().eq('shop_id', shopId).eq('staff_id', staffId).eq('period_start', periodStart).select('id')
        if (error) {
          if (isMissingDbObject(error)) return fail(400, 'Approving time needs a database update. Ask whoever set up the app to apply it.', { code: 'approvals_unavailable' })
          throw error
        }
        if (!data || data.length === 0) return fail(404, 'That pay period was not approved.')
        await audit(auth, 'timeclock.unapprove', { type: 'time_approval', id: `${staffId}:${periodStart}` }, { staff: who.name, period_start: periodStart })
        return NextResponse.json({ ok: true })
      }

      const days = Number(body.period_days) === 14 ? 14 : 7
      const wf = readTime(body.window_from)
      const wt = readTime(body.window_to)
      if (wf === null || wt === null || Number.isNaN(wf) || Number.isNaN(wt) || wt <= wf) return fail(400, 'Send the start and end of the pay period.')
      const hours = (wt - wf) / HOUR_MS
      if (Math.abs(hours - days * 24) > 2) return fail(400, 'That pay period does not look right. Reload and try again.')
      if (wt > nowMs + 2 * HOUR_MS) return fail(409, 'A pay period can be approved once it has ended.', { code: 'not_ended' })

      const mine = entriesFor((await entriesInWindow(sb, shopId, wf, wt)).map(normalizeEntry), who)
      // A punch still running that began before the period ended means the period is not finished. One that began after it is a later period's.
      const open = mine.filter(e => !e.clock_out && Date.parse(e.clock_in) < wt)
      if (open.length) return fail(409, `${who.name} is still clocked in. Clock out or fix the time first.`, { code: 'open_entry' })
      const inPeriod = mine.filter(e => Date.parse(e.clock_in) >= wf && Date.parse(e.clock_in) < wt)
      const minutes = Math.round(inPeriod.reduce((s, e) => s + workedMinutes(e, nowMs), 0))
      const note = cleanText(body.note, 300)
      const { error } = await sb.from('time_approvals').upsert({
        shop_id: shopId, staff_id: staffId, period_start: periodStart, period_days: days, window_from: iso(wf), window_to: iso(wt),
        minutes_total: minutes, approved_by: auth.userId, approved_at: iso(nowMs), note: note || null,
      }, { onConflict: 'shop_id,staff_id,period_start' })
      if (error) {
        if (isMissingDbObject(error)) return fail(400, 'Approving time needs a database update. Ask whoever set up the app to apply it.', { code: 'approvals_unavailable' })
        throw error
      }
      await audit(auth, 'timeclock.approve', { type: 'time_approval', id: `${staffId}:${periodStart}` }, { staff: who.name, period_start: periodStart, period_days: days, minutes })
      return NextResponse.json({ ok: true, minutes_total: minutes })
    }

    /* ---------- fixing the record: managers only ---------- */
    if (action === 'add_entry' || action === 'update_entry' || action === 'delete_entry' || action === 'restore_entry') {
      if (!CAN_EDIT.has(auth.role)) return fail(403, 'Only an owner or manager can change time entries.')

      if (action === 'delete_entry') {
        const id = Number(body.id)
        if (!Number.isInteger(id) || id <= 0) return fail(400, 'Choose an entry to delete.')
        const reason = cleanText(body.reason, 140)
        if (reason.length < 3) return fail(400, 'Say why you are removing this entry, in a few words.')
        const found = await sb.from('timeclock').select('*').eq('id', id).eq('shop_id', shopId).maybeSingle()
        if (found.error) throw found.error
        if (!found.data) return fail(404, 'That entry was already removed.')
        const before = found.data as Row
        const locked = await approvedPeriodAt(sb, shopId, before.staff_id == null ? null : Number(before.staff_id), String(before.clock_in))
        if (locked) return send(lockedReply(locked.period_start))
        const { data, error } = await sb.from('timeclock').delete().eq('id', id).eq('shop_id', shopId).select('id')
        if (error) throw error
        if (!data || data.length === 0) return fail(404, 'That entry was already removed.')
        const staffId = before.staff_id == null ? null : Number(before.staff_id)
        const kept = await logChange(sb, shopId, auth.userId, { entryId: id, staffId, staffName: String(before.staff_name ?? ''), action: 'delete', before, after: null, reason })
        await audit(auth, 'timeclock.delete', { type: 'timeclock', id }, { reason, entry: before })
        return NextResponse.json({ ok: true, restorable: kept })
      }

      if (action === 'restore_entry') {
        const changeId = Number(body.change_id)
        if (!Number.isInteger(changeId) || changeId <= 0) return fail(400, 'Choose which removed entry to put back.')
        const ch = await sb.from('time_entry_changes').select('*').eq('id', changeId).eq('shop_id', shopId).maybeSingle()
        if (ch.error) {
          if (isMissingDbObject(ch.error)) return fail(400, 'Putting an entry back needs a database update.', { code: 'history_unavailable' })
          throw ch.error
        }
        const change = ch.data as Row | null
        if (!change || change.action !== 'delete' || !change.before_row || typeof change.before_row !== 'object') return fail(404, 'That removed entry was not found.')
        const later = await sb.from('time_entry_changes').select('id').eq('shop_id', shopId).eq('entry_id', Number(change.entry_id)).eq('action', 'restore').gt('changed_at', String(change.changed_at)).limit(1)
        if (later.error) throw later.error
        if (later.data && later.data.length) return fail(409, 'That entry was already put back.')
        const old = change.before_row as Row
        const staffId = old.staff_id == null ? null : Number(old.staff_id)
        const clockIn = Date.parse(String(old.clock_in))
        const clockOut = old.clock_out ? Date.parse(String(old.clock_out)) : null
        if (isNaN(clockIn) || (clockOut !== null && isNaN(clockOut))) return fail(400, 'That removed entry has times that cannot be read.')
        const locked = await approvedPeriodAt(sb, shopId, staffId, String(old.clock_in))
        if (locked) return send(lockedReply(locked.period_start))
        const who = await personOfEntry(sb, shopId, old)
        const others = await neighbours(sb, shopId, who, clockIn - 25 * HOUR_MS, (clockOut ?? nowMs) + HOUR_MS)
        const bad = validateEntry({ clock_in: iso(clockIn), clock_out: clockOut === null ? null : iso(clockOut) }, { nowMs, others, selfId: null, allowOpen: clockOut === null })
        if (bad) return fail(409, `It cannot be put back: ${bad}`)
        const row: Row = {
          staff_id: staffId, staff_name: String(old.staff_name ?? ''), clock_in: String(old.clock_in), clock_out: old.clock_out ?? null,
          hours_worked: old.hours_worked ?? null, note: stampNote('manual', 'Put back after it was removed'),
        }
        if ('break_minutes' in old) row.break_minutes = old.break_minutes
        const { data, error } = await sb.from('timeclock').insert({ shop_id: shopId, ...row }).select().single()
        if (error) throw error
        await logChange(sb, shopId, auth.userId, { entryId: Number((data as Row).id), staffId, staffName: String(old.staff_name ?? ''), action: 'restore', before: null, after: data as Row, reason: 'Put back after it was removed' })
        await audit(auth, 'timeclock.restore', { type: 'timeclock', id: Number((data as Row).id) }, { from_change: changeId })
        return NextResponse.json({ ok: true, entry: data })
      }

      const reason = cleanText(body.reason, 140)
      if (reason.length < 3) return fail(400, 'Say why you are changing this entry, in a few words.')
      const clockIn = readTime(body.clock_in)
      const clockOut = readTime(body.clock_out)
      if (clockIn === null || Number.isNaN(clockIn)) return fail(400, 'Enter a valid clock-in time.')
      if (Number.isNaN(clockOut)) return fail(400, 'Enter a valid clock-out time.')

      let existing: Row | null = null
      let who: Who
      if (action === 'update_entry') {
        const id = Number(body.id)
        if (!Number.isInteger(id) || id <= 0) return fail(400, 'Choose an entry to change.')
        const { data, error } = await sb.from('timeclock').select('*').eq('id', id).eq('shop_id', shopId).maybeSingle()
        if (error) throw error
        if (!data) return fail(404, 'That entry was removed. Reload and try again.')
        existing = data as Row
        who = await personOfEntry(sb, shopId, existing)
      } else {
        const found = await findPerson(sb, shopId, body)
        if ('error' in found) return fail(404, found.error)
        who = found
      }

      // A closed entry stays closed. Only a running one may stay open.
      const wasOpen = !!existing && !existing.clock_out
      if (clockOut === null && !wasOpen) return fail(400, 'Enter a clock-out time.')

      // Check against everything this person punched in the days around the entry.
      const others = await neighbours(sb, shopId, who, clockIn - 25 * HOUR_MS, (clockOut ?? nowMs) + HOUR_MS)
      const bad = validateEntry(
        { clock_in: iso(clockIn), clock_out: clockOut === null ? null : iso(clockOut) },
        { nowMs, others, selfId: existing ? Number(existing.id) : null, allowOpen: wasOpen },
      )
      if (bad) return fail(400, bad)

      // An approved pay period is locked: both where the punch was and where it is going.
      const staffRef = who.id > 0 ? who.id : null
      for (const at of existing ? [String(existing.clock_in), iso(clockIn)] : [iso(clockIn)]) {
        const locked = await approvedPeriodAt(sb, shopId, staffRef, at)
        if (locked) return send(lockedReply(locked.period_start))
      }

      if (action === 'add_entry') {
        const { data, error } = await sb.from('timeclock').insert({
          shop_id: shopId, staff_id: who.id, staff_name: who.name, clock_in: iso(clockIn), clock_out: iso(clockOut as number),
          hours_worked: hoursFor(iso(clockIn), iso(clockOut as number)), note: stampNote('manual', reason),
        }).select().single()
        if (error) throw error
        await logChange(sb, shopId, auth.userId, { entryId: Number((data as Row).id), staffId: who.id, staffName: who.name, action: 'add', before: null, after: data as Row, reason })
        await audit(auth, 'timeclock.add', { type: 'timeclock', id: Number((data as Row).id) }, { reason, staff: who.name })
        return NextResponse.json({ ok: true, entry: data })
      }

      const ex = existing as Row
      let brk = Math.max(0, Number(ex.break_minutes) || 0)
      const patch: Row = { clock_in: iso(clockIn), note: stampNote('edited', reason) }
      if (clockOut === null) {
        patch.clock_out = null
        patch.hours_worked = null
      } else {
        // Closing a running entry that is on a break ends the break at the clock-out time.
        const startedAt = ex.break_started_at ? Date.parse(String(ex.break_started_at)) : NaN
        if (!isNaN(startedAt)) {
          brk += Math.max(0, Math.round((clockOut - startedAt) / 60_000))
          patch.break_minutes = brk
          patch.break_started_at = null
        }
        patch.clock_out = iso(clockOut)
        patch.hours_worked = hoursFor(iso(clockIn), iso(clockOut), brk)
      }
      const { data, error } = await sb.from('timeclock').update(patch).eq('id', ex.id as number).eq('shop_id', shopId).select().single()
      if (error) throw error
      await logChange(sb, shopId, auth.userId, { entryId: Number(ex.id), staffId: staffRef, staffName: who.name, action: 'edit', before: ex, after: data as Row, reason })
      await audit(auth, 'timeclock.edit', { type: 'timeclock', id: Number(ex.id) }, { reason, staff: who.name, before: { clock_in: ex.clock_in, clock_out: ex.clock_out }, after: { clock_in: patch.clock_in, clock_out: patch.clock_out } })
      return NextResponse.json({ ok: true, entry: data })
    }

    return fail(400, 'Unknown action.')
  } catch (e) {
    return problem(e, action || 'post')
  }
}
