import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeInbound, isArrivingText, isOptOut } from '../src/lib/sms-normalize.ts'

// The shapes below are what each service sends to a webhook for a text that arrived on the phone.
const TEXTBEE_RECEIVED = { smsId: 'sms-1', sender: '+17135550199', message: 'Is my car ready?', receivedAt: '2026-10-16T10:00:00Z', deviceId: 'dev-9', webhookSubscriptionId: 'w1', webhookEvent: 'MESSAGE_RECEIVED' }
const HTTPSMS_RECEIVED = { specversion: '1.0', id: 'evt-1', type: 'message.phone.received', source: '/v1/messages/receive', data: { message_id: 'm-1', content: 'Is my car ready?', owner: '+17135550142', contact: '+17135550199', timestamp: '2026-10-16T10:00:00Z', sim: 'SIM1' } }

test('TextBee: who sent it, what it said, and its id', () => {
  const n = normalizeInbound(TEXTBEE_RECEIVED)
  assert.equal(n.from, '+17135550199')
  assert.equal(n.text, 'Is my car ready?')
  assert.equal(n.messageId, 'sms-1')
  assert.equal(isArrivingText(TEXTBEE_RECEIVED), true)
})

test('httpSMS: the customer is the contact, the shop\'s phone is the owner, and the id is the message id', () => {
  const n = normalizeInbound(HTTPSMS_RECEIVED)
  assert.equal(n.from, '+17135550199')
  assert.equal(n.text, 'Is my car ready?')
  assert.equal(n.toNumber, '+17135550142')
  assert.equal(n.messageId, 'm-1')
  assert.equal(isArrivingText(HTTPSMS_RECEIVED), true)
})

test('sent, delivered and failed notices from the phone are not customer texts', () => {
  for (const event of ['MESSAGE_SENT', 'MESSAGE_DELIVERED', 'MESSAGE_FAILED']) assert.equal(isArrivingText({ ...TEXTBEE_RECEIVED, webhookEvent: event }), false, event)
  for (const type of ['message.phone.sent', 'message.phone.delivered', 'message.send.failed', 'phone.heartbeat.online']) assert.equal(isArrivingText({ ...HTTPSMS_RECEIVED, type }), false, type)
})

test('a plain gateway that names no event is treated as an arriving text', () => {
  assert.equal(isArrivingText({ from: '+17135550199', message: 'hi' }), true)
  assert.equal(isArrivingText({}), true)
})

test('STOP words still read as opt-outs when they come through a gateway', () => {
  assert.equal(isOptOut(normalizeInbound({ ...TEXTBEE_RECEIVED, message: ' stop. ' }).text), true)
  assert.equal(isOptOut(normalizeInbound(HTTPSMS_RECEIVED).text), false)
})
