import test from 'node:test'
import assert from 'node:assert/strict'
import * as r from '../src/lib/repair-ui.ts'

test('parseTotal reads typed dollar amounts and refuses anything that is not above zero', () => {
  assert.equal(r.parseTotal('430'), 430)
  assert.equal(r.parseTotal(' $1,200.50 '), 1200.5)
  assert.equal(r.parseTotal('99.99'), 99.99)
  assert.equal(r.parseTotal(''), null)
  assert.equal(r.parseTotal('   '), null)
  assert.equal(r.parseTotal('0'), null)
  assert.equal(r.parseTotal('-20'), null)
  assert.equal(r.parseTotal('abc'), null)
  assert.equal(r.parseTotal('Infinity'), null)
})

test('allocateTotal splits to the cent and the pieces always add back to the total', () => {
  assert.deepEqual(r.allocateTotal(100, 4), [25, 25, 25, 25])
  assert.deepEqual(r.allocateTotal(100, 3), [33.34, 33.33, 33.33])
  for (const [total, count] of [[430, 3], [0.05, 4], [1234.56, 7], [10, 0]]) {
    const parts = r.allocateTotal(total, count)
    assert.equal(parts.length, Math.max(1, count))
    assert.equal(Math.round(parts.reduce((a, b) => a + b, 0) * 100), Math.round(total * 100))
  }
})

test('draftForTotal spreads a typed total over the labor lines, else over every line that is not a part', () => {
  const draft = { targetTotal: null, totalLocked: false, parts: [{ n: 1 }], labors: [], notes: 'Base notes.' }
  const lines = [
    { kind: 'labor', label: 'Diagnose P0420', sourceStatus: 'needs_source', risk: 'standard' },
    { kind: 'labor', label: 'Test oxygen sensors', sourceStatus: 'source_candidate', risk: 'elevated' },
    { kind: 'parts', label: 'Oxygen sensor', sourceStatus: 'needs_source', risk: 'standard' },
  ]
  const out = r.draftForTotal(draft, lines, '$300')
  assert.equal(out.targetTotal, 300)
  assert.equal(out.totalLocked, true)
  assert.deepEqual(out.parts, [])
  assert.deepEqual(out.labors.map(l => l.operation), ['Diagnose P0420', 'Test oxygen sensors'])
  assert.deepEqual(out.labors.map(l => l.amount), [150, 150])
  assert.equal(out.labors[1].pricing, 'flat')
  assert.equal(out.labors[1].risk, 'elevated')
  assert.match(out.notes, /^Base notes\.\nLocked total entered in Repair Workspace: \$300\.00\.$/)

  const noLabor = r.draftForTotal(draft, [lines[2], { kind: 'inspection', label: 'Inspect exhaust', sourceStatus: 'needs_source', risk: 'standard' }], '80')
  assert.deepEqual(noLabor.labors.map(l => l.operation), ['Inspect exhaust'])
  assert.equal(noLabor.labors[0].amount, 80)

  // Only parts to price: the whole total goes on one labor line, so the estimate is never saved empty.
  const none = r.draftForTotal(draft, [lines[2]], '45', 'Diagnose P0420')
  assert.equal(none.labors.length, 1)
  assert.equal(none.labors[0].operation, 'Diagnose P0420')
  assert.equal(none.labors[0].amount, 45)
  assert.equal(r.draftForTotal(draft, [], '45').labors[0].operation, 'Repair labor')
})

test('draftForTotal hands back the same draft when there is no usable total', () => {
  const draft = { targetTotal: 200, totalLocked: true, parts: [], labors: [{ operation: 'x', amount: 200 }], notes: 'n' }
  assert.equal(r.draftForTotal(draft, [], ''), draft)
  assert.equal(r.draftForTotal(draft, [], 'nope'), draft)
  assert.equal(r.draftForTotal(draft, [], '0'), draft)
})

test('splitList takes commas or one item per line and drops blanks', () => {
  assert.deepEqual(r.splitList('Scan tool, torque wrench\n\n  pullers  \r\njack stands,'), ['Scan tool', 'torque wrench', 'pullers', 'jack stands'])
  assert.deepEqual(r.splitList(''), [])
})

test('vehicleLabel names the car and says so when it cannot', () => {
  assert.equal(r.vehicleLabel({ year: '2012', make: 'Honda', model: 'Accord', engine: '2.4L' }), '2012 Honda Accord 2.4L')
  assert.equal(r.vehicleLabel({}), 'Vehicle not fully identified')
  assert.equal(r.vehicleLabel(null), 'Vehicle not fully identified')
})

test('plainLabel turns Title Case wording into sentence case', () => {
  assert.equal(r.plainLabel('Open Fuse/Relay Info'), 'Open fuse/relay info')
  assert.equal(r.plainLabel('Open Specs'), 'Open specs')
  assert.equal(r.plainLabel('Pick Engine First'), 'Pick the engine first')
  assert.equal(r.plainLabel('What To Check First'), 'What to check first')
  assert.equal(r.plainLabel('Open OEM1Stop page'), 'Open OEM1Stop page')
  assert.equal(r.plainLabel('Open the info'), 'Open the info')
})

test('proxiedImage sends manual images through our own address', () => {
  assert.equal(r.proxiedImage('https://charm.li/a b.jpg'), '/api/repair-image?url=https%3A%2F%2Fcharm.li%2Fa%20b.jpg')
})
