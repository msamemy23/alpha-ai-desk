import { parseCount, parseMoney } from '@/lib/list-logic'
import { normalizeCode, validBarcode } from '@/lib/inventory-logic'
import type { PartExtra } from '@/lib/inventory-logic'

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
  // Kept in a table of their own (saved through /api/inventory), so a database without it still saves the part.
  barcode: string
  max_qty: string
  order_multiple: string
  core_charge: string
  preferred_vendor_id: string
}

export type PartErrors = Partial<Record<'name' | 'cost' | 'retail_price' | 'qty_on_hand' | 'qty_reorder' | 'qty_on_order' | 'barcode' | 'max_qty' | 'order_multiple' | 'core_charge', string>>

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v))

export const emptyForm = (): PartForm => ({
  name: '', part_number: '', brand: '', category: '', location: '', description: '', cost: '', retail_price: '',
  qty_on_hand: '0', qty_reorder: '0', qty_on_order: '0', supplier: '', supplier_part_number: '', notes: '',
  barcode: '', max_qty: '', order_multiple: '', core_charge: '', preferred_vendor_id: '',
})

export const toForm = (p: Part, x?: PartExtra | null): PartForm => ({
  name: s(p.name), part_number: s(p.part_number), brand: s(p.brand), category: s(p.category), location: s(p.location), description: s(p.description),
  cost: p.cost === null || p.cost === undefined ? '' : String(p.cost), retail_price: p.retail_price === null || p.retail_price === undefined ? '' : String(p.retail_price),
  qty_on_hand: s(p.qty_on_hand ?? 0), qty_reorder: s(p.qty_reorder ?? 0), qty_on_order: s(p.qty_on_order ?? 0),
  supplier: s(p.supplier), supplier_part_number: s(p.supplier_part_number), notes: s(p.notes),
  barcode: s(x?.barcode), max_qty: x?.max_qty ? String(x.max_qty) : '', order_multiple: x?.order_multiple && x.order_multiple > 1 ? String(x.order_multiple) : '',
  core_charge: x?.core_charge ? String(x.core_charge) : '', preferred_vendor_id: s(x?.preferred_vendor_id),
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
  const code = normalizeCode(f.barcode)
  if (/^\d{8}$|^\d{12}$|^\d{13}$/.test(code) && !validBarcode(code)) e.barcode = 'That barcode does not add up (the last digit is wrong). Scan it again or type it carefully.'
  if (f.max_qty.trim() !== '') {
    const n = parseCount(f.max_qty)
    if (n === null || n < 0) e.max_qty = 'Order up to a whole number, 0 or more.'
  }
  if (f.order_multiple.trim() !== '') {
    const n = parseCount(f.order_multiple)
    if (n === null || n < 1) e.order_multiple = 'The case size is a whole number, 1 or more.'
  }
  if (f.core_charge.trim() !== '') {
    const n = parseMoney(f.core_charge)
    if (n === null || n < 0) e.core_charge = 'Enter the core charge as a number, like 25.00.'
  }
  return e
}

const EXTRA_KEYS = ['barcode', 'max_qty', 'order_multiple', 'core_charge', 'preferred_vendor_id'] as const

/** True when any barcode or ordering box differs from what was loaded. Only then is the extra details call made. */
export const extrasChanged = (now: PartForm, before: PartForm): boolean => EXTRA_KEYS.some(k => now[k].trim() !== before[k].trim())

/** What /api/inventory expects for the barcode and ordering details of one part. A blank box means "not set". */
export function toExtras(f: PartForm, partId: string) {
  return {
    part_id: partId, barcode: f.barcode.trim(), preferred_vendor_id: f.preferred_vendor_id,
    max_qty: f.max_qty.trim() === '' ? null : parseCount(f.max_qty), order_multiple: f.order_multiple.trim() === '' ? null : parseCount(f.order_multiple),
    core_charge: f.core_charge.trim() === '' ? 0 : parseMoney(f.core_charge) ?? 0,
  }
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
