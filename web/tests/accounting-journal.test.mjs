import test from 'node:test'
import assert from 'node:assert/strict'
import { PAYMENTS, THIS_MONTH, allDocs, RAW } from './helpers-reports.mjs'
import { docFrom } from '../src/lib/report-docs.ts'
import {
  ACCOUNT_DEFS, accountListCsv, accountsUsed, allAccountDefs, buildJournal, dailyTotals, expenseKind, ledgerCsv, paymentAccountKey,
  quickbooksIif, quickbooksOnlineCsv, resolveAccounts, runChecks, salesCredits, totalCredits, totalDebits, unmappedKeys,
} from '../src/lib/accounting.ts'

const docs = allDocs()
const book = resolveAccounts([])
const build = (opts, range = THIS_MONTH, d = docs, p = PAYMENTS, b = book) => buildJournal(d, p, range, b, opts)
const INDIVIDUAL = { mode: 'individual', includeCost: false, dailyCustomer: 'Daily sales' }
const DAILY = { ...INDIVIDUAL, mode: 'daily' }

const cents = n => Math.round(n * 100)

test('every entry balances to the cent, in both modes, with and without cost', () => {
  for (const opts of [INDIVIDUAL, DAILY, { ...INDIVIDUAL, includeCost: true }, { ...DAILY, includeCost: true }]) {
    for (const range of [THIS_MONTH, { from: '2026-08-01', to: '2026-10-31' }]) {
      const { entries, problems } = build(opts, range)
      assert.deepEqual(problems, [], JSON.stringify(opts))
      assert.ok(entries.length > 0)
      for (const e of entries) {
        const dr = e.lines.reduce((s, l) => s + cents(l.debit), 0), cr = e.lines.reduce((s, l) => s + cents(l.credit), 0)
        assert.equal(dr, cr, `${e.number} ${e.memo}`)
        for (const l of e.lines) assert.ok(!(l.debit > 0 && l.credit > 0), 'a line is a debit or a credit, not both')
      }
      assert.equal(totalDebits(entries), totalCredits(entries))
    }
  }
})

test('an invoice posts what the customer owes against labor, parts, supplies and tax', () => {
  const { entries } = build(INDIVIDUAL)
  const e = entries.find(x => x.number === 'INV-1001')
  assert.equal(e.date, '2026-10-02'); assert.equal(e.source, 'sales'); assert.equal(e.docId, 'd-1001')
  assert.deepEqual(e.lines.map(l => [l.account, l.debit, l.credit, l.name]), [
    ['Accounts Receivable', 427.33, 0, 'Maria Lopez'],
    ['Labor Income', 0, 200, ''], ['Parts Sales', 0, 200, ''], ['Shop Supplies Income', 0, 10, ''], ['Sales Tax Payable', 0, 17.33, ''],
  ])
  assert.equal(e.memo, 'Invoice INV-1001 - Maria Lopez')
})

test('sublet and core charges get their own accounts and the receivable still equals the invoice total', () => {
  const alt = docs.find(d => d.id === 'd-1003')
  assert.deepEqual(salesCredits(alt), [
    { key: 'sales_labor', amount: 250 }, { key: 'sales_parts', amount: 210 }, { key: 'sales_sublet', amount: 40 }, { key: 'sales_core', amount: 30 }, { key: 'sales_tax', amount: 20.63 },
  ])
  const { entries } = build(INDIVIDUAL, { from: '2026-09-01', to: '2026-09-30' })
  const e = entries.find(x => x.number === 'INV-1003')
  assert.equal(e.lines[0].debit, 550.63)
})

test('payments post on the day the money came in, into the account for the method', () => {
  const { entries } = build(INDIVIDUAL)
  const p = entries.find(x => x.number === 'PMT-INV-1001')
  assert.equal(p.source, 'payment'); assert.equal(p.date, '2026-10-02')
  assert.deepEqual(p.lines.map(l => [l.account, l.debit, l.credit, l.name]), [['Card Payments Clearing', 427.33, 0, ''], ['Accounts Receivable', 0, 427.33, 'Maria Lopez']])
  assert.equal(entries.find(x => x.number === 'PMT-INV-1002').lines[0].account, 'Undeposited Funds')
  assert.equal(paymentAccountKey('Zelle'), 'pay_digital'); assert.equal(paymentAccountKey(''), 'pay_other'); assert.equal(paymentAccountKey('check'), 'pay_check')
})

test('what is billed and what is received in the range are exactly what the entries post', () => {
  const { entries } = build(INDIVIDUAL)
  const ar = entries.flatMap(e => e.lines.filter(l => l.accountKey === 'receivable'))
  assert.equal(cents(ar.reduce((s, l) => s + l.debit, 0)), 63651, 'billed')
  assert.equal(cents(ar.reduce((s, l) => s + l.credit, 0)), 63651, 'received')
  const tax = entries.flatMap(e => e.lines.filter(l => l.accountKey === 'sales_tax')).reduce((s, l) => s + l.credit, 0)
  assert.equal(cents(tax), 2451)
})

test('cost of parts is its own entry, only for lines with a cost, and only when asked', () => {
  assert.ok(!build(INDIVIDUAL).entries.some(e => e.source === 'cost'))
  const { entries } = build({ ...INDIVIDUAL, includeCost: true })
  const cost = entries.filter(e => e.source === 'cost')
  assert.deepEqual(cost.map(e => [e.number, e.lines[0].debit, e.lines[0].account, e.lines[1].account]).sort(), [
    ['COST-INV-1001', 95, 'Cost of Goods Sold - Parts', 'Inventory Asset'], ['COST-INV-1002', 5, 'Cost of Goods Sold - Parts', 'Inventory Asset'], ['COST-RCT-1008', 12, 'Cost of Goods Sold - Parts', 'Inventory Asset'],
  ].sort())
})

test('daily mode adds a day up into one sales entry and one entry per payment method', () => {
  const twin = docFrom({ ...RAW.oil, id: 'd-2000', doc_number: 'INV-2000', customer_id: 'c9', customer_name: 'Two Same Day' })
  const pay = { id: 'p9', docId: 'd-2000', amount: 50, method: 'cash', date: '2026-10-05', customer: 'Two Same Day' }
  const { entries } = build(DAILY, THIS_MONTH, [...docs, twin], [...PAYMENTS, pay])
  const day = entries.find(e => e.number === 'S-2026-10-05')
  assert.equal(day.docId, null)
  assert.equal(day.lines[0].debit, 263.4, 'both invoices on Oct 5')
  assert.equal(day.lines[0].name, 'Daily sales', 'QuickBooks needs a name on receivable lines')
  assert.match(day.memo, /\(2 invoices\)/)
  const cash = entries.find(e => e.number === 'P-2026-10-05-cash')
  assert.equal(cash.lines[0].debit, 181.7); assert.match(cash.memo, /2 payments, Cash/)
  // One day with one invoice keeps that customer's name.
  assert.equal(entries.find(e => e.number === 'S-2026-10-02').lines[0].name, 'Maria Lopez')
})

test('journal numbers are unique and short enough for QuickBooks', () => {
  const dupe = docFrom({ ...RAW.brakes, id: 'd-dupe' })
  const long = docFrom({ ...RAW.brakes, id: 'd-long', doc_number: 'A-VERY-LONG-NUMBER-THAT-GOES-ON-AND-ON-1234' })
  const noNumber = docFrom({ ...RAW.brakes, id: 'abcdef1234567', doc_number: '' })
  const { entries } = build(INDIVIDUAL, THIS_MONTH, [...docs, dupe, long, noNumber], [])
  const numbers = entries.map(e => e.number)
  assert.equal(new Set(numbers).size, numbers.length)
  for (const n of numbers) assert.ok(n.length <= 21 && /^[A-Za-z0-9._-]+$/.test(n), n)
  assert.ok(numbers.includes('INV-1001') && numbers.includes('INV-1001-2'))
  assert.ok(numbers.includes('S-abcdef12'))
})

test('a document whose lines do not add up to its total is reported, not hidden', () => {
  const bad = { ...docs.find(d => d.id === 'd-1001'), total: 500 }
  const { entries, problems } = build(INDIVIDUAL, THIS_MONTH, [bad], [])
  assert.equal(problems.length, 1); assert.equal(problems[0].key, 'total-differs'); assert.equal(problems[0].docId, 'd-1001')
  assert.match(problems[0].message, /427\.33 from its lines but its total is 500\.00/)
  assert.equal(entries[0].lines[0].debit, 427.33, 'the entry still balances on the lines, so the file imports')
})

test('drafts, voids, estimates, zero-dollar invoices and zero payments are left out', () => {
  const zero = docFrom({ id: 'zz', type: 'Invoice', status: 'Paid', doc_date: '2026-10-03', doc_number: 'INV-ZERO', parts: [], labors: [] })
  const { entries } = build(INDIVIDUAL, THIS_MONTH, [...docs, zero], [...PAYMENTS, { id: 'p0', docId: 'd-1001', amount: 0, method: 'cash', date: '2026-10-03', customer: '' }])
  const nums = entries.map(e => e.number)
  for (const n of ['INV-1006', 'INV-1007', 'EST-2001', 'INV-ZERO']) assert.ok(!nums.includes(n), n)
  assert.ok(!nums.some(n => n.startsWith('PMT') && n.includes('p0')))
  assert.equal(entries.filter(e => e.source === 'payment').length, 4)
})

test('payments brought in from old records post on the day of the invoice they paid', () => {
  const inv = docs.find(d => d.id === 'd-1005')
  const imp = { id: 'pi', docId: 'd-1005', amount: 45, method: 'historical_import', date: '2026-12-01', customer: '' }
  const { entries } = build(INDIVIDUAL, THIS_MONTH, [inv], [imp])
  const p = entries.find(e => e.source === 'payment')
  assert.equal(p.date, '2026-10-12')
  assert.equal(p.lines[0].account, 'Undeposited Funds', 'an import has no method, so it goes to the catch-all deposit account')
})

test('the shop\'s own account names and numbers are used once saved', () => {
  const mine = resolveAccounts([
    { key: 'sales_labor', account_name: 'Service Revenue:Labor', account_number: '4010' },
    { key: 'receivable', account_name: ' A/R ', account_number: '1200' },
    { key: 'sales_parts', account_name: '   ' },
  ])
  assert.equal(mine.sales_labor.name, 'Service Revenue:Labor'); assert.equal(mine.sales_labor.number, '4010'); assert.equal(mine.sales_labor.saved, true)
  assert.equal(mine.receivable.name, 'A/R')
  assert.equal(mine.sales_parts.saved, false, 'a blank name is not a saved name')
  assert.equal(mine.sales_parts.name, 'Parts Sales')
  const { entries } = build(INDIVIDUAL, THIS_MONTH, docs, PAYMENTS, mine)
  assert.equal(entries.find(e => e.number === 'INV-1001').lines[0].account, 'A/R')
  const unmapped = unmappedKeys(mine)
  assert.ok(!unmapped.includes('sales_labor') && !unmapped.includes('receivable') && unmapped.includes('sales_parts'))
  assert.equal(unmappedKeys(book).length, allAccountDefs().length)
})

test('every account the files can use has a definition and a QuickBooks type', () => {
  const keys = new Set()
  for (const d of allAccountDefs()) { assert.ok(!keys.has(d.key)); keys.add(d.key); assert.ok(d.qbType && d.label && d.defaultName, d.key) }
  const { entries } = build({ ...INDIVIDUAL, includeCost: true })
  for (const k of accountsUsed(entries)) assert.ok(keys.has(k), k)
  assert.ok(ACCOUNT_DEFS.length >= 14)
  assert.equal(expenseKind('parts'), 'cogs'); assert.equal(expenseKind('rent'), 'operating'); assert.equal(expenseKind('nonsense'), 'operating')
})

test('QuickBooks Online CSV has the headers it asks for and one row per journal line', () => {
  const { entries } = build(INDIVIDUAL)
  const lines = quickbooksOnlineCsv(entries).trim().split('\r\n')
  assert.equal(lines[0], 'Journal No.,Journal Date,Account Name,Description,Debits,Credits,Name')
  assert.equal(lines.length, 1 + entries.reduce((s, e) => s + e.lines.length, 0))
  assert.equal(lines[1], 'INV-1001,10/02/2026,Accounts Receivable,Invoice INV-1001 - Maria Lopez,427.33,,Maria Lopez')
  assert.ok(lines.includes('INV-1001,10/02/2026,Labor Income,Invoice INV-1001 - Maria Lopez,,200.00,'))
  // The sum of the Debits column equals the Credits column.
  let dr = 0, cr = 0
  for (const l of lines.slice(1)) { const c = l.split(','); dr += Number(c.at(-3) || 0); cr += Number(c.at(-2) || 0) }
  assert.equal(Math.round(dr * 100), Math.round(cr * 100))
})

test('QuickBooks Desktop IIF is tab separated, debits positive, credits negative, and each entry nets to zero', () => {
  const { entries } = build(INDIVIDUAL)
  const text = quickbooksIif(entries)
  const rows = text.trim().split('\r\n')
  assert.deepEqual(rows.slice(0, 3), ['!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tCLASS\tAMOUNT\tDOCNUM\tMEMO', '!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tNAME\tCLASS\tAMOUNT\tDOCNUM\tMEMO', '!ENDTRNS'])
  assert.equal(rows[3], 'TRNS\t\tGENERAL JOURNAL\t10/02/2026\tAccounts Receivable\tMaria Lopez\t\t427.33\tINV-1001\tInvoice INV-1001 - Maria Lopez')
  assert.equal(rows[4], 'SPL\t\tGENERAL JOURNAL\t10/02/2026\tLabor Income\t\t\t-200.00\tINV-1001\tInvoice INV-1001 - Maria Lopez')
  // Walk the entries: amounts between TRNS and ENDTRNS sum to zero, and every row has 10 columns.
  let sum = 0, open = false, n = 0
  for (const r of rows.slice(3)) {
    const c = r.split('\t')
    if (c[0] === 'ENDTRNS') { assert.ok(Math.abs(sum) < 0.005, `entry nets to ${sum}`); sum = 0; open = false; n += 1; continue }
    assert.equal(c.length, 10, r)
    assert.ok(c[0] === 'TRNS' ? !open : open, 'the first row opens an entry and the rest follow'); open = true
    sum += Number(c[7])
  }
  assert.equal(n, entries.length)
})

test('text in names cannot break the files or run as a spreadsheet formula', () => {
  const evil = docFrom({ ...RAW.brakes, id: 'evil', doc_number: 'INV-EVIL', customer_name: '=HYPERLINK("http://x")\tTab\nNewline' })
  const { entries } = build(INDIVIDUAL, THIS_MONTH, [evil], [])
  const csv = quickbooksOnlineCsv(entries)
  assert.ok(csv.includes('"\'=HYPERLINK(""http://x"")\tTab\nNewline"'), csv)
  const iif = quickbooksIif(entries)
  for (const r of iif.trim().split('\r\n').slice(3)) assert.ok(r === 'ENDTRNS' || r.split('\t').length === 10, r)
  assert.ok(!/\t\t\t\t\t\t\t/.test(iif.split('\r\n')[3]))
})

test('the ledger file and the account list are plain CSV an accountant can open', () => {
  const { entries } = build({ ...INDIVIDUAL, includeCost: true })
  const ledger = ledgerCsv(entries).trim().split('\r\n')
  assert.equal(ledger[0], 'Date,Journal no.,Account,Account number,Name,Memo,Debit,Credit,Kind')
  assert.ok(ledger.some(l => l.endsWith(',Cost of parts')) && ledger.some(l => l.endsWith(',Payment')) && ledger.some(l => l.endsWith(',Sales')))
  const list = accountListCsv(book, accountsUsed(entries)).trim().split('\r\n')
  assert.equal(list[0], 'Account,Number,Type,Used for')
  const names = list.slice(1).map(l => l.split(',')[0])
  assert.equal(new Set(names).size, names.length, 'an account used for two things is listed once')
  assert.ok(names.includes('Undeposited Funds') && names.includes('Accounts Receivable'))
})

test('day by day totals hold up against the end-of-day report', () => {
  const rows = dailyTotals(docs, PAYMENTS, THIS_MONTH)
  assert.deepEqual(rows.map(r => r.date), ['2026-10-02', '2026-10-05', '2026-10-12', '2026-10-13'])
  assert.deepEqual([rows[0].invoices, rows[0].sales, rows[0].tax, rows[0].billed, rows[0].collected], [1, 410, 17.33, 427.33, 427.33])
  assert.deepEqual(rows[0].byMethod, [{ label: 'Card', amount: 427.33 }])
  assert.equal(Math.round(rows.reduce((s, r) => s + r.billed, 0) * 100), 63651)
  assert.equal(Math.round(rows.reduce((s, r) => s + r.collected, 0) * 100), 63651)
})

test('checks find what an accountant would find and say which invoices', () => {
  const journal = build(INDIVIDUAL)
  const ok = runChecks(docs, PAYMENTS, THIS_MONTH, journal)
  // The one thing to look at in the sample month is the draft invoice that was never finished.
  assert.deepEqual(ok.filter(c => c.state !== 'ok').map(c => [c.key, c.ids]), [['drafts', ['d-1006']]])

  const aug = { from: '2026-08-01', to: '2026-08-31' }
  const augChecks = runChecks(docs, PAYMENTS, aug, build(INDIVIDUAL, aug))
  const paidNoPay = augChecks.find(c => c.key === 'paid-no-payment')
  assert.equal(paidNoPay.state, 'attention'); assert.deepEqual(paidNoPay.ids, ['d-0900'])
  assert.match(paidNoPay.detail, /1 invoice is marked Paid with no payment recorded/)

  const noName = docFrom({ ...RAW.brakes, id: 'nn', doc_number: 'INV-NN', customer_id: null, customer_name: '' })
  const dupe = docFrom({ ...RAW.brakes, id: 'dupe' })
  const draft = docFrom({ ...RAW.brakes, id: 'dr', doc_number: 'INV-DR', status: 'Draft' })
  const loose = { id: 'pl', docId: null, amount: 10, method: 'cash', date: '2026-10-04', customer: '' }
  const early = { id: 'pe', docId: 'd-1005', amount: 5, method: 'cash', date: '2026-10-02', customer: '' }
  const all = [...docs, noName, dupe, draft]
  const pays = [...PAYMENTS, loose, early]
  const res = Object.fromEntries(runChecks(all, pays, THIS_MONTH, build(INDIVIDUAL, THIS_MONTH, all, pays)).map(c => [c.key, c]))
  assert.deepEqual(res['no-customer'].ids, ['nn'])
  assert.deepEqual(res['loose-payments'].ids, ['pl'])
  assert.deepEqual(res['early-payments'].ids, ['pe'])
  assert.deepEqual(res.drafts.ids.sort(), ['d-1006', 'dr'])
  assert.deepEqual(res['duplicate-numbers'].ids.sort(), ['d-1001', 'dupe'])
  for (const k of ['no-customer', 'loose-payments', 'early-payments', 'drafts', 'duplicate-numbers']) assert.equal(res[k].state, 'attention', k)

  const tampered = [{ ...docs[0], total: 500 }]
  const t = Object.fromEntries(runChecks(tampered, [], THIS_MONTH, build(INDIVIDUAL, THIS_MONTH, tampered, [])).map(c => [c.key, c]))
  assert.equal(t.totals.state, 'attention'); assert.deepEqual(t.totals.ids, ['d-1001'])
  assert.equal(t['billed-matches'].state, 'attention', 'billed 500 but the lines post 427.33')
})
