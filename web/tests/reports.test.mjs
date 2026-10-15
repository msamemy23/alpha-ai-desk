import test from 'node:test'
import assert from 'node:assert/strict'
import * as r from '../src/lib/reports.ts'

const doc = (o = {}) => ({
  id: 'd', type: 'Invoice', status: 'Paid', date: '2026-10-10', customerId: null, customer: 'Maria Lopez',
  total: 100, labor: 60, parts: 30, fees: 0, tax: 10, paid: 100, balance: 0, method: 'cash', ops: [], items: [], hours: [], ...o,
})
const pay = (o = {}) => ({ id: 'p', docId: null, amount: 100, method: 'cash', date: '2026-10-10', customer: 'Maria Lopez', ...o })

test('periods: rolling windows compare with the equal window before', () => {
  const p = r.periodFor('7d', '2026-10-14')
  assert.deepEqual(p.range, { from: '2026-10-08', to: '2026-10-14' })
  assert.deepEqual(p.previous, { from: '2026-10-01', to: '2026-10-07' })
  assert.equal(r.spanDays(p.range), 7)
  assert.equal(r.spanDays(p.previous), 7)
  const q = r.periodFor('90d', '2026-10-14')
  assert.equal(r.spanDays(q.range), 90)
  assert.equal(r.spanDays(q.previous), 90)
  assert.equal(r.addDays(q.range.from, -1), q.previous.to)
})

test('periods: this month is compared with the same days of the month before', () => {
  const p = r.periodFor('month', '2026-10-14')
  assert.deepEqual(p.range, { from: '2026-10-01', to: '2026-10-14' })
  assert.deepEqual(p.previous, { from: '2026-09-01', to: '2026-09-14' })
  // 31 days into a month, the shorter month before is clamped to its last day
  const m = r.periodFor('month', '2026-03-31')
  assert.deepEqual(m.previous, { from: '2026-02-01', to: '2026-02-28' })
})

test('periods: last month and this year', () => {
  assert.deepEqual(r.periodFor('lastmonth', '2026-10-14'), { range: { from: '2026-09-01', to: '2026-09-30' }, previous: { from: '2026-08-01', to: '2026-08-31' } })
  assert.deepEqual(r.periodFor('lastmonth', '2026-01-05').range, { from: '2025-12-01', to: '2025-12-31' })
  const y = r.periodFor('year', '2026-10-14')
  assert.deepEqual(y.range, { from: '2026-01-01', to: '2026-10-14' })
  assert.deepEqual(y.previous, { from: '2025-01-01', to: '2025-10-14' })
  // a leap day maps to the last day of February the year before
  assert.equal(r.periodFor('year', '2028-02-29').previous.to, '2027-02-28')
})

test('days: stepping across daylight saving keeps calendar days', () => {
  assert.equal(r.addDays('2026-03-07', 2), '2026-03-09')
  assert.equal(r.addDays('2026-11-01', 1), '2026-11-02')
  assert.equal(r.diffDays('2026-03-01', '2026-04-01'), 31)
  assert.equal(r.diffDays('2026-11-01', '2026-11-01'), 0)
  assert.equal(r.inRange('2026-10-14T23:59:00Z', { from: '2026-10-14', to: '2026-10-14' }), true)
  assert.equal(r.inRange('', { from: '2026-10-14', to: '2026-10-14' }), false)
})

test('range label reads in plain words', () => {
  assert.equal(r.rangeLabel({ from: '2026-10-01', to: '2026-10-14' }), 'Oct 1 to Oct 14, 2026')
  assert.equal(r.rangeLabel({ from: '2025-12-01', to: '2026-01-31' }), 'Dec 1, 2025 to Jan 31, 2026')
  assert.equal(r.rangeLabel({ from: '2026-10-14', to: '2026-10-14' }), 'Oct 14, 2026')
})

test('payment methods are named in plain words', () => {
  assert.equal(r.methodLabel('historical_import'), 'Imported from past records')
  assert.equal(r.methodLabel('Historical Import'), 'Imported from past records')
  assert.equal(r.methodLabel(''), 'Method not recorded')
  assert.equal(r.methodLabel(null), 'Method not recorded')
  assert.equal(r.methodLabel('unspecified'), 'Method not recorded')
  assert.equal(r.methodLabel('Credit Card'), 'Card')
  assert.equal(r.methodLabel('CC'), 'Card')
  assert.equal(r.methodLabel('cash'), 'Cash')
  assert.equal(r.methodLabel('cash_app'), 'Cash App')
  assert.equal(r.methodLabel('store_credit'), 'Store credit')
})

test('only finished invoices and receipts are sales', () => {
  assert.equal(r.isSale(doc()), true)
  assert.equal(r.isSale(doc({ type: 'Receipt', status: 'Paid' })), true)
  assert.equal(r.isSale(doc({ status: 'Draft' })), false)
  assert.equal(r.isSale(doc({ status: ' VOID ' })), false)
  assert.equal(r.isSale(doc({ status: 'Cancelled' })), false)
  assert.equal(r.isSale(doc({ type: 'Estimate' })), false)
})

test('imported payments count on the invoice date, not the import day', () => {
  const d = doc({ id: 'a', date: '2024-05-02', total: 250, paid: 250 })
  const imp = pay({ id: 'p1', docId: 'a', amount: 250, method: 'historical_import', date: '2026-03-20' })
  const real = pay({ id: 'p2', docId: 'a', amount: 40, method: 'cash', date: '2026-10-01' })
  const map = new Map([[d.id, d]])
  assert.equal(r.collectedOn(imp, map), '2024-05-02')
  assert.equal(r.collectedOn(real, map), '2026-10-01')
  // an import with no invoice to lean on keeps its own date
  assert.equal(r.collectedOn(pay({ method: 'historical_import', docId: 'gone', date: '2026-03-20' }), map), '2026-03-20')
  const may = { from: '2024-05-01', to: '2024-05-31' }
  const s = r.summarize([d], [imp, real], may)
  assert.equal(s.collected, 250)
  assert.equal(s.invoiced, 250)
  assert.equal(r.summarize([d], [imp, real], { from: '2026-03-01', to: '2026-03-31' }).collected, 0)
})

test('paid invoices with no payment record still count, once', () => {
  const a = doc({ id: 'a', paid: 120, total: 120, method: 'zelle' })
  const b = doc({ id: 'b', paid: 80, total: 80 })
  const c = doc({ id: 'c', paid: 0, total: 50, balance: 50, status: 'Sent' })
  const d = doc({ id: 'd', paid: 30, status: 'Draft' })
  const got = r.withFallbackPayments([a, b, c, d], [pay({ id: 'p', docId: 'b', amount: 80 })])
  assert.equal(got.length, 2)
  assert.deepEqual(got.map(p => p.docId), ['b', 'a'])
  assert.equal(got[1].amount, 120)
  assert.equal(got[1].method, 'zelle')
  assert.equal(got[1].date, a.date)
  // running it again over the result adds nothing
  assert.equal(r.withFallbackPayments([a, b, c, d], got).length, 2)
})

test('summary skips drafts and voids and averages what was billed', () => {
  const docs = [
    doc({ id: '1', total: 200, labor: 100, parts: 80, fees: 10, tax: 10 }),
    doc({ id: '2', total: 100, labor: 50, parts: 40, fees: 0, tax: 10, type: 'Receipt' }),
    doc({ id: '3', total: 999, status: 'Draft' }),
    doc({ id: '4', total: 999, status: 'Void' }),
    doc({ id: '5', total: 999, date: '2026-09-30' }),
  ]
  const s = r.summarize(docs, [pay({ amount: 60 }), pay({ id: 'p2', amount: 40.555, date: '2026-10-12' }), pay({ id: 'p3', amount: 500, date: '2026-09-01' })], { from: '2026-10-01', to: '2026-10-14' })
  assert.equal(s.invoices, 2)
  assert.equal(s.invoiced, 300)
  assert.equal(s.average, 150)
  assert.equal(s.collected, 100.56)
  assert.equal(s.payments, 2)
  assert.deepEqual([s.labor, s.parts, s.fees, s.tax], [150, 120, 10, 20])
  // an empty period is zero, not NaN
  const none = r.summarize([], [], { from: '2026-10-01', to: '2026-10-14' })
  assert.deepEqual([none.invoiced, none.average, none.collected], [0, 0, 0])
})

test('change is in words and never claims a comparison it cannot make', () => {
  assert.deepEqual(r.change(150, 100), { kind: 'up', pct: 50 })
  assert.deepEqual(r.change(50, 100), { kind: 'down', pct: 50 })
  assert.deepEqual(r.change(100, 100), { kind: 'same', pct: 0 })
  assert.deepEqual(r.change(100.2, 100), { kind: 'same', pct: 0 })
  assert.equal(r.change(100, 0).kind, 'none')
  assert.equal(r.change(0, 0).kind, 'none')
  assert.equal(r.change(0, 100).kind, 'down')
})

test('chart grain follows the length of the range', () => {
  assert.equal(r.grainFor({ from: '2026-10-08', to: '2026-10-14' }), 'day')
  assert.equal(r.grainFor({ from: '2026-09-10', to: '2026-10-14' }), 'day') // 35 days
  assert.equal(r.grainFor({ from: '2026-07-17', to: '2026-10-14' }), 'week')
  assert.equal(r.grainFor({ from: '2026-01-01', to: '2026-10-14' }), 'month')
})

test('daily chart fills empty days with zero', () => {
  const range = { from: '2026-10-08', to: '2026-10-14' }
  const s = r.series(range, [{ date: '2026-10-09', amount: 50 }, { date: '2026-10-09', amount: 25.5 }, { date: '2026-10-14', amount: 10 }, { date: '2026-09-01', amount: 999 }])
  assert.equal(s.grain, 'day')
  assert.equal(s.buckets.length, 7)
  assert.deepEqual(s.buckets.map(b => b.value), [0, 75.5, 0, 0, 0, 0, 10])
  assert.equal(s.buckets[1].title, 'Friday, October 9')
  assert.equal(s.buckets[0].label, 'Oct 8')
})

test('weekly chart starts on Monday and covers the first partial week', () => {
  assert.equal(r.weekStart('2026-10-14'), '2026-10-12') // a Wednesday
  assert.equal(r.weekStart('2026-10-11'), '2026-10-05') // a Sunday belongs to the week before
  const range = { from: '2026-08-05', to: '2026-10-14' }
  const s = r.series(range, [{ date: '2026-08-05', amount: 10 }, { date: '2026-10-14', amount: 20 }])
  assert.equal(s.grain, 'week')
  assert.equal(s.buckets[0].key, '2026-08-03')
  assert.equal(s.buckets[0].value, 10)
  assert.equal(s.buckets.at(-1).key, '2026-10-12')
  assert.equal(s.buckets.at(-1).value, 20)
  assert.equal(s.buckets.at(-1).title, 'Week of October 12')
})

test('monthly chart lists every month, across a year end', () => {
  const s = r.series({ from: '2025-10-15', to: '2026-02-20' }, [])
  assert.equal(s.grain, 'week')
  const m = r.series({ from: '2025-06-01', to: '2026-03-31' }, [{ date: '2026-01-15', amount: 5 }, { date: '2025-06-30', amount: 7 }])
  assert.equal(m.grain, 'month')
  assert.deepEqual(m.buckets.map(b => b.key), ['2025-06-01', '2025-07-01', '2025-08-01', '2025-09-01', '2025-10-01', '2025-11-01', '2025-12-01', '2026-01-01', '2026-02-01', '2026-03-01'])
  assert.equal(m.buckets[0].value, 7)
  assert.equal(m.buckets[7].value, 5)
  assert.equal(m.buckets[0].label, 'Jun 25')
  assert.equal(m.buckets[7].title, 'January 2026')
  const one = r.series({ from: '2026-01-01', to: '2026-10-14' }, [])
  assert.equal(one.buckets.length, 10)
  assert.equal(one.buckets[0].label, 'Jan')
})

test('what is owed is grouped by age, oldest first', () => {
  const docs = [
    doc({ id: 'a', date: '2026-10-10', balance: 100, paid: 0, status: 'Sent' }),
    doc({ id: 'b', date: '2026-08-01', balance: 250.25, paid: 0, status: 'Sent' }),
    doc({ id: 'c', date: '2026-09-01', balance: 40, paid: 0, status: 'Partial' }),
    doc({ id: 'd', date: '2026-06-01', balance: 75, paid: 0, status: 'Sent' }),
    doc({ id: 'e', date: '2026-01-01', balance: 999, status: 'Draft' }),
    doc({ id: 'f', date: '2026-10-01', balance: 0 }),
    doc({ id: 'g', date: '2026-10-01', balance: 5, type: 'Estimate' }),
  ]
  const a = r.aging(docs, '2026-10-14')
  assert.equal(a.total, 465.25)
  assert.deepEqual(a.open.map(o => o.doc.id), ['d', 'b', 'c', 'a'])
  assert.deepEqual(a.buckets.map(b => [b.key, b.count, b.amount]), [['0-30', 1, 100], ['31-60', 1, 40], ['61-90', 1, 250.25], ['90+', 1, 75]])
  assert.equal(r.aging([], '2026-10-14').total, 0)
  // a bucket boundary belongs to the younger bucket
  assert.equal(r.aging([doc({ date: '2026-09-14', balance: 1, paid: 0 })], '2026-10-14').buckets[0].count, 1)
  // an invoice dated in the future is not negative days
  assert.equal(r.aging([doc({ date: '2026-10-20', balance: 1, paid: 0 })], '2026-10-14').open[0].days, 0)
})

test('payments by method merge case variants and use plain words', () => {
  const d = doc({ id: 'a', date: '2024-05-02' })
  const rows = r.byMethod([
    pay({ amount: 100, method: 'Cash' }), pay({ id: '2', amount: 50, method: 'cash' }),
    pay({ id: '3', amount: 30, method: 'Credit Card' }), pay({ id: '4', amount: 20, method: 'card' }),
    pay({ id: '5', amount: 900, method: 'historical_import', docId: 'a', date: '2026-03-20' }),
    pay({ id: '6', amount: 5, method: '' }),
  ], new Map([[d.id, d]]), { from: '2026-10-01', to: '2026-10-31' })
  assert.deepEqual(rows.map(x => [x.label, x.amount, x.count]), [['Cash', 150, 2], ['Card', 50, 2], ['Method not recorded', 5, 1]])
})

test('top repairs count each repair once per invoice and merge spelling', () => {
  const docs = [
    doc({ id: '1', ops: [{ name: 'Oil change', amount: 40 }, { name: 'oil change ', amount: 10 }, { name: 'Brake pads - front', amount: 150 }] }),
    doc({ id: '2', ops: [{ name: 'OIL CHANGE.', amount: 45 }, { name: '', amount: 5 }] }),
    doc({ id: '3', ops: [{ name: 'Alignment', amount: 90 }], status: 'Draft' }),
    doc({ id: '4', ops: [{ name: 'Alignment', amount: 90 }], date: '2025-01-01' }),
  ]
  const t = r.topRepairs(docs, { from: '2026-10-01', to: '2026-10-31' })
  assert.deepEqual(t.map(x => [x.label, x.count, x.amount]), [['Oil change', 2, 95], ['Brake pads - front', 1, 150]])
  assert.equal(r.topRepairs(docs, { from: '2026-10-01', to: '2026-10-31' }, 1).length, 1)
})

test('top parts are ranked by money and count quantity', () => {
  const docs = [
    doc({ id: '1', items: [{ name: 'Oil filter', qty: 2, amount: 24 }, { name: 'Brake pad set', qty: 1, amount: 80 }] }),
    doc({ id: '2', items: [{ name: 'oil filter', qty: 1, amount: 12.5 }, { name: 'Wiper', qty: 0, amount: 9 }] }),
  ]
  const t = r.topParts(docs, { from: '2026-10-01', to: '2026-10-31' })
  assert.deepEqual(t.map(x => [x.label, x.count, x.amount]), [['Brake pad set', 1, 80], ['Oil filter', 3, 36.5], ['Wiper', 1, 9]])
})

test('top customers leave out walk-ins and unnamed invoices', () => {
  const docs = [
    doc({ id: '1', customer: 'Maria Lopez', customerId: 'c1', total: 300 }),
    doc({ id: '2', customer: 'maria lopez', customerId: 'c1', total: 200 }),
    doc({ id: '3', customer: 'Walk-in', total: 900 }),
    doc({ id: '4', customer: '  ', total: 900 }),
    doc({ id: '5', customer: 'Sam Reed', customerId: null, total: 450 }),
    doc({ id: '6', customer: 'sam reed', customerId: null, total: 100 }),
  ]
  const t = r.topCustomers(docs, { from: '2026-10-01', to: '2026-10-31' })
  assert.deepEqual(t.map(x => [x.name, x.amount, x.count]), [['Maria Lopez', 500, 2], ['Sam Reed', 550, 2]].sort((a, b) => b[1] - a[1]))
})

test('quarters are newest first and use the invoice date for imports', () => {
  const docs = [doc({ id: 'a', date: '2024-05-02', total: 250 }), doc({ id: 'b', date: '2026-10-10', total: 100, tax: 7.5 }), doc({ id: 'x', date: '2026-10-10', total: 500, status: 'Draft' })]
  const q = r.quarters(docs, [pay({ docId: 'a', amount: 250, method: 'historical_import', date: '2026-03-20' }), pay({ id: '2', docId: 'b', amount: 100, date: '2026-10-11' })])
  assert.deepEqual(q.map(x => x.label), ['2026 Q4', '2024 Q2'])
  assert.deepEqual([q[0].collected, q[0].invoiced, q[0].invoices, q[0].tax], [100, 100, 1, 7.5])
  assert.deepEqual([q[1].collected, q[1].invoiced], [250, 250])
})

test('technicians merge name variants and only count the range', () => {
  const docs = [
    doc({ id: '1', hours: [{ tech: 'Carlos', hours: 2, amount: 200 }, { tech: 'carlos ', hours: 1.5, amount: 150 }, { tech: 'Unassigned', hours: 4, amount: 400 }, { tech: '', hours: 1, amount: 99 }] }),
    doc({ id: '2', hours: [{ tech: 'Dee', hours: 1, amount: 120 }], date: '2025-01-01' }),
    doc({ id: '3', hours: [{ tech: 'Dee', hours: 1, amount: 120 }], status: 'Draft' }),
  ]
  const jobs = [{ id: 'j1', status: 'Completed', tech: 'CARLOS', date: '2026-10-11', customer: '' }, { id: 'j2', status: 'In progress', tech: 'Dee', date: '2026-10-12', customer: '' }, { id: 'j3', status: 'Completed', tech: 'Dee', date: '2025-01-01', customer: '' }]
  const range = { from: '2026-10-01', to: '2026-10-31' }
  const noClock = r.techRows(docs, jobs, range, ['Carlos', 'Dee', 'Unassigned', 'Pat'], null)
  assert.deepEqual(noClock.map(t => t.name), ['Carlos', 'Dee', 'Pat'])
  assert.equal(noClock[0].billedHours, 3.5)
  assert.equal(noClock[0].laborBilled, 350)
  assert.equal(noClock[0].jobs, 1)
  assert.equal(noClock[0].clockedHours, null)
  assert.equal(noClock[0].efficiency, null)
  assert.equal(noClock[1].laborBilled, 0)
  assert.equal(noClock[1].jobs, 1)
  assert.deepEqual([noClock[2].billedHours, noClock[2].jobs], [0, 0])
})

test('technician efficiency is billed hours over clocked hours, only when both exist', () => {
  const docs = [doc({ id: '1', hours: [{ tech: 'Carlos', hours: 6, amount: 600 }, { tech: 'Dee', hours: 2, amount: 200 }] })]
  const range = { from: '2026-10-01', to: '2026-10-31' }
  const rows = r.techRows(docs, [], range, ['Carlos', 'Dee', 'Pat'], new Map([['carlos', 8], ['Carlos', 0.5], ['Dee', 0.5], ['Pat', 12]]))
  const by = Object.fromEntries(rows.map(x => [x.name, x]))
  assert.equal(by.Carlos.clockedHours, 8.5)
  assert.equal(by.Carlos.efficiency, 71)
  assert.equal(by.Dee.efficiency, null) // under an hour on the clock says nothing
  assert.equal(by.Pat.clockedHours, 12)
  assert.equal(by.Pat.efficiency, null) // nothing billed
  // when the clock could not be read, nothing is claimed
  assert.equal(r.techRows(docs, [], range, [], null)[0].clockedHours, null)
})

test('job statistics', () => {
  const jobs = [
    { id: '1', status: 'In progress', tech: '', date: '2026-10-02', customer: '' },
    { id: '2', status: 'Completed', tech: '', date: '2026-10-03', customer: '' },
    { id: '3', status: 'Ready for pickup', tech: '', date: '2026-10-04', customer: '' },
    { id: '4', status: 'Paid', tech: '', date: '2026-10-05', customer: '' },
    { id: '5', status: 'Waiting on parts', tech: '', date: '2026-08-05', customer: '' },
    { id: '6', status: '', tech: '', date: '2026-08-05', customer: '' },
  ]
  const s = r.jobStats(jobs, { from: '2026-10-01', to: '2026-10-31' })
  assert.equal(s.opened, 4)
  assert.equal(s.finished, 3)
  assert.equal(s.openNow, 5)
  assert.deepEqual(s.byStatus.map(x => x.status).sort(), ['Completed', 'In progress', 'No status', 'Ready for pickup', 'Waiting on parts'])
  assert.deepEqual(r.jobStats([], { from: '2026-10-01', to: '2026-10-31' }), { opened: 0, finished: 0, openNow: 0, byStatus: [] })
})

test('call statistics count incoming calls by weekday and hour', () => {
  // Pretend the shop's clock is the first ten characters and the hour is the hour in the string.
  const dayOf = iso => iso.slice(0, 10)
  const hourOf = iso => Number(iso.slice(11, 13))
  const calls = [
    { id: '1', direction: 'inbound', seconds: 120, start: '2026-10-12T09:15:00' }, // Monday
    { id: '2', direction: 'inbound', seconds: 5, start: '2026-10-12T09:45:00' },   // Monday, hung up
    { id: '3', direction: 'inbound', seconds: 60, start: '2026-10-18T17:00:00' },  // Sunday
    { id: '4', direction: 'outbound', seconds: 30, start: '2026-10-13T10:00:00' },
    { id: '5', direction: 'inbound', seconds: 300, start: '2026-09-01T10:00:00' }, // out of range
  ]
  const c = r.callStats(calls, { from: '2026-10-01', to: '2026-10-31' }, dayOf, hourOf)
  assert.equal(c.inbound, 3)
  assert.equal(c.outbound, 1)
  assert.equal(c.short, 1)
  assert.equal(c.weekdays[0], 2)
  assert.equal(c.weekdays[6], 1)
  assert.equal(c.hours[9], 2)
  assert.equal(c.hours[17], 1)
  assert.equal(c.averageSeconds, 70) // 120, 60 and 30 count; the 5 second call does not
  assert.equal(c.weekdays.reduce((a, b) => a + b, 0), c.inbound)
  const none = r.callStats([], { from: '2026-10-01', to: '2026-10-31' }, dayOf, hourOf)
  assert.deepEqual([none.inbound, none.averageSeconds], [0, 0])
})

test('seconds read as short durations', () => {
  assert.equal(r.fmtSeconds(0), '0s')
  assert.equal(r.fmtSeconds(NaN), '0s')
  assert.equal(r.fmtSeconds(45), '45s')
  assert.equal(r.fmtSeconds(60), '1m')
  assert.equal(r.fmtSeconds(125), '2m 5s')
})

test('csv cells cannot run as formulas and quote what needs quoting', () => {
  assert.equal(r.csvCell('=SUM(A1)'), "'=SUM(A1)")
  assert.equal(r.csvCell('+1 713'), "'+1 713")
  assert.equal(r.csvCell('-5'), "'-5")
  assert.equal(r.csvCell('@cmd'), "'@cmd")
  assert.equal(r.csvCell('a,b'), '"a,b"')
  assert.equal(r.csvCell('say "hi"'), '"say ""hi"""')
  assert.equal(r.csvCell('line\nbreak'), '"line\nbreak"')
  assert.equal(r.csvCell(-12.5), '-12.5') // real numbers are not text
  assert.equal(r.csvCell(null), '')
  assert.equal(r.csvCell(NaN), '')
})

test('the payments file has a header, the right rows and plain method names', () => {
  const d = doc({ id: 'a', date: '2024-05-02', total: 250, customer: '=cmd|calc', status: 'Paid' })
  const csv = r.paymentsCsv([
    pay({ id: '1', docId: 'a', amount: 250, method: 'historical_import', date: '2026-03-20', customer: '=cmd|calc' }),
    pay({ id: '2', amount: 40, method: 'cash', date: '2026-10-02', customer: 'Sam, Jr.' }),
    pay({ id: '3', amount: 99, date: '2020-01-01' }),
  ], [d], { from: '2024-01-01', to: '2026-12-31' })
  const lines = csv.trim().split('\r\n')
  assert.equal(lines[0], 'Date,Customer,Invoice date,Invoice total,Amount received,Method,Invoice status')
  assert.equal(lines.length, 3)
  assert.equal(lines[1], "2024-05-02,'=cmd|calc,2024-05-02,250.00,250.00,Imported from past records,Paid")
  assert.equal(lines[2], '2026-10-02,"Sam, Jr.",,,40.00,Cash,')
  assert.ok(csv.endsWith('\r\n'))
})

test('money formats without cents for headlines and with cents for ledgers', () => {
  assert.equal(r.money(1234.6), '$1,235')
  assert.equal(r.money(0), '$0')
  assert.equal(r.money2(1234.5), '$1,234.50')
  assert.equal(r.round2(1.005 + 1.005), 2.01)
  assert.equal(r.num('x'), 0)
  assert.equal(r.num('12.5'), 12.5)
})

test('an invoice marked Paid owes nothing; others owe what is left', () => {
  assert.equal(r.balanceFor('Paid', 80), 0)
  assert.equal(r.balanceFor(' paid ', 80), 0)
  assert.equal(r.balanceFor('Partial', 80), 80)
  assert.equal(r.balanceFor('Sent', -5), 0)
})

test('paid invoices with no money recorded are pointed out, not counted', () => {
  const a = doc({ id: 'a', total: 120, paid: 0 })
  const b = doc({ id: 'b', total: 80, paid: 80 })
  const c = doc({ id: 'c', total: 60, paid: 0 })
  const d = doc({ id: 'd', total: 0, paid: 0 })
  const e = doc({ id: 'e', total: 50, paid: 0, status: 'Sent', balance: 50 })
  const u = r.unrecordedPaid([a, b, c, d, e], [pay({ docId: 'c', amount: 60 })])
  assert.equal(u.count, 1)
  assert.equal(u.amount, 120)
  assert.deepEqual(u.docs.map(x => x.id), ['a'])
})

test('parts profit only counts lines with a cost written down', () => {
  const docs = [
    doc({ id: '1', items: [{ name: 'Pads', qty: 1, amount: 100, cost: 60 }, { name: 'Rotor', qty: 2, amount: 200, cost: 120 }, { name: 'Clip', qty: 1, amount: 10 }, { name: 'Free', qty: 1, amount: 0, cost: 5 }] }),
    doc({ id: '2', items: [{ name: 'Old', qty: 1, amount: 500, cost: 1 }], date: '2025-01-01' }),
    doc({ id: '3', items: [{ name: 'Draft', qty: 1, amount: 500, cost: 1 }], status: 'Draft' }),
  ]
  const m = r.partsMargin(docs, { from: '2026-10-01', to: '2026-10-31' })
  assert.deepEqual(m, { sold: 300, cost: 180, profit: 120, pct: 40, lines: 3, costed: 2 })
  const none = r.partsMargin([doc({ items: [{ name: 'Clip', qty: 1, amount: 10 }] })], { from: '2026-10-01', to: '2026-10-31' })
  assert.deepEqual([none.pct, none.profit, none.costed, none.lines], [null, 0, 0, 1])
})

test('every period says what it is compared with', () => {
  for (const p of r.PERIODS) assert.match(r.vsLabel(p.key), /^the /)
  assert.equal(r.vsLabel('7d'), 'the 7 days before')
  assert.equal(r.vsLabel('year'), 'the same days last year')
})

test('chart scales are tidy numbers', () => {
  assert.equal(r.niceMax(0), 1)
  assert.equal(r.niceMax(120), 150)
  assert.equal(r.niceMax(830), 1000)
  assert.equal(r.niceMax(300), 300)
  for (const n of [0, 1, 3, 5, 7, 16, 17, 52, 60, 76, 99, 101, 450, 1234]) {
    const v = r.niceEven(n)
    assert.ok(v >= Math.max(2, n), `${n} fits under ${v}`)
    assert.ok(Number.isInteger(v) && v % 2 === 0, `${v} is even`)
    assert.ok(v <= Math.max(4, n * 1.7), `${n} is not drawn tiny under ${v}`)
  }
  assert.equal(r.niceEven(52), 60)
  assert.equal(r.niceEven(5), 6)
  assert.equal(r.niceEven(17), 20)
})
