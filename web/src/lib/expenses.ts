/**
 * Money the shop spends: bills from vendors, rent, payroll, anything an accountant needs next to the sales.
 * An expense with no "paid on" day is a bill still to pay. Nothing is deleted: a mistake is voided and stays on record.
 *
 * Plain TypeScript with no framework imports, shared by the screen, the API route and the tests.
 */
import { EXPENSE_CATEGORIES, expenseKind, expenseLabel } from './accounting.ts'
import { addDays, diffDays, inRange, round2 } from './reports.ts'
import type { Range } from './reports.ts'
import { isDayKey } from './report-ranges.ts'

export interface Expense {
  id: string
  /** The bill or purchase date. */
  date: string
  vendor: string
  category: string
  amount: number
  memo: string
  reference: string
  /** The day it was paid. Null while it is an unpaid bill. */
  paid_on: string | null
  method: string
  voided_at: string | null
}

export interface ExpenseWrite { date: string; vendor: string; category: string; amount: number; memo: string; reference: string; paid_on: string | null; method: string }
export type ExpenseField = 'date' | 'vendor' | 'category' | 'amount' | 'paid_on' | 'memo' | 'reference'
export type ExpenseErrors = Partial<Record<ExpenseField, string>>

export const MAX_EXPENSE = 10_000_000
const clean = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

/** What the form sends: everything is still text. */
export interface ExpenseInput { date?: unknown; vendor?: unknown; category?: unknown; amount?: unknown; memo?: unknown; reference?: unknown; paid_on?: unknown; method?: unknown; paid?: unknown }

/** Reads a typed amount: "1,204.50", "$30", "12.5". Returns null for anything else. */
export function parseAmount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : null
  const s = String(v ?? '').replace(/[$,\s]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null
  return Math.round(Number(s) * 100) / 100
}

export function checkExpense(input: ExpenseInput, todayKey: string): { ok: true; value: ExpenseWrite } | { ok: false; errors: ExpenseErrors } {
  const errors: ExpenseErrors = {}
  const date = clean(input.date, 10)
  if (!isDayKey(date)) errors.date = 'Pick the date on the bill or receipt.'
  else if (date > addDays(todayKey, 31)) errors.date = 'That date is more than a month ahead. Check it.'
  const vendor = clean(input.vendor, 120)
  if (!vendor) errors.vendor = 'Who was it paid to? Type the vendor name.'
  const category = clean(input.category, 40)
  if (!EXPENSE_CATEGORIES.some(c => c.key === category)) errors.category = 'Choose a category.'
  const amount = parseAmount(input.amount)
  if (amount === null) errors.amount = 'Enter the amount as a number, like 245.50.'
  else if (amount <= 0) errors.amount = 'The amount must be more than zero.'
  else if (amount > MAX_EXPENSE) errors.amount = 'That is more than ten million dollars. Check it.'
  let paidOn: string | null = null
  const rawPaid = clean(input.paid_on, 10)
  if (input.paid === false || input.paid === 'false') paidOn = null
  else if (rawPaid) {
    if (!isDayKey(rawPaid)) errors.paid_on = 'Pick the day it was paid.'
    else if (isDayKey(date) && rawPaid < date) errors.paid_on = 'It cannot be paid before the date on the bill.'
    else paidOn = rawPaid
  }
  if (Object.keys(errors).length) return { ok: false, errors }
  return { ok: true, value: { date, vendor, category, amount: amount as number, memo: clean(input.memo, 400), reference: clean(input.reference, 60), paid_on: paidOn, method: clean(input.method, 30) } }
}

/** Rows from the database arrive with loose types. */
export function expenseFrom(raw: Record<string, unknown>): Expense {
  const day = (v: unknown) => { const s = String(v ?? '').slice(0, 10); return isDayKey(s) ? s : '' }
  return {
    id: String(raw.id ?? ''), date: day(raw.date), vendor: clean(raw.vendor, 120), category: clean(raw.category, 40) || 'other',
    amount: Math.max(0, Number(raw.amount) || 0), memo: clean(raw.memo, 400), reference: clean(raw.reference, 60),
    paid_on: day(raw.paid_on) || null, method: clean(raw.method, 30), voided_at: raw.voided_at ? String(raw.voided_at) : null,
  }
}

export const isActive = (e: Expense): boolean => !e.voided_at && !!e.date && e.amount > 0

export type Basis = 'accrual' | 'cash'

/** The day an expense counts for: the bill date for accrual, the day it was paid for cash (unpaid bills do not count for cash). */
export function countsOn(e: Expense, basis: Basis): string {
  return basis === 'cash' ? (e.paid_on || '') : e.date
}

export function expensesIn(list: Expense[], range: Range, basis: Basis): Expense[] {
  return list.filter(e => isActive(e) && inRange(countsOn(e, basis), range))
}

export interface CategoryTotal { key: string; label: string; kind: 'cogs' | 'operating'; amount: number; count: number }
export interface ExpenseSummary { total: number; count: number; cogs: number; operating: number; byCategory: CategoryTotal[] }

export function summarizeExpenses(list: Expense[], range: Range, basis: Basis): ExpenseSummary {
  const m = new Map<string, CategoryTotal>()
  for (const e of expensesIn(list, range, basis)) {
    const t = m.get(e.category) || { key: e.category, label: expenseLabel(e.category), kind: expenseKind(e.category), amount: 0, count: 0 }
    t.amount = round2(t.amount + e.amount); t.count += 1; m.set(e.category, t)
  }
  const byCategory = [...m.values()].sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label))
  const sum = (k?: 'cogs' | 'operating') => round2(byCategory.filter(c => !k || c.kind === k).reduce((s, c) => s + c.amount, 0))
  return { total: sum(), count: byCategory.reduce((s, c) => s + c.count, 0), cogs: sum('cogs'), operating: sum('operating'), byCategory }
}

export interface Bill { expense: Expense; days: number; overdue: boolean }
export interface BillsOwed { total: number; overdueTotal: number; bills: Bill[] }

/** Bills not yet paid, oldest first. A bill is overdue 30 days after its date (the shop's terms are not recorded). */
export function unpaidBills(list: Expense[], todayKey: string, termsDays = 30): BillsOwed {
  const bills: Bill[] = list.filter(e => isActive(e) && !e.paid_on).map(e => {
    const days = Math.max(0, diffDays(e.date, todayKey))
    return { expense: e, days, overdue: days > termsDays }
  }).sort((a, b) => b.days - a.days || b.expense.amount - a.expense.amount)
  return {
    total: round2(bills.reduce((s, b) => s + b.expense.amount, 0)),
    overdueTotal: round2(bills.filter(b => b.overdue).reduce((s, b) => s + b.expense.amount, 0)),
    bills,
  }
}

/** The same bill typed twice: same vendor, same day, same amount (or the same reference number). */
export function likelyDuplicate(list: Expense[], c: Pick<ExpenseWrite, 'vendor' | 'date' | 'amount' | 'reference'>, ignoreId = ''): Expense | null {
  const v = c.vendor.trim().toLowerCase()
  return list.find(e => isActive(e) && e.id !== ignoreId && e.vendor.trim().toLowerCase() === v
    && ((e.date === c.date && Math.abs(e.amount - c.amount) < 0.005) || (!!c.reference && e.reference.toLowerCase() === c.reference.toLowerCase()))) || null
}

/** Vendors already used, most recent first, to fill the vendor box. */
export function vendorNames(list: Expense[], limit = 40): string[] {
  const seen = new Map<string, string>()
  for (const e of [...list].sort((a, b) => b.date.localeCompare(a.date))) {
    const k = e.vendor.trim().toLowerCase()
    if (k && !seen.has(k)) seen.set(k, e.vendor.trim())
  }
  return [...seen.values()].slice(0, limit)
}
