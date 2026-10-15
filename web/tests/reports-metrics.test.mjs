import test from 'node:test'
import assert from 'node:assert/strict'
import { PAYMENTS, THIS_MONTH, TODAY, allDocs, RAW } from './helpers-reports.mjs'
import { docFrom } from '../src/lib/report-docs.ts'
import { aging, summarize } from '../src/lib/reports.ts'
import {
  approvalStats, carCount, cashVsAccrual, categoryOf, customerKey, docsById, effectiveLaborRate, grossProfit, owedByCustomer,
  repeatVisits, revenueMix, salesByAdvisor, salesByCategory, salesByTech, salesExTax, NOT_RECORDED, OTHER_WORK,
} from '../src/lib/report-metrics.ts'

const docs = allDocs()
const OCT = THIS_MONTH
const SEPT = { from: '2026-09-01', to: '2026-09-30' }

test('sales by advisor are before tax, and paperwork with nobody named is shown as not recorded', () => {
  const rows = salesByAdvisor(docs, OCT)
  assert.deepEqual(rows.map(r => [r.label, r.amount, r.count]), [['Dana', 582, 3], [NOT_RECORDED, 30, 1]])
  // The numbers can be opened: each row knows its invoices.
  assert.deepEqual(rows[0].ids.sort(), ['d-1001', 'd-1002', 'd-1005'])
  assert.equal(salesExTax(docs.find(d => d.id === 'd-1001')), 410)
})

test('advisor names that differ only in case or spacing are one person', () => {
  const a = docFrom({ ...RAW.brakes, id: 'x1', cashier: 'dana ' })
  const b = docFrom({ ...RAW.brakes, id: 'x2', cashier: 'DANA' })
  const rows = salesByAdvisor([a, b], OCT)
  assert.equal(rows.length, 1); assert.equal(rows[0].count, 2); assert.equal(rows[0].amount, 820)
})

test('sales by technician use labor lines; flat lines add dollars but no hours', () => {
  const rows = salesByTech(docs, OCT)
  assert.deepEqual(rows.map(r => [r.label, r.amount, r.hours, r.count]), [['Sam', 200, 2, 1], ['Lee', 115, 1, 2]])
  // A line that names nobody is its own row at the end, never dropped.
  const anon = docFrom({ id: 'z', type: 'Invoice', status: 'Paid', doc_date: '2026-10-03', labors: [{ operation: 'Alignment', hours: 1, rate: 80 }], parts: [] })
  const withAnon = salesByTech([...docs, anon], OCT)
  assert.equal(withAnon.at(-1).label, 'No technician named'); assert.equal(withAnon.at(-1).amount, 80)
})

test('effective labor rate is dollars per hour actually billed, from hourly lines only', () => {
  const r = effectiveLaborRate(docs, OCT, 100)
  assert.equal(r.hours, 3); assert.equal(r.hourlyAmount, 290); assert.equal(r.rate, 96.67)
  assert.equal(r.flatLines, 1); assert.equal(r.flatAmount, 25)
  assert.equal(r.coveragePct, 92)
  assert.equal(r.posted, 100); assert.equal(r.gap, 3.33)
  assert.equal(effectiveLaborRate(docs, OCT).gap, null, 'no posted rate, no gap')
  const none = effectiveLaborRate([docs.find(d => d.id === 'd-0900')], { from: '2026-08-01', to: '2026-08-31' })
  assert.equal(none.rate, null, 'a shop with only flat-priced labor has no per hour rate')
  assert.equal(none.flatAmount, 150)
})

test('cars serviced counts each car once and says which were assumed', () => {
  const c = carCount(docs, OCT)
  assert.equal(c.orders, 4)
  assert.equal(c.cars, 3, 'the Camry, the Civic (two invoices, one car) and the receipt with no car named')
  assert.equal(c.carsAssumed, 1)
})

test('new and returning customers are judged against every invoice the shop has', () => {
  const c = carCount(docs, OCT)
  assert.equal(c.newCustomers, 1, 'James Carter was first billed this month')
  assert.equal(c.returningCustomers, 1, 'Maria Lopez was billed on Sep 28')
  assert.equal(c.unknownOrders, 1, 'the walk-in receipt can be neither')
  assert.deepEqual(c.newIds.sort(), ['d-1002', 'd-1005'])
  assert.deepEqual(c.returningIds, ['d-1001'])
  // Looking only at this month's invoices would call Maria new. Leaving old invoices out is the mistake this guards against.
  const wrong = carCount(docs.filter(d => d.date >= OCT.from), OCT)
  assert.equal(wrong.newCustomers, 2)
})

test('gross profit counts only costs that were written down and says how many jobs are incomplete', () => {
  const p = grossProfit(docs, OCT)
  assert.equal(p.revenue, 612); assert.equal(p.partsCost, 112); assert.equal(p.gross, 500); assert.equal(p.marginPct, 82)
  assert.equal(p.partLines, 5); assert.equal(p.partsCosted, 4)
  assert.equal(p.incomplete, 1)
  assert.equal(p.basis, 'parts'); assert.equal(p.laborCost, null)
  const byId = Object.fromEntries(p.jobs.map(j => [j.id, j]))
  assert.equal(byId['d-1001'].gross, 315); assert.equal(byId['d-1001'].marginPct, 77); assert.equal(byId['d-1001'].complete, true)
  assert.equal(byId['d-1002'].gross, 122); assert.equal(byId['d-1002'].complete, false, 'the synthetic oil has no cost')
  assert.equal(byId['d-1005'].marginPct, 100)
  assert.equal(byId['d-1008'].partsCost, 12)
})

test('gross profit can include labor cost when the shop gives a cost per hour', () => {
  const p = grossProfit(docs, OCT, { laborCostPerHour: 40 })
  assert.equal(p.laborCost, 120); assert.equal(p.gross, 380); assert.equal(p.basis, 'parts-and-labor')
  const oil = p.jobs.find(j => j.id === 'd-1002')
  assert.equal(oil.laborCost, 20); assert.equal(oil.laborCostComplete, false, 'the flat inspection line has no hours to cost')
  assert.equal(grossProfit(docs, OCT, { laborCostPerHour: 0 }).basis, 'parts')
})

test('sublet and core charges pass through and do not count as revenue', () => {
  const p = grossProfit(docs, SEPT)
  const alt = p.jobs.find(j => j.id === 'd-1003')
  assert.equal(alt.revenue, 460, 'labor 250 plus parts 210; sublet 40 and core 30 are handed on')
  assert.equal(p.passedThrough, 70)
})

test('kinds of work group lines by the words on them, and the leftovers are listed so the rules can improve', () => {
  const c = salesByCategory(docs, OCT)
  assert.deepEqual(c.slices.map(s => [s.label, s.amount]), [
    ['Brakes', 400], ['Oil changes and fluids', 147], ['Wipers, glass and body', 30], ['Diagnostics and inspection', 25], ['Shop supplies, sublet and core charges', 10],
  ])
  assert.equal(c.slices.reduce((s, x) => s + x.amount, 0), 612, 'every dollar before tax lands in a row')
  assert.deepEqual(c.other, [])
  const odd = salesByCategory([docFrom({ ...RAW.oil, id: 'q', labors: [{ operation: 'Mystery noise', amount: 99 }], parts: [] })], OCT)
  assert.equal(odd.slices[0].label, OTHER_WORK)
  assert.deepEqual(odd.other, [{ name: 'Mystery noise', amount: 99 }])
})

test('work is named by the kind of repair, not the first word that happens to match', () => {
  const cases = {
    'Replace front brake pads': 'Brakes', 'Wheel bearing replacement': 'Alignment, suspension and steering', 'Engine mount': 'Engine',
    'Tire rotation and balance': 'Tires and wheels', 'A/C recharge': 'Air conditioning and heating', 'Oil change': 'Oil changes and fluids',
    'Check engine light diagnosis': 'Diagnostics and inspection', 'Replace alternator': 'Battery, charging and electrical', 'Timing belt': 'Engine',
    'Water pump': 'Cooling system', 'Catalytic converter': 'Exhaust and emissions', 'Replace clutch': 'Transmission and drivetrain',
    'Coolant flush': 'Oil changes and fluids', 'Tune up': OTHER_WORK, '': OTHER_WORK,
  }
  for (const [name, want] of Object.entries(cases)) assert.equal(categoryOf(name), want, name)
})

test('the revenue mix matches the invoice totals to the cent', () => {
  const m = revenueMix(docs, OCT)
  assert.deepEqual(m, { labor: 315, parts: 287, supplies: 10, sublet: 0, core: 0, other: 0, tax: 24.51, total: 636.51 })
  assert.equal(m.labor + m.parts + m.supplies + m.sublet + m.core + m.other + m.tax, m.total)
  const s = revenueMix(docs, SEPT)
  assert.equal(s.core, 30); assert.equal(s.sublet, 40)
  // Older documents with no itemised fees still balance: everything not labor, parts or tax goes in "other".
  const legacy = [{ ...docs[0], supplies: undefined, sublet: undefined, core: undefined, fees: 10 }]
  const l = revenueMix(legacy, OCT)
  assert.equal(l.other, 10)
})

test('approval rate counts online approvals only and says what is still waiting', () => {
  const sept = approvalStats(docs, SEPT, TODAY)
  assert.equal(sept.sent, 1); assert.equal(sept.approved, 1); assert.equal(sept.ratePct, 100); assert.equal(sept.approvedTotal, 427.33)
  const oct = approvalStats(docs, OCT, TODAY)
  assert.equal(oct.sent, 1); assert.equal(oct.approved, 0); assert.equal(oct.ratePct, 0)
  assert.equal(oct.waiting, 1); assert.equal(oct.waitingOld, 0)
  assert.equal(approvalStats(docs, OCT, '2026-10-20').waitingOld, 1, 'waiting more than a week')
  assert.equal(approvalStats(docs, { from: '2026-01-01', to: '2026-01-31' }, TODAY).ratePct, null, 'nothing sent, no percentage')
})

test('repeat visits: the same car back within 30 days, routine service left out', () => {
  const r = repeatVisits(docs, OCT)
  assert.equal(r.considered, 3); assert.equal(r.count, 1); assert.equal(r.ratePct, 33.3)
  assert.equal(r.list[0].doc.id, 'd-1001'); assert.equal(r.list[0].previous.id, 'd-1004'); assert.equal(r.list[0].days, 4)
  const all = repeatVisits(docs, OCT, { skipRoutine: false })
  assert.equal(all.count, 2)
  assert.equal(repeatVisits(docs, OCT, { withinDays: 3 }).count, 0)
  assert.equal(repeatVisits([], OCT).ratePct, null)
})

test('who owes what is the same money as the aging report', () => {
  const owed = owedByCustomer(docs, TODAY)
  assert.equal(owed.length, 1)
  assert.deepEqual([owed[0].name, owed[0].amount, owed[0].count, owed[0].oldestDays, owed[0].phone, owed[0].email], ['Priya Shah', 450.63, 1, 24, '555-0103', 'priya@example.com'])
  assert.equal(owed.reduce((s, c) => s + c.amount, 0), aging(docs, TODAY).total)
})

test('billed against received explains the gap in plain words', () => {
  const sept = summarize(docs, PAYMENTS, SEPT)
  const c = cashVsAccrual(sept.invoiced, sept.collected)
  assert.equal(c.billed, 731.82); assert.equal(c.received, 281.19); assert.equal(c.gap, 450.63)
  assert.match(c.words, /billed \$451 more than you received/)
  assert.match(cashVsAccrual(100, 400).words, /received \$300 more than you billed/)
  assert.match(cashVsAccrual(100, 100.2).words, /about the same/)
})

test('customers are the record when there is one, else the written name; walk-ins have none', () => {
  assert.equal(customerKey({ customerId: 'c1', customer: 'Anyone' }), 'c1')
  assert.equal(customerKey({ customerId: null, customer: '  Maria   Lopez ' }), 'maria lopez')
  assert.equal(customerKey({ customerId: null, customer: 'Walk-in' }), '')
  assert.equal(customerKey({ customerId: null, customer: '' }), '')
})

test('the documents behind a number come back newest first', () => {
  assert.deepEqual(docsById(docs, ['d-1002', 'd-1005', 'd-1001']).map(d => d.id), ['d-1005', 'd-1002', 'd-1001'])
  assert.deepEqual(docsById(docs, []), [])
})

test('drafts, voids and estimates never count as sales anywhere', () => {
  for (const f of [salesByAdvisor, salesByCategory, salesByTech]) {
    const text = JSON.stringify(f(docs, OCT))
    assert.ok(!text.includes('d-1006') && !text.includes('d-1007') && !text.includes('e-2001'), f.name)
  }
  assert.equal(carCount(docs, OCT).orders, 4)
  assert.equal(grossProfit(docs, OCT).jobs.length, 4)
})
