/**
 * What happens after the engine has decided: save a booking, flag a person, tell the team.
 * Shared by the text handler and the call handler. Every step is safe to repeat.
 */
import type { Captured, BookingAction } from './engine.ts'
import { flagReasonLabel } from './engine.ts'
import { isSlotOpen, wallClock } from './hours.ts'
import { phoneKey } from './rules.ts'
import type { VoiceRules } from './rules.ts'
import type { ShopProfile } from './prompt.ts'
import { needsPersonEmail } from './notify.ts'
import { claim, insertAppointment, patchBooking, patchInteraction, saveBooking, setThreadState, upcomingAppointments } from './store.ts'
import type { Db } from './store.ts'

export interface EmailSender { (msg: { to: string; subject: string; text: string; idempotencyKey: string }): Promise<void> }

export interface ActionDeps {
  db: Db
  now: () => Date
  email: EmailSender
  appUrl: string
}

export interface BookingOutcome {
  status: 'requested' | 'booked' | 'duplicate' | 'unavailable' | 'failed'
  bookingId: string | null
  appointmentId: string | null
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000)
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}

/** Saves a booking request, or books an open time after checking it is still open. */
export async function applyBooking(deps: ActionDeps, a: {
  shopId: string; rules: VoiceRules; shop: ShopProfile; interactionId: string | null; channel: 'call' | 'sms'
  booking: BookingAction; captured: Captured; phone: string; customerId: string | null
}): Promise<BookingOutcome> {
  const { db } = deps
  const base = {
    interactionId: a.interactionId, channel: a.channel, customerId: a.customerId, customerName: a.captured.name,
    phone: a.captured.callback || a.phone, vehicle: a.captured.vehicle, problem: a.captured.problem,
  }
  if (a.booking.kind === 'request') {
    const saved = await saveBooking(db, a.shopId, { ...base, kind: 'request', preferredText: a.booking.preferred, slotDate: null, slotTime: null })
    if (saved.unavailable) return { status: 'unavailable', bookingId: null, appointmentId: null }
    return { status: saved.duplicate ? 'duplicate' : saved.id ? 'requested' : 'failed', bookingId: saved.id, appointmentId: null }
  }

  // The assistant offered this time a moment ago. Check it is still open before it goes on the schedule.
  const today = wallClock(deps.now(), a.shop.timezone).ymd
  const appointments = await upcomingAppointments(db, a.shopId, today, addDays(today, 45))
  const stillOpen = isSlotOpen({ rules: a.rules, tz: a.shop.timezone, now: deps.now(), appointments }, a.booking.date, a.booking.time)
  if (!stillOpen) {
    const saved = await saveBooking(db, a.shopId, { ...base, kind: 'request', preferredText: a.booking.label, slotDate: null, slotTime: null })
    return { status: saved.unavailable ? 'unavailable' : saved.duplicate ? 'duplicate' : saved.id ? 'requested' : 'failed', bookingId: saved.id, appointmentId: null }
  }
  const saved = await saveBooking(db, a.shopId, { ...base, kind: 'booked', preferredText: a.booking.label, slotDate: a.booking.date, slotTime: a.booking.time })
  if (saved.unavailable) return { status: 'unavailable', bookingId: null, appointmentId: null }
  if (saved.duplicate) return { status: 'duplicate', bookingId: saved.id, appointmentId: null }
  if (!saved.id) return { status: 'failed', bookingId: null, appointmentId: null }
  const appt = await insertAppointment(db, a.shopId, {
    customerName: a.captured.name, customerId: a.customerId, phone: a.captured.callback || a.phone, vehicle: a.captured.vehicle,
    service: a.captured.problem.slice(0, 200), date: a.booking.date, time: a.booking.time,
    notes: `Booked by the AI assistant (${a.channel === 'call' ? 'phone call' : 'text'}). Customer said: ${a.captured.problem}`.slice(0, 500),
  })
  if (appt.id) {
    await patchBooking(db, a.shopId, saved.id, { status: 'booked', appointment_id: appt.id })
    return { status: 'booked', bookingId: saved.id, appointmentId: appt.id }
  }
  await patchBooking(db, a.shopId, saved.id, { kind: 'request', preferred_text: a.booking.label })
  return { status: 'failed', bookingId: saved.id, appointmentId: null }
}

/**
 * The conversation keeps going after a booking was saved: the name, vehicle and problem arrive in later turns. This copies them
 * onto the saved request (and onto an appointment the assistant booked, filling only blanks) so the person who reads it sees the full picture.
 */
export async function syncBooking(db: Db, shopId: string, a: { interactionId: string | null; captured: Captured; phone: string }): Promise<void> {
  if (!a.interactionId) return
  try {
    const { data: row } = await db.from('ai_booking_requests')
      .select('id,status,kind,appointment_id,customer_name,phone,vehicle,problem,preferred_text')
      .eq('shop_id', shopId).eq('interaction_id', a.interactionId).maybeSingle()
    if (!row || row.status === 'declined' || row.status === 'cancelled') return
    const c = a.captured
    const next = { customer_name: c.name.slice(0, 80), phone: (c.callback || a.phone).slice(0, 40), vehicle: c.vehicle.slice(0, 80), problem: c.problem.slice(0, 400) }
    const patch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(next)) if (v && v !== row[k]) patch[k] = v
    if (row.status === 'pending' && row.kind === 'request' && c.preferred && c.preferred !== row.preferred_text) patch.preferred_text = c.preferred.slice(0, 160)
    if (Object.keys(patch).length) await patchBooking(db, shopId, row.id, patch)
    if (row.appointment_id && row.status === 'booked') {
      const { data: appt } = await db.from('appointments').select('customer_name,vehicle,service,phone,status').eq('shop_id', shopId).eq('id', row.appointment_id).maybeSingle()
      if (appt && appt.status === 'Scheduled') {
        const fill: Record<string, unknown> = {}
        if (!appt.customer_name || appt.customer_name === 'New customer') { if (next.customer_name) fill.customer_name = next.customer_name }
        if (!appt.vehicle && next.vehicle) fill.vehicle = next.vehicle
        if (!appt.service && next.problem) fill.service = next.problem.slice(0, 200)
        if (!appt.phone && next.phone) fill.phone = next.phone
        if (Object.keys(fill).length) await db.from('appointments').update({ ...fill, updated_at: new Date().toISOString() }).eq('shop_id', shopId).eq('id', row.appointment_id)
      }
    }
  } catch { /* the conversation carries on; the request keeps what it already has */ }
}

/** Marks a conversation as needing a person, stops the assistant on that thread, and emails the team once. */
export async function raiseNeedsPerson(deps: ActionDeps, a: {
  shopId: string; rules: VoiceRules; shop: ShopProfile; channel: 'call' | 'sms'; interactionId: string | null
  phone: string; reason: string; captured: Partial<Captured>; lastMessage?: string; shopEmail?: string
}): Promise<{ emailed: boolean }> {
  const key = phoneKey(a.phone)
  if (a.interactionId) {
    await patchInteraction(deps.db, a.shopId, a.interactionId, { needs_person: true, needs_reason: a.reason, needs_resolved_at: null })
  }
  await setThreadState(deps.db, a.shopId, 'sms', key, {
    needsPerson: true, needsReason: flagReasonLabel(a.reason), needsSince: deps.now().toISOString(), pausedUntil: null, pauseReason: 'needs_person',
  })
  const to = a.rules.notify_email || a.shopEmail || ''
  if (!to || !a.interactionId) return { emailed: false }
  if (!(await claim(deps.db, a.shopId, a.interactionId, 'alert_emailed_at'))) return { emailed: false }
  try {
    const mail = needsPersonEmail({
      shop: a.shop, channel: a.channel, phone: a.phone, reason: a.reason, captured: a.captured, lastMessage: a.lastMessage,
      link: `${deps.appUrl}/messages${a.channel === 'call' ? '/ai' : `?thread=${encodeURIComponent(key)}`}`,
    })
    await deps.email({ to, subject: mail.subject, text: mail.text, idempotencyKey: `needs-person-${a.interactionId}` })
    return { emailed: true }
  } catch {
    return { emailed: false }
  }
}

/** A person has dealt with it: the assistant may talk to this customer again. */
export async function resolveNeedsPerson(db: Db, shopId: string, key: string, userId: string | null): Promise<void> {
  if (!key) return
  await setThreadState(db, shopId, 'sms', key, { needsPerson: false, needsReason: null, needsSince: null, pausedUntil: null, pauseReason: null }, userId)
  try {
    await db.from('ai_interactions').update({ needs_resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('shop_id', shopId).eq('contact_key', key).eq('needs_person', true).is('needs_resolved_at', null)
  } catch { /* the table may not exist yet */ }
}

/** A person answered this customer themselves, so a reply the assistant was holding for approval is out of date. */
export async function closeStaleDrafts(db: Db, shopId: string, key: string): Promise<void> {
  if (!key) return
  try {
    const { data } = await db.from('ai_interactions').select('id,detail').eq('shop_id', shopId).eq('contact_key', key).eq('outcome', 'draft').limit(10)
    const now = new Date().toISOString()
    for (const row of (data || []) as Array<{ id: string; detail: Record<string, unknown> | null }>) {
      await db.from('ai_interactions').update({ detail: { ...(row.detail || {}), draft: null }, outcome: 'answered', seen_at: now, updated_at: now })
        .eq('shop_id', shopId).eq('id', row.id)
    }
  } catch { /* the table may not exist yet */ }
}
