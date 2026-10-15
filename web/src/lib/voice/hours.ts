/**
 * Shop hours, quiet hours and open appointment times.
 *
 * Everything is computed on the shop's own wall clock (its saved time zone), never on the server's clock.
 * Pure TypeScript with only relative imports, so `node --test` can run it directly.
 */
import { DAY_KEYS, DAY_LABELS } from './rules.ts'
import type { DayKey, VoiceRules, WeekHours } from './rules.ts'

const JS_DAY: DayKey[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

export function safeTimeZone(tz: unknown): string {
  const candidate = typeof tz === 'string' && tz.trim() ? tz.trim() : 'America/Chicago'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate }).format(new Date(0))
    return candidate
  } catch {
    return 'America/Chicago'
  }
}

export interface WallClock {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  weekday: DayKey
  /** yyyy-mm-dd on the shop's clock */
  ymd: string
  /** Minutes since midnight on the shop's clock */
  minutes: number
}

export function wallClock(date: Date, tz: string): WallClock {
  const zone = safeTimeZone(tz)
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(date)
  const v: Record<string, string> = {}
  for (const p of parts) v[p.type] = p.value
  const year = Number(v.year)
  const month = Number(v.month)
  const day = Number(v.day)
  const hour = Number(v.hour) % 24
  const minute = Number(v.minute)
  const idx = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].indexOf(String(v.weekday).slice(0, 3).toLowerCase())
  const weekday = JS_DAY[idx < 0 ? 1 : idx]
  const pad = (n: number) => String(n).padStart(2, '0')
  return { year, month, day, hour, minute, weekday, ymd: `${year}-${pad(month)}-${pad(day)}`, minutes: hour * 60 + minute }
}

export function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/** "13:30" becomes "1:30 PM". */
export function fmt12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`
}

function dayNumber(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86_400_000)
}

function ymdFromDayNumber(n: number): string {
  const d = new Date(n * 86_400_000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

function weekdayOf(ymd: string): DayKey {
  return JS_DAY[new Date(dayNumber(ymd) * 86_400_000).getUTCDay()]
}

/** "Mon to Fri 8:00 AM to 5:00 PM, Sat 9:00 AM to 1:00 PM, Sun closed". Empty when hours are not set. */
export function hoursSummary(hours: WeekHours | null): string {
  if (!hours) return ''
  const label = (k: DayKey) => DAY_LABELS[k].slice(0, 3)
  const groups: { days: DayKey[]; text: string }[] = []
  for (const k of DAY_KEYS) {
    const h = hours[k]
    const text = h.open ? `${fmt12(h.from)} to ${fmt12(h.to)}` : 'closed'
    const last = groups[groups.length - 1]
    if (last && last.text === text) last.days.push(k)
    else groups.push({ days: [k], text })
  }
  return groups.map(g => {
    const days = g.days.length === 1 ? label(g.days[0]) : g.days.length === 2 ? `${label(g.days[0])} and ${label(g.days[1])}` : `${label(g.days[0])} to ${label(g.days[g.days.length - 1])}`
    return `${days} ${g.text}`
  }).join(', ')
}

export interface OpenState {
  /** False when the shop has not saved its hours: the assistant must not guess. */
  known: boolean
  open: boolean
  /** Why the shop is closed right now, in words. */
  reason: 'hours_unset' | 'open' | 'before_open' | 'after_close' | 'closed_day' | 'closed_date'
  closesAt: string
  /** For example "today at 8:00 AM", "tomorrow at 8:00 AM" or "Monday at 8:00 AM". Empty when unknown. */
  nextOpen: string
}

export function openState(hours: WeekHours | null, closedDates: string[], tz: string, now: Date): OpenState {
  if (!hours || !DAY_KEYS.some(k => hours[k].open)) return { known: false, open: false, reason: 'hours_unset', closesAt: '', nextOpen: '' }
  const wall = wallClock(now, tz)
  const today = hours[wall.weekday]
  const closedToday = closedDates.includes(wall.ymd)
  let open = false
  let reason: OpenState['reason'] = 'closed_day'
  let closesAt = ''
  if (closedToday) reason = 'closed_date'
  else if (!today.open) reason = 'closed_day'
  else if (wall.minutes < minutesOf(today.from)) reason = 'before_open'
  else if (wall.minutes >= minutesOf(today.to)) reason = 'after_close'
  else { open = true; reason = 'open'; closesAt = fmt12(today.to) }

  let nextOpen = ''
  if (!open) {
    const base = dayNumber(wall.ymd)
    for (let i = 0; i < 15; i++) {
      const ymd = ymdFromDayNumber(base + i)
      if (closedDates.includes(ymd)) continue
      const h = hours[weekdayOf(ymd)]
      if (!h.open) continue
      if (i === 0 && wall.minutes >= minutesOf(h.from)) continue
      const when = i === 0 ? 'today' : i === 1 ? 'tomorrow' : DAY_LABELS[weekdayOf(ymd)]
      nextOpen = `${when} at ${fmt12(h.from)}`
      break
    }
  }
  return { known: true, open, reason, closesAt, nextOpen }
}

/** True when the clock is inside the quiet window, which may run past midnight (21:00 to 08:00). */
export function inQuietHours(quiet: { enabled: boolean; from: string; to: string }, tz: string, now: Date): boolean {
  if (!quiet.enabled || quiet.from === quiet.to) return false
  const m = wallClock(now, tz).minutes
  const from = minutesOf(quiet.from)
  const to = minutesOf(quiet.to)
  return from < to ? m >= from && m < to : m >= from || m < to
}

export interface BookedAppointment { date?: string | null; time?: string | null; duration?: number | string | null; status?: string | null }
export interface OpenSlot { date: string; time: string; label: string }

const FREE_STATUSES = new Set(['cancelled', 'canceled', 'no show', 'no-show'])

export function slotLabel(date: string, time: string): string {
  const d = new Date(dayNumber(date) * 86_400_000)
  const day = d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })
  return `${day} at ${fmt12(time)}`
}

export interface SlotOptions {
  rules: Pick<VoiceRules, 'hours' | 'closed_dates' | 'booking_slot_minutes' | 'booking_capacity' | 'booking_lead_hours'>
  tz: string
  now: Date
  appointments: BookedAppointment[]
  days?: number
  limit?: number
  /** Spread offers over different days so the caller sees real choice. */
  perDay?: number
}

/**
 * The next open times a caller can be offered. A time is open when it is inside the shop's hours, on a day the shop is not
 * closed, far enough ahead (lead hours), and fewer than `capacity` booked appointments overlap it.
 */
export function findOpenSlots(opts: SlotOptions): OpenSlot[] {
  const { rules, tz, now, appointments } = opts
  const hours = rules.hours
  if (!hours) return []
  const days = opts.days ?? 10
  const limit = opts.limit ?? 3
  const perDay = opts.perDay ?? 2
  const slot = rules.booking_slot_minutes
  const wall = wallClock(now, tz)
  const earliest = dayNumber(wall.ymd) * 1440 + wall.minutes + rules.booking_lead_hours * 60
  const busy: { start: number; end: number }[] = []
  for (const a of appointments) {
    if (!a.date || !a.time || !/^\d{4}-\d{2}-\d{2}$/.test(String(a.date)) || !/^\d{1,2}:\d{2}/.test(String(a.time))) continue
    if (FREE_STATUSES.has(String(a.status || '').trim().toLowerCase())) continue
    const [hh, mm] = String(a.time).split(':').map(Number)
    const dur = Number(a.duration) > 0 ? Number(a.duration) : 60
    const start = dayNumber(String(a.date)) * 1440 + hh * 60 + mm
    busy.push({ start, end: start + dur })
  }
  const out: OpenSlot[] = []
  for (let i = 0; i < days && out.length < limit; i++) {
    const ymd = ymdFromDayNumber(dayNumber(wall.ymd) + i)
    if (rules.closed_dates.includes(ymd)) continue
    const h = hours[weekdayOf(ymd)]
    if (!h.open) continue
    const open = minutesOf(h.from)
    const close = minutesOf(h.to)
    let taken = 0
    for (let t = open; t + slot <= close && taken < perDay && out.length < limit; t += slot) {
      const start = dayNumber(ymd) * 1440 + t
      if (start < earliest) continue
      const overlapping = busy.filter(b => b.start < start + slot && b.end > start).length
      if (overlapping >= rules.booking_capacity) continue
      const time = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
      out.push({ date: ymd, time, label: slotLabel(ymd, time) })
      taken++
    }
  }
  return out
}

/** True when this exact date and time is still open (used right before a booking is saved). */
export function isSlotOpen(opts: SlotOptions, date: string, time: string): boolean {
  const all = findOpenSlots({ ...opts, days: 30, limit: 1000, perDay: 1000 })
  return all.some(s => s.date === date && s.time === time)
}
