'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { payrollSummary, payrollSummaryCsv, payrollWeeklyCsv } from '@/lib/payroll-export'
import { fileName } from '@/lib/report-files'
import { rangeLabel } from '@/lib/reports'
import { dayLabel, roleLabel } from '@/lib/timeclock'
import { WEEKDAY_NAMES, describeRules } from '@/lib/timerules'
import { useRules } from '@/components/team/useTeam'
import type { Person } from '@/lib/timeclock'
import { saveText } from './files'
import { Block, Kpi } from './parts'
import type { Ctx } from './types'
import { useClockEntries } from './useClockEntries'

const hrs = (n: number) => `${(Math.round(n * 100) / 100).toLocaleString('en-US')} h`

/** Hours worked per person from the time clock, for a payroll provider or an accountant to price. Reads the clock; changes nothing. */
export default function PayrollPanel({ ctx, people, peopleError, retryPeople }: { ctx: Ctx; people: Person[]; peopleError: string; retryPeople: () => void }) {
  const clock = useClockEntries(ctx.range, true)
  // The shop's own pay-week and overtime rules (Team, Rules), so this screen and the Team screen give the same overtime.
  const payRules = useRules()
  const [open, setOpen] = useState<number | null>(null)
  const summary = useMemo(() => payrollSummary(people, clock.entries, ctx.range, clock.now || Date.now(), payRules.rules), [people, clock.entries, ctx.range, clock.now, payRules.rules])

  if (peopleError) return <Notice kind="error"><p className="font-bold">The team list did not load</p><p className="mt-0.5 text-text-secondary">{peopleError}</p><button type="button" className="btn btn-secondary mt-2" onClick={retryPeople}>Try again</button></Notice>
  if (clock.error) return <Notice kind="error"><p className="font-bold">The time clock did not load</p><p className="mt-0.5 text-text-secondary">{clock.error}</p><button type="button" className="btn btn-secondary mt-2" onClick={clock.retry}>Try again</button></Notice>
  if (clock.loading || payRules.loading) return <div className="space-y-3" role="status" aria-label="Loading hours"><div className="skeleton h-24" /><div className="skeleton h-40" /></div>

  return (
    <div className="space-y-4">
      <Notice kind="info">These are hours, not pay. Alpha Desk does not keep pay rates, so give this file to your payroll provider or accountant to price. Pay weeks run {WEEKDAY_NAMES[summary.rules.weekStart]} to {WEEKDAY_NAMES[(summary.rules.weekStart + 6) % 7]}. {describeRules(summary.rules)} Change this under <Link href="/staff" className="font-bold text-blue underline">Team, Rules</Link>.</Notice>
      {payRules.error && <Notice kind="warn"><p className="font-bold">Your pay rules did not load</p><p className="mt-0.5 text-text-secondary">These hours use the plain rule, Monday to Sunday with overtime over 40 hours a week, which may differ from your Team rules. {payRules.error}</p><button type="button" className="btn btn-secondary mt-2" onClick={payRules.reload}>Try again</button></Notice>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Total hours" value={hrs(summary.totalHours)} note={rangeLabel(ctx.range)} />
        <Kpi label="Regular" value={hrs(summary.regularHours)} />
        <Kpi label="Overtime" value={hrs(summary.overtimeHours)} note={summary.doubleHours > 0 ? `Plus ${hrs(summary.doubleHours)} double time` : undefined} />
        <Kpi label="Need a look" value={String(summary.flagged)} note={summary.flagged ? 'Open or forgotten shifts' : 'Every shift is closed'} />
      </div>
      <Block title="Hours by person" right={
        <div className="flex gap-2">
          <button type="button" className="btn btn-secondary btn-sm" disabled={summary.rows.length === 0} onClick={() => saveText(fileName('payroll-hours', ctx.range, 'csv'), payrollSummaryCsv(summary))}><Icon name="download" className="h-5 w-5" />Hours CSV</button>
          <button type="button" className="btn btn-secondary btn-sm" disabled={summary.rows.length === 0} onClick={() => saveText(fileName('payroll-hours-by-week', ctx.range, 'csv'), payrollWeeklyCsv(summary))}><Icon name="download" className="h-5 w-5" />By week</button>
        </div>
      }>
        {summary.rows.length === 0 ? (
          <div className="empty-state"><p className="font-bold text-text-primary">No hours on the clock in these dates</p><p className="mx-auto mt-1 max-w-md">When your team clocks in, their hours show here.</p><Link href="/staff" className="btn btn-primary mt-4">Open team</Link></div>
        ) : (
          <ul className="ledger">
            {summary.rows.map(r => (
              <li key={r.id} className="ledger-row !items-start">
                <span className="ledger-main">
                  <span className="ledger-title block">{r.name}{!r.active && <span className="font-normal text-text-secondary"> (former)</span>}</span>
                  <span className="ledger-sub !whitespace-normal block">{roleLabel(r.role)} · {r.daysWorked} {r.daysWorked === 1 ? 'day' : 'days'} · {r.shifts} {r.shifts === 1 ? 'shift' : 'shifts'}{r.overtimeHours > 0 ? ` · ${hrs(r.overtimeHours)} overtime` : ''}</span>
                  {r.flags.map(f => <span key={f.kind} className="mt-1 flex items-start gap-1.5 text-[0.875rem] text-text-secondary"><span className={`lamp lamp-${f.kind === 'forgotten' || f.kind === 'open' ? 'amber' : 'off'} mt-[0.3rem] shrink-0`} aria-hidden="true" />{f.text}</span>)}
                  <button type="button" className="mt-1 inline-flex min-h-[44px] items-center text-[0.9375rem] font-bold text-blue sm:min-h-[32px]" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>{open === r.id ? 'Hide weeks' : 'Show by week'}</button>
                  {open === r.id && (
                    <ul className="mb-1 divide-y divide-border rounded-md border border-border px-3">
                      {r.weeks.map(w => <li key={w.weekStart} className="flex items-baseline justify-between gap-3 py-2 text-[0.9375rem]"><span>Week of {dayLabel(w.weekStart)}{w.partial ? ' (partial)' : ''}</span><span className="num font-bold">{hrs(w.totalMin / 60)}{w.overtimeMin > 0 ? `, ${hrs(w.overtimeMin / 60)} overtime` : ''}{w.doubleMin > 0 ? `, ${hrs(w.doubleMin / 60)} double time` : ''}</span></li>)}
                    </ul>
                  )}
                </span>
                <span className="ledger-amt">{hrs(r.totalHours)}</span>
              </li>
            ))}
          </ul>
        )}
        {summary.notes.map(n => <p key={n} className="mt-3 text-[0.875rem] text-text-secondary">{n}</p>)}
        <p className="mt-3 text-[0.875rem] text-text-secondary">To fix a missed punch, open <Link href="/staff" className="font-bold text-blue underline">Team</Link>. Changes there show here the next time you open this.</p>
      </Block>
    </div>
  )
}
