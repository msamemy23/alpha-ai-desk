'use client'
import { useMemo } from 'react'
import Icon from '@/components/Icon'
import { ErrorCard } from '@/components/ListKit'
import { usd } from '@/lib/list-logic'
import { dayKey, fmtDuration, isTechnician } from '@/lib/timeclock'
import type { ClockEntry, Person } from '@/lib/timeclock'
import { periodKeys } from '@/lib/timerules'
import type { TimeRules } from '@/lib/timerules'
import { personPeriod } from '@/lib/payroll'
import { productivityFor, techRows } from '@/lib/productivity'
import { jobMinutesFor, normName } from '@/lib/jobtime'
import type { JobResult, JobSegment, PayRate } from '@/lib/jobtime'
import { useBilledJobs } from './useBilledJobs'

const hours = (n: number): string => (Math.round(n * 10) / 10).toFixed(1)

/** Efficiency colour comes with its words: 100% or more is on or ahead of what was sold. */
function effLamp(e: number | null): 'green' | 'amber' | 'red' | 'off' {
  if (e === null) return 'off'
  return e >= 100 ? 'green' : e >= 80 ? 'amber' : 'red'
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-border bg-bg-card px-3 py-2.5">
      <p className="text-[0.8125rem] font-bold uppercase tracking-wide text-text-secondary">{label}</p>
      <p className="num mt-0.5 text-[1.125rem] font-bold leading-tight sm:text-[1.375rem]">{value}</p>
      {sub && <p className="text-[0.8125rem] text-text-secondary">{sub}</p>}
    </div>
  )
}

/**
 * Technician efficiency for a pay period: hours sold on the repair orders billed in it against the hours actually worked on them,
 * the labor rate that works out to, and, for owners and admins, gross profit where every number it needs is known.
 */
export default function Efficiency({ people, entries, segmentsInPeriod, period, rules, nowMs, canSeeMoney, rates, range, onOpenPerson }: {
  people: Person[]
  entries: ClockEntry[]
  /** Time on repair orders that started in this period, for hours on the clock versus hours on jobs. */
  segmentsInPeriod: JobSegment[]
  period: { start: string; days: number }
  rules: TimeRules
  nowMs: number
  canSeeMoney: boolean
  rates: Map<number, PayRate>
  range: { from: string; to: string; fromIso: string; toIso: string } | null
  onOpenPerson: (p: Person) => void
}) {
  const billed = useBilledJobs(range, true)
  const keys = useMemo(() => periodKeys(period.start, period.days), [period])

  const result = useMemo(() => {
    if (!billed.data) return null
    const names = new Map<string, string>()
    const cost = new Map<string, number>()
    for (const p of people) {
      names.set(normName(p.name), p.name)
      const r = rates.get(p.id)
      if (canSeeMoney && r && r.method === 'hourly' && r.hourly !== null) cost.set(normName(p.name), r.hourly)
    }
    return productivityFor({ jobs: billed.data.jobs, docs: billed.data.docs, segments: billed.data.segments, costRates: cost, names, from: keys[0], to: keys[keys.length - 1], nowMs })
  }, [billed.data, people, rates, canSeeMoney, keys, nowMs])

  const techs = useMemo(() => {
    if (!result) return []
    const list = people.filter(p => isTechnician(p.role))
    const clocked = new Map<number, number>()
    const onJobs = new Map<number, number>()
    const set = new Set(keys)
    const dayOf = (iso: string) => dayKey(new Date(iso))
    for (const p of list) {
      clocked.set(p.id, personPeriod(p, entries, period.start, period.days, rules, nowMs).totalMinutes)
      onJobs.set(p.id, jobMinutesFor(segmentsInPeriod, p, set, dayOf, nowMs))
    }
    return techRows(list.map(p => ({ id: p.id, name: p.name })), clocked, onJobs, result.jobs)
  }, [result, people, entries, segmentsInPeriod, period, rules, keys, nowMs])

  if (billed.error) return <ErrorCard title="Efficiency did not load" message={billed.error} onRetry={() => void billed.reload()} />
  if (billed.loading || !result) {
    return <div className="space-y-2" aria-busy="true" aria-label="Loading efficiency">{[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-[4.25rem]" />)}</div>
  }

  const t = result.totals
  const personById = new Map(people.map(p => [p.id, p]))

  return (
    <div className="space-y-5">
      <div>
        <h2 className="section-title">Efficiency</h2>
        <p className="mt-1 text-[0.9375rem] text-text-secondary">
          Efficiency is the hours sold on a repair order divided by the hours a technician worked on it. 100% means the work took as long as it was sold for. Only repair orders invoiced in this pay period, with time logged on them, count.
        </p>
      </div>

      {result.jobs.length === 0 ? (
        <div className="empty-state">
          <Icon name="wrench" className="mx-auto mb-3 h-8 w-8 text-text-muted" />
          <p className="font-bold text-text-primary">No invoiced repair orders in this pay period</p>
          <p className="mx-auto mt-1 max-w-md">When a repair order linked to an invoice is dated inside this period, it shows here. Technicians start a job from their row in Today or on the shop tablet, so the hours worked can be compared with the hours sold.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat label="Efficiency" value={t.efficiency === null ? 'No time yet' : `${Math.round(t.efficiency)}%`} sub={t.efficiency === null ? 'No job has time logged on it' : `${hours(t.trackedSoldHours)} hours sold, ${hours(t.trackedMinutes / 60)} worked`} />
            <Stat label="Labor rate you earn" value={t.effectiveRate === null ? 'No time yet' : `${usd(t.effectiveRate)} an hour`} sub="Labor sold divided by hours worked on it" />
            <Stat label="Hours sold" value={hours(t.soldHours)} sub={`${result.jobs.length} ${result.jobs.length === 1 ? 'repair order' : 'repair orders'}`} />
            {canSeeMoney
              ? <Stat label="Gross profit" value={t.grossProfit === null ? 'Not enough data' : usd(t.grossProfit)} sub={t.grossProfit === null ? 'Needs pay rates and part costs' : `On ${t.profitJobs} of ${result.jobs.length} ${result.jobs.length === 1 ? 'job' : 'jobs'} with every number known`} />
              : <Stat label="Labor sold" value={usd(result.jobs.reduce((s, j) => s + j.laborRevenue, 0))} sub="Before parts and tax" />}
          </div>
          {result.untracked > 0 && (
            <div role="status" className="flex items-start gap-2.5 rounded-md border border-border bg-bg-card px-3 py-2.5 text-[0.9375rem]">
              <Icon name="info" className="mt-0.5 h-5 w-5 shrink-0 text-blue" />
              <p className="min-w-0">{result.untracked} of {result.jobs.length} repair orders have no time logged, so they are left out of efficiency. They still count in hours sold.</p>
            </div>
          )}
          {billed.capped && <p role="status" className="text-[0.875rem] text-text-secondary">A very busy period: only the newest 1,500 invoices were read, so some repair orders may be missing.</p>}

          <section aria-label="By technician">
            <h3 className="section-title">By technician</h3>
            {techs.length === 0 ? (
              <p className="mt-2 rounded-md border border-dashed border-border px-3 py-5 text-center text-[0.9375rem] text-text-secondary">No technician has hours or sales in this pay period.</p>
            ) : (
              <>
                <ul className="ledger mt-2 md:hidden">
                  {techs.map(r => {
                    const p = personById.get(r.id)
                    return (
                      <li key={r.id}>
                        <button type="button" className="ledger-row" onClick={() => p && onOpenPerson(p)}>
                          <span className="ledger-main">
                            <span className="ledger-title block">{r.tech}</span>
                            <span className="ledger-sub block">{fmtDuration(r.clockedMinutes)} clocked · {r.utilization === null ? 'no time on jobs' : `${r.utilization}% on jobs`}</span>
                            <span className="ledger-sub block">{hours(r.soldHours)} hours sold on {r.jobsBilled} {r.jobsBilled === 1 ? 'job' : 'jobs'}</span>
                          </span>
                          <span className="ledger-amt flex items-center gap-1.5"><span className={`lamp lamp-${effLamp(r.efficiency)}`} aria-hidden="true" />{r.efficiency === null ? 'No time' : `${Math.round(r.efficiency)}%`}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
                <div className="mt-2 hidden overflow-x-auto rounded-md border border-border bg-bg-card md:block">
                  <table className="w-full border-collapse text-[0.9375rem]">
                    <caption className="sr-only">Hours and efficiency by technician</caption>
                    <thead>
                      <tr className="border-b border-border bg-bg-chrome text-left">
                        <th scope="col" className="px-3 py-2 font-bold">Technician</th>
                        <th scope="col" className="px-3 py-2 text-right font-bold">Clocked</th>
                        <th scope="col" className="px-3 py-2 text-right font-bold">On repair orders</th>
                        <th scope="col" className="px-3 py-2 text-right font-bold">Hours sold</th>
                        <th scope="col" className="px-3 py-2 text-right font-bold">Efficiency</th>
                        <th scope="col" className="px-3 py-2 text-right font-bold">Labor rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {techs.map(r => {
                        const p = personById.get(r.id)
                        return (
                          <tr key={r.id} className="border-b border-border last:border-b-0">
                            <th scope="row" className="px-3 py-1 text-left font-bold"><button type="button" className="min-h-[44px] text-left hover:underline" onClick={() => p && onOpenPerson(p)}>{r.tech}</button></th>
                            <td className="num px-3 py-1 text-right">{fmtDuration(r.clockedMinutes)}</td>
                            <td className="num px-3 py-1 text-right">{fmtDuration(r.jobMinutes)}{r.utilization !== null && <span className="block text-[0.8125rem] text-text-secondary">{r.utilization}% of clocked time</span>}</td>
                            <td className="num px-3 py-1 text-right">{hours(r.soldHours)}{r.untrackedJobs > 0 && <span className="block text-[0.8125rem] text-text-secondary">{r.untrackedJobs} with no time</span>}</td>
                            <td className="num px-3 py-1 text-right font-bold">
                              {r.efficiency === null ? <span className="font-normal text-text-secondary">No time logged</span> : <span className="inline-flex items-center gap-1.5"><span className={`lamp lamp-${effLamp(r.efficiency)}`} aria-hidden="true" />{Math.round(r.efficiency)}%</span>}
                            </td>
                            <td className="num px-3 py-1 text-right">{r.effectiveRate === null ? <span className="text-text-secondary">–</span> : `${usd(r.effectiveRate)} an hour`}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>

          <section aria-label="By repair order">
            <h3 className="section-title">By repair order</h3>
            <ul className="mt-2 divide-y divide-border rounded-md border border-border bg-bg-card">
              {[...result.jobs].sort((a, b) => b.billedDate.localeCompare(a.billedDate)).map(j => <JobLine key={j.jobId} j={j} canSeeMoney={canSeeMoney} />)}
            </ul>
            <p className="mt-2 text-[0.8125rem] text-text-secondary">
              Hours sold come from the labor lines on the invoice (a line priced as a flat amount with no hours cannot be counted as hours). A labor line with a technician&apos;s name goes to that technician; the rest is shared by time worked.
              {canSeeMoney ? ' Gross profit is labor plus parts sold, less the cost of the parts and of the hourly pay for the time worked. It is shown only when every one of those numbers is known.' : ''}
            </p>
          </section>
        </>
      )}
    </div>
  )
}

function JobLine({ j, canSeeMoney }: { j: JobResult; canSeeMoney: boolean }) {
  return (
    <li className="px-3 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <p className="min-w-0 break-words font-bold">{j.label || 'Repair order'}{j.customer ? <span className="font-normal text-text-secondary"> · {j.customer}</span> : null}</p>
        <p className="num inline-flex items-center gap-1.5 font-bold">
          <span className={`lamp lamp-${effLamp(j.efficiency)}`} aria-hidden="true" />
          {j.efficiency === null ? 'No time logged' : `${Math.round(j.efficiency)}% efficient`}
        </p>
      </div>
      <p className="num text-[0.875rem] text-text-secondary">
        {hours(j.soldHours)} hours sold · {j.workedMinutes > 0 ? `${fmtDuration(j.workedMinutes)} worked` : 'no time worked'} · labor {usd(j.laborRevenue)}
        {j.basis === 'receipt' ? ' · from a receipt' : ''}
      </p>
      {j.shares.length > 1 && <p className="text-[0.8125rem] text-text-secondary">{j.shares.map(s => `${s.tech} ${hours(s.soldHours)} sold${s.workedMinutes > 0 ? `, ${fmtDuration(s.workedMinutes)} worked` : ''}`).join(' · ')}</p>}
      {j.flatNoHours > 0 && <p className="text-[0.8125rem] text-text-secondary">{j.flatNoHours} flat-priced labor {j.flatNoHours === 1 ? 'line has' : 'lines have'} no hours, so {j.flatNoHours === 1 ? 'it is' : 'they are'} not in hours sold.</p>}
      {canSeeMoney && (j.grossProfit !== null
        ? <p className="num text-[0.875rem]"><strong>Gross profit {usd(j.grossProfit)}</strong> <span className="text-text-secondary">(parts cost {usd(j.partsCost ?? 0)}, labor cost {usd(j.laborCost ?? 0)})</span></p>
        : <p className="text-[0.8125rem] text-text-secondary">Gross profit not shown. Missing: {j.missing.join(', ')}.</p>)}
    </li>
  )
}
