/**
 * Small pure helpers for the Inventory screens: dates in words, money, the lines of an order being written, and when an error needs a
 * banner of its own. Plain TypeScript with relative imports so the tests can run them.
 */
import { normalizeRules, priceFor } from './inventory-logic.ts'
import type { PartExtra, PriceRules, PriceTier, PurchaseOrder, RoundTo, StockPart, VendorPrice } from './inventory-logic.ts'

/** "Oct 14", or "Oct 14, 2025" when it is not this year. Empty for nothing or a date that is not real. */
export function dayWords(key: string | null | undefined, today: string): string {
  if (!key) return ''
  const d = new Date(`${key.slice(0, 10)}T12:00:00`)
  if (Number.isNaN(d.getTime())) return ''
  const sameYear = key.slice(0, 4) === today.slice(0, 4)
  return d.toLocaleDateString('en-US', sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' })
}

/** Days from `from` to `to` (both YYYY-MM-DD), negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to.slice(0, 10)}T12:00:00`) - Date.parse(`${from.slice(0, 10)}T12:00:00`)) / 86_400_000)
}

export const usd = (n: number | null | undefined): string => (n === null || n === undefined ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))

/**
 * Whether a failed save needs a banner as well as the messages under the boxes. When every problem the server named has a box
 * showing it, the banner would only say the same thing twice.
 */
export function needsBanner(fields: Record<string, string>, shown: string[]): boolean {
  const keys = Object.keys(fields)
  return keys.length === 0 || keys.some(k => !shown.includes(k))
}

/* ---------- the order being written ---------- */

export interface LineForm { key: string; part_id: string | null; description: string; sku: string; qty: string; unit_cost: string; core_charge: string }
export interface OrderSeed { id: string | null; vendor_id: string; vendor_name: string; expected_on: string; notes: string; lines: LineForm[] }

let counter = 0
export const lineKey = (): string => `l${Date.now().toString(36)}${(counter += 1)}`
export const emptySeed = (): OrderSeed => ({ id: null, vendor_id: '', vendor_name: '', expected_on: '', notes: '', lines: [] })

const money2 = (n: number | null | undefined) => (n && n > 0 ? n.toFixed(2) : '')

/** A new line for a stocked part: the chosen vendor's price when there is one, else what the part cost last. */
export function lineForPart(p: StockPart, vendorId: string, prices: VendorPrice[], extras: Map<string, PartExtra>, qty?: number): LineForm {
  const price = vendorId ? prices.find(r => r.vendor_id === vendorId && r.part_id === p.id && r.price > 0) : undefined
  const x = extras.get(p.id)
  return {
    key: lineKey(), part_id: p.id, description: p.name, sku: price?.vendor_sku || p.supplier_part_number || p.part_number,
    qty: String(qty && qty > 0 ? qty : x?.order_multiple && x.order_multiple > 1 ? x.order_multiple : 1),
    unit_cost: money2(price ? price.price : p.cost), core_charge: money2(price ? price.core_charge : x?.core_charge),
  }
}

/** The editor's starting point for an existing draft. */
export function seedFrom(po: Pick<PurchaseOrder, 'id' | 'vendor_id' | 'vendor_name' | 'expected_on' | 'notes' | 'lines'>): OrderSeed {
  return {
    id: po.id, vendor_id: po.vendor_id || '', vendor_name: po.vendor_name, expected_on: po.expected_on || '', notes: po.notes,
    lines: po.lines.map((l, i) => ({ key: `e${i}`, part_id: l.part_id, description: l.description, sku: l.sku, qty: String(l.qty), unit_cost: l.unit_cost.toFixed(2), core_charge: l.core_charge > 0 ? l.core_charge.toFixed(2) : '' })),
  }
}

/* ---------- price rules being written ---------- */

/** One price range as the person types it: everything is text, so a half-typed number is never rewritten under their fingers. */
export interface TierDraft { key: string; min: string; max: string; method: 'markup' | 'margin'; pct: string; category: string }
export interface RulesDraft { tiers: TierDraft[]; round_to: RoundTo; minimum_price: string }

export const ROUND_CHOICES: { key: RoundTo; label: string }[] = [
  { key: 'none', label: 'Do not round' },
  { key: '0.99', label: 'Round up to end in .99' },
  { key: '0.05', label: 'Round up to the next 5 cents' },
  { key: '1', label: 'Round up to a whole dollar' },
]

/** A starting point for a shop with no ranges yet. The person changes it before saving; nothing is saved until they do. */
export const EXAMPLE_TIERS: Omit<TierDraft, 'key'>[] = [
  { min: '0', max: '10', method: 'markup', pct: '100', category: '' },
  { min: '10', max: '50', method: 'markup', pct: '70', category: '' },
  { min: '50', max: '150', method: 'markup', pct: '50', category: '' },
  { min: '150', max: '', method: 'markup', pct: '35', category: '' },
]

let tierCounter = 0
export const tierKey = (): string => `t${Date.now().toString(36)}${(tierCounter += 1)}`

const text = (n: number | null): string => (n === null ? '' : String(n))

export function draftFrom(rules: PriceRules): RulesDraft {
  return {
    tiers: rules.tiers.map((t, i) => ({ key: `s${i}`, min: text(t.min_cost), max: text(t.max_cost), method: t.method, pct: text(t.pct), category: t.category })),
    round_to: rules.round_to,
    minimum_price: rules.minimum_price > 0 ? String(rules.minimum_price) : '',
  }
}

const numberOf = (v: string): number | null => {
  const t = v.replace(/[$,%\s]/g, '')
  if (t === '' || t === '.' || t === '-') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** What is wrong with one range, in plain words, or an empty string. */
export function tierProblem(t: TierDraft): string {
  const min = numberOf(t.min), max = t.max.trim() === '' ? null : numberOf(t.max), pct = numberOf(t.pct)
  if (min === null || min < 0) return 'Cost from needs a number, 0 or more.'
  if (t.max.trim() !== '' && (max === null || max <= min)) return 'Up to must be more than where the range starts, or left blank for no limit.'
  if (pct === null || pct < 0) return t.method === 'margin' ? 'Enter the margin as a number, like 40.' : 'Enter the markup as a number, like 50.'
  if (t.method === 'margin' && pct >= 95) return 'A margin has to be under 95%.'
  if (pct > 1000) return 'That percent is too large. Check it.'
  return ''
}

export interface RulesCheck { rules: PriceRules; problems: { key: string; text: string }[]; overlaps: string[]; minimumProblem: string }

/** The rules the draft would save, with a message for every range that does not make sense and a warning for ranges that overlap. */
export function checkDraft(d: RulesDraft): RulesCheck {
  const problems = d.tiers.map((t, i) => ({ key: t.key, text: tierProblem(t) ? `Range ${i + 1}: ${tierProblem(t)}` : '' })).filter(p => p.text)
  const minimum = d.minimum_price.trim() === '' ? 0 : numberOf(d.minimum_price)
  const minimumProblem = minimum === null || minimum < 0 ? 'The lowest price you charge needs a number, 0 or more.' : ''
  const good: PriceTier[] = d.tiers.filter(t => !tierProblem(t)).map(t => ({
    min_cost: numberOf(t.min) as number, max_cost: t.max.trim() === '' ? null : numberOf(t.max), method: t.method, pct: numberOf(t.pct) as number, category: t.category.trim(),
  }))
  const rules = normalizeRules({ tiers: good, round_to: d.round_to, minimum_price: minimum ?? 0 })
  const overlaps: string[] = []
  const valid = d.tiers.map((t, i) => ({ t, i })).filter(x => !tierProblem(x.t))
  for (let a = 0; a < valid.length; a++) {
    for (let b = a + 1; b < valid.length; b++) {
      const x = valid[a], y = valid[b]
      if (x.t.category.trim().toLowerCase() !== y.t.category.trim().toLowerCase()) continue
      const xmin = numberOf(x.t.min) as number, ymin = numberOf(y.t.min) as number
      const xmax = x.t.max.trim() === '' ? Infinity : (numberOf(x.t.max) as number), ymax = y.t.max.trim() === '' ? Infinity : (numberOf(y.t.max) as number)
      if (xmin < ymax && ymin < xmax) overlaps.push(`Range ${x.i + 1} and range ${y.i + 1} cover some of the same costs. The one listed first is used.`)
    }
  }
  return { rules, problems, overlaps, minimumProblem }
}

/** True when two sets of rules are the same, so "Save rules" only lights up for a real change. */
export const sameRules = (a: PriceRules, b: PriceRules): boolean => JSON.stringify(normalizeRules(a)) === JSON.stringify(normalizeRules(b))

/** The range in words: "Cost $10.00 up to $50.00: 70% markup". */
export function rangeWords(t: PriceTier): string {
  const usd0 = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const span = t.max_cost === null ? `Cost ${usd0(t.min_cost)} and up` : `Cost ${usd0(t.min_cost)} up to ${usd0(t.max_cost)}`
  return `${span}: ${t.pct}% ${t.method}${t.category ? ` on ${t.category}` : ''}`
}

export interface RepriceSummary { up: number; down: number; noCost: number; noRange: number; unchanged: number }

/** How the whole parts list fares under the rules: what moves and why the rest stays put. */
export function repriceSummary(parts: StockPart[], rules: PriceRules, changes: { from: number | null; to: number }[]): RepriceSummary {
  let noCost = 0, noRange = 0
  for (const p of parts) {
    const cost = Number(p.cost) || 0
    if (!(cost > 0)) noCost += 1
    else if (priceFor(cost, p.category, rules) === null) noRange += 1
  }
  const up = changes.filter(c => c.from === null || c.from === 0 || c.to > c.from).length
  const down = changes.filter(c => c.from !== null && c.from > 0 && c.to < c.from).length
  return { up, down, noCost, noRange, unchanged: Math.max(0, parts.length - noCost - noRange - changes.length) }
}

