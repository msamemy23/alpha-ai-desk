import test from 'node:test'
import assert from 'node:assert/strict'
import { LEGACY, fillWarrantyText } from '../src/lib/warranty-text.ts'
import { WARRANTY_PRESETS } from '../src/lib/doc-warranty.ts'

const ALPHA = LEGACY.name
const count = (text, needle) => text.split(needle).length - 1
const presets = WARRANTY_PRESETS.filter(p => p.exclusions.includes('{shop}'))

test('a shop named like the original shop is written once in every preset, never doubled', () => {
  assert.ok(presets.length > 0)
  for (const p of presets) {
    const text = fillWarrantyText(p.exclusions, { name: ALPHA })
    assert.doesNotMatch(text, /International Auto Center International/, p.label)
    assert.doesNotMatch(text, /\{shop\}/, p.label)
    assert.equal(count(text, ALPHA), count(p.exclusions, '{shop}'), p.label)
  }
})

test('another shop name fills every {shop} and the empty name falls back to "our shop"', () => {
  for (const p of presets) {
    const named = fillWarrantyText(p.exclusions, { name: 'Demo Garage' })
    assert.equal(count(named, 'Demo Garage'), count(p.exclusions, '{shop}'), p.label)
    assert.doesNotMatch(named, /\{shop\}|our shop/, p.label)
    const empty = fillWarrantyText(p.exclusions, { name: '' })
    assert.equal(count(empty, 'our shop'), count(p.exclusions, '{shop}'), p.label)
    assert.doesNotMatch(empty, /\{shop\}/, p.label)
  }
  assert.equal(fillWarrantyText('Call {shop} first.', { name: '   ' }), 'Call our shop first.')
  assert.equal(fillWarrantyText('Call {shop} first.', {}), 'Call our shop first.')
})

test('a name that contains "Alpha" is not re-processed', () => {
  assert.equal(fillWarrantyText('Work by {shop} is covered.', { name: 'Alpha Tire & Auto' }), 'Work by Alpha Tire & Auto is covered.')
  assert.equal(fillWarrantyText('Work by {shop} is covered.', { name: 'Alpha' }), 'Work by Alpha is covered.')
  assert.equal(fillWarrantyText('{shop} and {shop}', { name: "Alpha's Garage" }), "Alpha's Garage and Alpha's Garage")
  for (const p of presets) {
    const text = fillWarrantyText(p.exclusions, { name: 'Alpha Omega Motors' })
    assert.equal(count(text, 'Alpha Omega Motors'), count(p.exclusions, '{shop}'), p.label)
    assert.doesNotMatch(text, /Motors Omega|Omega Motors Omega|Alpha Omega Motors Omega/, p.label)
  }
})

test('legacy text that names the original shop is swapped once, whatever the new name', () => {
  const legacy = `${ALPHA} warrants this repair. Return it to Alpha's bay or call Alpha at ${LEGACY.phone} or visit ${LEGACY.address}.`
  const shop = { name: 'Demo Garage', address: '5 Test Rd, Austin, TX 78701', phone: '(512) 555-0100' }
  assert.equal(
    fillWarrantyText(legacy, shop),
    "Demo Garage warrants this repair. Return it to Demo Garage's bay or call Demo Garage at (512) 555-0100 or visit 5 Test Rd, Austin, TX 78701.",
  )
  // The same legacy text for a shop whose own name contains "Alpha".
  assert.equal(
    fillWarrantyText(legacy, { ...shop, name: 'Alpha Tire & Auto' }),
    "Alpha Tire & Auto warrants this repair. Return it to Alpha Tire & Auto's bay or call Alpha Tire & Auto at (512) 555-0100 or visit 5 Test Rd, Austin, TX 78701.",
  )
  // And for the original shop itself: nothing doubles.
  const same = fillWarrantyText(legacy, { name: ALPHA, address: LEGACY.address, phone: LEGACY.phone })
  assert.doesNotMatch(same, /International Auto Center International/)
  assert.equal(count(same, ALPHA), 3)
  assert.match(same, /Alpha International Auto Center's bay/)
})

test('missing address and phone fall back to plain words; "$" in a name is kept literally', () => {
  assert.equal(fillWarrantyText(`Visit ${LEGACY.address} or call ${LEGACY.phone}.`, { name: 'Demo Garage' }), 'Visit our shop or call our shop phone.')
  assert.equal(fillWarrantyText('By {shop}.', { name: "Bob's $& Garage $1" }), "By Bob's $& Garage $1.")
  assert.equal(fillWarrantyText(null, { name: 'Demo Garage' }), '')
  assert.equal(fillWarrantyText(undefined, { name: 'Demo Garage' }), '')
})
