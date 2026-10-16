'use client'
import { useState } from 'react'
import Icon from '@/components/Icon'
import JobFlowCard from '@/components/jobs/JobFlowCard'
import StatusLinkCard from '@/components/jobs/StatusLinkCard'
import AssignSheet, { CarSummary } from './AssignSheet'
import type { TechChoice } from './AssignSheet'
import type { BoardJob } from './types'
import type { JobFlow } from '@/lib/jobflow'

type Tab = 'tech' | 'details' | 'customer'
const TABS: { key: Tab; label: string }[] = [
  { key: 'tech', label: 'Technician' },
  { key: 'details', label: 'Parts and time' },
  { key: 'customer', label: 'Customer page' },
]

/**
 * One car from the board: who has it, its parts and hours and promised time, and the page the customer can follow.
 * Three tabs so a phone never shows a long scroll of everything at once.
 */
export default function CarSheet({
  job, techs, todayKey, busy, error, onAssign, flow, flowsAvailable, labelChoices, onFlowSaved, onFlowBusy, onFlowDirty,
}: {
  job: BoardJob
  techs: TechChoice[]
  todayKey: string
  busy: boolean
  error: string
  onAssign: (name: string) => void
  flow: JobFlow | null
  flowsAvailable: boolean | null
  labelChoices: string[]
  onFlowSaved: (f: JobFlow) => void
  onFlowBusy: (busy: boolean) => void
  onFlowDirty: (dirty: boolean) => void
}) {
  const [tab, setTab] = useState<Tab>('tech')
  return (
    <div>
      <CarSummary job={job} todayKey={todayKey} />
      <div role="group" aria-label="What to change on this car" className="mt-3 grid grid-cols-3 gap-2">
        {TABS.map(o => {
          const on = tab === o.key
          return (
            <button
              key={o.key}
              type="button"
              aria-pressed={on}
              onClick={() => setTab(o.key)}
              className={`min-h-[44px] rounded-full border px-2 text-center text-[0.9375rem] font-bold leading-tight transition-colors ${on ? 'border-blue bg-blue/10 text-blue' : 'border-[rgb(var(--c-line))] bg-bg-card text-text-primary hover:bg-bg-hover'}`}
            >
              {o.label}
            </button>
          )
        })}
      </div>

      {tab === 'tech' && <AssignSheet job={job} techs={techs} todayKey={todayKey} busy={busy} error={error} onAssign={onAssign} summary={false} fullJobLink={false} />}

      {/* Kept on the page (only hidden) when another tab is open, so typed changes are not lost by looking at something else. */}
      <div className={tab === 'details' ? '' : 'hidden'}>
        <JobFlowCard
          jobId={job.id}
          promiseDate={job.promise_date ? job.promise_date.slice(0, 10) : null}
          labelChoices={labelChoices}
          flow={flow}
          available={flowsAvailable}
          onSaved={onFlowSaved}
          onBusy={onFlowBusy}
          onDirty={onFlowDirty}
        />
      </div>

      {tab === 'customer' && (
        <>
          <StatusLinkCard jobId={job.id} canText={false} onText={() => undefined} />
          <p className="mt-3 text-[0.875rem] text-text-secondary">To text this link to the customer, open the full job and use Write the text.</p>
        </>
      )}

      <a className="btn btn-secondary mt-5 w-full no-underline" href={`/jobs?job=${encodeURIComponent(job.id)}`}>
        <Icon name="work" className="h-5 w-5" />Open the full job
      </a>
    </div>
  )
}
