import test from 'node:test'
import assert from 'node:assert/strict'
import * as a from '../src/lib/automation-text.ts'

const day = 86_400_000
const now = Date.parse('2026-10-14T18:00:00Z')
const ago = d => new Date(now - d * day).toISOString()

test('the opt-out line is found whatever the case', () => {
  assert.equal(a.hasOptOutLine('Hi! Reply STOP to opt out.'), true)
  assert.equal(a.hasOptOutLine('text stop to quit'), true)
  assert.equal(a.hasOptOutLine('Hi! We have a special. Reply to this text.'), false)
  assert.equal(a.hasOptOutLine('Stopwatch repair special'), false)
})

test('the promotional text is the saved template or the default, one first name per person', () => {
  assert.equal(a.blastTemplate(undefined), a.BLAST_DEFAULT)
  assert.equal(a.blastTemplate('   '), a.BLAST_DEFAULT)
  assert.equal(a.blastTemplate('  Hi {name}!  '), 'Hi {name}!')
  assert.equal(a.blastTemplate('x'.repeat(2000)).length, 1600)
  assert.equal(a.blastText('Hi {name}! Hi {NAME}!', 'Dana Ortiz'), 'Hi Dana! Hi Dana!')
  assert.equal(a.blastText('Hi {name}!', ''), 'Hi there!')
  assert.equal(a.blastText('Hi {name}!', null), 'Hi there!')
})

test('promotional audience: opted out and no-number people are set aside, shared numbers are counted', () => {
  const s = a.blastAudience([
    { id: 1, name: 'A', phone: '(713) 555-0142' },
    { id: 2, name: 'B', phone: '713-555-0143', sms_opted_out: true },
    { id: 3, name: 'C', phone: '  ' },
    { id: 4, name: 'D', phone: '+1 713 555 0142' },
    { id: 5, name: 'E', phone: '2815550117' },
  ])
  assert.deepEqual(s.send.map(c => c.id), [1, 4, 5])
  assert.deepEqual(s.optedOut.map(c => c.id), [2])
  assert.deepEqual(s.noPhone.map(c => c.id), [3])
  assert.equal(s.shared, 1)
})

test('review requests: recent invoices only, skip anyone already asked this week', () => {
  const s = a.reviewAudience({
    now,
    docs: [
      { customer_id: 'c1', created_at: ago(2) },
      { customer_id: 'c2', created_at: ago(3) },
      { customer_id: 'c3', created_at: ago(1) },
      { customer_id: 'c4', created_at: ago(20) },
      { customer_id: 'c5', created_at: ago(1) },
      { customer_id: 'c6', created_at: ago(1) },
    ],
    customers: [
      { id: 'c1', name: 'A', phone: '7135550101' },
      { id: 'c2', name: 'B', phone: '7135550102' },
      { id: 'c3', name: 'C', phone: '7135550103', sms_opted_out: true },
      { id: 'c4', name: 'D', phone: '7135550104' },
      { id: 'c5', name: 'E', phone: '' },
      { id: 'c6', name: 'F', phone: '7135550106' },
    ],
    requests: [{ phone: '7135550102', created_at: ago(2) }, { phone: '7135550106', created_at: ago(30) }],
  })
  assert.deepEqual(s.send.map(c => c.id), ['c1', 'c6'])
  assert.deepEqual(s.alreadyAsked.map(c => c.id), ['c2'])
  assert.deepEqual(s.optedOut.map(c => c.id), ['c3'])
  assert.deepEqual(s.noPhone.map(c => c.id), ['c5'])
})

test('win-back: last invoice older than the months, not texted in 30 days, newest visit wins', () => {
  const s = a.winBackAudience({
    now,
    months: 3,
    docs: [
      { customer_id: 'c1', created_at: ago(200) },
      { customer_id: 'c1', created_at: ago(10) },
      { customer_id: 'c2', created_at: ago(150) },
      { customer_id: 'c3', created_at: ago(150) },
      { customer_id: 'c4', created_at: ago(150) },
      { customer_id: 'c5', created_at: ago(150) },
      { customer_id: 'c6', created_at: ago(60) },
    ],
    customers: [
      { id: 'c1', name: 'A', phone: '7135550101' },
      { id: 'c2', name: 'B', phone: '7135550102' },
      { id: 'c3', name: 'C', phone: '7135550103', sms_opted_out: true },
      { id: 'c4', name: 'D', phone: '' },
      { id: 'c5', name: 'E', phone: '7135550105' },
      { id: 'c6', name: 'F', phone: '7135550106' },
      { id: 'c7', name: 'G (never invoiced)', phone: '7135550107' },
    ],
    followups: [{ customer_id: 'c5', created_at: ago(5) }],
  })
  assert.deepEqual(s.send.map(c => c.id), ['c2'])
  assert.equal(s.send[0].monthsAgo, 5)
  assert.deepEqual(s.optedOut.map(c => c.id), ['c3'])
  assert.deepEqual(s.noPhone.map(c => c.id), ['c4'])
})

test('estimate follow-ups: old enough, not too old, still open, not followed up, and by what route', () => {
  const rows = a.estimateAudience({
    now,
    hours: 48,
    sentIds: ['e4'],
    estimates: [
      { id: 'e1', customer_id: 'c1', created_at: ago(3), status: 'sent' },
      { id: 'e2', customer_id: 'c2', created_at: ago(1), status: 'sent' },
      { id: 'e3', customer_id: 'c3', created_at: ago(20), status: 'sent' },
      { id: 'e4', customer_id: 'c1', created_at: ago(4), status: 'sent' },
      { id: 'e5', customer_id: 'c1', created_at: ago(4), status: 'converted' },
      { id: 'e6', customer_id: 'c4', created_at: ago(4), status: 'sent' },
      { id: 'e7', customer_id: null, customer_name: 'Walk-in', customer_phone: '', customer_email: 'w@example.com', created_at: ago(5), status: 'sent' },
      { id: 'e8', customer_id: 'c5', created_at: ago(5), status: 'sent' },
    ],
    customers: [
      { id: 'c1', name: 'A', phone: '7135550101' },
      { id: 'c4', name: 'D', phone: '7135550104', sms_opted_out: true, email: 'd@example.com' },
      { id: 'c5', name: 'E', phone: '', email: '' },
    ],
  })
  assert.deepEqual(rows.map(r => [r.id, r.via]), [['e1', 'text'], ['e6', 'email'], ['e7', 'email'], ['e8', 'none']])
})

test('appointment reminders: tomorrow only, not reminded, with a number to text', () => {
  const s = a.appointmentAudience({
    tomorrow: '2026-10-15',
    customers: [{ id: 'c1', phone: '7135550101' }, { id: 'c2', phone: '7135550102', sms_opted_out: true }],
    appts: [
      { id: 'a1', date: '2026-10-15', status: 'Scheduled', customer_id: 'c1', customer_name: 'A', time: '9:00 AM' },
      { id: 'a2', date: '2026-10-15', status: 'Confirmed', customer_id: 'c2', customer_name: 'B' },
      { id: 'a3', date: '2026-10-15', status: 'Cancelled', customer_id: 'c1', customer_name: 'C' },
      { id: 'a4', date: '2026-10-16', status: 'Scheduled', customer_id: 'c1', customer_name: 'D' },
      { id: 'a5', date: '2026-10-15', status: 'Scheduled', customer_id: 'c1', customer_name: 'E', reminder_sent_at: ago(0) },
      { id: 'a6', date: '2026-10-15', status: 'Scheduled', customer_id: null, customer_name: 'F', phone: '' },
      { id: 'a7', date: '2026-10-15', status: 'Scheduled', customer_id: null, customer_name: 'G', phone: '2815550123' },
    ],
  })
  assert.deepEqual(s.send.map(r => r.id), ['a1', 'a7'])
  assert.deepEqual(s.optedOut.map(r => r.id), ['a2'])
  assert.deepEqual(s.noPhone.map(r => r.id), ['a6'])
})

test('automatic lead emails: the oldest new leads with an address, up to the limit', () => {
  const leads = [
    { id: 'l3', status: 'new', email: 'c@example.com', created_at: ago(1) },
    { id: 'l1', status: 'new', email: 'a@example.com', created_at: ago(9) },
    { id: 'l2', status: 'new', email: '', created_at: ago(8) },
    { id: 'l4', status: 'contacted', email: 'd@example.com', created_at: ago(20) },
    { id: 'l5', status: 'new', email: null, created_at: ago(30) },
    { id: 'l6', status: 'new', email: 'f@example.com', created_at: ago(7) },
  ]
  const s = a.leadEmailAudience(leads, 3)
  assert.deepEqual(s.send.map(l => l.id), ['l1', 'l6'])
  assert.equal(s.passedOver, 1)
  assert.deepEqual(a.leadEmailAudience(leads, 1).send.map(l => l.id), ['l1'])
})

test('tomorrow is read on the shop calendar, not the viewer’s', () => {
  // 02:00 UTC on the 15th is still the 14th evening in Houston, so tomorrow there is the 15th.
  const t = Date.parse('2026-10-15T02:00:00Z')
  assert.equal(a.tomorrowIn('America/Chicago', t), '2026-10-15')
  assert.equal(a.tomorrowIn('Asia/Tokyo', t), '2026-10-16')
  assert.equal(a.tomorrowIn('Not/AZone', t), '2026-10-15')
})

test('what the last run did, even when the saved text is cut off', () => {
  const d = a.describeResult
  assert.deepEqual(d('review_requests', '{"ok":true,"success":true,"sent":3,"total":3,"results":[{"name":"A","sent":true}]}'), { tone: 'ok', text: 'Asked 3 customers for a review.' })
  assert.equal(d('review_requests', '{"ok":true,"success":true,"message":"No recent customers found","sent":0}').text, 'No customers had a recent invoice, so no texts went out.')
  assert.equal(d('re_engagement', '{"ok":true,"success":true,"total_stale_customers":9,"messages_sent":1,"messages_failed":0,"threshold_months":3,"dry_run":false,"results":[{"customer":"Marcus Bell","phone":"7135550143","message":"Hey Marcus! It is time for a checkup at Southline').text, 'Texted 1 customer who had not been in for a while.')
  assert.equal(d('service_reminders', '{"ok":true,"success":true,"processed":2,"results":[{"vehicle":"2019 Honda Civic","customer":"A","sent":true},{"vehicle":"2016 Ford F-150","customer":"B","sent":true}]}').text, 'Sent 2 reminders.')
  assert.equal(d('appointment_reminders', '{"ok":true,"success":true,"processed":0,"results":[]}').text, 'Nothing was due, so no reminders went out.')
  assert.equal(d('lead_discovery', '{"success":true,"scan_type":"alpha_ai","total_leads":7,"competitor_leads":0,"leads":[{"name":"Gulf').text, 'Found 7 new leads.')
  assert.equal(d('lead_outreach', '{"ok":false,"success":false,"attempted":4,"sent":3,"results":[{"lead_id":"l1","sent":true},{"lead_id":"l2","sent":false,"error":"Email failed: 422"}]}').tone, 'warn')
  assert.equal(d('sms_blast', '{"ok":true,"success":true,"attempted":40,"sent":38,"results":[]}').text, 'Texted 38 customers of 40.')
  assert.equal(d('social_posts', '{"success":true,"status":"draft"}').text, 'Saved a draft post. Nothing was published.')
})

test('what the last run did: failures say what went wrong in plain words', () => {
  const d = a.describeResult
  assert.deepEqual(d('review_requests', '{"ok":false,"error":"Unable to load recent invoices"}', 'error'), { tone: 'error', text: 'Unable to load recent invoices' })
  assert.deepEqual(d('sms_blast', 'Automation lease was lost before execution', 'error'), { tone: 'error', text: 'Automation lease was lost before execution' })
  assert.equal(d('sms_blast', '{"ok":false,"success":false,"attempted":3,"sent":2,"results":[]}', 'error').tone, 'warn')
  assert.equal(d('estimate_followups', '{"ok":false,"success":false,"processed":2,"followed_up":0}', 'error').tone, 'error')
  assert.equal(d('sms_blast', ''), null)
  assert.equal(d('sms_blast', null), null)
  assert.equal(d('sms_blast', 'plain text from an old run', 'ok'), null)
})

test('schedules in words, and the ones the server cannot read', () => {
  assert.equal(a.scheduleWords('8:00am'), 'Every day at 8:00 am')
  assert.equal(a.scheduleWords('17:30'), 'Every day at 5:30 pm')
  assert.equal(a.scheduleWords('05:00'), 'Every day at 5:00 am')
  assert.equal(a.scheduleWords('12am'), 'Every day at 12:00 am')
  assert.equal(a.scheduleWords('daily at 6pm'), 'Every day at 6:00 pm')
  assert.equal(a.scheduleWords('mon 9:00am'), 'Every Monday at 9:00 am')
  assert.equal(a.scheduleWords('weekly on Friday'), 'Every Friday')
  assert.equal(a.scheduleWords('fri 5:00pm'), 'Every Friday at 5:00 pm')
  assert.equal(a.scheduleWords('whenever'), null)
  assert.equal(a.scheduleWords('25:00'), null)
  assert.equal(a.scheduleWords('13pm'), null)
  assert.equal(a.scheduleWords(''), null)
})

test('numbers typed into a form', () => {
  assert.equal(a.wholeNumber('48', 1, 720), 48)
  assert.equal(a.wholeNumber(' 3 ', 1, 60), 3)
  assert.equal(a.wholeNumber('', 1, 60), null)
  assert.equal(a.wholeNumber('0', 1, 60), null)
  assert.equal(a.wholeNumber('61', 1, 60), null)
  assert.equal(a.wholeNumber('2.5', 1, 60), null)
  assert.equal(a.wholeNumber('-4', 1, 60), null)
  assert.equal(a.wholeNumber('abc', 1, 60), null)
})
