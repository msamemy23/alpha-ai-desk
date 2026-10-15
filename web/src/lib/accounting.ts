/**
 * The books side of the paperwork: which account each kind of money goes to, journal entries built from invoices and payments,
 * the files an accountant imports (QuickBooks Online CSV, QuickBooks Desktop IIF, a plain ledger), and the checks that the
 * numbers agree before the files go out.
 *
 * It only reads invoices and payments. Nothing here changes either, and an entry is always built so its debits equal its
 * credits: the debit side is the sum of the credit side, and any difference from the invoice's own total is reported as a problem
 * instead of being quietly absorbed.
 */
import { collectedOn, csvCell, inRange, isSale, methodKey, methodLabel, round2, balanceFor } from './reports.ts'
import type { Range, ReportDoc, ReportPayment } from './reports.ts'
import type { Expense } from './expenses.ts'

/* ---------- accounts ---------- */

export type AccountGroup = 'income' | 'liability' | 'asset' | 'cogs' | 'deposit' | 'expense'

export interface AccountDef {
  key: string
  label: string
  group: AccountGroup
  /** The name used until the shop saves its own. Chosen to match what most QuickBooks charts already call these. */
  defaultName: string
  /** The account type QuickBooks asks for when it creates the account. */
  qbType: string
  help: string
}

export const ACCOUNT_DEFS: AccountDef[] = [
  { key: 'sales_labor', label: 'Labor sales', group: 'income', defaultName: 'Labor Income', qbType: 'Income', help: 'Money charged for labor on invoices.' },
  { key: 'sales_parts', label: 'Parts sales', group: 'income', defaultName: 'Parts Sales', qbType: 'Income', help: 'Money charged for parts.' },
  { key: 'sales_supplies', label: 'Shop supplies', group: 'income', defaultName: 'Shop Supplies Income', qbType: 'Income', help: 'The shop supplies charge, and any other fee that is not itemised.' },
  { key: 'sales_sublet', label: 'Sublet work', group: 'income', defaultName: 'Sublet Income', qbType: 'Income', help: 'Work sent to another shop and billed to the customer.' },
  { key: 'sales_core', label: 'Core charges', group: 'income', defaultName: 'Core Charges', qbType: 'Income', help: 'Refundable core charges added to invoices.' },
  { key: 'sales_tax', label: 'Sales tax owed', group: 'liability', defaultName: 'Sales Tax Payable', qbType: 'Other Current Liability', help: 'Sales tax collected from customers that is owed to the state.' },
  { key: 'payable', label: 'Bills you owe', group: 'liability', defaultName: 'Accounts Payable', qbType: 'Accounts payable (A/P)', help: 'Bills from vendors that are not paid yet.' },
  { key: 'receivable', label: 'Customers owe you', group: 'asset', defaultName: 'Accounts Receivable', qbType: 'Accounts receivable (A/R)', help: 'Unpaid invoices.' },
  { key: 'cogs_parts', label: 'Cost of parts sold', group: 'cogs', defaultName: 'Cost of Goods Sold - Parts', qbType: 'Cost of Goods Sold', help: 'What parts cost you, from the cost written on part lines.' },
  { key: 'inventory', label: 'Parts on the shelf', group: 'asset', defaultName: 'Inventory Asset', qbType: 'Other Current Asset', help: 'The value of parts you stock.' },
  { key: 'pay_cash', label: 'Paid in cash', group: 'deposit', defaultName: 'Undeposited Funds', qbType: 'Other Current Asset', help: 'Where cash payments go until you bank them.' },
  { key: 'pay_card', label: 'Paid by card', group: 'deposit', defaultName: 'Card Payments Clearing', qbType: 'Other Current Asset', help: 'Card payments, until the processor pays out.' },
  { key: 'pay_check', label: 'Paid by check', group: 'deposit', defaultName: 'Undeposited Funds', qbType: 'Other Current Asset', help: 'Checks, until you bank them.' },
  { key: 'pay_digital', label: 'Paid by Zelle, Venmo and similar', group: 'deposit', defaultName: 'Checking', qbType: 'Bank', help: 'Bank transfers and payment apps.' },
  { key: 'pay_other', label: 'Other or unrecorded payments', group: 'deposit', defaultName: 'Undeposited Funds', qbType: 'Other Current Asset', help: 'Payments with no method written down.' },
  { key: 'paid_from', label: 'Expenses are paid from', group: 'deposit', defaultName: 'Checking', qbType: 'Bank', help: 'The account bills and expenses are paid out of.' },
]

export const EXPENSE_CATEGORIES: { key: string; label: string; kind: 'cogs' | 'operating' }[] = [
  { key: 'parts', label: 'Parts bought', kind: 'cogs' },
  { key: 'sublet', label: 'Sublet and outside labor', kind: 'cogs' },
  { key: 'supplies', label: 'Shop supplies bought', kind: 'cogs' },
  { key: 'payroll', label: 'Payroll and wages', kind: 'operating' },
  { key: 'rent', label: 'Rent', kind: 'operating' },
  { key: 'utilities', label: 'Utilities', kind: 'operating' },
  { key: 'insurance', label: 'Insurance', kind: 'operating' },
  { key: 'marketing', label: 'Advertising and marketing', kind: 'operating' },
  { key: 'software', label: 'Software and subscriptions', kind: 'operating' },
  { key: 'tools', label: 'Tools and equipment', kind: 'operating' },
  { key: 'vehicle', label: 'Vehicle and fuel', kind: 'operating' },
  { key: 'fees', label: 'Card and bank fees', kind: 'operating' },
  { key: 'taxes', label: 'Taxes and licenses', kind: 'operating' },
  { key: 'repairs', label: 'Repairs and maintenance', kind: 'operating' },
  { key: 'professional', label: 'Accounting and legal', kind: 'operating' },
  { key: 'other', label: 'Other expenses', kind: 'operating' },
]

export const expenseKind = (cat: string): 'cogs' | 'operating' => EXPENSE_CATEGORIES.find(c => c.key === cat)?.kind ?? 'operating'
export const expenseLabel = (cat: string): string => EXPENSE_CATEGORIES.find(c => c.key === cat)?.label ?? 'Other expenses'

/** Every account the shop maps, expense categories included. */
export function allAccountDefs(): AccountDef[] {
  return [
    ...ACCOUNT_DEFS,
    ...EXPENSE_CATEGORIES.map(c => ({
      key: `exp_${c.key}`, label: c.label, group: (c.kind === 'cogs' ? 'cogs' : 'expense') as AccountGroup,
      defaultName: c.kind === 'cogs' ? `Cost of Goods Sold - ${c.label}` : c.label, qbType: c.kind === 'cogs' ? 'Cost of Goods Sold' : 'Expenses', help: '',
    })),
  ]
}

export interface SavedAccount { key: string; account_name: string; account_number?: string | null }
export interface ResolvedAccount { name: string; number: string; saved: boolean }
export type AccountBook = Record<string, ResolvedAccount>

const tidy = (s: unknown, max: number) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

/** The accounts to use: what the shop saved, and the suggested name for everything it has not. */
export function resolveAccounts(saved: SavedAccount[]): AccountBook {
  const bySaved = new Map(saved.map(s => [s.key, s]))
  const book: AccountBook = {}
  for (const d of allAccountDefs()) {
    const s = bySaved.get(d.key)
    const name = tidy(s?.account_name, 100)
    book[d.key] = name ? { name, number: tidy(s?.account_number, 20), saved: true } : { name: d.defaultName, number: '', saved: false }
  }
  return book
}

/** Accounts the shop has not named yet, so the screen can ask. */
export const unmappedKeys = (book: AccountBook): string[] => Object.entries(book).filter(([, v]) => !v.saved).map(([k]) => k)

/** Which payment account a method pays into. */
export function paymentAccountKey(method: unknown): string {
  switch (methodLabel(method)) {
    case 'Cash': return 'pay_cash'
    case 'Card': return 'pay_card'
    case 'Check': return 'pay_check'
    case 'Zelle': case 'Venmo': case 'PayPal': case 'Cash App': case 'Bank transfer': return 'pay_digital'
    default: return 'pay_other'
  }
}

/* ---------- journal entries ---------- */

export interface JournalLine { accountKey: string; account: string; accountNumber: string; debit: number; credit: number; name: string; memo: string }
export interface JournalEntry {
  /** What QuickBooks calls the journal number. Unique, and short enough for QuickBooks (21 characters). */
  number: string
  date: string
  memo: string
  source: 'sales' | 'payment' | 'cost' | 'expense'
  /** The invoice this is about, when it is about one. */
  docId: string | null
  lines: JournalLine[]
}
export interface Problem { key: string; message: string; docId?: string }

export type JournalMode = 'individual' | 'daily'
export interface JournalOptions {
  mode: JournalMode
  /** Also post the cost of parts sold against the stock account. */
  includeCost: boolean
  /** The customer name put on receivable lines when entries are totals for a day (QuickBooks needs a name there). */
  dailyCustomer: string
  /** Bills and expenses to post as well. Voided ones are skipped. */
  expenses?: Expense[]
}
export const DEFAULT_JOURNAL: JournalOptions = { mode: 'individual', includeCost: false, dailyCustomer: 'Daily sales' }

const line = (book: AccountBook, key: string, debit: number, credit: number, name: string, memo: string): JournalLine => ({
  accountKey: key, account: book[key]?.name || key, accountNumber: book[key]?.number || '', debit: round2(debit), credit: round2(credit), name, memo,
})

/** The credits an invoice posts, by account. Their sum is what the customer is billed. */
export function salesCredits(d: ReportDoc): { key: string; amount: number }[] {
  const itemised = d.supplies !== undefined || d.sublet !== undefined || d.core !== undefined
  const supplies = itemised ? (d.supplies ?? 0) + Math.max(0, d.fees - (d.supplies ?? 0) - (d.sublet ?? 0) - (d.core ?? 0)) : d.fees
  return [
    { key: 'sales_labor', amount: d.labor }, { key: 'sales_parts', amount: d.parts },
    { key: 'sales_supplies', amount: supplies }, { key: 'sales_sublet', amount: d.sublet ?? 0 }, { key: 'sales_core', amount: d.core ?? 0 },
    { key: 'sales_tax', amount: d.tax },
  ].map(c => ({ key: c.key, amount: round2(c.amount) })).filter(c => c.amount > 0)
}

export const partsCostOf = (d: ReportDoc): number => round2(d.items.reduce((s, i) => s + ((i.cost ?? 0) > 0 ? (i.cost ?? 0) : 0), 0))

/** Makes journal numbers unique and QuickBooks-sized. */
function numberer() {
  const used = new Set<string>()
  let seq = 0
  return (base: string): string => {
    const clean = base.replace(/[^A-Za-z0-9._-]/g, '').slice(0, 21)
    if (clean && !used.has(clean)) { used.add(clean); return clean }
    for (let n = 2; n < 1000; n++) {
      const suffix = `-${n}`
      const cand = `${clean.slice(0, 21 - suffix.length)}${suffix}`
      if (clean && !used.has(cand)) { used.add(cand); return cand }
    }
    seq += 1
    const cand = `J${String(seq).padStart(6, '0')}`
    used.add(cand)
    return cand
  }
}

/**
 * Journal entries for the range: each invoice or receipt written in it (sales), each payment received in it, and optionally the
 * cost of parts. "individual" makes an entry per invoice and per payment; "daily" adds them up into one sales entry and one
 * entry per payment method for each day.
 */
export function buildJournal(docs: ReportDoc[], payments: ReportPayment[], range: Range, book: AccountBook, opts: JournalOptions = DEFAULT_JOURNAL): { entries: JournalEntry[]; problems: Problem[] } {
  const num = numberer()
  const entries: JournalEntry[] = []
  const problems: Problem[] = []
  const byId = new Map(docs.map(d => [d.id, d]))
  const sales = docs.filter(d => isSale(d) && d.date && inRange(d.date, range) && d.total > 0).sort((a, b) => a.date.localeCompare(b.date) || (a.number || '').localeCompare(b.number || ''))
  const daily = opts.mode === 'daily'

  const salesEntry = (group: ReportDoc[], date: string, numberBase: string, memo: string, name: (d: ReportDoc) => string): JournalEntry => {
    const credits = new Map<string, number>()
    for (const d of group) for (const c of salesCredits(d)) credits.set(c.key, round2((credits.get(c.key) || 0) + c.amount))
    const total = round2([...credits.values()].reduce((s, n) => s + n, 0))
    const who = group.length === 1 ? name(group[0]) : opts.dailyCustomer
    const lines = [line(book, 'receivable', total, 0, who, memo)]
    for (const k of ['sales_labor', 'sales_parts', 'sales_supplies', 'sales_sublet', 'sales_core', 'sales_tax']) {
      const a = credits.get(k)
      if (a) lines.push(line(book, k, 0, a, '', memo))
    }
    return { number: num(numberBase), date, memo, source: 'sales', docId: group.length === 1 ? group[0].id : null, lines }
  }

  if (!daily) {
    for (const d of sales) {
      const e = salesEntry([d], d.date, d.number || `S-${d.id.slice(0, 8)}`, `${d.type} ${d.number || ''}`.trim() + (d.customer ? ` - ${d.customer}` : ''), x => x.customer || opts.dailyCustomer)
      entries.push(e)
      const credit = e.lines.reduce((s, l) => s + l.credit, 0)
      if (Math.abs(credit - d.total) > 0.005) problems.push({ key: 'total-differs', docId: d.id, message: `${d.type} ${d.number || ''} adds up to ${credit.toFixed(2)} from its lines but its total is ${d.total.toFixed(2)}.` })
    }
  } else {
    const days = new Map<string, ReportDoc[]>()
    for (const d of sales) days.set(d.date, [...(days.get(d.date) || []), d])
    for (const [date, group] of [...days.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const e = salesEntry(group, date, `S-${date}`, `Sales for ${date} (${group.length} ${group.length === 1 ? 'invoice' : 'invoices'})`, x => x.customer || opts.dailyCustomer)
      entries.push(e)
      const credit = e.lines.reduce((s, l) => s + l.credit, 0)
      const billed = round2(group.reduce((s, d) => s + d.total, 0))
      if (Math.abs(credit - billed) > 0.005) problems.push({ key: 'total-differs', message: `Sales for ${date} add up to ${credit.toFixed(2)} from the lines but the invoice totals are ${billed.toFixed(2)}.` })
    }
  }

  // Payments, on the day the money came in.
  const pays = payments.map(p => ({ p, date: collectedOn(p, byId) })).filter(x => x.date && inRange(x.date, range) && x.p.amount > 0)
    .sort((a, b) => a.date.localeCompare(b.date) || a.p.id.localeCompare(b.p.id))
  if (!daily) {
    for (const { p, date } of pays) {
      const d = p.docId ? byId.get(p.docId) : undefined
      const who = p.customer || d?.customer || opts.dailyCustomer
      const memo = `Payment${d?.number ? ` on ${d.number}` : ''} (${methodLabel(p.method)})`
      entries.push({
        number: num(`PMT-${d?.number || p.id.slice(0, 8)}`), date, memo, source: 'payment', docId: d?.id || null,
        lines: [line(book, paymentAccountKey(p.method), p.amount, 0, '', memo), line(book, 'receivable', 0, p.amount, who, memo)],
      })
    }
  } else {
    const groups = new Map<string, { date: string; key: string; label: string; total: number; n: number }>()
    for (const { p, date } of pays) {
      const key = paymentAccountKey(p.method)
      const gk = `${date}|${key}`
      const g = groups.get(gk) || { date, key, label: methodLabel(p.method), total: 0, n: 0 }
      g.total = round2(g.total + p.amount); g.n += 1; groups.set(gk, g)
    }
    for (const g of [...groups.values()].sort((a, b) => a.date.localeCompare(b.date) || a.key.localeCompare(b.key))) {
      const memo = `Payments received ${g.date} (${g.n} ${g.n === 1 ? 'payment' : 'payments'}, ${g.label})`
      entries.push({ number: num(`P-${g.date}-${g.key.replace('pay_', '')}`), date: g.date, memo, source: 'payment', docId: null,
        lines: [line(book, g.key, g.total, 0, '', memo), line(book, 'receivable', 0, g.total, opts.dailyCustomer, memo)] })
    }
  }

  // Cost of parts sold, from the cost written on part lines.
  if (opts.includeCost) {
    const costed = sales.map(d => ({ d, cost: partsCostOf(d) })).filter(x => x.cost > 0)
    if (!daily) {
      for (const { d, cost } of costed) {
        const memo = `Cost of parts on ${d.number || 'invoice'}`
        entries.push({ number: num(`COST-${d.number || d.id.slice(0, 8)}`), date: d.date, memo, source: 'cost', docId: d.id, lines: [line(book, 'cogs_parts', cost, 0, '', memo), line(book, 'inventory', 0, cost, '', memo)] })
      }
    } else {
      const days = new Map<string, number>()
      for (const { d, cost } of costed) days.set(d.date, round2((days.get(d.date) || 0) + cost))
      for (const [date, cost] of [...days.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const memo = `Cost of parts sold ${date}`
        entries.push({ number: num(`COST-${date}`), date, memo, source: 'cost', docId: null, lines: [line(book, 'cogs_parts', cost, 0, '', memo), line(book, 'inventory', 0, cost, '', memo)] })
      }
    }
  }

  // Bills and expenses: the cost on the bill's date, then the payment on the day it was paid.
  for (const x of opts.expenses || []) {
    if (x.voided_at || !x.date || !(x.amount > 0)) continue
    const key = `exp_${x.category}`
    const ref = x.reference || x.id.slice(0, 8)
    const memo = `${x.vendor || 'Expense'}${x.memo ? ` - ${x.memo}` : ''}`
    const paidSameDay = x.paid_on === x.date
    if (inRange(x.date, range)) {
      entries.push({
        number: num(`EXP-${ref}`), date: x.date, memo, source: 'expense', docId: null,
        lines: [line(book, key, x.amount, 0, '', memo), line(book, paidSameDay ? 'paid_from' : 'payable', 0, x.amount, x.vendor, memo)],
      })
    }
    if (x.paid_on && !paidSameDay && inRange(x.paid_on, range)) {
      const payMemo = `Paid ${x.vendor || 'bill'}${x.reference ? ` (${x.reference})` : ''}`
      entries.push({
        number: num(`BILLPAY-${ref}`), date: x.paid_on, memo: payMemo, source: 'expense', docId: null,
        lines: [line(book, 'payable', x.amount, 0, x.vendor, payMemo), line(book, 'paid_from', 0, x.amount, '', payMemo)],
      })
    }
  }

  for (const e of entries) {
    const dr = round2(e.lines.reduce((s, l) => s + l.debit, 0)), cr = round2(e.lines.reduce((s, l) => s + l.credit, 0))
    if (Math.abs(dr - cr) > 0.005) problems.push({ key: 'unbalanced', message: `Entry ${e.number} does not balance (${dr.toFixed(2)} debits, ${cr.toFixed(2)} credits).` })
  }
  entries.sort((a, b) => a.date.localeCompare(b.date) || a.number.localeCompare(b.number))
  return { entries, problems }
}

export const totalDebits = (entries: JournalEntry[]) => round2(entries.reduce((s, e) => s + e.lines.reduce((t, l) => t + l.debit, 0), 0))
export const totalCredits = (entries: JournalEntry[]) => round2(entries.reduce((s, e) => s + e.lines.reduce((t, l) => t + l.credit, 0), 0))

/* ---------- files ---------- */

const us = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}`
const amt = (n: number) => (Math.round(n * 100) / 100).toFixed(2)

/** QuickBooks Online: Settings > Import data > Journal entries. One row per line, rows grouped by journal number. */
export function quickbooksOnlineCsv(entries: JournalEntry[]): string {
  const head = ['Journal No.', 'Journal Date', 'Account Name', 'Description', 'Debits', 'Credits', 'Name']
  const rows = [head.map(csvCell).join(',')]
  for (const e of entries) for (const l of e.lines) {
    rows.push([e.number, us(e.date), l.account, l.memo || e.memo, l.debit ? amt(l.debit) : '', l.credit ? amt(l.credit) : '', l.name].map(csvCell).join(','))
  }
  return rows.join('\r\n') + '\r\n'
}

const iif = (s: unknown, max = 200) => String(s ?? '').replace(/[\t\r\n]+/g, ' ').trim().slice(0, max)

/**
 * QuickBooks Desktop: File > Utilities > Import > IIF files. Tab separated; debits positive, credits negative; each entry's
 * amounts add to zero. The accounts named here must already exist in QuickBooks.
 */
export function quickbooksIif(entries: JournalEntry[]): string {
  const out = [
    '!TRNS\tTRNSID\tTRNSTYPE\tDATE\tACCNT\tNAME\tCLASS\tAMOUNT\tDOCNUM\tMEMO',
    '!SPL\tSPLID\tTRNSTYPE\tDATE\tACCNT\tNAME\tCLASS\tAMOUNT\tDOCNUM\tMEMO',
    '!ENDTRNS',
  ]
  for (const e of entries) {
    // The first debit line opens the entry; everything else follows as splits.
    const lines = [...e.lines].sort((a, b) => (b.debit > 0 ? 1 : 0) - (a.debit > 0 ? 1 : 0))
    lines.forEach((l, i) => {
      const net = round2(l.debit - l.credit)
      out.push([i === 0 ? 'TRNS' : 'SPL', '', 'GENERAL JOURNAL', us(e.date), iif(l.account, 100), iif(l.name, 41), '', amt(net), iif(e.number, 21), iif(l.memo || e.memo, 4000)].join('\t'))
    })
    out.push('ENDTRNS')
  }
  return out.join('\r\n') + '\r\n'
}

/** A plain ledger any accountant can open: one row per journal line. */
export function ledgerCsv(entries: JournalEntry[]): string {
  const head = ['Date', 'Journal no.', 'Account', 'Account number', 'Name', 'Memo', 'Debit', 'Credit', 'Kind']
  const kind: Record<JournalEntry['source'], string> = { sales: 'Sales', payment: 'Payment', cost: 'Cost of parts', expense: 'Expense or bill' }
  const rows = [head.map(csvCell).join(',')]
  for (const e of entries) for (const l of e.lines) {
    rows.push([e.date, e.number, l.account, l.accountNumber, l.name, l.memo || e.memo, l.debit ? amt(l.debit) : '', l.credit ? amt(l.credit) : '', kind[e.source]].map(csvCell).join(','))
  }
  return rows.join('\r\n') + '\r\n'
}

/** The accounts the files use, so the accountant can create any that are missing before importing. */
export function accountListCsv(book: AccountBook, used: Set<string>): string {
  const rows = [['Account', 'Number', 'Type', 'Used for'].map(csvCell).join(',')]
  const seen = new Set<string>()
  for (const d of allAccountDefs()) {
    if (!used.has(d.key)) continue
    const a = book[d.key]
    const k = a.name.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    rows.push([a.name, a.number, d.qbType, d.label].map(csvCell).join(','))
  }
  return rows.join('\r\n') + '\r\n'
}

export const accountsUsed = (entries: JournalEntry[]): Set<string> => new Set(entries.flatMap(e => e.lines.map(l => l.accountKey)))

/* ---------- checks before the books go out ---------- */

export interface DayRow {
  date: string
  invoices: number
  /** Billed before tax, then tax, then both. */
  sales: number
  tax: number
  billed: number
  collected: number
  byMethod: { label: string; amount: number }[]
}

/** Day by day totals to hold against the end-of-day report or the deposit slip. */
export function dailyTotals(docs: ReportDoc[], payments: ReportPayment[], range: Range): DayRow[] {
  const byId = new Map(docs.map(d => [d.id, d]))
  const days = new Map<string, DayRow>()
  const day = (date: string) => { const r = days.get(date) || { date, invoices: 0, sales: 0, tax: 0, billed: 0, collected: 0, byMethod: [] }; days.set(date, r); return r }
  for (const d of docs) {
    if (!isSale(d) || !d.date || !inRange(d.date, range)) continue
    const r = day(d.date)
    r.invoices += 1; r.sales = round2(r.sales + d.total - d.tax); r.tax = round2(r.tax + d.tax); r.billed = round2(r.billed + d.total)
  }
  for (const p of payments) {
    const date = collectedOn(p, byId)
    if (!date || !inRange(date, range)) continue
    const r = day(date)
    r.collected = round2(r.collected + p.amount)
    const label = methodLabel(p.method)
    const m = r.byMethod.find(x => x.label === label)
    if (m) m.amount = round2(m.amount + p.amount); else r.byMethod.push({ label, amount: round2(p.amount) })
  }
  for (const r of days.values()) r.byMethod.sort((a, b) => b.amount - a.amount)
  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date))
}

/** Day by day totals as a spreadsheet, to hold against the end-of-day report or a deposit slip. */
export function dailyTotalsCsv(days: DayRow[]): string {
  const methods = [...new Set(days.flatMap(d => d.byMethod.map(m => m.label)))].sort()
  const rows = [['Date', 'Invoices', 'Sales before tax', 'Sales tax', 'Billed', 'Collected', ...methods.map(m => `Collected by ${m}`)].map(csvCell).join(',')]
  for (const d of days) {
    rows.push([d.date, d.invoices, amt(d.sales), amt(d.tax), amt(d.billed), amt(d.collected), ...methods.map(m => amt(d.byMethod.find(x => x.label === m)?.amount ?? 0))].map(csvCell).join(','))
  }
  const sum = (f: (d: DayRow) => number) => amt(days.reduce((t, d) => t + f(d), 0))
  rows.push(['Total', days.reduce((t, d) => t + d.invoices, 0), sum(d => d.sales), sum(d => d.tax), sum(d => d.billed), sum(d => d.collected), ...methods.map(m => sum(d => d.byMethod.find(x => x.label === m)?.amount ?? 0))].map(csvCell).join(','))
  return rows.join('\r\n') + '\r\n'
}

export type CheckState = 'ok' | 'attention'
export interface Check { key: string; label: string; state: CheckState; detail: string; ids: string[] }

/** Things an accountant would find. Each says what it found in plain words and which invoices it means. */
export function runChecks(docs: ReportDoc[], payments: ReportPayment[], range: Range, journal: { entries: JournalEntry[]; problems: Problem[] }): Check[] {
  const checks: Check[] = []
  const byId = new Map(docs.map(d => [d.id, d]))
  const sales = docs.filter(d => isSale(d) && inRange(d.date, range))
  const add = (key: string, label: string, ids: string[], okText: string, badText: (n: number) => string) =>
    checks.push({ key, label, state: ids.length ? 'attention' : 'ok', detail: ids.length ? badText(ids.length) : okText, ids })
  const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

  const unbalanced = journal.problems.filter(p => p.key === 'unbalanced').length
  checks.push({ key: 'balanced', label: 'Every entry balances', state: unbalanced ? 'attention' : 'ok', detail: unbalanced ? `${unbalanced} ${plural(unbalanced, 'entry does', 'entries do')} not balance.` : `All ${journal.entries.length} entries balance: debits equal credits.`, ids: [] })

  const differs = journal.problems.filter(p => p.key === 'total-differs')
  add('totals', 'Invoice lines add up to invoice totals', differs.map(p => p.docId || '').filter(Boolean), 'Every invoice\'s lines add up to its total.', n => `${n} ${plural(n, 'invoice does', 'invoices do')} not add up. Open ${plural(n, 'it', 'them')} and save again.`)

  const paidNoPay: string[] = []
  const covered = new Set(payments.map(p => p.docId).filter((x): x is string => !!x))
  for (const d of sales) if (String(d.status).trim().toLowerCase() === 'paid' && d.paid <= 0 && d.total > 0 && !covered.has(d.id)) paidNoPay.push(d.id)
  add('paid-no-payment', 'Paid invoices have a payment', paidNoPay, 'Every invoice marked Paid has a payment recorded.', n => `${n} ${plural(n, 'invoice is', 'invoices are')} marked Paid with no payment recorded. They are not in the payments file.`)

  const loose = payments.filter(p => !p.docId && inRange(p.date, range))
  add('loose-payments', 'Payments belong to an invoice', loose.map(p => p.id), 'Every payment is tied to an invoice.', n => `${n} ${plural(n, 'payment is', 'payments are')} not tied to any invoice. They reduce what customers owe but cannot be traced.`)

  const early = payments.filter(p => {
    const d = p.docId ? byId.get(p.docId) : undefined
    const when = collectedOn(p, byId)
    return d && d.date && when && when < d.date && inRange(when, range)
  })
  add('early-payments', 'No payment before its invoice', early.map(p => p.id), 'No payment is dated before the invoice it paid.', n => `${n} ${plural(n, 'payment is', 'payments are')} dated before the invoice was written. Check the dates.`)

  const noCustomer = sales.filter(d => !d.customer.trim() && !d.customerId)
  add('no-customer', 'Invoices name a customer', noCustomer.map(d => d.id), 'Every invoice names a customer.', n => `${n} ${plural(n, 'invoice has', 'invoices have')} no customer name. QuickBooks needs one on receivable lines.`)

  const seen = new Map<string, string[]>()
  for (const d of sales) if (d.number) seen.set(d.number, [...(seen.get(d.number) || []), d.id])
  const dupes = [...seen.values()].filter(v => v.length > 1).flat()
  add('duplicate-numbers', 'Invoice numbers are unique', dupes, 'No invoice number is used twice.', n => `${n} invoices share a number with another. QuickBooks will refuse duplicate journal numbers.`)

  const drafts = docs.filter(d => (d.type === 'Invoice' || d.type === 'Receipt') && String(d.status).trim().toLowerCase() === 'draft' && inRange(d.date, range))
  add('drafts', 'No drafts left in the period', drafts.map(d => d.id), 'No invoices are still drafts.', n => `${n} ${plural(n, 'invoice is', 'invoices are')} still a draft. Drafts are not posted, so they are not in the files.`)

  const billed = round2(sales.reduce((s, d) => s + d.total, 0))
  const posted = round2(journal.entries.filter(e => e.source === 'sales').reduce((s, e) => s + e.lines.filter(l => l.accountKey === 'receivable').reduce((t, l) => t + l.debit, 0), 0))
  checks.push({ key: 'billed-matches', label: 'Entries match what was billed', state: Math.abs(billed - posted) > 0.005 ? 'attention' : 'ok', detail: Math.abs(billed - posted) > 0.005 ? `You billed ${billed.toFixed(2)} but the entries post ${posted.toFixed(2)}. The difference is invoices with a zero total or no date.` : `Entries post ${posted.toFixed(2)}, the same as the ${billed.toFixed(2)} billed.`, ids: [] })
  return checks
}

/** An open balance as the customer-owes ledger would show it, matching the aging report. */
export const openBalance = (d: ReportDoc): number => balanceFor(d.status, d.balance)

/** Whether a method label reads as "not recorded" (so the screen can point it out in the payments file). */
export const unrecordedMethod = (m: unknown): boolean => methodKey(m) === '' || methodLabel(m) === 'Method not recorded'
