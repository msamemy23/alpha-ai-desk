import './helpers/route-test.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { makeSettingsDb } from './helpers/fake-settings-db.mjs'

// The Settings route is called directly with a stand-in database. These checks guard the careful part of the phone change: a database that
// has not had migration 063 yet must keep loading and saving every other setting exactly as before.
const { GET, POST } = await import(new URL('../src/app/api/settings/route.ts', import.meta.url).href)
const { NextRequest } = await import(new URL('./helpers/route-stubs/next-server.mjs', import.meta.url).href)

const SHOP = '0f3b6c1e-6a52-4c0e-9d1a-1c9b6f8a2e11'
const OLD_COLUMNS = ['id', 'shop_id', 'updated_at', 'shop_name', 'shop_address', 'shop_phone', 'shop_email', 'labor_rate', 'tax_rate', 'warranty_months', 'payment_terms', 'payment_methods', 'disclaimer', 'techs', 'ai_model', 'ai_base_url', 'telnyx_phone_number', 'telnyx_messaging_profile_id', 'from_email', 'google_review_url', 'timezone', 'automation_config', 'telnyx_connection_id', 'facebook_page_id', 'fb_ad_account_id', 'searxng_url', 'webrtc_connection_id', 'webrtc_credential_id', 'telnyx_outbound_voice_profile_id', 'ai_api_key', 'telnyx_api_key', 'resend_api_key', 'browserless_token', 'facebook_page_token']
const NEW_COLUMNS = [...OLD_COLUMNS, 'sms_channel', 'phone_gateway', 'phone_gateway_key', 'phone_gateway_device', 'phone_gateway_number', 'phone_gateway_secret']
const ROW = { id: 'row-1', shop_id: SHOP, shop_name: 'Alpha', labor_rate: 120, telnyx_api_key: 'TELNYX-SECRET', telnyx_phone_number: '+17135550100' }

function setup(columns, row = ROW, role = 'owner') {
  const db = makeSettingsDb({ columns, rows: [row] })
  globalThis.__routeDb = db
  globalThis.__routeAuth = { shopId: SHOP, userId: 'u1', role }
  return db
}
const post = body => POST(new NextRequest('http://x/api/settings', { method: 'POST', body: JSON.stringify(body) }))
const json = async res => ({ status: res.status, ...(await res.json()) })

test('BEFORE migration 063: settings load as before, with no phone columns asked for, and the card is told the database needs the update', async () => {
  setup(OLD_COLUMNS)
  const r = await json(await GET())
  assert.equal(r.status, 200)
  assert.equal(r.ok, true)
  assert.equal(r.settings.shop_name, 'Alpha')
  assert.equal(r.settings.phone_columns_ready, false)
  assert.equal(r.settings.telnyx_api_key, '')
  assert.equal(r.settings.telnyx_api_key_configured, true)
  assert.equal('phone_gateway_key' in r.settings, false)
  assert.equal(r.settings.shop_id, SHOP)
})

test('BEFORE migration 063: an ordinary save, even with blank phone fields along for the ride, still works and writes only the ordinary fields', async () => {
  const db = setup(OLD_COLUMNS)
  const r = await json(await post({ shop_name: 'Alpha Auto', labor_rate: 130, sms_channel: null, phone_gateway: null, phone_gateway_key: '', phone_gateway_device: null, phone_gateway_number: null }))
  assert.equal(r.status, 200)
  assert.equal(r.ok, true)
  assert.equal(db.state.rows[0].shop_name, 'Alpha Auto')
  assert.equal(db.state.rows[0].labor_rate, 130)
  assert.ok(db.state.writes.every(w => !Object.keys(w.values).some(k => k.startsWith('phone_') || k === 'sms_channel')))
})

test('BEFORE migration 063: asking for the phone is refused with a plain sentence, and nothing is saved', async () => {
  const db = setup(OLD_COLUMNS)
  for (const ask of [{ sms_channel: 'phone' }, { phone_gateway: 'textbee' }, { phone_gateway_key: 'abc' }, { rotate_phone_secret: true }]) {
    const r = await json(await post({ shop_name: 'Changed', ...ask }))
    assert.equal(r.status, 409, JSON.stringify(ask))
    assert.match(r.error, /needs a database update first \(migration 063\)\. Nothing was saved/)
  }
  assert.equal(db.state.rows[0].shop_name, 'Alpha')
  assert.equal(db.state.writes.length, 0)
})

test('AFTER migration 063: the key is masked, the code is shown to the owner, and the card is told it can work', async () => {
  setup(NEW_COLUMNS, { ...ROW, sms_channel: 'phone', phone_gateway: 'httpsms', phone_gateway_key: 'HS-SECRET', phone_gateway_number: '+17135550142', phone_gateway_secret: 'code-1' })
  const r = await json(await GET())
  assert.equal(r.settings.phone_columns_ready, true)
  assert.equal(r.settings.phone_gateway_key, '')
  assert.equal(r.settings.phone_gateway_key_configured, true)
  assert.equal(r.settings.phone_gateway_secret, 'code-1')
  assert.doesNotMatch(JSON.stringify(r), /HS-SECRET|TELNYX-SECRET/)
})

test('AFTER: choosing a service makes the address code once, and the key is stored but never echoed back', async () => {
  const db = setup(NEW_COLUMNS)
  const r = await json(await post({ phone_gateway: 'textbee', phone_gateway_key: 'TB-SECRET', phone_gateway_device: 'dev-9', phone_gateway_number: '(713) 555-0142' }))
  assert.equal(r.status, 200)
  assert.doesNotMatch(JSON.stringify(r), /TB-SECRET/)
  const saved = db.state.rows[0]
  assert.equal(saved.phone_gateway, 'textbee')
  assert.equal(saved.phone_gateway_key, 'TB-SECRET')
  assert.equal(saved.phone_gateway_number, '+17135550142')
  assert.match(saved.phone_gateway_secret, /^[0-9a-f]{32}$/)
  // A second save keeps the same code.
  const first = saved.phone_gateway_secret
  await post({ phone_gateway: 'textbee', shop_name: 'X' })
  assert.equal(db.state.rows[0].phone_gateway_secret, first)
})

test('AFTER: the phone cannot be switched on half-finished, and the shop keeps texting through Telnyx', async () => {
  const db = setup(NEW_COLUMNS)
  const r = await json(await post({ sms_channel: 'phone', phone_gateway: 'textbee', phone_gateway_number: '7135550142' }))
  assert.equal(r.status, 400)
  assert.match(r.error, /Finish the phone details first/)
  assert.equal(db.state.rows[0].sms_channel ?? null, null)
  assert.equal(db.state.writes.length, 0)
})

test('AFTER: switching on with everything filled in works, and a blank key box keeps the saved key', async () => {
  const db = setup(NEW_COLUMNS, { ...ROW, phone_gateway: 'httpsms', phone_gateway_key: 'HS-SECRET', phone_gateway_number: '+17135550142', phone_gateway_secret: 'code-1' })
  const r = await json(await post({ sms_channel: 'phone', phone_gateway_key: '' }))
  assert.equal(r.status, 200)
  assert.equal(db.state.rows[0].sms_channel, 'phone')
  assert.equal(db.state.rows[0].phone_gateway_key, 'HS-SECRET')
})

test('AFTER: a new code replaces the old one and is returned once; the old one is gone', async () => {
  const db = setup(NEW_COLUMNS, { ...ROW, phone_gateway: 'httpsms', phone_gateway_key: 'k', phone_gateway_number: '+17135550142', phone_gateway_secret: 'old-code' })
  const r = await json(await post({ rotate_phone_secret: true }))
  assert.equal(r.status, 200)
  assert.match(r.phone_gateway_secret, /^[0-9a-f]{32}$/)
  assert.equal(db.state.rows[0].phone_gateway_secret, r.phone_gateway_secret)
  assert.notEqual(r.phone_gateway_secret, 'old-code')
})

test('a viewer cannot change anything, and a signed-out request is refused', async () => {
  const db = setup(NEW_COLUMNS, ROW, 'viewer')
  assert.equal((await post({ sms_channel: 'phone' })).status, 403)
  assert.equal(db.state.writes.length, 0)
  globalThis.__routeAuth = null
  assert.equal((await post({ shop_name: 'x' })).status, 401)
})

test('an ordinary save on an up-to-date database changes nothing about the phone', async () => {
  const db = setup(NEW_COLUMNS, { ...ROW, sms_channel: 'phone', phone_gateway: 'httpsms', phone_gateway_key: 'HS', phone_gateway_number: '+17135550142', phone_gateway_secret: 'code-1' })
  const r = await json(await post({ shop_name: 'Renamed', labor_rate: 99 }))
  assert.equal(r.status, 200)
  const saved = db.state.rows[0]
  assert.equal(saved.shop_name, 'Renamed')
  assert.equal(saved.sms_channel, 'phone')
  assert.equal(saved.phone_gateway_key, 'HS')
  assert.equal(saved.phone_gateway_secret, 'code-1')
})
