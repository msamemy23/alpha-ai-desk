/**
 * Timesheet review and the payroll files: one person's pay period worked out from their punches, what needs a look before
 * it is approved, and the two CSV files an accountant or payroll tool reads. Imports only other plain lib files, so it runs
 * in the browser, on the server and under `node --test`. Keep it to plain TypeScript (no enums, no parameter properties).
 */
import { csvLine, toCsv } from './csv.ts'
import {
  breakMinutes, dayLabel, decimalHours, entriesFor, entryDay, fmtDuration, fmtTimeOfDay, isOverlong, isStale, minutesOnDay, noteKind, noteText, roleLabel,
  workedMinutes,
} from './timeclock.ts'
import type { ClockEntry, Person } from './timeclock.ts'
import { addDaysKey } from './timeclock.ts'
import { periodKeys, splitPeriod } from './timerules.ts'
import type { PeriodSplit, TimeRules } from './timerules.ts'

/** A day longer than this is worth a second look before it is paid. */
export const LONG_DAY_MIN = 12 * 60

export interface Approval {
  staff_id: number
  /** First day of the pay period, a day key. */
  period_start: string
  period_days: number
  approved_at: string
  approved_by: string | null
  /** Minutes worked in the period when it was approved. If punches change afterwards the screen says so. */
  minutes_total: number
  note: string | null
}

export function normalizeApproval(raw: Record<string, unknown>): Approval {
  return {
    staff_id: Number(raw.staff_id),
    period_start: String(raw.period_start ?? '').slice(0, 10),
    period_days: Number(raw.period_days) === 14 ? 14 : 7,
    approved_at: String(raw.approved_at ?? ''),
    approved_by: raw.approved_by == null ? null : String(raw.approved_by),
    minutes_total: Math.max(0, Number(raw.minutes_total) || 0),
    note: raw.note == null ? null : String(raw.note),
  }
}

export interface PeriodView {
  person: Person
  entries: ClockEntry[]
  /** Minutes worked on each day of the period, in order. */
  perDay: number[]
  split: PeriodSplit
  totalMinutes: number
  /** Minutes on the punches that started in the period, whole. Approval compares this number, and the server stores the same one. */
  entryMinutes: number
}

/** Minutes on a list of punches, each counted whole whichever day it ends on. Rounded to the minute. */
export function entryMinutesTotal(entries: ClockEntry[], nowMs: number): number {
  return Math.round(entries.reduce((sum, e) => sum + workedMinutes(e, nowMs), 0))
}

/** One person's punches for a pay period: the entries that started in it, the minutes per day and the regular/overtime split. */
export function personPeriod(person: Person, all: ClockEntry[], start: string, days: number, rules: Pick<TimeRules, 'weeklyOtMin' | 'dailyOtMin' | 'dailyDoubleMin'>, nowMs: number): PeriodView {
  const keys = periodKeys(start, days)
  const set = new Set(keys)
  const entries = entriesFor(all, person).filter(e => set.has(entryDay(e))).sort((a, b) => Date.parse(a.clock_in) - Date.parse(b.clock_in))
  const perDay = keys.map(k => minutesOnDay(entries, k, nowMs))
  const split = splitPeriod(perDay, rules)
  return { person, entries, perDay, split, totalMinutes: perDay.reduce((s, m) => s + m, 0), entryMinutes: entryMinutesTotal(entries, nowMs) }
}

/* ---------- what needs a look ---------- */

export interface ReviewFlag {
  kind: 'open' | 'running' | 'long_day' | 'edited' | 'manual' | 'outside' | 'location'
  /** A "fix" flag has to be dealt with before the period can be approved. A "check" flag is for the reviewer's eyes. */
  severity: 'fix' | 'check'
  text: string
}

export function reviewFlags(view: PeriodView, start: string, days: number, todayKey: string, nowMs: number): ReviewFlag[] {
  const flags: ReviewFlag[] = []
  const lastDay = addDaysKey(start, days - 1)
  const pastEnd = todayKey > lastDay
  for (const e of view.entries) {
    if (e.clock_out) continue
    if (isStale(e, nowMs) || isOverlong(e, nowMs)) flags.push({ kind: 'open', severity: 'fix', text: `Still clocked in from ${dayLabel(entryDay(e))}, ${fmtTimeOfDay(e.clock_in)}. Set the real clock-out time.` })
    else if (pastEnd) flags.push({ kind: 'running', severity: 'fix', text: 'Still clocked in after this pay period ended. Clock out or fix the time.' })
  }
  const keys = periodKeys(start, days)
  view.perDay.forEach((m, i) => {
    if (m > LONG_DAY_MIN) flags.push({ kind: 'long_day', severity: 'check', text: `${dayLabel(keys[i])} is ${fmtDuration(m)}. Make sure that is right.` })
  })
  const edited = view.entries.filter(e => noteKind(e.note) === 'edited').length
  const manual = view.entries.filter(e => noteKind(e.note) === 'manual').length
  if (edited > 0) flags.push({ kind: 'edited', severity: 'check', text: `${edited} ${edited === 1 ? 'entry was' : 'entries were'} changed by hand. The reason is shown on each one.` })
  if (manual > 0) flags.push({ kind: 'manual', severity: 'check', text: `${manual} ${manual === 1 ? 'entry was' : 'entries were'} added by hand.` })
  const outside = view.entries.filter(e => e.in_location === 'outside').length
  if (outside > 0) flags.push({ kind: 'outside', severity: 'check', text: `${outside} ${outside === 1 ? 'clock-in was' : 'clock-ins were'} outside the shop area.` })
  const unknown = view.entries.filter(e => e.in_location === 'unknown').length
  if (unknown > 0) flags.push({ kind: 'location', severity: 'check', text: `${unknown} ${unknown === 1 ? 'clock-in has' : 'clock-ins have'} no location.` })
  return flags
}

export type ApprovalState = 'approved' | 'changed' | 'open'

/** Approved, approved but the hours have moved since, or not approved yet. */
export function approvalState(a: Approval | undefined, currentMinutes: number): ApprovalState {
  if (!a) return 'open'
  return Math.abs(a.minutes_total - currentMinutes) > 1 ? 'changed' : 'approved'
}

/** The approval that covers a day for a person, if the pay period holding that day was approved. */
export function approvalCovering(list: Approval[], staffId: number, dayKeyValue: string): Approval | undefined {
  return list.find(a => a.staff_id === staffId && dayKeyValue >= a.period_start && dayKeyValue <= addDaysKey(a.period_start, a.period_days - 1))
}

/* ---------- the files ---------- */

const hoursText = (min: number): string => decimalHours(min).toFixed(2)

export interface PayrollPeriod { start: string; days: number }

/** Hours by person: regular, overtime, double time and total for the period. People with no hours are left out. */
export function payrollSummaryCsv(people: Person[], entries: ClockEntry[], period: PayrollPeriod, rules: Pick<TimeRules, 'weeklyOtMin' | 'dailyOtMin' | 'dailyDoubleMin'>, approvals: Approval[], nowMs: number): string {
  const end = addDaysKey(period.start, period.days - 1)
  const rows: unknown[][] = [['Name', 'Role', 'Period start', 'Period end', 'Regular hours', 'Overtime hours', 'Double time hours', 'Total hours', 'Approved']]
  const sorted = [...people].sort((a, b) => a.name.localeCompare(b.name))
  for (const p of sorted) {
    const v = personPeriod(p, entries, period.start, period.days, rules, nowMs)
    if (v.totalMinutes <= 0) continue
    const approved = approvalState(approvals.find(a => a.staff_id === p.id && a.period_start === period.start), v.entryMinutes) === 'approved'
    rows.push([p.name, roleLabel(p.role), period.start, end, hoursText(v.split.regular), hoursText(v.split.overtime), hoursText(v.split.double), hoursText(v.totalMinutes), approved ? 'Yes' : 'No'])
  }
  return toCsv(rows)
}

/** Every punch in the period, with the day, times, breaks, hours and why it was changed if it was. */
export function payrollDetailCsv(people: Person[], entries: ClockEntry[], period: PayrollPeriod, approvals: Approval[], nowMs: number): string {
  const set = new Set(periodKeys(period.start, period.days))
  const lines = [csvLine(['Name', 'Role', 'Date', 'Clock in', 'Clock out', 'Break minutes', 'Hours', 'Note', 'Approved'])]
  const sorted = [...people].sort((a, b) => a.name.localeCompare(b.name))
  for (const p of sorted) {
    const mine = entriesFor(entries, p).filter(e => set.has(entryDay(e))).sort((a, b) => Date.parse(a.clock_in) - Date.parse(b.clock_in))
    for (const e of mine) {
      const ap = approvalCovering(approvals, p.id, entryDay(e))
      lines.push(csvLine([
        p.name, roleLabel(p.role), entryDay(e), fmtTimeOfDay(e.clock_in), e.clock_out ? fmtTimeOfDay(e.clock_out) : 'Still clocked in',
        Math.round(breakMinutes(e, nowMs)), hoursText(workedMinutes(e, nowMs)), noteText(e.note), ap ? 'Yes' : 'No',
      ]))
    }
  }
  return lines.join('\r\n') + '\r\n'
}

export const payrollFileName = (kind: 'summary' | 'detail', period: PayrollPeriod): string =>
  `payroll-${kind}-${period.start}-to-${addDaysKey(period.start, period.days - 1)}.csv`
