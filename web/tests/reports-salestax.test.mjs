import test from 'node:test'
import assert from 'node:assert/strict'
import { THIS_MONTH, allDocs, RAW } from './helpers-reports.mjs'
import { docFrom } from '../src/lib/report-docs.ts'
import { normalizeComponents, splitCents, taxByPeriod, taxReport, taxableOf, totalRate } from '../src/lib/sales-tax.ts'

const docs = allDocs()
const COMPONENTS = normalizeComponents([
  { name: 'State', ratePct: 6.25, agency: 'State comptroller' },
  { name: 'City', ratePct: 1, agency: 'City' },
  { name: 'Transit', ratePct: 1, agency: 'Transit authority' },
])

test('what the shop typed is tidied and bad rows are dropped, not guessed at', () => {
  const out = normalizeComponents([
    { name: '  State \n tax ', ratePct: '6.25', agency: ' Comptroller ' },
    { name: '', ratePct: 1 }, { name: 'Negative', ratePct: -1 }, { name: 'Huge', ratePct: 40 }, { name: 'Nan', ratePct: 'x' }, null, 'text',
    { name: 'Local', rate: 2 },
  ])
  assert.deepEqual(out, [{ name: 'State tax', ratePct: 6.25, agency: 'Comptroller' }, { name: 'Local', ratePct: 2, agency: '' }])
  assert.deepEqual(normalizeComponents('nope'), []); assert.deepEqual(normalizeComponents(undefined), [])
  assert.equal(normalizeComponents(Array.from({ length: 30 }, (_, i) => ({ name: `T${i}`, ratePct: 1 }))).length, 12)
  assert.equal(totalRate(COMPONENTS), 8.25)
})

test('tax is split to the cent and the pieces always add back to what was charged', () => {
  assert.deepEqual(splitCents(10, [1, 1, 1]), [3.34, 3.33, 3.33])
  assert.deepEqual(splitCents(0.01, [1, 1]), [0.01, 0])
  assert.deepEqual(splitCents(5, []), [])
  assert.deepEqual(splitCents(5, [0, 0]), [0, 0])
  let seed = 7
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  for (let i = 0; i < 500; i++) {
    const total = Math.round(rnd() * 100000) / 100
    const rates = [6.25, 1, 0.5 + rnd(), 2].slice(0, 2 + Math.floor(rnd() * 3))
    const parts = splitCents(total, rates)
    assert.equal(Math.round(parts.reduce((s, n) => s + n, 0) * 100), Math.round(total * 100), `${total} split ${rates}`)
    const sum = rates.reduce((s, r) => s + r, 0)
    parts.forEach((p, k) => assert.ok(Math.abs(p - (total * rates[k]) / sum) < 0.0101, 'each piece within a cent of its share'))
  }
})

test('the report adds up what was billed, what was taxable and what was charged', () => {
  const t = taxReport(docs, THIS_MONTH, COMPONENTS)
  assert.equal(t.configured, true)
  assert.equal(t.sales, 612); assert.equal(t.taxable, 297); assert.equal(t.nonTaxable, 315); assert.equal(t.tax, 24.51); assert.equal(t.invoices, 4)
  assert.equal(Math.round(t.byComponent.reduce((s, c) => s + c.tax, 0) * 100), 2451, 'the authorities add back to the tax charged')
  const [state, city, transit] = t.byComponent
  assert.equal(state.name, 'State'); assert.ok(state.tax > city.tax); assert.equal(city.tax, transit.tax)
  assert.deepEqual(t.untaxed, { count: 1, ids: ['d-1005'] })
  assert.equal(t.ratesDiffer.count, 0)
})

test('invoices charged at a different rate than the shop set are listed, not hidden', () => {
  const t = taxReport(docs, THIS_MONTH, normalizeComponents([{ name: 'State', ratePct: 6.25 }, { name: 'City', ratePct: 0.75 }]))
  assert.equal(t.ratesDiffer.count, 3)
  assert.deepEqual(t.ratesDiffer.rates, [8.25])
  assert.equal(Math.round(t.byComponent.reduce((s, c) => s + c.tax, 0) * 100), 2451, 'still splits what was charged')
})

test('with no split saved the totals still show and the screen is told it is not set up', () => {
  const t = taxReport(docs, THIS_MONTH, [])
  assert.equal(t.configured, false); assert.equal(t.tax, 24.51); assert.deepEqual(t.byComponent, [])
})

test('documents that predate the taxable amount work it back from tax and rate', () => {
  const d = { ...docs[0], taxable: undefined, taxRate: 8.25, tax: 8.25 }
  assert.equal(taxableOf(d), 100)
  assert.equal(taxableOf({ ...d, taxRate: 0 }), 0)
  assert.equal(taxableOf({ ...d, tax: 0 }), 0)
  assert.equal(taxableOf(docs[0]), 210, 'the recorded amount is used when there is one')
})

test('filing periods: months and calendar quarters, oldest first, only those with invoices', () => {
  const range = { from: '2026-07-01', to: '2026-10-14' }
  const q = taxByPeriod(docs, range, COMPONENTS, 'quarter')
  assert.deepEqual(q.map(r => [r.label, r.tax, r.invoices]), [['2026 Q3', 29.63, 3], ['2026 Q4', 24.51, 4]])
  const m = taxByPeriod(docs, { from: '2026-08-01', to: '2026-10-14' }, COMPONENTS, 'month')
  assert.deepEqual(m.map(r => [r.label, r.tax]), [['August 2026', 2.81], ['September 2026', 26.82], ['October 2026', 24.51]])
  assert.equal(taxByPeriod(docs, { from: '2020-01-01', to: '2020-12-31' }, COMPONENTS, 'month').length, 0)
  // The periods add to the one-range report.
  const whole = taxReport(docs, range, COMPONENTS)
  assert.equal(Math.round(q.reduce((s, r) => s + r.tax, 0) * 100), Math.round(whole.tax * 100))
})

test('drafts, voids and estimates are not in the tax report', () => {
  const d = docFrom({ ...RAW.brakes, id: 'draft1', status: 'Draft' })
  const v = docFrom({ ...RAW.brakes, id: 'void1', status: 'Void' })
  assert.equal(taxReport([d, v], THIS_MONTH, COMPONENTS).invoices, 0)
})
