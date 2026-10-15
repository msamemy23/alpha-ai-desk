'use client'
import { useMemo } from 'react'
import Icon from '@/components/Icon'
import { dayLabel, entryDay, fmtClock, fmtDuration, isStale } from '@/lib/timeclock'
import type { ClockEntry, Person } from '@/lib/timeclock'
import { WEEKDAY_NAMES, describeRules, periodKeys, periodLabel } from '@/lib/timerules'
import type { TimeRules } from '@/lib/timerules'
import { approvalState, personPeriod, reviewFlags } from '@/lib/payroll'
import type { Approval, ApprovalState } from '@/lib/payroll'
import { Avatar } from './parts'

const STATE_WORDS: Record<ApprovalState, { lamp: string; word: string }> = {
  approved: { lamp: 'lamp-green', word: 'Approved' },
  changed: { lamp: 'lamp-amber', word: 'Changed since approved' },
  open: { lamp: 'lamp-off', word: 'Not approved' },
}

/** Hours for the pay period, one row per person, with overtime and whether it is approved. Tap a day (or a person on a phone) to see and fix the punches. */
export default function Timesheets({
  people, entries, period, rules, todayKey, nowMs, isCurrentPeriod, approvals, approvalsOn, canChangeRules, onPeriod, onOpen, onPayroll, onRules,
}: {
  people: Person[]
  entries: ClockEntry[]
  period: { start: string; days: number }
  rules: TimeRules
  todayKey: string
  nowMs: number
  isCurrentPeriod: boolean
  approvals: Approval[]
  approvalsOn: boolean
  canChangeRules: boolean
  onPeriod: (delta: -1 | 0 | 1) => void
  onOpen: (p: Person, day: string | null) => void
  onPayroll: () => void
  onRules: () => void
}) {
  const keys = useMemo(() => periodKeys(period.start, period.days), [period])
  const rows = useMemo(() => {
    // Everyone on the team, plus anyone who has left but still has hours in this period.
    return people
      .map(p => {
        const v = personPeriod(p, entries, period.start, period.days, rules, nowMs)
        const running = v.entries.some(e => !e.clock_out && !isStale(e, nowMs))
        const fix = reviewFlags(v, period.start, period.days, todayKey, nowMs).filter(f => f.severity === 'fix').length
        const state = approvalState(approvals.find(a => a.staff_id === p.id && a.period_start === period.start), v.entryMinutes)
        return { p, v, running, fix, state }
      })
      .filter(r => r.p.active || r.v.entries.length > 0)
      .sort((a, b) => a.p.name.localeCompare(b.p.name))
  }, [people, entries, period, rules, nowMs, todayKey, approvals])

  const dayTotals = keys.map((_, i) => rows.reduce((s, r) => s + r.v.perDay[i], 0))
  const grand = rows.reduce((s, r) => s + r.v.totalMinutes, 0)
  const anyHours = grand > 0
  const ot = rows.reduce((s, r) => s + r.v.split.overtime + r.v.split.double, 0)
  const label = periodLabel(period.start, period.days)
  const step = period.days === 14 ? 'pay period' : 'week'

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-secondary !px-3" onClick={() => onPeriod(-1)} aria-label={`Previous ${step}`}><Icon name="chevronLeft" className="h-5 w-5" /></button>
          <h2 className="num min-w-0 flex-1 text-center text-[1rem] font-bold sm:min-w-[15rem] sm:flex-none" aria-live="polite">{label}</h2>
          <button type="button" className="btn btn-secondary !px-3" onClick={() => onPeriod(1)} aria-label={`Next ${step}`} disabled={isCurrentPeriod}><Icon name="chevronRight" className="h-5 w-5" /></button>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isCurrentPeriod && <button type="button" className="btn btn-secondary flex-1 sm:flex-none" onClick={() => onPeriod(0)}>{period.days === 14 ? 'This pay period' : 'This week'}</button>}
          <button type="button" className="btn btn-secondary flex-1 sm:flex-none" onClick={onRules}><Icon name="settings" className="h-5 w-5" />Pay rules</button>
          <button type="button" className="btn btn-secondary flex-1 sm:flex-none" onClick={onPayroll} disabled={!anyHours}><Icon name="download" className="h-5 w-5" />Payroll file</button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          <p className="font-bold text-text-primary">No one to show yet</p>
          <p className="mx-auto mt-1 max-w-md">Add people on the People tab. Their hours show here as they clock in and out.</p>
        </div>
      ) : (
        <>
          {/* Phones: one row per person with the period's total. */}
          <ul className="ledger md:hidden">
            {rows.map(({ p, v, running, fix, state }) => {
              const over = v.split.overtime + v.split.double
              const days = v.perDay.filter(m => m > 0).length
              return (
                <li key={p.id}>
                  <button type="button" className="ledger-row" onClick={() => onOpen(p, null)}>
                    <Avatar name={p.name} />
                    <span className="ledger-main">
                      <span className="ledger-title block">{p.name}{p.active ? '' : ' (former)'}</span>
                      <span className="ledger-sub block">
                        {days === 0 ? 'No hours' : `${days} ${days === 1 ? 'day' : 'days'}`}
                        {running ? ', on the clock now' : ''}
                      </span>
                      {fix > 0 && <span className="mt-0.5 flex items-center gap-1.5 text-[0.8125rem] font-bold text-red"><span className="lamp lamp-red !h-2.5 !w-2.5" aria-hidden="true" />Needs a clock-out</span>}
                      {over > 0 && <span className="mt-0.5 flex items-center gap-1.5 text-[0.8125rem] font-bold text-amber"><span className="lamp lamp-amber !h-2.5 !w-2.5" aria-hidden="true" />Overtime {fmtDuration(over)}</span>}
                      {approvalsOn && v.totalMinutes > 0 && <span className="mt-0.5 flex items-center gap-1.5 text-[0.8125rem] text-text-secondary"><span className={`lamp ${STATE_WORDS[state].lamp} !h-2.5 !w-2.5`} aria-hidden="true" />{STATE_WORDS[state].word}</span>}
                    </span>
                    <span className="ledger-amt">{v.totalMinutes > 0 ? fmtDuration(v.totalMinutes) : '0m'}</span>
                    <Icon name="chevronRight" className="h-5 w-5 shrink-0 text-text-muted" />
                  </button>
                </li>
              )
            })}
            <li>
              <div className="ledger-row !min-h-[3rem] font-bold">
                <span className="ledger-main">Team total</span>
                <span className="ledger-amt">{fmtDuration(grand)}</span>
              </div>
            </li>
          </ul>

          {/* Larger screens: the whole period at a glance. */}
          <div className="hidden overflow-x-auto rounded-md border border-border bg-bg-card md:block">
            <table className="w-full border-collapse text-[0.9375rem]">
              <caption className="sr-only">Hours worked each day, {label}. Tap a day to see the punches.</caption>
              <thead>
                <tr className="border-b border-border bg-bg-chrome">
                  <th scope="col" className="px-3 py-2 text-left font-bold">Person</th>
                  {keys.map(k => (
                    <th key={k} scope="col" className={`${period.days === 14 ? 'w-[3.75rem]' : 'w-[5.5rem]'} px-1 py-2 text-center font-bold ${k === todayKey ? 'bg-blue/10 text-blue' : ''}`}>
                      {dayLabel(k, 'weekday')}
                      <span className="num block text-[0.8125rem] font-normal text-text-secondary">{k.slice(8).replace(/^0/, '')}</span>
                    </th>
                  ))}
                  <th scope="col" className="w-[12rem] px-3 py-2 text-right font-bold">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, v, fix, state }) => {
                  const over = v.split.overtime + v.split.double
                  return (
                    <tr key={p.id} className="border-b border-border last:border-b-0">
                      <th scope="row" className="px-3 py-1 text-left font-bold">
                        <button type="button" className="-mx-1.5 flex min-h-[44px] w-[calc(100%+0.75rem)] items-center gap-2.5 rounded-md px-1.5 text-left hover:bg-bg-hover" onClick={() => onOpen(p, null)}>
                          <Avatar name={p.name} size={32} />
                          <span className="min-w-0 truncate">{p.name}{p.active ? '' : ' (former)'}</span>
                        </button>
                      </th>
                      {keys.map((k, i) => {
                        const m = v.perDay[i]
                        const live = v.entries.some(e => !e.clock_out && !isStale(e, nowMs) && entryDay(e) === k)
                        const broken = v.entries.some(e => isStale(e, nowMs) && entryDay(e) === k)
                        return (
                          <td key={k} className={`p-0 text-center ${k === todayKey ? 'bg-blue/[0.05]' : ''}`}>
                            <button
                              type="button"
                              className="num flex min-h-[44px] w-full items-center justify-center gap-1 hover:bg-bg-hover"
                              onClick={() => onOpen(p, k)}
                              aria-label={`${p.name}, ${dayLabel(k)}: ${m > 0 ? fmtDuration(m) : 'no hours'}${live ? ', still clocked in' : ''}${broken ? ', forgot to clock out, needs fixing' : ''}`}
                            >
                              {live && <span className="lamp lamp-blue !h-2.5 !w-2.5" aria-hidden="true" />}
                              {broken && <Icon name="alert" className="h-4 w-4 text-red" />}
                              {m > 0 ? fmtClock(m) : <span className="text-text-muted" aria-hidden="true">–</span>}
                            </button>
                          </td>
                        )
                      })}
                      <td className="whitespace-nowrap px-3 py-1 text-right">
                        <span className="num block font-bold">{v.totalMinutes > 0 ? fmtClock(v.totalMinutes) : '–'}</span>
                        {fix > 0 && <span className="flex items-center justify-end gap-1.5 text-[0.8125rem] font-bold text-red"><span className="lamp lamp-red !h-2.5 !w-2.5" aria-hidden="true" />Needs a clock-out</span>}
                        {over > 0 && <span className="flex items-center justify-end gap-1.5 text-[0.8125rem] font-bold text-amber"><span className="lamp lamp-amber !h-2.5 !w-2.5" aria-hidden="true" />Overtime {fmtClock(over)}</span>}
                        {approvalsOn && v.totalMinutes > 0 && <span className="flex items-center justify-end gap-1.5 text-[0.8125rem] text-text-secondary"><span className={`lamp ${STATE_WORDS[state].lamp} !h-2.5 !w-2.5`} aria-hidden="true" />{STATE_WORDS[state].word}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-bg-chrome font-bold">
                  <th scope="row" className="px-3 py-2 text-left">Team total</th>
                  {dayTotals.map((m, i) => <td key={keys[i]} className="num px-1 py-2 text-center">{m > 0 ? fmtClock(m) : <span className="text-text-muted" aria-hidden="true">–</span>}</td>)}
                  <td className="num px-3 py-2 text-right">{fmtClock(grand)}{ot > 0 && <span className="block text-[0.8125rem] font-normal text-text-secondary">{fmtClock(ot)} overtime</span>}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-3 text-[0.875rem] text-text-secondary">
            Hours are shown as hours and minutes, so 7:42 is 7 hours 42 minutes. The pay week starts on {WEEKDAY_NAMES[rules.weekStart]}{period.days === 14 ? ' and you pay every two weeks' : ''}. A shift counts on the day it started. Breaks are taken off. {describeRules(rules)}
            {canChangeRules ? '' : ' An owner or admin can change these in Pay rules.'}
          </p>
        </>
      )}
    </div>
  )
}
