'use client'
import Icon from '@/components/Icon'
import { carLine, dueInfo, nextStep, roShort, statusLamp, statusWord } from './types'
import type { Job, JobDoc } from './types'

/** Late, due soon, or just a date. A word always rides with the colour. */
export function DueLine({ job, todayKey }: { job: Pick<Job, 'promise_date' | 'status'>; todayKey: string }) {
  const due = dueInfo(job, todayKey)
  if (!due) return null
  return (
    <span className={`inline-flex items-center gap-1 text-[0.8125rem] ${due.tone === 'late' ? 'font-bold text-red' : due.tone === 'soon' ? 'font-bold text-amber' : 'text-text-secondary'}`}>
      {due.tone === 'late' && <Icon name="alert" className="h-4 w-4" />}
      {due.text}
    </span>
  )
}

/** One repair order as a hang tag, for the board. Drag it to another column, or tap the next step. */
export function JobTag({ job, docs, todayKey, onOpen, onStep, draggable, onDragStart, onDragEnd }: {
  job: Job
  docs: JobDoc[]
  todayKey: string
  onOpen: (j: Job) => void
  onStep: (j: Job, to: string) => void
  draggable?: boolean
  onDragStart?: (j: Job) => void
  onDragEnd?: () => void
}) {
  const step = nextStep(job, docs)
  const lamp = statusLamp(job.status)
  const rush = job.priority === 'Rush' || job.priority === 'High'
  return (
    <div
      className={`rotag lamp-${lamp} !pb-2.5 ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
      draggable={draggable}
      onDragStart={e => { e.dataTransfer.setData('text/plain', job.id); e.dataTransfer.effectAllowed = 'move'; onDragStart?.(job) }}
      onDragEnd={onDragEnd}
    >
      <button type="button" className="block w-full text-left" onClick={() => onOpen(job)}>
        <span className="flex items-start justify-between gap-2">
          <span className="min-w-0 break-words font-bold leading-snug">{job.customer_name || 'No name'}</span>
          {job.ro_number && <span className="num shrink-0 whitespace-nowrap text-[0.75rem] text-text-secondary">{roShort(job.ro_number)}</span>}
        </span>
        <span className="mt-0.5 block text-[0.875rem] text-text-secondary">{carLine(job) || 'No vehicle noted'}</span>
        {job.concern && <span className="mt-1 line-clamp-2 block text-[0.875rem]">{job.concern}</span>}
        <span className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <DueLine job={job} todayKey={todayKey} />
          {rush && <span className="tag tag-red">{job.priority === 'Rush' ? 'Rush' : 'High priority'}</span>}
          <span className="text-[0.8125rem] text-text-secondary">{job.tech || 'Unassigned'}</span>
        </span>
        <span className="mt-1 flex items-center gap-1.5 text-[0.8125rem] text-text-secondary">
          <span className={`lamp lamp-${lamp} !h-2.5 !w-2.5`} aria-hidden="true" />{statusWord(job.status)}
        </span>
      </button>
      {step && (
        <div className="mt-2.5 border-t border-border pt-2">
          {step.to
            ? <button type="button" className="btn btn-secondary btn-sm w-full" onClick={() => onStep(job, step.to as string)}><Icon name={step.icon} className="h-4 w-4" />{step.label}</button>
            : <a className="btn btn-secondary btn-sm w-full no-underline" href={step.href}><Icon name={step.icon} className="h-4 w-4" />{step.label}</a>}
        </div>
      )}
    </div>
  )
}

/** One repair order as a ledger row, for the list. */
export function JobRows({ jobs, todayKey, onOpen }: { jobs: Job[]; todayKey: string; onOpen: (j: Job) => void }) {
  return (
    <ul className="ledger">
      {jobs.map(j => {
        const lamp = statusLamp(j.status)
        const sub = [carLine(j), j.concern].filter(Boolean).join(' · ')
        return (
          <li key={j.id}>
            <button type="button" className="ledger-row !items-start sm:!items-center" onClick={() => onOpen(j)}>
              <span className="w-[3.75rem] shrink-0 pt-0.5 sm:w-[5.5rem]">
                <span className="num block whitespace-nowrap text-[0.8125rem] font-bold">{j.ro_number ? roShort(j.ro_number) : 'No RO'}</span>
                <span className="block truncate text-[0.75rem] text-text-secondary">{j.tech || 'Unassigned'}</span>
              </span>
              <span className="ledger-main">
                <span className="ledger-title block">{j.customer_name || 'No name'}</span>
                <span className="ledger-sub block">{sub || 'No vehicle or concern noted'}</span>
                {/* Phones: status and due date go on their own line, so the colour always sits beside its word. */}
                <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 sm:hidden">
                  <span className="flex items-center gap-1.5 text-[0.8125rem] text-text-secondary"><span className={`lamp lamp-${lamp} !h-2.5 !w-2.5`} aria-hidden="true" />{statusWord(j.status)}</span>
                  <DueLine job={j} todayKey={todayKey} />
                </span>
              </span>
              <span className="hidden shrink-0 sm:block"><DueLine job={j} todayKey={todayKey} /></span>
              <span className="hidden shrink-0 items-center gap-2 text-[0.875rem] text-text-secondary sm:flex">
                <span className={`lamp lamp-${lamp}`} aria-hidden="true" />
                {statusWord(j.status)}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
