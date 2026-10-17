import './helpers/browser-ui-render.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import React from 'react'
import server from 'react-dom/server'

// The Settings card for texting through the owner's own phone, drawn on the server in each state it can be in.
const h = React.createElement
const Card = await import(new URL('../src/components/settings/PhoneTextCard.tsx', import.meta.url).href).then(m => m.default)
const { SettingsProvider } = await import(new URL('../src/components/settings/fields.tsx', import.meta.url).href)
const draw = settings => server.renderToStaticMarkup(h(SettingsProvider, { value: { settings, set: () => {}, errors: {} } }, h(Card)))
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;|&#39;/g, "'").replace(/\s+/g, ' ')

const BASE = { phone_columns_ready: true, shop_id: '0f3b6c1e-6a52-4c0e-9d1a-1c9b6f8a2e11', telnyx_api_key_configured: true, telnyx_phone_number: '+17135550100' }
const DONE = { ...BASE, phone_gateway: 'textbee', phone_gateway_key_configured: true, phone_gateway_device: 'dev-9', phone_gateway_number: '+17135550142' }

test('before the database update the card says so and shows nothing to fill in', () => {
  const t = text(draw({ ...BASE, phone_columns_ready: false }))
  assert.match(t, /needs a one-time database update/)
  assert.match(t, /Nothing is wrong with your texts/)
  const html = draw({ ...BASE, phone_columns_ready: false })
  assert.doesNotMatch(html, /<input|<select|<textarea/)
})

test('before settings load, the card draws nothing', () => {
  assert.equal(draw({}), '')
})

test('a Telnyx shop that has not set up the phone is told its texts still go out on Telnyx', () => {
  const t = text(draw(BASE))
  assert.match(t, /Texts go out from your Telnyx number\. Your phone is not in use/)
  assert.match(t, /On an iPhone this is not possible/)
  assert.match(t, /From my phone button/)
  assert.match(t, /Send my texts from/)
  assert.doesNotMatch(t, /TextBee device ID/)
})

test('TextBee asks for a device ID; httpSMS does not', () => {
  assert.match(text(draw({ ...BASE, phone_gateway: 'textbee' })), /TextBee device ID/)
  assert.doesNotMatch(text(draw({ ...BASE, phone_gateway: 'httpsms' })), /device ID/)
  assert.match(text(draw({ ...BASE, phone_gateway: 'httpsms' })), /httpSMS API key/)
})

test('when the phone is on, the card says which number the texts leave from', () => {
  const t = text(draw({ ...DONE, sms_channel: 'phone' }))
  assert.match(t, /Texts go out from your phone, \+17135550142/)
  assert.doesNotMatch(t, /Your phone is not in use/)
})

test('a phone that is chosen but not finished never shows the green line', () => {
  const t = text(draw({ ...DONE, sms_channel: 'phone', phone_gateway_key_configured: false }))
  assert.doesNotMatch(t, /Texts go out from your phone/)
})

test('the card states what changes: no pictures, no promotions, no delivery report, the phone must stay on, calls stay on Telnyx', () => {
  const t = text(draw(DONE))
  assert.match(t, /Pictures cannot go this way/)
  assert.match(t, /Promotions and win-back texts stay off it/)
  assert.match(t, /only knows the service accepted a text, not that it was delivered/)
  assert.match(t, /phone has to be on, with a signal/)
  assert.match(t, /still answers calls on your Telnyx line/)
})

test('the test-text button stays off until the details are saved, and the key is never printed', () => {
  const incomplete = draw({ ...BASE, phone_gateway: 'httpsms' })
  assert.match(incomplete, /<button[^>]*disabled=""[^>]*>[^]*?Send test/)
  assert.match(text(incomplete), /Fill in the details above and save first/)
  const html = draw({ ...DONE, phone_gateway_key: '', phone_gateway_secret: 'abcdef0123456789abcdef0123456789' })
  assert.doesNotMatch(html, /tb-key|hs-key/)
})

test('the card is mounted in Settings, Communications', () => {
  assert.match(readFileSync(new URL('../src/components/settings/CommsSection.tsx', import.meta.url), 'utf8'), /<PhoneTextCard \/>/)
})
