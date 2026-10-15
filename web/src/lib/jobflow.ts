/**
 * The extra facts a repair order carries on the shop board: parts status, labels, estimated hours, the promised time,
 * and what the customer has seen. Plus the words the customer reads on their status page.
 * No imports, so the browser, the server and `node --test` all run the same code.
 */

/* ---------- parts ---------- */

export type PartsStatus = 'none' | 'needed' | 'ordered' | 'partial' | 'in'
export const PARTS_STATUSES: PartsStatus[] = ['none', 'needed', 'ordered', 'partial', 'in']
export const PARTS_WORD: Record<PartsStatus, string> = { none: 'No parts needed', needed: 'Parts to order', ordered: 'Parts on order', partial: 'Some parts in', in: 'Parts in' }
export const PARTS_SHORT: Record<PartsStatus, string> = { none: 'No parts', needed: 'Order parts', ordered: 'On order', partial: 'Some in', in: 'Parts in' }
export type PartsTone = 'off' | 'red' | 'amber' | 'green'
/** The lamp beside the words: red when somebody has to act, amber while waiting, green when the car can be worked on. */
export const PARTS_TONE: Record<PartsStatus, PartsTone> = { none: 'off', needed: 'red', ordered: 'amber', partial: 'amber', in: 'green' }

/* ---------- the stored extras ---------- */

export interface JobFlow {
  job_id: string
  parts: PartsStatus
  parts_note: string
  /** When the parts are due, yyyy-mm-dd. */
  parts_eta: string | null
  labels: string[]
  /** Hours of work the shop expects on this car. */
  est_hours: number | null
  /** Time of day the car is promised, HH:MM, on the day in the job's promise date. */
  promise_time: string | null
  /** A line the customer reads on their status page. */
  public_note: string
  ready_text_at: string | null
  /** Whether a customer status link exists. The link itself is never sent to the board. */
  has_link: boolean
  /** Bumped on every save. A save made from an older copy is refused, so two people cannot silently overwrite each other. */
  version: number
  updated_at: string | null
}

export const MAX_LABELS = 5
export const MAX_LABEL = 24
export const MAX_PARTS_NOTE = 120
export const MAX_PUBLIC_NOTE = 160

const YMD = /^\d{4}-\d{2}-\d{2}$/
const HM = /^([01]\d|2[0-3]):[0-5]\d$/

export function emptyFlow(jobId: string): JobFlow {
  return { job_id: jobId, parts: 'none', parts_note: '', parts_eta: null, labels: [], est_hours: null, promise_time: null, public_note: '', ready_text_at: null, has_link: false, version: 0, updated_at: null }
}

/** "rush", " Rush " and "RUSH" are one label. The first spelling wins. */
export function cleanLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const l of raw) {
    const t = String(l ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL)
    if (!t || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase()); out.push(t)
    if (out.length >= MAX_LABELS) break
  }
  return out
}

export function cleanHoursValue(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.]/g, ''))
  if (!Number.isFinite(n) || n <= 0 || n > 99) return null
  return Math.round(n * 4) / 4 // quarter hours
}

/** Read one stored row. Anything damaged becomes the plain default instead of an error. */
export function flowFrom(r: Record<string, unknown>): JobFlow {
  const parts = PARTS_STATUSES.includes(r.parts as PartsStatus) ? (r.parts as PartsStatus) : 'none'
  return {
    job_id: String(r.job_id ?? ''),
    parts,
    parts_note: String(r.parts_note ?? '').slice(0, MAX_PARTS_NOTE),
    parts_eta: typeof r.parts_eta === 'string' && YMD.test(r.parts_eta.slice(0, 10)) ? r.parts_eta.slice(0, 10) : null,
    labels: cleanLabels(r.labels),
    est_hours: cleanHoursValue(r.est_hours),
    promise_time: typeof r.promise_time === 'string' && HM.test(r.promise_time.slice(0, 5)) ? r.promise_time.slice(0, 5) : null,
    public_note: String(r.public_note ?? '').slice(0, MAX_PUBLIC_NOTE),
    ready_text_at: typeof r.ready_text_at === 'string' && r.ready_text_at ? r.ready_text_at : null,
    has_link: typeof r.status_token === 'string' ? r.status_token.length > 0 : r.has_link === true,
    version: Number.isInteger(r.version) && (r.version as number) >= 0 ? (r.version as number) : 0,
    updated_at: typeof r.updated_at === 'string' ? r.updated_at : null,
  }
}

export type FlowPatch = Partial<Pick<JobFlow, 'parts' | 'parts_note' | 'parts_eta' | 'labels' | 'est_hours' | 'promise_time' | 'public_note'>>

/** What a browser may change. Only these fields, each cleaned. Unknown fields are ignored, never stored. */
export function cleanPatch(raw: unknown): FlowPatch {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const out: FlowPatch = {}
  if ('parts' in o && PARTS_STATUSES.includes(o.parts as PartsStatus)) out.parts = o.parts as PartsStatus
  if ('parts_note' in o) out.parts_note = String(o.parts_note ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_PARTS_NOTE)
  if ('parts_eta' in o) out.parts_eta = typeof o.parts_eta === 'string' && YMD.test(o.parts_eta) ? o.parts_eta : null
  if ('labels' in o) out.labels = cleanLabels(o.labels)
  if ('est_hours' in o) out.est_hours = cleanHoursValue(o.est_hours)
  if ('promise_time' in o) out.promise_time = typeof o.promise_time === 'string' && HM.test(o.promise_time) ? o.promise_time : null
  if ('public_note' in o) out.public_note = String(o.public_note ?? '').replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, MAX_PUBLIC_NOTE)
  return out
}

/* ---------- board settings ---------- */

export type ReadyText = 'ask' | 'auto' | 'off'
export const READY_TEXT_WORD: Record<ReadyText, string> = { ask: 'Ask me each time', auto: 'Send it automatically', off: 'Never text' }

export interface BoardSettings {
  /** The shop's own label list, offered as quick picks on every car. */
  labels: string[]
  readyText: ReadyText
  /** Seconds between refreshes on the shop-wall screen. */
  tvSeconds: number
  /** Show customers' first names on the shop-wall screen. Off by default: anyone in the waiting room can read it. */
  tvNames: boolean
}

export const DEFAULT_LABELS = ['Rush', 'Warranty', 'Insurance', 'Comeback', 'Fleet', 'Sublet']
export const DEFAULT_BOARD: BoardSettings = { labels: DEFAULT_LABELS, readyText: 'ask', tvSeconds: 30, tvNames: false }

export function cleanBoard(raw: unknown): BoardSettings {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const secs = Number(o.tvSeconds)
  return {
    labels: o.labels === undefined ? DEFAULT_LABELS : cleanLabels(o.labels).slice(0, 12),
    readyText: o.readyText === 'auto' || o.readyText === 'off' ? o.readyText : 'ask',
    tvSeconds: Number.isFinite(secs) ? Math.max(10, Math.min(300, Math.round(secs))) : 30,
    tvNames: o.tvNames === true,
  }
}

/* ---------- the promised time ---------- */

export type DueTone = 'late' | 'soon' | 'today' | 'later' | 'none'
export interface Promise { tone: DueTone; text: string; minutesLate: number }

const fmt12 = (t: string) => { const [h, m] = t.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}` }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const shortDay = (ymd: string) => `${MONTHS[Number(ymd.slice(5, 7)) - 1]} ${Number(ymd.slice(8, 10))}`
const utc = (ymd: string) => Date.UTC(+ymd.slice(0, 4), +ymd.slice(5, 7) - 1, +ymd.slice(8, 10))
const dayDiff = (from: string, to: string) => Math.round((utc(to) - utc(from)) / 86_400_000)
const hmin = (t: string) => { const [h, m] = t.split(':').map(Number); return h * 60 + m }

function span(mins: number): string {
  const m = Math.max(1, Math.round(mins))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60), r = m % 60
  if (h >= 24) { const d = Math.floor(h / 24); return `${d} ${d === 1 ? 'day' : 'days'}` }
  return r ? `${h} h ${r} min` : `${h} h`
}

/**
 * When the car was promised, in words, with the lamp that goes with it. `finished` means the car is ready or paid:
 * a finished car is never late.
 */
export function promiseInfo(o: { date: string | null | undefined; time: string | null | undefined; finished: boolean; now: { ymd: string; minutes: number } }): Promise {
  const date = o.date ? String(o.date).slice(0, 10) : ''
  if (!YMD.test(date)) return { tone: 'none', text: '', minutesLate: 0 }
  const time = o.time && HM.test(o.time) ? o.time : null
  const days = dayDiff(o.now.ymd, date)
  if (o.finished) return { tone: 'later', text: days === 0 ? `Promised ${time ? fmt12(time) : 'today'}` : `Promised ${shortDay(date)}`, minutesLate: 0 }
  if (days < 0) {
    const late = -days * 1440 + (time ? o.now.minutes - hmin(time) : o.now.minutes)
    return { tone: 'late', text: `Late: promised ${shortDay(date)}${time ? ` ${fmt12(time)}` : ''}`, minutesLate: Math.max(1, late) }
  }
  if (days === 0) {
    if (!time) return { tone: 'today', text: 'Due today', minutesLate: 0 }
    const left = hmin(time) - o.now.minutes
    if (left < 0) return { tone: 'late', text: `Late: promised ${fmt12(time)} (${span(-left)} ago)`, minutesLate: -left }
    if (left <= 120) return { tone: 'soon', text: `Due in ${span(left)} (${fmt12(time)})`, minutesLate: 0 }
    return { tone: 'today', text: `Due today ${fmt12(time)}`, minutesLate: 0 }
  }
  if (days === 1) return { tone: 'soon', text: `Due tomorrow${time ? ` ${fmt12(time)}` : ''}`, minutesLate: 0 }
  return { tone: 'later', text: `Due ${shortDay(date)}${time ? ` ${fmt12(time)}` : ''}`, minutesLate: 0 }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** The promise as the customer should read it: friendly, and never the word "late". null when nothing was promised or the car is done. */
export function customerPromiseText(o: { date: string | null | undefined; time: string | null | undefined; finished: boolean; now: { ymd: string; minutes: number } }): { text: string; late: boolean } | null {
  const p = promiseInfo(o)
  if (p.tone === 'none' || o.finished) return null
  if (p.tone === 'late') return { text: 'This is taking longer than we promised. Please call us for an update.', late: true }
  const date = String(o.date).slice(0, 10)
  const time = o.time && HM.test(o.time) ? ` by ${fmt12(o.time)}` : ''
  const days = dayDiff(o.now.ymd, date)
  if (days === 0) return { text: `Expected ready today${time}`, late: false }
  if (days === 1) return { text: `Expected ready tomorrow${time}`, late: false }
  const wd = WEEKDAYS[new Date(utc(date)).getUTCDay()]
  return { text: `Expected ready ${wd}, ${shortDay(date)}${time}`, late: false }
}

/** Late first, then soonest. A car with no promise goes last. */
export function promiseSortKey(date: string | null | undefined, time: string | null | undefined): string {
  const d = date ? String(date).slice(0, 10) : '9999-12-31'
  return `${d} ${time && HM.test(time) ? time : '23:59'}`
}

/* ---------- hours on a technician's column ---------- */

export interface HoursSummary {
  /** Hours on every open car for this technician. */
  assigned: number
  /** Hours on cars that are ready for pickup. */
  done: number
  /** Hours still to do: assigned minus done. */
  left: number
  /** Cars with no hours entered, so they are not in the numbers. */
  unknown: number
  /** Share of a day's capacity, when a day's hours are known. */
  dayPct: number | null
}

export function hoursSummary(rows: { hours: number | null; ready: boolean }[], dayHours: number | null): HoursSummary {
  let assigned = 0, done = 0, unknown = 0
  for (const r of rows) {
    if (r.hours === null) { unknown += 1; continue }
    assigned += r.hours
    if (r.ready) done += r.hours
  }
  const left = Math.max(0, assigned - done)
  return { assigned, done, left, unknown, dayPct: dayHours && dayHours > 0 ? Math.round((left / dayHours) * 100) : null }
}

/** 7.5 -> "7.5 h", 8 -> "8 h". */
export const hoursLabel = (h: number): string => `${Number.isInteger(h) ? h : Math.round(h * 100) / 100} h`

/* ---------- markers: what the customer has seen ---------- */

export interface Marker { key: string; icon: 'send' | 'eye' | 'check' | 'message'; word: string; tone: 'quiet' | 'good' | 'attention' }

export interface MarkerInput {
  estimateSentAt?: string | null
  estimateSignedAt?: string | null
  inspection?: { sent: boolean; viewedAt: string | null; answered: boolean; approved?: number } | null
  readyTextAt?: string | null
}

/** The paper plane and the eye: what has gone out to the customer on this car, and what they have done with it. */
export function markersFor(i: MarkerInput): Marker[] {
  const out: Marker[] = []
  if (i.estimateSignedAt) out.push({ key: 'est-signed', icon: 'check', word: 'Estimate approved', tone: 'good' })
  else if (i.estimateSentAt) out.push({ key: 'est-sent', icon: 'send', word: 'Estimate sent', tone: 'quiet' })
  const d = i.inspection
  if (d) {
    if (d.answered) out.push({ key: 'dvi-answered', icon: 'check', word: d.approved ? `Inspection: ${d.approved} approved` : 'Inspection answered', tone: 'good' })
    else if (d.viewedAt) out.push({ key: 'dvi-viewed', icon: 'eye', word: 'Inspection viewed', tone: 'attention' })
    else if (d.sent) out.push({ key: 'dvi-sent', icon: 'send', word: 'Inspection sent', tone: 'quiet' })
  }
  if (i.readyTextAt) out.push({ key: 'ready-text', icon: 'message', word: 'Ready text sent', tone: 'quiet' })
  return out
}

/* ---------- the text to the customer ---------- */

const firstOf = (name: string) => String(name || '').replace(/^\s*walk-?\s?in\s*[:-]\s*/i, '').trim().split(/\s+/)[0] || ''

export function readyTextBody(o: { customer: string; car: string; shop: string; phone: string; statusUrl?: string | null }): string {
  const first = firstOf(o.customer)
  const lines = [`${first ? `Hi ${first}, your` : 'Your'} ${o.car || 'vehicle'} is ready for pickup at ${o.shop || 'our shop'}.`]
  if (o.statusUrl) lines.push(`Details: ${o.statusUrl}`)
  lines.push(o.phone ? `Questions? Call ${o.phone}.` : 'Reply to this text with any questions.')
  return lines.join('\n')
}

/** A status link the shop sends on its own: "Here is where your car stands". */
export function statusTextBody(o: { customer: string; car: string; shop: string; statusUrl: string }): string {
  const first = firstOf(o.customer)
  return `${first ? `Hi ${first}, you` : 'You'} can follow the work on your ${o.car || 'vehicle'} at ${o.shop || 'our shop'} here: ${o.statusUrl}`
}

/* ---------- the customer's own page ---------- */

export type PublicStep = 'in' | 'approved' | 'working' | 'ready' | 'done'
export const PUBLIC_STEPS: { key: PublicStep; word: string }[] = [
  { key: 'in', word: 'Checked in' },
  { key: 'approved', word: 'Approved' },
  { key: 'working', word: 'In the shop' },
  { key: 'ready', word: 'Ready for pickup' },
]

export interface PublicStatus {
  step: PublicStep
  /** The one line the customer reads at the top. */
  headline: string
  /** A second line, when the status needs more than the headline. */
  detail: string
  waiting: 'parts' | 'you' | null
}

/** Maps the shop's own statuses to words a customer understands. Money and internal notes are never involved. */
export function publicStatusOf(status: string, parts: PartsStatus = 'none'): PublicStatus {
  switch (status) {
    case 'Approved': return { step: 'approved', headline: 'Approved. Waiting for a technician.', detail: 'We will start as soon as a technician is free.', waiting: null }
    case 'In Progress':
    case 'In Repair': return { step: 'working', headline: 'Your car is being worked on.', detail: '', waiting: null }
    case 'Waiting on Parts': return { step: 'working', headline: 'Waiting on parts.', detail: parts === 'ordered' || parts === 'partial' ? 'The parts are on order.' : 'We are getting the parts for your car.', waiting: 'parts' }
    case 'Waiting on Customer': return { step: 'working', headline: 'We need to hear from you.', detail: 'Please call or text the shop so we can keep going.', waiting: 'you' }
    case 'Supplement': return { step: 'working', headline: 'Waiting on an approval.', detail: 'We found more work and are waiting for the go-ahead.', waiting: 'you' }
    case 'Completed':
    case 'Ready for Pickup': return { step: 'ready', headline: 'Your car is ready for pickup.', detail: '', waiting: null }
    case 'Paid':
    case 'Closed': return { step: 'done', headline: 'All done. Thank you.', detail: '', waiting: null }
    default: return { step: 'in', headline: 'We have your car.', detail: 'Your estimate is being put together.', waiting: null }
  }
}

/** "2018 Toyota Camry": year, make and model only. The plate, VIN and color are never on the public page. */
export function carWords(j: { vehicle_year?: unknown; vehicle_make?: unknown; vehicle_model?: unknown }): string {
  return [j.vehicle_year, j.vehicle_make, j.vehicle_model].map(v => String(v ?? '').trim()).filter(Boolean).join(' ').slice(0, 80)
}
