/**
 * What a person can do with a booking the assistant collected: approve it (pick the day and time, and it goes on the schedule),
 * decline it, or cancel a time the assistant booked. Approving claims the row first, so two people pressing the button at the
 * same moment cannot put two appointments on the schedule.
 */
import { insertAppointment, patchBooking } from './store.ts'
import type { Db } from './store.ts'

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^[0-2]\d:[0-5]\d$/

export type BookingResult = { ok: true; status: string; appointmentId?: string } | { ok: false; httpStatus: number; error: string }

export async function decideBooking(db: Db, shopId: string, userId: string | null, input: { id: string; action: string; date?: string; time?: string }, nowIso: string): Promise<BookingResult> {
  const { data: row } = await db.from('ai_booking_requests').select('*').eq('shop_id', shopId).eq('id', input.id).maybeSingle()
  if (!row) return { ok: false, httpStatus: 404, error: 'Not found.' }

  if (input.action === 'decline') {
    if (row.status !== 'pending') return { ok: false, httpStatus: 409, error: 'This request was already handled.' }
    await patchBooking(db, shopId, row.id, { status: 'declined', decided_by: userId, decided_at: nowIso })
    return { ok: true, status: 'declined' }
  }

  if (input.action === 'cancel') {
    if (!['booked', 'approved'].includes(row.status)) return { ok: false, httpStatus: 409, error: 'Only a booked time can be cancelled.' }
    if (row.appointment_id) {
      await db.from('appointments').update({ status: 'Cancelled', updated_at: nowIso }).eq('shop_id', shopId).eq('id', row.appointment_id)
    }
    await patchBooking(db, shopId, row.id, { status: 'cancelled', decided_by: userId, decided_at: nowIso })
    return { ok: true, status: 'cancelled' }
  }

  if (input.action === 'approve') {
    if (row.status !== 'pending') return { ok: false, httpStatus: 409, error: 'This request was already handled.' }
    const date = String(input.date || '')
    const time = String(input.time || '')
    if (!DATE.test(date) || !TIME.test(time)) return { ok: false, httpStatus: 400, error: 'Pick a day and a time first.' }
    const { data: claimed } = await db.from('ai_booking_requests')
      .update({ status: 'approved', slot_date: date, slot_time: time, decided_by: userId, decided_at: nowIso, updated_at: nowIso })
      .eq('shop_id', shopId).eq('id', row.id).eq('status', 'pending').select('id')
    if (!claimed || claimed.length === 0) return { ok: false, httpStatus: 409, error: 'Someone else just handled this request.' }
    const appt = await insertAppointment(db, shopId, {
      customerName: row.customer_name || '', customerId: row.customer_id || null, phone: row.phone || '', vehicle: row.vehicle || '',
      service: String(row.problem || '').slice(0, 200), date, time,
      notes: `Approved from an AI assistant request (${row.channel === 'call' ? 'phone call' : 'text'}). Customer said: ${row.problem || ''}`.slice(0, 500),
    })
    if (!appt.id) {
      await patchBooking(db, shopId, row.id, { status: 'pending', slot_date: null, slot_time: null, decided_by: null, decided_at: null })
      return { ok: false, httpStatus: 500, error: appt.error || 'The appointment could not be saved.' }
    }
    await patchBooking(db, shopId, row.id, { appointment_id: appt.id })
    return { ok: true, status: 'approved', appointmentId: appt.id }
  }
  return { ok: false, httpStatus: 400, error: 'Unknown action.' }
}
