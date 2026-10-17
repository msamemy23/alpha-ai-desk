import test from 'node:test'
import assert from 'node:assert/strict'
import { makeDb } from './voice-fake-db.mjs'
import { processInboundSms, resetProbeCache } from '../src/lib/voice/sms-pipeline.ts'

const NOW = new Date('2026-10-14T15:00:00Z') // Wednesday 10:00 in Chicago
// A shop that texts through its own Android phone: no Telnyx number at all, only the phone's number.
const PHONE_SHOP = { shop_id: 'shop-p', shop_name: 'Phone Auto Care', shop_phone: '', telnyx_phone_number: '', sms_channel: 'phone', phone_gateway: 'httpsms', phone_gateway_key: 'k', phone_gateway_number: '+17135550142', shop_email: 'owner@example.com', timezone: 'America/Chicago' }
const hours = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri'].map(d => [d, { open: true, from: '08:00', to: '17:00' }]).concat([['sat', { open: false, from: '09:00', to: '13:00' }], ['sun', { open: false, from: '09:00', to: '13:00' }]]))
const UNIQUE = { ai_interactions: [['shop_id', 'channel', 'ref_id']], ai_booking_requests: [['shop_id', 'interaction_id']], ai_thread_state: [['shop_id', 'channel', 'contact_key']] }

function setup() {
  resetProbeCache()
  const db = makeDb({ tables: { voice_rules: [{ shop_id: 'shop-p', rules: { hours } }], customers: [], messages: [], sms_consents: [] }, missing: [], unique: UNIQUE })
  const sent = []
  const consent = {
    async isOptedOut(shopId, phone) { const d = String(phone).replace(/\D/g, '').slice(-10); return db.table('sms_consents').some(r => r.shop_id === shopId && r.phone_digits === d && r.opted_out) },
    async optOut(shopId, phone) { db.table('sms_consents').push({ shop_id: shopId, phone_digits: String(phone).replace(/\D/g, '').slice(-10), opted_out: true }) },
    async optIn() {},
  }
  const deps = { db, now: () => NOW, model: null, appUrl: 'https://app.example.com', consent, send: async (to, text, o) => { sent.push({ to, text, key: o.idempotencyKey }) }, email: async () => {} }
  return { db, deps, sent }
}
const text = (body, over = {}) => ({ from: '+17135550199', body, messageId: `m-${Math.random()}`, ...over })

test('a text that arrives on the owner\'s phone is saved to the Inbox and answered, even with no Telnyx number', async () => {
  const { db, deps, sent } = setup()
  const r = await processInboundSms(deps, PHONE_SHOP, text('my brakes are grinding when I stop'))
  assert.notEqual(r.reason, 'no_shop_number')
  assert.equal(r.action, 'sent')
  assert.equal(sent.length, 1)
  assert.equal(sent[0].to, '+17135550199')
  const inbound = db.table('messages').find(m => m.direction === 'inbound')
  assert.equal(inbound.to_address, '+17135550142')
  const outbound = db.table('messages').find(m => m.direction === 'outbound')
  assert.equal(outbound.from_address, '+17135550142')
})

test('the owner\'s own phone texting itself is ignored, not answered', async () => {
  const { deps, sent } = setup()
  const r = await processInboundSms(deps, PHONE_SHOP, text('hi', { from: '+17135550142' }))
  assert.equal(r.reason, 'own_number')
  assert.equal(sent.length, 0)
})

test('STOP through the phone is recorded and answered once, and later texts get no assistant reply', async () => {
  const { db, deps, sent } = setup()
  assert.equal((await processInboundSms(deps, PHONE_SHOP, text('STOP'))).action, 'opt_out')
  assert.equal(db.table('sms_consents').length, 1)
  assert.equal(sent.length, 1)
  assert.match(sent[0].text, /unsubscribed/)
  assert.equal((await processInboundSms(deps, PHONE_SHOP, text('my brakes are grinding'))).action, 'opted_out')
  assert.equal(sent.length, 1)
})

test('a shop with no way at all to be texted is still ignored, as before', async () => {
  const { deps, sent } = setup()
  const r = await processInboundSms(deps, { shop_id: 'shop-p', shop_name: 'X', timezone: 'America/Chicago' }, text('hello'))
  assert.equal(r.reason, 'no_shop_number')
  assert.equal(sent.length, 0)
})
