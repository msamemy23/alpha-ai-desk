/**
 * Hours for payroll, worked out from the time clock the same way the Team screen does it: time between the punches minus
 * breaks, a forgotten clock-out counts as nothing until someone fixes it, and overtime follows the shop's own pay-week and
 * overtime rules (Team, Rules: the first day of the pay week, overtime over so many hours a week or a day, double time).
 * Without rules it uses the plain federal week: Monday to Sunday, overtime over 40 hours. The split is the same function
 * the Team screen uses (splitWeek), so the two screens cannot disagree. This file only reads punches. It never changes
 * them, and it does not work out pay: pay rates are not kept in the app, so the export is hours for the payroll provider
 * or the accountant to price.
 */
import {
  addDaysKey, breakMinutes, decimalHours, entriesFor, entryDay, isStale, minutesOnDay, noteKind, parseDayKey, roleLabel, weekStartKey, workedMinutes,
} from './timeclock.ts'
import type { ClockEntry, Person } from './timeclock.ts'
import { DEFAULT_RULES, WEEKDAY_NAMES, describeRules, splitWeek } from './timerules.ts'
import type { TimeRules } from './timerules.ts'
import { csvCell } from './reports.ts'
import type { Range } from './reports.ts'

/** The part of the shop's pay rules that decides regular, overtime and double time. */
export type PayrollRules = Pick<TimeRules, 'weekStart' | 'weeklyOtMin' | 'dailyOtMin' | 'dailyDoubleMin'>

export interface PayrollWeek { weekStart: string; regularMin: number; overtimeMin: number; doubleMin: number; totalMin: number; partial: boolean }
export interface PayrollFlag { kind: 'open' | 'forgotten' | 'edited' | 'manual' | 'partial-week'; text: string; entryIds: number[] }
export interface PayrollRow {
  id: number
  name: string
  role: string
  active: boolean
  regularHours: number
  overtimeHours: number
  doubleHours: number
  totalHours: number
  breakMinutes: number
  daysWorked: number
  shifts: number
  weeks: PayrollWeek[]
  flags: PayrollFlag[]
}
export interface PayrollSummary { range: Range; rules: PayrollRules; rows: PayrollRow[]; totalHours: number; regularHours: number; overtimeHours: number; doubleHours: number; flagged: number; notes: string[] }

const inRangeDay = (k: string, r: Range) => k >= r.from && k <= r.to

/** Week start, rounded to something valid: a bad value falls back to Monday. */
const weekStartOf = (rules: PayrollRules): number => (Number.isInteger(rules.weekStart) && rules.weekStart >= 0 && rules.weekStart <= 6 ? rules.weekStart : 1)
const weekWords = (rules: PayrollRules): string => `${WEEKDAY_NAMES[weekStartOf(rules)]} to ${WEEKDAY_NAMES[(weekStartOf(rules) + 6) % 7]}`

export function payrollSummary(people: Person[], entries: ClockEntry[], range: Range, nowMs: number, rules: PayrollRules = DEFAULT_RULES): PayrollSummary {
  const startDay = weekStartOf(rules)
  const rows: PayrollRow[] = []
  for (const p of [...people].sort((a, b) => a.name.localeCompare(b.name))) {
    const mine = entriesFor(entries, p).filter(e => inRangeDay(entryDay(e), range))
    if (!mine.length && !p.active) continue
    const weeks = new Set<string>()
    const days = new Set<string>()
    let breaks = 0
    const flags: PayrollFlag[] = []
    const open: number[] = [], forgotten: number[] = [], edited: number[] = [], manual: number[] = []
    for (const e of mine) {
      const worked = workedMinutes(e, nowMs)
      weeks.add(weekStartKey(parseDayKey(entryDay(e)), startDay))
      if (worked > 0) days.add(entryDay(e))
      breaks += breakMinutes(e, nowMs)
      if (isStale(e, nowMs)) forgotten.push(e.id)
      else if (!e.clock_out) open.push(e.id)
      const kind = noteKind(e.note)
      if (kind === 'edited') edited.push(e.id)
      if (kind === 'manual') manual.push(e.id)
    }
    if (forgotten.length) flags.push({ kind: 'forgotten', entryIds: forgotten, text: `${forgotten.length === 1 ? 'A shift was' : `${forgotten.length} shifts were`} never clocked out and count as zero hours until fixed.` })
    if (open.length) flags.push({ kind: 'open', entryIds: open, text: 'Still clocked in. Hours count up to now and will grow until they clock out.' })
    if (edited.length) flags.push({ kind: 'edited', entryIds: edited, text: `${edited.length === 1 ? 'One shift was' : `${edited.length} shifts were`} edited by a manager after it was punched.` })
    if (manual.length) flags.push({ kind: 'manual', entryIds: manual, text: `${manual.length === 1 ? 'One shift was' : `${manual.length} shifts were`} added by hand, not punched.` })
    const firstWeek = weekStartKey(parseDayKey(range.from), startDay), lastWeek = weekStartKey(parseDayKey(range.to), startDay)
    const lastWeekday = (startDay + 6) % 7
    const weekRows: PayrollWeek[] = [...weeks].sort().map(weekStart => {
      // The same split the Team screen uses: the days of the pay week in order, daily rules first, then the weekly line.
      const perDay = Array.from({ length: 7 }, (_, i) => minutesOnDay(mine, addDaysKey(weekStart, i), nowMs))
      const split = splitWeek(perDay, rules)
      // A week the range cuts into has only some of its days counted, so its overtime may be understated.
      const partial = (weekStart === firstWeek && range.from !== firstWeek) || (weekStart === lastWeek && parseDayKey(range.to).getDay() !== lastWeekday)
      return { weekStart, totalMin: split.regular + split.overtime + split.double, regularMin: split.regular, overtimeMin: split.overtime, doubleMin: split.double, partial }
    })
    if (weekRows.some(w => w.partial)) flags.push({ kind: 'partial-week', entryIds: [], text: `The dates cut into a ${weekWords(rules)} week, so overtime for that week may be understated. Pick whole weeks for exact overtime.` })
    const reg = weekRows.reduce((s, w) => s + w.regularMin, 0), ot = weekRows.reduce((s, w) => s + w.overtimeMin, 0), dbl = weekRows.reduce((s, w) => s + w.doubleMin, 0)
    rows.push({
      id: p.id, name: p.name, role: p.role, active: p.active,
      regularHours: decimalHours(reg), overtimeHours: decimalHours(ot), doubleHours: decimalHours(dbl), totalHours: decimalHours(reg + ot + dbl),
      breakMinutes: Math.round(breaks), daysWorked: days.size, shifts: mine.length, weeks: weekRows, flags,
    })
  }
  const sum = (f: (r: PayrollRow) => number) => Math.round(rows.reduce((s, r) => s + f(r), 0) * 100) / 100
  const notes: string[] = []
  if (rows.some(r => r.flags.some(f => f.kind === 'partial-week'))) notes.push(`Pay weeks run ${weekWords(rules)}. ${describeRules(rules)}`)
  return {
    range, rules, rows, totalHours: sum(r => r.totalHours), regularHours: sum(r => r.regularHours), overtimeHours: sum(r => r.overtimeHours), doubleHours: sum(r => r.doubleHours),
    flagged: rows.filter(r => r.flags.some(f => f.kind === 'forgotten' || f.kind === 'open')).length, notes,
  }
}

const line = (cells: unknown[]) => cells.map(csvCell).join(',')

/** One row per person: the file a payroll provider or accountant asks for. */
export function payrollSummaryCsv(s: PayrollSummary): string {
  // The double time column appears only when the shop's rules have double time and someone earned some, so a file stays the same for everyone else.
  const dbl = s.doubleHours > 0
  const out = [line(['Name', 'Role', 'Regular hours', 'Overtime hours', ...(dbl ? ['Double time hours'] : []), 'Total hours', 'Break minutes', 'Days worked', 'Needs a look'])]
  for (const r of s.rows) out.push(line([r.name, roleLabel(r.role), r.regularHours.toFixed(2), r.overtimeHours.toFixed(2), ...(dbl ? [r.doubleHours.toFixed(2)] : []), r.totalHours.toFixed(2), r.breakMinutes, r.daysWorked, r.flags.map(f => f.text).join(' ')]))
  return out.join('\r\n') + '\r\n'
}

/** One row per person per week, with the overtime for each week. */
export function payrollWeeklyCsv(s: PayrollSummary): string {
  const dbl = s.doubleHours > 0
  const out = [line(['Name', `Week starting (${WEEKDAY_NAMES[weekStartOf(s.rules)]})`, 'Regular hours', 'Overtime hours', ...(dbl ? ['Double time hours'] : []), 'Total hours', 'Partial week'])]
  for (const r of s.rows) for (const w of r.weeks) out.push(line([r.name, w.weekStart, decimalHours(w.regularMin).toFixed(2), decimalHours(w.overtimeMin).toFixed(2), ...(dbl ? [decimalHours(w.doubleMin).toFixed(2)] : []), decimalHours(w.totalMin).toFixed(2), w.partial ? 'Yes' : 'No']))
  return out.join('\r\n') + '\r\n'
}
