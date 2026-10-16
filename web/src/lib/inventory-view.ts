/**
 * Small pure helpers for the Inventory screens: dates in words, money, the lines of an order being written, and when an error needs a
 * banner of its own. Plain TypeScript with relative imports so the tests can run them.
 */
import type { PartExtra, PurchaseOrder, StockPart, VendorPrice } from './inventory-logic.ts'

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
