import { parseCount, parseMoney } from '@/lib/list-logic'

export interface Part {
  id: string
  shop_id?: string
  part_number: string
  name: string
  category: string
  brand: string
  description: string
  cost: number | null
  retail_price: number | null
  qty_on_hand: number | null
  qty_reorder: number | null
  qty_on_order: number | null
  location: string
  supplier: string
  supplier_part_number: string
  notes: string
  last_ordered: string
  created_at: string
}

// These are the saved values, so they stay as they are. Display goes through sentenceCase().
export const CATEGORIES = ['Filters', 'Brakes', 'Suspension', 'Engine', 'Electrical', 'Belts & Hoses', 'Fluids & Chemicals', 'Tires', 'Exhaust', 'Cooling', 'Transmission', 'Other']

/** Everything in the form is text, so a half-typed "0." or an emptied box is never rewritten under the person's fingers. */
export interface PartForm {
  name: string
  part_number: string
  brand: string
  category: string
  location: string
  description: string
  cost: string
  retail_price: string
  qty_on_hand: string
  qty_reorder: string
  qty_on_order: string
  supplier: string
  supplier_part_number: string
  notes: string
}

export type PartErrors = Partial<Record<'name' | 'cost' | 'retail_price' | 'qty_on_hand' | 'qty_reorder' | 'qty_on_order', string>>

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v))

export const emptyForm = (): PartForm => ({
  name: '', part_number: '', brand: '', category: '', location: '', description: '', cost: '', retail_price: '',
  qty_on_hand: '0', qty_reorder: '0', qty_on_order: '0', supplier: '', supplier_part_number: '', notes: '',
})

export const toForm = (p: Part): PartForm => ({
  name: s(p.name), part_number: s(p.part_number), brand: s(p.brand), category: s(p.category), location: s(p.location), description: s(p.description),
  cost: p.cost === null || p.cost === undefined ? '' : String(p.cost), retail_price: p.retail_price === null || p.retail_price === undefined ? '' : String(p.retail_price),
  qty_on_hand: s(p.qty_on_hand ?? 0), qty_reorder: s(p.qty_reorder ?? 0), qty_on_order: s(p.qty_on_order ?? 0),
  supplier: s(p.supplier), supplier_part_number: s(p.supplier_part_number), notes: s(p.notes),
})

/** Plain sentences for whatever is wrong. Empty object means the form can be saved. */
export function validate(f: PartForm): PartErrors {
  const e: PartErrors = {}
  if (!f.name.trim()) e.name = 'Give the part a name so you can find it later.'
  for (const k of ['cost', 'retail_price'] as const) {
    if (f[k].trim() === '') continue
    const n = parseMoney(f[k])
    if (n === null) e[k] = 'Enter a price as a number, like 12.50.'
    else if (n < 0) e[k] = 'This cannot be below zero.'
  }
  for (const k of ['qty_on_hand', 'qty_reorder', 'qty_on_order'] as const) {
    if (f[k].trim() === '') continue
    const n = parseCount(f[k])
    if (n === null) e[k] = 'Enter a whole number.'
    else if (n < 0) e[k] = 'This cannot be below zero.'
  }
  return e
}

/** Columns written on save. A blank price is saved as 0, as before; a blank count is 0. */
export function toRow(f: PartForm) {
  return {
    name: f.name.trim(), part_number: f.part_number.trim(), brand: f.brand.trim(), category: f.category, location: f.location.trim(),
    description: f.description.trim(), supplier: f.supplier.trim(), supplier_part_number: f.supplier_part_number.trim(), notes: f.notes.trim(),
    cost: parseMoney(f.cost) ?? 0, retail_price: parseMoney(f.retail_price) ?? 0,
    qty_on_hand: parseCount(f.qty_on_hand) ?? 0, qty_reorder: parseCount(f.qty_reorder) ?? 0, qty_on_order: parseCount(f.qty_on_order) ?? 0,
  }
}

export const money = (n: number | null | undefined): string =>
  n === null || n === undefined ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
