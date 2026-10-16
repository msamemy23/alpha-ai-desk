import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

test('the parts price prompt does not tell the model that every store is in Houston', () => {
  const route = readFileSync(new URL('../src/app/api/parts-lookup/route.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(route, /"storeLocation": "Houston TX"/)
  assert.match(route, /"storeLocation": "city and state only if the search results show one, otherwise an empty string"/)
})
