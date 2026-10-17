import test from 'node:test'
import assert from 'node:assert/strict'
import { phoneUpdates, touchesPhone, gatewayNumber } from '../src/lib/phone-settings.ts'
import { inboundAccess, looksLikeShopId } from '../src/lib/phone-inbound.ts'

const SHOP = '0f3b6c1e-6a52-4c0e-9d1a-1c9b6f8a2e11'
const DONE = { sms_channel: 'telnyx', phone_gateway: 'textbee', phone_gateway_key: 'k', phone_gateway_device: 'd', phone_gateway_number: '+17135550142', phone_gateway_secret: 'abc123' }

test('a save that is not about the phone never touches the phone columns', () => {
  assert.equal(touchesPhone({ shop_name: 'A', telnyx_api_key: 'x' }), false)
  assert.equal(touchesPhone({ sms_channel: 'phone' }), true)
  assert.equal(touchesPhone({ phone_gateway_key: '' }), true)
  assert.equal(touchesPhone({ rotate_phone_secret: true }), true)
  assert.equal(touchesPhone({ rotate_phone_secret: false }), false)
})

test('numbers are tidied to full international form, and anything else is refused', () => {
  assert.equal(gatewayNumber('(713) 555-0142'), '+17135550142')
  assert.equal(gatewayNumber('1 713 555 0142'), '+17135550142')
  assert.equal(gatewayNumber('+44 20 7946 0958'), '+442079460958')
  assert.equal(gatewayNumber('555-0142'), '')
  assert.equal(gatewayNumber('call me'), '')
  assert.equal(phoneUpdates({ phone_gateway_number: '555' }, {}).ok, false)
  assert.equal(phoneUpdates({ phone_gateway_number: '713-555-0142' }, {}).updates.phone_gateway_number, '+17135550142')
  assert.equal(phoneUpdates({ phone_gateway_number: '  ' }, DONE).updates.phone_gateway_number, null)
})

test('only the two known services and the two known choices are accepted', () => {
  assert.equal(phoneUpdates({ phone_gateway: 'twilio' }, {}).ok, false)
  assert.match(phoneUpdates({ phone_gateway: 'twilio' }, {}).error, /TextBee or httpSMS/)
  assert.equal(phoneUpdates({ sms_channel: 'whatsapp' }, {}).ok, false)
  assert.equal(phoneUpdates({ sms_channel: '' }, {}).updates.sms_channel, null)
  assert.equal(phoneUpdates({ phone_gateway: 'httpsms' }, {}).updates.phone_gateway, 'httpsms')
})

test('the phone cannot be switched on until every detail is there', () => {
  const half = phoneUpdates({ sms_channel: 'phone', phone_gateway: 'textbee', phone_gateway_number: '7135550142' }, {})
  assert.equal(half.ok, false)
  assert.match(half.error, /Finish the phone details first/)
  assert.match(half.error, /TextBee device ID/)
  const httpOnly = phoneUpdates({ sms_channel: 'phone', phone_gateway: 'httpsms', phone_gateway_number: '7135550142' }, {})
  assert.equal(httpOnly.ok, false)
  assert.doesNotMatch(httpOnly.error, /device/)
  // Everything on file already: switching on is one field.
  assert.equal(phoneUpdates({ sms_channel: 'phone' }, DONE).ok, true)
  // Details arriving in the same save as the switch count.
  assert.equal(phoneUpdates({ sms_channel: 'phone', phone_gateway: 'httpsms', phone_gateway_key: 'new', phone_gateway_number: '7135550142' }, {}).ok, true)
  // A blank key box keeps the saved key, so it does not block switching on.
  assert.equal(phoneUpdates({ sms_channel: 'phone', phone_gateway_key: '' }, DONE).ok, true)
  // Removing a needed detail while the phone is on is refused rather than leaving the shop unable to text.
  assert.equal(phoneUpdates({ phone_gateway_number: '' }, { ...DONE, sms_channel: 'phone' }).ok, false)
  assert.equal(phoneUpdates({ phone_gateway_key: '__CLEAR__' }, { ...DONE, sms_channel: 'phone' }).ok, false)
  // Switching back to Telnyx never needs anything.
  assert.equal(phoneUpdates({ sms_channel: 'telnyx' }, {}).ok, true)
})

test('a blank key box keeps the saved key; only the explicit word clears it', () => {
  assert.equal('phone_gateway_key' in phoneUpdates({ phone_gateway_key: '' }, DONE).updates, false)
  assert.equal('phone_gateway_key' in phoneUpdates({ phone_gateway_key: '   ' }, DONE).updates, false)
  assert.equal(phoneUpdates({ phone_gateway_key: '__CLEAR__' }, DONE).updates.phone_gateway_key, null)
  assert.equal(phoneUpdates({ phone_gateway_key: ' newkey ' }, DONE).updates.phone_gateway_key, 'newkey')
})

test('the address code is made once the service is chosen, kept after that, and replaced only on request', () => {
  const first = phoneUpdates({ phone_gateway: 'textbee' }, {})
  assert.match(first.updates.phone_gateway_secret, /^[0-9a-f]{32}$/)
  assert.equal(first.rotatedSecret, '')
  // Already has one: a normal save keeps it.
  assert.equal('phone_gateway_secret' in phoneUpdates({ phone_gateway: 'textbee' }, DONE).updates, false)
  const again = phoneUpdates({ rotate_phone_secret: true }, DONE)
  assert.equal(again.ok, true)
  assert.match(again.rotatedSecret, /^[0-9a-f]{32}$/)
  assert.equal(again.updates.phone_gateway_secret, again.rotatedSecret)
  assert.notEqual(again.rotatedSecret, DONE.phone_gateway_secret)
  // No service chosen yet: no code.
  assert.equal('phone_gateway_secret' in phoneUpdates({ sms_channel: 'telnyx' }, {}).updates, false)
})

test('incoming texts: the shop\'s own code is required and compared exactly', () => {
  const saved = { shop_id: SHOP, sms_channel: 'phone', phone_gateway_secret: 'code-abc' }
  assert.deepEqual(inboundAccess({ shopParam: SHOP, provided: 'code-abc', saved, envSecret: undefined }), { ok: true, shopId: SHOP })
  for (const provided of ['', 'code-abd', 'code-ab', 'code-abc ', 'CODE-ABC']) {
    assert.deepEqual(inboundAccess({ shopParam: SHOP, provided, saved, envSecret: 'code-abc' }), { ok: false, status: 401 }, provided)
  }
  // A shop with no code saved, or no row at all, cannot be posted into, even with an empty code.
  assert.deepEqual(inboundAccess({ shopParam: SHOP, provided: 'x', saved: { shop_id: SHOP, sms_channel: 'phone' }, envSecret: undefined }), { ok: false, status: 401 })
  assert.deepEqual(inboundAccess({ shopParam: SHOP, provided: 'x', saved: null, envSecret: undefined }), { ok: false, status: 401 })
  assert.deepEqual(inboundAccess({ shopParam: SHOP, provided: '', saved: { ...saved, phone_gateway_secret: '' }, envSecret: undefined }), { ok: false, status: 401 })
  // A malformed shop id is refused before anything is looked up.
  for (const bad of ['1', "x' or 1=1 --", '../etc', SHOP + 'zz']) assert.equal(inboundAccess({ shopParam: bad, provided: 'code-abc', saved, envSecret: undefined }).ok, false)
  assert.equal(looksLikeShopId(SHOP), true)
  assert.equal(looksLikeShopId('abc'), false)
})

test('one shop\'s code never opens another shop', () => {
  const a = { shop_id: SHOP, sms_channel: 'phone', phone_gateway_secret: 'code-A' }
  // The caller reads the row for the shop named in the address, so a code from shop B fails against shop A's row.
  assert.deepEqual(inboundAccess({ shopParam: SHOP, provided: 'code-B', saved: a, envSecret: 'code-B' }), { ok: false, status: 401 })
})

test('a shop that went back to Telnyx is answered "fine" so its old gateway stops retrying', () => {
  const r = inboundAccess({ shopParam: SHOP, provided: 'code-abc', saved: { shop_id: SHOP, sms_channel: 'telnyx', phone_gateway_secret: 'code-abc' }, envSecret: undefined })
  assert.equal(r.ok, false)
  assert.equal(r.status, 200)
  assert.match(r.skipped, /off/)
})

test('the older single-shop form still works, and fails closed without its setting', () => {
  assert.deepEqual(inboundAccess({ shopParam: '', provided: 'env-secret', saved: null, envSecret: 'env-secret' }), { ok: true, shopId: null })
  assert.deepEqual(inboundAccess({ shopParam: '', provided: 'nope', saved: null, envSecret: 'env-secret' }), { ok: false, status: 401 })
  assert.deepEqual(inboundAccess({ shopParam: '', provided: '', saved: null, envSecret: 'env-secret' }), { ok: false, status: 401 })
  const none = inboundAccess({ shopParam: '', provided: 'x', saved: null, envSecret: undefined })
  assert.equal(none.ok, false)
  assert.equal(none.status, 503)
  assert.equal(inboundAccess({ shopParam: '', provided: '', saved: null, envSecret: '' }).status, 503)
})

import { wantsPhone } from '../src/lib/phone-settings.ts'

test('blank phone fields riding along with an ordinary save are not a request for the phone', () => {
  assert.equal(wantsPhone({ shop_name: 'A' }), false)
  assert.equal(wantsPhone({ sms_channel: null, phone_gateway: null, phone_gateway_key: '', phone_gateway_device: null, phone_gateway_number: '' }), false)
  assert.equal(wantsPhone({ sms_channel: 'telnyx', phone_gateway: '', phone_gateway_key: '   ' }), false)
  assert.equal(wantsPhone({ sms_channel: 'phone' }), true)
  assert.equal(wantsPhone({ phone_gateway: 'textbee' }), true)
  assert.equal(wantsPhone({ phone_gateway_number: '+17135550142' }), true)
  assert.equal(wantsPhone({ phone_gateway_key: 'abc' }), true)
  assert.equal(wantsPhone({ rotate_phone_secret: true }), true)
})
