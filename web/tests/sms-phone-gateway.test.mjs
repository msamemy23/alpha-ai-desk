import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { sendSMS, sendViaShopPhone, gatewayMessageId } from '../src/lib/sms.ts'

const TEXTBEE = { provider: 'textbee', apiKey: 'tb-key', deviceId: 'dev 9', number: '+17135550142' }
const HTTPSMS = { provider: 'httpsms', apiKey: 'hs-key', deviceId: '', number: '+17135550142' }

function fakeFetch(reply, status = 200) {
  const calls = []
  const orig = globalThis.fetch
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return { ok: status >= 200 && status < 300, status, json: async () => reply } }
  return { calls, restore: () => { globalThis.fetch = orig } }
}

test('TextBee: posts to the shop\'s own device with the shop\'s own key, and returns the gateway id', async () => {
  const f = fakeFetch({ data: { smsBatchId: 'batch-77' } })
  try {
    const out = await sendViaShopPhone('+17135550199', 'Your car is ready', TEXTBEE, 'idem-1')
    assert.deepEqual(out, { id: 'batch-77', provider: 'textbee' })
    assert.equal(f.calls.length, 1)
    assert.equal(f.calls[0].url, 'https://api.textbee.dev/api/v1/gateway/devices/dev%209/send-sms')
    assert.equal(f.calls[0].init.headers['x-api-key'], 'tb-key')
    assert.deepEqual(JSON.parse(f.calls[0].init.body), { recipients: ['+17135550199'], message: 'Your car is ready' })
  } finally { f.restore() }
})

test('httpSMS: posts from the phone\'s number and returns the gateway id', async () => {
  const f = fakeFetch({ status: 'success', data: { id: 'uuid-1' } })
  try {
    const out = await sendViaShopPhone('+17135550199', 'Hello', HTTPSMS)
    assert.deepEqual(out, { id: 'uuid-1', provider: 'httpsms' })
    assert.equal(f.calls[0].url, 'https://api.httpsms.com/v1/messages/send')
    assert.equal(f.calls[0].init.headers['x-api-key'], 'hs-key')
    assert.deepEqual(JSON.parse(f.calls[0].init.body), { content: 'Hello', from: '+17135550142', to: '+17135550199' })
  } finally { f.restore() }
})

test('a gateway that accepts the text but sends no id still counts as accepted, with a stable made-up id', async () => {
  const f = fakeFetch({})
  try {
    const a = await sendViaShopPhone('+17135550199', 'Hi', HTTPSMS, 'same-key')
    assert.equal(a.id, 'phone-httpsms-same-key')
  } finally { f.restore() }
})

test('a refused text says why, in the service\'s own words', async () => {
  const f = fakeFetch({ message: 'Invalid API key' }, 401)
  try {
    await assert.rejects(() => sendViaShopPhone('+17135550199', 'Hi', TEXTBEE), /Invalid API key/)
  } finally { f.restore() }
  const g = fakeFetch({}, 500)
  try {
    await assert.rejects(() => sendViaShopPhone('+17135550199', 'Hi', TEXTBEE), /did not accept the text \(500\)/)
  } finally { g.restore() }
})

test('a phone text needs words in it', async () => {
  const f = fakeFetch({})
  try {
    await assert.rejects(() => sendViaShopPhone('+17135550199', '', TEXTBEE), /needs words/)
    assert.equal(f.calls.length, 0)
  } finally { f.restore() }
})

test('gatewayMessageId reads either service\'s reply', () => {
  assert.equal(gatewayMessageId({ data: { id: 'a' } }), 'a')
  assert.equal(gatewayMessageId({ data: { smsBatchId: 'b' } }), 'b')
  assert.equal(gatewayMessageId({ id: 'c' }), 'c')
  assert.equal(gatewayMessageId({ data: {} }), '')
  assert.equal(gatewayMessageId({ data: { id: 5 } }), '')
})

test('sendSMS sends through the shop\'s phone when given one, and never touches Telnyx or the deployment-wide gateway', async () => {
  const f = fakeFetch({ data: { id: 'uuid-2' } })
  const prev = process.env.SMS_PROVIDER
  process.env.SMS_PROVIDER = 'textbee'
  process.env.TEXTBEE_API_KEY = 'WRONG-deployment-key'
  try {
    const out = await sendSMS('713-555-0199', 'Hi', '+17135550142', { phone: HTTPSMS, idempotencyKey: 'k' })
    assert.equal(out.id, 'uuid-2')
    assert.equal(f.calls.length, 1)
    assert.match(f.calls[0].url, /httpsms\.com/)
    assert.equal(f.calls[0].init.headers['x-api-key'], 'hs-key')
    assert.equal(JSON.parse(f.calls[0].init.body).to, '+17135550199')
  } finally { f.restore(); if (prev === undefined) delete process.env.SMS_PROVIDER; else process.env.SMS_PROVIDER = prev; delete process.env.TEXTBEE_API_KEY }
})

test('Telnyx still gets the same request as before, and an empty messaging profile is left out instead of sent blank', async () => {
  const f = fakeFetch({ data: { id: 'tx-1' } })
  try {
    const out = await sendSMS('713-555-0199', 'Hi', '+17135550100', { apiKey: 'KEY', messagingProfileId: '', idempotencyKey: 'abc' })
    assert.equal(out.id, 'tx-1')
    assert.equal(f.calls[0].url, 'https://api.telnyx.com/v2/messages')
    assert.equal(f.calls[0].init.headers.Authorization, 'Bearer KEY')
    assert.equal(f.calls[0].init.headers['Idempotency-Key'], 'abc')
    const body = JSON.parse(f.calls[0].init.body)
    assert.deepEqual(body, { from: '+17135550100', to: '+17135550199', text: 'Hi' })
    f.calls.length = 0
    await sendSMS('713-555-0199', 'Hi', '+17135550100', { apiKey: 'KEY', messagingProfileId: 'prof-1', mediaUrls: ['https://x/a.jpg'] })
    assert.deepEqual(JSON.parse(f.calls[0].init.body), { from: '+17135550100', to: '+17135550199', text: 'Hi', media_urls: ['https://x/a.jpg'], type: 'MMS', messaging_profile_id: 'prof-1' })
  } finally { f.restore() }
})

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

test('only lib/sms.ts talks to the Telnyx text API, so every send path shares one channel choice', () => {
  const root = new URL('../src', import.meta.url).pathname
  const offenders = walk(root).filter(p => !p.endsWith('/lib/sms.ts') && readFileSync(p, 'utf8').includes('api.telnyx.com/v2/messages'))
  assert.deepEqual(offenders, [])
})

test('every route that sends a customer text reads the shop\'s channel, not just Telnyx fields', () => {
  const read = p => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
  const mustUse = {
    'app/api/send-sms/route.ts': 'channelOf(',
    'app/api/send-message/route.ts': 'channelOf(',
    'app/api/send-document/route.ts': 'textReady(',
    'app/api/scheduled-messages/dispatch/route.ts': 'smsOptionsFor(',
    'lib/durable-sms.ts': 'smsOptionsFor(',
    'lib/voice-runtime.ts': 'smsOptionsFor(',
    'lib/automation-store.ts': 'textReady(',
    'app/api/growth/outreach/route.ts': 'sendGrowthText(',
    'app/api/growth/reviews/route.ts': 'sendGrowthText(',
    'app/api/growth/follow-ups/route.ts': 'sendGrowthText(',
    'app/api/growth/estimate-followups/route.ts': 'sendGrowthText(',
    'app/api/growth/service-reminders/route.ts': 'sendGrowthText(',
  }
  for (const [file, needle] of Object.entries(mustUse)) assert.ok(read(file).includes(needle), `${file} should use ${needle}`)
  // The old shape (a Telnyx key and number read straight off the settings row to send) is gone from the send paths.
  for (const file of ['app/api/send-sms/route.ts', 'app/api/send-message/route.ts', 'app/api/growth/follow-ups/route.ts', 'app/api/growth/reviews/route.ts']) {
    assert.doesNotMatch(read(file), /telnyx_api_key/, `${file} still reads the Telnyx key directly`)
  }
})
