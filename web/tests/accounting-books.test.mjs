import test from 'node:test'
import assert from 'node:assert/strict'
import { PAYMENTS, RAW_EXPENSES, THIS_MONTH, TODAY, allDocs } from './helpers-reports.mjs'
import { buildJournal, resolveAccounts, runChecks, totalCredits, totalDebits } from '../src/lib/accounting.ts'
import { checkExpense, countsOn, expenseFrom, expensesIn, likelyDuplicate, parseAmount, summarizeExpenses, unpaidBills, vendorNames } from '../src/lib/expenses.ts'
import { profitLoss, profitLossByMonth, profitLossCsv } from '../src/lib/profit-loss.ts'
import { changedSinceClose, closeItems, closeReadiness, isMonth, MANUAL_ITEMS, monthLabel, monthRange, monthSnapshot, previousMonth } from '../src/lib/month-close.ts'

const docs = allDocs()
const expenses = RAW_EXPENSES.map(expenseFrom)
const book = resolveAccounts([])

test('amounts are read the way people type them and nothing else', () => {
  assert.equal(parseAmount('1,204.50'), 1204.5); assert.equal(parseAmount('$30'), 30); assert.equal(parseAmount(12.345), 12.35)
  for (const bad of ['', 'abc', '12.345', '1e3', '-5', '12..5', null, undefined, NaN]) assert.equal(parseAmount(bad), null, String(bad))
})

test('an expense is checked and each problem is said in plain words', () => {
  const ok = checkExpense({ date: '2026-10-05', vendor: '  Fake   Supply ', category: 'parts', amount: '245.50', memo: 'x\ny', paid_on: '2026-10-06', reference: 'A1' }, TODAY)
  assert.deepEqual(ok, { ok: true, value: { date: '2026-10-05', vendor: 'Fake Supply', category: 'parts', amount: 245.5, memo: 'x y', reference: 'A1', paid_on: '2026-10-06', method: '' } })
  const bad = checkExpense({ date: '10/05/2026', vendor: '', category: 'bogus', amount: '0', paid_on: '2026-10-01' }, TODAY)
  assert.equal(bad.ok, false)
  assert.deepEqual(Object.keys(bad.errors).sort(), ['amount', 'category', 'date', 'vendor'])
  assert.match(bad.errors.amount, /more than zero/)
  const early = checkExpense({ date: '2026-10-05', vendor: 'V', category: 'rent', amount: 5, paid_on: '2026-10-01' }, TODAY)
  assert.match(early.errors.paid_on, /before the date on the bill/)
  assert.match(checkExpense({ date: '2027-03-01', vendor: 'V', category: 'rent', amount: 5 }, TODAY).errors.date, /more than a month ahead/)
  assert.match(checkExpense({ date: '2026-10-05', vendor: 'V', category: 'rent', amount: '20000000' }, TODAY).errors.amount, /ten million/)
  const unpaid = checkExpense({ date: '2026-10-05', vendor: 'V', category: 'rent', amount: 5, paid: false, paid_on: '2026-10-06' }, TODAY)
  assert.equal(unpaid.value.paid_on, null, 'a bill marked unpaid stays unpaid')
})

test('expense rows from the database are made safe', () => {
  const e = expenseFrom({ id: 7, date: '2026-10-05T10:00:00Z', vendor: 'A\tB', category: '', amount: '-3', paid_on: 'junk', voided_at: null })
  assert.deepEqual([e.id, e.date, e.vendor, e.category, e.amount, e.paid_on], ['7', '2026-10-05', 'A B', 'other', 0, null])
})

test('expenses count on the bill date for accrual and the paid date for cash, and voided ones never count', () => {
  const oct = THIS_MONTH
  assert.deepEqual(expensesIn(expenses, oct, 'accrual').map(e => e.id).sort(), ['x1', 'x2', 'x3', 'x4'])
  assert.deepEqual(expensesIn(expenses, oct, 'cash').map(e => e.id).sort(), ['x1', 'x2', 'x4'], 'the unpaid bill is not cash out yet')
  assert.equal(countsOn(expenses[2], 'cash'), '')
  const s = summarizeExpenses(expenses, oct, 'accrual')
  assert.equal(s.total, 3730.4); assert.equal(s.cogs, 920); assert.equal(s.operating, 2810.4); assert.equal(s.count, 4)
  assert.deepEqual(s.byCategory.map(c => c.key), ['rent', 'parts', 'utilities', 'sublet'])
})

test('unpaid bills are listed oldest first and overdue after 30 days', () => {
  const bills = unpaidBills(expenses, TODAY)
  assert.equal(bills.bills.length, 1); assert.equal(bills.total, 310.4); assert.equal(bills.bills[0].days, 8); assert.equal(bills.overdueTotal, 0)
  const later = unpaidBills(expenses, '2026-12-01')
  assert.equal(later.bills[0].overdue, true); assert.equal(later.overdueTotal, 310.4)
})

test('typing the same bill twice is noticed', () => {
  assert.equal(likelyDuplicate(expenses, { vendor: 'property co', date: '2026-10-03', amount: 2500, reference: '' })?.id, 'x2')
  assert.equal(likelyDuplicate(expenses, { vendor: 'Fake Parts Supply', date: '2026-11-01', amount: 1, reference: 'fp-2210' })?.id, 'x1', 'same reference number')
  assert.equal(likelyDuplicate(expenses, { vendor: 'Property Co', date: '2026-10-03', amount: 2500, reference: '' }, 'x2'), null, 'editing the bill itself is fine')
  assert.equal(likelyDuplicate(expenses, { vendor: 'Mistake', date: '2026-10-05', amount: 99, reference: '' }), null, 'voided bills do not count')
  assert.deepEqual(vendorNames(expenses).slice(0, 2), ['Outside Machine Shop', 'Fake Power Co'])
})

test('profit and loss on an accrual basis, cost of parts from the invoices', () => {
  const pl = profitLoss(docs, PAYMENTS, expenses, THIS_MONTH, { basis: 'accrual', cogsMethod: 'invoices' })
  assert.deepEqual(pl.income.map(r => [r.label, r.amount]), [['Labor', 315], ['Parts', 287], ['Shop supplies and fees', 10]])
  assert.equal(pl.totalIncome, 612)
  assert.deepEqual(pl.cogs.map(r => [r.label, r.amount]), [['Cost of parts sold', 112], ['Sublet and outside labor', 120]])
  assert.equal(pl.totalCogs, 232); assert.equal(pl.grossProfit, 380); assert.equal(pl.grossMarginPct, 62.1)
  assert.deepEqual(pl.expenses.map(r => [r.label, r.amount]), [['Rent', 2500], ['Utilities', 310.4]])
  assert.equal(pl.totalExpenses, 2810.4); assert.equal(pl.netIncome, -2430.4)
  assert.equal(pl.salesTax, 24.51, 'tax collected is not income')
  assert.equal(pl.totalIncome + pl.salesTax, 636.51, 'income plus tax is what was billed')
  assert.ok(pl.notes.some(n => /1 of 5 part lines have no cost written down/.test(n)))
  assert.ok(pl.notes.some(n => /Parts bills of 800\.00 are entered but not counted/.test(n)), 'a part is never counted twice')
  assert.ok(pl.notes.some(n => /No payroll is entered/.test(n)))
  assert.ok(pl.notes.some(n => /Counted when billed/.test(n)))
})

test('cost of parts can come from parts bills instead, never both', () => {
  const pl = profitLoss(docs, PAYMENTS, expenses, THIS_MONTH, { basis: 'accrual', cogsMethod: 'purchases' })
  assert.deepEqual(pl.cogs.map(r => [r.label, r.amount]), [['Parts bought', 800], ['Sublet and outside labor', 120]])
  assert.equal(pl.grossProfit, -308); assert.equal(pl.netIncome, -3118.4)
  assert.ok(!pl.notes.some(n => /part lines have no cost/.test(n)))
  const none = profitLoss(docs, PAYMENTS, [], THIS_MONTH, { basis: 'accrual', cogsMethod: 'purchases' })
  assert.ok(none.notes.some(n => /No parts bills are entered/.test(n)))
  assert.ok(none.notes.some(n => /No expenses are entered/.test(n)))
})

test('profit and loss on a cash basis counts money in and bills paid', () => {
  const pl = profitLoss(docs, PAYMENTS, expenses, THIS_MONTH, { basis: 'cash', cogsMethod: 'invoices' })
  assert.equal(pl.totalIncome, 612); assert.equal(pl.salesTax, 24.51)
  assert.equal(pl.totalExpenses, 2500, 'the unpaid power bill is not cash out yet')
  assert.equal(pl.totalCogs, 232)
  assert.equal(pl.netIncome, -2120)
  assert.ok(pl.notes.some(n => /Counted when money came in/.test(n)))
})

test('a part payment on an invoice is split the way the invoice is, to the cent', () => {
  const sept = { from: '2026-09-01', to: '2026-09-30' }
  const pl = profitLoss(docs, PAYMENTS, [], sept, { basis: 'cash', cogsMethod: 'invoices' })
  const byKey = Object.fromEntries(pl.income.map(r => [r.key, r.amount]))
  assert.equal(Math.round((pl.totalIncome + pl.salesTax) * 100), Math.round((100 + 181.19) * 100), 'income plus tax equals the money received')
  // The alternator invoice (INV-1003) had 100 of 550.63 paid: its core charge share is 5.45 and its labor share 45.40. The rear brake invoice was paid in full.
  assert.equal(byKey.sales_core, 5.45); assert.equal(byKey.sales_sublet, 7.26); assert.equal(byKey.sales_labor, 145.4); assert.equal(byKey.sales_parts, 108.14)
  assert.equal(pl.salesTax, 9.94)
})

test('money received on something that is not a counted invoice is shown, not dropped', () => {
  const loose = [...PAYMENTS, { id: 'pz', docId: null, amount: 50, method: 'cash', date: '2026-10-06', customer: '' }]
  const pl = profitLoss(docs, loose, expenses, THIS_MONTH, { basis: 'cash', cogsMethod: 'invoices' })
  assert.deepEqual(pl.income.at(-1), { key: 'unallocated', label: 'Payments not tied to an invoice', amount: 50 })
  assert.equal(pl.totalIncome, 662)
  assert.ok(pl.notes.some(n => /not tied to an invoice/.test(n)))
})

test('the year by month adds up to the whole', () => {
  const range = { from: '2026-08-01', to: '2026-10-14' }
  const opts = { basis: 'accrual', cogsMethod: 'invoices' }
  const months = profitLossByMonth(docs, PAYMENTS, expenses, range, opts)
  assert.deepEqual(months.map(m => m.key), ['2026-08', '2026-09', '2026-10'])
  const whole = profitLoss(docs, PAYMENTS, expenses, range, opts)
  assert.equal(Math.round(months.reduce((s, m) => s + m.income, 0) * 100), Math.round(whole.totalIncome * 100))
  assert.equal(Math.round(months.reduce((s, m) => s + m.net, 0) * 100), Math.round(whole.netIncome * 100))
  assert.equal(months[1].expenses, 4200)
})

test('the profit and loss file is plain csv with the method stated', () => {
  const text = profitLossCsv(profitLoss(docs, PAYMENTS, expenses, THIS_MONTH, { basis: 'accrual', cogsMethod: 'invoices' }))
  const lines = text.trim().split('\r\n')
  assert.equal(lines[0], 'Profit and loss,Oct 1 to Oct 14, 2026'.replace('Oct 1 to Oct 14, 2026', '"Oct 1 to Oct 14, 2026"'))
  assert.ok(lines.includes('Total income,612.00') && lines.includes('Net income,-2430.40') && lines.includes('Gross profit,380.00'))
  assert.ok(lines.some(l => l.startsWith('Counted on,Accrual')))
})

test('bills and expenses post to the books and every entry still balances', () => {
  const j = buildJournal(docs, PAYMENTS, THIS_MONTH, book, { mode: 'individual', includeCost: false, dailyCustomer: 'Daily sales', expenses })
  assert.deepEqual(j.problems, [])
  const exp = j.entries.filter(e => e.source === 'expense')
  // x1 paid same day (1 entry), x2 paid same day (1), x3 unpaid bill (1), x4 bill on the 8th plus payment on the 12th (2); x6 voided
  assert.equal(exp.length, 5)
  const x3 = exp.find(e => e.number === 'EXP-x3')
  assert.deepEqual(x3.lines.map(l => [l.account, l.debit, l.credit, l.name]), [['Utilities', 310.4, 0, ''], ['Accounts Payable', 0, 310.4, 'Fake Power Co']])
  const x1 = exp.find(e => e.number === 'EXP-FP-2210')
  assert.equal(x1.lines[1].account, 'Checking', 'paid on the day of the bill goes straight to the account it was paid from')
  assert.ok(exp.some(e => e.number === 'BILLPAY-x4' && e.date === '2026-10-12' && e.lines[0].account === 'Accounts Payable' && e.lines[0].debit === 120))
  assert.equal(totalDebits(j.entries), totalCredits(j.entries))
  assert.ok(!j.entries.some(e => /Mistake/.test(e.memo)))
})

test('month close: the month, its range and its label', () => {
  assert.deepEqual(monthRange('2026-02'), { from: '2026-02-01', to: '2026-02-28' })
  assert.deepEqual(monthRange('2028-02'), { from: '2028-02-01', to: '2028-02-29' })
  assert.equal(previousMonth('2026-01-05'), '2025-12'); assert.equal(previousMonth('2026-10-14'), '2026-09')
  assert.equal(monthLabel('2026-09'), 'September 2026')
  assert.equal(isMonth('2026-13'), false); assert.equal(isMonth('2026-9'), false); assert.equal(isMonth('2026-09'), true)
})

test('month close: the snapshot is the month\'s totals as they stand', () => {
  assert.deepEqual(monthSnapshot(docs, PAYMENTS, expenses, '2026-09'), { billed: 731.82, collected: 281.19, tax: 26.82, invoices: 2, owed: 450.63, expenses: 4200 })
})

test('month close: automatic checks and the things only the owner can confirm', () => {
  const sept = monthRange('2026-09')
  const journal = buildJournal(docs, PAYMENTS, sept, book)
  const checks = runChecks(docs, PAYMENTS, sept, journal)
  const items = closeItems('2026-09', TODAY, null, checks, expenses)
  assert.equal(items.filter(i => i.kind === 'manual').length, MANUAL_ITEMS.length)
  assert.ok(items.every(i => i.kind !== 'manual' || i.state === 'todo'))
  assert.equal(items.find(i => i.key === 'month-over').state, 'ok')
  assert.equal(items.find(i => i.key === 'bills').state, 'ok', 'the power bill is dated in October')
  let r = closeReadiness(items)
  assert.equal(r.ready, false); assert.equal(r.manualLeft, MANUAL_ITEMS.length); assert.match(r.why, /7 items are still to confirm/)
  const all = Object.fromEntries(MANUAL_ITEMS.map(m => [m.key, true]))
  const done = closeItems('2026-09', TODAY, { month: '2026-09', checked: all, note: '', closed_at: null, closed_by: null, snapshot: null }, checks, expenses)
  r = closeReadiness(done)
  assert.equal(r.ready, true); assert.equal(r.why, '')
  // The current month cannot be closed before it ends, whatever else is ticked.
  const oct = closeItems('2026-10', TODAY, { month: '2026-10', checked: all, note: '', closed_at: null, closed_by: null, snapshot: null }, [], expenses)
  assert.equal(closeReadiness(oct).ready, false); assert.match(closeReadiness(oct).why, /not over yet/)
  assert.equal(oct.find(i => i.key === 'bills').state, 'attention')
})

test('month close: a change after closing is reported in plain words', () => {
  const was = monthSnapshot(docs, PAYMENTS, expenses, '2026-09')
  assert.deepEqual(changedSinceClose(was, was), [])
  assert.deepEqual(changedSinceClose(null, was), [])
  const now = { ...was, billed: was.billed + 100, invoices: was.invoices + 1 }
  assert.deepEqual(changedSinceClose(was, now), [
    'The amount billed was $731.82 when you closed the month and is $831.82 now.',
    'The number of invoices was 2 when you closed the month and is 3 now.',
  ])
})
