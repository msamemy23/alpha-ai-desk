/**
 * How full a shop's day is, whether a new booking fits, and which start times are open.
 * Dates are yyyy-mm-dd and times are HH:MM in the shop's own clock. No imports, so the browser,
 * the server and `node --test` all run the same code.
 *
 * Two uses, one set of rules:
 *  - Inside the app, `bookingWarnings` tells the person writing a booking what will be tight. It warns and never blocks.
 *  - On the public booking page, `freeSlots` only offers start times that fit. It blocks, because nobody is there to decide.
 */

export const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const
export type DayKey = (typeof DAY_KEYS)[number]
export const DAY_LABEL: Record<DayKey, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' }

export interface DayHours { open: boolean; start: string; end: string }
export type WeekHours = Record<DayKey, DayHours>

/** How the customer brings the car: leaves it for the day, or sits in the waiting room. */
export type JobKind = 'dropoff' | 'wait'
export const KIND_WORD: Record<JobKind, string> = { dropoff: 'Drop-off', wait: 'Waiting' }
export const KIND_HELP: Record<JobKind, string> = { dropoff: 'Leaves the car and picks it up later', wait: 'Stays at the shop while the work is done' }

export interface ServiceType {
  key: string
  label: string
  /** How long the work takes. */
  minutes: number
  /** What most customers do for this job. */
  kind: JobKind
  /** Offered on the public booking page. */
  online: boolean
}

export interface CapacitySettings {
  hours: WeekHours
  /** Holidays and other closed days, yyyy-mm-dd. */
  closedDates: string[]
  /** Lifts and bays that can hold a car being worked on at once. 0 means: as many as there are technicians. */
  bays: number
  /** Technicians working on a normal day. */
  techCount: number
  /** Hours of real work one technician can bill in a day. */
  hoursPerTech: number
  /** Cars that may be dropped off in one day. 0 means no limit. */
  maxDropoffs: number
  /** Cars that may arrive in the same arrival window. 0 means no limit. */
  maxArrivals: number
  /** Length of an arrival window, in minutes. */
  arrivalMinutes: number
  /** Customers who may be waiting in the shop at the same time. 0 means no limit. */
  maxWaiters: number
  services: ServiceType[]
  /** How long after the booked time a car can be missing before it is flagged. */
  noShowGraceMinutes: number
}

const day = (start: string, end: string, open = true): DayHours => ({ open, start, end })

export const DEFAULT_HOURS: WeekHours = {
  mon: day('08:00', '17:00'), tue: day('08:00', '17:00'), wed: day('08:00', '17:00'), thu: day('08:00', '17:00'), fri: day('08:00', '17:00'),
  sat: day('08:00', '12:00', false), sun: day('08:00', '12:00', false),
}

/** Plain names, normal times. A shop edits these to match how it works. */
export const DEFAULT_SERVICES: ServiceType[] = [
  { key: 'oil', label: 'Oil change', minutes: 45, kind: 'wait', online: true },
  { key: 'inspection', label: 'Inspection', minutes: 45, kind: 'wait', online: true },
  { key: 'tires', label: 'Tire service', minutes: 60, kind: 'wait', online: true },
  { key: 'brakes', label: 'Brake service', minutes: 150, kind: 'dropoff', online: true },
  { key: 'diagnostic', label: 'Check engine or warning light', minutes: 90, kind: 'dropoff', online: true },
  { key: 'ac', label: 'A/C service', minutes: 120, kind: 'dropoff', online: true },
  { key: 'repair', label: 'Other repair or a noise', minutes: 120, kind: 'dropoff', online: true },
]

export const DEFAULT_CAPACITY: CapacitySettings = {
  hours: DEFAULT_HOURS, closedDates: [], bays: 0, techCount: 0, hoursPerTech: 7, maxDropoffs: 0, maxArrivals: 0, arrivalMinutes: 30, maxWaiters: 0,
  services: DEFAULT_SERVICES, noShowGraceMinutes: 30,
}

/* ---------- dates and times ---------- */

const YMD = /^\d{4}-\d{2}-\d{2}$/
const HM = /^([01]\d|2[0-3]):[0-5]\d$/
export const isYmd = (s: unknown): s is string => {
  if (typeof s !== 'string' || !YMD.test(s)) return false
  const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)))
  // 2026-02-30 rolls over to March 2, so a real date must read back the same.
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}` === s
}
export const isHm = (s: unknown): s is string => typeof s === 'string' && HM.test(s)

export const hm = (t: unknown): string => String(t ?? '').slice(0, 5)
export function minutesOf(t: unknown): number {
  const [h, m] = hm(t).split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}
export function timeOf(mins: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(mins)))
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

const utc = (ymd: string) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10))
export function addDaysYmd(ymd: string, n: number): string {
  const d = new Date(utc(ymd) + n * 86_400_000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}
export const daysApart = (from: string, to: string): number => Math.round((utc(to) - utc(from)) / 86_400_000)
/** Monday is 0. */
export const dayKeyOf = (ymd: string): DayKey => DAY_KEYS[(new Date(utc(ymd)).getUTCDay() + 6) % 7]

export interface ShopNow { ymd: string; minutes: number }

/** What day and minute it is on the shop's own clock. An unknown time zone falls back to the machine's clock. */
export function nowIn(timeZone: string | null | undefined, at: Date = new Date()): ShopNow {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timeZone || undefined, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(at)
    const g = (t: string) => parts.find(p => p.type === t)?.value || '00'
    return { ymd: `${g('year')}-${g('month')}-${g('day')}`, minutes: (Number(g('hour')) % 24) * 60 + Number(g('minute')) }
  } catch {
    return { ymd: `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`, minutes: at.getHours() * 60 + at.getMinutes() }
  }
}

/* ---------- cleaning settings ---------- */

const int = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : fallback
}

export function cleanHours(raw: unknown): WeekHours {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const out = {} as WeekHours
  for (const k of DAY_KEYS) {
    const d = o[k] && typeof o[k] === 'object' ? (o[k] as Record<string, unknown>) : {}
    const base = DEFAULT_HOURS[k]
    let start = isHm(d.start) ? d.start : base.start
    let end = isHm(d.end) ? d.end : base.end
    if (minutesOf(end) <= minutesOf(start)) { start = base.start; end = base.end }
    out[k] = { open: typeof d.open === 'boolean' ? d.open : base.open, start, end }
  }
  return out
}

export function cleanServices(raw: unknown): ServiceType[] {
  if (!Array.isArray(raw)) return DEFAULT_SERVICES
  const seen = new Set<string>()
  const out: ServiceType[] = []
  for (const s of raw.slice(0, 30)) {
    if (!s || typeof s !== 'object') continue
    const o = s as Record<string, unknown>
    const label = String(o.label ?? '').replace(/\s+/g, ' ').trim().slice(0, 60)
    if (!label || seen.has(label.toLowerCase())) continue
    seen.add(label.toLowerCase())
    const key = String(o.key ?? '').replace(/[^a-z0-9-]/gi, '').toLowerCase().slice(0, 24) || `s${out.length + 1}`
    out.push({ key, label, minutes: int(o.minutes, 15, 600, 60), kind: o.kind === 'wait' ? 'wait' : 'dropoff', online: o.online !== false })
  }
  return out
}

export function cleanCapacity(raw: unknown): CapacitySettings {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const closed = Array.isArray(o.closedDates) ? [...new Set(o.closedDates.filter(isYmd))].sort().slice(0, 400) : []
  return {
    hours: cleanHours(o.hours),
    closedDates: closed,
    bays: int(o.bays, 0, 40, 0),
    techCount: int(o.techCount, 0, 60, 0),
    hoursPerTech: Math.max(1, Math.min(12, Number(o.hoursPerTech) || DEFAULT_CAPACITY.hoursPerTech)),
    maxDropoffs: int(o.maxDropoffs, 0, 200, 0),
    maxArrivals: int(o.maxArrivals, 0, 40, 0),
    arrivalMinutes: [15, 30, 60].includes(Number(o.arrivalMinutes)) ? Number(o.arrivalMinutes) : 30,
    maxWaiters: int(o.maxWaiters, 0, 40, 0),
    services: o.services === undefined ? DEFAULT_SERVICES : cleanServices(o.services),
    noShowGraceMinutes: int(o.noShowGraceMinutes, 5, 240, 30),
  }
}

/* ---------- the day ---------- */

/** The part of an appointment this file cares about. */
export interface Slot {
  id?: string
  date: string
  time: string
  duration: number | null | undefined
  status?: string | null
  tech?: string | null
  kind?: JobKind | null
  bay?: string | null
}

/** A cancelled, no-show or declined booking takes no room. A request counts, so one slot is not sold twice while it waits for an answer. */
export const takesRoom = (status: string | null | undefined): boolean => !['Cancelled', 'No Show', 'Declined'].includes(String(status || ''))

export const lengthOf = (a: Pick<Slot, 'duration'>): number => (Number(a.duration) > 0 ? Number(a.duration) : 60)
const startOf = (a: Slot) => minutesOf(a.time)
const endOfSlot = (a: Slot) => startOf(a) + lengthOf(a)

export type Closed = { open: false; reason: 'closed-date' | 'closed-day' }
export type OpenDay = { open: true; start: number; end: number }

export function openHours(s: CapacitySettings, ymd: string): Closed | OpenDay {
  if (s.closedDates.includes(ymd)) return { open: false, reason: 'closed-date' }
  const h = s.hours[dayKeyOf(ymd)]
  if (!h.open) return { open: false, reason: 'closed-day' }
  return { open: true, start: minutesOf(h.start), end: minutesOf(h.end) }
}

/** Technician minutes the shop can sell in a day. null when the number of technicians is not set. */
export function dayCapacityMinutes(s: CapacitySettings, ymd: string, techs?: number): number | null {
  const n = techs ?? s.techCount
  if (!n || n < 1) return null
  const h = openHours(s, ymd)
  if (!h.open) return 0
  return Math.round(Math.min(s.hoursPerTech * 60, h.end - h.start) * n)
}

export type LoadLevel = 'closed' | 'open' | 'busy' | 'full' | 'over'
export const LOAD_WORD: Record<LoadLevel, string> = { closed: 'Closed', open: 'Open', busy: 'Getting busy', full: 'Nearly full', over: 'Over capacity' }

export interface DayLoad {
  ymd: string
  level: LoadLevel
  word: string
  bookedMinutes: number
  capacityMinutes: number | null
  /** Percent of the day's technician time that is booked, or null when it cannot be worked out. */
  pct: number | null
  count: number
  dropoffs: number
  waiters: number
}

export function dayLoad(s: CapacitySettings, appts: Slot[], ymd: string, techs?: number): DayLoad {
  const mine = appts.filter(a => a.date === ymd && takesRoom(a.status))
  const booked = mine.reduce((n, a) => n + lengthOf(a), 0)
  const cap = dayCapacityMinutes(s, ymd, techs)
  const h = openHours(s, ymd)
  const pct = cap && cap > 0 ? Math.round((booked / cap) * 100) : null
  let level: LoadLevel = 'open'
  if (!h.open && mine.length === 0) level = 'closed'
  else if (pct !== null) level = pct > 100 ? 'over' : pct >= 90 ? 'full' : pct >= 60 ? 'busy' : 'open'
  return {
    ymd, level, word: LOAD_WORD[level], bookedMinutes: booked, capacityMinutes: cap, pct, count: mine.length,
    dropoffs: mine.filter(a => a.kind === 'dropoff').length, waiters: mine.filter(a => a.kind === 'wait').length,
  }
}

/** Hours and minutes as the shop says them: 5 h 30 min, or 45 min. */
export function hoursText(mins: number): string {
  const m = Math.max(0, Math.round(mins))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60), r = m % 60
  return r ? `${h} h ${r} min` : `${h} h`
}

/** "5 h 30 min booked of 14 h" or "5 h 30 min booked" when the number of technicians is not set. */
export function loadText(l: DayLoad): string {
  if (l.level === 'closed') return 'Closed'
  const base = `${hoursText(l.bookedMinutes)} booked`
  return l.capacityMinutes ? `${base} of ${hoursText(l.capacityMinutes)}` : base
}

/** Most cars at once that match `pred` at any moment between start and end. A sweep over start and end points. */
export function peakOverlap(appts: Slot[], start: number, end: number, pred: (a: Slot) => boolean = () => true): number {
  const events: [number, number][] = []
  for (const a of appts) {
    if (!pred(a)) continue
    const s = Math.max(startOf(a), start), e = Math.min(endOfSlot(a), end)
    if (e > s) { events.push([s, 1]); events.push([e, -1]) }
  }
  // At the same minute, a car leaving frees its place before another arrives.
  events.sort((x, y) => x[0] - y[0] || x[1] - y[1])
  let cur = 0, peak = 0
  for (const [, d] of events) { cur += d; if (cur > peak) peak = cur }
  return peak
}

/** The most cars that can be worked on at once: bays, or technicians when bays are not counted. 0 means no limit is known. */
export function concurrencyLimit(s: CapacitySettings): number {
  if (s.bays > 0 && s.techCount > 0) return Math.min(s.bays, s.techCount)
  return s.bays > 0 ? s.bays : s.techCount > 0 ? s.techCount : 0
}

/* ---------- warnings on a booking ---------- */

export interface BookingWarning {
  code: 'past' | 'closed' | 'hours' | 'tech' | 'bay' | 'waiters' | 'dropoffs' | 'arrivals' | 'day-full'
  text: string
}

export interface Candidate extends Slot { id?: string }

export interface WarnOptions {
  /** Today and the minute of the day on the shop's clock, to catch times that have passed. */
  now?: ShopNow
}

/**
 * What is tight about this booking. Every line is a plain sentence the person can act on.
 * The booking being edited is left out of the count, so changing its time does not clash with itself.
 */
export function bookingWarnings(s: CapacitySettings, appts: Slot[], c: Candidate, opts: WarnOptions = {}): BookingWarning[] {
  const out: BookingWarning[] = []
  if (!isYmd(c.date) || !isHm(hm(c.time))) return out
  const others = appts.filter(a => (c.id ? a.id !== c.id : true) && a.date === c.date && takesRoom(a.status))
  const start = startOf(c), end = endOfSlot(c)

  if (opts.now && (c.date < opts.now.ymd || (c.date === opts.now.ymd && start < opts.now.minutes))) out.push({ code: 'past', text: 'That time has already passed.' })

  const h = openHours(s, c.date)
  if (!h.open) out.push({ code: 'closed', text: h.reason === 'closed-date' ? 'The shop is marked closed on this day.' : `The shop is closed on ${DAY_LABEL[dayKeyOf(c.date)]}s.` })
  else if (start < h.start || end > h.end) out.push({ code: 'hours', text: `This runs outside shop hours (${fmt12(timeOf(h.start))} to ${fmt12(timeOf(h.end))}).` })

  const tech = String(c.tech || '').trim().toLowerCase()
  if (tech && tech !== 'unassigned') {
    const clash = others.filter(a => String(a.tech || '').trim().toLowerCase() === tech && startOf(a) < end && start < endOfSlot(a))
    if (clash.length > 0) out.push({ code: 'tech', text: `${String(c.tech).trim()} already has ${clash.length === 1 ? 'a booking' : `${clash.length} bookings`} at this time.` })
  }

  const limit = concurrencyLimit(s)
  if (limit > 0 && peakOverlap(others, start, end) >= limit) {
    out.push({ code: 'bay', text: s.bays > 0 && (s.techCount === 0 || s.bays <= s.techCount) ? `All ${s.bays} ${s.bays === 1 ? 'bay is' : 'bays are'} in use at this time.` : `All ${s.techCount} ${s.techCount === 1 ? 'technician is' : 'technicians are'} booked at this time.` })
  }
  if (c.kind === 'wait' && s.maxWaiters > 0 && peakOverlap(others, start, end, a => a.kind === 'wait') >= s.maxWaiters) {
    out.push({ code: 'waiters', text: `${s.maxWaiters === 1 ? 'One customer is' : `${s.maxWaiters} customers are`} already waiting at this time.` })
  }
  if (c.kind === 'dropoff' && s.maxDropoffs > 0 && others.filter(a => a.kind === 'dropoff').length >= s.maxDropoffs) {
    out.push({ code: 'dropoffs', text: `${s.maxDropoffs} ${s.maxDropoffs === 1 ? 'drop-off is' : 'drop-offs are'} already booked this day.` })
  }
  if (s.maxArrivals > 0) {
    const win = Math.floor(start / s.arrivalMinutes)
    if (others.filter(a => Math.floor(startOf(a) / s.arrivalMinutes) === win).length >= s.maxArrivals) {
      out.push({ code: 'arrivals', text: `${s.maxArrivals} ${s.maxArrivals === 1 ? 'car is' : 'cars are'} already due in the same ${s.arrivalMinutes} minutes.` })
    }
  }
  const cap = dayCapacityMinutes(s, c.date)
  if (cap && cap > 0) {
    const booked = others.reduce((n, a) => n + lengthOf(a), 0) + lengthOf(c)
    if (booked > cap) out.push({ code: 'day-full', text: `With this, ${hoursText(booked)} is booked and the day has ${hoursText(cap)} of technician time.` })
  }
  return out
}

function fmt12(t: string): string {
  const [h, m] = hm(t).split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`
}
export const time12 = fmt12

/* ---------- open times for the public page ---------- */

export interface SlotQuery {
  date: string
  minutes: number
  kind: JobKind
  now: ShopNow
  /** The earliest booking, in minutes from now. */
  leadMinutes: number
  /** Gap between offered start times. */
  step: number
}

/**
 * Start times that really fit: inside hours, far enough ahead, and under every limit the shop set.
 * Nothing about who holds the other bookings is looked at or returned.
 */
export function freeSlots(s: CapacitySettings, appts: Slot[], q: SlotQuery): string[] {
  const h = openHours(s, q.date)
  if (!h.open || q.minutes < 1) return []
  const others = appts.filter(a => a.date === q.date && takesRoom(a.status))
  // A booking can never be offered when the shop has not said how many technicians there are: at least one.
  const techs = Math.max(1, s.techCount)
  const limit = Math.max(1, concurrencyLimit({ ...s, techCount: techs }))
  const cap = dayCapacityMinutes(s, q.date, techs) ?? 0
  const bookedAlready = others.reduce((n, a) => n + lengthOf(a), 0)
  if (cap > 0 && bookedAlready + q.minutes > cap) return []
  if (q.kind === 'dropoff' && s.maxDropoffs > 0 && others.filter(a => a.kind === 'dropoff').length >= s.maxDropoffs) return []
  const days = daysApart(q.now.ymd, q.date)
  if (days < 0) return []
  // A start time is allowed when it is at least `leadMinutes` after this very minute, counted across midnights.
  const earliest = q.now.minutes + q.leadMinutes - days * 1440
  const out: string[] = []
  const step = Math.max(15, q.step)
  for (let t = h.start; t + q.minutes <= h.end; t += step) {
    if (t < earliest) continue
    const end = t + q.minutes
    if (peakOverlap(others, t, end) >= limit) continue
    if (q.kind === 'wait' && s.maxWaiters > 0 && peakOverlap(others, t, end, a => a.kind === 'wait') >= s.maxWaiters) continue
    if (s.maxArrivals > 0) {
      const win = Math.floor(t / s.arrivalMinutes)
      if (others.filter(a => Math.floor(startOf(a) / s.arrivalMinutes) === win).length >= s.maxArrivals) continue
    }
    out.push(timeOf(t))
  }
  return out
}

/* ---------- how long a job takes ---------- */

const STOP = new Set(['and', 'the', 'a', 'of', 'for', 'service', 'repair', 'replacement', 'replace'])
const words = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9/]+/g, ' ').split(' ').filter(w => w && !STOP.has(w)).map(w => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w))

/** The service type that best fits what was typed: an exact label, or the one sharing the most words. */
export function serviceFor(text: string, services: ServiceType[]): ServiceType | null {
  const t = String(text || '').trim().toLowerCase()
  if (!t) return null
  const exact = services.find(s => s.label.toLowerCase() === t)
  if (exact) return exact
  const want = new Set(words(t))
  let best: ServiceType | null = null, bestScore = 0
  for (const s of services) {
    const score = words(s.label).filter(w => want.has(w)).length
    if (score > bestScore) { best = s; bestScore = score }
  }
  return best
}

export interface CannedMinutes { name: string; labor_hours?: number | null }

/**
 * Minutes for a job: the shop's own canned job with that name (its labor hours, rounded up to 15 minutes),
 * else the service type that fits. null when nothing fits, so the form keeps what the person chose.
 */
export function minutesFor(text: string, s: Pick<CapacitySettings, 'services'>, canned: CannedMinutes[] = []): { minutes: number; kind: JobKind | null; from: string } | null {
  const t = String(text || '').trim().toLowerCase()
  if (!t) return null
  const c = canned.find(j => String(j.name || '').trim().toLowerCase() === t && Number(j.labor_hours) > 0)
  if (c) return { minutes: Math.max(15, Math.ceil((Number(c.labor_hours) * 60) / 15) * 15), kind: null, from: 'canned job' }
  const sv = serviceFor(t, s.services)
  return sv ? { minutes: sv.minutes, kind: sv.kind, from: 'service type' } : null
}

/* ---------- no-shows ---------- */

/** Booked, not yet in the shop, and past the grace time. Today only, and only while the shop is still open. */
export function isOverdueArrival(a: Pick<Slot, 'date' | 'time' | 'status'>, now: ShopNow, graceMinutes: number): boolean {
  if (a.date !== now.ymd) return a.date < now.ymd && ['Scheduled', 'Confirmed'].includes(String(a.status || 'Scheduled'))
  return ['Scheduled', 'Confirmed'].includes(String(a.status || 'Scheduled')) && now.minutes >= minutesOf(a.time) + graceMinutes
}

/** How many of a customer's recent bookings they missed. Booked means anything that was not cancelled by the shop or customer. */
export function missRate(history: Pick<Slot, 'status'>[]): { missed: number; total: number } {
  const counted = history.filter(a => !['Cancelled', 'Declined', 'Requested'].includes(String(a.status || '')))
  return { missed: counted.filter(a => a.status === 'No Show').length, total: counted.length }
}
