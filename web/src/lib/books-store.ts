/**
 * Saving and reading the shop's books: how it keeps them (cash or accrual), the account names its accountant uses, bills and
 * expenses, and the month-end checklist. Every call is filtered by the shop it belongs to.
 *
 * Nothing here touches an invoice or a payment. If a table is not there yet (the database update has not been applied) the
 * answer says so for that one feature, instead of an empty list that looks like "you have none".
 */
import { allAccountDefs } from './accounting.ts'
import type { SavedAccount } from './accounting.ts'
import type { Db, DbError, Row } from './db-types.ts'
import { checkExpense, expenseFrom, likelyDuplicate } from './expenses.ts'
import type { Expense, ExpenseErrors, ExpenseInput } from './expenses.ts'
import { isMonth } from './month-close.ts'
import type { CloseSaved, Snapshot } from './month-close.ts'
import { isMissingSchemaError } from './report-docs.ts'
import { isDayKey } from './report-ranges.ts'
import { addDays } from './reports.ts'
import { normalizeComponents } from './sales-tax.ts'
import type { TaxComponent } from './sales-tax.ts'
import type { JournalMode } from './accounting.ts'
import type { Basis, CogsMethod } from './profit-loss.ts'

export interface Actor { userId: string; name: string }

/** Who may see and change the books. Everyone else can still read the reports built from invoices. */
export const BOOKS_ROLES = new Set(['owner', 'admin', 'manager', 'service'])
export const canManageBooks = (role: string): boolean => BOOKS_ROLES.has(role)

export type Failure = { ok: false; status: number; message: string; needsUpdate?: boolean; fields?: Record<string, string>; duplicate?: Expense }
const fail = (status: number, message: string, extra: Partial<Failure> = {}): Failure => ({ ok: false, status, message, ...extra })
export const NEEDS_UPDATE_MESSAGE = 'This needs a one-time update to your Alpha Desk database. It does not change your invoices or payments.'
const needsUpdate = (): Failure => fail(503, NEEDS_UPDATE_MESSAGE, { needsUpdate: true })

/** Turns a failed database call into a failure the screen can show. A missing table is a notice for that feature, not an error. */
function failed(error: DbError | null | undefined, what: string): Failure {
  if (isMissingSchemaError(error)) return needsUpdate()
  console.error(`[books] ${what}:`, error?.message || 'unknown error')
  return fail(500, `${what} did not work. Nothing was lost. Try again in a moment.`)
}

export type ResourceState = 'ok' | 'needs-update' | 'error'
export interface Resource<T> { state: ResourceState; value: T; error: string }

async function read<T>(work: PromiseLike<{ data: Row[] | null; error: DbError | null }>, map: (rows: Row[]) => T, empty: T, what: string): Promise<Resource<T>> {
  const { data, error } = await work
  if (error) {
    if (isMissingSchemaError(error)) return { state: 'needs-update', value: empty, error: '' }
    console.error(`[books] ${what}:`, error.message)
    return { state: 'error', value: empty, error: `${what} did not load. Try again.` }
  }
  return { state: 'ok', value: map(data || []), error: '' }
}

/* ---------- settings ---------- */

export interface BooksSettings {
  basis: Basis
  cogsMethod: CogsMethod
  taxComponents: TaxComponent[]
  laborCostPerHour: number | null
  journalMode: JournalMode
  includeCost: boolean
  dailyCustomer: string
}

export const DEFAULT_SETTINGS: BooksSettings = {
  basis: 'accrual', cogsMethod: 'invoices', taxComponents: [], laborCostPerHour: null, journalMode: 'individual', includeCost: false, dailyCustomer: 'Daily sales',
}

const tidy = (v: unknown, max: number) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

export function settingsFrom(row: Row | null | undefined): BooksSettings {
  if (!row) return { ...DEFAULT_SETTINGS }
  const cost = row.labor_cost_per_hour == null || row.labor_cost_per_hour === '' ? null : Number(row.labor_cost_per_hour)
  return {
    basis: row.basis === 'cash' ? 'cash' : 'accrual',
    cogsMethod: row.cogs_method === 'purchases' ? 'purchases' : 'invoices',
    taxComponents: normalizeComponents(row.tax_components),
    laborCostPerHour: cost !== null && Number.isFinite(cost) && cost >= 0 ? cost : null,
    journalMode: row.journal_mode === 'daily' ? 'daily' : 'individual',
    includeCost: row.include_cost === true,
    dailyCustomer: tidy(row.daily_customer, 60) || DEFAULT_SETTINGS.dailyCustomer,
  }
}

export type SettingsField = 'basis' | 'cogsMethod' | 'taxComponents' | 'laborCostPerHour' | 'journalMode' | 'dailyCustomer'

/** Checks what the shop typed. Nothing is guessed: a tax line with a missing name or a rate that makes no sense is an error. */
export function checkSettings(input: Record<string, unknown>, current: BooksSettings): { ok: true; value: BooksSettings } | { ok: false; errors: Partial<Record<SettingsField, string>> } {
  const errors: Partial<Record<SettingsField, string>> = {}
  const next: BooksSettings = { ...current }
  if ('basis' in input) { if (input.basis === 'cash' || input.basis === 'accrual') next.basis = input.basis; else errors.basis = 'Choose cash or accrual.' }
  if ('cogsMethod' in input) { if (input.cogsMethod === 'invoices' || input.cogsMethod === 'purchases') next.cogsMethod = input.cogsMethod; else errors.cogsMethod = 'Choose where the cost of parts comes from.' }
  if ('journalMode' in input) { if (input.journalMode === 'individual' || input.journalMode === 'daily') next.journalMode = input.journalMode; else errors.journalMode = 'Choose one entry per invoice or one per day.' }
  if ('includeCost' in input) next.includeCost = input.includeCost === true
  if ('dailyCustomer' in input) {
    const name = tidy(input.dailyCustomer, 60)
    if (!name) errors.dailyCustomer = 'Type the customer name to put on daily totals, like "Daily sales".'
    else next.dailyCustomer = name
  }
  if ('laborCostPerHour' in input) {
    const raw = input.laborCostPerHour
    if (raw === null || raw === '' || raw === undefined) next.laborCostPerHour = null
    else {
      const n = Number(String(raw).replace(/[$,\s]/g, ''))
      if (!Number.isFinite(n) || n < 0 || n > 1000) errors.laborCostPerHour = 'Enter what an hour of a technician costs you, like 32.50, or leave it empty.'
      else next.laborCostPerHour = Math.round(n * 100) / 100
    }
  }
  if ('taxComponents' in input) {
    const raw = input.taxComponents
    if (!Array.isArray(raw)) errors.taxComponents = 'Send the tax lines as a list.'
    else if (raw.length > 12) errors.taxComponents = 'Up to 12 tax lines.'
    else {
      const kept = normalizeComponents(raw)
      if (kept.length !== raw.length) errors.taxComponents = 'Each tax line needs a name and a rate between 0 and 25 percent.'
      else next.taxComponents = kept
    }
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: next }
}

/* ---------- reading everything at once ---------- */

export interface Books {
  settings: Resource<BooksSettings>
  mappings: Resource<SavedAccount[]>
  expenses: Resource<Expense[]>
  closes: Resource<CloseSaved[]>
}

export const closeFrom = (r: Row): CloseSaved => {
  const checked: Record<string, boolean> = {}
  if (r.checked && typeof r.checked === 'object' && !Array.isArray(r.checked)) for (const [k, v] of Object.entries(r.checked as Row)) if (v === true) checked[k] = true
  const s = r.snapshot && typeof r.snapshot === 'object' ? (r.snapshot as Row) : null
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
  return {
    month: String(r.month ?? ''), checked, note: tidy(r.note, 1000), closed_at: r.closed_at ? String(r.closed_at) : null, closed_by: r.closed_by ? String(r.closed_by) : null,
    snapshot: s ? { billed: n(s.billed), collected: n(s.collected), tax: n(s.tax), invoices: n(s.invoices), owed: n(s.owed), expenses: n(s.expenses) } : null,
  }
}

export async function loadBooks(db: Db, shopId: string): Promise<Books> {
  const [settings, mappings, expenses, closes] = await Promise.all([
    read(db.from('accounting_settings').select('*').eq('shop_id', shopId).limit(1), rows => settingsFrom(rows[0]), { ...DEFAULT_SETTINGS }, 'Your accounting settings'),
    read(db.from('account_mappings').select('key,account_name,account_number').eq('shop_id', shopId).limit(500), rows => rows.map(r => ({ key: String(r.key), account_name: String(r.account_name ?? ''), account_number: r.account_number ? String(r.account_number) : null })), [] as SavedAccount[], 'Your account names'),
    read(db.from('expenses').select('id,date,vendor,category,amount,memo,reference,paid_on,method,voided_at').eq('shop_id', shopId).order('date', { ascending: false }).limit(5000), rows => rows.map(expenseFrom), [] as Expense[], 'Your bills and expenses'),
    read(db.from('month_closes').select('month,checked,note,snapshot,closed_at,closed_by').eq('shop_id', shopId).order('month', { ascending: false }).limit(120), rows => rows.map(closeFrom), [] as CloseSaved[], 'Your month-end checklists'),
  ])
  return { settings, mappings, expenses, closes }
}

/* ---------- writes ---------- */

export async function saveSettings(db: Db, shopId: string, actor: Actor, input: Record<string, unknown>): Promise<{ ok: true; settings: BooksSettings } | Failure> {
  const cur = await db.from('accounting_settings').select('*').eq('shop_id', shopId).maybeSingle()
  if (cur.error && !(cur.error.code === 'PGRST116')) return failed(cur.error, 'Saving your accounting settings')
  const checked = checkSettings(input, settingsFrom(cur.data))
  if (!checked.ok) return fail(400, Object.values(checked.errors)[0] || 'Check the settings.', { fields: checked.errors as Record<string, string> })
  const s = checked.value
  const row = {
    shop_id: shopId, basis: s.basis, cogs_method: s.cogsMethod, tax_components: s.taxComponents, labor_cost_per_hour: s.laborCostPerHour,
    journal_mode: s.journalMode, include_cost: s.includeCost, daily_customer: s.dailyCustomer, updated_by: actor.userId, updated_at: new Date().toISOString(),
  }
  const { error } = await db.from('accounting_settings').upsert(row, { onConflict: 'shop_id' })
  if (error) return failed(error, 'Saving your accounting settings')
  return { ok: true, settings: s }
}

const MAPPING_KEYS = () => new Set(allAccountDefs().map(d => d.key))

/** Saves the account names. A blank name puts the suggested name back (the saved row is removed). */
export async function saveMappings(db: Db, shopId: string, actor: Actor, list: unknown): Promise<{ ok: true; saved: number; reset: number } | Failure> {
  if (!Array.isArray(list) || list.length === 0 || list.length > 200) return fail(400, 'Send the account names to save.')
  const keys = MAPPING_KEYS()
  const rows: Row[] = [], blank: string[] = []
  for (const item of list) {
    const o = (item && typeof item === 'object' ? item : {}) as Row
    const key = tidy(o.key, 40)
    if (!keys.has(key)) return fail(400, 'One of the accounts is not one Alpha Desk knows about. Refresh and try again.')
    const name = tidy(o.account_name, 100)
    const number = tidy(o.account_number, 20)
    if (!name) { blank.push(key); continue }
    rows.push({ shop_id: shopId, key, account_name: name, account_number: number || null, updated_by: actor.userId, updated_at: new Date().toISOString() })
  }
  if (rows.length) {
    const { error } = await db.from('account_mappings').upsert(rows, { onConflict: 'shop_id,key' })
    if (error) return failed(error, 'Saving the account names')
  }
  for (const key of blank) {
    const { error } = await db.from('account_mappings').delete().eq('shop_id', shopId).eq('key', key)
    if (error) return failed(error, 'Saving the account names')
  }
  return { ok: true, saved: rows.length, reset: blank.length }
}

/* ---------- expenses ---------- */

const expenseColumns = 'id,date,vendor,category,amount,memo,reference,paid_on,method,voided_at'

export async function addExpense(db: Db, shopId: string, actor: Actor, input: ExpenseInput & { confirm_duplicate?: unknown }, todayKey: string): Promise<{ ok: true; expense: Expense } | Failure> {
  const checked = checkExpense(input, todayKey)
  if (!checked.ok) return fail(400, Object.values(checked.errors)[0] || 'Check the bill.', { fields: checked.errors as ExpenseErrors as Record<string, string> })
  const v = checked.value
  if (input.confirm_duplicate !== true) {
    const existing = await db.from('expenses').select(expenseColumns).eq('shop_id', shopId).gte('date', addDays(v.date, -45)).lte('date', addDays(v.date, 45)).limit(2000)
    if (existing.error) return failed(existing.error, 'Saving the bill')
    const dup = likelyDuplicate((existing.data || []).map(expenseFrom), v)
    if (dup) return fail(409, `A bill from ${dup.vendor} for the same amount on the same day is already entered. Save it anyway only if it is a second bill.`, { duplicate: dup })
  }
  const now = new Date().toISOString()
  const { data, error } = await db.from('expenses').insert({
    shop_id: shopId, date: v.date, vendor: v.vendor, category: v.category, amount: v.amount, memo: v.memo || null, reference: v.reference || null,
    paid_on: v.paid_on, method: v.method || null, created_by: actor.userId, updated_by: actor.userId, updated_at: now,
  }).select(expenseColumns).maybeSingle()
  if (error) return failed(error, 'Saving the bill')
  return { ok: true, expense: expenseFrom(data || {}) }
}

export async function updateExpense(db: Db, shopId: string, actor: Actor, id: unknown, input: ExpenseInput, todayKey: string): Promise<{ ok: true; expense: Expense } | Failure> {
  const key = tidy(id, 64)
  if (!key) return fail(400, 'Choose which bill to change.')
  const checked = checkExpense(input, todayKey)
  if (!checked.ok) return fail(400, Object.values(checked.errors)[0] || 'Check the bill.', { fields: checked.errors as ExpenseErrors as Record<string, string> })
  const v = checked.value
  // Only a bill that is still live can be edited; a voided one stays as it was.
  const { data, error } = await db.from('expenses').update({
    date: v.date, vendor: v.vendor, category: v.category, amount: v.amount, memo: v.memo || null, reference: v.reference || null, paid_on: v.paid_on, method: v.method || null,
    updated_by: actor.userId, updated_at: new Date().toISOString(),
  }).eq('id', key).eq('shop_id', shopId).is('voided_at', null).select(expenseColumns).maybeSingle()
  if (error) return failed(error, 'Saving the bill')
  if (!data) return fail(404, 'That bill was not found, or it was already voided.')
  return { ok: true, expense: expenseFrom(data) }
}

/** Marks a bill paid on a day. */
export async function payExpense(db: Db, shopId: string, actor: Actor, id: unknown, paidOn: unknown, method: unknown, todayKey: string): Promise<{ ok: true; expense: Expense } | Failure> {
  const key = tidy(id, 64)
  const day = tidy(paidOn, 10) || todayKey
  if (!key) return fail(400, 'Choose which bill to mark paid.')
  if (!isDayKey(day)) return fail(400, 'Pick the day it was paid.')
  const cur = await db.from('expenses').select(expenseColumns).eq('id', key).eq('shop_id', shopId).is('voided_at', null).maybeSingle()
  if (cur.error) return failed(cur.error, 'Marking the bill paid')
  if (!cur.data) return fail(404, 'That bill was not found, or it was already voided.')
  const e = expenseFrom(cur.data)
  if (day < e.date) return fail(400, 'It cannot be paid before the date on the bill.', { fields: { paid_on: 'It cannot be paid before the date on the bill.' } })
  const { data, error } = await db.from('expenses').update({ paid_on: day, method: tidy(method, 30) || e.method || null, updated_by: actor.userId, updated_at: new Date().toISOString() })
    .eq('id', key).eq('shop_id', shopId).is('voided_at', null).select(expenseColumns).maybeSingle()
  if (error) return failed(error, 'Marking the bill paid')
  return { ok: true, expense: expenseFrom(data || cur.data) }
}

/** Voiding keeps the bill on record and takes it out of every total. Nothing is deleted. */
export async function voidExpense(db: Db, shopId: string, actor: Actor, id: unknown, reason: unknown): Promise<{ ok: true; expense: Expense } | Failure> {
  const key = tidy(id, 64)
  if (!key) return fail(400, 'Choose which bill to void.')
  const { data, error } = await db.from('expenses').update({ voided_at: new Date().toISOString(), voided_by: actor.userId, void_reason: tidy(reason, 300) || null, updated_by: actor.userId, updated_at: new Date().toISOString() })
    .eq('id', key).eq('shop_id', shopId).is('voided_at', null).select(expenseColumns).maybeSingle()
  if (error) return failed(error, 'Voiding the bill')
  if (!data) return fail(404, 'That bill was not found, or it was already voided.')
  return { ok: true, expense: expenseFrom(data) }
}

/** Puts a voided bill back. */
export async function restoreExpense(db: Db, shopId: string, actor: Actor, id: unknown): Promise<{ ok: true; expense: Expense } | Failure> {
  const key = tidy(id, 64)
  if (!key) return fail(400, 'Choose which bill to restore.')
  const { data, error } = await db.from('expenses').update({ voided_at: null, voided_by: null, void_reason: null, updated_by: actor.userId, updated_at: new Date().toISOString() })
    .eq('id', key).eq('shop_id', shopId).not('voided_at', 'is', null).select(expenseColumns).maybeSingle()
  if (error) return failed(error, 'Restoring the bill')
  if (!data) return fail(404, 'That bill was not found, or it was not voided.')
  return { ok: true, expense: expenseFrom(data) }
}

/* ---------- month-end close ---------- */

const MANUAL_KEYS = new Set(['bank', 'deposits', 'expenses', 'payroll', 'tax', 'inventory', 'accountant'])

export interface CloseInput { month?: unknown; checked?: unknown; note?: unknown; action?: unknown; snapshot?: unknown }

const snapshotFrom = (raw: unknown): Snapshot | null => {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Row
  const n = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100
  return { billed: n(o.billed), collected: n(o.collected), tax: n(o.tax), invoices: Math.round(Number(o.invoices) || 0), owed: n(o.owed), expenses: n(o.expenses) }
}

/**
 * Saves the checklist for a month. `action` is "save" (keep the ticks), "close" (also record that the month was reviewed, with the
 * totals as they stand) or "reopen". Closing records a review; it does not lock invoices.
 */
export async function saveClose(db: Db, shopId: string, actor: Actor, input: CloseInput): Promise<{ ok: true; close: CloseSaved } | Failure> {
  if (!isMonth(input.month)) return fail(400, 'Choose a month.')
  const checkedIn = (input.checked && typeof input.checked === 'object' && !Array.isArray(input.checked) ? input.checked : {}) as Row
  const checked: Record<string, boolean> = {}
  for (const k of MANUAL_KEYS) if (checkedIn[k] === true) checked[k] = true
  const action = input.action === 'close' ? 'close' : input.action === 'reopen' ? 'reopen' : 'save'
  const row: Row = { shop_id: shopId, month: input.month, checked, note: tidy(input.note, 1000) || null, updated_by: actor.userId, updated_at: new Date().toISOString() }
  if (action === 'close') {
    const snap = snapshotFrom(input.snapshot)
    if (!snap) return fail(400, 'The month\'s totals were not sent, so it cannot be closed. Refresh and try again.')
    row.snapshot = snap; row.closed_at = new Date().toISOString(); row.closed_by = actor.userId
  } else if (action === 'reopen') {
    row.closed_at = null; row.closed_by = null
  }
  const { data, error } = await db.from('month_closes').upsert(row, { onConflict: 'shop_id,month' }).select('month,checked,note,snapshot,closed_at,closed_by').maybeSingle()
  if (error) return failed(error, 'Saving the checklist')
  return { ok: true, close: closeFrom(data || row) }
}
