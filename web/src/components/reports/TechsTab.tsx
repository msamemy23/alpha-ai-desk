'use client'
import Link from 'next/link'
import { useMemo } from 'react'
import Notice from '@/components/Notice'
import { initials, isTechnician } from '@/lib/timeclock'
import type { Person } from '@/lib/timeclock'
import { money, money2, spanDays, summarize, techRows } from '@/lib/reports'
import type { ReportJob } from '@/lib/reports'
import { Block, Kpi } from './parts'
import type { Ctx } from './types'
import { useClocked } from './useClocked'

const hrs = (n: number) => `${(Math.round(n * 10) / 10).toLocaleString('en-US')} h`

export default function TechsTab({ ctx, jobs, people, peopleError }: { ctx: Ctx; jobs: ReportJob[]; people: Person[]; peopleError: string }) {
  const { docs, payments, range } = ctx
  const techs = useMemo(() => people.filter(p => isTechnician(p.role)), [people])
  const roster = useMemo(() => techs.filter(p => p.active).map(p => p.name), [techs])
  const clock = useClocked(range, techs, true)

  const rows = useMemo(() => techRows(docs, jobs, range, roster, clock.hours), [docs, jobs, range, roster, clock.hours])
  const sales = useMemo(() => summarize(docs, payments, range), [docs, payments, range])
  const named = rows.reduce((s, r) => s + r.laborBilled, 0)
  const billed = rows.reduce((s, r) => s + r.billedHours, 0)
  const clocked = rows.reduce((s, r) => s + (r.clockedHours || 0), 0)
  const unnamed = Math.max(0, Math.round((sales.labor - named) * 100) / 100)
  const days = spanDays(range)

  if (!rows.length && !peopleError) {
    return (
      <div className="empty-state">
        <p className="font-bold text-text-primary">No technicians yet</p>
        <p className="mx-auto mt-1 max-w-md">Add your technicians on the Team screen, then pick one on each labor line. Hours billed and time on the clock show up here.</p>
        <Link href="/staff" className="btn btn-primary mt-4">Open team</Link>
      </div>
    )
  }
  return (
    <div className="space-y-4">
      {peopleError && <Notice kind="error">The team list did not load, so only technicians named on invoices and jobs are shown. {peopleError}</Notice>}
      {clock.error && <Notice kind="error">Time on the clock did not load. {clock.error}</Notice>}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi label="Labor billed to technicians" value={money(named)} note={sales.labor > 0 ? `${money2(unnamed)} of ${money2(sales.labor)} has no technician named` : 'No labor billed in this period'} />
        <Kpi label="Hours billed" value={hrs(billed)} note="Hourly labor lines only" />
        <Kpi label="Hours on the clock" value={clock.hours ? hrs(clocked) : clock.loading ? 'Loading' : '—'} note={clock.hours ? `In these ${days} ${days === 1 ? 'day' : 'days'}` : 'Not available'} />
      </div>
      {sales.labor > 0 && named === 0 && (
        <Notice kind="info">
          No labor line names a technician in this period, so billed hours cannot be worked out. Pick a technician on each labor line of an invoice and this fills in.
        </Notice>
      )}
      <Block title="By technician">
        <ul className="ledger">
          {rows.map(r => (
            <li key={r.name} className="ledger-row !items-start">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-line bg-bg-chrome text-[0.9375rem] font-bold text-text-secondary" aria-hidden="true">{initials(r.name)}</span>
              <span className="ledger-main">
                <span className="ledger-title block">{r.name}</span>
                <span className="mt-0.5 flex flex-wrap gap-x-3 text-[0.875rem] text-text-secondary">
                  <span className="whitespace-nowrap">{hrs(r.billedHours)} billed</span>
                  <span className="whitespace-nowrap">{money2(r.laborBilled)} labor</span>
                  <span className="whitespace-nowrap">{r.jobs} {r.jobs === 1 ? 'job' : 'jobs'}</span>
                </span>
                <span className="block text-[0.875rem] text-text-secondary">
                  {r.clockedHours === null ? 'Clock hours not available' : `${hrs(r.clockedHours)} on the clock`}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="display num block text-[1.25rem] font-bold">{r.efficiency === null ? '—' : `${r.efficiency}%`}</span>
                <span className="block text-[0.8125rem] text-text-secondary">Efficiency</span>
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[0.875rem] text-text-secondary">
          Efficiency is hours billed divided by hours on the clock. Over 100% means the work was billed for more time than it took. It needs at least an hour on the clock and one billed labor line to show.
        </p>
      </Block>
    </div>
  )
}
