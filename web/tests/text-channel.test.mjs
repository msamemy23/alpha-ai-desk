import test from 'node:test'
import assert from 'node:assert/strict'
import { loadLib } from './estimates-helper.mjs'

const ch = loadLib('text-channel')

const TELNYX = { telnyx_api_key: 'KEY123', telnyx_phone_number: '+17135550100', telnyx_messaging_profile_id: 'prof-1' }
const TEXTBEE = { sms_channel: 'phone', phone_gateway: 'textbee', phone_gateway_key: 'tb-key', phone_gateway_device: 'dev-9', phone_gateway_number: '+17135550142' }
const HTTPSMS = { sms_channel: 'phone', phone_gateway: 'httpsms', phone_gateway_key: 'hs-key', phone_gateway_number: '+17135550142' }

test('a shop with no choice and a Telnyx key and number texts through Telnyx, exactly as before', () => {
  const c = ch.channelOf(TELNYX)
  assert.equal(c.kind, 'telnyx')
  assert.equal(c.from, '+17135550100')
  assert.equal(c.apiKey, 'KEY123')
  assert.equal(c.messagingProfileId, 'prof-1')
  assert.equal(ch.textReady(TELNYX), true)
  assert.equal(ch.fromNumberOf(TELNYX), '+17135550100')
  // The columns from migration 063 being empty or null changes nothing.
  assert.equal(ch.channelOf({ ...TELNYX, sms_channel: null, phone_gateway: null, phone_gateway_key: null }).kind, 'telnyx')
  assert.equal(ch.channelOf({ ...TELNYX, sms_channel: 'telnyx', phone_gateway: 'textbee', phone_gateway_key: 'x' }).kind, 'telnyx')
})

test('a shop with no way to text says so in plain words', () => {
  for (const row of [null, undefined, {}, { telnyx_api_key: 'KEY' }, { telnyx_phone_number: '+17135550100' }]) {
    const c = ch.channelOf(row)
    assert.equal(c.kind, 'none')
    assert.equal(c.why, 'not_set_up')
    assert.match(c.message, /not set up/)
    assert.equal(ch.textReady(row), false)
    assert.equal(ch.fromNumberOf(row), '')
  }
})

test('choosing the phone uses the phone, with that shop\'s own keys', () => {
  const t = ch.channelOf(TEXTBEE)
  assert.equal(t.kind, 'phone')
  assert.deepEqual({ ...t.gateway }, { provider: 'textbee', apiKey: 'tb-key', deviceId: 'dev-9', number: '+17135550142' })
  assert.equal(t.from, '+17135550142')
  const h = ch.channelOf(HTTPSMS)
  assert.equal(h.kind, 'phone')
  assert.equal(h.gateway.provider, 'httpsms')
  assert.equal(ch.fromNumberOf(HTTPSMS), '+17135550142')
  // The phone wins over Telnyx when both are filled in and the phone is chosen.
  assert.equal(ch.channelOf({ ...TELNYX, ...TEXTBEE }).kind, 'phone')
})

test('a half-finished phone setup never falls back to Telnyx and never sends', () => {
  const noKey = { ...TEXTBEE, phone_gateway_key: '' }
  const noNumber = { ...TEXTBEE, phone_gateway_number: '  ' }
  const noDevice = { ...TEXTBEE, phone_gateway_device: '' }
  const noService = { ...TEXTBEE, phone_gateway: '' }
  const badService = { ...TEXTBEE, phone_gateway: 'twilio' }
  for (const row of [noKey, noNumber, noDevice, noService, badService]) {
    const c = ch.channelOf({ ...TELNYX, ...row })
    assert.equal(c.kind, 'none', JSON.stringify(row))
    assert.equal(c.why, 'phone_incomplete')
    assert.match(c.message, /Finish it in Settings/)
    assert.throws(() => ch.smsOptionsFor({ ...TELNYX, ...row }), /Finish it in Settings/)
  }
  // httpSMS does not use a device id.
  assert.equal(ch.channelOf({ ...HTTPSMS, phone_gateway_device: '' }).kind, 'phone')
})

test('sms options: Telnyx keeps its key, profile, idempotency key and pictures; the phone carries its gateway and refuses pictures', () => {
  const t = ch.smsOptionsFor(TELNYX, { idempotencyKey: 'k1', mediaUrls: ['https://x/a.jpg'] })
  assert.deepEqual({ ...t, mediaUrls: [...t.mediaUrls] }, { apiKey: 'KEY123', messagingProfileId: 'prof-1', idempotencyKey: 'k1', mediaUrls: ['https://x/a.jpg'] })
  const plain = ch.smsOptionsFor(TELNYX, { idempotencyKey: 'k2' })
  assert.equal('mediaUrls' in plain, false)
  const p = ch.smsOptionsFor(TEXTBEE, { idempotencyKey: 'k3' })
  assert.equal(p.phone.provider, 'textbee')
  assert.equal(p.idempotencyKey, 'k3')
  assert.equal('apiKey' in p, false)
  assert.throws(() => ch.smsOptionsFor(TEXTBEE, { mediaUrls: ['https://x/a.jpg'] }), /Pictures cannot go through your own phone/)
  assert.equal(ch.canSendPictures(TELNYX), true)
  assert.equal(ch.canSendPictures(TEXTBEE), false)
})

test('promotions are kept off a personal phone, and one-to-one texts are not', () => {
  assert.equal(ch.allowsBulk(TELNYX), true)
  assert.equal(ch.allowsBulk(TEXTBEE), false)
  assert.equal(ch.allowsBulk(HTTPSMS), false)
  // A shop that is not set up has nothing to protect, and nothing can be sent anyway.
  assert.equal(ch.allowsBulk({}), true)
})

test('the number customers text is the phone when the shop uses its phone, the Telnyx number otherwise', () => {
  assert.equal(ch.shopNumberOf({ ...TELNYX, shop_phone: '(713) 555-0000' }), '+17135550100')
  assert.equal(ch.shopNumberOf({ ...TEXTBEE, shop_phone: '(713) 555-0000' }), '+17135550142')
  // Not set up: the old fallback to the shop's listed phone still holds, so the assistant's own-number check keeps working.
  assert.equal(ch.shopNumberOf({ shop_phone: '(713) 555-0000' }), '(713) 555-0000')
  assert.equal(ch.shopNumberOf({ telnyx_phone_number: '+17135550100' }), '+17135550100')
  assert.equal(ch.shopNumberOf(null), '')
})

test('the webhook code is long, random and different every time', () => {
  const a = ch.newGatewaySecret()
  const b = ch.newGatewaySecret()
  assert.match(a, /^[0-9a-f]{32}$/)
  assert.notEqual(a, b)
})

test('the six new columns are listed once, in one place', () => {
  assert.deepEqual([...ch.PHONE_COLUMNS], ['sms_channel', 'phone_gateway', 'phone_gateway_key', 'phone_gateway_device', 'phone_gateway_number', 'phone_gateway_secret'])
})
