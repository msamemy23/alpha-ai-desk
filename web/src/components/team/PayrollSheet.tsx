'use client'
import { useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import { addDaysKey, dayLabel, decimalHours, entryDay, fmtDuration, timesheetCsv } from '@/lib/timeclock'
import type { ClockEntry, Person } from '@/lib/timeclock'
import { periodKeys } from '@/lib/timerules'
import type { TimeRules } from '@/lib/timerules'
import { approvalState, payrollDetailCsv, payrollFileName, payrollSummaryCsv, personPeriod } from '@/lib/payroll'
import type { Approval } from '@/lib/payroll'
import { downloadCsv } from './download'

type Kind = 'summary' | 'detail' | 'days'

const KINDS: { value: Kind; title: string; help: string }[] = [
  { value: 'summary', title: 'Hours by person', help: 'One line per person: regular, overtime and double-time hours. What most payroll services and accountants want.' },
  { value: 'detail', title: 'Every punch', help: 'One line per clock-in with the day, times, breaks, hours and any reason it was changed. For checking or for a payroll audit.' },
  { value: 'days', title: 'Hours by day', help: 'A grid of each person and each day of the period.' },
]

/** The payroll files for one pay period. Anyone not yet approved is named first, because the file will say "No" next to them. */
export default function PayrollSheet({ people, entries, period, rules, approvals, approvalsOn, nowMs, onDone, onClose }: {
  people: Person[]
  entries: ClockEntry[]
  period: { start: string; days: number }
  rules: TimeRules
  approvals: Approval[]
  approvalsOn: boolean
  nowMs: number
  onDone: (message: string) => void
  onClose: () => void
}) {
  const [kind, setKind] = useState<Kind>('summary')
  const keys = useMemo(() => periodKeys(period.start, period.days), [period])
  const end = addDaysKey(period.start, period.days - 1)

  const rows = useMemo(() => people.map(p => {
    const v = personPeriod(p, entries, period.start, period.days, rules, nowMs)
    const ap = approvals.find(a => a.staff_id === p.id && a.period_start === period.start)
    return { p, v, state: approvalState(ap, v.entryMinutes) }
  }).filter(r => r.v.totalMinutes > 0), [people, entries, period, rules, approvals, nowMs])

  const notApproved = rows.filter(r => r.state !== 'approved')
  const total = rows.reduce((s, r) => s + r.v.totalMinutes, 0)

  const download = () => {
    if (kind === 'days') {
      downloadCsv(`timesheets-${period.start}-to-${end}.csv`, timesheetCsv(people, entries.filter(e => keys.includes(entryDay(e))), nowMs))
    } else if (kind === 'detail') {
      downloadCsv(payrollFileName('detail', period), payrollDetailCsv(people, entries, period, approvals, nowMs))
    } else {
      downloadCsv(payrollFileName('summary', period), payrollSummaryCsv(people, entries, period, rules, approvals, nowMs))
    }
    onDone(`Payroll file for ${dayLabel(period.start)} to ${dayLabel(end)} downloaded.`)
  }

  return (
    <div className="space-y-4">
      <p className="num text-[0.9375rem]">
        <strong>{dayLabel(period.start)} to {dayLabel(end)}</strong>
        <span className="text-text-secondary"> · {rows.length} {rows.length === 1 ? 'person' : 'people'} · {fmtDuration(total)} ({decimalHours(total).toFixed(2)} hours)</span>
      </p>

      {rows.length === 0 ? (
        <div className="empty-state"><p className="font-bold text-text-primary">No hours in this pay period</p><p className="mt-1">There is nothing to put in a payroll file yet. Pick another pay period with the arrows.</p></div>
      ) : (
        <>
          {approvalsOn && notApproved.length > 0 && (
            <div role="status" className="flex items-start gap-2.5 rounded-md border border-amber/50 bg-amber/[0.10] px-3 py-2.5 text-[0.9375rem]">
              <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-amber" />
              <p className="min-w-0">
                {notApproved.length === 1 ? 'This person is' : 'These people are'} not approved for this period: {notApproved.map(r => r.p.name).join(', ')}. You can still download. The file has an Approved column that says No for them.
              </p>
            </div>
          )}
          {!approvalsOn && <p className="text-[0.875rem] text-text-secondary">Approving time needs a database update, so the Approved column will say No for everyone.</p>}

          <div role="radiogroup" aria-label="Which file" className="space-y-2">
            {KINDS.map(k => (
              <label key={k.value} className={`flex min-h-[44px] cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 ${kind === k.value ? 'border-blue bg-blue/[0.06]' : 'border-border bg-bg-card'}`}>
                <input type="radio" name="pay-kind" className="mt-1 h-5 w-5 shrink-0 accent-[rgb(var(--c-blue))]" checked={kind === k.value} onChange={() => setKind(k.value)} />
                <span className="min-w-0"><span className="block font-bold">{k.title}</span><span className="block text-[0.875rem] text-text-secondary">{k.help}</span></span>
              </label>
            ))}
          </div>
          <p className="text-[0.875rem] text-text-secondary">Hours are decimal (7.50 is 7 hours 30 minutes), after breaks. A shift counts on the day it started. These files hold hours only, never pay.</p>
        </>
      )}

      <div className="rounded-md border border-dashed border-border px-3 py-2.5 text-[0.875rem] text-text-secondary">
        <p className="font-bold text-text-primary">Sending hours straight to a payroll service</p>
        <p className="mt-0.5">Not connected yet. It needs you to choose a payroll provider and sign in to it. Until then, download the file and upload it there.</p>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
        <button type="button" className="btn btn-primary" onClick={download} disabled={rows.length === 0}><Icon name="download" className="h-5 w-5" />Download file</button>
      </div>
    </div>
  )
}
