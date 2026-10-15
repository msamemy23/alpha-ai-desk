/**
 * The shop's pay-week and overtime rules, and the maths that turns a week of daily minutes into regular, overtime and
 * double-time minutes. It imports only the day helpers from timeclock.ts, so it runs in the browser, on the server and
 * under `node --test`. Keep it to plain TypeScript (no enums, no parameter properties).
 */
import { addDaysKey, dayKey, parseDayKey, weekStartKey } from './timeclock.ts'

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export type LocationMode = 'off' | 'record' | 'require'

export interface TimeRules {
  /** First day of the pay week: 0 is Sunday, 1 Monday, up to 6 Saturday. */
  weekStart: number
  /** One week or two weeks per pay period. Overtime is always worked out one week at a time. */
  periodDays: 7 | 14
  /** A day that starts a pay period (yyyy-mm-dd). Only used for two-week periods. Empty means no choice has been made yet. */
  periodAnchor: string
  /** Minutes in a week before overtime starts. null means weekly overtime is off. */
  weeklyOtMin: number | null
  /** Minutes in one day before overtime starts. null means no daily overtime. */
  dailyOtMin: number | null
  /** Minutes in one day before double time starts. null means no double time. */
  dailyDoubleMin: number | null
  /** A two-letter state code the rules were started from, or ''. */
  state: string
  locationMode: LocationMode
  /** Where the shop is, for the location check. Null until the owner saves it from a device at the shop. */
  geofence: { lat: number; lng: number; radiusM: number } | null
  /** The kiosk asks for a PIN before it clocks anyone in or out. */
  requirePin: boolean
}

export const DEFAULT_RULES: TimeRules = {
  weekStart: 1,
  periodDays: 7,
  periodAnchor: '',
  weeklyOtMin: 40 * 60,
  dailyOtMin: null,
  dailyDoubleMin: null,
  state: '',
  locationMode: 'off',
  geofence: null,
  requirePin: true,
}

/* ---------- starting points by state ---------- */

export interface Preset {
  key: string
  label: string
  /** One plain line about what the rule does. */
  note: string
  weeklyOtMin: number | null
  dailyOtMin: number | null
  dailyDoubleMin: number | null
}

export const PRESETS: Preset[] = [
  { key: 'federal', label: 'Weekly overtime over 40 hours', note: 'The federal rule, which most states follow.', weeklyOtMin: 2400, dailyOtMin: null, dailyDoubleMin: null },
  { key: 'daily8', label: 'Daily overtime over 8 hours, and weekly over 40', note: 'Used in Alaska. California adds double time, see below.', weeklyOtMin: 2400, dailyOtMin: 480, dailyDoubleMin: null },
  { key: 'daily8dt12', label: 'Daily overtime over 8, double time over 12, weekly over 40', note: 'The California daily rule. It also has a seventh-day rule that this does not apply.', weeklyOtMin: 2400, dailyOtMin: 480, dailyDoubleMin: 720 },
  { key: 'daily12', label: 'Daily overtime over 12 hours, and weekly over 40', note: 'The Colorado rule.', weeklyOtMin: 2400, dailyOtMin: 720, dailyDoubleMin: null },
  { key: 'none', label: 'No overtime', note: 'Hours are counted straight. Use this only if your payroll provider handles overtime.', weeklyOtMin: null, dailyOtMin: null, dailyDoubleMin: null },
]

/** The starting rule for a state. Any state not listed uses the federal weekly rule. It is a starting point, never legal advice. */
const STATE_PRESET: Record<string, string> = { CA: 'daily8dt12', AK: 'daily8', CO: 'daily12' }

export function presetForState(state: string): Preset {
  const key = STATE_PRESET[String(state || '').trim().toUpperCase()] || 'federal'
  return PRESETS.find(p => p.key === key) as Preset
}

/** Which preset the numbers match, or 'custom'. */
export function presetKeyOf(r: Pick<TimeRules, 'weeklyOtMin' | 'dailyOtMin' | 'dailyDoubleMin'>): string {
  const hit = PRESETS.find(p => p.weeklyOtMin === r.weeklyOtMin && p.dailyOtMin === r.dailyOtMin && p.dailyDoubleMin === r.dailyDoubleMin)
  return hit ? hit.key : 'custom'
}

export const US_STATES: { code: string; name: string }[] = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'],
  ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'],
  ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'],
  ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
  ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
  ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'],
].map(([code, name]) => ({ code, name }))

/* ---------- reading rules back from the database or a request ---------- */

const isDayKey = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && dayKey(parseDayKey(v)) === v

function minutesOrNull(v: unknown, min: number, max: number): number | null | undefined {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n < min || n > max) return undefined
  return Math.round(n)
}

/**
 * Any stored or typed rules to a complete, safe set. Anything missing or out of range falls back to the default, so a
 * half-saved row can never produce a nonsense pay week.
 */
export function normalizeRules(raw: unknown): TimeRules {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: TimeRules = { ...DEFAULT_RULES }
  const ws = Number(r.weekStart ?? r.week_start)
  if (Number.isInteger(ws) && ws >= 0 && ws <= 6) out.weekStart = ws
  const pd = Number(r.periodDays ?? r.period_days)
  if (pd === 14) out.periodDays = 14
  const anchor = r.periodAnchor ?? r.period_anchor
  if (isDayKey(anchor)) out.periodAnchor = anchor
  const weekly = minutesOrNull(r.weeklyOtMin ?? r.weekly_ot_min, 60, 7 * 24 * 60)
  const daily = minutesOrNull(r.dailyOtMin ?? r.daily_ot_min, 60, 24 * 60)
  const dbl = minutesOrNull(r.dailyDoubleMin ?? r.daily_double_min, 60, 24 * 60)
  const hasOt = 'weeklyOtMin' in r || 'weekly_ot_min' in r || 'dailyOtMin' in r || 'daily_ot_min' in r
  if (hasOt) {
    out.weeklyOtMin = weekly === undefined ? DEFAULT_RULES.weeklyOtMin : weekly
    out.dailyOtMin = daily === undefined ? null : daily
    out.dailyDoubleMin = dbl === undefined ? null : dbl
    // Double time starts after overtime does. A daily double-time line below the overtime line is nonsense, so it is dropped.
    if (out.dailyDoubleMin !== null && (out.dailyOtMin === null || out.dailyDoubleMin <= out.dailyOtMin)) out.dailyDoubleMin = null
  }
  const st = String(r.state ?? '').trim().toUpperCase()
  if (/^[A-Z]{2}$/.test(st)) out.state = st
  const lm = String(r.locationMode ?? r.location_mode ?? 'off')
  if (lm === 'record' || lm === 'require') out.locationMode = lm
  const lat = Number(r.geofence_lat ?? (r.geofence as Record<string, unknown> | null)?.lat)
  const lng = Number(r.geofence_lng ?? (r.geofence as Record<string, unknown> | null)?.lng)
  const rad = Number(r.geofence_radius_m ?? (r.geofence as Record<string, unknown> | null)?.radiusM)
  const hasPoint = (r.geofence_lat !== null && r.geofence_lat !== undefined) || (r.geofence && typeof r.geofence === 'object')
  if (hasPoint && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    out.geofence = { lat, lng, radiusM: Number.isFinite(rad) ? Math.min(5000, Math.max(30, Math.round(rad))) : 200 }
  }
  // Checking location needs a place to check against.
  if (out.locationMode !== 'off' && !out.geofence) out.locationMode = 'off'
  if (r.requirePin === false || r.require_pin === false) out.requirePin = false
  return out
}

/* ---------- pay weeks and pay periods ---------- */

/** Whole days from one day key to another. Uses UTC so a daylight-saving change never makes a day 23 or 25 hours. */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, (bm || 1) - 1, bd || 1) - Date.UTC(ay, (am || 1) - 1, ad || 1)) / 86_400_000)
}

/** The first day of the pay week that contains a day. */
export const weekStartFor = (key: string, rules: Pick<TimeRules, 'weekStart'>): string => weekStartKey(parseDayKey(key), rules.weekStart)

/** The first day of the pay period that contains a day. Two-week periods count from the anchor. */
export function periodStartFor(key: string, rules: Pick<TimeRules, 'weekStart' | 'periodDays' | 'periodAnchor'>): string {
  const ws = weekStartFor(key, rules)
  if (rules.periodDays !== 14) return ws
  const anchor = rules.periodAnchor ? weekStartFor(rules.periodAnchor, rules) : weekStartFor('2024-01-01', rules)
  const weeks = Math.round(daysBetween(anchor, ws) / 7)
  return weeks % 2 === 0 ? ws : addDaysKey(ws, -7)
}

export const periodKeys = (start: string, days: number): string[] => Array.from({ length: days }, (_, i) => addDaysKey(start, i))

/** The pay weeks inside a pay period. Overtime is figured on each of them. */
export const weeksIn = (start: string, days: number): string[] => (days >= 14 ? [start, addDaysKey(start, 7)] : [start])

export function periodLabel(start: string, days: number): string {
  const a = parseDayKey(start)
  const b = parseDayKey(addDaysKey(start, days - 1))
  const left = a.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  const right = a.getMonth() === b.getMonth() && a.getFullYear() === b.getFullYear() ? String(b.getDate()) : b.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${left} to ${right}, ${b.getFullYear()}`
}

/* ---------- regular, overtime and double time ---------- */

export interface DaySplit { regular: number; overtime: number; double: number }
export interface WeekSplit { days: DaySplit[]; regular: number; overtime: number; double: number }

/**
 * Splits one pay week of daily minutes. Daily rules come first: minutes past the daily overtime line are overtime, minutes
 * past the double-time line are double time. Then the weekly rule: once the regular minutes of the week pass the weekly
 * line, the rest of the week's regular minutes are overtime. A minute is never counted twice.
 */
export function splitWeek(perDay: number[], rules: Pick<TimeRules, 'weeklyOtMin' | 'dailyOtMin' | 'dailyDoubleMin'>): WeekSplit {
  const days: DaySplit[] = []
  let regularSoFar = 0
  for (const raw of perDay) {
    const total = Math.max(0, Number(raw) || 0)
    let dbl = 0
    let ot = 0
    if (rules.dailyDoubleMin !== null && total > rules.dailyDoubleMin) dbl = total - rules.dailyDoubleMin
    const afterDouble = total - dbl
    if (rules.dailyOtMin !== null && afterDouble > rules.dailyOtMin) ot = afterDouble - rules.dailyOtMin
    let regular = afterDouble - ot
    if (rules.weeklyOtMin !== null && regularSoFar + regular > rules.weeklyOtMin) {
      const extra = Math.min(regular, regularSoFar + regular - rules.weeklyOtMin)
      regular -= extra
      ot += extra
    }
    regularSoFar += regular
    days.push({ regular, overtime: ot, double: dbl })
  }
  return {
    days,
    regular: days.reduce((s, d) => s + d.regular, 0),
    overtime: days.reduce((s, d) => s + d.overtime, 0),
    double: days.reduce((s, d) => s + d.double, 0),
  }
}

export interface PeriodSplit extends WeekSplit { weeks: WeekSplit[]; total: number }

/** A pay period of daily minutes (7 or 14 values, in order) split week by week. */
export function splitPeriod(perDay: number[], rules: Pick<TimeRules, 'weeklyOtMin' | 'dailyOtMin' | 'dailyDoubleMin'>): PeriodSplit {
  const weeks: WeekSplit[] = []
  for (let i = 0; i < perDay.length; i += 7) weeks.push(splitWeek(perDay.slice(i, i + 7), rules))
  const days = weeks.flatMap(w => w.days)
  const regular = weeks.reduce((s, w) => s + w.regular, 0)
  const overtime = weeks.reduce((s, w) => s + w.overtime, 0)
  const dbl = weeks.reduce((s, w) => s + w.double, 0)
  return { weeks, days, regular, overtime, double: dbl, total: regular + overtime + dbl }
}

/** One plain sentence for the screen: "Overtime after 40 hours a week and 8 hours a day." */
export function describeRules(r: Pick<TimeRules, 'weeklyOtMin' | 'dailyOtMin' | 'dailyDoubleMin'>): string {
  const h = (m: number) => (m % 60 === 0 ? `${m / 60}` : (m / 60).toFixed(1))
  const parts: string[] = []
  if (r.weeklyOtMin !== null) parts.push(`${h(r.weeklyOtMin)} hours a week`)
  if (r.dailyOtMin !== null) parts.push(`${h(r.dailyOtMin)} hours a day`)
  let text = parts.length ? `Overtime after ${parts.join(' and ')}.` : 'No overtime is figured.'
  if (r.dailyDoubleMin !== null) text += ` Double time after ${h(r.dailyDoubleMin)} hours a day.`
  return text
}
