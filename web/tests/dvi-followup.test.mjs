import test from 'node:test'
import assert from 'node:assert/strict'
import * as f from '../src/lib/dvi-followup.ts'

const NOW = Date.parse('2026-06-10T15:00:00Z')
const ago = d => new Date(NOW - d * 86_400_000).toISOString()
const base = {
  sent_to_customer: true, sent_at: ago(5), customer_approved: false, customer_decisions: {}, customer_decided_at: null,
  summary: { red: 1, yellow: 1 }, followup_sent_at: null, followup_count: 0,
}

test('an inspection nobody opened for two days or more is due a nudge', () => {
  assert.equal(f.followUpState(base, NOW)?.kind, 'unanswered')
  assert.equal(f.followUpState(base, NOW)?.days, 5)
  assert.equal(f.followUpState({ ...base, sent_at: ago(1) }, NOW), null, 'too soon')
  assert.equal(f.followUpState({ ...base, sent_at: ago(2) }, NOW)?.kind, 'unanswered')
})

test('work the customer said no to is followed up, with the days since they said it', () => {
  const s = f.followUpState({ ...base, customer_decisions: { a: 'approved', b: 'declined' }, customer_decided_at: ago(9) }, NOW)
  assert.equal(s?.kind, 'declined')
  assert.equal(s?.days, 9)
  assert.equal(s?.due, true)
})

test('nothing to follow up when everything was approved, nothing needed work, or it was never sent', () => {
  assert.equal(f.followUpState({ ...base, customer_decisions: { a: 'approved' }, customer_approved: true }, NOW), null)
  assert.equal(f.followUpState({ ...base, summary: { red: 0, yellow: 0 } }, NOW), null)
  assert.equal(f.followUpState({ ...base, sent_to_customer: false }, NOW), null)
})

test('an inspection with no saved counts is only followed up when something was declined', () => {
  assert.equal(f.followUpState({ ...base, summary: null }, NOW), null)
  assert.equal(f.followUpState({ ...base, summary: null, customer_decisions: { a: 'declined' } }, NOW)?.kind, 'declined')
})

test('a follow-up that was sent lately is not due again for a week, and never more than three times', () => {
  assert.equal(f.followUpState({ ...base, followup_sent_at: ago(3), followup_count: 1 }, NOW)?.due, false)
  assert.equal(f.followUpState({ ...base, followup_sent_at: ago(7), followup_count: 1 }, NOW)?.due, true)
  assert.equal(f.followUpState({ ...base, followup_sent_at: ago(40), followup_count: 3 }, NOW)?.due, false)
  assert.equal(f.followUpState({ ...base, followup_sent_at: ago(3), followup_count: 1 }, NOW)?.followedUp, ago(3))
})

test('words for how long ago', () => {
  assert.equal(f.agoWords(0), 'today')
  assert.equal(f.agoWords(1), 'yesterday')
  assert.equal(f.agoWords(5), '5 days ago')
  assert.equal(f.agoWords(21), '3 weeks ago')
  assert.equal(f.agoWords(90), '3 months ago')
})

test('lists of items read like a person wrote them', () => {
  assert.equal(f.listWords([]), '')
  assert.equal(f.listWords(['Front brake pads']), 'Front brake pads')
  assert.equal(f.listWords(['Front brake pads', 'Cabin air filter']), 'Front brake pads and Cabin air filter')
  assert.equal(f.listWords(['A', 'B', 'C']), 'A, B and C')
  assert.equal(f.listWords(['A', 'B', 'C', 'D', 'E']), 'A, B, C and 2 more')
})

const text = o => f.followUpText({ kind: 'declined', customer: 'Dana Ruiz', vehicle: '2018 Toyota Camry', shop: 'Test Auto', phone: '(555) 010-0100', items: ['Front brake pads'], bookUrl: null, inspectionUrl: null, ...o })

test('the follow-up text names the car and the work, is calm, and always ends with the opt-out line', () => {
  const t = text({})
  assert.match(t, /^Hi Dana, this is Test Auto\./)
  assert.match(t, /Your 2018 Toyota Camry still needs Front brake pads/)
  assert.match(t, /Call \(555\) 010-0100/)
  assert.match(t, /Reply STOP to opt out\.$/)
  assert.doesNotMatch(t, /unsafe|dangerous|immediately|urgent/i)
  assert.equal((t.match(/STOP/g) || []).length, 1)
})

test('a booking link is offered when there is one, and the inspection link when it was never answered', () => {
  const book = text({ bookUrl: 'https://example.test/book/test-auto?r=abc' })
  assert.match(book, /pick a time here: https:\/\/example\.test\/book\/test-auto\?r=abc/)
  const nudge = text({ kind: 'unanswered', inspectionUrl: 'https://example.test/inspection/xyz', bookUrl: 'https://example.test/book/test-auto' })
  assert.match(nudge, /Have you had a chance to look at the inspection on your 2018 Toyota Camry\?/)
  assert.match(nudge, /inspection\/xyz/)
  assert.match(nudge, /Or book a time here/)
  assert.match(nudge, /Reply STOP to opt out\.$/)
})

test('a text with no name, no car and no phone still reads properly', () => {
  const t = text({ customer: '', vehicle: '', phone: '', items: [] })
  assert.match(t, /^This is Test Auto\./)
  assert.match(t, /a few things on your vehicle/)
  assert.match(t, /Reply to this text with any questions\./)
})

test('texts are held from 9 pm until 8 am shop time', () => {
  assert.equal(f.inQuietHours(7 * 60 + 59), true)
  assert.equal(f.inQuietHours(8 * 60), false)
  assert.equal(f.inQuietHours(20 * 60 + 59), false)
  assert.equal(f.inQuietHours(21 * 60), true)
  assert.equal(f.inQuietHours(0), true)
})
