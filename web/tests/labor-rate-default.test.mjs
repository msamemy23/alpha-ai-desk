import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const documentsPage = readFileSync(new URL('../src/components/DocumentsPage.tsx', import.meta.url), 'utf8')
const shopSection = readFileSync(new URL('../src/components/settings/ShopSection.tsx', import.meta.url), 'utf8')

test('a new estimate or invoice never invents a labor rate the shop did not set', () => {
  const line = documentsPage.split('\n').find(l => l.includes('const laborRate ='))
  assert.ok(line, 'laborRate fallback line exists')
  assert.match(line, /:\s*0\s*$/, 'unset labor rate falls back to 0')
  assert.doesNotMatch(line, /\b120\b/, 'no invented $120 default')
})

test('the person is told when the labor rate is unset', () => {
  assert.match(documentsPage, /laborUnset/)
  assert.match(documentsPage, /labor rate is not set/)
})

test('Settings does not pre-fill a made-up labor rate', () => {
  const field = shopSection.split('\n').find(l => l.includes('k="labor_rate"'))
  assert.ok(field, 'labor_rate field exists')
  assert.doesNotMatch(field, /fallback=\{120\}/)
})
