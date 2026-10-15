import test from 'node:test'
import assert from 'node:assert/strict'
import { PAYMENTS, RAW_EXPENSES, THIS_MONTH, TODAY, allDocs } from './helpers-reports.mjs'
import { expenseFrom } from '../src/lib/expenses.ts'
import { bundleFor, categoryBlock, moneyBlock, summaryBundle, salesBundle, receivablesBundle, taxBundle, profitBundle } from '../src/lib/report-bundles.ts'
import { blockCsv, emailHtml, plainText, printableHtml } from '../src/lib/report-files.ts'
import { summarize } from '../src/lib/reports.ts'
import { normalizeComponents } from '../src/lib/sales-tax.ts'
import { profitLoss } from '../src/lib/profit-loss.ts'
import { REPORT_KINDS } from '../src/lib/saved-reports.ts'

const input = {
  docs: allDocs(), payments: PAYMENTS, expenses: RAW_EXPENSES.map(expenseFrom), range: THIS_MONTH, previous: { from: '2026-09-01', to: '2026-09-14' },
  phrase: 'this month', vs: 'the same days last month', periodTitle: 'This month', todayKey: TODAY, shopName: 'Test Auto',
  taxComponents: normalizeComponents([{ name: 'State', ratePct: 6.25, agency: 'State comptroller' }, { name: 'City', ratePct: 2, agency: 'City' }]),
  laborCostPerHour: null, postedRate: 100, basis: 'accrual', cogsMethod: 'invoices', calls: null,
}

test('every kind of report can be built, and each carries tables, a headline and no raw html', () => {
  for (const k of REPORT_KINDS) {
    const b = bundleFor(k.key, input)
    assert.ok(b.title && b.subtitle && b.blocks.length > 0, k.key)
    assert.equal(b.shopName, 'Test Auto')
    for (const blk of b.blocks) {
      for (const r of blk.rows) assert.equal(r.length, blk.columns.length, `${k.key}/${blk.id}: a row has a cell for every column`)
      if (blk.footer) assert.equal(blk.footer.length, blk.columns.length)
      assert.ok(blockCsv(blk).startsWith(blk.columns.map(c => (c.label.includes(',') ? `"${c.label}"` : c.label)).join(',')), `${k.key}/${blk.id}: csv starts with the column names`)
    }
    for (const out of [printableHtml(b), emailHtml(b), plainText(b)]) assert.ok(out.length > 200)
  }
})

test('the emailed numbers are the screen numbers: the money table comes from the same summary', () => {
  const now = summarize(input.docs, input.payments, input.range)
  const csv = blockCsv(moneyBlock(input)).trim().split('\r\n')
  assert.equal(csv[0], 'Measure,This period,Compared with the same days last month,Change')
  assert.equal(csv[1].split(',').slice(0, 2).join(','), `Billed,${now.invoiced.toFixed(2)}`)
  assert.equal(csv[2].split(',').slice(0, 2).join(','), `Collected,${now.collected.toFixed(2)}`)
  assert.equal(csv[3].split(',').slice(0, 2).join(','), `Invoices,${now.invoices}`)
  assert.ok(csv[1].endsWith(',–'), 'nothing to compare with in the earlier days, so no percentage')
})

test('the summary tells the owner the cash-versus-billed difference in words', () => {
  const b = summaryBundle(input)
  assert.equal(b.headline, 'You collected $637 this month.')
  assert.ok(b.notes.some(n => /Billed is counted on the invoice date \(accrual\)/.test(n)))
  assert.ok(b.notes.some(n => /about the same/.test(n)))
  assert.deepEqual(b.blocks.map(x => x.id), ['money', 'methods', 'categories', 'aging'])
})

test('the sales report states what it could not use', () => {
  const b = salesBundle(input)
  assert.match(b.headline, /4 invoices for 3 cars/)
  assert.ok(b.bullets.includes('Effective labor rate: $96.67 per hour billed, against a posted rate of $100.00.'))
  assert.ok(b.bullets.includes('1 new and 1 returning customer.') || b.bullets.some(x => /1 new and 1 returning/.test(x)))
  assert.ok(b.notes.some(n => /1 flat-priced labor line is left out of the labor rate/.test(n)))
  assert.ok(b.notes.some(n => /1 of 3 cars were back within 30 days/.test(n)))
  const advisors = b.blocks.find(x => x.id === 'advisors')
  assert.match(advisors.note, /1 invoice names nobody as the writer/)
  assert.equal(categoryBlock(input).footer[2], 612)
})

test('the receivables report lists every open invoice and customer', () => {
  const b = receivablesBundle(input)
  assert.equal(b.headline, 'Customers owe you $450.63 on 1 invoice.')
  assert.deepEqual(b.blocks.map(x => x.id), ['aging', 'owed-customers', 'open-invoices'])
  assert.deepEqual(b.blocks[2].rows[0].slice(0, 2), ['INV-1003', 'Priya Shah'])
  assert.match(b.subtitle, /^As of Oct 14, 2026$/)
})

test('the tax report splits by authority and names the invoices charged at another rate', () => {
  const b = taxBundle(input)
  assert.match(b.headline, /Sales tax charged: \$24\.51 on \$297\.00 of taxable sales/)
  const auth = b.blocks[0]
  assert.equal(auth.rows.length, 2); assert.equal(auth.footer[3], 24.51)
  assert.ok(!b.notes.some(n => /instead of/.test(n)), 'the split adds to the rate charged, so no invoice is called out')
  assert.ok(b.notes.some(n => /1 invoice has no tax charged/.test(n)))
  assert.ok(b.notes.some(n => /not tax advice/.test(n)))
})

test('the profit report uses the same figures as profitLoss', () => {
  const pl = profitLoss(input.docs, input.payments, input.expenses, input.range, { basis: 'accrual', cogsMethod: 'invoices' })
  const b = profitBundle(input)
  assert.ok(b.headline.startsWith('Net loss: $2,430.40 on $612.00 of income.'), b.headline)
  assert.equal(b.blocks[0].footer[1], pl.netIncome)
  assert.ok(b.notes.some(n => /not a tax return/.test(n)))
})

test('reports for a shop with no data say so instead of failing', () => {
  const empty = { ...input, docs: [], payments: [], expenses: [] }
  for (const k of REPORT_KINDS) {
    const b = bundleFor(k.key, empty)
    assert.ok(b.title && Array.isArray(b.blocks), k.key)
    assert.ok(plainText(b).length > 20)
  }
  assert.equal(summaryBundle(empty).headline, 'No money came in this month.')
})
