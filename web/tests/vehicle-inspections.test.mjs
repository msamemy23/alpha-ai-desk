import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as v from '../src/lib/vehicles/inspections.ts'

const read = p => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

const car = { ownerId: 'c1', owner: 'Dana Ruiz', vin: '', year: '2018', make: 'Toyota', model: 'Camry', jobIds: ['j1'] }
const row = (id, o = {}) => ({ id, job_id: null, customer_id: 'c1', customer_name: 'Dana Ruiz', vehicle: '2018 Toyota Camry LE', tech: 'Sam', created_at: '2026-03-01T10:00:00Z', ...o })

test('an inspection of the same owner and car belongs to the car, newest first', () => {
  const rows = [row('old', { created_at: '2025-01-01T00:00:00Z' }), row('new', { created_at: '2026-06-01T00:00:00Z' }), row('mid', { created_at: '2025-09-01T00:00:00Z' })]
  assert.deepEqual(v.inspectionsOfCar(car, rows).map(r => r.id), ['new', 'mid', 'old'])
})

test('an inspection written on one of the car\'s own repair orders always belongs to it', () => {
  const r = row('on-job', { job_id: 'j1', customer_id: null, customer_name: '', vehicle: '' })
  assert.deepEqual(v.inspectionsOfCar(car, [r]).map(x => x.id), ['on-job'])
})

test('two customers with the same model of car are never joined', () => {
  const other = row('other', { customer_id: 'c2', customer_name: 'Pat Lee' })
  assert.deepEqual(v.inspectionsOfCar(car, [other]), [])
})

test('the same owner with a different car is not joined either', () => {
  const truck = row('truck', { vehicle: '2012 Ford F-150' })
  assert.deepEqual(v.inspectionsOfCar(car, [truck]), [])
})

test('a matching VIN joins the car even when the description differs, and a different VIN splits it', () => {
  const withVin = { ...car, vin: '1HGCM82633A004352', ownerId: '', owner: '' }
  const r = row('v1', { job_id: 'jx', customer_id: null, customer_name: 'Someone Else', vehicle: 'Honda Accord' })
  assert.deepEqual(v.inspectionsOfCar(withVin, [r], id => (id === 'jx' ? '1HGCM82633A004352' : '')).map(x => x.id), ['v1'])
  assert.deepEqual(v.inspectionsOfCar(withVin, [r], () => '2T1BURHE0JC034461'), [])
})

test('a customer name written as a walk-in still matches the owner', () => {
  const walk = row('walk', { customer_id: null, customer_name: 'Walk-in: Dana Ruiz' })
  assert.deepEqual(v.inspectionsOfCar({ ...car, ownerId: '' }, [walk]).map(x => x.id), ['walk'])
})

test('no rows, no inspections', () => {
  assert.deepEqual(v.inspectionsOfCar(car, []), [])
})

test('tallyOf counts urgent, soon and good lines, and ignores anything that is not a rating', () => {
  const t = v.tallyOf([{ r: 'r' }, { r: 'y' }, { r: 'y' }, { r: 'g' }, { r: 'g' }, { r: 'g' }, { r: 'x' }, null, 'text'])
  assert.deepEqual(t, { urgent: 1, soon: 2, good: 3 })
  assert.equal(v.tallyOf([]), null)
  assert.equal(v.tallyOf(null), null)
  assert.equal(v.tallyOf('nope'), null)
  assert.equal(v.tallyOf([{ r: 'x' }]), null)
})

test('the words say what was found, with singular and plural right', () => {
  assert.equal(v.tallyWords({ urgent: 2, soon: 3, good: 14 }), '2 urgent, 3 need attention soon, 14 good')
  assert.equal(v.tallyWords({ urgent: 0, soon: 1, good: 0 }), '1 needs attention soon')
  assert.equal(v.tallyWords({ urgent: 0, soon: 0, good: 9 }), '9 good')
  assert.equal(v.tallyWords(null), '')
})

test('the lamp follows the worst finding, and is off with no summary', () => {
  assert.equal(v.tallyLamp({ urgent: 1, soon: 5, good: 1 }), 'red')
  assert.equal(v.tallyLamp({ urgent: 0, soon: 1, good: 1 }), 'amber')
  assert.equal(v.tallyLamp({ urgent: 0, soon: 0, good: 4 }), 'green')
  assert.equal(v.tallyLamp(null), 'off')
})

/* ---------- the screen ---------- */

test('the Vehicles sheet shows the Inspections section after the repair history', () => {
  const s = read('src/components/vehicles/VehicleSheet.tsx')
  assert.match(s, /<CarInspections vehicle=\{v\} \/>/)
  assert.ok(s.indexOf('vs-history') < s.indexOf('<CarInspections'))
})

test('the list is read-only, asks for light columns first, falls back when a column is missing, and handles all four states', () => {
  const c = read('src/components/vehicles/CarInspections.tsx')
  assert.ok(!/\.(insert|update|delete|upsert)\(/.test(c), 'it only reads')
  assert.match(c, /missingSchema\(res\.error\)/)
  assert.ok(!/select\('\*'\)/.test(c), 'the photos and checklist are never loaded for a list')
  assert.match(c, /status: 'loading'/)
  assert.match(c, /status: 'error'/)
  assert.match(c, /No inspections for this car yet/)
  assert.match(c, /Try again/)
  assert.match(c, /href=\{`\/dvi\?id=\$\{encodeURIComponent\(i\.id\)\}`\}/)
  assert.match(c, /\/dvi\?new=1&job=/)
})

test('every lamp has words beside it and nothing is coloured only', () => {
  const c = read('src/components/vehicles/CarInspections.tsx')
  assert.match(c, /aria-hidden="true"\s*\/>\{words \|\| 'No summary saved'\}/)
})
