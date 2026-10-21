import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { addDays, appointmentDay, buildShopSnapshot } from '../src/lib/ai/shop-snapshot.ts'
import { shopLocalTime } from '../src/lib/ai/shop-snapshot.ts'
import { CATALOG } from '../src/lib/ai/workflow/catalog.ts'
import { getActionInfo as actionInfo } from '../src/lib/ai/action-risk.ts'

const doc = (o) => ({ id: o.id, type: 'Invoice', number: o.number, status: o.status, date: o.date, customerId: o.customerId || null, customer: o.customer, total: o.total, labor: 0, parts: 0, fees: 0, tax: 0, paid: o.total - o.balance, balance: o.balance, method: '', ops: [], items: [], hours: [] })

// Shaped like production on 20 Oct 2026: two part-paid invoices ($250 + $60), 153 paid, 9 unsent drafts.
const saleDocs = [
  doc({ id: 'a', number: 'INV-2026-0064', status: 'Partial', date: '2026-09-29', customer: 'Patrick Mitchell', total: 500, balance: 250 }),
  doc({ id: 'b', number: 'INV-2026-0070', status: 'Partial', date: '2026-10-16', customer: 'Sui Zhang', total: 170, balance: 60 }),
  doc({ id: 'c', number: 'INV-2026-0068', status: 'Paid', date: '2026-10-05', customer: 'Creyton Curtis', total: 1580, balance: 0 }),
]

const base = { todayKey: '2026-10-20', timezone: 'America/Chicago', saleDocs, draftInvoiceCount: 9, estimates: [{ id: 'e1', status: 'Draft' }], estimateTotal: () => 12044, appointments: [], jobs: [{ status: 'New', customer_name: 'Sui Zhang', vehicle_year: '2018', vehicle_make: 'Ford', vehicle_model: 'Escape' }, { status: 'Paid', customer_name: 'Old' }] }

test('who owes matches the Today screen: 2 invoices, $310, drafts not counted', () => {
  const s = buildShopSnapshot(base)
  assert.equal(s.receivables.totalOwed, 310)
  assert.equal(s.receivables.unpaidInvoiceCount, 2)
  assert.deepEqual(s.receivables.customers.map(c => c.name), ['Patrick Mitchell', 'Sui Zhang'])
  assert.deepEqual(s.receivables.customers[0].invoiceNumbers, ['INV-2026-0064'])
  assert.equal(s.receivables.unsentDraftInvoices, 9)
  assert.match(s.notes.join(' '), /9 invoice\(s\) are saved as drafts/)
})

test('a customer filter narrows who owes and says so when nobody matches', () => {
  assert.equal(buildShopSnapshot({ ...base, customerFilter: 'zhang' }).receivables.totalOwed, 60)
  const none = buildShopSnapshot({ ...base, customerFilter: 'nobody' })
  assert.equal(none.receivables.totalOwed, 0)
  assert.match(none.notes.join(' '), /No unpaid invoices matched/)
})

test('open jobs leave out paid and closed ones', () => {
  const s = buildShopSnapshot(base)
  assert.equal(s.openJobs.count, 1)
  assert.equal(s.openJobs.jobs[0].vehicle, '2018 Ford Escape')
})

test('appointments are split into today and the next 7 days, cancelled ones dropped, both date columns read', () => {
  const appts = [
    { scheduled_date: '2026-10-20', scheduled_time: '09:00', customer_name: 'A', status: 'Scheduled' },
    { date: '10/22/2026', time: '13:00', customer_name: 'B' },
    { scheduled_date: '2026-10-20', customer_name: 'C', status: 'Cancelled' },
    { scheduled_date: '2026-11-30', customer_name: 'D' },
  ]
  const s = buildShopSnapshot({ ...base, appointments: appts })
  assert.deepEqual(s.appointments.today.map(a => a.customer), ['A'])
  assert.deepEqual(s.appointments.next7Days.map(a => a.customer), ['B'])
  assert.equal(appointmentDay({ date: '10/22/2026' }), '2026-10-22')
  assert.equal(addDays('2026-10-31', 1), '2026-11-01')
})

test('open estimates add up', () => {
  const s = buildShopSnapshot(base)
  assert.equal(s.estimates.open, 1)
  assert.equal(s.estimates.openTotal, 12044)
})

test('the shop\'s day, not UTC: 10 pm in Houston on 20 Oct is still Tuesday the 20th', () => {
  const at = new Date('2026-10-21T03:09:00Z')
  assert.equal(at.toISOString().slice(0, 10), '2026-10-21')
  assert.match(shopLocalTime({ timezone: 'America/Chicago' }, at), /Tuesday, 10\/20\/2026/)
  assert.match(shopLocalTime({}, at), /10\/20\/2026/)
  assert.match(shopLocalTime({ timezone: 'Not/AZone' }, at), /10\/20\/2026/)
})

test('the snapshot is a read the model can call, labelled and not undoable', () => {
  assert.equal(CATALOG.getShopSnapshot.write, false)
  const info = actionInfo('getShopSnapshot')
  assert.equal(info.permission, 'read')
  const action = readFileSync(new URL('../src/app/api/ai-action/route.ts', import.meta.url), 'utf8')
  assert.match(action, /case 'getShopSnapshot'/)
  assert.match(action, /todayKeyIn\(statsFacts\.timezone/)
  assert.doesNotMatch(action, /const today = new Date\(\)\.toISOString\(\)\.split\('T'\)\[0\]/)
})
