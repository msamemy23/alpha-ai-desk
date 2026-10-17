import './helpers/route-test.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'

// The durable text sender (used by Messages, estimates and invoices, the assistant and automations), called with a stand-in database and a
// stand-in network. It must send exactly what it always sent for a Telnyx shop, and send through the owner's phone for a shop that chose it.
const { sendDurableSms } = await import(new URL('../src/lib/durable-sms.ts', import.meta.url).href)

function makeDb() {
  const log = { rpc: [], inserts: [], updates: [] }
  const builder = table => {
    const q = { op: 'select' }
    const result = () => {
      if (table === 'message_send_operations' && q.op === 'update') return { data: { id: 'op-1' }, error: null }
      if (table === 'messages' && q.op === 'insert') return { data: { id: 'msg-1' }, error: null }
      return { data: null, error: null }
    }
    const api = {
      select() { return api }, eq() { return api }, limit() { return api }, order() { return api }, delete() { return api },
      insert(v) { q.op = 'insert'; log.inserts.push({ table, v }); return api },
      update(v) { q.op = 'update'; log.updates.push({ table, v }); return api },
      upsert(v) { q.op = 'insert'; log.inserts.push({ table, v }); return api },
      maybeSingle() { return Promise.resolve(result()) },
      then(res, rej) { return Promise.resolve(result()).then(res, rej) },
    }
    return api
  }
  return { log, from: builder, rpc: async (name, args) => { log.rpc.push({ name, args }); return name === 'claim_sms_send_operation' ? { data: { status: 'claimed', operation_id: 'op-1' }, error: null } : { data: null, error: null } } }
}

function fakeNetwork(reply) {
  const calls = []
  const orig = globalThis.fetch
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return { ok: true, status: 200, json: async () => reply } }
  return { calls, restore: () => { globalThis.fetch = orig } }
}

const TELNYX = { telnyx_api_key: 'KEY', telnyx_phone_number: '+17135550100', telnyx_messaging_profile_id: 'prof-1' }
const PHONE = { sms_channel: 'phone', phone_gateway: 'httpsms', phone_gateway_key: 'HS', phone_gateway_number: '+17135550142' }
const input = (db, settings, extra = {}) => ({
  request: new Request('http://x/send', { method: 'POST', headers: { 'Idempotency-Key': 'req-1' } }),
  db, shopId: 'shop-1', userId: 'u1', to: '713-555-0199', text: 'Your car is ready', customerId: 'c1', settings, ...extra,
})

test('a Telnyx shop: the same request as before goes to Telnyx, and the message is logged from the Telnyx number', async () => {
  const db = makeDb()
  globalThis.__routeDb = db
  const net = fakeNetwork({ data: { id: 'tx-1' } })
  try {
    const r = await sendDurableSms(input(db, TELNYX))
    assert.equal(r.ok, true)
    assert.equal(r.messageId, 'tx-1')
    assert.equal(net.calls.length, 1)
    assert.equal(net.calls[0].url, 'https://api.telnyx.com/v2/messages')
    assert.equal(net.calls[0].init.headers.Authorization, 'Bearer KEY')
    const body = JSON.parse(net.calls[0].init.body)
    assert.deepEqual(body, { from: '+17135550100', to: '+17135550199', text: 'Your car is ready', messaging_profile_id: 'prof-1' })
    assert.match(net.calls[0].init.headers['Idempotency-Key'], /^sms:[0-9a-f]{64}$/)
    const message = db.log.inserts.find(i => i.table === 'messages').v
    assert.equal(message.from_address, '+17135550100')
    assert.equal(message.telnyx_message_id, 'tx-1')
    assert.equal(message.direction, 'outbound')
  } finally { net.restore() }
})

test('a shop that chose its phone: the text goes through that shop\'s gateway account and is logged from the phone\'s number', async () => {
  const db = makeDb()
  globalThis.__routeDb = db
  const net = fakeNetwork({ data: { id: 'hs-1' } })
  try {
    const r = await sendDurableSms(input(db, { ...TELNYX, ...PHONE }))
    assert.equal(r.ok, true)
    assert.equal(r.messageId, 'hs-1')
    assert.equal(net.calls.length, 1)
    assert.equal(net.calls[0].url, 'https://api.httpsms.com/v1/messages/send')
    assert.equal(net.calls[0].init.headers['x-api-key'], 'HS')
    assert.deepEqual(JSON.parse(net.calls[0].init.body), { content: 'Your car is ready', from: '+17135550142', to: '+17135550199' })
    const message = db.log.inserts.find(i => i.table === 'messages').v
    assert.equal(message.from_address, '+17135550142')
    assert.equal(message.telnyx_message_id, 'hs-1')
  } finally { net.restore() }
})

test('a phone gateway that sends back no id still produces a message record, so the thread shows the text', async () => {
  const db = makeDb()
  globalThis.__routeDb = db
  const net = fakeNetwork({})
  try {
    const r = await sendDurableSms(input(db, PHONE))
    assert.equal(r.ok, true)
    assert.match(r.messageId, /^phone-httpsms-sms:/)
    assert.ok(db.log.inserts.some(i => i.table === 'messages'))
  } finally { net.restore() }
})

test('pictures on a phone-channel shop are refused before anything is claimed or sent', async () => {
  const db = makeDb()
  globalThis.__routeDb = db
  const net = fakeNetwork({})
  try {
    const r = await sendDurableSms(input(db, PHONE, { media: { ids: ['m1'], urls: ['https://x/a.jpg'] } }))
    assert.equal(r.ok, false)
    assert.equal(r.status, 409)
    assert.match(r.error, /Pictures cannot go through your own phone/)
    assert.equal(db.log.rpc.length, 0)
    assert.equal(net.calls.length, 0)
  } finally { net.restore() }
})

test('a shop that cannot text is told so before anything is claimed or sent', async () => {
  for (const settings of [{}, { sms_channel: 'phone', phone_gateway: 'textbee', phone_gateway_key: 'k' }, { telnyx_api_key: 'only-a-key' }]) {
    const db = makeDb()
    globalThis.__routeDb = db
    const net = fakeNetwork({})
    try {
      const r = await sendDurableSms(input(db, settings))
      assert.equal(r.ok, false)
      assert.equal(r.status, 409)
      assert.match(r.error, /not set up|not finished/)
      assert.equal(db.log.rpc.length, 0)
      assert.equal(net.calls.length, 0)
    } finally { net.restore() }
  }
})
