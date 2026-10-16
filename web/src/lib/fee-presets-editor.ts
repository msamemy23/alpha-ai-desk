// The shop's "usual charges" as the Settings screen edits them, kept free of React so they can be tested on their own.
//
// A usual charge (tire disposal, environmental fee, towing) is saved once and then offered as a one-tap button in the Add a fee
// sheet of an estimate or invoice. They are stored with the rest of the paperwork settings (doc-prefs.ts, `fees`). This file turns
// what was typed into the stored list, checking every row first with the same rules the server applies (normalizeFees), so a row
// is never dropped silently. It never touches a document or does any money maths: the amount is the price of the line, as typed.

import { normalizeFees } from '@/lib/doc-prefs'
import type { FeePreset } from '@/lib/doc-prefs'

export type FeeKind = FeePreset['kind']

/** One usual charge as it sits on screen. The amount is text so "5." and a cleared box behave the way they look. */
export interface FeeRow { id: string; name: string; amount: string; taxable: boolean; kind: FeeKind }
export interface FeeRowErrors { name?: string; amount?: string }

export const MAX_FEES = 20
export const MAX_FEE_NAME = 60
export const MAX_FEE_AMOUNT = 100000

/** A fresh id that no other row uses. */
export function newFeeId(taken: Iterable<string> = []): string {
  const used = new Set(taken)
  let id = ''
  do { id = `fee-${Math.random().toString(36).slice(2, 8)}` } while (used.has(id))
  return id
}

export function newFeeRow(taken: Iterable<string> = []): FeeRow {
  return { id: newFeeId(taken), name: '', amount: '', taxable: true, kind: 'fee' }
}

/** The stored list as rows. Two stored charges that share an id get different ids here, so rows can be told apart. */
export function feesToRows(fees: FeePreset[]): FeeRow[] {
  const used = new Set<string>()
  return fees.map((f) => {
    let id = f.id
    while (!id || used.has(id)) id = newFeeId(used)
    used.add(id)
    return { id, name: f.name, amount: f.amount.toFixed(2), taxable: f.taxable, kind: f.kind }
  })
}

/** The same charges, ignoring the spaces around what was typed. Used to tell whether anything was changed. */
export function sameRows(a: FeeRow[], b: FeeRow[]): boolean {
  const flat = (rows: FeeRow[]) => JSON.stringify(rows.map((r) => [r.id, r.name.trim(), r.amount.trim(), r.taxable, r.kind]))
  return flat(a) === flat(b)
}

const decimal = (s: string): number => {
  const t = s.replace(/[$,\s]/g, '')
  return /^(\d+\.?\d*|\.\d+)$/.test(t) ? Number(t) : NaN
}

/** A row with nothing typed in the name or the amount is not a charge. It is left out on save instead of becoming an error. */
export const rowIsBlank = (r: FeeRow): boolean => !r.name.trim() && !r.amount.trim()

export interface FeeResult {
  /** The charges the valid rows make, in the form they are stored. */
  fees: FeePreset[]
  /** A problem with one row, by the row's id. Saving is blocked while there are any. */
  errors: Record<string, FeeRowErrors>
  /** A problem with the list as a whole, or an empty string. */
  problem: string
}

/** Checks what was typed and builds the stored list. The list is cleaned by normalizeFees, the function the server uses. */
export function rowsToFees(rows: FeeRow[]): FeeResult {
  const errors: Record<string, FeeRowErrors> = {}
  const valid: FeePreset[] = []
  const names = new Set<string>()
  const used = rows.filter((r) => !rowIsBlank(r))

  for (const r of used) {
    const e: FeeRowErrors = {}
    const name = r.name.replace(/\s+/g, ' ').trim()
    if (!name) e.name = 'Say what the charge is for, like Tire disposal.'
    else if (name.length > MAX_FEE_NAME) e.name = `Use ${MAX_FEE_NAME} characters or fewer.`
    else if (names.has(name.toLowerCase())) e.name = 'Another charge already has this name.'

    const amount = decimal(r.amount)
    if (!Number.isFinite(amount)) e.amount = 'Enter the amount, like 25.00.'
    else if (amount <= 0) e.amount = 'Enter an amount above $0.00.'
    else if (amount > MAX_FEE_AMOUNT) e.amount = 'The most a charge can be is $100,000.00.'

    if (e.name || e.amount) { errors[r.id] = e; continue }
    names.add(name.toLowerCase())
    valid.push({ id: r.id, name, amount: Math.round(amount * 100) / 100, taxable: r.taxable, kind: r.kind === 'sublet' ? 'sublet' : 'fee' })
  }

  let problem = ''
  if (used.length > MAX_FEES) problem = `You can keep up to ${MAX_FEES} usual charges. Remove one first.`
  const fees = normalizeFees(valid)
  // Every valid row must survive the server's own clean-up. If one would not, say so now instead of losing it on save.
  if (!problem && Object.keys(errors).length === 0 && fees.length !== valid.length) problem = 'One of the charges could not be kept. Check each name and amount.'
  return { fees, errors, problem }
}
