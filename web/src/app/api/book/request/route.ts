import { NextRequest } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { missingSchema } from '@/lib/schema-missing'
import { cleanDecisions, findings, normalizeSections } from '@/lib/dvi'
import { HONEYPOT, SLUG, bookingNotes, cleanBooking, normalizePhone, sameOrigin, startStatus } from '@/lib/booking'
import { verifyFormToken } from '@/lib/booking-token'
import { loadBySlug, loadShopInfo } from '@/lib/schedule-store'
import { addDaysYmd, freeSlots, nowIn } from '@/lib/schedule-capacity'
import { bookingSecret, fingerprint, ipOf, json, loadSlots, overLimit, yearAgo } from '@/lib/book-server'

export const dynamic = 'force-dynamic'

/**
 * A stranger asks for a time. Every layer here is cheap on purpose; none of them is a CAPTCHA and none needs a third party.
 *   1. The request must come from a page on this site (Origin / Referer).
 *   2. A hidden field real people never fill must be empty.
 *   3. A signed, time-stamped token from the page: not too fast (3 s), not too old (2 h), only for this shop's page.
 *   4. Per visitor and per phone number, counted in the database so the limit holds across servers.
 *   5. Every field is checked again here, and the chosen time must still be open right now.
 *   6. Names, vehicles and notes may not carry web addresses or markup.
 *   7. At most 2 requests waiting per phone number and 40 per shop, and no repeat of the same request.
 * Nothing is texted or emailed from here: sending to a number nobody has proved they own would let anyone make the shop
 * text strangers. The shop confirms, and the shop's own screen sends the text. Replies never reveal anything about other bookings.
 */
const TOKEN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BUSY = 'Online booking is busy right now. Please call the shop.'

export async function POST(req: NextRequest) {
  if (!sameOrigin({ origin: req.headers.get('origin'), referer: req.headers.get('referer'), host: req.headers.get('host'), forwardedHost: req.headers.get('x-forwarded-host') })) {
    return json({ ok: false, error: 'This request could not be accepted. Please use the booking page.' }, 403)
  }
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return json({ ok: false, error: 'Nothing was sent.' }, 400)
  const slug = String(body.slug || '').toLowerCase()
  if (!SLUG.test(slug)) return json({ ok: false, error: 'This booking page is not available.' }, 404)

  // A bot that fills every field fills this one too. It is told it worked, so it learns nothing.
  if (String(body[HONEYPOT] ?? '') !== '') return json({ ok: true, status: 'requested', message: 'Thank you. The shop will be in touch.' })

  const ip = ipOf(req)
  if (await overLimit('book-request', ip, 6, 60)) return json({ ok: false, error: 'Too many requests from your connection. Please call the shop.' }, 429)

  const secret = bookingSecret()
  if (!secret) return json({ ok: false, error: BUSY }, 503)
  const tok = verifyFormToken(body.token, slug, secret)
  if (!tok.ok) {
    if (tok.reason === 'too-fast') return json({ ok: false, error: 'That was very quick. Please check your details and send again.' }, 429)
    return json({ ok: false, error: 'This page has been open too long. Please reload it and try again.' }, 400)
  }

  const shop = await loadBySlug(slug)
  if (!shop) return json({ ok: false, error: 'This booking page is not available. Please call the shop.' }, 404)
  const info = await loadShopInfo(shop.shopId)
  const now = nowIn(info.timezone)

  const services = shop.capacity.services.filter(s => s.online)
  const parsed = cleanBooking(body, { services, todayYmd: now.ymd, daysAhead: shop.online.daysAhead })
  if (!parsed.ok) return json({ ok: false, field: parsed.field, error: parsed.error }, 400)
  const v = parsed.value

  if (await overLimit('book-phone', v.phone, 4, 60)) return json({ ok: false, error: 'There are already requests for this number. The shop will be in touch.' }, 429)

  // The chosen time must still be open, checked against the calendar as it is this second.
  let booked
  try { booked = await loadSlots(shop.shopId, v.date, v.date) } catch { return json({ ok: false, error: BUSY }, 500) }
  const open = freeSlots(shop.capacity, booked, { date: v.date, minutes: v.minutes, kind: v.kind, now, leadMinutes: shop.online.leadHours * 60, step: shop.online.stepMinutes })
  if (!open.includes(v.time)) return json({ ok: false, field: 'time', code: 'taken', error: 'Sorry, that time was just taken. Please pick another.' }, 409)

  const sb = getServiceClient()

  // What this phone number already has with the shop: waiting requests, an identical request, earlier no-shows.
  const last4 = v.phone.slice(-4)
  const hist = await sb.from('appointments').select('id,phone,date,time,status').eq('shop_id', shop.shopId).ilike('phone', `%${last4}%`).gte('date', yearAgo(now.ymd)).limit(200)
  const same = ((hist.data || []) as Record<string, unknown>[]).filter(r => normalizePhone(r.phone) === v.phone)
  if (same.some(r => r.date === v.date && String(r.time).slice(0, 5) === v.time && ['Requested', 'Scheduled', 'Confirmed'].includes(String(r.status)))) {
    return json({ ok: true, status: 'requested', message: shop.online.notice || 'Thank you. The shop will be in touch.' })
  }
  if (same.filter(r => r.status === 'Requested').length >= 2) return json({ ok: false, error: 'You already have requests waiting. The shop will be in touch.' }, 429)
  const waiting = await sb.from('appointments').select('id', { count: 'exact', head: true }).eq('shop_id', shop.shopId).eq('status', 'Requested')
  if ((waiting.count ?? 0) >= 40) return json({ ok: false, error: BUSY }, 429)

  const noShows = same.filter(r => r.status === 'No Show').length
  const decision = startStatus(shop.online, noShows)

  // Work the customer ticked from an inspection they were sent, resolved here from the link, never taken from the browser.
  let extra = ''
  const r = String(body.r || '')
  const ticked = Array.isArray(body.suggested) ? body.suggested.filter((x): x is string => typeof x === 'string').slice(0, 8) : []
  if (TOKEN.test(r) && ticked.length > 0) {
    const { data: row } = await sb.from('dvi').select('sections,customer_decisions').eq('share_token', r).eq('shop_id', shop.shopId).maybeSingle()
    if (row) {
      const list = findings(normalizeSections(row.sections))
      const decided = cleanDecisions(row.customer_decisions, list.map(f => f.id))
      const names = list.filter(f => ticked.includes(f.id) && decided[f.id] !== 'approved').map(f => f.name)
      if (names.length > 0) extra = ` Also wants quoted: ${names.join(', ')}.`
    }
  }

  const row: Record<string, unknown> = {
    shop_id: shop.shopId, customer_name: v.name, phone: v.phone, vehicle: v.vehicle, service: v.serviceLabel, tech: '',
    date: v.date, time: v.time, duration: v.minutes, status: decision.status,
    notes: `${bookingNotes({ notes: v.notes, kind: v.kind, why: decision.why })}${extra}`.slice(0, 900),
  }
  let ins = await sb.from('appointments').insert({ ...row, kind: v.kind, source: 'online' }).select('id').single()
  if (ins.error && missingSchema(ins.error)) ins = await sb.from('appointments').insert(row).select('id').single()
  if (ins.error || !ins.data) { console.error('[book] insert failed:', ins.error?.message, fingerprint(ip)); return json({ ok: false, error: BUSY }, 500) }

  return json({
    ok: true,
    status: decision.status === 'Scheduled' ? 'booked' : 'requested',
    message: decision.status === 'Scheduled' ? 'You are booked. See you then.' : (shop.online.notice || 'Thank you. The shop will be in touch.'),
    when: { date: v.date, time: v.time },
  })
}
