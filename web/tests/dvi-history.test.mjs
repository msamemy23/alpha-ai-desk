import test from 'node:test'
import assert from 'node:assert/strict'
import * as h from '../src/lib/dvi-history.ts'

const di = (n, r, extra = {}) => ({ s: 'Brakes', n, r, ...extra })
const visit = (id, at, items, extra = {}) => ({ id, at, tech: 'Marco', items, miles: null, decisions: {}, ...extra })

test('the same car is found by VIN, or by customer plus a matching description', () => {
  const a = { customerName: 'Dana Ruiz', vehicle: '2018 Toyota Camry', vin: '4T1B11HK5JU123456' }
  assert.equal(h.sameVehicle(a, { customerName: 'x', vehicle: 'whatever', vin: '4t1b11hk5ju123456' }), true)
  assert.equal(h.sameVehicle(a, { customerName: 'x', vehicle: '2018 Toyota Camry', vin: '4T1B11HK5JU999999' }), false)
  assert.equal(h.sameVehicle({ customerName: 'Dana Ruiz', vehicle: '2018 Toyota Camry' }, { customerName: 'walk-in: dana ruiz', vehicle: '2018 Toyota Camry LE' }), true)
  assert.equal(h.sameVehicle({ customerName: 'Dana Ruiz', vehicle: '2018 Camry' }, { customerName: 'Dana Ruiz', vehicle: '2018 Toyota Camry LE' }), true)
  // two different people with the same model are two cars
  assert.equal(h.sameVehicle({ customerName: 'Dana Ruiz', vehicle: '2018 Toyota Camry' }, { customerName: 'Sam Lee', vehicle: '2018 Toyota Camry' }), false)
  assert.equal(h.sameVehicle({ customerId: 'c1', customerName: 'A', vehicle: '2018 Toyota Camry' }, { customerId: 'c2', customerName: 'A', vehicle: '2018 Toyota Camry' }), false)
  assert.equal(h.sameVehicle({ customerId: 'c1', customerName: 'A', vehicle: '2018 Toyota Camry' }, { customerId: 'c1', customerName: 'B', vehicle: '2018 Toyota Camry' }), true)
  // a different car for the same customer
  assert.equal(h.sameVehicle({ customerName: 'Dana Ruiz', vehicle: '2018 Toyota Camry' }, { customerName: 'Dana Ruiz', vehicle: '2012 Honda Civic' }), false)
  assert.equal(h.sameVehicle({ customerName: 'Dana Ruiz', vehicle: '' }, { customerName: 'Dana Ruiz', vehicle: '' }), false)
})

test('odometer text becomes miles, junk becomes nothing', () => {
  assert.equal(h.milesOf('84,210'), 84210)
  assert.equal(h.milesOf('84210 mi'), 84210)
  assert.equal(h.milesOf(''), null)
  assert.equal(h.milesOf('abc'), null)
  assert.equal(h.milesOf('0'), null)
  assert.equal(h.milesOf('9999999'), null)
})

test('earlier visits are newest first and never include this one', () => {
  const all = [visit('a', '2026-01-10T10:00:00Z', []), visit('b', '2026-03-10T10:00:00Z', []), visit('c', '2026-05-10T10:00:00Z', []), visit('d', '2026-07-10T10:00:00Z', [])]
  assert.deepEqual(h.earlierVisits(all[2], all).map(v => v.id), ['b', 'a'])
  assert.deepEqual(h.earlierVisits(all[0], all).map(v => v.id), [])
})

test('what changed since the last visit: worse, new, still open, declined, better, fixed', () => {
  const prior = visit('p', '2026-01-01T00:00:00Z', [
    di('Front brake pads', 'y'), di('Rear brake pads', 'g'), di('Wipers', 'r'), di('Battery', 'r'), di('Coolant', 'y'), di('Belts', 'g'),
  ], { decisions: { 'x-battery': 'declined' } })
  prior.items[3].i = 'x-battery'
  const now = visit('n', '2026-07-01T00:00:00Z', [
    di('Front brake pads', 'r'), di('Rear brake pads', 'g'), di('Wipers', 'g'), di('Battery', 'r', { i: 'y-battery' }), di('Coolant', 'y'), di('Belts', 'g'), di('Headlights', 'y'), di('Exhaust', 'g'),
  ])
  const c = h.compareVisits(prior, now)
  assert.deepEqual(c.map(x => [x.name, x.kind]), [
    ['Front brake pads', 'worse'], ['Headlights', 'new'], ['Battery', 'declined'], ['Coolant', 'still'], ['Wipers', 'fixed'],
  ])
  assert.equal(c[0].words, 'Was worth watching, now needs work.')
  assert.equal(h.changeSummary(c), '1 got worse, 1 is new, 2 are still open, 1 fixed')
  assert.equal(h.changeSummary([]), '')
})

test('a finding the customer declined last time is called out', () => {
  const prior = visit('p', '2026-01-01T00:00:00Z', [di('Battery', 'r', { i: 'full-0-7' })], { decisions: { 'full-0-7': 'declined' } })
  const now = visit('n', '2026-07-01T00:00:00Z', [di('Battery', 'r', { i: 'full-0-7' })])
  const c = h.compareVisits(prior, now)
  assert.equal(c[0].kind, 'declined')
  assert.match(c[0].words, /said no last time/)
})

test('lines match by group and name, falling back to the name alone, whatever the capitals', () => {
  const prior = visit('p', '2026-01-01T00:00:00Z', [{ s: 'Brakes', n: 'Front brake pads', r: 'g' }])
  const now = visit('n', '2026-07-01T00:00:00Z', [{ s: 'Brakes and tires', n: 'FRONT   brake pads', r: 'r' }])
  assert.equal(h.compareVisits(prior, now)[0].kind, 'worse')
})

test('tread and pad readings are compared with the miles driven', () => {
  const prior = visit('p', '2026-01-01T00:00:00Z', [di('Left front tire', 'g', { m: { kind: 'tread', value: 8 } })], { miles: 40000 })
  const now = visit('n', '2026-07-01T00:00:00Z', [di('Left front tire', 'y', { m: { kind: 'tread', value: 5 } })], { miles: 46000 })
  const c = h.compareVisits(prior, now)[0]
  assert.equal(c.kind, 'worse')
  assert.equal(c.reading.before, '8/32 in')
  assert.equal(c.reading.now, '5/32 in')
  assert.equal(c.reading.plan.lost, 3)
  assert.match(c.reading.wear, /Down 3\/32 in in 6,000 miles/)
  // good and wearing, no rating change, still shown
  const slow = visit('s', '2026-07-01T00:00:00Z', [di('Left front tire', 'g', { m: { kind: 'tread', value: 6 } })], { miles: 46000 })
  const c2 = h.compareVisits(prior, slow)
  assert.equal(c2.length, 1)
  assert.equal(c2[0].words, 'Good, but wearing.')
  // tiny change on a good line is left out
  const tiny = visit('t', '2026-07-01T00:00:00Z', [di('Left front tire', 'g', { m: { kind: 'tread', value: 7.5 } })])
  assert.equal(h.compareVisits(prior, tiny).length, 0)
})

test('the trend for one tire lists the readings from oldest to newest', () => {
  const vs = [
    visit('c', '2026-07-01T00:00:00Z', [di('Left front tire', 'y', { m: { kind: 'tread', value: 4 } })], { miles: 60000 }),
    visit('a', '2025-01-01T00:00:00Z', [di('Left front tire', 'g', { m: { kind: 'tread', value: 9 } })], { miles: 30000 }),
    visit('b', '2026-01-01T00:00:00Z', [di('Left front tire', 'g', { m: { kind: 'tread', value: 7 } })]),
    visit('d', '2026-08-01T00:00:00Z', [di('Right front tire', 'g')]),
  ]
  const t = h.measureTrend(vs, 'left front TIRE')
  assert.deepEqual(t.map(p => p.value), [9, 7, 4])
  assert.deepEqual(t.map(p => p.miles), [30000, null, 60000])
  assert.equal(t[2].word, 'Wearing: plan to replace')
})

test('the line under the history heading is plain', () => {
  const fmt = iso => iso.slice(0, 10)
  assert.equal(h.lastVisitWords(null, fmt), 'No earlier inspection of this vehicle.')
  assert.equal(h.lastVisitWords(visit('p', '2026-05-03T00:00:00Z', [di('A', 'r'), di('B', 'y'), di('C', 'g')]), fmt), 'Last visit 2026-05-03, Marco. 1 needed work, 1 to watch.')
  assert.equal(h.lastVisitWords(visit('p', '2026-05-03T00:00:00Z', [di('A', 'g')], { tech: '' }), fmt), 'Last visit 2026-05-03. Everything checked was good.')
})
