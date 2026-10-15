import test from 'node:test'
import assert from 'node:assert/strict'
import { drainShop, messagesFromPlan, pauseAndCancel, planAutomation, runAutomation, runSentence } from '../src/lib/automation-engine.ts'
import { createFake, customer, emptyRaw, enabledState, fakeShop, paidInvoice, SHOP_ID } from './helpers/automation-fake.mjs'

const H = 3_600_000
const D = 86_400_000
const iso = ms => new Date(ms).toISOString()
const AFTERNOON = Date.parse('2026-10-14T20:00:00Z') // 3pm in Houston
const NIGHT = Date.parse('2026-10-15T03:00:00Z') // 10pm in Houston
const MORNING = Date.parse('2026-10-15T13:00:00Z') // 8am in Houston

function reviewShop(extra = {}, start = AFTERNOON, invoiceHoursAgo = 4) {
  const raw = emptyRaw()
  raw.customers = [customer('c1', 'Marcus Bell', '7135550101')]
  raw.documents = [paidInvoice('1', 'c1', iso(start - invoiceHoursAgo * H))]
  const shop = fakeShop({ states: { review_requests: enabledState() } })
  return createFake({ shop, raw, start, ...extra })
}

const go = (f, id = 'review_requests', manual = false) => runAutomation(f.deps, { shopId: SHOP_ID, automationId: id, runId: 'run-1', manual })

test('a run texts the exact message the preview showed, once, with the opt-out line', async () => {
  const f = reviewShop()
  const preview = await planAutomation(f.deps, { shopId: SHOP_ID, automationId: 'review_requests' })
  assert.equal(preview.summary.send, 1)
  const planned = preview.decisions[0].text
  assert.equal(planned, 'Hi Marcus, thank you for choosing Bayou City Garage. If we earned it, would you leave us a quick review? https://g.page/r/bayou-city-garage/review Reply STOP to opt out.')
  assert.equal(f.state.messages.length, 0, 'a preview writes nothing and sends nothing')

  const out = await go(f)
  assert.equal(out.queued, 1)
  assert.equal(out.drain.sent, 1)
  assert.equal(f.state.sent.length, 1)
  assert.equal(f.state.sent[0].text, planned)
  assert.equal(f.state.sent[0].to, '7135550101')
  assert.equal(f.state.sent[0].key, 'am:m1')
  const row = f.state.messages[0]
  assert.equal(row.status, 'sent')
  assert.equal(row.provider_message_id, 'prov-m1')
  assert.equal(row.run_id, 'run-1')
  assert.equal(runSentence(out), '1 sent.')
})

test('never double-sends: running again, or two workers at once, sends nothing more', async () => {
  const f = reviewShop()
  await go(f)
  const again = await go(f)
  assert.equal(again.queued, 0)
  assert.equal(f.state.sent.length, 1)

  const g = reviewShop()
  g.state.shop.states.review_requests.enabled = true
  const plan = await planAutomation(g.deps, { shopId: SHOP_ID, automationId: 'review_requests' })
  await g.deps.store.insertMessages(messagesFromPlan(plan, null, false))
  await Promise.all([drainShop(g.deps, SHOP_ID), drainShop(g.deps, SHOP_ID), drainShop(g.deps, SHOP_ID)])
  assert.equal(g.state.sent.length, 1)
  assert.equal(g.state.messages[0].attempts, 1)
})

test('quiet hours hold a message and release it at 8am, not before', async () => {
  const f = reviewShop({}, NIGHT)
  const out = await go(f)
  assert.equal(out.queued, 1)
  assert.equal(out.drain.sent, 0)
  assert.equal(out.heldForQuietHours, 1)
  assert.equal(f.state.messages[0].send_after, '2026-10-15T13:00:00.000Z')
  assert.equal(f.state.messages[0].detail.held_for_quiet_hours, true)
  assert.match(runSentence(out), /1 waiting for morning/)
  f.at(MORNING - 60_000)
  assert.equal((await drainShop(f.deps, SHOP_ID)).sent, 0)
  f.at(MORNING + 60_000)
  assert.equal((await drainShop(f.deps, SHOP_ID)).sent, 1)
  assert.equal(f.state.sent.length, 1)
})

test('quiet hours are checked again at send time, even for a message that was due earlier', async () => {
  const f = reviewShop()
  const plan = await planAutomation(f.deps, { shopId: SHOP_ID, automationId: 'review_requests' })
  await f.deps.store.insertMessages(messagesFromPlan(plan, null, false))
  f.at(NIGHT) // the worker only gets to it at 10pm
  const d = await drainShop(f.deps, SHOP_ID)
  assert.equal(d.sent, 0)
  assert.equal(d.rescheduled, 1)
  assert.equal(f.state.sent.length, 0)
  assert.equal(f.state.messages[0].status, 'queued')
  assert.equal(f.state.messages[0].send_after, '2026-10-15T13:00:00.000Z')
})

test('a Pacific number is held until 8am where they live, even when the shop is open', async () => {
  const start = Date.parse('2026-10-14T14:30:00Z') // 9:30am Houston, 7:30am Los Angeles
  const raw = emptyRaw()
  raw.customers = [customer('c1', 'Sam Lee', '4155550101')]
  raw.documents = [paidInvoice('1', 'c1', iso(start - 5 * H))]
  const f = createFake({ shop: fakeShop({ states: { review_requests: enabledState() } }), raw, start })
  const out = await go(f)
  assert.equal(out.drain.sent, 0)
  assert.equal(f.state.messages[0].send_after, '2026-10-14T15:00:00.000Z')
  f.at('2026-10-14T15:00:30Z')
  assert.equal((await drainShop(f.deps, SHOP_ID)).sent, 1)
})

test('STOP is honoured on the server at send time, even after the message was queued', async () => {
  const f = reviewShop({}, NIGHT)
  await go(f)
  assert.equal(f.state.messages[0].status, 'queued')
  f.state.optedOutPhones.add('7135550101') // the customer replied STOP overnight
  f.at(MORNING + 60_000)
  const d = await drainShop(f.deps, SHOP_ID)
  assert.equal(d.sent, 0)
  assert.equal(d.skipped, 1)
  assert.equal(f.state.sent.length, 0)
  assert.equal(f.state.messages[0].status, 'skipped')
  assert.equal(f.state.messages[0].skip_reason, 'opted_out')
})

test('the customer record flag is checked at send time too', async () => {
  const f = reviewShop({}, NIGHT)
  await go(f)
  f.state.optedOutCustomers.add('c1')
  f.at(MORNING + 60_000)
  await drainShop(f.deps, SHOP_ID)
  assert.equal(f.state.sent.length, 0)
  assert.equal(f.state.messages[0].skip_reason, 'opted_out')
})

test('if consent cannot be checked, nothing is sent and the message waits', async () => {
  const f = reviewShop()
  const plan = await planAutomation(f.deps, { shopId: SHOP_ID, automationId: 'review_requests' })
  await f.deps.store.insertMessages(messagesFromPlan(plan, null, false))
  f.state.consentFails = true
  const d = await drainShop(f.deps, SHOP_ID)
  assert.equal(d.sent, 0)
  assert.equal(f.state.sent.length, 0)
  assert.equal(f.state.messages[0].status, 'queued')
  assert.match(f.state.messages[0].last_error, /Consent could not be checked/)
})

test('pausing cancels what is waiting, and switching it back on starts fresh', async () => {
  const f = reviewShop({}, NIGHT)
  await go(f)
  assert.equal(f.state.messages[0].status, 'queued')
  const n = await pauseAndCancel(f.deps, SHOP_ID, 'review_requests', 'paused')
  assert.equal(n, 1)
  assert.equal(f.state.messages[0].status, 'cancelled')
  assert.equal(f.state.messages[0].skip_reason, 'paused')
  assert.equal(f.state.messages[0].dedupe_key, null)
  f.state.shop.states.review_requests.enabled = false
  f.at(MORNING + 60_000)
  assert.equal((await drainShop(f.deps, SHOP_ID)).sent, 0)
  assert.equal(f.state.sent.length, 0)
  // Back on: the person is found again and texted once.
  f.state.shop.states.review_requests.enabled = true
  const out = await go(f)
  assert.equal(out.drain.sent, 1)
  assert.equal(f.state.sent.length, 1)
})

test('even if nobody cancelled it, a paused automation never sends what it had queued', async () => {
  const f = reviewShop()
  const plan = await planAutomation(f.deps, { shopId: SHOP_ID, automationId: 'review_requests' })
  await f.deps.store.insertMessages(messagesFromPlan(plan, null, false))
  f.state.shop.states.review_requests.enabled = false
  const d = await drainShop(f.deps, SHOP_ID)
  assert.equal(d.cancelled, 1)
  assert.equal(f.state.sent.length, 0)
  assert.equal(f.state.messages[0].skip_reason, 'paused')
})

test('a manual run works while the automation is off, but the master switch stops everything', async () => {
  const f = reviewShop()
  f.state.shop.states.review_requests.enabled = false
  const manual = await go(f, 'review_requests', true)
  assert.equal(manual.drain.sent, 1)

  const g = reviewShop()
  g.state.shop.rules = { ...g.state.shop.rules, master_enabled: false }
  const plan = await planAutomation(g.deps, { shopId: SHOP_ID, automationId: 'review_requests' })
  await g.deps.store.insertMessages(messagesFromPlan(plan, null, true))
  const out = await go(g, 'review_requests', true)
  assert.match(out.problems.join(' '), /switched off/)
  const d = await drainShop(g.deps, SHOP_ID)
  assert.equal(d.cancelled, 1)
  assert.equal(g.state.sent.length, 0)
  assert.equal(g.state.messages[0].skip_reason, 'master_off')
})

test('a failed send retries after 5 minutes, then 30, then stops and tells the owner', async () => {
  const f = reviewShop()
  f.state.sendPlan = [{ ok: false, error: 'Telnyx returned 503' }, { ok: false, error: 'Telnyx returned 503' }, { ok: false, error: 'Telnyx returned 503' }]
  const first = await go(f)
  assert.equal(first.drain.retrying, 1)
  assert.equal(f.state.messages[0].status, 'queued')
  assert.equal(f.state.messages[0].next_attempt_at, iso(AFTERNOON + 5 * 60_000))
  f.at(AFTERNOON + 4 * 60_000)
  assert.equal((await drainShop(f.deps, SHOP_ID)).looked, 0, 'not before the wait is over')
  f.at(AFTERNOON + 5 * 60_000)
  assert.equal((await drainShop(f.deps, SHOP_ID)).retrying, 1)
  assert.equal(f.state.messages[0].next_attempt_at, iso(AFTERNOON + 35 * 60_000))
  f.at(AFTERNOON + 35 * 60_000)
  const last = await drainShop(f.deps, SHOP_ID)
  assert.equal(last.failed, 1)
  assert.equal(f.state.messages[0].status, 'failed')
  assert.equal(f.state.messages[0].attempts, 3)
  assert.equal(f.state.sent.length, 3)
  assert.equal(f.state.alerts.length, 1)
  assert.equal(f.state.alerts[0].automationId, 'review_requests')
  assert.equal(f.state.alerts[0].count, 1)
  f.at(AFTERNOON + 10 * H)
  assert.equal((await drainShop(f.deps, SHOP_ID)).looked, 0)
  assert.equal(f.state.sent.length, 3)
  // A failed message is not queued again by the next run.
  assert.equal((await go(f)).queued, 0)
})

test('a number that can never work fails at once, and a setup problem tells the owner what to fix', async () => {
  const f = reviewShop()
  f.state.sendPlan = [{ ok: false, error: 'The destination number is invalid' }]
  const out = await go(f)
  assert.equal(out.drain.failed, 1)
  assert.equal(f.state.sent.length, 1)
  assert.equal(f.state.messages[0].status, 'failed')
  assert.match(f.state.alerts[0].advice, /cannot receive/)

  const g = reviewShop()
  g.state.sendPlan = [{ ok: false, error: 'Telnyx credentials not configured' }]
  await go(g)
  assert.equal(g.state.messages[0].status, 'failed')
  assert.match(g.state.alerts[0].advice, /Settings/)
})

test('an uncertain result is never retried by itself', async () => {
  const f = reviewShop()
  f.state.sendPlan = [new Error('socket hang up')]
  const out = await go(f)
  assert.equal(out.drain.unknown, 1)
  assert.equal(f.state.messages[0].status, 'unknown')
  f.at(AFTERNOON + 10 * H)
  await drainShop(f.deps, SHOP_ID)
  assert.equal(f.state.sent.length, 1)
  assert.equal(f.state.alerts.length, 1)
})

test('failure alerts can be turned off in shop rules', async () => {
  const f = reviewShop()
  f.state.shop.rules = { ...f.state.shop.rules, alert_on_failure: false }
  f.state.sendPlan = [{ ok: false, error: 'The destination number is invalid' }]
  await go(f)
  assert.equal(f.state.alerts.length, 0)
})

test('per-customer limits: a recent marketing text blocks this one, and the skip is written down once', async () => {
  const f = reviewShop({ recent: [{ customerId: 'c1', phone: '7135550101', automationId: 'sms_blast', klass: 'marketing', at: AFTERNOON - 2 * D }] })
  const out = await go(f)
  assert.equal(out.queued, 0)
  assert.equal(out.skipped, 1)
  assert.equal(f.state.sent.length, 0)
  assert.equal(f.state.messages[0].status, 'skipped')
  assert.equal(f.state.messages[0].skip_reason, 'frequency_cap')
  assert.equal(f.state.messages[0].detail.why.startsWith('Paid invoice'), true)
  await go(f)
  assert.equal(f.state.messages.length, 1, 'the same skip is not logged on every run')
})

test('limits are re-checked at send time: another message went out while this one waited', async () => {
  const f = reviewShop({}, NIGHT)
  await go(f)
  f.state.recent.push({ customerId: 'c1', phone: '7135550101', automationId: 'sms_blast', klass: 'marketing', at: NIGHT + H })
  f.at(MORNING + 60_000)
  await drainShop(f.deps, SHOP_ID)
  assert.equal(f.state.sent.length, 0)
  assert.equal(f.state.messages[0].skip_reason, 'frequency_cap')
})

test('things that stop a run are reported, and nothing is queued', async () => {
  const f = reviewShop()
  f.state.shop.reviewUrl = ''
  const out = await go(f)
  assert.equal(out.ok, false)
  assert.match(out.error, /review link/i)
  assert.equal(f.state.messages.length, 0)

  const g = reviewShop()
  g.state.shop.smsReady = false
  assert.match((await go(g)).error, /Texting is not set up/)

  const h = reviewShop()
  h.state.shop.states.review_requests.config = { message: 'Hi {nme}' }
  assert.match((await go(h)).error, /\{nme\}/)
  assert.equal(h.state.sent.length, 0)
})

test('the limit per run leaves the rest for the next run, which finishes the list without repeats', async () => {
  const raw = emptyRaw()
  const start = AFTERNOON
  for (let i = 1; i <= 5; i += 1) {
    raw.customers.push(customer(`c${i}`, `Person ${i}`, `71355501${String(i).padStart(2, '0')}`))
    raw.documents.push(paidInvoice(String(i), `c${i}`, iso(start - 5 * H)))
  }
  const f = createFake({ shop: fakeShop({ states: { review_requests: enabledState({ config: { max_per_run: 2 } }) } }), raw, start })
  const first = await go(f)
  assert.equal(first.queued, 2)
  assert.equal(first.later, 3)
  assert.equal(f.state.sent.length, 2)
  const second = await go(f)
  assert.equal(second.queued, 2)
  const third = await go(f)
  assert.equal(third.queued, 1)
  assert.equal(f.state.sent.length, 5)
  assert.equal(new Set(f.state.sent.map(s => s.to)).size, 5)
})

test('service texts carry no opt-out line, are not held by marketing limits, and mark the appointment', async () => {
  const raw = emptyRaw()
  raw.customers = [customer('c1', 'Marcus Bell', '7135550101')]
  raw.appointments = [{ id: 'a1', status: 'Scheduled', date: '2026-10-15', time: '9:30 AM', customer_id: 'c1', customer_name: 'Marcus Bell', service: 'Brake inspection', reminder_sent_at: null }]
  const shop = fakeShop({ states: { appointment_reminders: enabledState() } })
  const recent = [{ customerId: 'c1', phone: '7135550101', automationId: 'sms_blast', klass: 'marketing', at: AFTERNOON - H }]
  const f = createFake({ shop, raw, recent, start: AFTERNOON })
  const out = await go(f, 'appointment_reminders')
  assert.equal(out.drain.sent, 1)
  assert.equal(f.state.sent[0].text, 'Hi Marcus, this is a reminder from Bayou City Garage about your appointment tomorrow at 9:30 AM. Call (713) 555-0188 or reply to this text if you need to change it.')
  assert.doesNotMatch(f.state.sent[0].text, /STOP/)
  assert.deepEqual(f.state.after, ['m1'])
})

test('a promotion is only sent to people who match, and only if the owner wrote it', async () => {
  const raw = emptyRaw()
  raw.customers = [customer('c1', 'Marcus Bell', '7135550101'), customer('c2', 'Dana Ortiz', '7135550102', { sms_opted_out: true }), customer('c3', 'Priya Nair', '')]
  const noMessage = createFake({ shop: fakeShop({ states: { sms_blast: enabledState() } }), raw: structuredClone(raw), start: AFTERNOON })
  const blocked = await go(noMessage, 'sms_blast')
  assert.equal(blocked.ok, false)
  assert.match(blocked.error, /Write the message/)
  assert.equal(noMessage.state.sent.length, 0)

  const f = createFake({ shop: fakeShop({ states: { sms_blast: enabledState({ config: { message: 'Hi {name}, brake check this week at {shop}.' } }) } }), raw, start: AFTERNOON })
  const out = await go(f, 'sms_blast')
  assert.equal(out.drain.sent, 1)
  assert.equal(f.state.sent[0].text, 'Hi Marcus, brake check this week at Bayou City Garage. Reply STOP to opt out.')
  const skipped = f.state.messages.filter(m => m.status === 'skipped').map(m => m.skip_reason).sort()
  assert.deepEqual(skipped, ['no_phone', 'opted_out'])
})

test('the preview and the run agree: same people, same text', async () => {
  const raw = emptyRaw()
  for (let i = 1; i <= 4; i += 1) {
    raw.customers.push(customer(`c${i}`, `Person ${i}`, i === 4 ? '' : `71355501${String(i).padStart(2, '0')}`))
    raw.documents.push(paidInvoice(String(i), `c${i}`, iso(AFTERNOON - 5 * H)))
  }
  const f = createFake({ shop: fakeShop({ states: { review_requests: enabledState() } }), raw, start: AFTERNOON })
  const plan = await planAutomation(f.deps, { shopId: SHOP_ID, automationId: 'review_requests' })
  const out = await go(f)
  assert.equal(plan.summary.send, out.queued)
  assert.deepEqual(plan.decisions.filter(d => d.action === 'send').map(d => d.text).sort(), f.state.sent.map(s => s.text).sort())
  assert.equal(plan.summary.skippedBy.no_phone, 1)
})

test('trying a change in the preview does not save it', async () => {
  const f = reviewShop()
  const plan = await planAutomation(f.deps, { shopId: SHOP_ID, automationId: 'review_requests', configOverride: { message: 'Hi {name}, review us? {review_link}' } })
  assert.equal(plan.decisions[0].text, 'Hi Marcus, review us? https://g.page/r/bayou-city-garage/review Reply STOP to opt out.')
  assert.equal(f.state.shop.states.review_requests.config.message, undefined)
})

// ── One-off promotions (campaigns) ───────────────────────────────────────

function promoShop(extra = {}, start = AFTERNOON) {
  const raw = emptyRaw()
  raw.customers = [
    customer('c1', 'Marcus Bell', '7135550101'),
    customer('c2', 'Dana Ruiz', '7135550102'),
    customer('c3', 'Lee Park', '7135550103'),
  ]
  raw.customers[0].tags = ['fleet']
  const shop = fakeShop({ states: {} })
  return createFake({ shop, raw, start, ...extra })
}
const PROMO = { message: 'Hi {name}, {shop} is open Saturday this month. {contact}.' }

test('a one-off promotion queues every matching person, tied to the promotion, even when its automation is off', async () => {
  const f = promoShop()
  const plan = await planAutomation(f.deps, { shopId: SHOP_ID, automationId: 'sms_blast', configOverride: PROMO, audience: {}, campaignId: 'camp-1', windowKey: 'campaign:camp-1', maxPerRun: 5000, forRun: true })
  assert.equal(plan.summary.send, 3)
  const rows = messagesFromPlan(plan, null, true)
  assert.ok(rows.every(r => r.campaign_id === 'camp-1' && r.detail.manual === true))
  assert.ok(rows.every(r => r.dedupe_key.endsWith(':campaign:camp-1')))
  await f.deps.store.insertMessages(rows)
  const drain = await drainShop(f.deps, SHOP_ID, { automationId: 'sms_blast' })
  assert.equal(drain.sent, 3)
  assert.ok(f.state.sent.every(s => /Reply STOP to opt out\.$/.test(s.text)))
})

test('a promotion can be aimed at a tag, and only that tag is reached', async () => {
  const f = promoShop()
  const plan = await planAutomation(f.deps, { shopId: SHOP_ID, automationId: 'sms_blast', configOverride: PROMO, audience: { tags: ['fleet'] }, campaignId: 'camp-2', windowKey: 'campaign:camp-2', forRun: true })
  assert.deepEqual(plan.decisions.filter(d => d.action === 'send').map(d => d.candidate.name), ['Marcus Bell'])
})

test('the same promotion is never sent to the same person twice, but a new promotion can be', async () => {
  const f = promoShop()
  const send = async (id) => {
    const plan = await planAutomation(f.deps, { shopId: SHOP_ID, automationId: 'sms_blast', configOverride: PROMO, audience: {}, campaignId: id, windowKey: `campaign:${id}`, forRun: true })
    await f.deps.store.insertMessages(messagesFromPlan(plan, null, true))
    return plan
  }
  await send('camp-a')
  const again = await send('camp-a')
  assert.equal(f.state.messages.filter(m => m.status === 'queued' && m.campaign_id === 'camp-a').length, 3, 'a second press queues nothing new')
  assert.equal(again.summary.send, 0)
  await drainShop(f.deps, SHOP_ID)
  assert.equal(f.state.sent.length, 3)
  // A week-long marketing limit still protects customers from a second promotion straight away.
  const second = await send('camp-b')
  assert.equal(second.summary.send, 0)
  assert.equal(second.summary.skippedBy.frequency_cap, 3)
})

test('a scheduled promotion waits for its time, then respects quiet hours', async () => {
  const f = promoShop()
  const at = Date.parse('2026-10-16T12:00:00Z') // 7am Houston Friday: inside quiet hours
  const plan = await planAutomation(f.deps, { shopId: SHOP_ID, automationId: 'sms_blast', configOverride: PROMO, audience: {}, campaignId: 'camp-s', windowKey: 'campaign:camp-s', notBefore: at, forRun: true })
  const rows = messagesFromPlan(plan, null, true)
  assert.equal(rows.length, 3)
  for (const r of rows) assert.ok(Date.parse(r.send_after) >= Date.parse('2026-10-16T13:00:00Z'), 'held until 8am')
  await f.deps.store.insertMessages(rows)
  assert.equal((await drainShop(f.deps, SHOP_ID)).sent, 0, 'nothing goes out before the time')
  f.at('2026-10-16T13:05:00Z')
  assert.equal((await drainShop(f.deps, SHOP_ID)).sent, 3)
})

test('a promotion whose owner switched everything off sends nothing and is cancelled with the master switch', async () => {
  const f = promoShop()
  const plan = await planAutomation(f.deps, { shopId: SHOP_ID, automationId: 'sms_blast', configOverride: PROMO, audience: {}, campaignId: 'camp-m', windowKey: 'campaign:camp-m', forRun: true })
  await f.deps.store.insertMessages(messagesFromPlan(plan, null, true))
  f.state.shop.rules = { ...f.state.shop.rules, master_enabled: false }
  const drain = await drainShop(f.deps, SHOP_ID)
  assert.equal(drain.sent, 0)
  assert.equal(drain.cancelled, 3)
  assert.equal(f.state.messages[0].skip_reason, 'master_off')
})

test('a promotion with no message written is refused, not made up', async () => {
  const f = promoShop()
  const plan = await planAutomation(f.deps, { shopId: SHOP_ID, automationId: 'sms_blast', configOverride: { message: '   ' }, audience: {}, campaignId: 'camp-x', windowKey: 'campaign:camp-x', forRun: true })
  assert.equal(plan.decisions.length, 0)
  assert.match(plan.problems.join(' '), /Write the message/)
})

test('lead outreach emails only need email set up, never texting, and carry the unsubscribe step in the sender', async () => {
  const raw = emptyRaw()
  raw.leads = [{ id: 'L1', name: 'Ace Plumbing', owner_name: 'Rosa Diaz', email: 'rosa@ace.example', status: 'new', source: 'ai-fleet-scan', service_needed: 'fleet', created_at: iso(AFTERNOON - D) }]
  const shop = fakeShop({ smsReady: false, emailReady: true, states: { lead_outreach: enabledState() } })
  const f = createFake({ shop, raw })
  const out = await go(f, 'lead_outreach')
  assert.equal(out.ok, true, JSON.stringify(out.problems))
  assert.equal(out.drain.sent, 1)
  assert.equal(f.state.sent[0].channel, 'email')
  assert.equal(f.state.sent[0].to, 'rosa@ace.example')
  assert.match(f.state.sent[0].text, /^Hi Rosa, this is Bayou City Garage/)
  assert.equal(f.state.sent[0].subject, 'A note from Bayou City Garage')
  assert.deepEqual(f.state.after.length, 1, 'the lead is marked contacted afterwards')
})

test('a lead who unsubscribed is skipped before the email is written', async () => {
  const raw = emptyRaw()
  raw.leads = [{ id: 'L1', name: 'Ace Plumbing', owner_name: 'Rosa Diaz', email: 'rosa@ace.example', status: 'new', source: 'ai-fleet-scan', created_at: iso(AFTERNOON - D) }]
  const shop = fakeShop({ smsReady: false, emailReady: true, states: { lead_outreach: enabledState() } })
  const f = createFake({ shop, raw, optedOutEmails: ['rosa@ace.example'] })
  const out = await go(f, 'lead_outreach')
  assert.equal(out.drain.sent, 0)
  assert.equal(f.state.sent.length, 0)
  assert.equal(f.state.messages[0].skip_reason, 'email_opted_out')
})

function winBackShop() {
  const raw = emptyRaw()
  raw.customers = [customer('c1', 'Marcus Bell', '7135550101')]
  raw.documents = [paidInvoice('1', 'c1', iso(AFTERNOON - 200 * D))]
  return createFake({ shop: fakeShop({ states: { re_engagement: enabledState() } }), raw, start: AFTERNOON })
}

test('a win-back text is dropped if the customer came in after it was lined up', async () => {
  const f = winBackShop()
  const plan = await planAutomation(f.deps, { shopId: SHOP_ID, automationId: 're_engagement' })
  assert.equal(plan.summary.send, 1)
  await f.deps.store.insertMessages(messagesFromPlan(plan, null, false))
  f.state.raw.documents.push(paidInvoice('2', 'c1', iso(AFTERNOON + H)))
  const d = await drainShop(f.deps, SHOP_ID)
  assert.equal(d.cancelled, 1)
  assert.equal(f.state.sent.length, 0)
  assert.equal(f.state.messages[0].skip_reason, 'came_back')
  assert.equal(f.state.messages[0].status, 'cancelled')
})

test('a win-back text still goes when nobody came back, and when the visit cannot be checked', async () => {
  const quiet = winBackShop()
  await quiet.deps.store.insertMessages(messagesFromPlan(await planAutomation(quiet.deps, { shopId: SHOP_ID, automationId: 're_engagement' }), null, false))
  assert.equal((await drainShop(quiet.deps, SHOP_ID)).sent, 1)

  const unsure = winBackShop()
  await unsure.deps.store.insertMessages(messagesFromPlan(await planAutomation(unsure.deps, { shopId: SHOP_ID, automationId: 're_engagement' }), null, false))
  unsure.state.raw.documents.push(paidInvoice('2', 'c1', iso(AFTERNOON + H)))
  unsure.state.visitCheckFails = true
  assert.equal((await drainShop(unsure.deps, SHOP_ID)).sent, 1, 'a failed courtesy check never blocks a message; consent is the check that fails closed')
})

test('a review request is not cancelled by a newer invoice', async () => {
  const f = reviewShop()
  const plan = await planAutomation(f.deps, { shopId: SHOP_ID, automationId: 'review_requests' })
  await f.deps.store.insertMessages(messagesFromPlan(plan, null, false))
  f.state.raw.documents.push(paidInvoice('9', 'c1', iso(AFTERNOON + H)))
  assert.equal((await drainShop(f.deps, SHOP_ID)).sent, 1)
})
