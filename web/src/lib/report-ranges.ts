/**
 * Which days a report covers and what they are compared with: presets (today, last week, last quarter and so on),
 * a custom range, and any of "the period before", "the same dates last year" or a second range picked by hand.
 * Plain TypeScript with no framework imports, so the browser, the server (scheduled emails) and `node --test` share it.
 *
 * Dates are local calendar days written "2026-10-14". Weeks run Monday to Sunday, like the time clock.
 */
import { addDays, diffDays, keyOf, parseDay, periodFor, rangeLabel, spanDays, weekStart } from './reports.ts'
import type { PeriodKey, Range } from './reports.ts'

export type RangeKey =
  | 'today' | 'yesterday' | 'week' | 'lastweek' | '7d' | '30d' | '90d'
  | 'month' | 'lastmonth' | 'quarter' | 'lastquarter' | 'year' | 'lastyear' | 'all' | 'custom'

export const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'This week' },
  { key: 'lastweek', label: 'Last week' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: '90d', label: 'Last 90 days' },
  { key: 'month', label: 'This month' },
  { key: 'lastmonth', label: 'Last month' },
  { key: 'quarter', label: 'This quarter' },
  { key: 'lastquarter', label: 'Last quarter' },
  { key: 'year', label: 'This year' },
  { key: 'lastyear', label: 'Last year' },
  { key: 'all', label: 'All time' },
  { key: 'custom', label: 'Pick dates' },
]

export type CompareMode = 'previous' | 'lastyear' | 'custom' | 'none'

export const COMPARE_OPTIONS: { key: CompareMode; label: string }[] = [
  { key: 'previous', label: 'The period before' },
  { key: 'lastyear', label: 'The same dates last year' },
  { key: 'custom', label: 'Pick dates' },
  { key: 'none', label: 'No comparison' },
]

export interface RangeSpec { key: RangeKey; from?: string; to?: string }
export interface CompareSpec { mode: CompareMode; from?: string; to?: string }

export interface Resolved {
  range: Range
  /** The days compared with, or null when nothing is being compared. */
  previous: Range | null
  /** Reads after "from": "Up 12% from the 7 days before". */
  vs: string
  /** "Last 30 days" or "Oct 1 to Oct 14, 2026". */
  title: string
  /** Set when the dates asked for could not be used and something sensible was used instead. */
  problem: string
}

/* ---------- days ---------- */

/** A real calendar day written yyyy-mm-dd ("2026-02-30" is not one). */
export function isDayKey(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  if (y < 1990 || y > 2100) return false
  const t = new Date(y, m - 1, d, 12)
  return t.getFullYear() === y && t.getMonth() === m - 1 && t.getDate() === d
}

const quarterStart = (k: string): string => {
  const d = parseDay(k)
  return keyOf(new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1, 12))
}
const addMonthsClamped = (k: string, n: number): string => {
  const d = parseDay(k)
  const first = new Date(d.getFullYear(), d.getMonth() + n, 1, 12)
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  return keyOf(new Date(first.getFullYear(), first.getMonth(), Math.min(d.getDate(), last), 12))
}
const quarterEnd = (k: string): string => addDays(addMonthsClamped(quarterStart(k), 3), -1)

/** The same calendar dates a year earlier (Feb 29 becomes Feb 28). */
export function yearBefore(k: string): string { return addMonthsClamped(k, -12) }

/* ---------- presets ---------- */

function presetRange(key: Exclude<RangeKey, 'custom'>, today: string, earliest?: string): { range: Range; previous: Range | null; vs: string } {
  switch (key) {
    case 'today': return { range: { from: today, to: today }, previous: { from: addDays(today, -1), to: addDays(today, -1) }, vs: 'yesterday' }
    case 'yesterday': { const y = addDays(today, -1); return { range: { from: y, to: y }, previous: { from: addDays(y, -1), to: addDays(y, -1) }, vs: 'the day before' } }
    case 'week': {
      const from = weekStart(today)
      return { range: { from, to: today }, previous: { from: addDays(from, -7), to: addDays(today, -7) }, vs: 'the same days last week' }
    }
    case 'lastweek': {
      const from = addDays(weekStart(today), -7)
      return { range: { from, to: addDays(from, 6) }, previous: { from: addDays(from, -7), to: addDays(from, -1) }, vs: 'the week before' }
    }
    case 'quarter': {
      const from = quarterStart(today)
      const pFrom = addMonthsClamped(from, -3)
      const elapsed = diffDays(from, today)
      const pTo = addDays(pFrom, elapsed)
      const pEnd = quarterEnd(pFrom)
      return { range: { from, to: today }, previous: { from: pFrom, to: pTo > pEnd ? pEnd : pTo }, vs: 'the same days last quarter' }
    }
    case 'lastquarter': {
      const thisStart = quarterStart(today)
      const from = addMonthsClamped(thisStart, -3)
      const pFrom = addMonthsClamped(from, -3)
      return { range: { from, to: addDays(thisStart, -1) }, previous: { from: pFrom, to: addDays(from, -1) }, vs: 'the quarter before' }
    }
    case 'lastyear': {
      const y = parseDay(today).getFullYear() - 1
      return { range: { from: `${y}-01-01`, to: `${y}-12-31` }, previous: { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` }, vs: 'the year before' }
    }
    case 'all': return { range: { from: earliest && earliest <= today ? earliest : addDays(today, -364), to: today }, previous: null, vs: '' }
    default: {
      const p = periodFor(key as PeriodKey, today)
      const vs: Record<string, string> = { '7d': 'the 7 days before', '30d': 'the 30 days before', '90d': 'the 90 days before', month: 'the same days last month', lastmonth: 'the month before', year: 'the same days last year' }
      return { range: p.range, previous: p.previous, vs: vs[key] || 'the period before' }
    }
  }
}

const KEYS = new Set<string>(RANGE_OPTIONS.map(o => o.key))
export const isRangeKey = (v: unknown): v is RangeKey => typeof v === 'string' && KEYS.has(v)
const MODES = new Set<string>(COMPARE_OPTIONS.map(o => o.key))
export const isCompareMode = (v: unknown): v is CompareMode => typeof v === 'string' && MODES.has(v)

const MAX_SPAN_DAYS = 3660

/**
 * The days a report covers and the days it is compared with.
 * `earliest` is the oldest day in the shop's records, used by "All time".
 */
export function resolveRange(spec: RangeSpec, cmp: CompareSpec, today: string, earliest?: string): Resolved {
  let problem = ''
  let range: Range
  let previous: Range | null
  let vs: string
  let title: string

  if (spec.key === 'custom') {
    if (isDayKey(spec.from) && isDayKey(spec.to) && spec.from <= spec.to && diffDays(spec.from, spec.to) < MAX_SPAN_DAYS) {
      range = { from: spec.from, to: spec.to }
    } else {
      const d = presetRange('30d', today)
      range = d.range
      problem = !isDayKey(spec.from) || !isDayKey(spec.to)
        ? 'Pick both a first and a last day. Showing the last 30 days until you do.'
        : spec.from > spec.to ? 'The first day is after the last day. Showing the last 30 days until you fix it.'
          : 'That is more than ten years. Pick a shorter stretch. Showing the last 30 days until you do.'
    }
    const n = spanDays(range)
    previous = { from: addDays(range.from, -n), to: addDays(range.from, -1) }
    vs = n === 1 ? 'the day before' : `the ${n} days before`
    title = rangeLabel(range)
  } else {
    const p = presetRange(spec.key, today, earliest)
    range = p.range; previous = p.previous; vs = p.vs
    title = RANGE_OPTIONS.find(o => o.key === spec.key)?.label || rangeLabel(range)
  }

  // The comparison. "The period before" is whatever the preset already says; the others replace it.
  if (cmp.mode === 'none') { previous = null; vs = '' }
  else if (cmp.mode === 'lastyear') {
    previous = { from: yearBefore(range.from), to: yearBefore(range.to) }
    vs = 'the same dates last year'
  } else if (cmp.mode === 'custom') {
    if (isDayKey(cmp.from) && isDayKey(cmp.to) && cmp.from <= cmp.to && diffDays(cmp.from, cmp.to) < MAX_SPAN_DAYS) {
      previous = { from: cmp.from, to: cmp.to }
      vs = rangeLabel(previous)
    } else {
      // Keep the default comparison, and say why it was not the one asked for.
      problem = problem || 'Pick both days for the comparison, with the first day before the last. Comparing with the period before for now.'
    }
  }
  if (previous && previous.to >= range.from && previous.from <= range.to && cmp.mode === 'custom') {
    problem = problem || 'The two sets of dates overlap, so some days are counted in both.'
  }
  return { range, previous, vs, title, problem }
}

/* ---------- the address bar ---------- */

export interface RangeState { spec: RangeSpec; cmp: CompareSpec }
export const DEFAULT_RANGE: RangeState = { spec: { key: '30d' }, cmp: { mode: 'previous' } }

/** Reads ?period=&from=&to=&compare=&cfrom=&cto= and ignores anything it does not understand. */
export function rangeFromParams(q: URLSearchParams): RangeState {
  const key = q.get('period')
  const mode = q.get('compare')
  const spec: RangeSpec = isRangeKey(key) ? { key } : { ...DEFAULT_RANGE.spec }
  if (spec.key === 'custom') {
    const from = q.get('from'), to = q.get('to')
    if (isDayKey(from)) spec.from = from
    if (isDayKey(to)) spec.to = to
  }
  const cmp: CompareSpec = isCompareMode(mode) ? { mode } : { ...DEFAULT_RANGE.cmp }
  if (cmp.mode === 'custom') {
    const from = q.get('cfrom'), to = q.get('cto')
    if (isDayKey(from)) cmp.from = from
    if (isDayKey(to)) cmp.to = to
  }
  return { spec, cmp }
}

/** The pieces to write back into the address bar (empty values are left out). */
export function rangeToParams(state: RangeState): Record<string, string> {
  const out: Record<string, string> = { period: state.spec.key }
  if (state.spec.key === 'custom') {
    if (state.spec.from) out.from = state.spec.from
    if (state.spec.to) out.to = state.spec.to
  }
  if (state.cmp.mode !== DEFAULT_RANGE.cmp.mode) out.compare = state.cmp.mode
  if (state.cmp.mode === 'custom') {
    if (state.cmp.from) out.cfrom = state.cmp.from
    if (state.cmp.to) out.cto = state.cmp.to
  }
  return out
}

/* ---------- scheduled reports ---------- */

/**
 * The preset a scheduled report covers when it runs on `today`: a weekly report looks at the week that just ended,
 * a monthly one at the month that just ended. The same period always has the same key, so a retry never sends it twice.
 */
export function scheduledPeriod(schedule: 'weekly' | 'monthly', today: string): { key: string; range: Range; previous: Range; title: string } {
  if (schedule === 'weekly') {
    const r = resolveRange({ key: 'lastweek' }, { mode: 'previous' }, today)
    return { key: `week-${r.range.from}`, range: r.range, previous: r.previous as Range, title: `Week of ${parseDay(r.range.from).toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}` }
  }
  const r = resolveRange({ key: 'lastmonth' }, { mode: 'previous' }, today)
  return { key: `month-${r.range.from.slice(0, 7)}`, range: r.range, previous: r.previous as Range, title: parseDay(r.range.from).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) }
}

/** The period as it reads in a sentence: "this week", "in the last 30 days", "Oct 1 to Oct 14, 2026". */
export function periodPhrase(spec: RangeSpec, range: Range): string {
  switch (spec.key) {
    case 'today': return 'today'
    case 'yesterday': return 'yesterday'
    case 'week': return 'this week'
    case 'lastweek': return 'last week'
    case '7d': return 'in the last 7 days'
    case '30d': return 'in the last 30 days'
    case '90d': return 'in the last 90 days'
    case 'month': return 'this month'
    case 'lastmonth': return 'last month'
    case 'quarter': return 'this quarter'
    case 'lastquarter': return 'last quarter'
    case 'year': return 'this year'
    case 'lastyear': return 'last year'
    case 'all': return 'in all'
    default: return `from ${rangeLabel(range)}`
  }
}
