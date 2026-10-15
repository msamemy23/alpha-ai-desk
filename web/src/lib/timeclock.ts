/**
 * Time clock rules shared by the Team screen, the Shop board and the /api/timeclock route.
 * It imports nothing, so the same code runs in the browser, on the server and under `node --test`.
 * Keep it to plain TypeScript (no enums, no parameter properties) so node can run it directly.
 */

export interface ClockEntry {
  id: number
  staff_id: number | null
  staff_name: string
  /** ISO timestamps. */
  clock_in: string
  clock_out: string | null
  hours_worked: number | null
  note: string | null
  /** Present only once migration 035 is applied. */
  break_minutes?: number | null
  break_started_at?: string | null
}

export interface Person {
  id: number
  name: string
  role: string
  active: boolean
}

export const MIN = 60_000
export const HOUR_MS = 3_600_000
/** One entry may not run longer than a day: a longer one is almost always a forgotten clock-out. */
export const MAX_SHIFT_MIN = 24 * 60
/** Still clocked in after this long counts as "probably forgot to clock out". */
export const STALE_OPEN_MS = 16 * HOUR_MS
export const OVERTIME_MIN = 40 * 60
/** A little slack so a phone clock that runs a minute fast does not reject a punch made right now. */
const FUTURE_SLACK_MS = 5 * MIN

/* ---------- roles ---------- */

export const ROLES: { value: string; label: string }[] = [
  { value: 'technician', label: 'Technician' },
  { value: 'advisor', label: 'Service advisor' },
  { value: 'manager', label: 'Manager' },
  { value: 'parts', label: 'Parts' },
  { value: 'employee', label: 'Other' },
]

/** Older screens wrote "service_advisor" and "advisor". Both mean the same job. Anything unknown comes back as ''. */
export function normalizeRole(role: unknown): string {
  const r = String(role ?? '').trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (r === 'service_advisor' || r === 'advisor') return 'advisor'
  return ROLES.some(x => x.value === r) ? r : ''
}

export function roleLabel(role: unknown): string {
  const n = normalizeRole(role)
  const hit = ROLES.find(x => x.value === n)
  if (hit) return hit.label
  const raw = String(role ?? '').trim().replace(/_/g, ' ')
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase() : 'Team member'
}

export const isTechnician = (role: unknown) => normalizeRole(role) === 'technician'

export function initials(name: string): string {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0].charAt(0)
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : ''
  return (first + last).toUpperCase()
}

/* ---------- days and weeks (always the shop's local calendar) ---------- */

const pad = (n: number) => String(n).padStart(2, '0')

export function dayKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function parseDayKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

/** Calendar math through the Date constructor, so a week that crosses daylight saving still has seven days. */
export function addDaysKey(key: string, n: number): string {
  const d = parseDayKey(key)
  return dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n))
}

/** From local midnight of the first day up to (not including) local midnight after the last day, as ISO instants. */
export function dayRange(firstKey: string, lastKey: string): { from: string; to: string } {
  return { from: parseDayKey(firstKey).toISOString(), to: parseDayKey(addDaysKey(lastKey, 1)).toISOString() }
}

/** Weeks run Monday to Sunday. */
export function weekStartKey(d: Date = new Date()): string {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  return dayKey(new Date(x.getFullYear(), x.getMonth(), x.getDate() - ((x.getDay() + 6) % 7)))
}

export const weekKeys = (startKey: string): string[] => Array.from({ length: 7 }, (_, i) => addDaysKey(startKey, i))

export function dayLabel(key: string, style: 'short' | 'long' | 'weekday' = 'short'): string {
  const d = parseDayKey(key)
  if (style === 'weekday') return d.toLocaleDateString('en-US', { weekday: 'short' })
  if (style === 'long') return d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

export function weekLabel(startKey: string): string {
  const a = parseDayKey(startKey)
  const b = parseDayKey(addDaysKey(startKey, 6))
  const sameMonth = a.getMonth() === b.getMonth()
  const left = a.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const right = sameMonth ? String(b.getDate()) : b.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${left} to ${right}, ${b.getFullYear()}`
}

/* ---------- clock times ---------- */

/** "8:02 AM". Built by hand because the browser's own formatter now puts a non-breaking space before AM. */
export function fmtTimeOfDay(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const h = d.getHours()
  return `${h % 12 || 12}:${pad(d.getMinutes())} ${h >= 12 ? 'PM' : 'AM'}`
}

export const entryDay = (e: Pick<ClockEntry, 'clock_in'>): string => dayKey(new Date(e.clock_in))

/** "7h 42m", "42m", "0m". */
export function fmtDuration(min: number): string {
  const t = Math.round(min)
  if (!(t > 0)) return '0m'
  const h = Math.floor(t / 60)
  const m = t % 60
  return h ? (m ? `${h}h ${m}m` : `${h}h`) : `${m}m`
}

/** "7:42", for narrow timesheet cells. */
export function fmtClock(min: number): string {
  const t = Math.max(0, Math.round(min))
  return `${Math.floor(t / 60)}:${pad(t % 60)}`
}

/** Hours as a payroll number: 7.70. */
export const decimalHours = (min: number): number => Math.round((Math.max(0, min) / 60) * 100) / 100

/** For <input type="datetime-local">. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '' : `${dayKey(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fromLocalInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null
  const d = new Date(value)
  return isNaN(d.getTime()) ? null : d.toISOString()
}

/* ---------- hours ---------- */

export const onBreak = (e: Pick<ClockEntry, 'clock_out' | 'break_started_at'>): boolean => !e.clock_out && !!e.break_started_at

export function breakMinutes(e: ClockEntry, nowMs: number): number {
  const done = Math.max(0, Number(e.break_minutes) || 0)
  if (onBreak(e)) {
    const started = Date.parse(String(e.break_started_at))
    if (!isNaN(started)) return done + Math.max(0, (nowMs - started) / MIN)
  }
  return done
}

/** Still clocked in after 16 hours: almost certainly a forgotten clock-out. */
export function isStale(e: Pick<ClockEntry, 'clock_in' | 'clock_out'>, nowMs: number): boolean {
  if (e.clock_out) return false
  const start = Date.parse(e.clock_in)
  return !isNaN(start) && nowMs - start > STALE_OPEN_MS
}

/** Still clocked in after a full day: too long to be a real shift, so it can only be fixed, not clocked out. */
export function isOverlong(e: Pick<ClockEntry, 'clock_in' | 'clock_out'>, nowMs: number): boolean {
  if (e.clock_out) return false
  const start = Date.parse(e.clock_in)
  return !isNaN(start) && (nowMs - start) / MIN > MAX_SHIFT_MIN
}

/**
 * Minutes on the job: time between punches minus breaks. A running entry counts up to now.
 * A forgotten clock-out counts as nothing until someone fixes it, so it can never pad a payroll total by days.
 */
export function workedMinutes(e: ClockEntry, nowMs: number): number {
  if (isStale(e, nowMs)) return 0
  const start = Date.parse(e.clock_in)
  const end = e.clock_out ? Date.parse(e.clock_out) : nowMs
  if (isNaN(start) || isNaN(end)) return 0
  return Math.max(0, (end - start) / MIN - breakMinutes(e, nowMs))
}

/** The number saved in hours_worked when an entry closes. */
export function hoursFor(clockIn: string, clockOut: string, breakMin = 0): number {
  const mins = (Date.parse(clockOut) - Date.parse(clockIn)) / MIN - Math.max(0, breakMin)
  return Math.round((Math.max(0, mins) / 60) * 100) / 100
}

export const overtimeMinutes = (totalMin: number): number => Math.max(0, totalMin - OVERTIME_MIN)

/** Rows from the API arrive with loose types; this makes them safe to do math on. */
export function normalizeEntry(raw: Record<string, unknown>): ClockEntry {
  return {
    id: Number(raw.id),
    staff_id: raw.staff_id == null || raw.staff_id === '' ? null : Number(raw.staff_id),
    staff_name: String(raw.staff_name ?? ''),
    clock_in: String(raw.clock_in ?? ''),
    clock_out: raw.clock_out ? String(raw.clock_out) : null,
    hours_worked: raw.hours_worked == null ? null : Number(raw.hours_worked),
    note: raw.note == null ? null : String(raw.note),
    break_minutes: raw.break_minutes == null ? undefined : Number(raw.break_minutes),
    break_started_at: raw.break_started_at ? String(raw.break_started_at) : null,
  }
}

/* ---------- whose entry is it ---------- */

/** New entries carry the person's id. Old ones only have a name, so those are matched by name. */
export function entriesFor(entries: ClockEntry[], p: Pick<Person, 'id' | 'name'>): ClockEntry[] {
  const name = p.name.trim().toLowerCase()
  return entries.filter(e => (e.staff_id != null ? e.staff_id === p.id : e.staff_name.trim().toLowerCase() === name))
}

export function openEntry(entries: ClockEntry[], p: Pick<Person, 'id' | 'name'>): ClockEntry | null {
  const open = entriesFor(entries, p).filter(e => !e.clock_out)
  open.sort((a, b) => Date.parse(b.clock_in) - Date.parse(a.clock_in))
  return open[0] || null
}

export type ClockState = 'in' | 'break' | 'out'

export interface ClockStatus {
  state: ClockState
  entry: ClockEntry | null
  /** Still clocked in from long ago. Almost always a missed clock-out. */
  stale: boolean
  /** Open for more than 24 hours. Clock-out is refused until a manager fixes the entry. */
  overlong: boolean
}

export function statusOf(entries: ClockEntry[], p: Pick<Person, 'id' | 'name'>, nowMs: number): ClockStatus {
  const entry = openEntry(entries, p)
  if (!entry) return { state: 'out', entry: null, stale: false, overlong: false }
  return { state: onBreak(entry) ? 'break' : 'in', entry, stale: isStale(entry, nowMs), overlong: isOverlong(entry, nowMs) }
}

/** Minutes worked on one calendar day, counting each entry on the day it started. */
export function minutesOnDay(list: ClockEntry[], key: string, nowMs: number): number {
  return list.reduce((sum, e) => (entryDay(e) === key ? sum + workedMinutes(e, nowMs) : sum), 0)
}

export function minutesInDays(list: ClockEntry[], keys: string[], nowMs: number): number {
  const set = new Set(keys)
  return list.reduce((sum, e) => (set.has(entryDay(e)) ? sum + workedMinutes(e, nowMs) : sum), 0)
}

/* ---------- checking an entry before it is saved (browser and server use the same rules) ---------- */

export interface EntryInput { clock_in: string | null; clock_out: string | null }

export function validateEntry(
  input: EntryInput,
  opts: { nowMs: number; others: Pick<ClockEntry, 'id' | 'clock_in' | 'clock_out'>[]; selfId?: number | null; allowOpen?: boolean },
): string {
  const start = input.clock_in ? Date.parse(input.clock_in) : NaN
  if (isNaN(start)) return 'Enter a valid clock-in time.'
  const end = input.clock_out ? Date.parse(input.clock_out) : null
  if (input.clock_out && (end === null || isNaN(end))) return 'Enter a valid clock-out time.'
  if (end === null && !opts.allowOpen) return 'Enter a clock-out time.'
  if (start > opts.nowMs + FUTURE_SLACK_MS) return 'Clock-in cannot be in the future.'
  if (end !== null) {
    if (end > opts.nowMs + FUTURE_SLACK_MS) return 'Clock-out cannot be in the future.'
    if (end <= start) return 'Clock-out must be after clock-in.'
    if ((end - start) / MIN > MAX_SHIFT_MIN) return 'One entry cannot be longer than 24 hours. Split it into two entries.'
  }
  const myEnd = end === null ? opts.nowMs : end
  for (const o of opts.others) {
    if (opts.selfId != null && o.id === opts.selfId) continue
    const os = Date.parse(o.clock_in)
    if (isNaN(os)) continue
    const oe = o.clock_out ? Date.parse(o.clock_out) : opts.nowMs
    if (start < oe && myEnd > os) {
      const when = `${dayLabel(dayKey(new Date(os)))}, ${fmtTimeOfDay(o.clock_in)} to ${o.clock_out ? fmtTimeOfDay(o.clock_out) : 'now'}`
      return `This overlaps another entry (${when}). Change the times or edit that entry first.`
    }
  }
  return ''
}

/* ---------- why an entry was changed ---------- */

export const NOTE_MANUAL = 'Manual entry: '
export const NOTE_EDITED = 'Edited: '

export type NoteKind = 'manual' | 'edited' | null

export function noteKind(note: string | null | undefined): NoteKind {
  const n = String(note || '')
  if (n.startsWith(NOTE_MANUAL)) return 'manual'
  if (n.startsWith(NOTE_EDITED)) return 'edited'
  return null
}

export function noteText(note: string | null | undefined): string {
  const n = String(note || '')
  const k = noteKind(n)
  return k === 'manual' ? n.slice(NOTE_MANUAL.length) : k === 'edited' ? n.slice(NOTE_EDITED.length) : n
}

export const stampNote = (kind: 'manual' | 'edited', reason: string): string => (kind === 'manual' ? NOTE_MANUAL : NOTE_EDITED) + reason.trim()

/* ---------- the file for payroll ---------- */

/** A cell that starts with = + - or @ would run as a formula when opened in a spreadsheet. A leading quote keeps it text. */
function csvCell(v: unknown): string {
  let s = String(v ?? '')
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function timesheetCsv(people: Person[], entries: ClockEntry[], nowMs: number): string {
  const head = ['Name', 'Role', 'Date', 'Clock in', 'Clock out', 'Break minutes', 'Hours', 'Note']
  const lines = [head.map(csvCell).join(',')]
  const sorted = [...people].sort((a, b) => a.name.localeCompare(b.name))
  for (const p of sorted) {
    const mine = entriesFor(entries, p).sort((a, b) => Date.parse(a.clock_in) - Date.parse(b.clock_in))
    for (const e of mine) {
      lines.push([
        p.name, roleLabel(p.role), entryDay(e), fmtTimeOfDay(e.clock_in), e.clock_out ? fmtTimeOfDay(e.clock_out) : 'Still clocked in',
        Math.round(breakMinutes(e, nowMs)), decimalHours(workedMinutes(e, nowMs)).toFixed(2), noteText(e.note),
      ].map(csvCell).join(','))
    }
  }
  return lines.join('\r\n') + '\r\n'
}
