import test from 'node:test'
import assert from 'node:assert/strict'
import * as c from '../src/lib/automation-catalog.ts'
import { emptyRaw, customer, paidInvoice } from './helpers/automation-fake.mjs'

const now = Date.parse('2026-10-14T20:00:00Z') // Wednesday 3pm in Houston
const H = 3_600_000
const D = 86_400_000
const iso = ms => new Date(ms).toISOString()
const ctx = (over = {}) => ({
  now, timeZone: 'America/Chicago', shopName: 'Bayou City Garage', shopPhone: '7135550188',
  reviewUrl: 'https://g.page/r/bayou/review', emailReady: false, enabledAt: now - 30 * D, windowKey: 'w1', ...over,
})
const run = (id, raw, cfg = {}, over = {}) => {
  const def = c.CATALOG_BY_ID[id]
  return def.find(raw, c.resolveConfig(def, cfg), ctx(over))
}

test('the library has every engine automation with a plain name, a default message and valid settings', () => {
  const engine = c.CATALOG.filter(d => d.kind === 'engine')
  assert.deepEqual(engine.map(d => d.id).sort(), ['appointment_reminders', 'car_ready', 'declined_work', 'estimate_followups', 'lead_followup', 'lead_outreach', 're_engagement', 'review_requests', 'service_reminders', 'sms_blast'])
  for (const d of c.CATALOG) {
    assert.match(d.name, /^[A-Z]/)
    assert.doesNotMatch(d.name + d.blurb, /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u, d.id)
    assert.equal(typeof d.find === 'function' || d.kind === 'legacy', true, d.id)
    const cfg = c.resolveConfig(d, {})
    assert.ok(cfg.schedule, d.id)
    assert.equal(c.configProblems(d, cfg).length, 0, d.id + ' defaults are valid')
  }
  // Only the owner writes a promotion. Everything else starts from a plain message that names no offer.
  assert.equal(c.CATALOG_BY_ID.sms_blast.template, '')
  for (const d of engine.filter(x => x.id !== 'sms_blast')) assert.doesNotMatch(d.template, /\$|%|free|discount|special/i, d.id)
})

test('settings are checked: numbers within limits, schedule text understood, unknown keys refused', () => {
  const def = c.CATALOG_BY_ID.estimate_followups
  assert.equal(c.resolveConfig(def, { followup_hours: 9999 }).followup_hours, 48)
  assert.equal(c.resolveConfig(def, { followup_hours: '72' }).followup_hours, 72)
  assert.equal(c.resolveConfig(def, { schedule: 'sometimes' }).schedule, 'Daily at 10am')
  assert.equal(c.resolveConfig(def, { schedule: 'Daily at 8am' }).schedule, 'Daily at 8am')
  assert.deepEqual(c.configProblems(def, { followup_hours: 24, schedule: 'Daily at 8am' }), [])
  assert.match(c.configProblems(def, { followup_hours: 2 })[0], /Follow up after/)
  assert.match(c.configProblems(def, { schedule: 'sometimes' })[0], /schedule/)
  assert.match(c.configProblems(def, { bogus: 1 })[0], /not a setting/)
  assert.equal(c.scheduleOf(def, { schedule: 'nonsense' }), 'Daily at 10am')
})

test('review requests: paid invoices only, after the wait, never to unhappy customers, never without a link', () => {
  const raw = emptyRaw()
  raw.customers = [customer('c1', 'Marcus Bell', '7135550101'), customer('c2', 'Dana Ortiz', '7135550102'), customer('c3', 'Priya Nair', '7135550103', { sentiment: 'unhappy' }), customer('c4', 'Old Timer', '7135550104')]
  raw.documents = [
    paidInvoice('1', 'c1', iso(now - 3 * H)),
    paidInvoice('2', 'c2', iso(now - 1 * H)),
    paidInvoice('3', 'c3', iso(now - 5 * H)),
    paidInvoice('4', 'c4', iso(now - 5 * D)),
    { ...paidInvoice('5', 'c1', iso(now - 5 * H)), status: 'Unpaid' },
    { ...paidInvoice('6', 'c1', iso(now - 5 * H)), type: 'Estimate' },
  ]
  const out = run('review_requests', raw)
  assert.deepEqual(out.map(x => x.sourceId), ['3', '1', '2'])
  const marcus = out.find(x => x.sourceId === '1')
  assert.equal(marcus.dedupeKey, 'review_requests:1')
  assert.equal(marcus.eligibleAt, now - 3 * H + 2 * H)
  assert.equal(marcus.vars.review_link, 'https://g.page/r/bayou/review')
  assert.equal(marcus.vars.name, 'Marcus')
  assert.equal(out.find(x => x.sourceId === '3').blockedBy, 'unhappy_customer')
  assert.ok(out.find(x => x.sourceId === '2').eligibleAt > now)
  const noLink = run('review_requests', raw, {}, { reviewUrl: '' })
  assert.ok(noLink.every(x => x.blockedBy === 'no_review_link'))
  assert.match(c.CATALOG_BY_ID.review_requests.setupProblem(ctx({ reviewUrl: '' }), {}), /review link/i)
  assert.equal(c.CATALOG_BY_ID.review_requests.setupProblem(ctx(), {}), null)
})

test('estimate follow-up: only sent, unanswered, not yet invoiced, not expired, inside the window', () => {
  const raw = emptyRaw()
  raw.customers = [customer('c1', 'Marcus Bell', '7135550101'), customer('c2', 'No Phone', '', { email: 'np@example.com' })]
  const est = (id, hoursAgo, extra = {}) => ({ id, type: 'Estimate', status: 'Sent', doc_number: 'EST-' + id, customer_id: 'c1', customer_name: 'Marcus Bell', sent_at: iso(now - hoursAgo * H), created_at: iso(now - hoursAgo * H), vehicle_year: '2018', vehicle_make: 'Ford', vehicle_model: 'F-150', __total: 412.5, job_id: null, ...extra })
  raw.documents = [
    est('a', 60),
    est('b', 10),
    est('c', 60, { status: 'Draft' }),
    est('d', 60, { status: 'Approved' }),
    est('e', 60, { job_id: 'j1' }),
    est('f', 24 * 20),
    est('g', 60, { expires_date: '2026-10-01' }),
    est('h', 60, { customer_id: 'c2', customer_name: 'No Phone' }),
    { id: 'inv', type: 'Invoice', status: 'Paid', job_id: 'j1', customer_id: 'c1' },
  ]
  const out = run('estimate_followups', raw)
  assert.deepEqual(out.map(x => x.sourceId).sort(), ['a', 'b', 'h'])
  const a = out.find(x => x.sourceId === 'a')
  assert.equal(a.vars.amount, '$412.50')
  assert.equal(a.vars.vehicle, '2018 Ford F-150')
  assert.equal(a.eligibleAt, now - 60 * H + 48 * H)
  assert.ok(out.find(x => x.sourceId === 'b').eligibleAt > now)
  // No phone: email is used when email is set up, and refused with a clear reason when it is not.
  const h = out.find(x => x.sourceId === 'h')
  assert.equal(h.channel, 'email')
  assert.equal(h.blockedBy, 'email_not_set_up')
  assert.equal(run('estimate_followups', raw, {}, { emailReady: true }).find(x => x.sourceId === 'h').blockedBy, undefined)
})

test('declined work: names only what is on their own estimate or inspection', () => {
  const raw = emptyRaw()
  raw.customers = [customer('c1', 'Marcus Bell', '7135550101'), customer('c2', 'Dana Ortiz', '7135550102')]
  raw.documents = [
    { id: 'e1', type: 'Estimate', status: 'Sent', doc_number: 'EST-1', customer_id: 'c1', sent_at: iso(now - 40 * D), created_at: iso(now - 40 * D), labors: [{ operation: 'Front brake pads' }, { operation: 'Rotor resurface' }, { operation: 'Front brake pads' }], vehicle_make: 'Toyota', vehicle_model: 'Camry', vehicle_year: '2017' },
    { id: 'e2', type: 'Estimate', status: 'Sent', customer_id: 'c1', sent_at: iso(now - 5 * D), created_at: iso(now - 5 * D), labors: [] },
    { id: 'e3', type: 'Estimate', status: 'Approved', customer_id: 'c1', sent_at: iso(now - 40 * D), created_at: iso(now - 40 * D), labors: [] },
  ]
  raw.dvi = [
    { id: 'd1', customer_id: 'c2', customer_name: 'Dana Ortiz', vehicle: '2015 Honda Accord', declinedNames: ['Rear brake pads', 'Cabin air filter'], customer_decided_at: iso(now - 45 * D) },
    { id: 'd2', customer_id: 'c2', declinedNames: [], customer_decided_at: iso(now - 45 * D) },
    { id: 'd3', customer_id: 'c2', declinedNames: ['Wipers'], customer_decided_at: iso(now - 2 * D) },
  ]
  const out = run('declined_work', raw)
  assert.deepEqual(out.map(x => x.dedupeKey).sort(), ['declined_work:dvi:d1', 'declined_work:est:e1'])
  assert.equal(out.find(x => x.sourceId === 'e1').vars.items, 'Front brake pads and Rotor resurface')
  assert.equal(out.find(x => x.sourceId === 'd1').vars.items, 'Rear brake pads and Cabin air filter')
  assert.equal(c.CATALOG_BY_ID.declined_work.klass, 'marketing')
})

test('service reminders: by date or by miles, one per vehicle, with the reason in words', () => {
  const raw = emptyRaw()
  raw.customers = [customer('c1', 'Marcus Bell', '7135550101'), customer('c2', 'Dana Ortiz', '7135550102'), customer('c3', 'Priya Nair', '7135550103'), customer('c4', 'Gone Away', '7135550104')]
  const oil = (id, customerId, daysAgo, miles, extra = {}) => ({ id, type: 'Invoice', status: 'Paid', customer_id: customerId, created_at: iso(now - daysAgo * D), doc_date: iso(now - daysAgo * D), labors: [{ operation: 'Oil change' }], vehicle_year: '2016', vehicle_make: 'Toyota', vehicle_model: 'Corolla', vehicle_mileage: String(miles), ...extra })
  raw.documents = [
    oil('i1', 'c1', 100, 40000),
    oil('i2', 'c2', 30, 52000),
    oil('i3', 'c3', 40, 61000),
    oil('i4', 'c4', 500, 20000),
  ]
  raw.vehicles = [
    { id: 'v1', customer_id: 'c1', year: '2016', make: 'Toyota', model: 'Corolla', current_mileage: 41000 },
    { id: 'v2', customer_id: 'c2', year: '2016', make: 'Toyota', model: 'Corolla', current_mileage: 55000 },
    { id: 'v3', customer_id: 'c3', year: '2016', make: 'Toyota', model: 'Corolla', current_mileage: 61500 },
    { id: 'v4', customer_id: 'c4', year: '2016', make: 'Toyota', model: 'Corolla', current_mileage: 20500 },
  ]
  const out = run('service_reminders', raw)
  assert.deepEqual(out.map(x => x.sourceId).sort(), ['v1', 'v2'])
  assert.match(out.find(x => x.sourceId === 'v1').why, /100 days since the last oil change/)
  const v2 = out.find(x => x.sourceId === 'v2')
  assert.match(v2.why, /3,000 miles since the last oil change/)
  assert.equal(v2.vars.service, 'oil change')
  assert.equal(v2.vars.vehicle, '2016 Toyota Corolla')
  assert.match(v2.dedupeKey, /^service_reminders:v2:oil_change:2026-09-14$/)
  // The owner can change the interval; tire rotation is a separate switch.
  assert.equal(run('service_reminders', raw, { interval_days: 400, interval_miles: 20000 }).length, 0)
})

test('car ready: one text per job, only jobs that became ready after the automation was switched on', () => {
  const raw = emptyRaw()
  raw.customers = [customer('c1', 'Marcus Bell', '7135550101')]
  const job = (id, status, hoursAgo) => ({ id, status, customer_id: 'c1', customer_name: 'Marcus Bell', updated_at: iso(now - hoursAgo * H), vehicle_year: '2019', vehicle_make: 'Honda', vehicle_model: 'Civic' })
  raw.jobs = [job('j1', 'Ready for Pickup', 2), job('j2', 'Ready for Pickup', 100), job('j3', 'In Progress', 1), job('j4', 'Ready for Pickup', 10)]
  const out = run('car_ready', raw, {}, { enabledAt: now - 5 * H })
  assert.deepEqual(out.map(x => x.sourceId), ['j1'])
  assert.equal(out[0].dedupeKey, 'car_ready:j1')
  assert.equal(out[0].vars.vehicle, '2019 Honda Civic')
  assert.deepEqual(run('car_ready', raw, {}, { enabledAt: null }).map(x => x.sourceId).sort(), ['j1', 'j4'])
})

test('appointment reminders: by the clock, one per appointment, not for last-minute bookings', () => {
  const raw = emptyRaw()
  raw.customers = [customer('c1', 'Marcus Bell', '7135550101'), customer('c2', 'Opted Out', '7135550102', { sms_opted_out: true })]
  const appt = (id, date, time, extra = {}) => ({ id, status: 'Scheduled', date, time, customer_id: 'c1', customer_name: 'Marcus Bell', service: 'Brake inspection', reminder_sent_at: null, ...extra })
  raw.appointments = [
    appt('a1', '2026-10-15', '9:30 AM'),
    appt('a2', '2026-10-16', '9:30 AM'),
    appt('a3', '2026-10-14', '4:00 PM'),
    appt('a4', '2026-10-15', '10:00 AM', { reminder_sent_at: iso(now - H) }),
    appt('a5', '2026-10-15', '11:00 AM', { status: 'Cancelled' }),
    appt('a6', '2026-10-15', '1:00 PM', { customer_id: null, phone: '(713) 555-0166', customer_name: 'Walk In' }),
    appt('a7', '2026-10-15', '2:00 PM', { customer_id: 'c2' }),
  ]
  const out = run('appointment_reminders', raw)
  assert.deepEqual(out.map(x => x.sourceId).sort(), ['a1', 'a6', 'a7'])
  const a1 = out.find(x => x.sourceId === 'a1')
  assert.equal(a1.vars.date, 'tomorrow at 9:30 AM')
  assert.equal(a1.vars.service, 'Brake inspection')
  assert.equal(a1.exemptFromLimits, true)
  assert.equal(out.find(x => x.sourceId === 'a6').phone, '(713) 555-0166')
  assert.equal(out.find(x => x.sourceId === 'a7').smsOptedOut, true)
})

test('appointment start times and wording', () => {
  const tz = 'America/Chicago'
  assert.equal(new Date(c.appointmentStart('2026-10-15', '2:30 PM', tz)).toISOString(), '2026-10-15T19:30:00.000Z')
  assert.equal(new Date(c.appointmentStart('2026-10-15', '14:30', tz)).toISOString(), '2026-10-15T19:30:00.000Z')
  assert.equal(new Date(c.appointmentStart('2026-10-15', '9am', tz)).toISOString(), '2026-10-15T14:00:00.000Z')
  assert.equal(new Date(c.appointmentStart('2026-10-15', '', tz)).toISOString(), '2026-10-15T14:00:00.000Z')
  assert.equal(new Date(c.appointmentStart('2026-10-15', '3:00', tz)).toISOString(), '2026-10-15T20:00:00.000Z') // no am/pm: shops do not book at 3 in the morning
  assert.equal(c.appointmentStart('soon', '9am', tz), null)
  assert.equal(c.appointmentStart('2026-10-15', '25:00', tz), null)
  assert.equal(c.whenWords(Date.parse('2026-10-14T22:00:00Z'), now, tz), 'today at 5:00 PM')
  assert.equal(c.whenWords(Date.parse('2026-10-16T15:00:00Z'), now, tz), 'Friday, Oct 16 at 10:00 AM')
})

test('win-back: gone for the set months, not for years, oldest absence first', () => {
  const raw = emptyRaw()
  raw.customers = [customer('c1', 'Marcus Bell', '7135550101'), customer('c2', 'Dana Ortiz', '7135550102'), customer('c3', 'Priya Nair', '7135550103'), customer('c4', 'Long Gone', '7135550104')]
  raw.documents = [
    paidInvoice('1', 'c1', iso(now - 150 * D), { doc_date: iso(now - 150 * D) }),
    paidInvoice('2', 'c2', iso(now - 30 * D), { doc_date: iso(now - 30 * D) }),
    paidInvoice('3', 'c3', iso(now - 400 * D), { doc_date: iso(now - 400 * D) }),
    paidInvoice('4', 'c4', iso(now - 1000 * D), { doc_date: iso(now - 1000 * D) }),
  ]
  const out = run('re_engagement', raw)
  assert.deepEqual(out.map(x => x.customerId), ['c3', 'c1'])
  assert.match(out[1].why, /Last visit 5 months ago/)
  assert.match(out[0].dedupeKey, /^re_engagement:c3:/)
})

test('recurring promotion: the owner writes it, filters pick the people, STOP and no-phone are marked for the engine to leave out', () => {
  const raw = emptyRaw()
  raw.customers = [
    customer('c1', 'Marcus Bell', '7135550101', { tags: ['fleet'], vehicle_make: 'Ford' }),
    customer('c2', 'Dana Ortiz', '7135550102', { sms_opted_out: true }),
    customer('c3', 'Priya Nair', '', {}),
    customer('c4', 'Sam Lee', '7135550104', { tags: ['retail'] }),
  ]
  const all = run('sms_blast', raw)
  assert.deepEqual(all.map(x => x.customerId).sort(), ['c1', 'c2', 'c3', 'c4'])
  assert.equal(all.find(x => x.customerId === 'c2').smsOptedOut, true)
  assert.equal(all.find(x => x.customerId === 'c3').phone, null)
  assert.equal(all[0].dedupeKey.endsWith(':w1'), true)
  assert.deepEqual(run('sms_blast', raw, { tags: 'fleet' }).map(x => x.customerId), ['c1'])
  assert.match(c.CATALOG_BY_ID.sms_blast.setupProblem(ctx(), { message: '' }), /Write the message/)
  assert.equal(c.CATALOG_BY_ID.sms_blast.setupProblem(ctx(), { message: 'Hi {name}, brake check this week.' }), null)
})

test('a saved blank message falls back to the default wording, but a promotion stays blank until the owner writes one', () => {
  const rr = c.CATALOG_BY_ID.review_requests
  const cfg = c.resolveConfig(rr, { message: '   ' })
  assert.equal(cfg.message, rr.template)
  const blast = c.CATALOG_BY_ID.sms_blast
  assert.equal(c.resolveConfig(blast, { message: '' }).message, '')
})

test('lead follow-up texts people who called in and have not booked, a fixed number of times, spaced apart', () => {
  const lead = (over = {}) => ({ id: 'L1', name: 'Dana Ruiz', phone: '(713) 555-0142', email: '', status: 'new', needs_followup: true, converted: false, touch_count: 1, last_contact: iso(now - 3 * D), created_at: iso(now - 3 * D), ...over })
  const raw = { ...emptyRaw(), growth_leads: [
    lead(),
    lead({ id: 'L2', touch_count: 3 }),                       // already had two follow-ups
    lead({ id: 'L3', converted: true }),                      // became a customer
    lead({ id: 'L4', status: 'not_interested' }),
    lead({ id: 'L5', needs_followup: false }),
    lead({ id: 'L6', last_contact: iso(now - 1 * D) }),       // texted yesterday: not due for two days
    lead({ id: 'L7', phone: '' }),                            // nothing to text
  ] }
  const out = run('lead_followup', raw)
  const byId = Object.fromEntries(out.map(x => [x.sourceId, x]))
  assert.deepEqual(Object.keys(byId).sort(), ['L1', 'L6', 'L7'])
  assert.equal(byId.L1.dedupeKey, 'lead_followup:L1:1')
  assert.ok(byId.L1.eligibleAt <= now, 'due now')
  assert.ok(byId.L6.eligibleAt > now, 'waits its turn')
  assert.match(byId.L1.why, /Follow-up 1 of 2/)
  // The next follow-up is a different message, so it is never mistaken for the first.
  assert.equal(run('lead_followup', { ...emptyRaw(), growth_leads: [lead({ touch_count: 2 })] })[0].dedupeKey, 'lead_followup:L1:2')
  assert.equal(run('lead_followup', { ...emptyRaw(), growth_leads: [lead({ touch_count: 2 })] }, { max_followups: 1 }).length, 0)
})

test('lead outreach emails each new lead once, greets a named owner, and never invents a first name for a business', () => {
  const lead = (over = {}) => ({ id: 'X1', name: 'Ace Plumbing', owner_name: 'Rosa Diaz', email: 'rosa@aceplumbing.example', status: 'new', source: 'ai-fleet-scan', service_needed: 'fleet service', created_at: iso(now - D), ...over })
  const raw = { ...emptyRaw(), leads: [
    lead(),
    lead({ id: 'X2', owner_name: '', name: 'Gulf Coast Freight' }),                 // a business with no named owner
    lead({ id: 'X3', owner_name: '', name: 'Jamie Ortiz', source: 'ai-social-scan' }),  // a person who posted
    lead({ id: 'X4', email: 'not-an-email' }),
    lead({ id: 'X5', status: 'contacted' }),
    lead({ id: 'X6', email: '' }),
  ] }
  const out = run('lead_outreach', raw, {}, { emailReady: true })
  const byId = Object.fromEntries(out.map(x => [x.sourceId, x]))
  assert.deepEqual(Object.keys(byId).sort(), ['X1', 'X2', 'X3'])
  assert.equal(byId.X1.vars.name, 'Rosa')
  assert.equal(byId.X2.vars.name, 'there')
  assert.equal(byId.X3.vars.name, 'Jamie')
  assert.equal(byId.X1.channel, 'email')
  assert.equal(byId.X1.klass, 'marketing')
  assert.equal(byId.X1.dedupeKey, 'lead_outreach:X1')
  // Without email set up nothing goes out, and the card says why before it is switched on.
  assert.equal(run('lead_outreach', raw, {}, { emailReady: false })[0].blockedBy, 'email_not_set_up')
  assert.match(c.CATALOG_BY_ID.lead_outreach.setupProblem(ctx({ emailReady: false }), {}), /Email is not set up/)
  assert.equal(c.CATALOG_BY_ID.lead_outreach.setupProblem(ctx({ emailReady: true }), {}), null)
  // A small daily start: ten at a time.
  assert.equal(c.resolveConfig(c.CATALOG_BY_ID.lead_outreach, {}).max_per_run, 10)
})

test('extra service jobs are off until switched on, and a yearly inspection is by date only', async () => {
  const { CATALOG_BY_ID } = await import('../src/lib/automation-catalog.ts')
  const { EXTRA_SERVICE_RULES, serviceDue } = await import('../src/lib/automation-rules.ts')
  const fields = CATALOG_BY_ID.service_reminders.fields
  for (const r of EXTRA_SERVICE_RULES) {
    const f = fields.find(x => x.key === r.setting)
    assert.ok(f, `${r.label} has a switch`)
    assert.equal(f.type, 'boolean')
    assert.equal(f.default, false)
  }
  assert.ok(fields.some(f => f.label === 'Also remind about coolant flushes'))
  const rule = EXTRA_SERVICE_RULES.find(r => r.key === 'state_inspection')
  const day = 86_400_000
  const now = Date.parse('2026-10-15T15:00:00Z')
  const due = serviceDue({ rule, lastServiceAt: now - 360 * day, lastServiceMiles: 10_000, currentMiles: 10_050, now, leadDays: 7, leadMiles: 300 })
  assert.equal(due.basis, 'date')
  const early = serviceDue({ rule, lastServiceAt: now - 100 * day, lastServiceMiles: 10_000, currentMiles: 90_000, now, leadDays: 7, leadMiles: 300 })
  assert.equal(early.due, false, 'miles never make a date-only job due')
})

test('service reminders: a switched-on extra job is reminded by date, and stays quiet when off', () => {
  const raw = emptyRaw()
  raw.customers = [customer('c1', 'Marcus Bell', '7135550101')]
  raw.documents = [{ id: 'i1', type: 'Invoice', status: 'Paid', customer_id: 'c1', created_at: iso(now - 360 * D), doc_date: iso(now - 360 * D), labors: [{ operation: 'State inspection' }], vehicle_year: '2016', vehicle_make: 'Toyota', vehicle_model: 'Corolla', vehicle_mileage: '40000' }]
  raw.vehicles = [{ id: 'v1', customer_id: 'c1', year: '2016', make: 'Toyota', model: 'Corolla', current_mileage: 99000 }]
  assert.equal(run('service_reminders', raw).length, 0, 'off by default')
  const out = run('service_reminders', raw, { svc_state_inspection: true })
  assert.equal(out.length, 1)
  assert.equal(out[0].vars.service, 'state inspection')
  assert.match(out[0].why, /360 days since the last state inspection/)
  assert.doesNotMatch(out[0].why, /miles/, 'a yearly inspection is never due by miles')
})
