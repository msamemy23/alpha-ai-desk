/**
 * Report maths for the Reports screen: periods, totals, charts, what is still owed, payment methods, technicians and calls.
 * It imports nothing, so the same code runs in the browser and under `node --test`.
 * Keep it to plain TypeScript (no enums, no parameter properties) so node can run it directly.
 *
 * Dates are local calendar days written "2026-10-14". Money is dollars.
 */

/* ---------- days and periods ---------- */

export type PeriodKey = '7d' | '30d' | '90d' | 'month' | 'lastmonth' | 'year'
export interface Range { from: string; to: string }

export const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: 'month', label: 'This month' },
  { key: 'lastmonth', label: 'Last month' },
  { key: 'year', label: 'This year' },
]

const pad = (n: number) => String(n).padStart(2, '0')
export const keyOf = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
// Noon keeps a day on the same date across daylight saving changes.
const parse = (k: string): Date => new Date(`${k.slice(0, 10)}T12:00:00`)
export const addDays = (k: string, n: number): string => { const d = parse(k); d.setDate(d.getDate() + n); return keyOf(d) }
/** Whole days from a to b (b - a). */
export const diffDays = (a: string, b: string): number => Math.round((parse(b).getTime() - parse(a).getTime()) / 86_400_000)
/** How many calendar days a range covers, counting both ends. */
export const spanDays = (r: Range): number => diffDays(r.from, r.to) + 1
export const inRange = (k: string, r: Range): boolean => !!k && k.slice(0, 10) >= r.from && k.slice(0, 10) <= r.to

const monthStart = (k: string) => `${k.slice(0, 7)}-01`
const lastOfMonth = (y: number, m0: number) => keyOf(new Date(y, m0 + 1, 0, 12))
const clampDay = (y: number, m0: number, day: number) => keyOf(new Date(y, m0, Math.min(day, new Date(y, m0 + 1, 0).getDate()), 12))

export interface PeriodInfo { range: Range; previous: Range }

/** The days a period covers, and the days it is compared with. A month is compared with the same days of the month before. */
export function periodFor(key: PeriodKey, todayKey: string): PeriodInfo {
  const t = parse(todayKey)
  if (key === 'month') {
    const from = monthStart(todayKey)
    const pm = new Date(t.getFullYear(), t.getMonth() - 1, 1, 12)
    return { range: { from, to: todayKey }, previous: { from: keyOf(pm), to: clampDay(pm.getFullYear(), pm.getMonth(), t.getDate()) } }
  }
  if (key === 'lastmonth') {
    const lm = new Date(t.getFullYear(), t.getMonth() - 1, 1, 12)
    const bm = new Date(t.getFullYear(), t.getMonth() - 2, 1, 12)
    return { range: { from: keyOf(lm), to: lastOfMonth(lm.getFullYear(), lm.getMonth()) }, previous: { from: keyOf(bm), to: lastOfMonth(bm.getFullYear(), bm.getMonth()) } }
  }
  if (key === 'year') {
    const y = t.getFullYear()
    return { range: { from: `${y}-01-01`, to: todayKey }, previous: { from: `${y - 1}-01-01`, to: clampDay(y - 1, t.getMonth(), t.getDate()) } }
  }
  const n = key === '7d' ? 7 : key === '30d' ? 30 : 90
  const from = addDays(todayKey, -(n - 1))
  return { range: { from, to: todayKey }, previous: { from: addDays(from, -n), to: addDays(from, -1) } }
}

/** What a period is compared with, as it reads after "from": "Up 12% from the 7 days before". */
export function vsLabel(key: PeriodKey): string {
  switch (key) {
    case '7d': return 'the 7 days before'
    case '30d': return 'the 30 days before'
    case '90d': return 'the 90 days before'
    case 'month': return 'the same days last month'
    case 'lastmonth': return 'the month before'
    default: return 'the same days last year'
  }
}

const fmtDay = (k: string, withYear: boolean) => parse(k).toLocaleDateString('en-US', { month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}) })
/** "Oct 1 to Oct 14, 2026". */
export function rangeLabel(r: Range): string {
  const sameYear = r.from.slice(0, 4) === r.to.slice(0, 4)
  if (r.from === r.to) return fmtDay(r.from, true)
  return `${fmtDay(r.from, !sameYear)} to ${fmtDay(r.to, true)}`
}

/* ---------- what the screen is given ---------- */

export interface ReportDoc {
  id: string
  /** "Invoice" or "Receipt". */
  type: string
  /** The number printed on the paperwork, when it has one. */
  number?: string
  status: string
  /** The date on the paperwork, not the day it was typed in or imported. */
  date: string
  customerId: string | null
  customer: string
  total: number
  labor: number
  parts: number
  /** Shop supplies, sublet and core charges. */
  fees: number
  tax: number
  paid: number
  balance: number
  method: string
  /** Labor lines: what was done and what it cost. */
  ops: { name: string; amount: number }[]
  /** Part lines: what was sold, and what the shop paid for it when that was written down (0 when it was not). */
  items: { name: string; qty: number; amount: number; cost?: number }[]
  /** Labor lines that name a technician. */
  hours: { tech: string; hours: number; amount: number }[]
}

export interface ReportPayment { id: string; docId: string | null; amount: number; method: string; date: string; customer: string }
export interface ReportJob { id: string; status: string; tech: string; date: string; customer: string }
export interface ReportCall { id: string; direction: string; seconds: number; start: string }

export const money = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`
export const money2 = (n: number): string => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const round2 = (n: number) => Math.round(n * 100) / 100
const num = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }

/* ---------- payment methods ---------- */

export const methodKey = (m: unknown): string => String(m ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

const METHOD_LABELS: Record<string, string> = {
  '': 'Method not recorded', unspecified: 'Method not recorded', unknown: 'Method not recorded', none: 'Method not recorded', n_a: 'Method not recorded',
  historical_import: 'Imported from past records', imported: 'Imported from past records', import: 'Imported from past records',
  cash: 'Cash', check: 'Check', cheque: 'Check',
  card: 'Card', credit_card: 'Card', debit_card: 'Card', credit: 'Card', debit: 'Card', cc: 'Card', visa: 'Card', mastercard: 'Card', amex: 'Card',
  zelle: 'Zelle', venmo: 'Venmo', paypal: 'PayPal', cash_app: 'Cash App', cashapp: 'Cash App',
  ach: 'Bank transfer', bank_transfer: 'Bank transfer', wire: 'Bank transfer', eft: 'Bank transfer', bank: 'Bank transfer',
  other: 'Other',
}

/** A payment method in plain words: "historical_import" becomes "Imported from past records". Case variants land on the same label. */
export function methodLabel(m: unknown): string {
  const k = methodKey(m)
  if (k in METHOD_LABELS) return METHOD_LABELS[k]
  const words = k.split('_').filter(Boolean).join(' ')
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/* ---------- what counts ---------- */

const NOT_SALES = new Set(['draft', 'void', 'voided', 'cancelled', 'canceled'])
/** A finished piece of paperwork that bills the customer. Drafts and voids are not sales. */
export const isSale = (d: Pick<ReportDoc, 'type' | 'status'>): boolean => (d.type === 'Invoice' || d.type === 'Receipt') && !NOT_SALES.has(String(d.status || '').trim().toLowerCase())

/** An invoice marked Paid owes nothing, whatever the payment ledger says. Anything else owes what is left. */
export const balanceFor = (status: string, balanceDue: number): number => (String(status || '').trim().toLowerCase() === 'paid' ? 0 : Math.max(0, balanceDue))

/**
 * Invoices marked Paid with no money recorded anywhere. They are not counted as collected (nothing says how much or how),
 * so the screen points them out instead of quietly leaving them out.
 */
export function unrecordedPaid(docs: ReportDoc[], payments: ReportPayment[]): { count: number; amount: number; docs: ReportDoc[] } {
  const covered = new Set(payments.map(p => p.docId).filter((x): x is string => !!x))
  const list = docs.filter(d => isSale(d) && String(d.status).trim().toLowerCase() === 'paid' && d.paid <= 0 && d.total > 0 && !covered.has(d.id))
  return { count: list.length, amount: round2(list.reduce((s, d) => s + d.total, 0)), docs: list }
}

/**
 * Money received, by the day it counts for. Payments brought in from old records carry the day they were imported,
 * so those count on the date of the invoice they paid.
 */
export function collectedOn(p: ReportPayment, docs: Map<string, ReportDoc>): string {
  if (methodKey(p.method) === 'historical_import' && p.docId) {
    const d = docs.get(p.docId)
    if (d?.date) return d.date
  }
  return p.date
}

/** Invoices that say money was paid but have no payment record behind them still count, on the invoice date. */
export function withFallbackPayments(docs: ReportDoc[], payments: ReportPayment[]): ReportPayment[] {
  const covered = new Set(payments.map(p => p.docId).filter((x): x is string => !!x))
  const extra = docs.filter(d => isSale(d) && d.paid > 0 && !covered.has(d.id))
    .map(d => ({ id: `doc-${d.id}`, docId: d.id, amount: d.paid, method: d.method || 'unspecified', date: d.date, customer: d.customer }))
  return [...payments, ...extra]
}

/* ---------- totals ---------- */

export interface Summary { invoiced: number; invoices: number; average: number; collected: number; payments: number; labor: number; parts: number; fees: number; tax: number }

export function summarize(docs: ReportDoc[], payments: ReportPayment[], range: Range): Summary {
  const byId = new Map(docs.map(d => [d.id, d]))
  const sales = docs.filter(d => isSale(d) && inRange(d.date, range))
  const got = payments.filter(p => inRange(collectedOn(p, byId), range))
  const invoiced = round2(sales.reduce((s, d) => s + d.total, 0))
  return {
    invoiced, invoices: sales.length, average: sales.length ? round2(invoiced / sales.length) : 0,
    collected: round2(got.reduce((s, p) => s + p.amount, 0)), payments: got.length,
    labor: round2(sales.reduce((s, d) => s + d.labor, 0)), parts: round2(sales.reduce((s, d) => s + d.parts, 0)),
    fees: round2(sales.reduce((s, d) => s + d.fees, 0)), tax: round2(sales.reduce((s, d) => s + d.tax, 0)),
  }
}

export interface Change { kind: 'up' | 'down' | 'same' | 'none'; pct: number }
/** How this period compares with the one before. No comparison when the earlier period had nothing. */
export function change(cur: number, prev: number): Change {
  if (!(prev > 0)) return { kind: 'none', pct: 0 }
  const pct = Math.round(((cur - prev) / prev) * 100)
  if (pct === 0) return { kind: 'same', pct: 0 }
  return { kind: pct > 0 ? 'up' : 'down', pct: Math.abs(pct) }
}

/* ---------- the chart ---------- */

export type Grain = 'day' | 'week' | 'month'
export interface Bucket { key: string; label: string; title: string; value: number }

export function grainFor(r: Range): Grain {
  const n = spanDays(r)
  return n <= 35 ? 'day' : n <= 140 ? 'week' : 'month'
}

export const weekStart = (k: string): string => { const dow = (parse(k).getDay() + 6) % 7; return addDays(k, -dow) }

/** Money per day, week (Monday start) or month across the range, with empty stretches shown as zero. */
export function series(range: Range, entries: { date: string; amount: number }[]): { grain: Grain; buckets: Bucket[] } {
  const grain = grainFor(range)
  const keyFor = (d: string) => (grain === 'day' ? d : grain === 'week' ? weekStart(d) : monthStart(d))
  const order: string[] = []
  const sums = new Map<string, number>()
  if (grain === 'month') {
    const a = parse(range.from), b = parse(range.to)
    for (let y = a.getFullYear(), m = a.getMonth(); y < b.getFullYear() || (y === b.getFullYear() && m <= b.getMonth()); m++) {
      if (m > 11) { m = 0; y++ }
      const k = keyOf(new Date(y, m, 1, 12)); order.push(k); sums.set(k, 0)
    }
  } else {
    const step = grain === 'day' ? 1 : 7
    for (let k = keyFor(range.from); k <= range.to; k = addDays(k, step)) { order.push(k); sums.set(k, 0) }
  }
  for (const e of entries) {
    if (!inRange(e.date, range)) continue
    const k = keyFor(e.date.slice(0, 10))
    if (sums.has(k)) sums.set(k, (sums.get(k) || 0) + e.amount)
  }
  const multiYear = range.from.slice(0, 4) !== range.to.slice(0, 4)
  const buckets = order.map(k => {
    const d = parse(k)
    const label = grain === 'month'
      ? d.toLocaleDateString('en-US', multiYear ? { month: 'short', year: '2-digit' } : { month: 'short' })
      : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    const title = grain === 'day' ? d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
      : grain === 'week' ? `Week of ${d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}`
        : d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    return { key: k, label, title, value: round2(sums.get(k) || 0) }
  })
  return { grain, buckets }
}

/** The next "nice" number at or above a value: 120 becomes 150, 830 becomes 1,000. */
export function niceMax(n: number): number {
  if (!(n > 0)) return 1
  const exp = Math.pow(10, Math.floor(Math.log10(n)))
  for (const m of [1, 1.5, 2, 3, 5, 7.5, 10]) if (n <= m * exp) return m * exp
  return 10 * exp
}

/** For counts of whole things: the next tidy even number, so the half-way line is a whole number too (6 gives 3, 60 gives 30). */
export function niceEven(n: number): number {
  const top = Math.max(2, Math.ceil(n))
  const exp = Math.pow(10, Math.floor(Math.log10(top)))
  for (const e of [exp, exp * 10]) {
    for (const m of [1, 1.2, 1.6, 2, 2.4, 3, 4, 5, 6, 8, 10]) {
      const v = m * e
      if (v >= top && Number.isInteger(v) && v % 2 === 0) return v
    }
  }
  return top % 2 ? top + 1 : top
}

/* ---------- what is still owed ---------- */

export interface Owed { doc: ReportDoc; days: number }
export interface AgingBucket { key: '0-30' | '31-60' | '61-90' | '90+'; label: string; count: number; amount: number }

const AGES: { key: AgingBucket['key']; label: string; max: number }[] = [
  { key: '0-30', label: '0 to 30 days', max: 30 }, { key: '31-60', label: '31 to 60 days', max: 60 }, { key: '61-90', label: '61 to 90 days', max: 90 }, { key: '90+', label: 'Over 90 days', max: Infinity },
]

/** Open balances by how long ago the invoice was written, oldest first. */
export function aging(docs: ReportDoc[], todayKey: string): { total: number; buckets: AgingBucket[]; open: Owed[] } {
  const open: Owed[] = docs.filter(d => isSale(d) && d.balance > 0.005).map(d => ({ doc: d, days: Math.max(0, diffDays(d.date, todayKey)) }))
  open.sort((a, b) => b.days - a.days || b.doc.balance - a.doc.balance)
  const buckets: AgingBucket[] = AGES.map(a => ({ key: a.key, label: a.label, count: 0, amount: 0 }))
  for (const o of open) {
    const i = AGES.findIndex(a => o.days <= a.max)
    buckets[i].count += 1; buckets[i].amount = round2(buckets[i].amount + o.doc.balance)
  }
  return { total: round2(open.reduce((s, o) => s + o.doc.balance, 0)), buckets, open }
}

/* ---------- breakdowns ---------- */

export interface Tally { label: string; amount: number; count: number }

export function byMethod(payments: ReportPayment[], docs: Map<string, ReportDoc>, range: Range): Tally[] {
  const m = new Map<string, Tally>()
  for (const p of payments) {
    if (!inRange(collectedOn(p, docs), range)) continue
    const label = methodLabel(p.method)
    const t = m.get(label) || { label, amount: 0, count: 0 }
    t.amount = round2(t.amount + p.amount); t.count += 1; m.set(label, t)
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount)
}

const textKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/[\s.,;:!-]+$/g, '')
const cap = (s: string) => { const t = s.trim().replace(/\s+/g, ' '); return t.length > 60 ? `${t.slice(0, 57)}…` : t }
/** Shown as written, with a first capital letter only when the whole line was typed in lower case. */
const display = (s: string) => { const t = cap(s); return t === t.toLowerCase() ? t.charAt(0).toUpperCase() + t.slice(1) : t }

/** The repairs billed most, from labor lines. Lines that differ only in case or spacing count together. */
export function topRepairs(docs: ReportDoc[], range: Range, limit = 8): Tally[] {
  const m = new Map<string, Tally>()
  for (const d of docs) {
    if (!isSale(d) || !inRange(d.date, range)) continue
    const seen = new Set<string>()
    for (const o of d.ops) {
      const k = textKey(o.name)
      if (!k) continue
      const t = m.get(k) || { label: display(o.name), amount: 0, count: 0 }
      t.amount = round2(t.amount + o.amount)
      if (!seen.has(k)) { t.count += 1; seen.add(k) }
      m.set(k, t)
    }
  }
  return [...m.values()].sort((a, b) => b.count - a.count || b.amount - a.amount).slice(0, limit)
}

/** The parts sold most, by quantity. */
export function topParts(docs: ReportDoc[], range: Range, limit = 8): Tally[] {
  const m = new Map<string, Tally>()
  for (const d of docs) {
    if (!isSale(d) || !inRange(d.date, range)) continue
    for (const it of d.items) {
      const k = textKey(it.name)
      if (!k) continue
      const t = m.get(k) || { label: display(it.name), amount: 0, count: 0 }
      t.amount = round2(t.amount + it.amount); t.count += Math.max(1, Math.round(it.qty)); m.set(k, t)
    }
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount || b.count - a.count).slice(0, limit)
}

export interface PartsMargin { sold: number; cost: number; profit: number; pct: number | null; lines: number; costed: number }
/**
 * What the shop made on parts. Only part lines with a cost written down count toward the profit, so a missing cost never
 * looks like a 100% margin. `lines` and `costed` say how much of the parts sold the figure is based on.
 */
export function partsMargin(docs: ReportDoc[], range: Range): PartsMargin {
  const out: PartsMargin = { sold: 0, cost: 0, profit: 0, pct: null, lines: 0, costed: 0 }
  for (const d of docs) {
    if (!isSale(d) || !inRange(d.date, range)) continue
    for (const it of d.items) {
      if (!(it.amount > 0)) continue
      out.lines += 1
      const c = it.cost ?? 0
      if (c > 0) { out.costed += 1; out.sold = round2(out.sold + it.amount); out.cost = round2(out.cost + c) }
    }
  }
  out.profit = round2(out.sold - out.cost)
  out.pct = out.sold > 0 ? Math.round((out.profit / out.sold) * 100) : null
  return out
}

export interface CustomerTally { name: string; customerId: string | null; amount: number; count: number }
/** The customers billed the most. Walk-ins and unnamed invoices are left out. */
export function topCustomers(docs: ReportDoc[], range: Range, limit = 5): CustomerTally[] {
  const m = new Map<string, CustomerTally>()
  for (const d of docs) {
    if (!isSale(d) || !inRange(d.date, range)) continue
    const name = d.customer.trim()
    const k = d.customerId || textKey(name)
    if (!k || !name || /^walk-?\s?in/i.test(name)) continue
    const t = m.get(k) || { name, customerId: d.customerId, amount: 0, count: 0 }
    t.amount = round2(t.amount + d.total); t.count += 1; m.set(k, t)
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount).slice(0, limit)
}

export interface Quarter { label: string; collected: number; payments: number; invoiced: number; invoices: number; tax: number }
/** Calendar quarters, newest first, for the tax return: money collected, money billed, and the sales tax on what was billed. */
export function quarters(docs: ReportDoc[], payments: ReportPayment[]): Quarter[] {
  const byId = new Map(docs.map(d => [d.id, d]))
  const q = new Map<string, Quarter>()
  const slot = (date: string) => {
    const y = date.slice(0, 4), n = Math.ceil(Number(date.slice(5, 7)) / 3)
    const label = `${y} Q${n}`
    const t = q.get(label) || { label, collected: 0, payments: 0, invoiced: 0, invoices: 0, tax: 0 }
    q.set(label, t); return t
  }
  for (const p of payments) { const d = collectedOn(p, byId); if (d.length >= 7) { const t = slot(d); t.collected = round2(t.collected + p.amount); t.payments += 1 } }
  for (const d of docs) if (isSale(d) && d.date.length >= 7) { const t = slot(d.date); t.invoiced = round2(t.invoiced + d.total); t.invoices += 1; t.tax = round2(t.tax + d.tax) }
  return [...q.values()].sort((a, b) => b.label.localeCompare(a.label))
}

/* ---------- technicians ---------- */

const normName = (s: unknown): string => String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
const isNobody = (s: string) => { const n = normName(s); return n === '' || n === 'unassigned' || n === 'none' || n === 'n/a' }

export interface TechRow {
  name: string
  /** Hours on labor lines priced by the hour. Flat-priced lines have no hours to count. */
  billedHours: number
  laborBilled: number
  jobs: number
  /** Hours on the time clock, or null when the clock could not be read. */
  clockedHours: number | null
  /** Billed hours as a share of clocked hours. Null until both numbers exist. */
  efficiency: number | null
}

export function techRows(docs: ReportDoc[], jobs: ReportJob[], range: Range, roster: string[], clocked: Map<string, number> | null): TechRow[] {
  const names = new Map<string, string>()
  const see = (n: string) => { const k = normName(n); if (!isNobody(n) && !names.has(k)) names.set(k, String(n).trim().replace(/\s+/g, ' ')); return k }
  const rows = new Map<string, TechRow>()
  const row = (n: string): TechRow | null => {
    if (isNobody(n)) return null
    const k = see(n)
    if (!rows.has(k)) rows.set(k, { name: names.get(k) || n, billedHours: 0, laborBilled: 0, jobs: 0, clockedHours: clocked ? 0 : null, efficiency: null })
    return rows.get(k)!
  }
  // Everyone on the roster is listed, even with nothing billed, so a quiet technician is visible.
  for (const n of roster) row(n)
  for (const d of docs) {
    if (!isSale(d) || !inRange(d.date, range)) continue
    for (const h of d.hours) { const r = row(h.tech); if (r) { r.billedHours = round2(r.billedHours + h.hours); r.laborBilled = round2(r.laborBilled + h.amount) } }
  }
  for (const j of jobs) { if (!inRange(j.date, range)) continue; const r = row(j.tech); if (r) r.jobs += 1 }
  if (clocked) for (const [n, hrs] of clocked) { const r = row(n); if (r) r.clockedHours = round2((r.clockedHours || 0) + hrs) }
  const out = [...rows.values()]
  for (const r of out) r.efficiency = r.clockedHours && r.clockedHours >= 1 && r.billedHours > 0 ? Math.round((r.billedHours / r.clockedHours) * 100) : null
  return out.sort((a, b) => b.laborBilled - a.laborBilled || b.billedHours - a.billedHours || b.jobs - a.jobs || a.name.localeCompare(b.name))
}

/* ---------- jobs ---------- */

const DONE = new Set(['completed', 'ready for pickup', 'paid', 'closed'])
const CLOSED = new Set(['paid', 'closed'])
export interface JobStats { opened: number; finished: number; openNow: number; byStatus: { status: string; count: number }[] }
export function jobStats(jobs: ReportJob[], range: Range): JobStats {
  const opened = jobs.filter(j => inRange(j.date, range))
  const open = jobs.filter(j => !CLOSED.has(String(j.status).trim().toLowerCase()))
  const m = new Map<string, number>()
  for (const j of open) m.set(j.status || 'No status', (m.get(j.status || 'No status') || 0) + 1)
  return {
    opened: opened.length,
    finished: opened.filter(j => DONE.has(String(j.status).trim().toLowerCase())).length,
    openNow: open.length,
    byStatus: [...m.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
  }
}

/* ---------- calls ---------- */

export const SHORT_CALL_SECONDS = 15
export interface CallStats { inbound: number; outbound: number; short: number; averageSeconds: number; weekdays: number[]; hours: number[] }
/** Calls in the range. `weekdays` runs Monday to Sunday and `hours` is 0 to 23, both counting incoming calls only. */
export function callStats(calls: ReportCall[], range: Range, dayOf: (iso: string) => string, hourOf: (iso: string) => number): CallStats {
  const out: CallStats = { inbound: 0, outbound: 0, short: 0, averageSeconds: 0, weekdays: [0, 0, 0, 0, 0, 0, 0], hours: new Array(24).fill(0) }
  let talk = 0, talked = 0
  for (const c of calls) {
    const day = dayOf(c.start)
    if (!day || !inRange(day, range)) continue
    if (c.direction === 'inbound') {
      out.inbound += 1
      out.weekdays[(parse(day).getDay() + 6) % 7] += 1
      const h = hourOf(c.start); if (h >= 0 && h < 24) out.hours[h] += 1
      if (c.seconds < SHORT_CALL_SECONDS) out.short += 1
    } else out.outbound += 1
    if (c.seconds >= SHORT_CALL_SECONDS) { talk += c.seconds; talked += 1 }
  }
  out.averageSeconds = talked ? Math.round(talk / talked) : 0
  return out
}

export function fmtSeconds(s: number): string {
  if (!(s >= 1)) return '0s'
  if (s < 60) return `${Math.round(s)}s`
  const m = Math.floor(s / 60), r = Math.round(s % 60)
  return r ? `${m}m ${r}s` : `${m}m`
}

/* ---------- files ---------- */

/** A cell that starts with = + - or @ would run as a formula when opened in a spreadsheet. A leading quote keeps it text. */
export function csvCell(v: unknown): string {
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  let s = String(v ?? '')
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Every payment in the range as a file for the bookkeeper or the tax return. */
export function paymentsCsv(payments: ReportPayment[], docs: ReportDoc[], range: Range): string {
  const byId = new Map(docs.map(d => [d.id, d]))
  const head = ['Date', 'Customer', 'Invoice date', 'Invoice total', 'Amount received', 'Method', 'Invoice status']
  const lines = [head.map(csvCell).join(',')]
  const rows = payments.map(p => ({ p, date: collectedOn(p, byId) })).filter(r => inRange(r.date, range)).sort((a, b) => a.date.localeCompare(b.date))
  for (const { p, date } of rows) {
    const d = p.docId ? byId.get(p.docId) : undefined
    lines.push([date, p.customer || d?.customer || '', d?.date || '', d ? d.total.toFixed(2) : '', p.amount.toFixed(2), methodLabel(p.method), d?.status || ''].map(csvCell).join(','))
  }
  return lines.join('\r\n') + '\r\n'
}

export { round2, num, normName as normTech }
