import test from 'node:test'
import assert from 'node:assert/strict'
import * as f from '../src/lib/shop-form.ts'
import * as c from '../src/lib/connector-messages.ts'

test('address: street and city line join into one line without repeating the city', () => {
  assert.equal(f.joinShopAddress('2210 Harbor Way', 'Houston, TX 77003'), '2210 Harbor Way, Houston, TX 77003')
  assert.equal(f.joinShopAddress('2210 Harbor Way, Houston, TX 77003', 'Houston, TX 77003'), '2210 Harbor Way, Houston, TX 77003')
  assert.equal(f.joinShopAddress('', 'Austin, TX 78701'), 'Austin, TX 78701')
  assert.equal(f.joinShopAddress('  5 Elm St ', ''), '5 Elm St')
})

test('address: the full line splits back so Settings never writes the city into the street', () => {
  assert.deepEqual(f.splitShopAddress('2210 Harbor Way, Houston, TX 77003', 'Houston, TX 77003'), { address: '2210 Harbor Way', cityStateZip: 'Houston, TX 77003' })
  assert.deepEqual(f.splitShopAddress('Suite 5, 2210 Harbor Way, Houston, TX 77003-1234'), { address: 'Suite 5, 2210 Harbor Way', cityStateZip: 'Houston, TX 77003-1234' })
  // the street was edited but the city line is the same
  assert.deepEqual(f.splitShopAddress('9 New Rd, Houston, TX 77003', 'Houston, TX 77003'), { address: '9 New Rd', cityStateZip: 'Houston, TX 77003' })
  // the city was removed on purpose: the old one is not kept
  assert.deepEqual(f.splitShopAddress('9 New Rd', 'Houston, TX 77003'), { address: '9 New Rd', cityStateZip: '' })
  assert.deepEqual(f.splitShopAddress('Highway 6 and Main'), { address: 'Highway 6 and Main', cityStateZip: '' })
  assert.deepEqual(f.splitShopAddress('   '), { address: '', cityStateZip: '' })
})

test('numbers: blank, negative, too big and fractional months are refused with a plain message', () => {
  assert.deepEqual(f.validateSettings({ labor_rate: 120, tax_rate: 8.25, warranty_months: 12 }), {})
  assert.deepEqual(f.validateSettings({ labor_rate: '125.50', tax_rate: '0', warranty_months: '24' }), {})
  const bad = f.validateSettings({ labor_rate: '', tax_rate: '101', warranty_months: '1.5' })
  assert.deepEqual(Object.keys(bad).sort(), ['labor_rate', 'tax_rate', 'warranty_months'])
  assert.match(bad.tax_rate, /0 to 100/)
  assert.ok(f.validateSettings({ labor_rate: '-5' }).labor_rate)
  assert.ok(f.validateSettings({ labor_rate: 'abc' }).labor_rate)
})

test('fields that did not load never block a save', () => {
  assert.deepEqual(f.validateSettings({}), {})
  assert.deepEqual(f.validateSettings({ shop_phone: '(713) 555-0100' }), {})
})

test('shop name, emails and links are checked when they have a value', () => {
  assert.ok(f.validateSettings({ shop_name: '   ' }).shop_name)
  assert.deepEqual(f.validateSettings({ shop_name: 'Main Street Auto', shop_email: '', from_email: 'service@mainstreet.com' }), {})
  assert.ok(f.validateSettings({ shop_email: 'not an email' }).shop_email)
  assert.ok(f.validateSettings({ from_email: 'a@b' }).from_email)
  assert.ok(f.validateSettings({ google_review_url: 'g.page/r/shop' }).google_review_url)
  assert.deepEqual(f.validateSettings({ google_review_url: 'https://g.page/r/shop/review' }), {})
})

test('phone numbers are tidied to +country code and digits', () => {
  assert.equal(f.normalizePhoneE164('(713) 555-0100'), '+17135550100')
  assert.equal(f.normalizePhoneE164('1 713 555 0100'), '+17135550100')
  assert.equal(f.normalizePhoneE164('+44 20 7946 0958'), '+442079460958')
  assert.equal(f.normalizePhoneE164(''), '')
  assert.deepEqual(f.validateSettings({ telnyx_phone_number: '+17135550100' }), {})
  assert.ok(f.validateSettings({ telnyx_phone_number: '555-0100' }).telnyx_phone_number)
})

test('the first problem is the one highest on the screen', () => {
  const errs = f.validateSettings({ labor_rate: '', shop_name: '', telnyx_phone_number: '123' })
  assert.equal(f.firstErrorKey(errs), 'shop_name')
  assert.equal(f.FIELD_SECTION.telnyx_phone_number, 'comms')
  assert.equal(f.firstErrorKey({}), null)
})

test('coming back from a sign-in says what happened in plain words', () => {
  assert.equal(c.connectNotice(null, null, null), null)
  assert.equal(c.connectNotice('google', null, null).kind, 'success')
  const nf = c.connectNotice(null, 'facebook_not_configured', 'Set FACEBOOK_APP_ID in Vercel env')
  assert.equal(nf.kind, 'error')
  assert.doesNotMatch(nf.message, /Vercel|env|FACEBOOK_APP_ID/)
  assert.match(c.connectNotice(null, 'facebook_multiple_pages', null).message, /more than one page/)
  assert.match(c.connectNotice(null, 'facebook_no_pages', null).message, /did not find a page/)
  assert.match(c.connectNotice(null, 'google_denied', 'The user denied access').message, /Google said: The user denied access/)
  assert.doesNotMatch(c.connectNotice(null, 'google_denied', 'no_code').message, /said/)
  assert.match(c.connectNotice(null, 'oauth_weird_thing', null).message, /oauth weird thing/)
})

test('names: camelCase and Title Case read as sentences', () => {
  assert.equal(c.plainName('partsLookup'), 'Parts lookup')
  assert.equal(c.plainName('send_sms'), 'Send sms')
  assert.equal(c.plainName('mcpCallTool'), 'Mcp call tool')
  assert.equal(c.sentenceTitle('Browser Tab Inspection With Kapture', ['Kapture']), 'Browser tab inspection with Kapture')
  assert.equal(c.sentenceTitle('Invoice/Estimate Send Flow'), 'Invoice/estimate send flow')
  assert.equal(c.sentenceTitle('Call Summary And Follow-Up'), 'Call summary and follow-up')
})
