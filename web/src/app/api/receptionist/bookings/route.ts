export const dynamic = 'force-dynamic'
import { authed, fail, isUuid, ok, readBody } from '@/lib/receptionist-api'
import { errKind } from '@/lib/voice/store'
import { decideBooking } from '@/lib/voice/bookings'

const COLUMNS = 'id,interaction_id,channel,kind,status,customer_id,customer_name,phone,vehicle,problem,preferred_text,slot_date,slot_time,appointment_id,decided_at,created_at'

/** Booking requests the assistant collected, and times it booked itself. Pending ones first. */
export async function GET(req: Request) {
  const a = await authed()
  if (!a.ok) return a.res
  const { auth, db } = a
  const status = new URL(req.url).searchParams.get('status') || 'open'
  let q = db.from('ai_booking_requests').select(COLUMNS).eq('shop_id', auth.shopId)
  q = status === 'pending' ? q.eq('status', 'pending') : status === 'open' ? q.in('status', ['pending', 'booked', 'approved']) : q
  const { data, error } = await q.order('created_at', { ascending: false }).limit(60)
  if (error) return ok({ unavailable: errKind(error) === 'missing', failed: errKind(error) !== 'missing', items: [] })
  return ok({ unavailable: false, failed: false, items: data || [] })
}

/**
 * Approve a request (a person picks the day and time, and it goes on the schedule), decline it, or cancel a booked time.
 * Nothing is texted to the customer from here; the screen offers a ready-made confirmation text instead.
 */
export async function POST(req: Request) {
  const a = await authed({ write: true })
  if (!a.ok) return a.res
  const { auth, db } = a
  const body = await readBody(req)
  if (!body || !isUuid(body.id)) return fail('Missing request.')
  const result = await decideBooking(db, auth.shopId, auth.userId, { id: body.id, action: String(body.action || ''), date: body.date, time: body.time }, new Date().toISOString())
  return result.ok ? ok({ status: result.status, appointmentId: result.appointmentId }) : fail(result.error, result.httpStatus)
}
