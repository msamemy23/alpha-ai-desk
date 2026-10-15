import test from 'node:test'
import assert from 'node:assert/strict'
import { makeDb } from './voice-fake-db.mjs'
import { processInboundSms, resetProbeCache } from '../src/lib/voice/sms-pipeline.ts'
import { syncBooking } from '../src/lib/voice/actions.ts'

const NOW = new Date('2026-10-14T15:00:00Z')
const SHOP = { shop_id: 'shop-a', shop_name: 'Test Auto Care', shop_phone: '(713) 555-0100', telnyx_phone_number: '+17135550100', shop_email: 'owner@example.com', timezone: 'America/Chicago' }
const hours = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri'].map(d => [d, { open: true, from: '08:00', to: '17:00' }]).concat([['sat', { open: false, from: '09:00', to: '13:00' }], ['sun', { open: false, from: '09:00', to: '13:00' }]]))
const UNIQUE = { ai_interactions: [['shop_id', 'channel', 'ref_id']], ai_booking_requests: [['shop_id', 'interaction_id']], ai_thread_state: [['shop_id', 'channel', 'contact_key']] }

function setup(rules = {}) {
  resetProbeCache()
  const db = makeDb({ tables: { voice_rules: [{ shop_id: 'shop-a', rules: { hours, booking_mode: 'request', ...rules } }], customers: [], messages: [], sms_consents: [], ai_interactions: [], ai_booking_requests: [], ai_thread_state: [], appointments: [] }, unique: UNIQUE })
  const sent = []
  const deps = {
    db, now: () => NOW, model: null, appUrl: 'https://app.example.com',
    consent: { isOptedOut: async () => false, optOut: async () => {}, optIn: async () => {} },
    send: async (to, text) => { sent.push({ to, text }) }, email: async () => {},
  }
  return { db, deps, sent }
}
const say = (deps, body) => processInboundSms(deps, SHOP, { from: '+17135550142', body, messageId: `m-${Math.random()}` })

test('details that arrive after a booking request was saved are copied onto it', async () => {
  const { deps, db } = setup()
  for (const t of ['I need an appointment for my brakes', 'tomorrow morning', 'Maria Lopez', '2018 Honda Civic', 'the brakes grind when I stop']) await say(deps, t)
  const rows = db.table('ai_booking_requests')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].status, 'pending')
  assert.equal(rows[0].customer_name, 'Maria Lopez')
  assert.equal(rows[0].vehicle, '2018 Honda Civic')
  assert.match(rows[0].problem, /brakes/)
  assert.equal(rows[0].preferred_text, 'tomorrow morning')
  assert.equal(db.table('appointments').length, 0)
})

test('a booked appointment gets its blanks filled but is never overwritten', async () => {
  const db = makeDb({ tables: {
    ai_booking_requests: [{ id: 'b1', shop_id: 'shop-a', interaction_id: 'i1', status: 'booked', kind: 'booked', appointment_id: 'a1', customer_name: 'Maria', problem: 'brakes' }],
    appointments: [{ id: 'a1', shop_id: 'shop-a', status: 'Scheduled', customer_name: 'Maria', vehicle: '', service: 'Brake check done by a person', phone: '' }],
  } })
  await syncBooking(db, 'shop-a', { interactionId: 'i1', captured: { name: 'Maria Lopez', vehicle: '2018 Honda Civic', problem: 'grinding brakes', callback: '7135550142', preferred: '' }, phone: '' })
  const a = db.table('appointments')[0]
  assert.equal(a.vehicle, '2018 Honda Civic')
  assert.equal(a.phone, '7135550142')
  assert.equal(a.service, 'Brake check done by a person')
  assert.equal(a.customer_name, 'Maria')
  assert.equal(db.table('ai_booking_requests')[0].vehicle, '2018 Honda Civic')
})

test('a declined or cancelled request is left alone', async () => {
  const db = makeDb({ tables: { ai_booking_requests: [{ id: 'b1', shop_id: 'shop-a', interaction_id: 'i1', status: 'declined', kind: 'request', customer_name: '' }] } })
  await syncBooking(db, 'shop-a', { interactionId: 'i1', captured: { name: 'Maria', vehicle: '', problem: '', callback: '', preferred: '' }, phone: '' })
  assert.equal(db.table('ai_booking_requests')[0].customer_name, '')
})
