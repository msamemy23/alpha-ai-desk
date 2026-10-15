import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as b from '../src/lib/booking.ts'
import { bookingIcs } from '../src/lib/booking-calendar.ts'
import { cleanCapacity } from '../src/lib/schedule-capacity.ts'

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
const full = { service: 'oil', date: '2026-10-19', time: '09:00', name: 'Dana Ruiz', phone: '(713) 555-0142', vehicle: '2018 Toyota Camry', notes: '' }

test('the page opening hours read like a sign on the door', () => {
  const cap = cleanCapacity({})
  const lines = b.hoursLines(b.publicView({ name: 'X', phone: '' }, cap, b.DEFAULT_ONLINE).hours)
  assert.equal(lines.length >= 2, true)
  assert.match(lines[0].days, /^Mon to Fri$/)
  assert.match(lines[0].text, /^\d{1,2}:\d{2} (AM|PM) to \d{1,2}:\d{2} (AM|PM)$/)
  assert.ok(lines.some(l => l.text === 'Closed'))
})

test('hours lines join days in a row, keep a gap, and name a pair of days', () => {
  const h = (open, start = '08:00', end = '17:00') => ({ open, start, end })
  const mk = (flags) => ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((label, i) => ({ day: label.slice(0, 3).toLowerCase(), label, ...h(flags[i]) }))
  assert.deepEqual(b.hoursLines(mk([1, 1, 0, 1, 1, 0, 0])).map(l => l.days), ['Mon and Tue', 'Wednesday', 'Thu and Fri', 'Sat and Sun'])
  assert.deepEqual(b.hoursLines(mk([1, 1, 1, 1, 1, 1, 1])), [{ days: 'Mon to Sun', text: '8:00 AM to 5:00 PM' }])
})

test('the form is checked on the phone the same way the server checks it', () => {
  assert.deepEqual(b.checkBookingForm(full), {})
  const bad = b.checkBookingForm({ service: '', date: '', time: '', name: 'A', phone: '123', vehicle: 'x', notes: 'see www.spam.com' })
  assert.deepEqual(Object.keys(bad).sort(), ['date', 'name', 'notes', 'phone', 'service', 'vehicle'])
  assert.match(b.checkBookingForm({ ...full, time: '' }).time, /time/i)
  assert.equal(b.checkBookingForm({ ...full, name: 'José Martínez' }).name, undefined)
  assert.ok(b.checkBookingForm({ ...full, name: 'Buy now http://x.co' }).name)
  assert.ok(b.checkBookingForm({ ...full, name: '12345' }).name)
})

test('a client-checked form is also accepted by the server check', () => {
  const ctx = { services: cleanCapacity({}).services, todayYmd: '2026-10-15', daysAhead: 30 }
  assert.equal(b.cleanBooking({ ...full, service: ctx.services[0].key }, ctx).ok, true)
})

test('the calendar file has the time as the shop clock, a title, and no customer detail', () => {
  const ics = bookingIcs({ shop: "Joe's Auto", phone: '(713) 555-0100', service: 'Oil change', date: '2026-10-19', time: '09:30', minutes: 45, uid: 'abc' }, new Date('2026-10-15T12:00:00Z'))
  assert.match(ics, /^BEGIN:VCALENDAR\r\n/)
  assert.match(ics, /DTSTART:20261019T093000\r\n/)
  assert.match(ics, /DTEND:20261019T101500\r\n/)
  assert.match(ics, /SUMMARY:Oil change at Joe's Auto\r\n/)
  assert.match(ics, /DTSTAMP:20261015T120000Z/)
  assert.equal(/Dana|7135550142/.test(ics), false)
  assert.equal(bookingIcs({ shop: 'x', service: 's', date: 'soon', time: '09:30', minutes: 30, uid: 'u' }), null)
})

test('the booking routes protect the shop: origin, honeypot, token, limits, and no customer data in answers', () => {
  const req = src('app/api/book/request/route.ts')
  assert.match(req, /sameOrigin\(/)
  assert.match(req, /HONEYPOT/)
  assert.match(req, /verifyFormToken\(/)
  assert.match(req, /overLimit\('book-request'/)
  assert.match(req, /overLimit\('book-phone'/)
  assert.match(req, /freeSlots\(/) // the time is re-checked on the server
  assert.match(req, /\.eq\('shop_id', shop\.shopId\)/)
  assert.equal(/send-message|telnyx|nodemailer|resend/i.test(req), false) // nothing is texted or emailed from a public route
  for (const route of ['info', 'slots']) {
    const text = src(`app/api/book/${route}/route.ts`)
    assert.match(text, /overLimit\(/)
    assert.equal(/customer_name|\bphone:\s*r\./.test(text), false)
  }
})

test('the public page is generic: no shop, no brand in the code, and no outside network calls', () => {
  const files = ['app/book/[slug]/page.tsx', 'app/book/[slug]/layout.tsx', 'components/booking/BookingView.tsx', 'components/booking/useBooking.ts']
  for (const f of files) {
    const text = src(f)
    assert.equal(/Alpha|alpha-desk|Samemy|Houston/i.test(text), false, f)
    assert.equal(/https?:\/\//.test(text), false, f)
  }
  assert.match(src('app/book/[slug]/layout.tsx'), /index: false/)
  assert.match(src('components/booking/BookingView.tsx'), /name=\{HONEYPOT\}/)
})
