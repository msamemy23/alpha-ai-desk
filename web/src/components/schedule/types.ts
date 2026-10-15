// Shared types and date helpers for the Schedule screen.
// Dates are yyyy-mm-dd and times are HH:MM, both in the shop's own clock (never UTC).

export interface Appointment {
  id: string
  customer_id: string | null
  customer_name: string
  phone: string
  vehicle: string
  service: string
  tech: string
  date: string
  time: string
  duration: number
  status: string
  notes: string
  created_at?: string
  /** Drop-off or waiting, and the bay (migration 050). Absent until that migration is applied. */
  kind?: 'dropoff' | 'wait' | null
  bay?: string | null
  /** 'online' for a booking made on the public page. */
  source?: string | null
  reminder_sent_at?: string | null
}

export interface ApptCustomer {
  id: string; name: string; phone: string
  vehicle_year: string; vehicle_make: string; vehicle_model: string
}

export const STATUSES = ['Requested', 'Scheduled', 'Confirmed', 'In Progress', 'Completed', 'Cancelled', 'No Show', 'Declined'] as const

export type Lamp = 'green' | 'amber' | 'red' | 'blue' | 'off'

export function statusLamp(s: string): Lamp {
  switch (s) {
    case 'Confirmed': return 'green'
    case 'Completed': return 'green'
    case 'In Progress': return 'blue'
    case 'No Show': return 'amber'
    case 'Requested': return 'amber'
    case 'Cancelled': return 'off'
    case 'Declined': return 'off'
    default: return 'off'
  }
}

export function statusWord(s: string): string {
  switch (s) {
    case 'In Progress': return 'In the shop'
    case 'Completed': return 'Done'
    case 'No Show': return 'No show'
    case 'Declined': return 'Declined'
    default: return s || 'Scheduled'
  }
}

export const isClosed = (s: string) => s === 'Cancelled' || s === 'Completed' || s === 'No Show' || s === 'Declined'

export const DURATIONS = [
  { m: 30, label: '30 minutes' },
  { m: 60, label: '1 hour' },
  { m: 90, label: '1 hour 30 minutes' },
  { m: 120, label: '2 hours' },
  { m: 180, label: '3 hours' },
  { m: 240, label: '4 hours' },
  { m: 480, label: 'All day' },
]

export function durationLabel(m: number): string {
  const hit = DURATIONS.find(d => d.m === m)
  if (hit) return hit.label
  if (m < 60) return `${m} minutes`
  const h = Math.floor(m / 60), r = m % 60
  return r ? `${h} h ${r} min` : `${h} hour${h === 1 ? '' : 's'}`
}

/** Start times offered in the form, every 30 minutes from 6:00 to 19:00. */
export const TIMES: string[] = Array.from({ length: 27 }, (_, i) => {
  const mins = 6 * 60 + i * 30
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
})

/* ---------- dates ---------- */

export function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  x.setDate(x.getDate() + n)
  return x
}

/** The Monday of the week that contains d. */
export function startOfWeek(d: Date): Date {
  return addDays(d, -((d.getDay() + 6) % 7))
}

export function dayLong(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}
export function dayShort(d: Date): string {
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export function weekRange(monday: Date): string {
  const sun = addDays(monday, 6)
  const a = monday.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const b = sun.toLocaleDateString('en-US', { month: monday.getMonth() === sun.getMonth() ? undefined : 'short', day: 'numeric' })
  return `${a} to ${b}`
}

/* ---------- times ---------- */

/** Postgres may hand back 09:00:00; the app works in HH:MM. */
export const hhmm = (t: string | null | undefined) => String(t || '').slice(0, 5)

export function toMin(t: string): number {
  const [h, m] = hhmm(t).split(':').map(Number)
  return (h || 0) * 60 + (m || 0)
}

export function fromMin(mins: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 1, mins))
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

export function fmtTime(t: string): string {
  if (!t) return ''
  const [h, m] = hhmm(t).split(':').map(Number)
  const ap = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ap}`
}

/** 8:00 without AM/PM, for tight spots where the hour labels already say which half of the day it is. */
export function fmtTimeShort(t: string): string {
  if (!t) return ''
  const [h, m] = hhmm(t).split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')}`
}

export const endOf = (a: Pick<Appointment, 'time' | 'duration'>) => toMin(a.time) + (Number(a.duration) > 0 ? Number(a.duration) : 60)

export function timeRange(a: Pick<Appointment, 'time' | 'duration'>): string {
  return `${fmtTime(a.time)} to ${fmtTime(fromMin(endOf(a)))}`
}

export function overlaps(a: Appointment, b: Appointment): boolean {
  return a.date === b.date && toMin(a.time) < endOf(b) && toMin(b.time) < endOf(a)
}

/** Side by side lanes for appointments that overlap in one column. */
export function layoutLanes(items: Appointment[]): Map<string, { lane: number; lanes: number }> {
  const out = new Map<string, { lane: number; lanes: number }>()
  const sorted = [...items].sort((a, b) => toMin(a.time) - toMin(b.time) || endOf(b) - endOf(a))
  let group: Appointment[] = []
  let groupEnd = -1
  const flush = () => {
    const laneEnds: number[] = []
    const assigned: { a: Appointment; lane: number }[] = []
    for (const a of group) {
      let lane = laneEnds.findIndex(e => e <= toMin(a.time))
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0) }
      laneEnds[lane] = endOf(a)
      assigned.push({ a, lane })
    }
    for (const { a, lane } of assigned) out.set(a.id, { lane, lanes: laneEnds.length })
    group = []
  }
  for (const a of sorted) {
    if (group.length && toMin(a.time) >= groupEnd) { flush(); groupEnd = -1 }
    group.push(a)
    groupEnd = Math.max(groupEnd, endOf(a))
  }
  if (group.length) flush()
  return out
}

export const byTime = (a: Appointment, b: Appointment) => a.date.localeCompare(b.date) || toMin(a.time) - toMin(b.time)

export function firstName(name: string): string {
  // Walk-ins are booked as "Walk-in: Eddie"; the person's name is the part after the label.
  const clean = String(name || '').replace(/^\s*walk-?\s?in\s*[:\-]\s*/i, '').trim()
  return clean.split(/\s+/)[0] || String(name || '').trim().split(/\s+/)[0] || ''
}

/** Two letters for the narrowest calendar cards, e.g. "Dana Ortiz" gives "DO". */
export function initials(name: string): string {
  const clean = String(name || '').replace(/^\s*walk-?\s?in\s*[:\-]\s*/i, '').trim()
  const parts = clean.split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}
