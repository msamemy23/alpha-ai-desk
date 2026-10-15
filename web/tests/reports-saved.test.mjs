import test from 'node:test'
import assert from 'node:assert/strict'
import { RAW, allDocs } from './helpers-reports.mjs'
import { docFrom } from '../src/lib/report-docs.ts'
import { reminderCandidates, reminderWording, stageFor } from '../src/lib/ar-reminders.ts'
import { checkSaved, duePeriod, emailSubject, isEmail, nextSendDay, parseRecipients, periodToSkip, savedFrom } from '../src/lib/saved-reports.ts'

const docs = allDocs()

test('who to remind: customers with an open balance old enough, oldest and biggest first', () => {
  const c = reminderCandidates(docs, '2026-10-14')
  assert.equal(c.length, 1)
  assert.deepEqual([c[0].name, c[0].amount, c[0].count, c[0].oldestDays, c[0].stage, c[0].invoiceNumbers, c[0].reach], ['Priya Shah', 450.63, 1, 24, 'friendly', ['INV-1003'], ['text', 'email']])
  assert.equal(reminderCandidates(docs, '2026-10-14', { minDays: 30 }).length, 0)
  assert.equal(reminderCandidates(docs, '2026-10-14', { minAmount: 500 }).length, 0)
  assert.equal(reminderCandidates(docs, '2026-11-20')[0].stage, 'final')
  assert.equal(stageFor(29), 'friendly'); assert.equal(stageFor(30), 'second'); assert.equal(stageFor(60), 'final')
})

test('a customer with nothing on file cannot be reached and the screen can say so', () => {
  const bare = docFrom({ ...RAW.alternator, id: 'bare', customer_id: 'c8', customer_name: 'No Contact', customer_phone: '', customer_email: '' })
  const c = reminderCandidates([bare], '2026-10-14')
  assert.deepEqual(c[0].reach, [])
})

test('reminder wording is plain, names the shop and the amount, and never threatens', () => {
  const base = { name: 'Priya Shah', amount: 450.63, count: 1, invoiceNumbers: ['INV-1003'] }
  for (const stage of ['friendly', 'second', 'final']) {
    const w = reminderWording({ ...base, stage }, { name: 'Test Auto', phone: '555-0100' })
    for (const text of [w.sms, w.emailBody, w.emailSubject]) {
      assert.ok(text.includes('$450.63'), text)
      assert.ok(!/legal|lawyer|attorney|court|collections|credit report|sue/i.test(text), `${stage}: ${text}`)
    }
    assert.ok(w.sms.includes('Test Auto') && w.sms.startsWith('Hi Priya'))
    assert.ok(w.sms.includes('INV-1003') && w.sms.includes('555-0100'))
    assert.ok(w.sms.length < 320, 'fits in two text messages')
  }
  assert.match(reminderWording({ ...base, stage: 'final' }, { name: 'Test Auto' }).emailBody, /payment plan/)
  const w = reminderWording({ name: 'Walk-in', amount: 20, count: 3, invoiceNumbers: ['A', 'B', 'C', 'D', 'E'], stage: 'friendly' }, { name: '' })
  assert.ok(w.sms.startsWith('Hello,') && w.sms.includes('our shop') && w.sms.includes('3 invoices (A, B, C and 2 more)') && w.sms.includes('Reply if anything looks off.'))
})

test('email addresses are checked conservatively and a list is cleaned', () => {
  for (const good of ['a@b.co', 'first.last+tag@sub.example.com']) assert.equal(isEmail(good), true, good)
  for (const bad of ['', 'a@b', 'a b@c.com', '@c.com', 'a@@c.com', 'a@c..com', '<a@c.com>', 'a@c.com,b@d.com', 'x'.repeat(250) + '@c.com']) assert.equal(isEmail(bad), false, bad)
  assert.deepEqual(parseRecipients('A@x.com, b@y.com; a@X.com\nnot-an-email'), { good: ['A@x.com', 'b@y.com'], bad: ['not-an-email'] })
  assert.deepEqual(parseRecipients(['one@x.com', 'two@x.com']).good, ['one@x.com', 'two@x.com'])
})

test('a saved report is checked and each problem is said in plain words', () => {
  const ok = checkSaved({ name: '  Monday   summary ', kind: 'summary', range: { key: 'lastweek' }, compare: { mode: 'previous' }, schedule: 'weekly', recipients: 'owner@example.com, cpa@example.com' })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.value, { name: 'Monday summary', kind: 'summary', range: { key: 'lastweek' }, compare: { mode: 'previous' }, schedule: 'weekly', recipients: ['owner@example.com', 'cpa@example.com'], enabled: true })
  const bad = checkSaved({ name: '', kind: 'nope', range: { key: 'custom', from: '2026-10-10', to: '2026-10-01' }, compare: { mode: 'custom' }, schedule: 'weekly', recipients: '' })
  assert.deepEqual(Object.keys(bad.errors).sort(), ['compare', 'kind', 'name', 'range', 'recipients'])
  assert.match(bad.errors.recipients, /at least one email/)
  assert.match(checkSaved({ name: 'x', kind: 'tax', recipients: 'nope' }).errors.recipients, /nope is not an email address/)
  const many = Array.from({ length: 6 }, (_, i) => `p${i}@x.com`).join(',')
  assert.match(checkSaved({ name: 'x', kind: 'tax', recipients: many }).errors.recipients, /at most 5/)
  const saved = checkSaved({ name: 'Just saved', kind: 'sales', range: { key: '7d' } })
  assert.equal(saved.ok, true); assert.equal(saved.value.schedule, 'none'); assert.equal(saved.value.enabled, false, 'saving without a schedule never sends')
})

test('rows from the database are made safe', () => {
  const s = savedFrom({ id: 5, name: 'x', kind: 'bogus', range: { key: 'zzz' }, compare: null, schedule: 'daily', recipients: ['a@b.co', 'bad', 'c@d.co', 'e@f.co', 'g@h.co', 'i@j.co', 'k@l.co'], enabled: 'yes' })
  assert.deepEqual([s.kind, s.range, s.compare, s.schedule, s.enabled, s.recipients.length], ['summary', { key: '30d' }, { mode: 'previous' }, 'none', false, 5])
})

test('a scheduled report is due once per period and never twice', () => {
  const base = savedFrom({ id: '1', name: 'Monday summary', kind: 'summary', schedule: 'weekly', recipients: ['o@x.com'], enabled: true, last_period: null })
  const due = duePeriod(base, '2026-10-14')
  assert.equal(due.key, 'week-2026-10-05'); assert.deepEqual(due.range, { from: '2026-10-05', to: '2026-10-11' })
  assert.equal(duePeriod({ ...base, last_period: 'week-2026-10-05' }, '2026-10-14'), null, 'already sent')
  assert.equal(duePeriod({ ...base, last_period: 'week-2026-10-05' }, '2026-10-19').key, 'week-2026-10-12', 'the next week is due on Monday')
  assert.equal(duePeriod({ ...base, enabled: false }, '2026-10-14'), null, 'paused')
  assert.equal(duePeriod({ ...base, schedule: 'none' }, '2026-10-14'), null)
  assert.equal(duePeriod({ ...base, recipients: [] }, '2026-10-14'), null)
  assert.equal(duePeriod({ ...base, schedule: 'monthly' }, '2026-10-14').key, 'month-2026-09')
})

test('turning a schedule on does not send the period that just ended, only the next', () => {
  assert.equal(periodToSkip('weekly', '2026-10-14'), 'week-2026-10-05')
  assert.equal(periodToSkip('monthly', '2026-10-14'), 'month-2026-09')
  assert.equal(periodToSkip('none', '2026-10-14'), null)
  assert.equal(nextSendDay('weekly', '2026-10-14'), '2026-10-19')
  assert.equal(nextSendDay('weekly', '2026-10-19'), '2026-10-26')
  assert.equal(nextSendDay('weekly', '2026-10-18'), '2026-10-19')
  assert.equal(nextSendDay('monthly', '2026-10-14'), '2026-11-01')
  assert.equal(nextSendDay('monthly', '2026-12-31'), '2027-01-01')
  // Turned on Wednesday: skipped the week that ended, so the first duePeriod on that day is nothing, and on the next Monday it is the week that just ended.
  const s = savedFrom({ id: '1', name: 'x', kind: 'summary', schedule: 'weekly', recipients: ['o@x.com'], enabled: true, last_period: periodToSkip('weekly', '2026-10-14') })
  assert.equal(duePeriod(s, '2026-10-14'), null); assert.equal(duePeriod(s, '2026-10-18'), null); assert.equal(duePeriod(s, '2026-10-19').key, 'week-2026-10-12')
})

test('the subject names the shop, the report and the period', () => {
  assert.equal(emailSubject('Test Auto', 'Monday summary', 'Week of October 5'), 'Test Auto: Monday summary - Week of October 5')
  assert.equal(emailSubject('', 'Monday summary', 'September 2026'), 'Monday summary - September 2026')
})
