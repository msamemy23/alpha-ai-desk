// The clock-in location check: distance, what counts as inside, and what a bad or missing fix means. Run for real.
import test from 'node:test'
import assert from 'node:assert/strict'
import * as geo from '../src/lib/geo.ts'

// A made-up shop spot. Nothing here is a real address.
const shop = { lat: 40, lng: -100, radiusM: 150 }
// 0.001 degrees of latitude is about 111 metres.
const north = (deg, acc = 10) => ({ lat: 40 + deg, lng: -100, accuracy: acc })

test('distance is close to the known length of a degree', () => {
  assert.equal(Math.round(geo.distanceM({ lat: 40, lng: -100 }, { lat: 40.001, lng: -100 })), 111)
  assert.equal(geo.distanceM({ lat: 40, lng: -100 }, { lat: 40, lng: -100 }), 0)
  const a = { lat: 10, lng: 20 }, b = { lat: 11, lng: 21 }
  assert.equal(Math.round(geo.distanceM(a, b)), Math.round(geo.distanceM(b, a)))
})

test('a fix is read only when it is a real place on the earth', () => {
  assert.deepEqual(geo.readFix({ lat: 40, lng: -100, accuracy: 12 }), { lat: 40, lng: -100, accuracy: 12 })
  assert.deepEqual(geo.readFix({ lat: '40.5', lng: '-100.5' }), { lat: 40.5, lng: -100.5, accuracy: null })
  assert.equal(geo.readFix(null), null)
  assert.equal(geo.readFix('40,-100'), null)
  assert.equal(geo.readFix({ lat: 95, lng: 0 }), null)
  assert.equal(geo.readFix({ lat: 0, lng: 181 }), null)
  assert.equal(geo.readFix({ lat: 'north', lng: 0 }), null)
  assert.equal(geo.readFix({ lat: 1, lng: 2, accuracy: -5 }).accuracy, null)
})

test('inside, outside and unknown', () => {
  assert.deepEqual(geo.checkLocation(shop, north(0.0005)), { status: 'inside', distanceM: 56 })
  assert.equal(geo.checkLocation(shop, north(0.004)).status, 'outside')
  assert.deepEqual(geo.checkLocation(shop, null), { status: 'unknown', distanceM: null })
})

test('a fuzzy fix gets a little slack, but never more than 100 metres', () => {
  // 0.0016 degrees is about 178 m: outside a 150 m radius, but inside with 40 m of stated accuracy
  assert.equal(geo.checkLocation(shop, north(0.0016, 5)).status, 'outside')
  assert.equal(geo.checkLocation(shop, north(0.0016, 40)).status, 'inside')
  // 0.003 degrees is about 333 m: a stated accuracy of 500 m only buys 100 m of slack
  assert.equal(geo.checkLocation(shop, north(0.003, 500)).status, 'outside')
})

test('a fix accurate only to a kilometre or worse is not trusted either way', () => {
  const r = geo.checkLocation(shop, north(0.0001, 2500))
  assert.equal(r.status, 'unknown')
  assert.equal(typeof r.distanceM, 'number')
})

test('distance in words', () => {
  assert.equal(geo.distanceWords(240), 'about 240 m')
  assert.equal(geo.distanceWords(1400), 'about 1.4 km')
})
