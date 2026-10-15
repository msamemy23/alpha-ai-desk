'use client'
import { useMemo } from 'react'
import Icon from '@/components/Icon'
import {
  dayLabel, entriesFor, entryDay, fmtClock, fmtDuration, isStale, minutesInDays, minutesOnDay, overtimeMinutes, weekKeys, weekLabel,
} from '@/lib/timeclock'
import type { ClockEntry, Person } from '@/lib/timeclock'
import { Avatar } from './parts'

/** Hours for the week, one row per person. Tap a day (or a person on a phone) to see and fix the punches. */
export default function Timesheets({ people, entries, weekStart, todayKey, nowMs, isCurrentWeek, onWeek, onOpen, onDownload }: {
  people: Person[]
  entries: ClockEntry[]
  weekStart: string
  todayKey: string
  nowMs: number
  isCurrentWeek: boolean
  onWeek: (delta: -1 | 0 | 1) => void
  onOpen: (p: Person, day: string | null) => void
  onDownload: () => void
}) {
  const keys = useMemo(() => weekKeys(weekStart), [weekStart])
  const rows = useMemo(() => {
    // Everyone on the team, plus anyone who has left but still has hours in this week.
    return people
      .map(p => {
        const mine = entriesFor(entries, p).filter(e => keys.includes(entryDay(e)))
        const perDay = keys.map(k => minutesOnDay(mine, k, nowMs))
        const running = mine.some(e => !e.clock_out && !isStale(e, nowMs))
        const needsFix = mine.some(e => isStale(e, nowMs))
        return { p, mine, perDay, total: minutesInDays(mine, keys, nowMs), running, needsFix }
      })
      .filter(r => r.p.active || r.mine.length > 0)
      .sort((a, b) => a.p.name.localeCompare(b.p.name))
  }, [people, entries, keys, nowMs])

  const dayTotals = keys.map((_, i) => rows.reduce((s, r) => s + r.perDay[i], 0))
  const grand = rows.reduce((s, r) => s + r.total, 0)
  const anyHours = grand > 0

  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-secondary !px-3" onClick={() => onWeek(-1)} aria-label="Previous week"><Icon name="chevronLeft" className="h-5 w-5" /></button>
          <h2 className="num min-w-0 flex-1 text-center text-[1rem] font-bold sm:min-w-[15rem] sm:flex-none" aria-live="polite">{weekLabel(weekStart)}</h2>
          <button type="button" className="btn btn-secondary !px-3" onClick={() => onWeek(1)} aria-label="Next week" disabled={isCurrentWeek}><Icon name="chevronRight" className="h-5 w-5" /></button>
        </div>
        <div className="flex gap-2">
          {!isCurrentWeek && <button type="button" className="btn btn-secondary flex-1 sm:flex-none" onClick={() => onWeek(0)}>This week</button>}
          <button type="button" className="btn btn-secondary flex-1 sm:flex-none" onClick={onDownload} disabled={!anyHours}><Icon name="download" className="h-5 w-5" />Download for payroll</button>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="empty-state">
          <p className="font-bold text-text-primary">No one to show yet</p>
          <p className="mx-auto mt-1 max-w-md">Add people on the People tab. Their hours show here as they clock in and out.</p>
        </div>
      ) : (
        <>
          {/* Phones: one row per person with the week's total. */}
          <ul className="ledger md:hidden">
            {rows.map(({ p, total, perDay, running, needsFix }) => {
              const over = overtimeMinutes(total)
              const days = perDay.filter(m => m > 0).length
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
                      {needsFix && <span className="mt-0.5 flex items-center gap-1.5 text-[0.8125rem] font-bold text-red"><span className="lamp lamp-red !h-2.5 !w-2.5" aria-hidden="true" />Needs a clock-out</span>}
                      {over > 0 && <span className="mt-0.5 flex items-center gap-1.5 text-[0.8125rem] font-bold text-amber"><span className="lamp lamp-amber !h-2.5 !w-2.5" aria-hidden="true" />Overtime {fmtDuration(over)}</span>}
                    </span>
                    <span className="ledger-amt">{total > 0 ? fmtDuration(total) : '0m'}</span>
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

          {/* Larger screens: the whole week at a glance. */}
          <div className="hidden overflow-x-auto rounded-md border border-border bg-bg-card md:block">
            <table className="w-full border-collapse text-[0.9375rem]">
              <caption className="sr-only">Hours worked each day, {weekLabel(weekStart)}. Tap a day to see the punches.</caption>
              <thead>
                <tr className="border-b border-border bg-bg-chrome">
                  <th scope="col" className="px-3 py-2 text-left font-bold">Person</th>
                  {keys.map(k => (
                    <th key={k} scope="col" className={`w-[5.5rem] px-1 py-2 text-center font-bold ${k === todayKey ? 'bg-blue/10 text-blue' : ''}`}>
                      {dayLabel(k, 'weekday')}
                      <span className="num block text-[0.8125rem] font-normal text-text-secondary">{k.slice(8).replace(/^0/, '')}</span>
                    </th>
                  ))}
                  <th scope="col" className="w-[11rem] px-3 py-2 text-right font-bold">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ p, perDay, total, mine, needsFix }) => {
                  const over = overtimeMinutes(total)
                  return (
                    <tr key={p.id} className="border-b border-border last:border-b-0">
                      <th scope="row" className="px-3 py-1 text-left font-bold">
                        <button type="button" className="-mx-1.5 flex min-h-[44px] w-[calc(100%+0.75rem)] items-center gap-2.5 rounded-md px-1.5 text-left hover:bg-bg-hover" onClick={() => onOpen(p, null)}>
                          <Avatar name={p.name} size={32} />
                          <span className="min-w-0 truncate">{p.name}{p.active ? '' : ' (former)'}</span>
                        </button>
                      </th>
                      {keys.map((k, i) => {
                        const m = perDay[i]
                        const live = mine.some(e => !e.clock_out && !isStale(e, nowMs) && entryDay(e) === k)
                        const broken = mine.some(e => isStale(e, nowMs) && entryDay(e) === k)
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
                        <span className="num block font-bold">{total > 0 ? fmtClock(total) : '–'}</span>
                        {needsFix && <span className="flex items-center justify-end gap-1.5 text-[0.8125rem] font-bold text-red"><span className="lamp lamp-red !h-2.5 !w-2.5" aria-hidden="true" />Needs a clock-out</span>}
                        {over > 0 && <span className="flex items-center justify-end gap-1.5 text-[0.8125rem] font-bold text-amber"><span className="lamp lamp-amber !h-2.5 !w-2.5" aria-hidden="true" />Overtime {fmtClock(over)}</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-line bg-bg-chrome font-bold">
                  <th scope="row" className="px-3 py-2 text-left">Team total</th>
                  {dayTotals.map((m, i) => <td key={keys[i]} className="num px-1 py-2 text-center">{m > 0 ? fmtClock(m) : <span className="text-text-muted" aria-hidden="true">–</span>}</td>)}
                  <td className="num px-3 py-2 text-right">{fmtClock(grand)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-3 text-[0.875rem] text-text-secondary">Hours are shown as hours and minutes, so 7:42 is 7 hours 42 minutes. Weeks run Monday to Sunday. A shift counts on the day it started. Breaks are taken off.</p>
        </>
      )}
    </div>
  )
}
