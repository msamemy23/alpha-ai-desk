/**
 * The saved and emailed reports, assembled from the same functions the Reports screen uses.
 * Each builder takes documents, payments and settings and returns a ReportBundle: a headline, a few sentences, and tables.
 * Because the screen and the email call the same functions, an emailed number can never disagree with the screen.
 */
import { aging, byMethod, change, partsMargin, rangeLabel, summarize, topCustomers, topRepairs, unrecordedPaid } from './reports.ts'
import type { Range, ReportDoc, ReportPayment } from './reports.ts'
import {
  approvalStats, carCount, CASH_VS_ACCRUAL_NOTE, cashVsAccrual, effectiveLaborRate, owedByCustomer, repeatVisits, salesByAdvisor, salesByCategory, salesByTech, NOT_RECORDED,
} from './report-metrics.ts'
import { whatChanged } from './report-summary.ts'
import { taxByPeriod, taxReport } from './sales-tax.ts'
import type { TaxComponent } from './sales-tax.ts'
import { profitLoss, profitLossByMonth } from './profit-loss.ts'
import type { Basis, CogsMethod } from './profit-loss.ts'
import type { Expense } from './expenses.ts'
import type { Block, ReportBundle } from './report-files.ts'
import type { ReportKind } from './saved-reports.ts'

export interface BundleInput {
  docs: ReportDoc[]
  payments: ReportPayment[]
  expenses: Expense[]
  range: Range
  previous: Range | null
  /** "this week", "in the last 30 days". */
  phrase: string
  /** "last week". Empty when there is no comparison. */
  vs: string
  /** The name of the period, for the title. */
  periodTitle: string
  todayKey: string
  shopName: string
  taxComponents: TaxComponent[]
  laborCostPerHour: number | null
  postedRate: number | null
  basis: Basis
  cogsMethod: CogsMethod
  calls?: { now: number; before: number } | null
}

const header = (inp: BundleInput, title: string): ReportBundle => ({
  title, subtitle: rangeLabel(inp.range), shopName: inp.shopName.trim(), generated: `Made ${rangeLabel({ from: inp.todayKey, to: inp.todayKey })} from the shop's invoices, payments and expenses.`,
  bullets: [], blocks: [], notes: [],
})

const pctWords = (now: number, before: number): string => {
  const c = change(now, before)
  return c.kind === 'none' ? '–' : c.kind === 'same' ? 'Same' : `${c.kind === 'up' ? 'Up' : 'Down'} ${c.pct}%`
}

/* ---------- blocks that more than one report uses ---------- */

export function moneyBlock(inp: BundleInput): Block {
  const now = summarize(inp.docs, inp.payments, inp.range)
  const before = inp.previous ? summarize(inp.docs, inp.payments, inp.previous) : null
  const row = (label: string, a: number, b: number | undefined, kind: 'money' | 'int'): (string | number | { n: number; kind: 'money' | 'int' } | null)[] =>
    [label, { n: a, kind }, b === undefined ? null : { n: b, kind }, b === undefined ? '' : pctWords(a, b)]
  return {
    id: 'money', heading: 'Money', note: 'Billed is by invoice date. Collected is by the day the money came in.',
    columns: [{ label: 'Measure', kind: 'text' }, { label: 'This period', kind: 'money' }, { label: inp.vs ? `Compared with ${inp.vs}` : 'Before', kind: 'money' }, { label: 'Change', kind: 'text' }],
    rows: [
      row('Billed', now.invoiced, before?.invoiced, 'money'), row('Collected', now.collected, before?.collected, 'money'), row('Invoices', now.invoices, before?.invoices, 'int'),
      row('Average invoice', now.average, before?.average, 'money'), row('Labor', now.labor, before?.labor, 'money'), row('Parts', now.parts, before?.parts, 'money'),
      row('Shop supplies, sublet and core', now.fees, before?.fees, 'money'), row('Sales tax', now.tax, before?.tax, 'money'),
    ],
  }
}

export function categoryBlock(inp: BundleInput): Block {
  const c = salesByCategory(inp.docs, inp.range)
  return {
    id: 'categories', heading: 'Sales by kind of work', note: 'Before sales tax. Lines are grouped by the words on them, so a line the rules do not recognise lands in "Other work".',
    columns: [{ label: 'Kind of work', kind: 'text' }, { label: 'Invoices', kind: 'int' }, { label: 'Sales', kind: 'money' }],
    rows: c.slices.map(s => [s.label, s.count, s.amount]),
    footer: c.slices.length ? ['Total', null, c.slices.reduce((t, s) => t + s.amount, 0)] : undefined,
    empty: 'No invoices in this period.',
  }
}

export function advisorBlock(inp: BundleInput): Block {
  const a = salesByAdvisor(inp.docs, inp.range)
  const unrecorded = a.find(s => s.label === NOT_RECORDED)
  return {
    id: 'advisors', heading: 'Sales by advisor', note: unrecorded ? `${unrecorded.count} ${unrecorded.count === 1 ? 'invoice names' : 'invoices name'} nobody as the writer, so ${unrecorded.count === 1 ? 'it is' : 'they are'} listed as "${NOT_RECORDED}".` : 'Before sales tax, by whoever wrote the invoice.',
    columns: [{ label: 'Advisor', kind: 'text' }, { label: 'Invoices', kind: 'int' }, { label: 'Sales', kind: 'money' }],
    rows: a.map(s => [s.label, s.count, s.amount]), empty: 'No invoices in this period.',
  }
}

export function techBlock(inp: BundleInput): Block {
  const t = salesByTech(inp.docs, inp.range)
  return {
    id: 'techs', heading: 'Labor sold by technician', note: 'Labor lines that name a technician. Flat-priced lines add dollars but no hours.',
    columns: [{ label: 'Technician', kind: 'text' }, { label: 'Invoices', kind: 'int' }, { label: 'Hours billed', kind: 'hours' }, { label: 'Labor sold', kind: 'money' }],
    rows: t.map(s => [s.label, s.count, s.hours ?? 0, s.amount]), empty: 'No labor in this period.',
  }
}

export function agingBlock(inp: BundleInput): Block {
  const a = aging(inp.docs, inp.todayKey)
  return {
    id: 'aging', heading: 'What customers owe', note: 'By how long ago the invoice was written, as of today.',
    columns: [{ label: 'Age', kind: 'text' }, { label: 'Invoices', kind: 'int' }, { label: 'Owed', kind: 'money' }],
    rows: a.buckets.map(b => [b.label, b.count, b.amount]), footer: ['Total', a.open.length, a.total], empty: 'Nothing is owed.',
  }
}

export function owedCustomersBlock(inp: BundleInput, limit = 25): Block {
  const o = owedByCustomer(inp.docs, inp.todayKey)
  return {
    id: 'owed-customers', heading: 'Customers who owe you', note: o.length > limit ? `The ${limit} biggest of ${o.length}.` : undefined,
    columns: [{ label: 'Customer', kind: 'text' }, { label: 'Invoices', kind: 'int' }, { label: 'Oldest (days)', kind: 'int' }, { label: 'Owed', kind: 'money' }, { label: 'Phone', kind: 'text' }],
    rows: o.slice(0, limit).map(c => [c.name, c.count, c.oldestDays, c.amount, c.phone]), empty: 'Nobody owes you anything.',
  }
}

/* ---------- reports ---------- */

export function summaryBundle(inp: BundleInput): ReportBundle {
  const b = header(inp, 'Shop summary')
  const s = whatChanged({ docs: inp.docs, payments: inp.payments, range: inp.range, previous: inp.previous, todayKey: inp.todayKey, phrase: inp.phrase, vs: inp.vs, calls: inp.calls })
  b.headline = s.headline
  b.bullets = s.points.map(p => p.text)
  const now = summarize(inp.docs, inp.payments, inp.range)
  const cva = cashVsAccrual(now.invoiced, now.collected)
  b.blocks = [moneyBlock(inp), categoryBlock(inp), agingBlock(inp)]
  const methods = byMethod(inp.payments, new Map(inp.docs.map(d => [d.id, d])), inp.range)
  if (methods.length) b.blocks.splice(1, 0, { id: 'methods', heading: 'How people paid', columns: [{ label: 'Method', kind: 'text' }, { label: 'Payments', kind: 'int' }, { label: 'Received', kind: 'money' }], rows: methods.map(m => [m.label, m.count, m.amount]) })
  b.notes.push(cva.words, CASH_VS_ACCRUAL_NOTE)
  return b
}

export function salesBundle(inp: BundleInput): ReportBundle {
  const b = header(inp, 'Sales breakdown')
  const cars = carCount(inp.docs, inp.range)
  const rate = effectiveLaborRate(inp.docs, inp.range, inp.postedRate)
  const margin = partsMargin(inp.docs, inp.range)
  const now = summarize(inp.docs, inp.payments, inp.range)
  b.headline = now.invoices ? `${now.invoices} ${now.invoices === 1 ? 'invoice' : 'invoices'} for ${cars.cars} ${cars.cars === 1 ? 'car' : 'cars'}.` : 'No invoices in this period.'
  if (now.invoices) {
    b.bullets.push(`Average repair order: $${now.average.toFixed(2)}.`)
    if (cars.newCustomers + cars.returningCustomers > 0) b.bullets.push(`${cars.newCustomers} new and ${cars.returningCustomers} returning ${cars.newCustomers + cars.returningCustomers === 1 ? 'customer' : 'customers'}.`)
    if (rate.rate !== null) b.bullets.push(`Effective labor rate: $${rate.rate.toFixed(2)} per hour billed${rate.posted ? `, against a posted rate of $${rate.posted.toFixed(2)}` : ''}.`)
    if (margin.pct !== null) b.bullets.push(`Parts margin: ${margin.pct}% on the part lines that have a cost.`)
  }
  b.blocks = [categoryBlock(inp), advisorBlock(inp), techBlock(inp)]
  const repairs = topRepairs(inp.docs, inp.range, 10)
  if (repairs.length) b.blocks.push({ id: 'repairs', heading: 'Repairs billed most', columns: [{ label: 'Repair', kind: 'text' }, { label: 'Times', kind: 'int' }, { label: 'Billed', kind: 'money' }], rows: repairs.map(r => [r.label, r.count, r.amount]) })
  const top = topCustomers(inp.docs, inp.range, 10)
  if (top.length) b.blocks.push({ id: 'top-customers', heading: 'Customers billed most', columns: [{ label: 'Customer', kind: 'text' }, { label: 'Invoices', kind: 'int' }, { label: 'Billed', kind: 'money' }], rows: top.map(c => [c.name, c.count, c.amount]) })
  const ap = approvalStats(inp.docs, inp.range, inp.todayKey)
  if (ap.sent) b.notes.push(`Approval rate counts approvals through the online link only: ${ap.approved} of ${ap.sent} sent were approved online. Customers who said yes in person or on the phone are not counted.`)
  const rep = repeatVisits(inp.docs, inp.range)
  if (rep.considered) b.notes.push(`${rep.count} of ${rep.considered} cars were back within ${rep.withinDays} days of an earlier non-routine visit. Some are comebacks and some are new problems; open each to tell.`)
  if (rate.flatLines) b.notes.push(`${rate.flatLines} flat-priced labor ${rate.flatLines === 1 ? 'line is' : 'lines are'} left out of the labor rate because there are no hours to divide by.`)
  return b
}

export function receivablesBundle(inp: BundleInput): ReportBundle {
  const b = header(inp, 'Who owes you')
  const a = aging(inp.docs, inp.todayKey)
  b.subtitle = `As of ${rangeLabel({ from: inp.todayKey, to: inp.todayKey })}`
  b.headline = a.open.length ? `Customers owe you $${a.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} on ${a.open.length} ${a.open.length === 1 ? 'invoice' : 'invoices'}.` : 'Nobody owes you anything.'
  const old = a.open.filter(o => o.days > 60)
  if (old.length) b.bullets.push(`${old.length} ${old.length === 1 ? 'invoice is' : 'invoices are'} more than 60 days old ($${old.reduce((s, o) => s + o.doc.balance, 0).toFixed(2)}).`)
  b.blocks = [agingBlock(inp), owedCustomersBlock(inp, 50), {
    id: 'open-invoices', heading: 'Open invoices', columns: [{ label: 'Invoice', kind: 'text' }, { label: 'Customer', kind: 'text' }, { label: 'Date', kind: 'text' }, { label: 'Age (days)', kind: 'int' }, { label: 'Total', kind: 'money' }, { label: 'Owed', kind: 'money' }],
    rows: a.open.map(o => [o.doc.number || '', o.doc.customer, o.doc.date, o.days, o.doc.total, o.doc.balance]), empty: 'Nothing is owed.',
  }]
  const unrec = unrecordedPaid(inp.docs, inp.payments)
  if (unrec.count) b.notes.push(`${unrec.count} ${unrec.count === 1 ? 'invoice is' : 'invoices are'} marked Paid with no payment recorded ($${unrec.amount.toFixed(2)}). They show as owing nothing.`)
  return b
}

export function taxBundle(inp: BundleInput): ReportBundle {
  const b = header(inp, 'Sales tax')
  const t = taxReport(inp.docs, inp.range, inp.taxComponents)
  b.headline = `Sales tax charged: $${t.tax.toFixed(2)} on $${t.taxable.toFixed(2)} of taxable sales.`
  b.bullets.push(`Billed before tax: $${t.sales.toFixed(2)}, of which $${t.nonTaxable.toFixed(2)} was not taxable.`)
  const rows: (string | number | null)[][] = t.byComponent.map(c => [c.name, c.agency, c.ratePct, c.tax])
  b.blocks = [{
    id: 'tax-authorities', heading: 'Tax by authority', note: t.configured ? 'Each invoice\'s tax is split by the shares you set in Settings, to the cent.' : 'No split is set up yet, so only the total is shown. Add the state and local rates on the Accounting tab.',
    columns: [{ label: 'Authority', kind: 'text' }, { label: 'Agency', kind: 'text' }, { label: 'Rate (%)', kind: 'hours' }, { label: 'Tax', kind: 'money' }],
    rows, footer: ['Total', null, null, t.tax],
  }]
  const months = taxByPeriod(inp.docs, inp.range, inp.taxComponents, 'month')
  b.blocks.push({
    id: 'tax-months', heading: 'Tax by month', columns: [{ label: 'Month', kind: 'text' }, { label: 'Invoices', kind: 'int' }, { label: 'Sales', kind: 'money' }, { label: 'Taxable', kind: 'money' }, { label: 'Tax', kind: 'money' }],
    rows: months.map(m => [m.label, m.invoices, m.sales, m.taxable, m.tax]), empty: 'No invoices in this period.',
  })
  if (t.ratesDiffer.count) b.notes.push(`${t.ratesDiffer.count} ${t.ratesDiffer.count === 1 ? 'invoice was' : 'invoices were'} charged ${t.ratesDiffer.rates.map(r => `${r}%`).join(' or ')} instead of ${t.configured ? t.byComponent.reduce((s, c) => s + c.ratePct, 0) : ''}%. Their tax is still split by the same shares.`)
  if (t.untaxed.count) b.notes.push(`${t.untaxed.count} ${t.untaxed.count === 1 ? 'invoice has' : 'invoices have'} no tax charged.`)
  b.notes.push('This is bookkeeping help, not tax advice. Check the split and the filing rules with your accountant.')
  return b
}

export function profitBundle(inp: BundleInput): ReportBundle {
  const b = header(inp, 'Profit and loss')
  const pl = profitLoss(inp.docs, inp.payments, inp.expenses, inp.range, { basis: inp.basis, cogsMethod: inp.cogsMethod })
  const row = (label: string, v: number) => [label, v]
  b.headline = `${pl.netIncome >= 0 ? 'Net income' : 'Net loss'}: $${Math.abs(pl.netIncome).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} on $${pl.totalIncome.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} of income.`
  b.blocks = [{
    id: 'pl', heading: pl.basis === 'accrual' ? 'Profit and loss (accrual)' : 'Profit and loss (cash)',
    columns: [{ label: 'Line', kind: 'text' }, { label: 'Amount', kind: 'money' }],
    rows: [
      ['Income', null], ...pl.income.map(r => row(`  ${r.label}`, r.amount)), row('Total income', pl.totalIncome),
      ['Cost of goods sold', null], ...pl.cogs.map(r => row(`  ${r.label}`, r.amount)), row('Total cost of goods sold', pl.totalCogs), row('Gross profit', pl.grossProfit),
      ['Expenses', null], ...pl.expenses.map(r => row(`  ${r.label}`, r.amount)), row('Total expenses', pl.totalExpenses),
    ],
    footer: ['Net income', pl.netIncome],
  }]
  const months = profitLossByMonth(inp.docs, inp.payments, inp.expenses, inp.range, { basis: inp.basis, cogsMethod: inp.cogsMethod })
  if (months.length > 1) b.blocks.push({
    id: 'pl-months', heading: 'By month', columns: [{ label: 'Month', kind: 'text' }, { label: 'Income', kind: 'money' }, { label: 'Cost of goods', kind: 'money' }, { label: 'Expenses', kind: 'money' }, { label: 'Net', kind: 'money' }],
    rows: months.map(m => [m.label, m.income, m.cogs, m.expenses, m.net]),
  })
  b.notes.push(...pl.notes, `Sales tax collected ($${pl.salesTax.toFixed(2)}) is owed to the state and is not income. This report is a working copy for your accountant, not a tax return.`)
  return b
}

export function bundleFor(kind: ReportKind, inp: BundleInput): ReportBundle {
  switch (kind) {
    case 'sales': return salesBundle(inp)
    case 'profit': return profitBundle(inp)
    case 'receivables': return receivablesBundle(inp)
    case 'tax': return taxBundle(inp)
    default: return summaryBundle(inp)
  }
}

