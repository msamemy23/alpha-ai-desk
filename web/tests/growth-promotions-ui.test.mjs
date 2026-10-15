import test from 'node:test'
import assert from 'node:assert/strict'
import {
  audienceProblems, audienceToForm, countsLine, emptyForm, formToAudience, isAfterHours, isLocalValue, sameAudience, shopLocalValue, tomorrowMorning,
} from '../src/components/growth/promotions-model.ts'

test('the audience form sends only what was filled in', () => {
  assert.deepEqual(formToAudience(emptyForm()), {})
  const f = { ...emptyForm(), notInDays: '180', makes: 'Toyota, honda , Toyota', minSpend: '$500', tags: 'fleet, vip', tagMode: 'all', hasEmail: true }
  assert.deepEqual(formToAudience(f), { lastVisitMinDays: 180, makes: ['Toyota', 'honda'], minSpend: 500, tags: ['fleet', 'vip'], tagMode: 'all', hasEmail: true })
})

test('a saved audience comes back into the form and sends the same thing', () => {
  const saved = { lastVisitMinDays: 90, lastVisitMaxDays: 400, makes: ['Ford'], yearMin: 2010, yearMax: 2020, minSpend: 250, maxSpend: 9000, tags: ['vip'], tagMode: 'any', hasEmail: false }
  const form = audienceToForm(saved)
  assert.equal(form.notInDays, '90')
  assert.equal(form.makes, 'Ford')
  assert.deepEqual(formToAudience(form), { lastVisitMinDays: 90, lastVisitMaxDays: 400, makes: ['Ford'], yearMin: 2010, yearMax: 2020, minSpend: 250, maxSpend: 9000, tags: ['vip'], tagMode: 'any' })
  assert.ok(sameAudience(form, audienceToForm(saved)))
  assert.ok(!sameAudience(form, { ...form, notInDays: '91' }))
})

test('nonsense in the form is dropped, not sent', () => {
  assert.deepEqual(formToAudience({ ...emptyForm(), notInDays: 'abc', minSpend: '-5', makes: ' , ' }), {})
  assert.equal(audienceToForm(null).notInDays, '')
  assert.equal(audienceToForm({ makes: 'not a list' }).makes, '')
})

test('filters that contradict each other are caught before a tap', () => {
  assert.equal(audienceProblems(emptyForm()).length, 0)
  assert.equal(audienceProblems({ ...emptyForm(), notInDays: '400', inWithinDays: '90' }).length, 1)
  assert.equal(audienceProblems({ ...emptyForm(), yearMin: '2022', yearMax: '2010' }).length, 1)
  assert.equal(audienceProblems({ ...emptyForm(), yearMin: '15' }).length, 1)
  assert.equal(audienceProblems({ ...emptyForm(), minSpend: '900', maxSpend: '100' }).length, 1)
})

test('the counts line reads like a person would say it', () => {
  const counts = { queued: 0, sending: 0, sent: 120, failed: 0, unknown: 0, skipped: 6, cancelled: 0, delivered: 0, undelivered: 0, next_send_after: null }
  assert.equal(countsLine({ status: 'sent', counts, waiting: 0, audience_text: '' }), '120 sent · 6 left out')
  assert.equal(countsLine({ status: 'sending', counts: { ...counts, sent: 10, queued: 4, failed: 1 }, waiting: 4, audience_text: '' }), '10 sent · 4 waiting · 1 did not send · 6 left out')
  assert.equal(countsLine({ status: 'draft', counts, waiting: 0, audience_text: 'not in for 90+ days' }), 'For not in for 90+ days')
  assert.equal(countsLine({ status: 'draft', counts, waiting: 0, audience_text: '' }), 'For all customers')
})

test('send-later times are written in the shop clock, not the browser clock', () => {
  // 2026-10-15 03:30 UTC is 10:30 PM on the 14th in Houston (CDT, UTC-5).
  const now = Date.UTC(2026, 9, 15, 3, 30)
  assert.equal(shopLocalValue(now, 'America/Chicago'), '2026-10-14T22:30')
  assert.equal(tomorrowMorning(now, 'America/Chicago'), '2026-10-15T10:00')
  // The same instant in Los Angeles is still the 14th, 8:30 PM.
  assert.equal(shopLocalValue(now, 'America/Los_Angeles'), '2026-10-14T20:30')
  // A bad time zone falls back instead of throwing.
  assert.match(shopLocalValue(now, 'Not/AZone'), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  assert.ok(isLocalValue('2026-10-20T10:00'))
  assert.ok(!isLocalValue(''))
  assert.ok(!isLocalValue('2026-10-20'))
})

test('after hours are 9 PM to 8 AM by default and can be longer', () => {
  assert.ok(isAfterHours(21)); assert.ok(isAfterHours(23)); assert.ok(isAfterHours(0)); assert.ok(isAfterHours(7))
  assert.ok(!isAfterHours(8)); assert.ok(!isAfterHours(12)); assert.ok(!isAfterHours(20))
  assert.ok(isAfterHours(19, 18, 9)); assert.ok(!isAfterHours(10, 18, 9))
})
