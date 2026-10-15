/**
 * Month-end close: a checklist an owner works through before handing the books to an accountant.
 * Some items are checked by the numbers (the same checks the accountant file runs); others only the owner can confirm
 * (bank statement matched, payroll run). Closing a month records that it was reviewed and keeps a snapshot of its totals, so a
 * later change to an old invoice is noticed. It does not lock anything: invoices can still be edited, and the page says so.
 */
import { collectedOn, inRange, isSale, keyOf, parseDay, round2 } from './reports.ts'
import type { Range, ReportDoc, ReportPayment } from './reports.ts'
import type { Check } from './accounting.ts'
import { unpaidBills } from './expenses.ts'
import type { Expense } from './expenses.ts'

export const MANUAL_ITEMS: { key: string; label: string; help: string }[] = [
  { key: 'bank', label: 'Bank and card statements match what was recorded', help: 'Compare the month on your bank and card statements with the payments in this report.' },
  { key: 'deposits', label: 'Cash and check deposits match the daily totals', help: 'The daily totals in the accountant package list cash and checks for each day.' },
  { key: 'expenses', label: 'All bills and receipts for the month are entered', help: 'Enter anything still in a drawer or an inbox under Bills and expenses.' },
  { key: 'payroll', label: 'Payroll for the month is run and exported', help: 'Use the payroll hours export to match your payroll provider.' },
  { key: 'tax', label: 'Sales tax figures are reviewed', help: 'Check the sales tax by authority against your return, and file it if it is due.' },
  { key: 'inventory', label: 'Parts on the shelf are counted or spot-checked', help: 'The parts value report lists what the system thinks is on the shelf.' },
  { key: 'accountant', label: 'The accountant package is sent', help: 'Download the package and send it to your accountant.' },
]

export interface Snapshot { billed: number; collected: number; tax: number; invoices: number; owed: number; expenses: number }

export interface CloseSaved {
  month: string
  checked: Record<string, boolean>
  note: string
  closed_at: string | null
  closed_by: string | null
  snapshot: Snapshot | null
}

export const isMonth = (m: unknown): m is string => typeof m === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(m)

export function monthRange(month: string): Range {
  const from = `${month}-01`
  const d = parseDay(from)
  return { from, to: keyOf(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12)) }
}

/** The month before the one that today falls in. */
export function previousMonth(todayKey: string): string {
  const d = parseDay(todayKey)
  const p = new Date(d.getFullYear(), d.getMonth() - 1, 1, 12)
  return keyOf(p).slice(0, 7)
}

export function monthLabel(month: string): string {
  return parseDay(`${month}-01`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

/** The totals for a month as of now. `owed` is what customers still owe on invoices dated in that month. */
export function monthSnapshot(docs: ReportDoc[], payments: ReportPayment[], expenses: Expense[], month: string): Snapshot {
  const range = monthRange(month)
  const byId = new Map(docs.map(d => [d.id, d]))
  const sales = docs.filter(d => isSale(d) && d.date && inRange(d.date, range))
  return {
    billed: round2(sales.reduce((s, d) => s + d.total, 0)),
    collected: round2(payments.filter(p => inRange(collectedOn(p, byId), range)).reduce((s, p) => s + p.amount, 0)),
    tax: round2(sales.reduce((s, d) => s + d.tax, 0)),
    invoices: sales.length,
    owed: round2(sales.reduce((s, d) => s + d.balance, 0)),
    expenses: round2(expenses.filter(e => !e.voided_at && e.date && inRange(e.date, range)).reduce((s, e) => s + e.amount, 0)),
  }
}

export type CloseState = 'ok' | 'attention' | 'todo' | 'done'
export interface CloseItem { key: string; label: string; kind: 'auto' | 'manual'; state: CloseState; detail: string; help?: string; ids: string[] }

export function closeItems(month: string, todayKey: string, saved: CloseSaved | null, checks: Check[], expenses: Expense[]): CloseItem[] {
  const range = monthRange(month)
  const items: CloseItem[] = []
  const over = todayKey <= range.to
  items.push({
    key: 'month-over', label: 'The month is over', kind: 'auto', state: over ? 'attention' : 'ok', ids: [],
    detail: over ? `${monthLabel(month)} ends on ${parseDay(range.to).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}. Close it after the last day, so late invoices are in.` : `${monthLabel(month)} has ended.`,
  })
  for (const c of checks) items.push({ key: `check-${c.key}`, label: c.label, kind: 'auto', state: c.state === 'ok' ? 'ok' : 'attention', detail: c.detail, ids: c.ids })
  const bills = unpaidBills(expenses.filter(e => e.date <= range.to), range.to)
  items.push({
    key: 'bills', label: 'Bills are paid or accounted for', kind: 'auto', ids: [],
    state: bills.bills.length ? 'attention' : 'ok',
    detail: bills.bills.length ? `${bills.bills.length} ${bills.bills.length === 1 ? 'bill is' : 'bills are'} still unpaid at the end of the month (${bills.total.toFixed(2)}). That is fine if they are really still owed.` : 'No bills were left unpaid at the end of the month.',
  })
  for (const m of MANUAL_ITEMS) {
    const done = !!saved?.checked?.[m.key]
    items.push({ key: m.key, label: m.label, kind: 'manual', state: done ? 'done' : 'todo', detail: done ? 'You confirmed this.' : 'Only you can confirm this one.', help: m.help, ids: [] })
  }
  return items
}

/** Whether the month can be marked closed, and if not, why. Items that need attention can be accepted, but the manual ones cannot be skipped. */
export function closeReadiness(items: CloseItem[]): { ready: boolean; needsAttention: number; manualLeft: number; why: string } {
  const manualLeft = items.filter(i => i.kind === 'manual' && i.state !== 'done').length
  const needsAttention = items.filter(i => i.kind === 'auto' && i.state === 'attention').length
  const monthOpen = items.find(i => i.key === 'month-over')?.state === 'attention'
  const why = monthOpen ? 'The month is not over yet.' : manualLeft ? `${manualLeft} ${manualLeft === 1 ? 'item is' : 'items are'} still to confirm.` : ''
  return { ready: !monthOpen && manualLeft === 0, needsAttention, manualLeft, why }
}

/** What changed after the month was closed, in plain sentences. Empty when nothing did. */
export function changedSinceClose(snap: Snapshot | null, now: Snapshot): string[] {
  if (!snap) return []
  const out: string[] = []
  const diff = (label: string, a: number, b: number, money = true) => {
    if (Math.abs(a - b) < 0.005) return
    const fmt = (n: number) => (money ? `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : String(n))
    out.push(`${label} was ${fmt(a)} when you closed the month and is ${fmt(b)} now.`)
  }
  diff('The amount billed', snap.billed, now.billed)
  diff('The amount collected', snap.collected, now.collected)
  diff('Sales tax', snap.tax, now.tax)
  diff('The number of invoices', snap.invoices, now.invoices, false)
  diff('Expenses', snap.expenses, now.expenses)
  return out
}

