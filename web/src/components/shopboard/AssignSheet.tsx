'use client'
import Icon from '@/components/Icon'
import { DueLine } from '@/components/jobs/JobCards'
import { carLine, openedLabel, roShort, statusLamp, statusWord } from '@/components/jobs/types'
import { isUnassigned, normName } from '@/lib/shopboard'
import type { ClockState } from '@/lib/timeclock'
import type { BoardJob } from './types'

export interface TechChoice { name: string; state: ClockState | null }

const STATE_WORD: Record<ClockState, { word: string; lamp: 'green' | 'amber' | 'off' }> = {
  in: { word: 'Clocked in', lamp: 'green' },
  break: { word: 'On break', lamp: 'amber' },
  out: { word: 'Clocked out', lamp: 'off' },
}

/** Who has this car? Pick a name, or take it back. Works the same on a phone, where there is no dragging. */
export default function AssignSheet({ job, techs, todayKey, busy, error, onAssign }: {
  job: BoardJob
  techs: TechChoice[]
  todayKey: string
  busy: boolean
  error: string
  onAssign: (name: string) => void
}) {
  const lamp = statusLamp(job.status)
  const current = isUnassigned(job.tech) ? '' : normName(job.tech)
  const known = techs.some(t => normName(t.name) === current)
  return (
    <div>
      <div className="rounded-md border border-border bg-bg-base px-3 py-3">
        <p className="flex items-start justify-between gap-3">
          <span className="min-w-0 break-words font-bold">{job.customer_name || 'No name'}</span>
          {job.ro_number && <span className="num shrink-0 text-[0.875rem] text-text-secondary">{roShort(job.ro_number)}</span>}
        </p>
        <p className="text-[0.9375rem] text-text-secondary">{carLine(job) || 'No vehicle noted'}</p>
        {job.concern && <p className="mt-1.5 text-[0.9375rem]">{job.concern}</p>}
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.875rem] text-text-secondary">
          <span className="flex items-center gap-1.5"><span className={`lamp lamp-${lamp}`} aria-hidden="true" />{statusWord(job.status)}</span>
          <DueLine job={job} todayKey={todayKey} />
          <span>{openedLabel(job.created_at, todayKey)}</span>
        </p>
      </div>

      <h3 className="section-title mt-4">Who has this car?</h3>
      <ul className="ledger mt-1" aria-label="Technicians">
        <li>
          <button type="button" className="ledger-row" disabled={busy} onClick={() => onAssign('')} aria-pressed={current === ''}>
            <span className="ledger-main"><span className="ledger-title block">Unassigned</span><span className="ledger-sub block">Nobody has it yet</span></span>
            {current === '' && <Icon name="check" className="h-5 w-5 shrink-0 text-blue" strokeWidth={2.4} />}
          </button>
        </li>
        {techs.map(t => {
          const on = normName(t.name) === current
          const s = t.state ? STATE_WORD[t.state] : null
          return (
            <li key={t.name}>
              <button type="button" className="ledger-row" disabled={busy} onClick={() => onAssign(t.name)} aria-pressed={on}>
                <span className="ledger-main">
                  <span className="ledger-title block">{t.name}</span>
                  {s && <span className="ledger-sub flex items-center gap-1.5"><span className={`lamp lamp-${s.lamp} !h-2.5 !w-2.5`} aria-hidden="true" />{s.word}</span>}
                </span>
                {on && <Icon name="check" className="h-5 w-5 shrink-0 text-blue" strokeWidth={2.4} />}
              </button>
            </li>
          )
        })}
        {!known && current !== '' && (
          <li>
            <div className="ledger-row" aria-current="true">
              <span className="ledger-main"><span className="ledger-title block">{job.tech}</span><span className="ledger-sub block">Not on your team list</span></span>
              <Icon name="check" className="h-5 w-5 shrink-0 text-blue" strokeWidth={2.4} />
            </div>
          </li>
        )}
      </ul>
      {techs.length === 0 && <p className="mt-2 text-[0.9375rem] text-text-secondary">No technicians yet. <a href="/staff">Add them on the Team screen</a> and they will show up here.</p>}
      {error && <p role="alert" className="form-error">{error}</p>}
      <a className="btn btn-secondary mt-4 w-full no-underline" href={`/jobs?job=${encodeURIComponent(job.id)}`}>
        <Icon name="work" className="h-5 w-5" />Open the full job
      </a>
    </div>
  )
}
