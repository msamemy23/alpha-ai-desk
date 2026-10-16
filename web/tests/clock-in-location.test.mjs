import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8')

test('the app itself may ask for the device location, and no other site or frame may', () => {
  const middleware = read('../src/middleware.ts')
  assert.match(middleware, /Permissions-Policy', 'camera=\(self\), microphone=\(self\), geolocation=\(self\)'/)
  assert.doesNotMatch(middleware, /geolocation=\(\*\)/)
})

test('clock-in asks the device where it is only when the shop turned the location check on', () => {
  const staff = read('../src/app/(app)/staff/page.tsx')
  assert.match(staff, /action === 'clock_in' && rules\.locationMode !== 'off'/)
  const geo = read('../src/components/team/geoClient.ts')
  assert.match(geo, /enableHighAccuracy: false/)
  assert.match(geo, /sent to our own server only/)
})
