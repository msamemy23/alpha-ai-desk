import test from 'node:test'
import assert from 'node:assert/strict'
import * as r from '../src/lib/automation-rules.ts'

const W = { quietStart: 21, quietEnd: 8, skipSundays: false }
const z = s => new Date(s)

test('quiet hours: sendable from 8am up to 9pm, shop clock', () => {
  assert.equal(r.isSendable(z('2026-10-14T20:00:00Z'), 'America/Chicago', W), true) // 3pm
  assert.equal(r.isSendable(z('2026-10-15T01:59:00Z'), 'America/Chicago', W), true) // 8:59pm
  assert.equal(r.isSendable(z('2026-10-15T02:00:00Z'), 'America/Chicago', W), false) // 9:00pm
  assert.equal(r.isSendable(z('2026-10-15T12:59:00Z'), 'America/Chicago', W), false) // 7:59am
  assert.equal(r.isSendable(z('2026-10-15T13:00:00Z'), 'America/Chicago', W), true) // 8:00am
})

test('quiet hours: next sendable moment is 8am the same or next morning', () => {
  assert.equal(r.nextSendable(z('2026-10-15T02:30:00Z'), 'America/Chicago', W).toISOString(), '2026-10-15T13:00:00.000Z')
  assert.equal(r.nextSendable(z('2026-10-15T09:00:00Z'), 'America/Chicago', W).toISOString(), '2026-10-15T13:00:00.000Z')
  const ok = z('2026-10-14T20:00:00Z')
  assert.equal(r.nextSendable(ok, 'America/Chicago', W).getTime(), ok.getTime())
})

test('quiet hours across daylight saving: 8am is 8am local on both sides of the change', () => {
  // Clocks go back Sunday 2026-11-01. Saturday 11pm CDT -> Sunday 8am CST (UTC-6).
  assert.equal(r.nextSendable(z('2026-11-01T04:00:00Z'), 'America/Chicago', W).toISOString(), '2026-11-01T14:00:00.000Z')
  // Clocks go forward Sunday 2026-03-08. Saturday 10pm CST -> Sunday 8am CDT (UTC-5).
  assert.equal(r.nextSendable(z('2026-03-08T04:00:00Z'), 'America/Chicago', W).toISOString(), '2026-03-08T13:00:00.000Z')
})

test('skip Sundays pushes a Saturday-night or Sunday message to Monday morning', () => {
  const w = { ...W, skipSundays: true }
  const sunday = z('2026-10-18T18:00:00Z') // Sunday 1pm in Houston
  assert.equal(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', weekday: 'long' }).format(sunday), 'Sunday')
  assert.equal(r.isSendable(sunday, 'America/Chicago', w), false)
  assert.equal(r.nextSendable(sunday, 'America/Chicago', w).toISOString(), '2026-10-19T13:00:00.000Z')
  const satNight = z('2026-10-18T03:00:00Z') // Saturday 10pm
  assert.equal(r.nextSendable(satNight, 'America/Chicago', w).toISOString(), '2026-10-19T13:00:00.000Z')
})

test('recipient-local: a Pacific number waits until it is 8am there even if the shop is already open', () => {
  const now = z('2026-10-14T14:30:00Z') // 9:30am Houston, 7:30am Los Angeles
  assert.equal(r.timezoneForPhone('(415) 555-1212'), 'America/Los_Angeles')
  assert.equal(r.earliestSend(now, 'America/Chicago', '(415) 555-1212', W).toISOString(), '2026-10-14T15:00:00.000Z')
  // A Houston number goes right away.
  assert.equal(r.earliestSend(now, 'America/Chicago', '(713) 555-0188', W).getTime(), now.getTime())
  // Unknown area code falls back to the shop clock.
  assert.equal(r.timezoneForPhone('000-000-0000'), null)
})

test('recipient-local: an Eastern number is cut off an hour earlier than Houston', () => {
  const now = z('2026-10-15T01:30:00Z') // 8:30pm Houston, 9:30pm New York
  assert.equal(r.timezoneForPhone('+1 212 555 0100'), 'America/New_York')
  assert.equal(r.earliestSend(now, 'America/Chicago', '2125550100', W).toISOString(), '2026-10-15T13:00:00.000Z')
})

test('area codes map the common zones', () => {
  assert.equal(r.timezoneForPhone('713-555-0100'), 'America/Chicago')
  assert.equal(r.timezoneForPhone('602-555-0100'), 'America/Phoenix')
  assert.equal(r.timezoneForPhone('303-555-0100'), 'America/Denver')
  assert.equal(r.timezoneForPhone('808-555-0100'), 'Pacific/Honolulu')
  assert.equal(r.timezoneForPhone('17135550100'), 'America/Chicago')
  assert.equal(r.timezoneForPhone(''), null)
})

test('shop rules: quiet hours can be longer than 9pm to 8am, never shorter', () => {
  const d = r.normalizeRules({})
  assert.deepEqual([d.quiet_start_hour, d.quiet_end_hour, d.master_enabled, d.marketing_cap_days], [21, 8, true, 7])
  assert.equal(r.normalizeRules({ quiet_start_hour: 19, quiet_end_hour: 10 }).quiet_start_hour, 19)
  assert.equal(r.normalizeRules({ quiet_start_hour: 19, quiet_end_hour: 10 }).quiet_end_hour, 10)
  assert.equal(r.normalizeRules({ quiet_start_hour: 23 }).quiet_start_hour, 21)
  assert.equal(r.normalizeRules({ quiet_end_hour: 5 }).quiet_end_hour, 8)
  assert.equal(r.normalizeRules({ master_enabled: false }).master_enabled, false)
  assert.equal(r.normalizeRules(null).quiet_start_hour, 21)
  assert.match(r.rulesProblem({ quiet_start_hour: 23 }) || '', /Quiet hours start/)
  assert.equal(r.rulesProblem({ quiet_start_hour: 20, marketing_cap_days: 14 }), null)
})

test('templates fill in placeholders and fall back to plain words', () => {
  const out = r.renderTemplate('Hi {name}, your {vehicle} is ready at {shop}. {contact}.', { name: 'Marcus', vehicle: '', shop: 'Bayou City Garage', contact: 'Call (713) 555-0188' })
  assert.equal(out.text, 'Hi Marcus, your vehicle is ready at Bayou City Garage. Call (713) 555-0188.')
  assert.deepEqual(out.missing, ['vehicle'])
  assert.equal(r.renderTemplate('Hello {name} .', {}).text, 'Hello there.')
  assert.equal(r.renderTemplate('Odd {thing}', {}).text, 'Odd {thing}')
})

test('template problems: unknown placeholder, emoji, empty, too long, missing required', () => {
  const ok = { klass: 'service', channel: 'sms' }
  assert.deepEqual(r.templateProblems('Hi {name}, see you soon at {shop}.', ok), [])
  assert.match(r.templateProblems('Hi {nme}', ok).join(' '), /\{nme\}/)
  assert.match(r.templateProblems('Great news \u{1F600}', ok).join(' '), /emoji/)
  assert.match(r.templateProblems('   ', ok).join(' '), /Write the message/)
  assert.match(r.templateProblems('x'.repeat(1200), ok).join(' '), /under 1,000/)
  assert.match(r.templateProblems('Hi', { ...ok, required: ['review_link'] }).join(' '), /\{review_link\}/)
  assert.equal(r.hasEmoji('Plain words only.'), false)
})

test('opt-out line is added once and only to marketing text by the decision step', () => {
  assert.equal(r.addOptOut('Hello.'), 'Hello. Reply STOP to opt out.')
  assert.equal(r.addOptOut('Hello. Text STOP to quit.'), 'Hello. Text STOP to quit.')
})

test('sms length: plain text is 160 characters a part, an accent drops it to 70', () => {
  assert.deepEqual(r.smsSegments('a'.repeat(160)), { chars: 160, parts: 1 })
  assert.equal(r.smsSegments('a'.repeat(161)).parts, 2)
  assert.equal(r.smsSegments('café ÿ'.padEnd(71, 'a')).parts, 2)
})

test('AI drafts may not invent money, discounts, guarantees or timing promises', () => {
  const found = r.unsupportedClaims('We will fix it for $99 today, 20% off, free inspection, guaranteed best price, same-day.')
  assert.ok(found.length >= 5, found.join('; '))
  assert.deepEqual(r.unsupportedClaims('Thank you for stopping in. We appreciate your business.'), [])
  assert.ok(r.unsupportedClaims('Stop in for a brake inspection with a certified technician.').some(x => /credential/.test(x)))
  assert.ok(r.unsupportedClaims('Family-owned with 20 years of experience.').some(x => /credential/.test(x)))
  assert.deepEqual(r.unsupportedClaims('Our certified techs are ready.', 'We have certified techs'), [])
  assert.deepEqual(r.unsupportedClaims('Oil changes are $49.99 this week.', 'Oil change special $49.99 this week'), [])
})

test('service due: by date, by miles, or both, with early notice', () => {
  const rule = { key: 'oil_change', label: 'oil change', pattern: 'oil', everyDays: 90, everyMiles: 3000 }
  const now = Date.parse('2026-10-14T18:00:00Z')
  const day = 86_400_000
  const base = { rule, now, leadDays: 7, leadMiles: 300 }
  assert.equal(r.serviceDue({ ...base, lastServiceAt: now - 80 * day, lastServiceMiles: 40000, currentMiles: 42500 }).due, false)
  const byDate = r.serviceDue({ ...base, lastServiceAt: now - 84 * day, lastServiceMiles: 40000, currentMiles: 41000 })
  assert.equal(byDate.due, true)
  assert.equal(byDate.basis, 'date')
  assert.match(byDate.reason, /84 days since the last oil change/)
  const byMiles = r.serviceDue({ ...base, lastServiceAt: now - 30 * day, lastServiceMiles: 40000, currentMiles: 42750 })
  assert.equal(byMiles.basis, 'mileage')
  assert.match(byMiles.reason, /2,750 miles/)
  const both = r.serviceDue({ ...base, lastServiceAt: now - 100 * day, lastServiceMiles: 40000, currentMiles: 43500 })
  assert.equal(both.basis, 'both')
  // Missing or backwards readings never count as miles.
  assert.equal(r.serviceDue({ ...base, lastServiceAt: now - 10 * day, lastServiceMiles: null, currentMiles: 90000 }).due, false)
  assert.equal(r.serviceDue({ ...base, lastServiceAt: now - 10 * day, lastServiceMiles: 50000, currentMiles: 40000 }).milesSince, null)
  assert.equal(r.parseMiles('42,500 mi'), 42500)
  assert.equal(r.parseMiles(''), null)
})

const rules = r.normalizeRules({})
const DAY = 86_400_000
const now = Date.parse('2026-10-14T18:00:00Z')
const cand = (over = {}) => ({
  automationId: 'sms_blast', klass: 'marketing', channel: 'sms', customerId: 'c1', name: 'Marcus Bell', phone: '7135550142', email: null,
  sourceType: 'customer', sourceId: 'c1', dedupeKey: 'k1', vars: { name: 'Marcus' }, why: 'test', ...over,
})

test('per-customer limits: marketing once a week, three a month, service twice a day', () => {
  const sent = (daysAgo, extra = {}) => ({ customerId: 'c1', phone: '7135550142', automationId: 'x', klass: 'marketing', at: now - daysAgo * DAY, ...extra })
  assert.equal(r.limitReason(cand(), [], rules, now), null)
  assert.equal(r.limitReason(cand(), [sent(3)], rules, now), 'frequency_cap')
  assert.equal(r.limitReason(cand(), [sent(8)], rules, now), null)
  assert.equal(r.limitReason(cand(), [sent(8), sent(15), sent(22)], rules, now), 'monthly_cap')
  // Matches by phone even when the customer id differs, and ignores other people.
  assert.equal(r.limitReason(cand({ customerId: 'c9' }), [sent(1)], rules, now), 'frequency_cap')
  assert.equal(r.limitReason(cand({ customerId: 'c9', phone: '7135559999' }), [sent(1)], rules, now), null)
  // A service text is not held back by marketing history, and reminders tied to a time are exempt.
  const service = cand({ klass: 'service', automationId: 'car_ready' })
  assert.equal(r.limitReason(service, [sent(0.1)], rules, now), null)
  const two = [sent(0.1, { klass: 'service' }), sent(0.2, { klass: 'service' })]
  assert.equal(r.limitReason(service, two, rules, now), 'daily_cap')
  assert.equal(r.limitReason({ ...service, exemptFromLimits: true }, two, rules, now), null)
  // The automation's own cap.
  assert.equal(r.limitReason(cand({ automationId: 'review_requests' }), [sent(20, { automationId: 'review_requests' })], { ...rules, marketing_cap_days: 1 }, now, 90), 'frequency_cap')
})

test('decide: skips come with a reason, duplicates and repeats are not sent twice', () => {
  const ctx = { now, shopTimeZone: 'America/Chicago', rules, template: 'Hi {name}.', recent: [], existingKeys: new Set(['seen']) }
  const out = r.decide([
    cand({ dedupeKey: 'a', customerId: 'a', phone: '7135550001' }),
    cand({ dedupeKey: 'b', customerId: 'b', phone: '' }),
    cand({ dedupeKey: 'c', customerId: 'c', phone: '7135550003', smsOptedOut: true }),
    cand({ dedupeKey: 'seen', customerId: 'd', phone: '7135550004' }),
    cand({ dedupeKey: 'e', customerId: 'e', phone: '(713) 555-0001' }),
    cand({ dedupeKey: 'f', customerId: 'f', phone: '7135550006', blockedBy: 'no_review_link' }),
  ], ctx)
  assert.deepEqual(out.map(d => d.action + ':' + (d.reason || '')), ['send:', 'skip:no_phone', 'skip:opted_out', 'skip:already_sent', 'skip:duplicate_number', 'skip:no_review_link'])
  assert.equal(out[0].text, 'Hi Marcus. Reply STOP to opt out.')
  const s = r.summarize(out)
  assert.equal(s.send, 1)
  assert.equal(s.skipped, 5)
  assert.equal(s.skippedBy.no_phone, 1)
  assert.match(r.skipWords('opted_out'), /STOP/)
})

test('decide: service text has no opt-out line, quiet hours hold the send, limit per run leaves the rest', () => {
  const night = Date.parse('2026-10-15T03:00:00Z') // 10pm in Houston
  const out = r.decide([
    cand({ klass: 'service', dedupeKey: 'a', customerId: 'a', phone: '7135550001' }),
    cand({ klass: 'service', dedupeKey: 'b', customerId: 'b', phone: '7135550002' }),
  ], { now: night, shopTimeZone: 'America/Chicago', rules, template: 'Your car is ready.', recent: [], existingKeys: new Set(), maxPerRun: 1 })
  assert.equal(out[0].text, 'Your car is ready.')
  assert.equal(out[0].heldForQuietHours, true)
  assert.equal(new Date(out[0].sendAfter).toISOString(), '2026-10-15T13:00:00.000Z')
  assert.equal(out[1].action, 'later')
  assert.equal(out[1].reason, 'run_limit')
})

test('decide: not yet due stays for later and a time in the future is respected', () => {
  const out = r.decide([cand({ eligibleAt: now + 3 * 3_600_000 })], { now, shopTimeZone: 'America/Chicago', rules, template: 'x', recent: [], existingKeys: new Set() })
  assert.equal(out[0].action, 'later')
  assert.equal(out[0].reason, 'not_ready')
})

test('failures: bad numbers never retry, setup problems need the owner, the rest retry on a schedule', () => {
  assert.equal(r.classifyFailure('The destination number is invalid'), 'permanent')
  assert.equal(r.classifyFailure('Number is a landline'), 'permanent')
  assert.equal(r.classifyFailure('Telnyx credentials not configured'), 'setup')
  assert.equal(r.classifyFailure('Messaging profile is not registered for 10DLC'), 'setup')
  assert.equal(r.classifyFailure('Telnyx returned 503'), 'transient')
  assert.equal(r.retryDelayMs(1), 5 * 60_000)
  assert.equal(r.retryDelayMs(2), 30 * 60_000)
  assert.equal(r.retryDelayMs(3), 2 * 3_600_000)
  assert.equal(r.retryDelayMs(9), 2 * 3_600_000)
  assert.match(r.failureAdvice('Telnyx credentials not configured'), /Settings/)
})

test('results: each reply, booking and payment goes to the latest message, once, and reminders earn no revenue', () => {
  const t0 = Date.parse('2026-10-01T15:00:00Z')
  const sent = [
    { id: 's1', customerId: 'c1', phone: '7135550001', automationId: 'review_requests', at: t0 },
    { id: 's2', customerId: 'c1', phone: '7135550001', automationId: 're_engagement', at: t0 + 2 * DAY },
    { id: 's3', customerId: 'c2', phone: '7135550002', automationId: 'review_requests', at: t0 },
    { id: 's4', customerId: 'c3', phone: '7135550003', automationId: 'sms_blast', at: t0 },
  ]
  const moneyFrom = new Set(['re_engagement', 'sms_blast'])
  const out = r.attribute(sent, {
    replies: [{ customerId: 'c1', at: t0 + 3 * DAY }, { customerId: 'c1', at: t0 + 4 * DAY }, { phone: '(713) 555-0002', at: t0 + DAY }],
    bookings: [{ customerId: 'c1', at: t0 + 4 * DAY }, { customerId: 'c2', at: t0 + 2 * DAY }],
    payments: [{ customerId: 'c1', at: t0 + 5 * DAY, amount: 200.5 }, { customerId: 'c2', at: t0 + 5 * DAY, amount: 90 }, { customerId: 'c3', at: t0 + 60 * DAY, amount: 500 }, { customerId: 'c3', at: t0 - DAY, amount: 70 }],
  }, { moneyFrom })
  assert.deepEqual(out.re_engagement, { sent: 1, delivered: 0, replied: 1, booked: 1, revenue: 200.5 })
  assert.deepEqual(out.review_requests, { sent: 2, delivered: 0, replied: 1, booked: 0, revenue: 0 })
  assert.deepEqual(out.sms_blast, { sent: 1, delivered: 0, replied: 0, booked: 0, revenue: 0 })
})

test('names, phones and email checks', () => {
  assert.equal(r.firstName('Priya Nair'), 'Priya')
  assert.equal(r.firstName(''), 'there')
  assert.equal(r.prettyPhone('+1 713 555 0188'), '(713) 555-0188')
  assert.equal(r.prettyPhone('555'), '555')
  assert.equal(r.looksLikeEmail('a@b.co'), true)
  assert.equal(r.looksLikeEmail('not an email'), false)
  assert.equal(r.hasUsablePhone('555-0100'), false)
})

test('results: a one-off promotion is counted on its own, and delivered texts are counted from the carrier notice', () => {
  const t0 = Date.parse('2026-10-01T15:00:00Z')
  const sent = [
    { id: 's1', customerId: 'c1', phone: '7135550001', automationId: 'sms_blast', group: 'campaign:p1', at: t0, delivered: true },
    { id: 's2', customerId: 'c2', phone: '7135550002', automationId: 'sms_blast', group: 'campaign:p1', at: t0, delivered: false },
    { id: 's3', customerId: 'c3', phone: '7135550003', automationId: 'sms_blast', at: t0, delivered: true },
  ]
  const out = r.attribute(sent, {
    replies: [{ customerId: 'c1', at: t0 + DAY }],
    bookings: [{ customerId: 'c1', at: t0 + 2 * DAY }, { customerId: 'c3', at: t0 + 2 * DAY }],
    payments: [{ customerId: 'c1', at: t0 + 3 * DAY, amount: 120 }, { customerId: 'c3', at: t0 + 3 * DAY, amount: 80 }],
  }, { moneyFrom: new Set(['sms_blast']) })
  assert.deepEqual(out['campaign:p1'], { sent: 2, delivered: 1, replied: 1, booked: 1, revenue: 120 })
  assert.deepEqual(out.sms_blast, { sent: 1, delivered: 1, replied: 0, booked: 1, revenue: 80 })
})
