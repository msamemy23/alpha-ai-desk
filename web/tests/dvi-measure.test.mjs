import test from 'node:test'
import assert from 'node:assert/strict'
import * as m from '../src/lib/dvi-measure.ts'

test('tread depth earns a lamp and always a word', () => {
  const r = v => m.rateMeasure({ kind: 'tread', value: v })
  assert.deepEqual([r(8).rating, r(8).word], ['green', 'Good tread'])
  assert.deepEqual([r(6).rating, r(6).word], ['green', 'Good tread'])
  assert.deepEqual([r(5).rating, r(5).word], ['yellow', 'Wearing: plan to replace'])
  assert.deepEqual([r(4).rating], ['yellow'])
  assert.deepEqual([r(3).rating, r(3).word], ['red', 'Replace soon'])
  assert.deepEqual([r(2).rating, r(2).word], ['red', 'Below the legal minimum: replace'])
  assert.equal(r(1).rating, 'red')
  assert.equal(r(4).text, '4/32 in')
  assert.equal(r(4.5).text, '4.5/32 in')
})

test('brake pad thickness: thin is yellow, near metal is red, with words', () => {
  const r = v => m.rateMeasure({ kind: 'pad', value: v })
  assert.equal(r(9).rating, 'green')
  assert.equal(r(6).rating, 'green')
  assert.deepEqual([r(5).rating, r(5).word], ['yellow', 'Getting thin'])
  assert.deepEqual([r(4).rating, r(4).word], ['yellow', 'Getting thin'])
  assert.deepEqual([r(3).rating, r(3).word], ['red', 'Replace pads'])
  assert.deepEqual([r(1.5).rating, r(1.5).word], ['red', 'Replace now: metal contact risk'])
  assert.equal(r(3.5).text, '3.5 mm')
})

test('a rotor and a tire pressure can only be rated against a number the tech typed', () => {
  const rotor = { kind: 'rotor', value: 22 }
  assert.equal(m.rateMeasure(rotor).rating, null)
  assert.match(m.rateMeasure(rotor).word, /minimum/)
  assert.equal(m.rateMeasure({ ...rotor, spec: 21 }).rating, 'green') // 1.0 above the minimum is more than the 0.8 warning band
  assert.equal(m.rateMeasure({ kind: 'rotor', value: 21.5, spec: 21 }).rating, 'yellow')
  assert.equal(m.rateMeasure({ kind: 'rotor', value: 22.5, spec: 21 }).rating, 'green')
  assert.equal(m.rateMeasure({ kind: 'rotor', value: 20.9, spec: 21 }).rating, 'red')
  assert.equal(m.rateMeasure({ kind: 'pressure', value: 30 }).rating, null)
  assert.deepEqual([m.rateMeasure({ kind: 'pressure', value: 33, spec: 35 }).rating, m.rateMeasure({ kind: 'pressure', value: 33, spec: 35 }).word], ['green', 'Correct'])
  assert.equal(m.rateMeasure({ kind: 'pressure', value: 29, spec: 35 }).word, '6 psi low')
  assert.equal(m.rateMeasure({ kind: 'pressure', value: 29, spec: 35 }).rating, 'yellow')
  assert.equal(m.rateMeasure({ kind: 'pressure', value: 20, spec: 35 }).rating, 'red')
  assert.match(m.rateMeasure({ kind: 'pressure', value: 44, spec: 35 }).word, /high/)
})

test('nonsense readings are dropped, readings are tidied, the lowest of three is kept', () => {
  assert.equal(m.cleanMeasure(null), undefined)
  assert.equal(m.cleanMeasure({ kind: 'tire', value: 3 }), undefined)
  assert.equal(m.cleanMeasure({ kind: 'tread', value: -1 }), undefined)
  assert.equal(m.cleanMeasure({ kind: 'tread', value: 99 }), undefined)
  assert.equal(m.cleanMeasure({ kind: 'tread', value: 'abc' }), undefined)
  assert.deepEqual(m.cleanMeasure({ kind: 'tread', value: '4.26' }), { kind: 'tread', value: 4.3 })
  assert.deepEqual(m.cleanMeasure({ kind: 'tread', readings: [6, 3, 5] }), { kind: 'tread', value: 3, readings: [6, 3, 5] })
  assert.equal(m.cleanMeasure({ kind: 'tread', readings: [6, 'x', 5] }), undefined)
  assert.deepEqual(m.cleanMeasure({ kind: 'pad', value: 5, spec: 4 }), { kind: 'pad', value: 5 }) // spec only matters for rotors and pressure
  assert.deepEqual(m.cleanMeasure({ kind: 'rotor', value: 22, spec: '21.0' }), { kind: 'rotor', value: 22, spec: 21 })
})

test('uneven wear is called out when the edges differ by 3/32 or more', () => {
  assert.equal(m.unevenWear({ kind: 'tread', value: 3, readings: [3, 6, 5] }), true)
  assert.equal(m.unevenWear({ kind: 'tread', value: 5, readings: [5, 6, 6] }), false)
  assert.equal(m.unevenWear({ kind: 'tread', value: 5 }), false)
})

test('the line on a checklist decides which measurement fits', () => {
  assert.equal(m.measureKindFor('Left front tire'), 'tread')
  assert.equal(m.measureKindFor('Tires'), 'tread')
  assert.equal(m.measureKindFor('Front brake pads'), 'pad')
  assert.equal(m.measureKindFor('Brake pads'), 'pad')
  assert.equal(m.measureKindFor('Front rotors'), 'rotor')
  assert.equal(m.measureKindFor('Tire pressure'), null)
  assert.equal(m.measureKindFor('Spare tire'), null)
  assert.equal(m.measureKindFor('Engine oil'), null)
})

test('a reading can make a rating worse but never better', () => {
  assert.equal(m.ratingAfterMeasure(null, { kind: 'tread', value: 3 }), 'red')
  assert.equal(m.ratingAfterMeasure('green', { kind: 'tread', value: 3 }), 'red')
  assert.equal(m.ratingAfterMeasure('yellow', { kind: 'tread', value: 3 }), 'red')
  assert.equal(m.ratingAfterMeasure('red', { kind: 'tread', value: 8 }), null) // keep the tech's red
  assert.equal(m.ratingAfterMeasure('yellow', { kind: 'tread', value: 8 }), null)
  assert.equal(m.ratingAfterMeasure(null, { kind: 'rotor', value: 22 }), null) // not enough to judge
})

test('wear between visits is honest: no rate without miles, no promise without wear', () => {
  const p = m.wearPlan('tread', { value: 8, miles: 40000 }, { value: 6, miles: 48000 })
  assert.deepEqual([p.lost, p.miles, p.per1000, p.milesLeft], [2, 8000, 0.3, 12000])
  assert.equal(m.wearWords('tread', p), 'Down 2/32 in in 8,000 miles. About 12,000 miles until the replace line.')
  const noMiles = m.wearPlan('pad', { value: 9, miles: null }, { value: 6, miles: 50000 })
  assert.deepEqual([noMiles.lost, noMiles.miles, noMiles.per1000, noMiles.milesLeft], [3, null, null, null])
  assert.equal(m.wearWords('pad', noMiles), 'Down 3 mm since the last visit.')
  const short = m.wearPlan('tread', { value: 8, miles: 40000 }, { value: 7, miles: 40300 })
  assert.equal(short.per1000, null) // 300 miles tells nothing
  const same = m.wearPlan('tread', { value: 6, miles: 1000 }, { value: 6, miles: 9000 })
  assert.equal(m.wearWords('tread', same), 'No measurable wear since the last visit.')
  const gone = m.wearPlan('tread', { value: 6, miles: 1000 }, { value: 3, miles: 9000 })
  assert.equal(gone.milesLeft, 0)
  assert.match(m.wearWords('tread', gone), /Already at the replace line/)
  assert.equal(m.wearWords('rotor', p), '')
})
