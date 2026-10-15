/**
 * Time on a job, and what it says about each technician: hours clocked against hours sold, effective labor rate,
 * gross profit on a job and an estimate of flat-rate or commission pay. It imports nothing, so it runs in the browser,
 * on the server and under `node --test`. Money arrives already worked out by the shop's own document maths; nothing here
 * changes how a total is calculated. Keep it to plain TypeScript (no enums, no parameter properties).
 */

const MIN = 60_000
/** Same rule as the shift clock: a job still running after this long was almost certainly never stopped. */
export const STALE_JOB_MS = 16 * 3_600_000

export interface JobSegment {
  id: number
  staff_id: number | null
  staff_name: string
  entry_id: number | null
  job_id: string
  /** What the job looked like when the time was logged, e.g. "RO 1042, 2017 Toyota Camry". Kept so a deleted job does not leave a blank. */
  job_label: string
  started_at: string
  ended_at: string | null
  note: string | null
}

export function normalizeSegment(raw: Record<string, unknown>): JobSegment {
  return {
    id: Number(raw.id),
    staff_id: raw.staff_id == null || raw.staff_id === '' ? null : Number(raw.staff_id),
    staff_name: String(raw.staff_name ?? ''),
    entry_id: raw.entry_id == null || raw.entry_id === '' ? null : Number(raw.entry_id),
    job_id: String(raw.job_id ?? ''),
    job_label: String(raw.job_label ?? ''),
    started_at: String(raw.started_at ?? ''),
    ended_at: raw.ended_at ? String(raw.ended_at) : null,
    note: raw.note == null ? null : String(raw.note),
  }
}

export const segmentRunning = (s: Pick<JobSegment, 'ended_at'>): boolean => !s.ended_at

export function segmentStale(s: Pick<JobSegment, 'started_at' | 'ended_at'>, nowMs: number): boolean {
  if (s.ended_at) return false
  const start = Date.parse(s.started_at)
  return !isNaN(start) && nowMs - start > STALE_JOB_MS
}

/** Minutes on the job. A running one counts up to now. A forgotten one counts as nothing until it is fixed. */
export function segmentMinutes(s: Pick<JobSegment, 'started_at' | 'ended_at'>, nowMs: number): number {
  if (segmentStale(s, nowMs)) return 0
  const start = Date.parse(s.started_at)
  const end = s.ended_at ? Date.parse(s.ended_at) : nowMs
  if (isNaN(start) || isNaN(end)) return 0
  return Math.max(0, (end - start) / MIN)
}

export const normName = (s: unknown): string => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

/** The job a person is on right now, if any. */
export function runningSegment(list: JobSegment[], who: { id: number; name: string }): JobSegment | null {
  const name = normName(who.name)
  const mine = list.filter(s => !s.ended_at && (s.staff_id != null ? s.staff_id === who.id : normName(s.staff_name) === name))
  mine.sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
  return mine[0] || null
}

export interface JobMinutes { jobId: string; label: string; minutes: number; byStaff: Map<string, number> }

/** Minutes per job, and per person on each job. Person keys are the lower-cased name. */
export function minutesByJob(list: JobSegment[], nowMs: number, names: Map<number, string> = new Map()): Map<string, JobMinutes> {
  const out = new Map<string, JobMinutes>()
  for (const s of list) {
    if (!s.job_id) continue
    const m = segmentMinutes(s, nowMs)
    const row = out.get(s.job_id) || { jobId: s.job_id, label: s.job_label, minutes: 0, byStaff: new Map<string, number>() }
    if (!row.label && s.job_label) row.label = s.job_label
    const who = normName(s.staff_id != null && names.get(s.staff_id) ? names.get(s.staff_id) : s.staff_name)
    row.minutes += m
    row.byStaff.set(who, (row.byStaff.get(who) || 0) + m)
    out.set(s.job_id, row)
  }
  return out
}

/** Minutes a person spent on jobs, counting only segments that started on the days given. */
export function jobMinutesFor(list: JobSegment[], who: { id: number; name: string }, dayKeys: Set<string>, dayOf: (iso: string) => string, nowMs: number): number {
  const name = normName(who.name)
  let sum = 0
  for (const s of list) {
    const mine = s.staff_id != null ? s.staff_id === who.id : normName(s.staff_name) === name
    if (mine && dayKeys.has(dayOf(s.started_at))) sum += segmentMinutes(s, nowMs)
  }
  return sum
}

/* ---------- what was sold on a job ---------- */

export interface LaborLine { tech: string; hours: number; amount: number; /** Priced as a flat amount rather than by the hour. */ flat: boolean }

export interface BilledDoc {
  jobId: string
  type: string
  status: string
  /** The document's own date, a day key. */
  date: string
  laborRevenue: number
  partsRevenue: number
  /** What the shop paid for the parts, counting only lines that have a cost written down. */
  partsCost: number
  /** True when every part line has a cost (or there are no parts), so the cost above is the whole cost. */
  partsCostKnown: boolean
  labor: LaborLine[]
}

const isLive = (status: string) => status !== 'Draft' && status !== 'Void'

/**
 * The paperwork that says what a job brought in: its invoice. If there is no invoice, a receipt. If neither, the estimate,
 * and the result says it is only an estimate so the screen can say so.
 */
export function billedDocFor(docs: BilledDoc[]): { doc: BilledDoc; basis: 'invoice' | 'receipt' | 'estimate' } | null {
  const live = docs.filter(d => isLive(d.status))
  for (const [type, basis] of [['Invoice', 'invoice'], ['Receipt', 'receipt'], ['Estimate', 'estimate']] as const) {
    const hit = live.filter(d => d.type === type).sort((a, b) => b.date.localeCompare(a.date))
    if (hit.length) {
      // Several invoices on one job (a supplement, a second visit) are added together.
      if (hit.length === 1 || type === 'Estimate') return { doc: hit[0], basis }
      const sum: BilledDoc = {
        jobId: hit[0].jobId, type, status: hit[0].status, date: hit[0].date,
        laborRevenue: hit.reduce((s, d) => s + d.laborRevenue, 0), partsRevenue: hit.reduce((s, d) => s + d.partsRevenue, 0),
        partsCost: hit.reduce((s, d) => s + d.partsCost, 0), partsCostKnown: hit.every(d => d.partsCostKnown), labor: hit.flatMap(d => d.labor),
      }
      return { doc: sum, basis }
    }
  }
  return null
}

export const soldHours = (labor: LaborLine[]): number => round2(labor.reduce((s, l) => s + (l.hours > 0 ? l.hours : 0), 0))
export const flatWithoutHours = (labor: LaborLine[]): number => labor.filter(l => l.flat && !(l.hours > 0)).length

/* ---------- one job ---------- */

export interface ProdJob { id: string; label: string; tech: string; status: string; customer: string }

export interface TechShare { tech: string; soldHours: number; laborRevenue: number; workedMinutes: number }

export interface JobResult {
  jobId: string
  label: string
  customer: string
  status: string
  basis: 'invoice' | 'receipt' | 'estimate' | 'none'
  billedDate: string
  soldHours: number
  /** Flat-priced labor lines that carry no hours, so they could not be counted as sold hours. */
  flatNoHours: number
  workedMinutes: number
  tracked: boolean
  efficiency: number | null
  laborRevenue: number
  partsRevenue: number
  partsCost: number | null
  laborCost: number | null
  grossProfit: number | null
  /** What is missing for gross profit, in plain words. Empty when it could be worked out. */
  missing: string[]
  shares: TechShare[]
}

export const round2 = (n: number): number => Math.round(n * 100) / 100

/**
 * Efficiency is hours sold divided by hours worked. 100% means the work took as long as it was sold for.
 * Null when no time was logged, so a job nobody clocked into never shows a made-up number.
 */
export const efficiencyOf = (sold: number, workedMin: number): number | null => (workedMin > 0 && sold >= 0 ? round2((sold * 60 * 100) / workedMin) : null)

export function jobResult(
  job: ProdJob,
  billed: { doc: BilledDoc; basis: 'invoice' | 'receipt' | 'estimate' } | null,
  minutes: JobMinutes | undefined,
  costRates: Map<string, number>,
  /** Lower-cased name to the name as the team list spells it. */
  displayName: (key: string) => string = k => k,
): JobResult {
  const worked = minutes ? minutes.minutes : 0
  const doc = billed ? billed.doc : null
  const labor = doc ? doc.labor : []
  const techs = minutes ? [...minutes.byStaff.entries()].filter(([, m]) => m > 0) : []
  const totalTech = techs.reduce((s, [, m]) => s + m, 0)

  // Who gets the sold hours: a line that names a technician goes to that technician; the rest is split by time worked,
  // or goes to the technician the car was assigned to when nobody clocked in.
  const shares = new Map<string, TechShare>()
  const share = (tech: string) => {
    const k = normName(tech)
    let s = shares.get(k)
    if (!s) { const shown = displayName(k); s = { tech: (shown && shown !== k ? shown : '') || tech.trim() || 'Unassigned', soldHours: 0, laborRevenue: 0, workedMinutes: 0 }; shares.set(k, s) }
    return s
  }
  for (const [who, m] of techs) share(who).workedMinutes += m
  for (const line of labor) {
    const named = normName(line.tech)
    if (named) { const s = share(line.tech); s.soldHours += Math.max(0, line.hours); s.laborRevenue += line.amount; continue }
    if (totalTech > 0) {
      for (const [who, m] of techs) { const s = share(who); s.soldHours += Math.max(0, line.hours) * (m / totalTech); s.laborRevenue += line.amount * (m / totalTech) }
    } else {
      const s = share(job.tech); s.soldHours += Math.max(0, line.hours); s.laborRevenue += line.amount
    }
  }
  const list = [...shares.values()].map(s => ({ ...s, soldHours: round2(s.soldHours), laborRevenue: round2(s.laborRevenue) }))

  const missing: string[] = []
  let laborCost: number | null = null
  if (worked > 0) {
    let cost = 0
    let all = true
    for (const [who, m] of techs) {
      const rate = costRates.get(who)
      if (rate === undefined) { all = false; continue }
      cost += (m / 60) * rate
    }
    if (all) laborCost = round2(cost); else missing.push('a pay rate for each technician')
  } else {
    missing.push('time on the job')
  }
  if (!doc) missing.unshift('an invoice or estimate')
  else if (!doc.partsCostKnown) missing.push('the cost of every part')
  const profitReady = !!doc && doc.partsCostKnown && laborCost !== null
  const partsCost = doc ? (doc.partsCostKnown ? round2(doc.partsCost) : null) : null
  const sold = doc ? soldHours(labor) : 0
  return {
    jobId: job.id, label: job.label, customer: job.customer, status: job.status,
    basis: billed ? billed.basis : 'none', billedDate: doc ? doc.date : '',
    soldHours: sold, flatNoHours: doc ? flatWithoutHours(labor) : 0,
    workedMinutes: worked, tracked: worked > 0,
    efficiency: efficiencyOf(sold, worked),
    laborRevenue: doc ? round2(doc.laborRevenue) : 0, partsRevenue: doc ? round2(doc.partsRevenue) : 0,
    partsCost, laborCost,
    grossProfit: profitReady && doc ? round2(doc.laborRevenue + doc.partsRevenue - doc.partsCost - (laborCost as number)) : null,
    missing: profitReady ? [] : missing,
    shares: list,
  }
}

/* ---------- one technician over a period ---------- */

export interface TechPeriod {
  tech: string
  clockedMinutes: number
  /** Minutes on jobs that started in the period. */
  jobMinutes: number
  /** jobMinutes over clockedMinutes, 0 to 100, or null when nothing was clocked. */
  utilization: number | null
  jobsBilled: number
  soldHours: number
  /** Minutes worked on the jobs sold in the period, counting only jobs somebody clocked into. */
  trackedMinutes: number
  /** Hours sold on the jobs that have time, for the efficiency figure. */
  trackedSoldHours: number
  efficiency: number | null
  laborRevenue: number
  /** Labor money earned on jobs with time, divided by the hours worked on them. Null with no tracked time. */
  effectiveRate: number | null
  untrackedJobs: number
  untrackedSoldHours: number
}

export function techPeriod(tech: string, clockedMinutes: number, jobMinutes: number, results: JobResult[]): TechPeriod {
  const key = normName(tech)
  let jobsBilled = 0
  let sold = 0
  let trackedMin = 0
  let trackedSold = 0
  let revenue = 0
  let trackedRevenue = 0
  let untracked = 0
  let untrackedSold = 0
  for (const r of results) {
    const mine = r.shares.find(s => normName(s.tech) === key)
    if (!mine || (mine.soldHours <= 0 && mine.laborRevenue <= 0 && mine.workedMinutes <= 0)) continue
    jobsBilled += 1
    sold += mine.soldHours
    revenue += mine.laborRevenue
    if (mine.workedMinutes > 0) {
      trackedMin += mine.workedMinutes
      trackedSold += mine.soldHours
      trackedRevenue += mine.laborRevenue
    } else {
      untracked += 1
      untrackedSold += mine.soldHours
    }
  }
  return {
    tech, clockedMinutes, jobMinutes,
    utilization: clockedMinutes > 0 ? Math.min(100, Math.round((jobMinutes * 100) / clockedMinutes)) : null,
    jobsBilled, soldHours: round2(sold), trackedMinutes: Math.round(trackedMin), trackedSoldHours: round2(trackedSold),
    efficiency: efficiencyOf(trackedSold, trackedMin),
    laborRevenue: round2(revenue),
    effectiveRate: trackedMin > 0 ? round2(trackedRevenue / (trackedMin / 60)) : null,
    untrackedJobs: untracked, untrackedSoldHours: round2(untrackedSold),
  }
}

/* ---------- pay estimates ---------- */

export type PayMethod = 'hourly' | 'flat' | 'commission'

export interface PayRate { method: PayMethod; hourly: number | null; flat: number | null; commissionPct: number | null }

export function normalizePay(raw: Record<string, unknown>): PayRate {
  const m = String(raw.pay_method ?? raw.method ?? 'hourly')
  const n = (v: unknown, max: number): number | null => { const x = Number(v); return v !== null && v !== undefined && v !== '' && Number.isFinite(x) && x >= 0 && x <= max ? round2(x) : null }
  return {
    method: m === 'flat' || m === 'commission' ? m : 'hourly',
    hourly: n(raw.hourly_rate ?? raw.hourly, 1000), flat: n(raw.flat_rate ?? raw.flat, 1000), commissionPct: n(raw.commission_pct ?? raw.commissionPct, 100),
  }
}

export interface PayEstimate { method: PayMethod; amount: number | null; basis: string }

/**
 * A rough pay figure for a period, for the owner's own planning. It is not a payroll calculation and says so on screen.
 * Hourly pays regular time, time and a half for overtime and double for double time.
 */
export function estimatePay(rate: PayRate | undefined, w: { regularMin: number; overtimeMin: number; doubleMin: number; soldHours: number; laborRevenue: number }): PayEstimate {
  if (!rate) return { method: 'hourly', amount: null, basis: 'No pay rate saved' }
  if (rate.method === 'flat') {
    if (rate.flat === null) return { method: 'flat', amount: null, basis: 'No flat rate saved' }
    return { method: 'flat', amount: round2(w.soldHours * rate.flat), basis: `${w.soldHours} hours sold at ${rate.flat.toFixed(2)} an hour` }
  }
  if (rate.method === 'commission') {
    if (rate.commissionPct === null) return { method: 'commission', amount: null, basis: 'No commission rate saved' }
    return { method: 'commission', amount: round2((w.laborRevenue * rate.commissionPct) / 100), basis: `${rate.commissionPct}% of labor sold` }
  }
  if (rate.hourly === null) return { method: 'hourly', amount: null, basis: 'No hourly rate saved' }
  const pay = (w.regularMin / 60) * rate.hourly + (w.overtimeMin / 60) * rate.hourly * 1.5 + (w.doubleMin / 60) * rate.hourly * 2
  return { method: 'hourly', amount: round2(pay), basis: `${round2((w.regularMin + w.overtimeMin + w.doubleMin) / 60)} hours clocked at ${rate.hourly.toFixed(2)} an hour` }
}
