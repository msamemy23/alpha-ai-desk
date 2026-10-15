/**
 * Profit and loss for the shop's accountant: what came in, what the goods cost, what running the shop cost, and what is left.
 *
 * Two ways of counting, and the report always says which one it used:
 *   accrual: sales on the invoice date, bills on the bill date.
 *   cash:    sales on the day the money came in, bills on the day they were paid.
 * Cost of parts comes from the cost written on invoice lines ("invoices") or from parts bills entered as expenses ("purchases").
 * Both are never added together, so a part is not counted twice. Sublet and shop-supplies bills are always counted, because
 * invoices do not record what those cost.
 *
 * It reads invoices, payments and expenses and writes nothing. It is a working report for the accountant, not a tax return.
 */
import { collectedOn, inRange, isSale, round2, keyOf, parseDay, rangeLabel } from './reports.ts'
import type { Range, ReportDoc, ReportPayment } from './reports.ts'
import { partsCostOf, salesCredits } from './accounting.ts'
import { summarizeExpenses } from './expenses.ts'
import type { Basis, Expense } from './expenses.ts'

export type { Basis }
export type CogsMethod = 'invoices' | 'purchases'

export interface PlRow { key: string; label: string; amount: number }
export interface ProfitLoss {
  range: Range
  basis: Basis
  cogsMethod: CogsMethod
  income: PlRow[]
  totalIncome: number
  cogs: PlRow[]
  totalCogs: number
  grossProfit: number
  grossMarginPct: number | null
  expenses: PlRow[]
  totalExpenses: number
  netIncome: number
  netMarginPct: number | null
  /** Sales tax collected from customers in the period. It is owed to the state, so it is not income. */
  salesTax: number
  /** Part lines with a price, and how many have a cost written down (matters when cost comes from invoices). */
  partLines: number
  partsCosted: number
  notes: string[]
}

const INCOME_LABEL: Record<string, string> = {
  sales_labor: 'Labor', sales_parts: 'Parts', sales_supplies: 'Shop supplies and fees', sales_sublet: 'Sublet work', sales_core: 'Core charges',
}
const INCOME_ORDER = ['sales_labor', 'sales_parts', 'sales_supplies', 'sales_sublet', 'sales_core']

/** Splits a whole number of cents across weights so the pieces add back exactly. */
function allocate(cents: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0)
  if (!(sum > 0)) return weights.map(() => 0)
  const raw = weights.map(w => (cents * w) / sum)
  const base = raw.map(Math.floor)
  let left = cents - base.reduce((s, n) => s + n, 0)
  const order = raw.map((v, i) => ({ i, f: v - Math.floor(v) })).sort((a, b) => b.f - a.f || a.i - b.i)
  for (let k = 0; left > 0 && k < order.length; k++, left--) base[order[k].i] += 1
  return base
}

export function profitLoss(docs: ReportDoc[], payments: ReportPayment[], expenses: Expense[], range: Range, opts: { basis: Basis; cogsMethod: CogsMethod }): ProfitLoss {
  const { basis, cogsMethod } = opts
  const byId = new Map(docs.map(d => [d.id, d]))
  const income = new Map<string, number>()
  const add = (k: string, n: number) => income.set(k, round2((income.get(k) || 0) + n))
  let salesTax = 0
  let invoiceCost = 0
  let unallocated = 0
  const notes: string[] = []

  const sales = docs.filter(d => isSale(d) && d.date && inRange(d.date, range))
  let partLines = 0, partsCosted = 0
  const counted = new Set<string>()
  if (basis === 'accrual') {
    for (const d of sales) {
      for (const c of salesCredits(d)) { if (c.key === 'sales_tax') salesTax = round2(salesTax + c.amount); else add(c.key, c.amount) }
      invoiceCost = round2(invoiceCost + partsCostOf(d))
      for (const it of d.items) if (it.amount > 0) { partLines += 1; if ((it.cost ?? 0) > 0) partsCosted += 1 }
    }
  } else {
    // Cash: each payment is the share of its invoice that came in on that day, split the way the invoice is split.
    for (const p of payments) {
      const day = collectedOn(p, byId)
      if (!day || !inRange(day, range) || !(p.amount > 0)) continue
      const d = p.docId ? byId.get(p.docId) : undefined
      if (!d || !isSale(d) || !(d.total > 0)) { unallocated = round2(unallocated + p.amount); continue }
      const share = Math.min(1, p.amount / d.total)
      const credits = salesCredits(d)
      const taxPart = credits.find(c => c.key === 'sales_tax')?.amount ?? 0
      const lines = credits.filter(c => c.key !== 'sales_tax')
      const cents = Math.round(p.amount * 100)
      const taxCents = Math.min(cents, Math.round(taxPart * share * 100))
      const parts = allocate(cents - taxCents, lines.map(l => l.amount))
      lines.forEach((l, i) => add(l.key, parts[i] / 100))
      salesTax = round2(salesTax + taxCents / 100)
      invoiceCost = round2(invoiceCost + partsCostOf(d) * share)
      if (!counted.has(d.id)) {
        counted.add(d.id)
        for (const it of d.items) if (it.amount > 0) { partLines += 1; if ((it.cost ?? 0) > 0) partsCosted += 1 }
      }
    }
    if (unallocated > 0) notes.push(`${unallocated.toFixed(2)} came in on payments that are not tied to an invoice (or to a voided one). It is shown as income because the money was received, but it cannot be split by kind.`)
  }

  const incomeRows: PlRow[] = INCOME_ORDER.filter(k => (income.get(k) || 0) !== 0).map(k => ({ key: k, label: INCOME_LABEL[k], amount: income.get(k) || 0 }))
  if (unallocated > 0) incomeRows.push({ key: 'unallocated', label: 'Payments not tied to an invoice', amount: unallocated })
  const totalIncome = round2(incomeRows.reduce((s, r) => s + r.amount, 0))

  const exp = summarizeExpenses(expenses, range, basis)
  const amountOf = (k: string) => exp.byCategory.find(c => c.key === k)?.amount ?? 0
  const partsCost = cogsMethod === 'purchases' ? amountOf('parts') : invoiceCost
  const cogs: PlRow[] = [
    { key: 'cogs_parts', label: cogsMethod === 'purchases' ? 'Parts bought' : 'Cost of parts sold', amount: round2(partsCost) },
    { key: 'cogs_sublet', label: 'Sublet and outside labor', amount: amountOf('sublet') },
    { key: 'cogs_supplies', label: 'Shop supplies bought', amount: amountOf('supplies') },
  ].filter(r => r.amount !== 0)
  const totalCogs = round2(cogs.reduce((s, r) => s + r.amount, 0))
  const grossProfit = round2(totalIncome - totalCogs)

  const expenseRows: PlRow[] = exp.byCategory.filter(c => c.kind === 'operating').map(c => ({ key: c.key, label: c.label, amount: c.amount }))
  const totalExpenses = round2(expenseRows.reduce((s, r) => s + r.amount, 0))
  const netIncome = round2(grossProfit - totalExpenses)

  // What a reader should know before relying on the bottom line.
  if (cogsMethod === 'invoices' && partLines > partsCosted) notes.push(`${partLines - partsCosted} of ${partLines} part lines have no cost written down, so the cost of parts is lower than it really was and profit is higher.`)
  if (cogsMethod === 'purchases' && amountOf('parts') === 0 && totalIncome > 0) notes.push('No parts bills are entered for this period, so the cost of parts shows as zero.')
  if (cogsMethod === 'invoices' && amountOf('parts') > 0) notes.push(`Parts bills of ${amountOf('parts').toFixed(2)} are entered but not counted here, because cost of parts comes from the invoices. Switch the cost method to "parts bills" to use them instead.`)
  if (exp.count === 0) notes.push('No expenses are entered for this period, so net income is before any expenses.')
  else if (!amountOf('payroll') && totalIncome > 0) notes.push('No payroll is entered for this period. Wages are usually the biggest expense.')
  notes.push(basis === 'accrual'
    ? 'Counted when billed and when bills are dated (accrual). Money not yet received is included in income.'
    : 'Counted when money came in and when bills were paid (cash). Unpaid bills and unpaid invoices are left out.')

  return {
    range, basis, cogsMethod, income: incomeRows, totalIncome, cogs, totalCogs, grossProfit,
    grossMarginPct: totalIncome > 0 ? Math.round((grossProfit / totalIncome) * 1000) / 10 : null,
    expenses: expenseRows, totalExpenses, netIncome,
    netMarginPct: totalIncome > 0 ? Math.round((netIncome / totalIncome) * 1000) / 10 : null,
    salesTax, partLines, partsCosted, notes,
  }
}

export interface MonthColumn { key: string; label: string; income: number; cogs: number; grossProfit: number; expenses: number; net: number }

/** The same report one calendar month at a time, so the accountant can see the year at a glance. */
export function profitLossByMonth(docs: ReportDoc[], payments: ReportPayment[], expenses: Expense[], range: Range, opts: { basis: Basis; cogsMethod: CogsMethod }): MonthColumn[] {
  const out: MonthColumn[] = []
  const first = parseDay(range.from)
  const last = parseDay(range.to)
  for (let y = first.getFullYear(), m = first.getMonth(); y < last.getFullYear() || (y === last.getFullYear() && m <= last.getMonth()); m++) {
    if (m > 11) { m = 0; y++; if (y > last.getFullYear()) break }
    const start = keyOf(new Date(y, m, 1, 12))
    const end = keyOf(new Date(y, m + 1, 0, 12))
    const clipped: Range = { from: start < range.from ? range.from : start, to: end > range.to ? range.to : end }
    const pl = profitLoss(docs, payments, expenses, clipped, opts)
    out.push({
      key: start.slice(0, 7), label: parseDay(start).toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
      income: pl.totalIncome, cogs: pl.totalCogs, grossProfit: pl.grossProfit, expenses: pl.totalExpenses, net: pl.netIncome,
    })
    if (out.length > 120) break
  }
  return out
}

/** A plain file for the accountant. */
export function profitLossCsv(pl: ProfitLoss): string {
  const rows: (string | number)[][] = [
    ['Profit and loss', rangeLabel(pl.range)],
    ['Counted on', pl.basis === 'accrual' ? 'Accrual (billed and bill dates)' : 'Cash (money in and bills paid)'],
    ['Cost of parts from', pl.cogsMethod === 'invoices' ? 'Cost written on invoices' : 'Parts bills'],
    [],
    ['Income'],
    ...pl.income.map(r => [r.label, r.amount.toFixed(2)]),
    ['Total income', pl.totalIncome.toFixed(2)],
    [],
    ['Cost of goods sold'],
    ...pl.cogs.map(r => [r.label, r.amount.toFixed(2)]),
    ['Total cost of goods sold', pl.totalCogs.toFixed(2)],
    ['Gross profit', pl.grossProfit.toFixed(2)],
    [],
    ['Expenses'],
    ...pl.expenses.map(r => [r.label, r.amount.toFixed(2)]),
    ['Total expenses', pl.totalExpenses.toFixed(2)],
    ['Net income', pl.netIncome.toFixed(2)],
    [],
    ['Sales tax collected (owed to the state, not income)', pl.salesTax.toFixed(2)],
    ...pl.notes.map(n => ['Note', n]),
  ]
  const cell = (v: string | number) => {
    let s = String(v)
    if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

