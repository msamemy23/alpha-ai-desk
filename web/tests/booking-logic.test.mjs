import test from 'node:test'
import assert from 'node:assert/strict'
import * as b from '../src/lib/booking.ts'
import * as t from '../src/lib/booking-token.ts'
import { cleanCapacity, DEFAULT_SERVICES } from '../src/lib/schedule-capacity.ts'

const ctx = { services: DEFAULT_SERVICES, todayYmd: '2026-10-15', daysAhead: 30 }
const good = { name: 'Dana Ruiz', phone: '(713) 555-0142', vehicle: '2018 Toyota Camry', service: 'oil', date: '2026-10-19', time: '09:00', notes: 'Rattle on the right side', website: '' }

test('online settings: needs a valid address to be on, and every limit is clamped', () => {
  assert.equal(b.cleanOnline({ enabled: true, slug: 'x' }).enabled, false) // too short, so it cannot be on
  assert.equal(b.cleanOnline({ enabled: true, slug: 'joes-auto-3f9a' }).enabled, true)
  assert.equal(b.cleanOnline({ slug: 'Bad Slug!' }).slug, '')
  const o = b.cleanOnline({ slug: 'abc-123', leadHours: 999, daysAhead: 0, stepMinutes: 20, approval: 'weird', intro: '<b>Hi</b>  there', holdAfterNoShows: 99 })
  assert.deepEqual([o.leadHours, o.daysAhead, o.stepMinutes, o.approval, o.intro, o.holdAfterNoShows], [72, 1, 30, 'review', 'bHi/b there', 5])
  assert.equal(b.cleanOnline(null).notice, b.DEFAULT_ONLINE.notice)
  assert.equal(b.cleanOnline({ notice: '' }).notice, '')
})

test('an address is made from the shop name and never repeats between shops', () => {
  assert.match(b.makeSlug("Joe's Auto & Tire"), /^joe-s-auto-and-tire-[a-z0-9]{4}$/)
  assert.match(b.makeSlug(''), /^shop-[a-z0-9]{4}$/)
  assert.match(b.makeSlug('!!!'), /^shop-[a-z0-9]{4}$/)
  assert.ok(b.SLUG.test(b.makeSlug('A'.repeat(100))))
  assert.notEqual(b.makeSlug('Same'), b.makeSlug('Same'))
  assert.equal(b.makeSlug('x', () => 0), 'x-0000')
})

test('a visitor sees services, hours and the phone, and nothing about technicians, bays or limits', () => {
  const cap = cleanCapacity({ techCount: 4, bays: 3, maxWaiters: 2, services: [{ label: 'Oil change', minutes: 45, kind: 'wait' }, { label: 'Internal only', online: false }] })
  const v = b.publicView({ name: 'Test Auto', phone: '(713) 555-0100' }, cap, b.cleanOnline({ intro: 'Hello' }))
  assert.deepEqual(v.services.map(s => s.label), ['Oil change'])
  const text = JSON.stringify(v)
  for (const leak of ['techCount', 'bays', 'maxWaiters', 'hoursPerTech', 'Internal only', 'noShow']) assert.equal(text.includes(leak), false, leak)
  assert.equal(v.hours.length, 7); assert.equal(v.hours[0].label, 'Monday')
})

test('the dates offered start today and stop at the limit', () => {
  const d = b.bookableDates('2026-10-15', 30)
  assert.equal(d.length, 31); assert.equal(d[0], '2026-10-15'); assert.equal(d.at(-1), '2026-11-14')
})

test('a good booking is accepted and tidied', () => {
  const r = b.cleanBooking({ ...good, name: '  Dana   Ruiz ', kind: 'wait' }, ctx)
  assert.equal(r.ok, true)
  assert.deepEqual([r.value.name, r.value.phone, r.value.phoneShown, r.value.serviceLabel, r.value.minutes, r.value.kind], ['Dana Ruiz', '+17135550142', '(713) 555-0142', 'Oil change', 45, 'wait'])
  assert.equal(b.cleanBooking(good, ctx).value.kind, 'wait') // the service's usual way when the customer does not say
})

test('every field is checked, with a plain message for the right field', () => {
  const bad = (patch) => b.cleanBooking({ ...good, ...patch }, ctx)
  const cases = [
    [{ name: '' }, 'name'], [{ name: 'A' }, 'name'], [{ name: '12345' }, 'name'], [{ name: 'Buy now www.spam.com' }, 'name'], [{ name: 'Bob <script>' }, 'name'],
    [{ phone: '123' }, 'phone'], [{ phone: '(713) 155-0142' }, 'phone'], [{ phone: '7777777777' }, 'phone'], [{ phone: 'call me' }, 'phone'],
    [{ vehicle: '' }, 'vehicle'], [{ vehicle: 'see http://x.co' }, 'vehicle'],
    [{ service: 'nope' }, 'service'], [{ service: undefined }, 'service'],
    [{ date: '2026-10-14' }, 'date'], [{ date: '2026-12-31' }, 'date'], [{ date: '2026-02-30' }, 'date'], [{ date: 'tomorrow' }, 'date'],
    [{ time: '9am' }, 'time'], [{ time: '' }, 'time'],
    [{ notes: 'visit my-site.com' }, 'notes'], [{ notes: 'email me a@b.co' }, 'notes'],
  ]
  for (const [patch, field] of cases) { const r = bad(patch); assert.equal(r.ok, false, JSON.stringify(patch)); assert.equal(r.field, field, JSON.stringify(patch)); assert.ok(r.error.length > 10) }
  assert.equal(bad({ notes: 'n'.repeat(900) }).value.notes.length, b.MAX_NOTES)
  assert.equal(b.cleanBooking(null, ctx).ok, false)
  assert.equal(bad({ date: '2026-10-15' }).ok, true) // today is allowed here; the open times decide
})

test('names with apostrophes and hyphens are people, not bots', () => {
  for (const n of ["Mary-Ann O'Neil", 'José Martínez', 'Nguyễn Thị Lan', 'Dr. Lee']) assert.equal(b.cleanBooking({ ...good, name: n }, ctx).ok, true, n)
})

test('phone numbers: US only, formats normalised, impossible ones refused', () => {
  for (const p of ['(713) 555-0142', '713.555.0142', '+1 713 555 0142', '1-713-555-0142', '7135550142']) assert.equal(b.normalizePhone(p), '+17135550142', p)
  for (const p of ['', '555-0142', '0135550142', '1135550142', '+44 20 7946 0958', '7130550142', null, 123]) assert.equal(b.normalizePhone(p), null, String(p))
  assert.equal(b.phoneDisplay('+17135550142'), '(713) 555-0142')
})

test('spam in free text is recognised', () => {
  for (const s of ['http://x.co', 'https://a.b', 'www.cheap.biz', 'cheap-pills.com', 'a@b.io', '<a href>', '[url=x]', 't.me/spam']) assert.equal(b.looksLikeSpam(s), true, s)
  for (const s of ['Rattle on the right side', 'Check engine light came on at 3.5 psi', 'Camry 2.5 L', "It's 4 p.m. at the earliest", '']) assert.equal(b.looksLikeSpam(s), false, s)
})

test('a booking must come from a page on this very site', () => {
  assert.equal(b.sameOrigin({ origin: 'https://shop.example', host: 'shop.example' }), true)
  assert.equal(b.sameOrigin({ origin: 'https://evil.example', host: 'shop.example' }), false)
  assert.equal(b.sameOrigin({ referer: 'https://shop.example/book/x', host: 'shop.example' }), true)
  assert.equal(b.sameOrigin({ host: 'shop.example' }), false) // neither header: refuse
  assert.equal(b.sameOrigin({ origin: 'https://shop.example', forwardedHost: 'shop.example, proxy', host: 'internal' }), true)
  assert.equal(b.sameOrigin({ origin: 'null', host: 'shop.example' }), false)
  assert.equal(b.sameOrigin({ origin: 'https://shop.example' }), false)
  assert.equal(b.clientIp({ forwardedFor: '203.0.113.9, 10.0.0.1' }), '203.0.113.9')
  assert.equal(b.clientIp({ realIp: '198.51.100.2' }), '198.51.100.2')
  assert.equal(b.clientIp({}), 'unknown')
})

test('a request waits for the shop unless the shop chose auto, and history of no-shows always waits', () => {
  assert.deepEqual(b.startStatus({ approval: 'review', holdAfterNoShows: 2 }, 0), { status: 'Requested', why: '' })
  assert.deepEqual(b.startStatus({ approval: 'auto', holdAfterNoShows: 2 }, 1), { status: 'Scheduled', why: '' })
  assert.equal(b.startStatus({ approval: 'auto', holdAfterNoShows: 2 }, 2).status, 'Requested')
  assert.match(b.startStatus({ approval: 'auto', holdAfterNoShows: 2 }, 3).why, /missed 3 earlier bookings/)
  assert.equal(b.startStatus({ approval: 'auto', holdAfterNoShows: 0 }, 9).status, 'Scheduled')
})

test('the note on the calendar entry says it came from the web, how, and what the customer wrote', () => {
  const n = b.bookingNotes({ notes: 'Rattle', kind: 'wait', why: '' })
  assert.equal(n, 'Booked online. Customer will wait. Customer note: Rattle')
  assert.equal(b.isOnlineBooking(n), true)
  assert.equal(b.isOnlineBooking('Customer called'), false)
})

test('the form token proves the page was opened a few seconds ago, on this site', () => {
  const secret = 'test-secret'
  const now = 1_800_000_000_000
  const tok = t.issueFormToken('joes', secret, now)
  assert.deepEqual(t.verifyFormToken(tok, 'joes', secret, now + 10_000), { ok: true })
  assert.equal(t.verifyFormToken(tok, 'joes', secret, now + 1_000).reason, 'too-fast')
  assert.equal(t.verifyFormToken(tok, 'joes', secret, now + t.MAX_AGE_MS + 1).reason, 'expired')
  assert.equal(t.verifyFormToken(tok, 'other-shop', secret, now + 10_000).reason, 'bad-signature') // not usable on another shop's page
  assert.equal(t.verifyFormToken(tok, 'joes', 'wrong', now + 10_000).reason, 'bad-signature')
  assert.equal(t.verifyFormToken(tok.slice(0, -2) + 'xx', 'joes', secret, now + 10_000).reason, 'bad-signature')
  assert.equal(t.verifyFormToken('', 'joes', secret).reason, 'missing')
  assert.equal(t.verifyFormToken(undefined, 'joes', secret).reason, 'missing')
  assert.equal(t.verifyFormToken('a.b', 'joes', secret).reason, 'malformed')
  assert.equal(t.verifyFormToken('x'.repeat(300), 'joes', secret).reason, 'malformed')
  assert.notEqual(t.issueFormToken('joes', secret, now), t.issueFormToken('joes', secret, now)) // a fresh nonce each time
})
