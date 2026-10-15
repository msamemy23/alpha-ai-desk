import test from 'node:test'
import assert from 'node:assert/strict'
import { makeDb } from './voice-fake-db.mjs'
import { processInboundSms, resetProbeCache, composeSms } from '../src/lib/voice/sms-pipeline.ts'
import { normalizeRules } from '../src/lib/voice/rules.ts'
import { shopFromSettings } from '../src/lib/voice/prompt.ts'

const NOW = new Date('2026-10-14T15:00:00Z') // Wednesday 10:00 in Chicago
const SHOP = { shop_id: 'shop-a', shop_name: 'Test Auto Care', shop_phone: '(713) 555-0100', telnyx_phone_number: '+17135550100', shop_email: 'owner@example.com', timezone: 'America/Chicago' }
const hours = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri'].map(d => [d, { open: true, from: '08:00', to: '17:00' }]).concat([['sat', { open: false, from: '09:00', to: '13:00' }], ['sun', { open: false, from: '09:00', to: '13:00' }]]))
const UNIQUE = { ai_interactions: [['shop_id', 'channel', 'ref_id']], ai_booking_requests: [['shop_id', 'interaction_id']], ai_thread_state: [['shop_id', 'channel', 'contact_key']] }

function setup({ rules = {}, tables = {}, missing = [], now = NOW, model = null, failSend = false } = {}) {
  resetProbeCache()
  const db = makeDb({
    tables: { voice_rules: rules === null ? [] : [{ shop_id: 'shop-a', rules: { hours, ...rules } }], customers: [], messages: [], sms_consents: [], ...tables },
    missing, unique: UNIQUE,
  })
  const sent = []
  const emails = []
  const consent = {
    async isOptedOut(shopId, phone) { const d = String(phone).replace(/\D/g, '').slice(-10); return db.table('sms_consents').some(r => r.shop_id === shopId && r.phone_digits === d && r.opted_out) },
    async optOut(shopId, phone) { db.table('sms_consents').push({ shop_id: shopId, phone_digits: String(phone).replace(/\D/g, '').slice(-10), opted_out: true }) },
    async optIn(shopId, phone) { const d = String(phone).replace(/\D/g, '').slice(-10); db.data.sms_consents = db.table('sms_consents').filter(r => !(r.shop_id === shopId && r.phone_digits === d)) },
  }
  const deps = {
    db, now: () => now, model, appUrl: 'https://app.example.com', consent,
    send: async (to, text, o) => { if (failSend) throw new Error('carrier said no'); sent.push({ to, text, key: o.idempotencyKey }) },
    email: async m => { emails.push(m) },
  }
  return { db, deps, sent, emails }
}

const text = (body, over = {}) => ({ from: '+17135550142', body, messageId: `m-${Math.random()}`, ...over })

test('own number and repeated deliveries are ignored', async () => {
  const { deps, sent } = setup()
  assert.equal((await processInboundSms(deps, SHOP, text('hi', { from: '+17135550100' }))).reason, 'own_number')
  const first = text('my brakes are grinding')
  assert.equal((await processInboundSms(deps, SHOP, first)).action, 'sent')
  assert.equal((await processInboundSms(deps, SHOP, first)).reason, 'duplicate')
  assert.equal(sent.length, 1)
})

test('first reply says it is an AI and how to stop; later replies do not repeat it', async () => {
  const { deps, sent } = setup()
  await processInboundSms(deps, SHOP, text('my brakes are grinding when I stop'))
  assert.equal(sent.length, 1)
  assert.match(sent[0].text, /virtual assistant for Test Auto Care/)
  assert.match(sent[0].text, /AI/)
  assert.match(sent[0].text, /Reply STOP to stop texts\.$/)
  assert.doesNotMatch(sent[0].text, /\$/)
  await processInboundSms(deps, SHOP, text('John Smith'))
  assert.equal(sent.length, 2)
  assert.doesNotMatch(sent[1].text, /virtual assistant|STOP/)
  const outbound = deps.db.table('messages').filter(m => m.direction === 'outbound')
  assert.equal(outbound.length, 2)
  assert.ok(outbound.every(m => m.ai_handled === true && m.read === true))
})

test('STOP is recorded on the server and gets no AI reply', async () => {
  const { deps, sent, db } = setup()
  const r = await processInboundSms(deps, SHOP, text('STOP'))
  assert.equal(r.action, 'opt_out')
  assert.equal(db.table('sms_consents').length, 1)
  assert.equal(sent.length, 1)
  assert.match(sent[0].text, /unsubscribed/)
  const after = await processInboundSms(deps, SHOP, text('my brakes are grinding'))
  assert.equal(after.action, 'opted_out')
  assert.equal(sent.length, 1)
})

test('when Telnyx already answered STOP we do not answer again', async () => {
  const { deps, sent } = setup()
  await processInboundSms(deps, SHOP, text('STOP', { autoResponded: true }))
  assert.equal(sent.length, 0)
})

test('START turns texts back on, HELP is answered with the shop\'s details', async () => {
  const { deps, sent, db } = setup()
  await processInboundSms(deps, SHOP, text('STOP', { autoResponded: true }))
  const s = await processInboundSms(deps, SHOP, text('START'))
  assert.equal(s.action, 'opt_in')
  assert.equal(db.table('sms_consents').length, 0)
  assert.match(sent[0].text, /back on the list/)
  const h = await processInboundSms(deps, SHOP, text('help'))
  assert.equal(h.action, 'help')
  assert.match(sent[1].text, /Test Auto Care/)
  assert.match(sent[1].text, /STOP/)
  assert.match(sent[1].text, /\(713\) 555-0100/)
})

test('a customer marked opted out, or unreadable consent, never gets an AI text', async () => {
  const flagged = setup({ tables: { customers: [{ id: 'c1', shop_id: 'shop-a', name: 'Pat', phone: '(713) 555-0142', sms_opted_out: true }] } })
  assert.equal((await processInboundSms(flagged.deps, SHOP, text('my brakes squeal'))).action, 'opted_out')
  assert.equal(flagged.sent.length, 0)
  const broken = setup()
  broken.deps.consent.isOptedOut = async () => { throw new Error('db down') }
  assert.equal((await processInboundSms(broken.deps, SHOP, text('my brakes squeal'))).reason, 'consent_unreadable')
  assert.equal(broken.sent.length, 0)
})

test('opt-out is checked again at send time', async () => {
  const { deps, sent } = setup()
  let calls = 0
  const original = deps.consent.isOptedOut
  deps.consent.isOptedOut = async (...a) => { calls += 1; return calls >= 2 ? true : original(...a) }
  const r = await processInboundSms(deps, SHOP, text('my brakes are grinding'))
  assert.equal(sent.length, 0)
  assert.equal(r.action, 'skipped')
})

test('the master switch turns text replies off', async () => {
  const { deps, sent } = setup({ rules: { texts_mode: 'off' } })
  const r = await processInboundSms(deps, SHOP, text('my brakes are grinding'))
  assert.equal(r.reason, 'texts_off')
  assert.equal(sent.length, 0)
  assert.equal(deps.db.table('messages').filter(m => m.direction === 'inbound').length, 1)
})

test('draft mode writes a draft for a person and sends nothing', async () => {
  const { deps, sent, db } = setup({ rules: { texts_mode: 'draft' } })
  const r = await processInboundSms(deps, SHOP, text('my brakes are grinding'))
  assert.equal(r.action, 'draft')
  assert.equal(sent.length, 0)
  const row = db.table('ai_interactions')[0]
  assert.match(row.detail.draft.text, /virtual assistant/)
  assert.equal(db.table('messages').filter(m => m.direction === 'outbound').length, 0)
})

test('draft mode without the new tables sends nothing at all', async () => {
  const { deps, sent } = setup({ rules: { texts_mode: 'draft' }, missing: ['ai_interactions', 'ai_booking_requests', 'ai_thread_state'] })
  await processInboundSms(deps, SHOP, text('my brakes are grinding'))
  assert.equal(sent.length, 0)
})

test('texts from other businesses and auto-replies are never answered', async () => {
  const { deps, sent } = setup()
  assert.equal((await processInboundSms(deps, SHOP, text('hello', { from: '55555' }))).reason, 'automated_sender')
  assert.equal((await processInboundSms(deps, SHOP, text('This is an automated message. Do not reply.'))).reason, 'automated_text')
  assert.equal((await processInboundSms(deps, SHOP, text('Thank you for contacting us. We will respond as soon as possible.'))).action, 'skipped')
  assert.equal(sent.length, 0)
})

test('the assistant does not answer its own words coming back', async () => {
  const { deps, sent } = setup()
  await processInboundSms(deps, SHOP, text('my brakes are grinding'))
  const aiText = sent[0].text
  const r = await processInboundSms(deps, SHOP, text(aiText))
  assert.equal(r.action, 'skipped')
  assert.equal(sent.length, 1)
})

test('when a person texts the customer, the assistant stays quiet', async () => {
  const { deps, sent } = setup({ tables: { messages: [{ shop_id: 'shop-a', direction: 'outbound', channel: 'sms', from_address: '+17135550100', to_address: '(713) 555-0142', body: 'Hi, it is Sam. Come on in.', ai_handled: false, created_at: '2026-10-14T13:00:00Z' }] } })
  const r = await processInboundSms(deps, SHOP, text('ok I will be there at 3'))
  assert.equal(r.reason, 'human_took_over')
  assert.equal(sent.length, 0)
  const longAgo = setup({ tables: { messages: [{ shop_id: 'shop-a', direction: 'outbound', channel: 'sms', from_address: '+17135550100', to_address: '(713) 555-0142', body: 'old', ai_handled: false, created_at: '2026-10-10T13:00:00Z' }] } })
  assert.equal((await processInboundSms(longAgo.deps, SHOP, text('my brakes are grinding'))).action, 'sent')
  const draft = setup({ rules: { texts_mode: 'draft' }, tables: { messages: [{ shop_id: 'shop-a', direction: 'outbound', channel: 'sms', from_address: '+17135550100', to_address: '(713) 555-0142', body: 'Hi', ai_handled: false, created_at: '2026-10-14T13:00:00Z' }] } })
  assert.equal((await processInboundSms(draft.deps, SHOP, text('my brakes are grinding'))).action, 'draft')
})

test('a manual pause on the thread is respected until it ends', async () => {
  const future = setup({ tables: { ai_thread_state: [{ shop_id: 'shop-a', channel: 'sms', contact_key: '7135550142', paused_until: '2026-10-14T20:00:00Z', pause_reason: 'manual' }] } })
  assert.equal((await processInboundSms(future.deps, SHOP, text('my brakes are grinding'))).reason, 'paused')
  const past = setup({ tables: { ai_thread_state: [{ shop_id: 'shop-a', channel: 'sms', contact_key: '7135550142', paused_until: '2026-10-14T10:00:00Z', pause_reason: 'manual' }] } })
  assert.equal((await processInboundSms(past.deps, SHOP, text('my brakes are grinding'))).action, 'sent')
})

test('per-number rate limit: after the limit nothing is sent and a person is asked', async () => {
  const msgs = Array.from({ length: 3 }, (_, i) => ({ shop_id: 'shop-a', direction: 'outbound', channel: 'sms', from_address: '+17135550100', to_address: '+17135550142', body: `reply ${i}`, ai_handled: true, created_at: `2026-10-14T1${i}:00:00Z` }))
  const { deps, sent, emails, db } = setup({ rules: { max_replies: { count: 3, window_hours: 24 } }, tables: { messages: msgs } })
  const r = await processInboundSms(deps, SHOP, text('and another thing about my truck'))
  assert.equal(r.action, 'flagged')
  assert.equal(r.reason, 'rate_limit')
  assert.equal(sent.length, 0)
  assert.equal(emails.length, 1)
  assert.equal(db.table('ai_interactions')[0].needs_person, true)
})

test('quiet hours: no automatic text goes out', async () => {
  const night = new Date('2026-10-15T03:30:00Z') // 10:30pm Chicago
  const { deps, sent, db } = setup({ now: night })
  const r = await processInboundSms(deps, SHOP, text('my brakes are grinding'))
  assert.equal(r.reason, 'quiet_hours')
  assert.equal(sent.length, 0)
  assert.ok(db.table('ai_interactions')[0].rules_fired.includes('quiet_hours'))
  const off = setup({ now: night, rules: { quiet_hours: { enabled: false, from: '21:00', to: '08:00' } } })
  assert.equal((await processInboundSms(off.deps, SHOP, text('my brakes are grinding'))).action, 'sent')
})

test('an upset customer gets one careful message, the team is emailed once, and the thread goes quiet', async () => {
  const { deps, sent, emails, db } = setup()
  const r = await processInboundSms(deps, SHOP, text('this is unacceptable, I want my money back'))
  assert.equal(r.action, 'flagged')
  assert.equal(sent.length, 1)
  assert.match(sent[0].text, /person/)
  assert.doesNotMatch(sent[0].text, /\$/)
  assert.equal(emails.length, 1)
  assert.equal(emails[0].to, 'owner@example.com')
  assert.match(emails[0].subject, /Needs a person/)
  const row = db.table('ai_interactions')[0]
  assert.equal(row.needs_person, true)
  assert.equal(row.outcome, 'needs_person')
  assert.equal(db.table('ai_thread_state')[0].needs_person, true)
  const again = await processInboundSms(deps, SHOP, text('hello?? anyone there'))
  assert.equal(again.reason, 'needs_person_pending')
  assert.equal(sent.length, 1)
  assert.equal(emails.length, 1)
})

test('without the new tables an upset customer still gets one message and then silence', async () => {
  const { deps, sent } = setup({ missing: ['voice_rules', 'ai_interactions', 'ai_booking_requests', 'ai_thread_state'] })
  const r = await processInboundSms(deps, SHOP, text('this is unacceptable, I want my money back'))
  assert.equal(r.action, 'flagged')
  assert.equal(sent.length, 1)
  const again = await processInboundSms(deps, SHOP, text('hello?? anyone there'))
  assert.equal(again.action, 'silent')
  assert.equal(sent.length, 1)
})

test('without the new tables a normal conversation still collects details across texts', async () => {
  const { deps, sent } = setup({ missing: ['voice_rules', 'ai_interactions', 'ai_booking_requests', 'ai_thread_state'] })
  await processInboundSms(deps, SHOP, text('my brakes are grinding when I stop'))
  await processInboundSms(deps, SHOP, text('John Smith'))
  assert.match(sent[0].text, /name/i)
  assert.match(sent[1].text, /year, make and model/i)
})

test('the standard rules apply to a shop that has saved nothing', async () => {
  const { deps, sent } = setup({ rules: null })
  const r = await processInboundSms(deps, SHOP, text('how much for an oil change'))
  assert.equal(r.action, 'sent')
  assert.doesNotMatch(sent[0].text, /\$\d/)
  assert.match(sent[0].text, /quote/)
})

test('each shop gets its own rules and its own name', async () => {
  const { deps, sent } = setup({ rules: { assistant_name: 'Sam' } })
  deps.db.table('voice_rules').push({ shop_id: 'shop-b', rules: { texts_mode: 'off' } })
  await processInboundSms(deps, SHOP, text('my brakes are grinding'))
  assert.match(sent[0].text, /Sam, the AI assistant for Test Auto Care/)
  const other = { shop_id: 'shop-b', shop_name: 'Second Garage', telnyx_phone_number: '+17135550200' }
  const r = await processInboundSms(deps, other, text('my brakes are grinding', { from: '+17135550199' }))
  assert.equal(r.reason, 'texts_off')
  assert.equal(sent.length, 1)
})

test('a failed send leaves no phantom reply behind and does not crash', async () => {
  const { deps, db } = setup({ failSend: true })
  const r = await processInboundSms(deps, SHOP, text('my brakes are grinding'))
  assert.equal(r.action, 'skipped')
  assert.equal(db.table('messages').filter(m => m.direction === 'outbound').length, 0)
})

test('an appointment request in a text is saved for approval, once', async () => {
  const { deps, sent, db } = setup({ rules: { booking_mode: 'request' } })
  await processInboundSms(deps, SHOP, text('can I bring my car in tomorrow morning for an oil change'))
  assert.equal(db.table('ai_booking_requests').length, 1)
  const b = db.table('ai_booking_requests')[0]
  assert.equal(b.kind, 'request')
  assert.equal(b.status, 'pending')
  assert.match(b.preferred_text, /tomorrow morning/)
  assert.doesNotMatch(sent[0].text, /booked|confirmed/i)
  assert.equal(db.table('appointments').length, 0)
})

test('book mode puts the picked time on the schedule after re-checking it', async () => {
  const { deps, sent, db } = setup({ rules: { booking_mode: 'book' }, tables: { appointments: [] } })
  await processInboundSms(deps, SHOP, text('I want to schedule an oil change'))
  assert.match(sent[0].text, /name first/)
  await processInboundSms(deps, SHOP, text('Pat Jones'))
  assert.match(sent[1].text, /open times/)
  await processInboundSms(deps, SHOP, text('2'))
  assert.match(sent[2].text, /You're booked for/)
  assert.equal(db.table('appointments').length, 1)
  const appt = db.table('appointments')[0]
  assert.equal(appt.status, 'Scheduled')
  assert.equal(appt.shop_id, 'shop-a')
  assert.equal(appt.customer_name, 'Pat Jones')
  assert.equal(db.table('ai_booking_requests')[0].status, 'booked')
})

test('booking is switched off when the booking table is missing', async () => {
  const { deps, db } = setup({ rules: { booking_mode: 'book' }, missing: ['ai_booking_requests', 'ai_interactions'] })
  await processInboundSms(deps, SHOP, text('can I bring my car in tomorrow morning for an oil change'))
  assert.equal(db.table('appointments').length, 0)
})

test('the email alert for new texts goes out only when asked and the assistant did not answer', async () => {
  const on = setup({ rules: { texts_mode: 'off', email_new_texts: true } })
  await processInboundSms(on.deps, SHOP, text('my brakes are grinding'))
  assert.equal(on.emails.length, 1)
  assert.match(on.emails[0].subject, /New text/)
  await processInboundSms(on.deps, SHOP, text('are you there'))
  assert.equal(on.emails.length, 1, 'one alert per conversation burst')
  const off = setup({ rules: { texts_mode: 'off' } })
  await processInboundSms(off.deps, SHOP, text('my brakes are grinding'))
  assert.equal(off.emails.length, 0)
})

test('composeSms adds the notice only the first time', () => {
  const rules = normalizeRules({})
  const shop = shopFromSettings(SHOP)
  const first = composeSms('What year, make and model is the vehicle?', rules, shop, false)
  assert.match(first.text, /AI/)
  assert.match(first.text, /STOP/)
  assert.deepEqual(first.fired, ['first_reply', 'ai_disclosure'])
  assert.equal(composeSms('Thanks.', rules, shop, true).text, 'Thanks.')
  assert.equal(composeSms('', rules, shop, false).text, '')
  const honest = composeSms("Yes, I'm an AI assistant for Test Auto Care, not a person.", rules, shop, false)
  assert.doesNotMatch(honest.text, /virtual assistant for/)
})
