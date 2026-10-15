'use client'
import { useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import { ErrorCard, SearchField } from '@/components/ListKit'
import { fmtDuration, fmtTimeOfDay } from '@/lib/timeclock'
import { segmentMinutes } from '@/lib/jobtime'
import type { JobSegment } from '@/lib/jobtime'
import { jobTitle, useOpenJobs } from './useOpenJobs'

/**
 * What a clocked-in person is working on. Starting a job closes the one before it at the same moment, so no minute is counted
 * twice. The minutes feed the efficiency numbers: hours sold on the repair order against hours actually worked on it.
 */
export default function JobPanel({ name, running, nowMs, clockedIn, onBreak, unavailable, busy, onStart, onStop }: {
  name: string
  running: JobSegment | null
  nowMs: number
  clockedIn: boolean
  onBreak: boolean
  /** The database update for job time has not been applied. */
  unavailable: boolean
  busy: boolean
  onStart: (jobId: string) => void
  onStop: () => void
}) {
  const [picking, setPicking] = useState(false)
  const [q, setQ] = useState('')
  const { jobs, loading, error, reload } = useOpenJobs(picking)

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const mine = name.trim().toLowerCase()
    const list = needle ? jobs.filter(j => [j.ro, j.customer, j.car, j.tech].join(' ').toLowerCase().includes(needle)) : jobs
    // Cars given to this person come first.
    return [...list].sort((a, b) => Number(b.tech.toLowerCase() === mine) - Number(a.tech.toLowerCase() === mine))
  }, [jobs, q, name])

  if (unavailable) {
    return <p className="mt-3 text-[0.875rem] text-text-secondary">Tracking time on repair orders needs a database update. Ask whoever set up the app to apply it.</p>
  }
  if (!clockedIn) return null

  return (
    <div className="mt-3 border-t border-border pt-3">
      <p className="text-[0.8125rem] font-bold uppercase tracking-wide text-text-secondary">Working on</p>
      {running ? (
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <p className="min-w-0 break-words font-bold">{running.job_label || 'Repair order'}
            <span className="num ml-2 font-normal text-text-secondary">since {fmtTimeOfDay(running.started_at)} · {fmtDuration(segmentMinutes(running, nowMs))}</span>
          </p>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy || onBreak} onClick={() => setPicking(p => !p)}>Switch job</button>
            <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={onStop}>Stop job</button>
          </div>
        </div>
      ) : (
        <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[0.9375rem] text-text-secondary">Not on a repair order. Time on the clock still counts as shop time.</p>
          <button type="button" className="btn btn-secondary btn-sm" disabled={busy || onBreak} onClick={() => setPicking(p => !p)}>Start a job</button>
        </div>
      )}
      {onBreak && <p className="mt-1 text-[0.875rem] text-text-secondary">End the break before starting a job.</p>}
      {picking && !onBreak && (
        <div className="mt-3 space-y-2">
          <SearchField value={q} onChange={setQ} placeholder="Search by RO, customer or car" label="Search repair orders" />
          {loading ? (
            <div className="space-y-2" aria-busy="true" aria-label="Loading repair orders">{[0, 1, 2].map(i => <div key={i} className="skeleton h-12" />)}</div>
          ) : error ? (
            <ErrorCard message={error} onRetry={() => void reload()} />
          ) : shown.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[0.9375rem] text-text-secondary">{q ? 'No open repair orders match.' : 'There are no open repair orders.'}</p>
          ) : (
            <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border">
              {shown.map(j => (
                <li key={j.id}>
                  <button type="button" className="flex min-h-[48px] w-full items-center gap-3 px-3 py-2 text-left hover:bg-bg-hover disabled:opacity-60" disabled={busy || running?.job_id === j.id} onClick={() => { setPicking(false); setQ(''); onStart(j.id) }}>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">{jobTitle(j)}</span>
                      <span className="block truncate text-[0.875rem] text-text-secondary">{[j.customer, j.tech ? `Tech: ${j.tech}` : ''].filter(Boolean).join(' · ') || j.status}</span>
                    </span>
                    {running?.job_id === j.id ? <span className="text-[0.875rem] font-bold text-text-secondary">Current</span> : <Icon name="chevronRight" className="h-5 w-5 shrink-0 text-text-muted" />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
