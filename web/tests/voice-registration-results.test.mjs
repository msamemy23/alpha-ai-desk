import test from 'node:test'
import assert from 'node:assert/strict'
import { makeDb } from './voice-fake-db.mjs'
import {
  computeRegistration, EMPTY_REG, guessPath, mergeRegistration, normalizeReg, registrationCopy, REG_ITEMS,
} from '../src/lib/voice/registration.ts'
import { summarizeResults, sinceIso } from '../src/lib/voice/results.ts'
import { cleanTemplate, fillTemplate, STARTER_TEMPLATES } from '../src/lib/voice/templates.ts'
import { decideBooking } from '../src/lib/voice/bookings.ts'
import { normalizeRules } from '../src/lib/voice/rules.ts'
import { shopFromSettings } from '../src/lib/voice/prompt.ts'

const FACTS = { hasKey: true, hasNumber: true, hasProfile: true, number: '+17135550100' }

test('number type is guessed from the number', () => {
  assert.equal(guessPath('+18335550100'), 'toll_free')
  assert.equal(guessPath('(800) 555-0100'), 'toll_free')
  assert.equal(guessPath('+17135550100'), '10dlc')
  assert.equal(guessPath('12'), null)
})

test('a new shop sees a short plain checklist and is never blocked', () => {
  const v = computeRegistration(EMPTY_REG, { hasKey: false, hasNumber: false, hasProfile: false, number: '' })
  assert.equal(v.path, 'unsure')
  assert.equal(v.status, 'not_started')
  assert.ok(v.steps.length >= 6)
  assert.equal(v.doneCount, 0)
  assert.match(v.headline, /Pick your number type/)
})

test('the checklist follows the number type and fills in what the app can see', () => {
  const dlc = computeRegistration(EMPTY_REG, FACTS)
  assert.equal(dlc.path, '10dlc')
  assert.ok(dlc.steps.some(s => s.id === 'brand'))
  assert.ok(!dlc.steps.some(s => s.id === 'verification'))
  assert.equal(dlc.steps.find(s => s.id === 'number').done, true)
  assert.equal(dlc.steps.find(s => s.id === 'profile').done, true)
  const tf = computeRegistration(EMPTY_REG, { ...FACTS, number: '+18335550100' })
  assert.equal(tf.path, 'toll_free')
  assert.ok(tf.steps.some(s => s.id === 'verification'))
  assert.ok(!tf.steps.some(s => s.id === 'brand'))
  const missing = computeRegistration(EMPTY_REG, { ...FACTS, hasKey: false })
  assert.equal(missing.steps.find(s => s.id === 'number').done, false)
})

test('progress, submitted, approved and rejected read in plain words', () => {
  const items = Object.fromEntries(REG_ITEMS.filter(i => !i.auto && !i.wait).map(i => [i.id, { done: true }]))
  const ready = computeRegistration(normalizeReg({ path: '10dlc', items }), FACTS)
  assert.equal(ready.headline, 'Ready to submit')
  const waiting = computeRegistration(normalizeReg({ path: '10dlc', items, status: 'submitted' }), FACTS)
  assert.equal(waiting.headline, 'Waiting for carriers')
  assert.match(waiting.detail, /may be filtered/)
  const approved = computeRegistration(normalizeReg({ path: '10dlc', items, status: 'approved' }), FACTS)
  assert.equal(approved.headline, 'Approved')
  assert.equal(approved.steps.find(s => s.id === 'approved').done, true)
  const rejected = computeRegistration(normalizeReg({ path: '10dlc', status: 'rejected', notes: 'Website missing' }), FACTS)
  assert.match(rejected.detail, /Website missing/)
})

test('stored checklist data is cleaned', () => {
  const s = normalizeReg({ path: 'bogus', status: 'weird', items: { number: { done: true }, nonsense: { done: true }, brand: { done: 'yes' } }, refs: { brand_id: 'B123 <script>', other: 'x' }, notes: 5 })
  assert.equal(s.path, 'unsure')
  assert.equal(s.status, 'not_started')
  assert.deepEqual(Object.keys(s.items), ['number'])
  assert.equal(s.refs.brand_id, 'B123 script')
  assert.equal(s.refs.other, undefined)
  assert.equal(s.notes, '')
})

test('saving a change stamps the time once and keeps submitted and approved dates', () => {
  const t1 = '2026-10-14T10:00:00.000Z'; const t2 = '2026-10-15T10:00:00.000Z'
  let s = mergeRegistration(EMPTY_REG, { path: '10dlc', items: { business: { done: true } } }, t1)
  assert.equal(s.items.business.at, t1)
  s = mergeRegistration(s, { items: { business: { done: true }, website: { done: true } }, status: 'submitted' }, t2)
  assert.equal(s.items.business.at, t1)
  assert.equal(s.items.website.at, t2)
  assert.equal(s.submitted_at, t2)
  s = mergeRegistration(s, { items: { website: { done: false } } }, t2)
  assert.equal(s.items.website, undefined)
  s = mergeRegistration(s, { status: 'in_progress' }, t2)
  assert.equal(s.submitted_at, null)
})

test('the words to paste come from the shop settings and name no other shop', () => {
  const shop = shopFromSettings({ shop_name: 'Test Auto Care', shop_phone: '(713) 555-0100', shop_address: '1 Main St, Houston, TX', shop_email: 'o@example.com' })
  const copy = registrationCopy(shop, normalizeRules(null), 'https://app.example.com/api/sms')
  const all = copy.map(c => c.text).join('\n')
  assert.match(all, /Test Auto Care/)
  assert.match(all, /Reply STOP/)
  assert.match(all, /HELP/)
  assert.match(all, /https:\/\/app\.example\.com\/api\/sms/)
  assert.doesNotMatch(all, /Alpha/i)
  assert.ok(copy.find(c => c.id === 'opt_in'))
  const blank = registrationCopy(shopFromSettings(null), normalizeRules(null), '')
  assert.match(blank.map(c => c.text).join('\n'), /\[legal business name\]/)
})

/* ---- results ---- */

test('results are plain counts', () => {
  const rows = [
    { channel: 'call', outcome: 'booked', started_at: 'x' },
    { channel: 'call', outcome: 'booking_requested', started_at: 'x' },
    { channel: 'call', outcome: 'transferred', started_at: 'x' },
    { channel: 'call', outcome: 'missed', started_at: 'x' },
    { channel: 'call', outcome: 'after_hours', started_at: 'x' },
    { channel: 'call', outcome: 'spam', started_at: 'x' },
    { channel: 'sms', outcome: 'needs_person', needs_person: true, needs_resolved_at: null, started_at: 'x' },
    { channel: 'sms', outcome: 'needs_person', needs_person: true, needs_resolved_at: 'y', started_at: 'x', review: 'bad' },
    { channel: 'sms', outcome: 'draft', started_at: 'x' },
    { channel: 'sms', outcome: 'answered', started_at: 'x', review: 'good' },
  ]
  const c = summarizeResults(rows)
  assert.equal(c.total, 10)
  assert.equal(c.calls, 6)
  assert.equal(c.texts, 4)
  assert.equal(c.booked, 1)
  assert.equal(c.bookingRequests, 1)
  assert.equal(c.transferred, 1)
  assert.equal(c.missed, 1)
  assert.equal(c.afterHours, 1)
  assert.equal(c.spamBlocked, 1)
  assert.equal(c.needsPerson, 2)
  assert.equal(c.stillNeedsPerson, 1)
  assert.equal(c.good, 1)
  assert.equal(c.bad, 1)
  assert.equal(c.answered, 7)
  assert.equal(summarizeResults([]).total, 0)
})

test('the period is clamped', () => {
  const now = new Date('2026-10-15T00:00:00Z')
  assert.equal(sinceIso(now, 7), '2026-10-08T00:00:00.000Z')
  assert.equal(sinceIso(now, 9999), '2026-07-17T00:00:00.000Z')
  assert.equal(sinceIso(now, 0), '2026-10-08T00:00:00.000Z')
})

/* ---- saved replies ---- */

test('saved replies fill in the blanks and never show braces', () => {
  assert.equal(fillTemplate('Hi {name}, {shop} here. Call {phone}.', { name: 'Maria Lopez', shop: 'Test Auto Care', phone: '(713) 555-0100' }), 'Hi Maria, Test Auto Care here. Call (713) 555-0100.')
  assert.equal(fillTemplate('Hi {name}, ready.', {}), 'Hi, ready.')
  assert.equal(fillTemplate('Call {phone}', {}), 'Call us')
  for (const t of STARTER_TEMPLATES) {
    assert.doesNotMatch(t.body, /\$|\d+\s*(minutes|hours|days)/i)
    assert.doesNotMatch(t.body, /Alpha/i)
    assert.equal(cleanTemplate(t).ok, true)
  }
})

test('saved reply input is checked', () => {
  assert.equal(cleanTemplate({ title: '', body: 'x' }).ok, false)
  assert.equal(cleanTemplate({ title: 'a', body: '' }).ok, false)
  assert.equal(cleanTemplate({ title: 'a'.repeat(61), body: 'x' }).ok, false)
  assert.equal(cleanTemplate({ title: 'a', body: 'x'.repeat(1001) }).ok, false)
  assert.deepEqual(cleanTemplate({ title: '  Ready  ', body: ' Hello ' }), { ok: true, title: 'Ready', body: 'Hello' })
})

/* ---- booking decisions ---- */

const NOW = '2026-10-15T12:00:00.000Z'
function bookingDb(rowOver = {}) {
  return makeDb({
    tables: {
      ai_booking_requests: [{ id: 'b1', shop_id: 'shop-a', status: 'pending', kind: 'request', channel: 'call', customer_name: 'Maria', phone: '7135550142', vehicle: '2018 Honda Civic', problem: 'grinding brakes', ...rowOver }],
      appointments: [],
    },
    unique: { ai_booking_requests: [['shop_id', 'interaction_id']] },
  })
}

test('approving a request puts one appointment on the schedule', async () => {
  const db = bookingDb()
  const r = await decideBooking(db, 'shop-a', 'user-1', { id: 'b1', action: 'approve', date: '2026-10-20', time: '09:00' }, NOW)
  assert.equal(r.ok, true)
  const appts = db.table('appointments')
  assert.equal(appts.length, 1)
  assert.equal(appts[0].date, '2026-10-20')
  assert.equal(appts[0].shop_id, 'shop-a')
  assert.equal(appts[0].status, 'Scheduled')
  assert.equal(db.table('ai_booking_requests')[0].status, 'approved')
  assert.equal(db.table('ai_booking_requests')[0].appointment_id, appts[0].id)
  const again = await decideBooking(db, 'shop-a', 'user-2', { id: 'b1', action: 'approve', date: '2026-10-21', time: '10:00' }, NOW)
  assert.equal(again.ok, false)
  assert.equal(again.httpStatus, 409)
  assert.equal(db.table('appointments').length, 1)
})

test('approving needs a day and time; another shop cannot touch it', async () => {
  const db = bookingDb()
  assert.equal((await decideBooking(db, 'shop-a', 'u', { id: 'b1', action: 'approve' }, NOW)).httpStatus, 400)
  assert.equal((await decideBooking(db, 'shop-a', 'u', { id: 'b1', action: 'approve', date: '20-10-2026', time: '9am' }, NOW)).httpStatus, 400)
  assert.equal((await decideBooking(db, 'shop-b', 'u', { id: 'b1', action: 'approve', date: '2026-10-20', time: '09:00' }, NOW)).httpStatus, 404)
  assert.equal(db.table('appointments').length, 0)
  assert.equal(db.table('ai_booking_requests')[0].status, 'pending')
})

test('declining and cancelling', async () => {
  const db = bookingDb()
  assert.equal((await decideBooking(db, 'shop-a', 'u', { id: 'b1', action: 'cancel' }, NOW)).httpStatus, 409)
  assert.equal((await decideBooking(db, 'shop-a', 'u', { id: 'b1', action: 'decline' }, NOW)).ok, true)
  assert.equal(db.table('ai_booking_requests')[0].status, 'declined')
  assert.equal((await decideBooking(db, 'shop-a', 'u', { id: 'b1', action: 'decline' }, NOW)).httpStatus, 409)

  const db2 = makeDb({ tables: { ai_booking_requests: [{ id: 'b2', shop_id: 'shop-a', status: 'booked', appointment_id: 'ap1' }], appointments: [{ id: 'ap1', shop_id: 'shop-a', status: 'Scheduled' }, { id: 'ap2', shop_id: 'shop-a', status: 'Scheduled' }] } })
  assert.equal((await decideBooking(db2, 'shop-a', 'u', { id: 'b2', action: 'cancel' }, NOW)).ok, true)
  assert.equal(db2.table('appointments').find(a => a.id === 'ap1').status, 'Cancelled')
  assert.equal(db2.table('appointments').find(a => a.id === 'ap2').status, 'Scheduled')
  assert.equal(db2.table('ai_booking_requests')[0].status, 'cancelled')
})
