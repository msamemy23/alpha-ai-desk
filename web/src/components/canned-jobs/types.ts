import { cannedTotal, parseCount, parseMoney } from '@/lib/list-logic'

export interface CannedPart { name: string; part_number: string; cost: number; qty: number }

export interface CannedJob {
  id: string
  shop_id?: string
  name: string
  category: string
  description: string
  labor_hours: number | null
  labor_rate: number | null
  parts: CannedPart[] | null
  total_price: number | null
  notes: string
  active: boolean | null
  created_at: string
}

/** Shown in the category list even before any job uses them. Spelling in the list is how new jobs are saved. */
export const DEFAULT_CATEGORIES = ['Oil change', 'Brakes', 'Tires', 'Engine', 'Suspension', 'Electrical', 'Transmission', 'A/C', 'Diagnostic', 'Maintenance', 'Warranty', 'Other']

/** Everything in the form is text, so "0.5" and "1." behave the way they look. */
export interface JobForm {
  name: string
  category: string
  description: string
  labor_hours: string
  labor_rate: string
  notes: string
  active: boolean
}

export interface PartRow { key: string; name: string; part_number: string; cost: string; qty: string }

export interface RowErrors { name?: string; cost?: string; qty?: string }
export interface JobErrors { name?: string; labor_hours?: string; labor_rate?: string; rows: Record<string, RowErrors> }

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v))
let counter = 0
export const newKey = () => `r${Date.now().toString(36)}${(counter++).toString(36)}`

export const emptyForm = (rate: number | null): JobForm => ({
  name: '', category: 'Other', description: '', labor_hours: '1', labor_rate: rate ? String(rate) : '', notes: '', active: true,
})

export const toForm = (j: CannedJob): JobForm => ({
  name: s(j.name), category: s(j.category) || 'Other', description: s(j.description),
  labor_hours: j.labor_hours === null || j.labor_hours === undefined ? '' : String(j.labor_hours),
  labor_rate: j.labor_rate === null || j.labor_rate === undefined ? '' : String(j.labor_rate),
  notes: s(j.notes), active: j.active !== false,
})

export const toRows = (parts: CannedJob['parts']): PartRow[] =>
  (Array.isArray(parts) ? parts : []).map(p => ({
    key: newKey(), name: s(p?.name), part_number: s(p?.part_number),
    cost: p?.cost === null || p?.cost === undefined || Number(p.cost) === 0 ? '' : String(p.cost),
    qty: s(p?.qty ?? 1) || '1',
  }))

/** A row with nothing typed in it is not a part. It is dropped on save instead of becoming a blank line. */
export const rowIsBlank = (r: PartRow): boolean => !r.name.trim() && !r.part_number.trim() && !r.cost.trim() && (r.qty.trim() === '' || r.qty.trim() === '1')

export function validate(f: JobForm, rows: PartRow[]): JobErrors {
  const e: JobErrors = { rows: {} }
  if (!f.name.trim()) e.name = 'Give the job a name so you can find it later.'
  for (const k of ['labor_hours', 'labor_rate'] as const) {
    if (f[k].trim() === '') continue
    const n = parseMoney(f[k])
    if (n === null) e[k] = 'Enter a number, like 1.5.'
    else if (n < 0) e[k] = 'This cannot be below zero.'
  }
  for (const r of rows) {
    if (rowIsBlank(r)) continue
    const re: RowErrors = {}
    if (!r.name.trim()) re.name = 'Name this part, or remove it.'
    if (r.cost.trim() !== '') {
      const n = parseMoney(r.cost)
      if (n === null) re.cost = 'Enter a price, like 12.50.'
      else if (n < 0) re.cost = 'This cannot be below zero.'
    }
    const q = parseCount(r.qty)
    if (r.qty.trim() === '' || q === null || q < 1) re.qty = 'Enter a whole number, 1 or more.'
    if (re.name || re.cost || re.qty) e.rows[r.key] = re
  }
  return e
}

export const hasErrors = (e: JobErrors): boolean => !!(e.name || e.labor_hours || e.labor_rate || Object.keys(e.rows).length)

export const partsOf = (rows: PartRow[]): CannedPart[] =>
  rows.filter(r => !rowIsBlank(r)).map(r => ({ name: r.name.trim(), part_number: r.part_number.trim(), cost: parseMoney(r.cost) ?? 0, qty: parseCount(r.qty) ?? 1 }))

/** What the shop charges for this job, before tax. */
export const totalOf = (f: JobForm, rows: PartRow[], shopRate: number | null): { labor: number; parts: number; total: number; rate: number } => {
  const hours = parseMoney(f.labor_hours) ?? 0
  const rate = parseMoney(f.labor_rate) ?? shopRate ?? 0
  const parts = partsOf(rows)
  const total = cannedTotal(hours, rate, parts)
  const partsOnly = cannedTotal(0, 0, parts)
  return { labor: Math.round(hours * rate * 100) / 100, parts: partsOnly, total, rate }
}

/** The columns written on save. A blank rate falls back to the shop rate, so the saved total matches what an estimate will charge. */
export function toRow(f: JobForm, rows: PartRow[], shopRate: number | null) {
  const t = totalOf(f, rows, shopRate)
  return {
    name: f.name.trim(), category: f.category || 'Other', description: f.description.trim(), notes: f.notes.trim(),
    labor_hours: parseMoney(f.labor_hours) ?? 0, labor_rate: t.rate, parts: partsOf(rows), total_price: t.total, active: f.active,
  }
}

export const money = (n: number | null | undefined): string =>
  '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
