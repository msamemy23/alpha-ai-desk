/**
 * Turns a saved estimate or invoice row into what the productivity numbers need (labor lines with hours, labor and parts
 * money, parts cost) using the shop's own document maths, and assembles one pay period's per-technician and per-job results.
 * It reads money; it never changes how a total is calculated. Imports only the document maths and the job-time helpers.
 */
import { calculateDocumentTotals, getLaborFlatAmount, laborLineTotal, nonNegativeMoney, partLineTotal, quantityFromUnknown } from './document-money.ts'
import { billedDocFor, jobResult, minutesByJob, round2, techPeriod } from './jobtime.ts'
import type { BilledDoc, JobResult, JobSegment, LaborLine, ProdJob, TechPeriod } from './jobtime.ts'

type Row = Record<string, unknown>
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim()

/** A day key from a date or timestamp text, or ''. */
const dayOf = (v: unknown): string => {
  const s = str(v)
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : ''
}

/**
 * One document as the productivity maths sees it. Money comes from the shop's own calculation. A part line counts as having a
 * cost only if a cost was written down for it; if any part line has none, the job's parts cost is reported as unknown rather
 * than as zero, so a job never looks more profitable than it was.
 */
export function billedFromRow(raw: Row): BilledDoc | null {
  const jobId = str(raw.job_id)
  if (!jobId) return null
  const t = calculateDocumentTotals(raw)
  const lines = (Array.isArray(raw.labors) ? raw.labors : []).filter((l): l is Row => !!l && typeof l === 'object')
  const parts = (Array.isArray(raw.parts) ? raw.parts : []).filter((l): l is Row => !!l && typeof l === 'object')
  const labor: LaborLine[] = lines.map(l => ({
    tech: str(l.tech),
    hours: quantityFromUnknown(l.hours, 0),
    amount: laborLineTotal(l),
    flat: getLaborFlatAmount(l) !== null,
  }))
  let partsCost = 0
  let known = true
  for (const p of parts) {
    const qty = quantityFromUnknown(p.qty, 1)
    if (qty <= 0 || partLineTotal(p) <= 0) continue
    const cost = p.cost
    if (cost === undefined || cost === null || cost === '') { known = false; continue }
    partsCost += nonNegativeMoney(cost) * qty
  }
  return {
    jobId, type: str(raw.type), status: str(raw.status), date: dayOf(raw.doc_date) || dayOf(raw.created_at),
    laborRevenue: t.laborTotal, partsRevenue: t.partsTotal, partsCost: round2(partsCost), partsCostKnown: known, labor,
  }
}

export interface ProdJobRow { id: string; ro: string; status: string; tech: string; customer: string; car: string }

export interface ProductivityInput {
  jobs: ProdJobRow[]
  docs: BilledDoc[]
  segments: JobSegment[]
  /** Hourly cost by lower-cased technician name. Empty when the viewer may not see pay. */
  costRates: Map<string, number>
  /** Lower-cased name to name as the team list spells it. */
  names: Map<string, string>
  /** The pay period, as day keys (inclusive). A job counts when its invoice or receipt is dated inside it. */
  from: string
  to: string
  nowMs: number
}

export interface ProductivityResult {
  jobs: JobResult[]
  /** Jobs that were sold in the period but nobody clocked onto. */
  untracked: number
  totals: { soldHours: number; trackedSoldHours: number; trackedMinutes: number; efficiency: number | null; laborRevenue: number; effectiveRate: number | null; grossProfit: number | null; profitJobs: number }
}

export function jobLabel(j: Pick<ProdJobRow, 'ro' | 'car'>): string {
  return [j.ro ? `RO ${j.ro.replace(/^RO[-\s]*/i, '')}` : '', j.car].filter(Boolean).join(', ')
}

/** Results for every job billed in the period. A job is billed when its best document (invoice, else receipt) is dated inside it. */
export function productivityFor(input: ProductivityInput): ProductivityResult {
  const mins = minutesByJob(input.segments, input.nowMs)
  const byJob = new Map<string, BilledDoc[]>()
  for (const d of input.docs) { const list = byJob.get(d.jobId) || []; list.push(d); byJob.set(d.jobId, list) }
  const display = (k: string): string => input.names.get(k) || k
  const results: JobResult[] = []
  for (const j of input.jobs) {
    const billed = billedDocFor(byJob.get(j.id) || [])
    if (!billed || billed.basis === 'estimate') continue
    const date = billed.doc.date
    if (!date || date < input.from || date > input.to) continue
    const prod: ProdJob = { id: j.id, label: jobLabel(j), tech: j.tech, status: j.status, customer: j.customer }
    results.push(jobResult(prod, billed, mins.get(j.id), input.costRates, display))
  }
  const tracked = results.filter(r => r.tracked)
  const sold = tracked.reduce((s, r) => s + r.soldHours, 0)
  const minutes = tracked.reduce((s, r) => s + r.workedMinutes, 0)
  const revenue = tracked.reduce((s, r) => s + r.laborRevenue, 0)
  const withProfit = results.filter(r => r.grossProfit !== null)
  return {
    jobs: results,
    untracked: results.length - tracked.length,
    totals: {
      soldHours: round2(results.reduce((s, r) => s + r.soldHours, 0)),
      trackedSoldHours: round2(sold),
      trackedMinutes: Math.round(minutes),
      efficiency: minutes > 0 ? round2((sold * 60 * 100) / minutes) : null,
      laborRevenue: round2(results.reduce((s, r) => s + r.laborRevenue, 0)),
      effectiveRate: minutes > 0 ? round2(revenue / (minutes / 60)) : null,
      grossProfit: withProfit.length ? round2(withProfit.reduce((s, r) => s + (r.grossProfit as number), 0)) : null,
      profitJobs: withProfit.length,
    },
  }
}

export interface TechRow extends TechPeriod {
  id: number
}

/** One row per technician: clocked hours from the time clock, hours on jobs, and what they sold. */
export function techRows(
  techs: { id: number; name: string }[],
  clockedMin: Map<number, number>,
  jobMin: Map<number, number>,
  results: JobResult[],
): TechRow[] {
  return techs.map(t => ({ id: t.id, ...techPeriod(t.name, clockedMin.get(t.id) || 0, jobMin.get(t.id) || 0, results) }))
    .filter(r => r.clockedMinutes > 0 || r.jobsBilled > 0 || r.jobMinutes > 0)
    .sort((a, b) => b.soldHours - a.soldHours || a.tech.localeCompare(b.tech))
}

