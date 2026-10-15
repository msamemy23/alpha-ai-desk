import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { HOUR_MS, MIN, entriesFor, hoursFor, isOverlong, stampNote, validateEntry } from '@/lib/timeclock'
import type { ClockEntry } from '@/lib/timeclock'

export const dynamic = 'force-dynamic'

type Db = ReturnType<typeof getServiceClient>
type Row = Record<string, unknown>

/** Changing what was punched is a manager's job. Anyone on the team (not a viewer) can clock people in and out. */
const CAN_EDIT = new Set(['owner', 'admin', 'manager'])
/** Longest window one request may ask for, so a bad request cannot pull the whole table. */
const MAX_RANGE_MS = 100 * 24 * HOUR_MS

const fail = (status: number, error: string, extra: Row = {}) => NextResponse.json({ ok: false, error, ...extra }, { status })

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

/** Only ever put values we built ourselves into a filter string: a parsed date turned back into ISO. */
const iso = (ms: number) => new Date(ms).toISOString()

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

export async function GET(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()

  const params = new URL(req.url).searchParams
  const from = Date.parse(params.get('from') || '')
  const to = Date.parse(params.get('to') || '')
  if (isNaN(from) || isNaN(to) || to <= from) return fail(400, 'Ask for a time range with from and to.')
  if (to - from > MAX_RANGE_MS) return fail(400, 'That range is too long. Ask for 100 days or fewer.')

  try {
    const sb = getServiceClient()
    const [entries, breaks] = await Promise.all([entriesInWindow(sb, auth.shopId, from, to), breaksAvailable(sb)])
    // Entries still open are always included, even from an earlier day, so a forgotten clock-out is never hidden.
    return NextResponse.json({ ok: true, entries, breaks, now: new Date().toISOString() })
  } catch (e) {
    return problem(e, 'load')
  }
}

interface Who { id: number; name: string; active: boolean }

async function findPerson(sb: Db, shopId: string, body: Row): Promise<Who | { error: string }> {
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
async function runningEntry(sb: Db, shopId: string, who: Who): Promise<Row | null> {
  const byId = await sb.from('timeclock').select('*').eq('shop_id', shopId).eq('staff_id', who.id).is('clock_out', null).order('clock_in', { ascending: false }).limit(1)
  if (byId.error) throw byId.error
  if (byId.data && byId.data[0]) return byId.data[0] as Row
  const byName = await sb.from('timeclock').select('*').eq('shop_id', shopId).is('staff_id', null).eq('staff_name', who.name).is('clock_out', null).order('clock_in', { ascending: false }).limit(1)
  if (byName.error) throw byName.error
  return (byName.data && byName.data[0]) || null
}

const cleanText = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

function readTime(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const ms = Date.parse(String(v))
  return isNaN(ms) ? NaN : ms
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
      const open = await runningEntry(sb, shopId, who)

      if (action === 'clock_in') {
        if (!who.active) return fail(400, `${who.name} is no longer on the team.`)
        if (open) {
          return isOverlong({ clock_in: String(open.clock_in), clock_out: null }, nowMs)
            ? fail(409, `${who.name} is still clocked in from an earlier day. Fix that entry in Team, Timesheets first.`, { code: 'needs_fix' })
            : fail(409, `${who.name} is already clocked in.`)
        }
        const { data, error } = await sb.from('timeclock').insert({
          shop_id: shopId, staff_id: who.id, staff_name: who.name, clock_in: iso(nowMs), clock_out: null, note: cleanText(body.note, 200) || null,
        }).select().single()
        if (error) {
          if (error.code === '23505') return fail(409, `${who.name} is already clocked in.`)
          throw error
        }
        return NextResponse.json({ ok: true, entry: data })
      }

      if (!open) return fail(409, `${who.name} is not clocked in.`)
      // A day or more on the clock is a forgotten clock-out. Clocking out "now" would record a made-up shift.
      if (isOverlong({ clock_in: String(open.clock_in), clock_out: null }, nowMs)) {
        return fail(409, `${who.name} has been clocked in for more than 24 hours, so the time looks wrong. An owner or manager can set the real clock-out in Team, Timesheets.`, { code: 'needs_fix' })
      }
      const breaksOn = 'break_minutes' in open
      const startedAt = open.break_started_at ? Date.parse(String(open.break_started_at)) : NaN
      const doneBreak = Math.max(0, Number(open.break_minutes) || 0)

      if (action === 'start_break' || action === 'end_break') {
        if (!breaksOn) return fail(400, 'Breaks are not turned on yet.', { code: 'breaks_unavailable' })
        if (action === 'start_break') {
          if (!isNaN(startedAt)) return fail(409, `${who.name} is already on a break.`)
          const { data, error } = await sb.from('timeclock').update({ break_started_at: iso(nowMs) }).eq('id', open.id as number).eq('shop_id', shopId).is('clock_out', null).select().maybeSingle()
          if (error) throw error
          if (!data) return fail(409, `${who.name} is not clocked in.`)
          return NextResponse.json({ ok: true, entry: data })
        }
        if (isNaN(startedAt)) return fail(409, `${who.name} is not on a break.`)
        const minutes = Math.max(0, Math.round((nowMs - startedAt) / MIN))
        const { data, error } = await sb.from('timeclock').update({ break_minutes: doneBreak + minutes, break_started_at: null }).eq('id', open.id as number).eq('shop_id', shopId).is('clock_out', null).select().maybeSingle()
        if (error) throw error
        if (!data) return fail(409, `${who.name} is not clocked in.`)
        return NextResponse.json({ ok: true, entry: data })
      }

      // clock_out. A break still running is ended first so its minutes come off the day.
      const owed = !isNaN(startedAt) ? Math.max(0, Math.round((nowMs - startedAt) / MIN)) : 0
      const totalBreak = doneBreak + owed
      const hours = hoursFor(String(open.clock_in), iso(nowMs), totalBreak)
      const patch: Row = { clock_out: iso(nowMs), hours_worked: hours }
      if (breaksOn) { patch.break_minutes = totalBreak; patch.break_started_at = null }
      const { data, error } = await sb.from('timeclock').update(patch).eq('id', open.id as number).eq('shop_id', shopId).is('clock_out', null).select().maybeSingle()
      if (error) throw error
      if (!data) return fail(409, `${who.name} is not clocked in.`)
      return NextResponse.json({ ok: true, entry: data, hours_worked: hours })
    }

    /* ---------- fixing the record: managers only ---------- */
    if (action === 'add_entry' || action === 'update_entry' || action === 'delete_entry') {
      if (!CAN_EDIT.has(auth.role)) return fail(403, 'Only an owner or manager can change time entries.')

      if (action === 'delete_entry') {
        const id = Number(body.id)
        if (!Number.isInteger(id) || id <= 0) return fail(400, 'Choose an entry to delete.')
        const { data, error } = await sb.from('timeclock').delete().eq('id', id).eq('shop_id', shopId).select('id')
        if (error) throw error
        if (!data || data.length === 0) return fail(404, 'That entry was already removed.')
        return NextResponse.json({ ok: true })
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
        // Entries made before ids were saved only have a name, so find the person by name.
        const found = await findPerson(sb, shopId, { staff_id: existing.staff_id, staff_name: existing.staff_name })
        who = 'error' in found ? { id: 0, name: String(existing.staff_name), active: false } : found
      } else {
        const found = await findPerson(sb, shopId, body)
        if ('error' in found) return fail(404, found.error)
        who = found
      }

      // A closed entry stays closed. Only a running one may stay open.
      const wasOpen = !!existing && !existing.clock_out
      if (clockOut === null && !wasOpen) return fail(400, 'Enter a clock-out time.')

      // Check against everything this person punched in the days around the entry.
      const windowStart = clockIn - 25 * HOUR_MS
      const windowEnd = (clockOut ?? nowMs) + HOUR_MS
      const around = await entriesInWindow(sb, shopId, windowStart, windowEnd)
      const others = entriesFor(around.map(r => ({ ...r, id: Number(r.id), staff_id: r.staff_id == null ? null : Number(r.staff_id), staff_name: String(r.staff_name ?? '') })) as unknown as ClockEntry[], who)
      const bad = validateEntry(
        { clock_in: iso(clockIn), clock_out: clockOut === null ? null : iso(clockOut) },
        { nowMs, others, selfId: existing ? Number(existing.id) : null, allowOpen: wasOpen },
      )
      if (bad) return fail(400, bad)

      if (action === 'add_entry') {
        const { data, error } = await sb.from('timeclock').insert({
          shop_id: shopId, staff_id: who.id, staff_name: who.name, clock_in: iso(clockIn), clock_out: iso(clockOut as number),
          hours_worked: hoursFor(iso(clockIn), iso(clockOut as number)), note: stampNote('manual', reason),
        }).select().single()
        if (error) throw error
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
          brk += Math.max(0, Math.round((clockOut - startedAt) / MIN))
          patch.break_minutes = brk
          patch.break_started_at = null
        }
        patch.clock_out = iso(clockOut)
        patch.hours_worked = hoursFor(iso(clockIn), iso(clockOut), brk)
      }
      const { data, error } = await sb.from('timeclock').update(patch).eq('id', ex.id as number).eq('shop_id', shopId).select().single()
      if (error) throw error
      return NextResponse.json({ ok: true, entry: data })
    }

    return fail(400, 'Unknown action.')
  } catch (e) {
    return problem(e, action || 'post')
  }
}
