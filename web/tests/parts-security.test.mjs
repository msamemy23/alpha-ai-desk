import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const route = readFileSync(new URL('../src/app/api/parts-lookup/route.ts', import.meta.url), 'utf8')
const partsPage = readFileSync(new URL('../src/app/(app)/parts/page.tsx', import.meta.url), 'utf8')
const sendSms = readFileSync(new URL('../src/app/api/send-sms/route.ts', import.meta.url), 'utf8')
const aiAction = readFileSync(new URL('../src/app/api/ai-action/route.ts', import.meta.url), 'utf8')

test('parts lookup is authenticated, shop scoped, rate limited, and audited', () => {
  assert.match(route, /getAuthedShop/)
  assert.match(route, /\.eq\('shop_id', auth\.shopId\)/)
  assert.match(route, /checkRateLimit/)
  assert.match(route, /writeAuditLog/)
})

test('parts lookup strips unverified prices instead of inventing them', () => {
  assert.match(route, /sanitizeParsedParts/)
  assert.match(route, /priceAppearsInEvidence/)
  assert.match(route, /sourceConfidence/)
  assert.doesNotMatch(partsPage, /AI-estimated|realistic pricing/i)
  assert.match(partsPage, /Prices only show when they are visible/)
})

test('SMS and AI shop actions have rate limit, audit, and idempotency safeguards', () => {
  for (const source of [sendSms, aiAction]) {
    assert.match(source, /checkRateLimit/)
    assert.match(source, /writeAuditLog/)
    assert.match(source, /Idempotency|idempotency/i)
  }
})
