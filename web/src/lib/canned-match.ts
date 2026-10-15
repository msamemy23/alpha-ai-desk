// Canned jobs: which ones fit a vehicle, what the lines look like when one is added to a document,
// and what the shop has charged for similar work before.
//
// The base canned job (name, hours, rate, parts) is unchanged. Extra information (keywords, which
// vehicles it fits, per-vehicle variants, fees, a note for the customer, inspection words) lives in
// canned_job_extras (migration 047), one JSON object per job. Jobs with no extras behave exactly as
// they always did: one labor line and the parts, added as typed.

import { getLaborFlatAmount, nonNegativeDecimal, quantityFromUnknown, roundMoney } from '@/lib/document-money'
import { cleanJobName, makeFeeLine } from '@/lib/doc-lines'
import type { Line } from '@/lib/doc-lines'

const text = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v))
const norm = (v: unknown): string => text(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

export interface Vehicle { year: number | null; make: string; model: string }

export function vehicleOf(doc: Record<string, unknown>): Vehicle {
  const y = parseInt(text(doc.vehicle_year), 10)
  return { year: Number.isFinite(y) && y > 1900 && y < 2200 ? y : null, make: text(doc.vehicle_make).trim(), model: text(doc.vehicle_model).trim() }
}

export interface Fit { makes: string[]; models: string[]; yearFrom: number | null; yearTo: number | null }
export interface CannedPartRow { name: string; part_number?: string; cost: number; qty: number }
export interface Variant {
  id: string
  label: string
  fit: Fit
  /** Replaces the job's hours when set. */
  hours: number | null
  /** A fixed labor price for this vehicle. Replaces hours times rate. */
  laborPrice: number | null
  /** When set, replaces the job's parts for this vehicle. */
  parts: CannedPartRow[] | null
}
export interface JobFee { name: string; amount: number; taxable: boolean; kind: 'fee' | 'sublet' }
export interface CannedExtras {
  keywords: string[]
  fit: Fit | null
  variants: Variant[]
  fees: JobFee[]
  /** Printed under the line for the customer. */
  note: string
  /** Words from inspection findings that point to this job. */
  inspectionKeys: string[]
}

export const EMPTY_EXTRAS: CannedExtras = { keywords: [], fit: null, variants: [], fees: [], note: '', inspectionKeys: [] }

const strList = (v: unknown, max = 20): string[] =>
  (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map((s) => text(s).trim()).filter(Boolean).slice(0, max)
const yearOrNull = (v: unknown): number | null => {
  const n = parseInt(text(v), 10)
  return Number.isFinite(n) && n > 1900 && n < 2200 ? n : null
}

export function normalizeFit(raw: unknown): Fit | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const fit: Fit = { makes: strList(o.makes, 30), models: strList(o.models, 30), yearFrom: yearOrNull(o.yearFrom), yearTo: yearOrNull(o.yearTo) }
  return fit.makes.length || fit.models.length || fit.yearFrom || fit.yearTo ? fit : null
}

function partRows(raw: unknown): CannedPartRow[] | null {
  if (!Array.isArray(raw)) return null
  const rows = raw
    .map((p): CannedPartRow | null => {
      if (!p || typeof p !== 'object') return null
      const o = p as Record<string, unknown>
      const name = text(o.name).trim()
      if (!name) return null
      return { name, part_number: text(o.part_number).trim(), cost: nonNegativeDecimal(o.cost, 0), qty: Math.max(1, Math.round(quantityFromUnknown(o.qty))) }
    })
    .filter((p): p is CannedPartRow => p !== null)
  return rows
}

export function normalizeExtras(raw: unknown): CannedExtras {
  if (!raw || typeof raw !== 'object') return { ...EMPTY_EXTRAS }
  const o = raw as Record<string, unknown>
  const variants = (Array.isArray(o.variants) ? o.variants : [])
    .map((v, i): Variant | null => {
      if (!v || typeof v !== 'object') return null
      const r = v as Record<string, unknown>
      const fit = normalizeFit(r.fit)
      const label = text(r.label).replace(/\s+/g, ' ').trim().slice(0, 60)
      if (!fit || !label) return null
      const hours = r.hours === null || r.hours === undefined || r.hours === '' ? null : nonNegativeDecimal(r.hours, NaN)
      const price = r.laborPrice === null || r.laborPrice === undefined || r.laborPrice === '' ? null : nonNegativeDecimal(r.laborPrice, NaN)
      return {
        id: text(r.id) || `v${i}`,
        label,
        fit,
        hours: hours !== null && Number.isFinite(hours) ? hours : null,
        laborPrice: price !== null && Number.isFinite(price) ? roundMoney(price) : null,
        parts: partRows(r.parts),
      }
    })
    .filter((v): v is Variant => v !== null)
    .slice(0, 30)
  const fees = (Array.isArray(o.fees) ? o.fees : [])
    .map((f): JobFee | null => {
      if (!f || typeof f !== 'object') return null
      const r = f as Record<string, unknown>
      const name = text(r.name).trim().slice(0, 60)
      const amount = nonNegativeDecimal(r.amount, NaN)
      if (!name || !Number.isFinite(amount)) return null
      return { name, amount: roundMoney(amount), taxable: r.taxable !== false, kind: r.kind === 'sublet' ? 'sublet' : 'fee' }
    })
    .filter((f): f is JobFee => f !== null)
    .slice(0, 10)
  return {
    keywords: strList(o.keywords),
    fit: normalizeFit(o.fit),
    variants,
    fees,
    note: text(o.note).slice(0, 400),
    inspectionKeys: strList(o.inspectionKeys),
  }
}

/** True when the vehicle is inside the fit. A fit with nothing set matches every vehicle. */
export function fitsVehicle(fit: Fit | null, v: Vehicle): boolean {
  if (!fit) return true
  if (fit.makes.length && !fit.makes.some((m) => norm(m) === norm(v.make))) return false
  if (fit.models.length && !fit.models.some((m) => norm(v.model).includes(norm(m)) && norm(m) !== '')) return false
  if (fit.yearFrom && (v.year === null || v.year < fit.yearFrom)) return false
  if (fit.yearTo && (v.year === null || v.year > fit.yearTo)) return false
  return true
}

/** How specific a fit is: a model beats a make beats a year range. Used to pick among variants. */
const specificity = (fit: Fit): number => (fit.models.length ? 4 : 0) + (fit.makes.length ? 2 : 0) + (fit.yearFrom || fit.yearTo ? 1 : 0)

/** The most specific variant that fits this vehicle, or null. */
export function bestVariant(extras: CannedExtras, v: Vehicle): Variant | null {
  const hits = extras.variants.filter((x) => fitsVehicle(x.fit, v))
  if (hits.length === 0) return null
  return hits.slice().sort((a, b) => specificity(b.fit) - specificity(a.fit))[0]
}

export interface JobLike {
  id: string
  name: string
  category?: string | null
  description?: string | null
  labor_hours?: number | string | null
  labor_rate?: number | string | null
  total_price?: number | string | null
  parts?: CannedPartRow[] | null
}

/** Score for a search. 0 means no match. Name matches beat keyword matches beat description matches. */
export function searchScore(job: JobLike, extras: CannedExtras, query: string): number {
  const words = norm(query).split(' ').filter(Boolean)
  if (words.length === 0) return 1
  const name = norm(job.name)
  const kw = norm(extras.keywords.join(' '))
  const rest = norm([job.category, job.description].join(' '))
  let score = 0
  for (const w of words) {
    if (name.includes(w)) score += 5
    else if (kw.includes(w)) score += 3
    else if (rest.includes(w)) score += 1
    else return 0
  }
  return score
}

/** Jobs that fit the vehicle, with a per-vehicle variant when one applies. Order: variants first, then the rest by name. */
export function jobsForVehicle<T extends JobLike>(jobs: T[], extrasById: Record<string, CannedExtras>, v: Vehicle): { job: T; variant: Variant | null }[] {
  if (!v.make && !v.model && v.year === null) return []
  const out: { job: T; variant: Variant | null; rank: number }[] = []
  for (const job of jobs) {
    const ex = extrasById[job.id] || EMPTY_EXTRAS
    const variant = bestVariant(ex, v)
    const fits = ex.fit ? fitsVehicle(ex.fit, v) : false
    if (variant) out.push({ job, variant, rank: 2 })
    else if (fits) out.push({ job, variant: null, rank: 1 })
  }
  return out.sort((a, b) => b.rank - a.rank || a.job.name.localeCompare(b.job.name)).map(({ job, variant }) => ({ job, variant }))
}

export interface BuildOptions {
  vehicle: Vehicle
  shopRate: number
  /** Rate to use instead of the job's own, for example a technician rate. */
  rateOverride?: number | null
  /** Job group name for the added lines. Defaults to the canned job's name. */
  jobName?: string
  /** Use this variant instead of finding one. Pass null to ignore variants. */
  variant?: Variant | null
}

export interface BuiltJob { labors: Line[]; parts: Line[]; variantLabel: string; total: number }

/** The document lines for adding a canned job. Matches what the editor has always added, plus grouping, fees and notes. */
export function buildJobLines(job: JobLike, extras: CannedExtras, opts: BuildOptions): BuiltJob {
  const variant = opts.variant === undefined ? bestVariant(extras, opts.vehicle) : opts.variant
  const name = cleanJobName(opts.jobName ?? job.name)
  const rate = opts.rateOverride && opts.rateOverride > 0 ? opts.rateOverride : Number(job.labor_rate) > 0 ? Number(job.labor_rate) : opts.shopRate
  const hours = variant?.hours ?? (Number(job.labor_hours) > 0 ? Number(job.labor_hours) : 0)
  const withJob = <T extends Line>(l: T): T => {
    const out: Line = { ...l }
    if (name) out.job = name
    return out as T
  }

  const labors: Line[] = []
  if (variant?.laborPrice !== null && variant?.laborPrice !== undefined) {
    labors.push(withJob({ operation: job.name, tech: '', pricing: 'flat', amount: variant.laborPrice }))
  } else if (hours > 0) {
    labors.push(withJob({ operation: job.name, tech: '', hours, rate }))
  }

  const sourceParts = variant?.parts ?? (Array.isArray(job.parts) ? job.parts : [])
  const parts: Line[] = sourceParts.map((p) => {
    const line: Line = { name: p.name, brand: '', qty: Number(p.qty) || 1, unitPrice: Number(p.cost) || 0, taxable: true, status: 'Ordered' }
    if (p.part_number) line.part_number = p.part_number
    return withJob(line)
  })
  for (const f of extras.fees) parts.push(makeFeeLine({ name: f.name, amount: f.amount, taxable: f.taxable, kind: f.kind, job: name }))
  // The customer note rides on the first line only, so it prints once per job.
  const first = labors[0] ?? parts[0]
  if (extras.note && first && first.note === undefined) first.note = extras.note

  let total = 0
  for (const l of labors) total += getLaborFlatAmount(l) ?? Number(l.hours) * Number(l.rate)
  for (const p of parts) total += Number(p.qty) * Number(p.unitPrice)
  return { labors, parts, variantLabel: variant?.label || '', total: roundMoney(total) }
}

/* ───────────────────────── Inspection findings ───────────────────────── */

const STOP = new Set(['the', 'and', 'for', 'with', 'needs', 'need', 'replace', 'replacement', 'service', 'check', 'front', 'rear', 'left', 'right', 'of', 'a', 'an', 'to', 'in', 'on'])
const tokens = (s: string): string[] => norm(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w))

/** Best canned job for the text of an inspection finding, or null when nothing is a clear match. */
export function matchFinding<T extends JobLike>(finding: string, jobs: T[], extrasById: Record<string, CannedExtras>): T | null {
  const f = tokens(finding)
  if (f.length === 0) return null
  let best: { job: T; score: number } | null = null
  for (const job of jobs) {
    const ex = extrasById[job.id] || EMPTY_EXTRAS
    const explicit = ex.inspectionKeys.some((k) => norm(finding).includes(norm(k)) && norm(k) !== '')
    const jt = new Set([...tokens(job.name), ...ex.keywords.flatMap(tokens)])
    const overlap = f.filter((w) => jt.has(w)).length
    const score = explicit ? 10 + overlap : overlap >= 2 || (overlap === 1 && f.length === 1) ? overlap : 0
    if (score > 0 && (!best || score > best.score)) best = { job, score }
  }
  return best ? best.job : null
}

/* ───────────────────────── What the shop charged before ───────────────────────── */

export interface HoursHistory { count: number; averageHours: number; low: number; high: number; averageRate: number | null; sameCar: boolean }

/**
 * Hours the shop has written for similar work. Looks at hourly labor lines in documents already
 * loaded, matched by words in the operation. Prefers the same make and model; falls back to any car.
 */
export function laborHistory(docs: Record<string, unknown>[], operation: string, v: Vehicle, limit = 8): HoursHistory | null {
  const want = tokens(operation)
  if (want.length === 0) return null
  const need = Math.min(2, want.length)
  const same: { hours: number; rate: number }[] = []
  const any: { hours: number; rate: number }[] = []
  for (const d of docs) {
    const labors = Array.isArray(d.labors) ? (d.labors as Record<string, unknown>[]) : []
    const dv = vehicleOf(d)
    for (const l of labors) {
      if (!l || typeof l !== 'object' || getLaborFlatAmount(l) !== null) continue
      const hours = nonNegativeDecimal(l.hours, 0)
      if (hours <= 0) continue
      const have = new Set(tokens(text(l.operation)))
      if (want.filter((w) => have.has(w)).length < need) continue
      const row = { hours, rate: nonNegativeDecimal(l.rate, 0) }
      any.push(row)
      if (norm(dv.make) === norm(v.make) && norm(dv.model) === norm(v.model) && v.make) same.push(row)
    }
  }
  const pool = same.length >= 2 ? same : any
  const rows = pool.slice(0, limit)
  if (rows.length === 0) return null
  const hours = rows.map((r) => r.hours)
  const rated = rows.filter((r) => r.rate > 0)
  return {
    count: rows.length,
    averageHours: roundMoney(hours.reduce((a, b) => a + b, 0) / hours.length),
    low: Math.min(...hours),
    high: Math.max(...hours),
    averageRate: rated.length ? roundMoney(rated.reduce((a, r) => a + r.rate, 0) / rated.length) : null,
    sameCar: pool === same,
  }
}
