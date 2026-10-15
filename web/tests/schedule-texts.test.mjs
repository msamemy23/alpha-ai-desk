import test from 'node:test'
import assert from 'node:assert/strict'
import * as t from '../src/lib/schedule-texts.ts'
import { DEFAULT_CAPACITY, cleanCapacity } from '../src/lib/schedule-capacity.ts'

const shop = { name: 'Test Auto', phone: '(555) 010-0100' }
const appt = { customer_name: 'Dana Ruiz', service: 'Brake service', date: '2026-06-11', time: '09:00' }
const TODAY = '2026-06-10'

test('days are said the way a person says them', () => {
  assert.equal(t.dayWords('2026-06-10', TODAY), 'today')
  assert.equal(t.dayWords('2026-06-11', TODAY), 'tomorrow')
  assert.equal(t.dayWords('2026-06-15', TODAY), 'Monday, Jun 15')
})

test('the reminder names the shop, the service, the day and the time, and how to change it', () => {
  const x = t.reminderText(appt, shop, TODAY)
  assert.match(x, /^Hi Dana, this is Test Auto with a reminder: your brake service is tomorrow at 9:00 AM\./)
  assert.match(x, /call \(555\) 010-0100/)
})

test('walk-in labels and missing names never leak into a message', () => {
  assert.equal(t.firstNameOf('Walk-in: Eddie Park'), 'Eddie')
  assert.match(t.reminderText({ ...appt, customer_name: '' }, shop, TODAY), /^This is Test Auto/)
  assert.match(t.reminderText({ ...appt, service: '' }, { name: '', phone: '' }, TODAY), /^Hi Dana, this is the shop with a reminder: your visit is tomorrow/)
  assert.match(t.reminderText({ ...appt, service: '' }, { name: '', phone: '' }, TODAY), /or reply to this text\.$/)
})

test('accepting, declining and suggesting another time each say what happened and what to do next', () => {
  assert.match(t.acceptText(appt, shop, TODAY), /You are booked for your brake service tomorrow at 9:00 AM/)
  assert.match(t.declineText(appt, shop, TODAY), /Sorry, we cannot fit your brake service tomorrow at 9:00 AM\. Please call \(555\) 010-0100/)
  assert.match(t.suggestText(appt, shop, TODAY, ['Friday, Jun 12 at 8:00 AM']), /Would Friday, Jun 12 at 8:00 AM work instead\?/)
  assert.match(t.suggestText(appt, shop, TODAY, ['A', 'B']), /Would one of these work instead: A, or B\?/)
  assert.doesNotMatch(t.suggestText(appt, shop, TODAY, []), /instead/)
})

test('a late car gets a friendly question, a missed visit gets a way to rebook', () => {
  assert.match(t.lateText({ ...appt, date: TODAY }, shop, TODAY), /We have you down for 9:00 AM today\. Are you still coming\?/)
  assert.match(t.noShowText(appt, shop, 'https://example.test/book/x'), /We missed you for your brake service\. If you still need it, pick a new time here: https:\/\/example\.test\/book\/x\./)
  assert.match(t.noShowText(appt, shop, null), /call \(555\) 010-0100 to pick a new time/)
  assert.doesNotMatch(t.noShowText(appt, shop, null), /fail|blame|fault|charge|fee/i)
})

test('the next open day skips closed days', () => {
  const cap = cleanCapacity({ ...DEFAULT_CAPACITY })
  // 2026-06-12 is a Friday: the weekend is closed by default, so the next open day is Monday.
  assert.equal(t.nextOpenDay(cap, '2026-06-12'), '2026-06-15')
  assert.equal(t.nextOpenDay(cap, '2026-06-10'), '2026-06-11')
  const closed = cleanCapacity({ ...DEFAULT_CAPACITY, closedDates: ['2026-06-15'] })
  assert.equal(t.nextOpenDay(closed, '2026-06-12'), '2026-06-16')
})

test('alternative times are real open times, spread over days, and never the one asked for when it is full', () => {
  const cap = cleanCapacity({ ...DEFAULT_CAPACITY, techCount: 1, bays: 1 })
  const busy = [{ id: 'a', date: '2026-06-11', time: '08:00', duration: 540, status: 'Scheduled', kind: 'dropoff' }]
  const alts = t.alternativeTimes(cap, busy, { date: '2026-06-11', minutes: 60, kind: 'dropoff', now: { ymd: TODAY, minutes: 8 * 60 }, leadMinutes: 60, step: 30 })
  assert.ok(alts.length >= 1)
  assert.ok(alts.every(a => a.ymd !== '2026-06-11'), 'the full day offers nothing')
  assert.equal(alts[0].ymd, '2026-06-12')
  assert.match(alts[0].words, /^Friday, Jun 12 at 8:00 AM$/)
  assert.ok(alts.length <= 3)
})

test('reminders go to booked customers with a number, once, and never to anyone who said STOP', () => {
  const base = { customer_name: 'A', service: '', date: '2026-06-11', time: '09:00', phone: '(713) 555-0142', status: 'Scheduled', reminder_sent_at: null }
  const list = [
    { ...base, id: '1' },
    { ...base, id: '2', time: '08:00', status: 'Confirmed' },
    { ...base, id: '3', phone: '' },
    { ...base, id: '4', reminder_sent_at: '2026-06-10T12:00:00Z' },
    { ...base, id: '5', status: 'Cancelled' },
    { ...base, id: '6', status: 'Requested' },
    { ...base, id: '7', phone: '(713) 555-0199' },
    { ...base, id: '8', date: '2026-06-12' },
  ]
  const r = t.reminderCandidates(list, '2026-06-11', a => a.id === '7')
  assert.deepEqual(r.send.map(a => a.id), ['2', '1'], 'earliest first')
  const why = Object.fromEntries(r.skipped.map(s => [s.appt.id, s.why]))
  assert.deepEqual(why, { 3: 'No phone number', 4: 'Already reminded', 6: 'Not accepted yet', 7: 'Replied STOP' })
})
