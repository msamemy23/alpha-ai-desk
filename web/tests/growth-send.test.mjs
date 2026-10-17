import test from 'node:test'
import assert from 'node:assert/strict'
import { loadLib } from './estimates-helper.mjs'

const channel = loadLib('text-channel')
const TELNYX = { telnyx_api_key: 'KEY', telnyx_phone_number: '+17135550100', telnyx_messaging_profile_id: '' }
const PHONE = { sms_channel: 'phone', phone_gateway: 'httpsms', phone_gateway_key: 'hs', phone_gateway_number: '+17135550142' }

function load(sendSMS) {
  return loadLib('growth-send', { '@/lib/sms': { sendSMS }, '@/lib/text-channel': channel })
}

test('a Telnyx shop: the text goes out with the shop\'s key, number and idempotency key, and the id comes back', async () => {
  const seen = []
  const { sendGrowthText } = load(async (to, body, from, options) => { seen.push({ to, body, from, options }); return { id: 'tx-9' } })
  const r = await sendGrowthText(TELNYX, '713-555-0199', 'Time for an oil change', 'follow-up-1', 'marketing')
  assert.deepEqual({ ...r }, { success: true, messageId: 'tx-9' })
  assert.equal(seen[0].from, '+17135550100')
  assert.equal(seen[0].options.apiKey, 'KEY')
  assert.equal(seen[0].options.idempotencyKey, 'follow-up-1')
})

test('a shop that cannot text gets a plain sentence and nothing is sent', async () => {
  let calls = 0
  const { sendGrowthText } = load(async () => { calls += 1; return { id: 'x' } })
  const r = await sendGrowthText({}, '713-555-0199', 'Hi', 'k', 'service')
  assert.equal(r.success, false)
  assert.match(r.error, /not set up/)
  assert.equal(calls, 0)
})

test('on a personal phone, one-to-one service texts go out and promotions do not', async () => {
  const seen = []
  const { sendGrowthText } = load(async (to, body, from, options) => { seen.push({ from, options }); return { id: 'hs-1' } })
  const service = await sendGrowthText(PHONE, '713-555-0199', 'Your car is ready', 'appointment-reminder-1', 'service')
  assert.equal(service.success, true)
  assert.equal(seen.length, 1)
  assert.equal(seen[0].from, '+17135550142')
  assert.equal(seen[0].options.phone.provider, 'httpsms')
  assert.equal('apiKey' in seen[0].options, false)
  const promo = await sendGrowthText(PHONE, '713-555-0199', 'Spring special', 'follow-up-2', 'marketing')
  assert.equal(promo.success, false)
  assert.match(promo.error, /carriers block a phone that sends in bulk/)
  assert.equal(seen.length, 1)
})

test('a provider error comes back as a failed result, not a crash; no id counts as not accepted', async () => {
  const boom = load(async () => { throw new Error('Invalid API key') })
  const a = await boom.sendGrowthText(TELNYX, '713-555-0199', 'Hi', 'k', 'service')
  assert.deepEqual({ ...a }, { success: false, error: 'Invalid API key' })
  const noId = load(async () => ({}))
  const b = await noId.sendGrowthText(TELNYX, '713-555-0199', 'Hi', 'k', 'service')
  assert.equal(b.success, false)
  assert.match(b.error, /not accepted/)
  const nullish = load(async () => null)
  assert.equal((await nullish.sendGrowthText(TELNYX, '713-555-0199', 'Hi', 'k', 'service')).success, false)
})
