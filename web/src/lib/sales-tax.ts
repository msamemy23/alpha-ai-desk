/**
 * Sales tax by taxing authority, for the return the shop files.
 *
 * Each document records the one rate it charged and the one tax amount. The shop sets how that rate splits between authorities
 * (for example a state share and a local share) and this splits every document's tax the same way, to the cent, so the pieces
 * always add back to exactly what was charged. Nothing here changes a document or how tax is worked out on it.
 *
 * This is bookkeeping help, not tax advice: the screen says to check the split and the filing rules with the shop's accountant.
 */
import { inRange, isSale, round2 } from './reports.ts'
import type { Range, ReportDoc } from './reports.ts'

export interface TaxComponent { name: string; ratePct: number; agency: string }

const clean = (s: unknown) => String(s ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()

/** Tidies what the shop typed (or what the database returned) into a usable list. Bad rows are dropped, never guessed at. */
export function normalizeComponents(raw: unknown): TaxComponent[] {
  if (!Array.isArray(raw)) return []
  const out: TaxComponent[] = []
  for (const r of raw.slice(0, 12)) {
    if (!r || typeof r !== 'object') continue
    const o = r as Record<string, unknown>
    const name = clean(o.name).slice(0, 60)
    const rate = Number(o.ratePct ?? o.rate)
    if (!name || !Number.isFinite(rate) || rate < 0 || rate > 25) continue
    out.push({ name, ratePct: Math.round(rate * 10000) / 10000, agency: clean(o.agency).slice(0, 80) })
  }
  return out
}

export const totalRate = (c: TaxComponent[]): number => Math.round(c.reduce((s, x) => s + x.ratePct, 0) * 10000) / 10000

/** Split an amount of tax across rates by their share, in whole cents, handing leftover cents to the largest remainders. */
export function splitCents(total: number, rates: number[]): number[] {
  const sum = rates.reduce((s, r) => s + r, 0)
  const cents = Math.round(total * 100)
  if (!(sum > 0) || rates.length === 0) return rates.map(() => 0)
  const raw = rates.map(r => (cents * r) / sum)
  const base = raw.map(Math.floor)
  let left = cents - base.reduce((s, n) => s + n, 0)
  const order = raw.map((v, i) => ({ i, frac: v - Math.floor(v) })).sort((a, b) => b.frac - a.frac || a.i - b.i)
  for (let k = 0; left > 0 && k < order.length; k++, left--) base[order[k].i] += 1
  return base.map(n => n / 100)
}

export interface TaxLine { name: string; agency: string; ratePct: number; tax: number }
export interface TaxRow {
  label: string
  /** Billed before tax. */
  sales: number
  /** The part of sales tax was charged on. */
  taxable: number
  nonTaxable: number
  tax: number
  byComponent: TaxLine[]
  invoices: number
}
export interface TaxReport extends TaxRow {
  configured: boolean
  /** Invoices whose own rate differs from the total of the rates set. Their tax is still split by the same shares. */
  ratesDiffer: { count: number; ids: string[]; rates: number[] }
  /** Invoices on which no tax was charged. */
  untaxed: { count: number; ids: string[] }
}

/** The taxable amount on a document: the recorded base, or worked back from tax and rate for documents that predate it. */
export function taxableOf(d: ReportDoc): number {
  if (d.taxable !== undefined) return d.taxable
  if (d.taxRate && d.taxRate > 0 && d.tax > 0) return round2(d.tax / (d.taxRate / 100))
  return 0
}

function emptyRow(label: string, comps: TaxComponent[]): TaxRow {
  return { label, sales: 0, taxable: 0, nonTaxable: 0, tax: 0, invoices: 0, byComponent: comps.map(c => ({ name: c.name, agency: c.agency, ratePct: c.ratePct, tax: 0 })) }
}

function addDoc(row: TaxRow, d: ReportDoc, comps: TaxComponent[]) {
  const sales = round2(d.total - d.tax)
  const taxable = Math.min(sales, taxableOf(d))
  row.sales = round2(row.sales + sales)
  row.taxable = round2(row.taxable + taxable)
  row.nonTaxable = round2(row.nonTaxable + (sales - taxable))
  row.tax = round2(row.tax + d.tax)
  row.invoices += 1
  if (comps.length && d.tax > 0) {
    const parts = splitCents(d.tax, comps.map(c => c.ratePct))
    parts.forEach((p, i) => { row.byComponent[i].tax = round2(row.byComponent[i].tax + p) })
  }
}

export function taxReport(docs: ReportDoc[], range: Range, components: TaxComponent[]): TaxReport {
  const comps = components.filter(c => c.ratePct > 0)
  const row = emptyRow('Total', comps)
  const differ: string[] = [], rates = new Set<number>(), untaxed: string[] = []
  const sum = totalRate(comps)
  for (const d of docs) {
    if (!isSale(d) || !inRange(d.date, range)) continue
    addDoc(row, d, comps)
    if (!(d.tax > 0)) untaxed.push(d.id)
    else if (comps.length && d.taxRate !== undefined && Math.abs(d.taxRate - sum) > 0.0049) { differ.push(d.id); rates.add(d.taxRate) }
  }
  return {
    ...row, configured: comps.length > 0,
    ratesDiffer: { count: differ.length, ids: differ, rates: [...rates].sort((a, b) => a - b) },
    untaxed: { count: untaxed.length, ids: untaxed },
  }
}

export type TaxGrain = 'month' | 'quarter'

/** The same report cut by month or calendar quarter, oldest first, for filing. Only periods with invoices are listed. */
export function taxByPeriod(docs: ReportDoc[], range: Range, components: TaxComponent[], grain: TaxGrain): TaxRow[] {
  const comps = components.filter(c => c.ratePct > 0)
  const rows = new Map<string, TaxRow>()
  for (const d of docs) {
    if (!isSale(d) || !inRange(d.date, range) || d.date.length < 7) continue
    const y = d.date.slice(0, 4), m = Number(d.date.slice(5, 7))
    const key = grain === 'month' ? d.date.slice(0, 7) : `${y}-Q${Math.ceil(m / 3)}`
    const label = grain === 'month' ? new Date(`${key}-01T12:00:00`).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : `${y} Q${Math.ceil(m / 3)}`
    const row = rows.get(key) || emptyRow(label, comps)
    addDoc(row, d, comps)
    rows.set(key, row)
  }
  return [...rows.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(x => x[1])
}
