/**
 * Hours for payroll, worked out from the time clock the same way the Team screen does it: time between the punches minus
 * breaks, a forgotten clock-out counts as nothing until someone fixes it, and overtime is the part of a Monday-to-Sunday week
 * over 40 hours. This file only reads punches. It never changes them, and it does not work out pay: pay rates are not kept
 * in the app, so the export is hours for the payroll provider or the accountant to price.
 */
import {
  breakMinutes, decimalHours, entriesFor, entryDay, isStale, noteKind, overtimeMinutes, parseDayKey, roleLabel, weekStartKey, workedMinutes,
} from './timeclock.ts'
import type { ClockEntry, Person } from './timeclock.ts'
import { csvCell } from './reports.ts'
import type { Range } from './reports.ts'

export interface PayrollWeek { weekStart: string; regularMin: number; overtimeMin: number; totalMin: number; partial: boolean }
export interface PayrollFlag { kind: 'open' | 'forgotten' | 'edited' | 'manual' | 'partial-week'; text: string; entryIds: number[] }
export interface PayrollRow {
  id: number
  name: string
  role: string
  active: boolean
  regularHours: number
  overtimeHours: number
  totalHours: number
  breakMinutes: number
  daysWorked: number
  shifts: number
  weeks: PayrollWeek[]
  flags: PayrollFlag[]
}
export interface PayrollSummary { range: Range; rows: PayrollRow[]; totalHours: number; regularHours: number; overtimeHours: number; flagged: number; notes: string[] }

const inRangeDay = (k: string, r: Range) => k >= r.from && k <= r.to

export function payrollSummary(people: Person[], entries: ClockEntry[], range: Range, nowMs: number): PayrollSummary {
  const rows: PayrollRow[] = []
  for (const p of [...people].sort((a, b) => a.name.localeCompare(b.name))) {
    const mine = entriesFor(entries, p).filter(e => inRangeDay(entryDay(e), range))
    if (!mine.length && !p.active) continue
    const weeks = new Map<string, number>()
    const days = new Set<string>()
    let breaks = 0
    const flags: PayrollFlag[] = []
    const open: number[] = [], forgotten: number[] = [], edited: number[] = [], manual: number[] = []
    for (const e of mine) {
      const wk = weekStartKey(parseDayKey(entryDay(e)))
      const worked = workedMinutes(e, nowMs)
      weeks.set(wk, (weeks.get(wk) || 0) + worked)
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
    const firstWeek = weekStartKey(parseDayKey(range.from)), lastWeek = weekStartKey(parseDayKey(range.to))
    const weekRows: PayrollWeek[] = [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([weekStart, totalMin]) => {
      const ot = overtimeMinutes(totalMin)
      // A week the range cuts into has only some of its days counted, so its overtime may be understated.
      const partial = (weekStart === firstWeek && range.from !== firstWeek) || (weekStart === lastWeek && parseDayKey(range.to).getDay() !== 0)
      return { weekStart, totalMin, overtimeMin: ot, regularMin: totalMin - ot, partial }
    })
    if (weekRows.some(w => w.partial)) flags.push({ kind: 'partial-week', entryIds: [], text: 'The dates cut into a Monday to Sunday week, so overtime for that week may be understated. Pick whole weeks for exact overtime.' })
    const reg = weekRows.reduce((s, w) => s + w.regularMin, 0), ot = weekRows.reduce((s, w) => s + w.overtimeMin, 0)
    rows.push({
      id: p.id, name: p.name, role: p.role, active: p.active,
      regularHours: decimalHours(reg), overtimeHours: decimalHours(ot), totalHours: decimalHours(reg + ot),
      breakMinutes: Math.round(breaks), daysWorked: days.size, shifts: mine.length, weeks: weekRows, flags,
    })
  }
  const sum = (f: (r: PayrollRow) => number) => Math.round(rows.reduce((s, r) => s + f(r), 0) * 100) / 100
  const notes: string[] = []
  if (rows.some(r => r.flags.some(f => f.kind === 'partial-week'))) notes.push('Overtime is the part of a Monday to Sunday week over 40 hours.')
  return {
    range, rows, totalHours: sum(r => r.totalHours), regularHours: sum(r => r.regularHours), overtimeHours: sum(r => r.overtimeHours),
    flagged: rows.filter(r => r.flags.some(f => f.kind === 'forgotten' || f.kind === 'open')).length, notes,
  }
}

const line = (cells: unknown[]) => cells.map(csvCell).join(',')

/** One row per person: the file a payroll provider or accountant asks for. */
export function payrollSummaryCsv(s: PayrollSummary): string {
  const out = [line(['Name', 'Role', 'Regular hours', 'Overtime hours', 'Total hours', 'Break minutes', 'Days worked', 'Needs a look'])]
  for (const r of s.rows) out.push(line([r.name, roleLabel(r.role), r.regularHours.toFixed(2), r.overtimeHours.toFixed(2), r.totalHours.toFixed(2), r.breakMinutes, r.daysWorked, r.flags.map(f => f.text).join(' ')]))
  return out.join('\r\n') + '\r\n'
}

/** One row per person per week, with the overtime for each week. */
export function payrollWeeklyCsv(s: PayrollSummary): string {
  const out = [line(['Name', 'Week starting (Monday)', 'Regular hours', 'Overtime hours', 'Total hours', 'Partial week'])]
  for (const r of s.rows) for (const w of r.weeks) out.push(line([r.name, w.weekStart, decimalHours(w.regularMin).toFixed(2), decimalHours(w.overtimeMin).toFixed(2), decimalHours(w.totalMin).toFixed(2), w.partial ? 'Yes' : 'No']))
  return out.join('\r\n') + '\r\n'
}
