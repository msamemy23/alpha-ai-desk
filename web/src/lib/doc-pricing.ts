// Pricing helpers for writing a document: markup matrix, labor rates, shop supplies, discounts.
//
// These only decide numbers that are typed into the document (a price, a rate, a supplies amount).
// Once typed, the amounts flow through document-money.ts unchanged. A discount is "baked" into the
// stored price and the original price is kept beside it (listPrice, listRate, listAmount), so the
// customer sees what they saved while every total stays the plain sum of the stored lines.

import {
  getLaborFlatAmount,
  nonNegativeDecimal,
  quantityFromUnknown,
  roundMoney,
  calculateDocumentTotals,
} from '@/lib/document-money'
import { lineSavings } from '@/lib/doc-lines'
import type { Line } from '@/lib/doc-lines'

const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(/[$,\s]/g, '')) : NaN
  return Number.isFinite(n) ? n : fallback
}
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
const text = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v))

/* ───────────────────────── Parts markup matrix ───────────────────────── */

export interface MarkupTier { upTo: number | null; pct: number }
export type RoundTo = 'cent' | 'quarter' | 'dollar'
/**
 * `enabled` is the shop's own choice to use the rules when pricing a part. It is off until the shop turns it on, so rules
 * saved before the switch existed do nothing on their own. Turning it on only lets the editor suggest a price for a part
 * that has a cost; it never changes a price by itself or touches a document already written.
 */
export interface MarkupMatrix { enabled: boolean; mode: 'markup' | 'margin'; tiers: MarkupTier[]; roundTo: RoundTo }

export const DEFAULT_MATRIX: MarkupMatrix = { enabled: false, mode: 'markup', tiers: [], roundTo: 'cent' }

export function normalizeMatrix(raw: unknown): MarkupMatrix {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_MATRIX, tiers: [] }
  const r = raw as Record<string, unknown>
  const mode = r.mode === 'margin' ? 'margin' : 'markup'
  const roundTo: RoundTo = r.roundTo === 'quarter' || r.roundTo === 'dollar' ? r.roundTo : 'cent'
  const tiers: MarkupTier[] = (Array.isArray(r.tiers) ? r.tiers : [])
    .map((t): MarkupTier | null => {
      if (!t || typeof t !== 'object') return null
      const o = t as Record<string, unknown>
      const upTo = o.upTo === null || o.upTo === undefined || o.upTo === '' ? null : num(o.upTo, NaN)
      if (upTo !== null && (!Number.isFinite(upTo) || upTo < 0)) return null
      const pct = num(o.pct, NaN)
      if (!Number.isFinite(pct)) return null
      // A margin of 100% or more has no price. Markup can be any positive number.
      return { upTo: upTo === null ? null : roundMoney(upTo), pct: mode === 'margin' ? clamp(pct, 0, 95) : clamp(pct, 0, 1000) }
    })
    .filter((t): t is MarkupTier => t !== null)
    .slice(0, 12)
  tiers.sort((a, b) => (a.upTo === null ? Infinity : a.upTo) - (b.upTo === null ? Infinity : b.upTo))
  return { enabled: r.enabled === true, mode, tiers, roundTo }
}

export function tierFor(matrix: MarkupMatrix, cost: number): MarkupTier | null {
  if (!(cost >= 0)) return null
  for (const t of matrix.tiers) if (t.upTo === null || cost <= t.upTo) return t
  return null
}

function roundPrice(value: number, to: RoundTo): number {
  if (to === 'dollar') return Math.ceil(value - 1e-9)
  if (to === 'quarter') return Math.ceil(value * 4 - 1e-9) / 4
  return roundMoney(value)
}

/** The selling price for a part cost, or null when the matrix has no rule for it. */
export function matrixPrice(matrix: MarkupMatrix, cost: unknown): number | null {
  const c = num(cost, NaN)
  if (!Number.isFinite(c) || c <= 0) return null
  const tier = tierFor(matrix, c)
  if (!tier) return null
  const price = matrix.mode === 'margin' ? c / (1 - tier.pct / 100) : c * (1 + tier.pct / 100)
  return roundMoney(roundPrice(price, matrix.roundTo))
}

/** A tier written out in plain words, for the settings screen. */
export function tierSummary(matrix: MarkupMatrix, t: MarkupTier, index: number): string {
  const from = index === 0 ? 0 : matrix.tiers[index - 1].upTo ?? 0
  const range = t.upTo === null ? `Over $${from.toFixed(2)}` : `$${from.toFixed(2)} to $${t.upTo.toFixed(2)}`
  return `${range}: ${t.pct}% ${matrix.mode}`
}

/* ───────────────────────── Labor rates ───────────────────────── */

export interface RateEntry { name: string; rate: number }
export interface LaborRates { defaultRate: number | null; types: RateEntry[]; techs: RateEntry[] }

function entries(raw: unknown): RateEntry[] {
  return (Array.isArray(raw) ? raw : [])
    .map((e): RateEntry | null => {
      if (!e || typeof e !== 'object') return null
      const o = e as Record<string, unknown>
      const name = text(o.name).replace(/\s+/g, ' ').trim().slice(0, 60)
      const rate = num(o.rate, NaN)
      if (!name || !Number.isFinite(rate) || rate < 0 || rate > 2000) return null
      return { name, rate: roundMoney(rate) }
    })
    .filter((e): e is RateEntry => e !== null)
    .slice(0, 40)
}

export function normalizeRates(raw: unknown): LaborRates {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const d = num(r.defaultRate, NaN)
  return { defaultRate: Number.isFinite(d) && d >= 0 ? roundMoney(d) : null, types: entries(r.types), techs: entries(r.techs) }
}

/** Rate for a technician beats the rate for a kind of work, which beats the shop rate. */
export function laborRateFor(rates: LaborRates, pick: { type?: string; tech?: string }, shopRate: number | null): number {
  const lc = (s: unknown) => text(s).trim().toLowerCase()
  const tech = lc(pick.tech)
  const type = lc(pick.type)
  if (tech) {
    const hit = rates.techs.find((e) => e.name.toLowerCase() === tech)
    if (hit) return hit.rate
  }
  if (type) {
    const hit = rates.types.find((e) => e.name.toLowerCase() === type)
    if (hit) return hit.rate
  }
  return rates.defaultRate ?? shopRate ?? 0
}

/* ───────────────────────── Shop supplies ───────────────────────── */

export type SuppliesMode = 'off' | 'labor' | 'parts' | 'both'
export interface SuppliesRule { mode: SuppliesMode; pct: number; min: number; cap: number }
export const DEFAULT_SUPPLIES: SuppliesRule = { mode: 'off', pct: 0, min: 0, cap: 0 }

export function normalizeSupplies(raw: unknown): SuppliesRule {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const mode: SuppliesMode = r.mode === 'labor' || r.mode === 'parts' || r.mode === 'both' ? r.mode : 'off'
  return {
    mode,
    pct: roundMoney(clamp(num(r.pct, 0), 0, 50)),
    min: roundMoney(clamp(num(r.min, 0), 0, 10000)),
    cap: roundMoney(clamp(num(r.cap, 0), 0, 100000)),
  }
}

/** Shop supplies by the shop's rule. A cap of 0 means no cap. */
export function suppliesFor(rule: SuppliesRule, base: { laborTotal: number; partsTotal: number }): number {
  if (rule.mode === 'off' || rule.pct <= 0) return 0
  const basis = rule.mode === 'labor' ? base.laborTotal : rule.mode === 'parts' ? base.partsTotal : base.laborTotal + base.partsTotal
  if (basis <= 0) return 0
  let amount = roundMoney(basis * (rule.pct / 100))
  if (rule.min > 0 && amount < rule.min) amount = rule.min
  if (rule.cap > 0 && amount > rule.cap) amount = rule.cap
  return roundMoney(amount)
}

/**
 * After some work is declined: if the shop supplies on the document is exactly what the rule gives
 * for the full document, it follows the rule for what is left. If someone typed a different amount,
 * it stays as typed.
 */
export function suppliesAfterChange(
  rule: SuppliesRule,
  currentSupplies: unknown,
  before: { laborTotal: number; partsTotal: number },
  after: { laborTotal: number; partsTotal: number },
): number {
  const current = roundMoney(num(currentSupplies, 0))
  if (rule.mode === 'off') return current
  if (Math.abs(current - suppliesFor(rule, before)) > 0.005) return current
  return suppliesFor(rule, after)
}

/* ───────────────────────── Exact cents ───────────────────────── */

const scaledThousandths = (n: number): number | null => {
  const s = Math.round(n * 1000)
  return Math.abs(n * 1000 - s) < 1e-6 ? s : null
}

/**
 * The database adds up unrounded line amounts and rounds once, while the app rounds each line. The two
 * agree whenever every line comes to a whole number of cents. A unit price (or labor rate) made by a
 * discount or a markup could break that for a fractional quantity or hours (2.5 x $3.33). This moves
 * the unit price by a few cents, to the nearest one where quantity x price is exact in cents, so a
 * generated price can never open a one-cent gap between the screen and the payment ledger.
 */
export function snapUnit(qty: number, unit: number): number | null {
  const target = Math.round(unit * 100)
  if (target <= 0) return 0
  const q = scaledThousandths(qty)
  if (q === null) return null
  if (q <= 0) return target / 100
  const exact = (cents: number) => (q * cents) % 1000 === 0
  if (exact(target)) return target / 100
  for (let d = 1; d <= 50; d++) {
    if (target - d > 0 && exact(target - d)) return (target - d) / 100
    if (exact(target + d)) return (target + d) / 100
  }
  return null
}

/* ───────────────────────── Discounts ───────────────────────── */

export type DiscountScope = 'labor' | 'parts' | 'all'

const pctOf = (list: number, price: number): number => (list > 0 ? roundMoney(((list - price) / list) * 100) : 0)

/** Patch to apply a discount to a part line. Re-applying starts again from the list price. */
export function partDiscountPatch(line: Line, input: { pct?: number; amount?: number }): Line {
  const list = nonNegativeDecimal(line.listPrice, 0) || nonNegativeDecimal(line.unitPrice, 0)
  const qty = Math.max(quantityFromUnknown(line.qty), 1)
  let price: number | null = list
  if (input.pct !== undefined) price = snapUnit(quantityFromUnknown(line.qty), list * (1 - clamp(input.pct, 0, 100) / 100))
  else if (input.amount !== undefined) price = snapUnit(quantityFromUnknown(line.qty), Math.max(0, list - clamp(input.amount, 0, list * qty) / qty))
  // A quantity like 2.333 has no whole-cent price near the target, so the line is left as typed.
  if (price === null) return {}
  if (price >= list) return { listPrice: undefined, discountPct: undefined, unitPrice: list }
  return { listPrice: list, unitPrice: price, discountPct: pctOf(list, price) }
}

/** Patch to apply a discount to a labor line (hourly or flat). */
export function laborDiscountPatch(line: Line, input: { pct?: number; amount?: number }): Line {
  const flat = getLaborFlatAmount(line)
  if (flat !== null) {
    const list = nonNegativeDecimal(line.listAmount, 0) || Math.max(flat, 0)
    let amount = list
    if (input.pct !== undefined) amount = roundMoney(list * (1 - clamp(input.pct, 0, 100) / 100))
    else if (input.amount !== undefined) amount = Math.max(0, roundMoney(list - clamp(input.amount, 0, list)))
    if (amount >= list) return { listAmount: undefined, discountPct: undefined, amount: list }
    return { listAmount: list, amount, discountPct: pctOf(list, amount) }
  }
  const list = nonNegativeDecimal(line.listRate, 0) || nonNegativeDecimal(line.rate, 0)
  const hours = nonNegativeDecimal(line.hours, 0)
  let rate: number | null = list
  if (input.pct !== undefined) rate = snapUnit(hours, list * (1 - clamp(input.pct, 0, 100) / 100))
  else if (input.amount !== undefined && hours > 0) rate = snapUnit(hours, Math.max(0, list - clamp(input.amount, 0, list * hours) / hours))
  if (rate === null) return {}
  if (rate >= list) return { listRate: undefined, discountPct: undefined, rate: list }
  return { listRate: list, rate, discountPct: pctOf(list, rate) }
}

/** Removes a discount and puts the list price back. */
export function clearDiscountPatch(line: Line, kind: 'part' | 'labor'): Line {
  if (kind === 'part') {
    const list = nonNegativeDecimal(line.listPrice, 0)
    return list > 0 ? { unitPrice: list, listPrice: undefined, discountPct: undefined } : {}
  }
  if (getLaborFlatAmount(line) !== null) {
    const list = nonNegativeDecimal(line.listAmount, 0)
    return list > 0 ? { amount: list, listAmount: undefined, discountPct: undefined } : {}
  }
  const list = nonNegativeDecimal(line.listRate, 0)
  return list > 0 ? { rate: list, listRate: undefined, discountPct: undefined } : {}
}

const strip = (line: Line, patch: Line): Line => {
  const next: Line = { ...line }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete next[k]
    else next[k] = v
  }
  return next
}

/** Percent off labor, parts, or everything. Fees and outside work are not discounted. */
export function applyPercentDiscount(doc: Record<string, unknown>, scope: DiscountScope, pct: number): { parts: Line[]; labors: Line[] } {
  const parts = (Array.isArray(doc.parts) ? doc.parts : []) as Line[]
  const labors = (Array.isArray(doc.labors) ? doc.labors : []) as Line[]
  const p = clamp(pct, 0, 100)
  return {
    parts: parts.map((l) => (scope === 'labor' || !l || typeof l !== 'object' || l.kind === 'fee' || l.kind === 'sublet' ? l : strip(l, partDiscountPatch(l, { pct: p })))),
    labors: labors.map((l) => (scope === 'parts' || !l || typeof l !== 'object' ? l : strip(l, laborDiscountPatch(l, { pct: p })))),
  }
}

export function clearAllDiscounts(doc: Record<string, unknown>): { parts: Line[]; labors: Line[] } {
  const parts = (Array.isArray(doc.parts) ? doc.parts : []) as Line[]
  const labors = (Array.isArray(doc.labors) ? doc.labors : []) as Line[]
  return {
    parts: parts.map((l) => (l && typeof l === 'object' ? strip(l, clearDiscountPatch(l, 'part')) : l)),
    labors: labors.map((l) => (l && typeof l === 'object' ? strip(l, clearDiscountPatch(l, 'labor')) : l)),
  }
}

export interface DiscountSummary { labor: number; parts: number; total: number }

/** What the customer saved across the document, from the list prices kept on discounted lines. */
export function discountSummary(doc: Record<string, unknown>): DiscountSummary {
  const parts = (Array.isArray(doc.parts) ? doc.parts : []).filter((l): l is Line => Boolean(l && typeof l === 'object'))
  const labors = (Array.isArray(doc.labors) ? doc.labors : []).filter((l): l is Line => Boolean(l && typeof l === 'object'))
  const partsSaved = roundMoney(parts.reduce((s, l) => s + lineSavings(l, 'part'), 0))
  const laborSaved = roundMoney(labors.reduce((s, l) => s + lineSavings(l, 'labor'), 0))
  return { labor: laborSaved, parts: partsSaved, total: roundMoney(laborSaved + partsSaved) }
}

/* ───────────────────────── Effective rate ───────────────────────── */

/** Labor dollars per hour actually charged on hourly lines, after discounts. Null when there are no hours. */
export function effectiveLaborRate(doc: Record<string, unknown>): number | null {
  const labors = (Array.isArray(doc.labors) ? doc.labors : []).filter((l): l is Line => Boolean(l && typeof l === 'object'))
  let hours = 0
  let dollars = 0
  for (const l of labors) {
    if (getLaborFlatAmount(l) !== null) continue
    const h = nonNegativeDecimal(l.hours)
    hours += h
    dollars += h * nonNegativeDecimal(l.rate)
  }
  return hours > 0 ? roundMoney(dollars / hours) : null
}

/** Profit across parts that have a private cost, as dollars and percent of price. */
export function partsMargin(doc: Record<string, unknown>): { cost: number; price: number; profit: number; pct: number | null } {
  const parts = (Array.isArray(doc.parts) ? doc.parts : []).filter((l): l is Line => Boolean(l && typeof l === 'object'))
  let cost = 0
  let price = 0
  for (const p of parts) {
    const c = nonNegativeDecimal(p.cost, 0)
    if (c <= 0) continue
    const qty = quantityFromUnknown(p.qty)
    cost += c * qty
    price += nonNegativeDecimal(p.unitPrice, 0) * qty
  }
  cost = roundMoney(cost)
  price = roundMoney(price)
  return { cost, price, profit: roundMoney(price - cost), pct: price > 0 ? roundMoney(((price - cost) / price) * 100) : null }
}

/** Totals of the pieces the supplies rule looks at. */
export function suppliesBase(doc: Record<string, unknown>): { laborTotal: number; partsTotal: number } {
  const t = calculateDocumentTotals({ ...doc, shop_supplies: 0, sublet: 0 })
  return { laborTotal: t.laborTotal, partsTotal: t.partsTotal }
}
