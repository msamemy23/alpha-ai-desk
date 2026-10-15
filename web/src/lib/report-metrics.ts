/**
 * Shop numbers beyond the basics: cars serviced, effective labor rate, gross profit per job, sales by advisor, technician and
 * kind of work, approval rate, repeat visits, and money owed by customer.
 *
 * Every function reads documents and returns numbers. None of them writes anything.
 * Where a number depends on something the paperwork does not record (a part cost, an hour count, who wrote it) the result says
 * how much it could and could not use, so the screen can say so too instead of showing a confident wrong figure.
 */
import { aging, diffDays, inRange, isSale, round2, textKey, displayText } from './reports.ts'
import type { Range, ReportDoc, ReportLine } from './reports.ts'

/* ---------- small helpers ---------- */

const isWalkIn = (name: string) => /^walk-?\s?in/i.test(name.trim())

/** Who a document is for: the customer record when there is one, else the written name. Walk-ins and blank names have no key. */
export function customerKey(d: Pick<ReportDoc, 'customerId' | 'customer'>): string {
  const name = (d.customer || '').trim()
  if (!d.customerId && (!name || isWalkIn(name))) return ''
  return d.customerId || textKey(name)
}

/** Sales ex tax: what the shop earned on the paperwork before sales tax. */
export const salesExTax = (d: Pick<ReportDoc, 'total' | 'tax'>): number => round2(d.total - d.tax)

/** All labor lines. Documents read before `lines` existed fall back to the lines that named a technician. */
export function laborLines(d: ReportDoc): ReportLine[] {
  if (d.lines) return d.lines
  return d.hours.map(h => ({ name: '', hours: h.hours, amount: h.amount, tech: h.tech, flat: h.hours === 0 }))
}

const saleDocs = (docs: ReportDoc[], range: Range) => docs.filter(d => isSale(d) && inRange(d.date, range))

/* ---------- cars serviced, new and returning ---------- */

export interface CarCount {
  /** Invoices and receipts written. */
  orders: number
  /** Different cars serviced. A car with two invoices in the period counts once. */
  cars: number
  /** Orders that name no car, each counted as one car because there is nothing to match them on. */
  carsAssumed: number
  /** Customers whose first-ever invoice is in this period. */
  newCustomers: number
  /** Customers who were billed before this period began. */
  returningCustomers: number
  /** Orders with no customer on them (walk-ins), which cannot be called new or returning. */
  unknownOrders: number
  newIds: string[]
  returningIds: string[]
  unknownIds: string[]
}

/** `docs` must be every invoice the shop has, not only this period's, because "new" means "never billed before". */
export function carCount(docs: ReportDoc[], range: Range): CarCount {
  const first = new Map<string, string>()
  for (const d of docs) {
    if (!isSale(d) || !d.date) continue
    const k = customerKey(d)
    if (!k) continue
    const prev = first.get(k)
    if (!prev || d.date < prev) first.set(k, d.date)
  }
  const mine = saleDocs(docs, range)
  const cars = new Set<string>()
  let assumed = 0
  const newC = new Set<string>(), retC = new Set<string>()
  const newIds: string[] = [], retIds: string[] = [], unkIds: string[] = []
  for (const d of mine) {
    if (d.vehicleKey) cars.add(d.vehicleKey); else assumed += 1
    const k = customerKey(d)
    if (!k) { unkIds.push(d.id); continue }
    if ((first.get(k) || '') >= range.from) { newC.add(k); newIds.push(d.id) } else { retC.add(k); retIds.push(d.id) }
  }
  return {
    orders: mine.length, cars: cars.size + assumed, carsAssumed: assumed,
    newCustomers: newC.size, returningCustomers: retC.size, unknownOrders: unkIds.length,
    newIds, returningIds: retIds, unknownIds: unkIds,
  }
}

/* ---------- effective labor rate ---------- */

export interface LaborRate {
  /** Dollars collected per hour billed, from labor lines priced by the hour. Null when no such line has hours. */
  rate: number | null
  hours: number
  hourlyAmount: number
  hourlyLines: number
  /** Labor lines priced as a whole. They have no hours, so they cannot be part of the rate. */
  flatLines: number
  flatAmount: number
  /** Share of labor dollars the rate is based on, 0 to 100. */
  coveragePct: number | null
  /** The shop's posted rate (from Settings), when given. */
  posted: number | null
  /** Posted rate minus the effective rate. Positive means the shop earns less per hour than it posts. */
  gap: number | null
  docIds: string[]
}

export function effectiveLaborRate(docs: ReportDoc[], range: Range, posted: number | null = null): LaborRate {
  let hours = 0, hourlyAmount = 0, hourlyLines = 0, flatLines = 0, flatAmount = 0
  const ids = new Set<string>()
  for (const d of saleDocs(docs, range)) {
    for (const l of laborLines(d)) {
      if (!(l.amount > 0) && !(l.hours > 0)) continue
      if (l.flat || !(l.hours > 0)) { flatLines += 1; flatAmount = round2(flatAmount + l.amount); ids.add(d.id); continue }
      hours = round2(hours + l.hours); hourlyAmount = round2(hourlyAmount + l.amount); hourlyLines += 1; ids.add(d.id)
    }
  }
  const rate = hours > 0 ? round2(hourlyAmount / hours) : null
  const all = hourlyAmount + flatAmount
  const p = posted && posted > 0 ? posted : null
  return {
    rate, hours, hourlyAmount, hourlyLines, flatLines, flatAmount,
    coveragePct: all > 0 ? Math.round((hourlyAmount / all) * 100) : null,
    posted: p, gap: rate !== null && p !== null ? round2(p - rate) : null, docIds: [...ids],
  }
}

/* ---------- gross profit ---------- */

export interface JobProfit {
  id: string
  number: string
  customer: string
  vehicle: string
  date: string
  /** Labor + parts + shop supplies, before sales tax. Sublet and core charges pass through and are not counted. */
  revenue: number
  partsRevenue: number
  partsCost: number
  /** Part lines with a price, and how many of them have a cost written down. */
  partLines: number
  partsCosted: number
  /** Estimated from hours billed times the labor cost per hour setting. Null when no cost per hour is set. */
  laborCost: number | null
  /** Hourly labor lines times cost per hour only: flat-priced labor has no hours, so its cost is not known. */
  laborCostComplete: boolean
  gross: number
  marginPct: number | null
  /** Every part line has a cost (and labor cost is known or not being counted). When false the profit is higher than the truth. */
  complete: boolean
}

export interface ProfitSummary {
  revenue: number
  partsRevenue: number
  partsCost: number
  laborCost: number | null
  gross: number
  marginPct: number | null
  /** Sublet and core charges: on the paperwork but handed on, so they are left out of revenue. */
  passedThrough: number
  partLines: number
  partsCosted: number
  jobs: JobProfit[]
  /** Jobs missing a part cost, so the shop can fill them in. */
  incomplete: number
  basis: 'parts' | 'parts-and-labor'
}

export function grossProfit(docs: ReportDoc[], range: Range, opts: { laborCostPerHour?: number | null } = {}): ProfitSummary {
  const perHour = opts.laborCostPerHour && opts.laborCostPerHour > 0 ? opts.laborCostPerHour : null
  const jobs: JobProfit[] = []
  for (const d of saleDocs(docs, range)) {
    const supplies = d.supplies ?? 0
    const revenue = round2(d.labor + d.parts + supplies)
    let partsCost = 0, partLines = 0, partsCosted = 0
    for (const it of d.items) {
      if (!(it.amount > 0)) continue
      partLines += 1
      if ((it.cost ?? 0) > 0) { partsCosted += 1; partsCost = round2(partsCost + (it.cost ?? 0)) }
    }
    let laborCost: number | null = null
    let laborComplete = true
    if (perHour !== null) {
      let h = 0
      for (const l of laborLines(d)) {
        if (l.flat || !(l.hours > 0)) { if (l.amount > 0) laborComplete = false; continue }
        h += l.hours
      }
      laborCost = round2(h * perHour)
    }
    const gross = round2(revenue - partsCost - (laborCost ?? 0))
    jobs.push({
      id: d.id, number: d.number || '', customer: d.customer, vehicle: d.vehicle || '', date: d.date,
      revenue, partsRevenue: d.parts, partsCost, partLines, partsCosted, laborCost, laborCostComplete: laborComplete, gross,
      marginPct: revenue > 0 ? Math.round((gross / revenue) * 100) : null,
      complete: partsCosted === partLines && (perHour === null || laborComplete),
    })
  }
  const sum = (f: (j: JobProfit) => number) => round2(jobs.reduce((s, j) => s + f(j), 0))
  const revenue = sum(j => j.revenue)
  const gross = sum(j => j.gross)
  const passed = round2(saleDocs(docs, range).reduce((s, d) => s + Math.max(0, d.fees - (d.supplies ?? 0)), 0))
  return {
    revenue, partsRevenue: sum(j => j.partsRevenue), partsCost: sum(j => j.partsCost),
    laborCost: perHour !== null ? sum(j => j.laborCost ?? 0) : null,
    gross, marginPct: revenue > 0 ? Math.round((gross / revenue) * 100) : null, passedThrough: passed,
    partLines: jobs.reduce((s, j) => s + j.partLines, 0), partsCosted: jobs.reduce((s, j) => s + j.partsCosted, 0),
    jobs, incomplete: jobs.filter(j => !j.complete).length, basis: perHour !== null ? 'parts-and-labor' : 'parts',
  }
}

/* ---------- what kind of work ---------- */

/**
 * Kinds of work, found by the words on the line. This is a convenience grouping, not an accounting category: a line the rules
 * do not recognise lands in "Other work", and the screen lists the biggest of those so the rules can be improved.
 */
const CATEGORY_RULES: { label: string; test: RegExp }[] = [
  { label: 'Oil changes and fluids', test: /\boil\b|lube|fluid|flush|coolant|antifreeze|transmission service|grease/i },
  { label: 'Brakes', test: /brake|\bpads?\b|rotor|caliper|\babs\b|drum|master cylinder|wheel cylinder/i },
  { label: 'Alignment, suspension and steering', test: /alignment|suspension|strut|shock|control arm|ball joint|tie rod|sway|bushing|steering|\brack\b|cv axle|\bcv\b|wheel bearing|\bhub\b|spring/i },
  { label: 'Tires and wheels', test: /\btires?\b|\bwheels?\b|rotation|balanc|valve stem|\btpms\b|flat repair|patch/i },
  { label: 'Air conditioning and heating', test: /\ba\/?c\b|air condition|refrigerant|freon|compressor|condenser|evaporator|heater|blower|cabin/i },
  { label: 'Exhaust and emissions', test: /exhaust|muffler|catalytic|\bcat\b|tailpipe|\bo2\b|oxygen|emission/i },
  { label: 'Diagnostics and inspection', test: /diagnos|inspect|check engine|scan|road test|\bcodes?\b|smog/i },
  { label: 'Battery, charging and electrical', test: /battery|alternator|starter|fuse|relay|wiring|electrical|light|bulb|headlamp|switch|sensor|ignition coil|spark plug/i },
  { label: 'Engine', test: /engine|motor mount|valve cover|head gasket|timing|belt|tensioner|pulley|gasket|misfire|turbo|injector|fuel pump|throttle|\bpcv\b|intake/i },
  { label: 'Cooling system', test: /radiator|thermostat|water pump|hose|overheat|cooling/i },
  { label: 'Transmission and drivetrain', test: /transmission|clutch|driveshaft|drive shaft|transfer case|\baxle\b|differential|\b4wd\b|\bawd\b|gearbox/i },
  { label: 'Wipers, glass and body', test: /wiper|windshield|glass|mirror|bumper|body|paint|dent|door|window/i },
]
export const OTHER_WORK = 'Other work'

export function categoryOf(name: string): string {
  const n = String(name || '')
  if (!n.trim()) return OTHER_WORK
  for (const r of CATEGORY_RULES) if (r.test.test(n)) return r.label
  return OTHER_WORK
}

export interface Slice { key: string; label: string; amount: number; count: number; hours?: number; ids: string[] }

function bump(m: Map<string, Slice>, key: string, label: string, amount: number, id: string, hours = 0) {
  const s = m.get(key) || { key, label, amount: 0, count: 0, hours: 0, ids: [] as string[] }
  s.amount = round2(s.amount + amount); s.hours = round2((s.hours || 0) + hours)
  if (!s.ids.includes(id)) { s.ids.push(id); s.count += 1 }
  m.set(key, s)
}
const biggest = (m: Map<string, Slice>): Slice[] => [...m.values()].sort((a, b) => b.amount - a.amount || b.count - a.count || a.label.localeCompare(b.label))

export const NOT_RECORDED = 'Not recorded'

/** Sales (before sales tax) by whoever wrote the paperwork. Blank goes in "Not recorded" so the gap is visible. */
export function salesByAdvisor(docs: ReportDoc[], range: Range): Slice[] {
  const m = new Map<string, Slice>()
  for (const d of saleDocs(docs, range)) {
    const name = (d.advisor || '').trim()
    bump(m, name ? textKey(name) : '~none', name ? displayText(name) : NOT_RECORDED, salesExTax(d), d.id)
  }
  // "Not recorded" always last, so it reads as a footnote rather than a ranking.
  const list = biggest(m)
  return [...list.filter(s => s.key !== '~none'), ...list.filter(s => s.key === '~none')]
}

/** Labor sold by technician, from the labor lines that name one. Lines with nobody named are one separate row. */
export function salesByTech(docs: ReportDoc[], range: Range): Slice[] {
  const m = new Map<string, Slice>()
  for (const d of saleDocs(docs, range)) {
    for (const l of laborLines(d)) {
      if (!(l.amount > 0) && !(l.hours > 0)) continue
      const t = (l.tech || '').trim()
      bump(m, t ? textKey(t) : '~none', t ? displayText(t) : 'No technician named', l.amount, d.id, l.flat ? 0 : l.hours)
    }
  }
  const list = biggest(m)
  return [...list.filter(s => s.key !== '~none'), ...list.filter(s => s.key === '~none')]
}

/** Money by kind of work (brakes, tires and so on), from labor lines and part lines. Fees go in their own row. */
export function salesByCategory(docs: ReportDoc[], range: Range): { slices: Slice[]; other: { name: string; amount: number }[] } {
  const m = new Map<string, Slice>()
  const otherNames = new Map<string, { name: string; amount: number }>()
  const noteOther = (name: string, amount: number) => {
    const k = textKey(name); if (!k) return
    const o = otherNames.get(k) || { name: displayText(name), amount: 0 }
    o.amount = round2(o.amount + amount); otherNames.set(k, o)
  }
  for (const d of saleDocs(docs, range)) {
    for (const o of d.ops) {
      const label = categoryOf(o.name)
      bump(m, label, label, o.amount, d.id)
      if (label === OTHER_WORK) noteOther(o.name || 'Unnamed labor line', o.amount)
    }
    for (const it of d.items) {
      const label = categoryOf(it.name)
      bump(m, label, label, it.amount, d.id)
      if (label === OTHER_WORK) noteOther(it.name || 'Unnamed part', it.amount)
    }
    if (d.fees > 0) bump(m, '~fees', 'Shop supplies, sublet and core charges', d.fees, d.id)
  }
  const list = biggest(m).filter(s => s.amount > 0 || s.count > 0)
  const tail = ['~fees', OTHER_WORK]
  const ordered = [...list.filter(s => !tail.includes(s.key)), ...tail.map(k => list.find(s => s.key === k)).filter((s): s is Slice => !!s)]
  return { slices: ordered, other: [...otherNames.values()].sort((a, b) => b.amount - a.amount).slice(0, 8) }
}

export interface RevenueMix { labor: number; parts: number; supplies: number; sublet: number; core: number; other: number; tax: number; total: number }
/** Where the money on the paperwork came from, matching the invoice totals exactly (anything not itemised is "other"). */
export function revenueMix(docs: ReportDoc[], range: Range): RevenueMix {
  const out: RevenueMix = { labor: 0, parts: 0, supplies: 0, sublet: 0, core: 0, other: 0, tax: 0, total: 0 }
  for (const d of saleDocs(docs, range)) {
    out.labor += d.labor; out.parts += d.parts; out.tax += d.tax; out.total += d.total
    if (d.supplies !== undefined || d.sublet !== undefined || d.core !== undefined) {
      out.supplies += d.supplies ?? 0; out.sublet += d.sublet ?? 0; out.core += d.core ?? 0
      out.other += Math.max(0, d.fees - (d.supplies ?? 0) - (d.sublet ?? 0) - (d.core ?? 0))
    } else out.other += d.fees
  }
  for (const k of Object.keys(out) as (keyof RevenueMix)[]) out[k] = round2(out[k])
  return out
}

/* ---------- approval ---------- */

export interface ApprovalStats {
  /** Paperwork sent for online approval in the period. */
  sent: number
  /** Of those, how many the customer approved online. */
  approved: number
  /** Null until something was sent. */
  ratePct: number | null
  askedTotal: number
  approvedTotal: number
  /** Estimates sent and still not approved online, any age. */
  waiting: number
  /** Of those, how many have waited more than a week. */
  waitingOld: number
  sentIds: string[]
  waitingIds: string[]
}

/**
 * Online approvals only. A customer who says yes on the phone or in the shop is not recorded as an approval, so this
 * is the share approved through the link, and the screen says that. `docs` is every estimate and invoice.
 */
export function approvalStats(docs: ReportDoc[], range: Range, todayKey: string): ApprovalStats {
  const sent = docs.filter(d => d.signatureRequestedAt && inRange(d.signatureRequestedAt, range))
  const approved = sent.filter(d => d.signedAt)
  const waitingDocs = docs.filter(d => d.type === 'Estimate' && String(d.status).trim().toLowerCase() === 'sent' && d.signatureRequestedAt && !d.signedAt)
  return {
    sent: sent.length, approved: approved.length,
    ratePct: sent.length ? Math.round((approved.length / sent.length) * 100) : null,
    askedTotal: round2(sent.reduce((s, d) => s + d.total, 0)),
    approvedTotal: round2(approved.reduce((s, d) => s + d.total, 0)),
    waiting: waitingDocs.length,
    waitingOld: waitingDocs.filter(d => diffDays((d.signatureRequestedAt || d.date).slice(0, 10), todayKey) > 7).length,
    sentIds: sent.map(d => d.id), waitingIds: waitingDocs.map(d => d.id),
  }
}

/* ---------- repeat visits ---------- */

export interface Repeat { doc: ReportDoc; previous: ReportDoc; days: number }
export interface RepeatStats {
  /** Orders this period that name a car. The rate is out of these. */
  considered: number
  count: number
  ratePct: number | null
  list: Repeat[]
  withinDays: number
}

const ROUTINE = new Set(['Oil changes and fluids', 'Tires and wheels', 'Diagnostics and inspection'])

/**
 * The same car back within a few weeks of an earlier invoice. Some of these are comebacks (the first repair did not hold),
 * some are a new problem or routine service, so the screen calls them "repeat visits" and lets the owner open each one.
 * Visits that are only routine work (oil, tires, inspection) are left out unless asked for.
 */
export function repeatVisits(docs: ReportDoc[], range: Range, opts: { withinDays?: number; skipRoutine?: boolean } = {}): RepeatStats {
  const within = opts.withinDays ?? 30
  const skipRoutine = opts.skipRoutine !== false
  const byCar = new Map<string, ReportDoc[]>()
  for (const d of docs) {
    if (!isSale(d) || !d.vehicleKey || !d.date) continue
    const list = byCar.get(d.vehicleKey) || []
    list.push(d); byCar.set(d.vehicleKey, list)
  }
  const list: Repeat[] = []
  let considered = 0
  for (const group of byCar.values()) {
    group.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id))
    group.forEach((d, i) => {
      if (!inRange(d.date, range)) return
      considered += 1
      // The latest earlier visit on a different day.
      let prev: ReportDoc | null = null
      for (let j = i - 1; j >= 0; j--) if (group[j].date < d.date) { prev = group[j]; break }
      if (!prev) return
      const days = diffDays(prev.date, d.date)
      if (days > within) return
      if (skipRoutine && d.ops.length > 0 && d.ops.every(o => ROUTINE.has(categoryOf(o.name)))) return
      list.push({ doc: d, previous: prev, days })
    })
  }
  list.sort((a, b) => b.doc.date.localeCompare(a.doc.date))
  return { considered, count: list.length, ratePct: considered ? Math.round((list.length / considered) * 1000) / 10 : null, list, withinDays: within }
}

/* ---------- who owes what ---------- */

export interface OwedCustomer { key: string; name: string; customerId: string | null; amount: number; count: number; oldestDays: number; ids: string[]; phone: string; email: string }

/** Open balances added up per customer, biggest first. Same invoices and ages as the aging buckets. */
export function owedByCustomer(docs: ReportDoc[], todayKey: string): OwedCustomer[] {
  const m = new Map<string, OwedCustomer>()
  for (const o of aging(docs, todayKey).open) {
    const d = o.doc
    const key = d.customerId || textKey(d.customer) || '~none'
    const c = m.get(key) || { key, name: d.customer || 'No customer name', customerId: d.customerId, amount: 0, count: 0, oldestDays: 0, ids: [] as string[], phone: d.phone || '', email: d.email || '' }
    c.amount = round2(c.amount + d.balance); c.count += 1; c.oldestDays = Math.max(c.oldestDays, o.days); c.ids.push(d.id)
    if (!c.phone && d.phone) c.phone = d.phone
    if (!c.email && d.email) c.email = d.email
    m.set(key, c)
  }
  return [...m.values()].sort((a, b) => b.amount - a.amount || b.oldestDays - a.oldestDays)
}

/* ---------- cash and accrual ---------- */

export interface CashVsAccrual {
  /** Billed in the period (accrual). */
  billed: number
  /** Received in the period (cash). */
  received: number
  /** Billed minus received: positive means more went on the books than came in. */
  gap: number
  /** One plain sentence about the gap. */
  words: string
}

export function cashVsAccrual(billed: number, received: number): CashVsAccrual {
  const gap = round2(billed - received)
  const money = (n: number) => `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`
  const words = Math.abs(gap) < 0.5
    ? 'Billed and received are about the same in this period.'
    : gap > 0
      ? `You billed ${money(gap)} more than you received. That money is owed to you, or was paid in a later period.`
      : `You received ${money(gap)} more than you billed. That is money for work billed in an earlier period.`
  return { billed: round2(billed), received: round2(received), gap, words }
}

export const CASH_VS_ACCRUAL_NOTE =
  'Billed is counted on the invoice date (accrual). Received is counted on the day the money came in (cash). Your accountant uses one or the other for taxes, so ask which one your return uses.'

/* ---------- ranges of documents, for drilling into a number ---------- */

/** The documents behind a figure, newest first. */
export function docsById(docs: ReportDoc[], ids: string[]): ReportDoc[] {
  const want = new Set(ids)
  return docs.filter(d => want.has(d.id)).sort((a, b) => b.date.localeCompare(a.date) || (b.number || '').localeCompare(a.number || ''))
}
