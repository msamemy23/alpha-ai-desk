import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'
import { isMissingDbObject, readWithoutMissingColumns } from '@/lib/db-missing'
import { readFix } from '@/lib/geo'
import { isOverlong, normalizeRole, roleLabel, UNDO_WINDOW_MS } from '@/lib/timeclock'
import {
  breakOp, checkPin, cleanText, findPerson, loadRules, punchIn, punchOut, runningEntry, startJob, stopJob, undoClockOut,
} from '@/lib/timeclock-server'
import type { Db, Reply, Row, Who } from '@/lib/timeclock-server'
import type { KioskPerson } from '@/lib/kiosk-types'

/**
 * The shop tablet. It stays signed in as the shop, shows who is in and out, and lets a person punch with their own PIN. It can
 * clock in, clock out, start and end a break, move onto a repair order and take back a clock-out from the last 15 minutes. It
 * can never change a past entry, approve time or see pay: those stay in Team, behind a manager's sign-in.
 */
export const dynamic = 'force-dynamic'

const fail = (status: number, error: string, extra: Row = {}) => NextResponse.json({ ok: false, error, ...extra }, { status })
const send = (r: Reply) => NextResponse.json(r.body, { status: r.status })

function problem(e: unknown, what: string) {
  console.error(`[timeclock/kiosk] ${what}:`, e instanceof Error ? e.message : e)
  return fail(500, 'The time clock could not do that. Try again in a moment.')
}

async function pinHolders(sb: Db, shopId: string): Promise<{ available: boolean; ids: Set<number> }> {
  const { data, error } = await sb.from('staff_pins').select('staff_id').eq('shop_id', shopId).limit(1000)
  if (error) {
    if (isMissingDbObject(error)) return { available: false, ids: new Set() }
    throw error
  }
  return { available: true, ids: new Set((data || []).map(r => Number(r.staff_id))) }
}

async function runningJobs(sb: Db, shopId: string): Promise<Map<number, { label: string; started_at: string }>> {
  const out = new Map<number, { label: string; started_at: string }>()
  const { data, error } = await sb.from('job_time').select('staff_id,job_label,started_at').eq('shop_id', shopId).is('ended_at', null).limit(1000)
  if (error) {
    if (isMissingDbObject(error)) return out
    throw error
  }
  for (const r of data || []) out.set(Number(r.staff_id), { label: String(r.job_label || 'Repair order'), started_at: String(r.started_at) })
  return out
}

/** Everyone active, with whether they are in, on a break or out. Pass an id to get only that person. */
async function roster(sb: Db, shopId: string, nowMs: number, only?: number): Promise<{ people: KioskPerson[]; pins: boolean }> {
  let staffQuery = sb.from('staff').select('id,name,role,active').eq('shop_id', shopId).eq('active', true).order('name').limit(500)
  if (only) staffQuery = staffQuery.eq('id', only)
  const [staff, open, recent, jobs, pins] = await Promise.all([
    staffQuery,
    sb.from('timeclock').select('*').eq('shop_id', shopId).is('clock_out', null).limit(1000),
    sb.from('timeclock').select('id,staff_id,staff_name,clock_out').eq('shop_id', shopId).gte('clock_out', new Date(nowMs - UNDO_WINDOW_MS).toISOString()).limit(500),
    runningJobs(sb, shopId),
    pinHolders(sb, shopId),
  ])
  if (staff.error) throw staff.error
  if (open.error) throw open.error
  if (recent.error) throw recent.error
  const openRows = (open.data || []) as Row[]
  const byId = new Map<number, Row>()
  const byName = new Map<string, Row>()
  for (const e of openRows) {
    if (e.staff_id != null) byId.set(Number(e.staff_id), e)
    else byName.set(String(e.staff_name || '').trim().toLowerCase(), e)
  }
  const recentOut = new Set<number>()
  for (const r of (recent.data || []) as Row[]) if (r.staff_id != null) recentOut.add(Number(r.staff_id))

  const people: KioskPerson[] = (staff.data || []).map(s => {
    const id = Number(s.id)
    const name = String(s.name)
    const entry = byId.get(id) || byName.get(name.trim().toLowerCase()) || null
    const onBreak = !!(entry && entry.break_started_at)
    const stale = !!(entry && isOverlong({ clock_in: String(entry.clock_in), clock_out: null }, nowMs))
    return {
      id, name, role: roleLabel(normalizeRole(s.role)),
      state: !entry ? 'out' : onBreak ? 'break' : 'in',
      since: !entry ? null : onBreak ? String(entry.break_started_at) : String(entry.clock_in),
      job: entry && !onBreak ? jobs.get(id) || null : null,
      needs_fix: stale,
      can_undo: !entry && recentOut.has(id),
      has_pin: pins.ids.has(id),
    }
  })
  return { people, pins: pins.available }
}

export async function GET() {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (auth.role === 'viewer') return forbidden()
  try {
    const sb = getServiceClient()
    const nowMs = Date.now()
    const [{ rules }, r, settings, jobs] = await Promise.all([
      loadRules(sb, auth.shopId),
      roster(sb, auth.shopId, nowMs),
      sb.from('settings').select('shop_name').eq('shop_id', auth.shopId).limit(1).maybeSingle(),
      readWithoutMissingColumns('id,ro_number,customer_name,vehicle_year,vehicle_make,vehicle_model,status', ['ro_number'], columns => sb.from('jobs').select(columns).eq('shop_id', auth.shopId).not('status', 'in', '("Paid","Closed")').order('created_at', { ascending: false }).limit(60)),
    ])
    if (jobs.error) throw jobs.error
    const shopName = settings.error || !settings.data ? '' : cleanText(settings.data.shop_name, 120)
    return NextResponse.json({
      ok: true, now: new Date(nowMs).toISOString(), shopName,
      requirePin: rules.requirePin, locationMode: rules.locationMode, pinsAvailable: r.pins,
      people: r.people,
      jobs: ((jobs.data || []) as unknown as Array<Record<string, unknown>>).map(j => ({
        id: String(j.id), ro: String(j.ro_number ?? ''), customer: cleanText(j.customer_name, 80),
        car: [j.vehicle_year, j.vehicle_make, j.vehicle_model].map(v => String(v ?? '').trim()).filter(Boolean).join(' '),
      })),
    })
  } catch (e) {
    return problem(e, 'load')
  }
}

const ACTIONS = new Set(['check', 'clock_in', 'clock_out', 'start_break', 'end_break', 'start_job', 'stop_job', 'undo_clock_out'])

export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (auth.role === 'viewer') return forbidden()

  const raw = await req.json().catch(() => null)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail(400, 'Send the request as JSON.')
  const body = raw as Row
  const action = String(body.action || '')
  if (!ACTIONS.has(action)) return fail(400, 'Unknown action.')
  const staffId = Number(body.staff_id)
  if (!Number.isInteger(staffId) || staffId <= 0) return fail(400, 'Choose who this is for.')

  // One tablet, one shop: a loose limit for the tablet and a tighter one per person, on top of the PIN lockout.
  const tablet = checkRateLimit(rateLimitKey('kiosk', auth.userId, auth.shopId), 240, 60_000)
  const person = checkRateLimit(rateLimitKey('kiosk-person', String(staffId), auth.shopId), 30, 60_000)
  if (!tablet.ok || !person.ok) return fail(429, 'Too many tries. Wait a minute and try again.', { code: 'rate_limited' })

  const shopId = auth.shopId
  const nowMs = Date.now()
  try {
    const sb = getServiceClient()
    const found = await findPerson(sb, shopId, { staff_id: staffId })
    if ('error' in found) return fail(404, found.error)
    const who: Who = found
    if (!who.active) return fail(400, `${who.name} is no longer on the team.`)

    const { rules } = await loadRules(sb, shopId)
    if (rules.requirePin) {
      const pin = String(body.pin ?? '').replace(/\D/g, '').slice(0, 8)
      if (pin.length < 4) return fail(400, 'Enter your PIN.', { code: 'pin_needed' })
      const checked = await checkPin(sb, shopId, who, pin, nowMs)
      if (!checked.ok) return fail(checked.code === 'locked' ? 429 : 400, checked.error, { code: checked.code })
    }

    let reply: Reply
    if (action === 'check') {
      // Only proves the PIN, so the tablet can show the actions before anything is punched.
      reply = { status: 200, body: { ok: true } }
    } else if (action === 'clock_in') {
      reply = await punchIn(sb, shopId, who, { nowMs, note: '', source: 'kiosk', fix: readFix(body.geo), rules })
    } else if (action === 'undo_clock_out') {
      reply = await undoClockOut(sb, shopId, auth.userId, who, nowMs)
    } else if (action === 'stop_job') {
      reply = await stopJob(sb, shopId, who, nowMs)
    } else {
      const open = await runningEntry(sb, shopId, who)
      if (action === 'start_job') {
        const jobId = String(body.job_id || '').trim()
        if (!jobId || jobId.length > 80) return fail(400, 'Choose a repair order.')
        reply = await startJob(sb, shopId, who, open, jobId, '', nowMs)
      } else if (!open) {
        reply = { status: 409, body: { ok: false, error: `${who.name} is not clocked in.` } }
      } else if (action === 'clock_out') {
        reply = await punchOut(sb, shopId, who, open, nowMs)
      } else {
        reply = await breakOp(sb, shopId, who, open, action === 'start_break' ? 'start' : 'end', nowMs)
      }
    }
    if (reply.status !== 200) return send(reply)
    // The person's new state, so the tablet can show it without loading everyone again.
    const after = await roster(sb, shopId, nowMs, who.id)
    return NextResponse.json({ ...reply.body, person: after.people[0] || null })
  } catch (e) {
    return problem(e, action)
  }
}
