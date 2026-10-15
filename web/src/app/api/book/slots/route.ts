import { NextRequest } from 'next/server'
import { SLUG, bookableDates } from '@/lib/booking'
import { loadBySlug, loadShopInfo } from '@/lib/schedule-store'
import { freeSlots, isYmd, nowIn, openHours, addDaysYmd } from '@/lib/schedule-capacity'
import type { JobKind } from '@/lib/schedule-capacity'
import { ipOf, json, loadSlots, overLimit } from '@/lib/book-server'

export const dynamic = 'force-dynamic'

/**
 * Open start times for one service, either for one day (`date`) or for every bookable day (`days=all`, the days with
 * any open time are returned). Only times: never who holds the other bookings.
 */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const slug = (q.get('slug') || '').toLowerCase()
  if (!SLUG.test(slug)) return json({ ok: false, error: 'This booking page is not available.' }, 404)
  if (await overLimit('book-slots', ipOf(req), 120, 10)) return json({ ok: false, error: 'Too many tries. Wait a few minutes and try again.' }, 429)

  const shop = await loadBySlug(slug)
  if (!shop) return json({ ok: false, error: 'This booking page is not available.' }, 404)
  const svc = shop.capacity.services.find(s => s.online && s.key === q.get('service'))
  if (!svc) return json({ ok: false, error: 'Pick a service first.' }, 400)
  const kind: JobKind = q.get('kind') === 'wait' ? 'wait' : q.get('kind') === 'dropoff' ? 'dropoff' : svc.kind

  const info = await loadShopInfo(shop.shopId)
  const now = nowIn(info.timezone)
  const last = addDaysYmd(now.ymd, shop.online.daysAhead)
  let booked
  try { booked = await loadSlots(shop.shopId, now.ymd, last) } catch { return json({ ok: false, error: 'Times could not be loaded. Please try again.' }, 500) }

  const query = (date: string) => ({ date, minutes: svc.minutes, kind, now, leadMinutes: shop.online.leadHours * 60, step: shop.online.stepMinutes })
  const date = q.get('date') || ''
  if (date) {
    if (!isYmd(date)) return json({ ok: false, error: 'Pick a day from the list.' }, 400)
    return json({ ok: true, date, times: date > last ? [] : freeSlots(shop.capacity, booked, query(date)) })
  }
  const days = bookableDates(now.ymd, shop.online.daysAhead).map(d => ({ date: d, open: openHours(shop.capacity, d).open, times: openHours(shop.capacity, d).open ? freeSlots(shop.capacity, booked, query(d)).length : 0 }))
  return json({ ok: true, days })
}
