'use client'
import { DueLine } from '@/components/jobs/JobCards'
import { carLine, roShort, stageOf, statusLamp, statusWord } from '@/components/jobs/types'
import Icon from '@/components/Icon'
import { PARTS_SHORT, PARTS_TONE, hoursLabel, partsAttention, promiseInfo, shortYmd } from '@/lib/jobflow'
import type { JobFlow } from '@/lib/jobflow'
import type { BoardJob } from './types'

const PARTS_LAMP = { off: 'lamp-off', red: 'lamp-red', amber: 'lamp-amber', green: 'lamp-green' } as const

/** One car on a technician's column. Tap to give it to someone else or open it. On a computer, drag it to another column. */
export default function BoardCard({ job, flow, todayKey, nowMinutes, draggable, dragging, onOpen, onDragStart, onDragEnd }: {
  job: BoardJob
  /** Parts, labels, hours and the promised time for this car. Missing until the shop sets any. */
  flow?: JobFlow
  todayKey: string
  /** Minutes since midnight, for a promised time earlier today. */
  nowMinutes: number
  draggable: boolean
  dragging: boolean
  onOpen: (j: BoardJob) => void
  onDragStart: (j: BoardJob) => void
  onDragEnd: () => void
}) {
  const lamp = statusLamp(job.status)
  const rush = job.priority === 'Rush' || job.priority === 'High'
  const finished = stageOf(job.status).key === 'ready'
  const promise = flow?.promise_time && job.promise_date
    ? promiseInfo({ date: job.promise_date, time: flow.promise_time, finished, now: { ymd: todayKey, minutes: nowMinutes } })
    : null
  const attention = partsAttention(flow, finished, todayKey)
  const showParts = flow && flow.parts !== 'none'
  return (
    <div
      className={`rotag lamp-${lamp} !pb-2.5 ${draggable ? 'cursor-grab active:cursor-grabbing' : ''} ${dragging ? 'opacity-50' : ''}`}
      draggable={draggable}
      onDragStart={e => { e.dataTransfer.setData('text/plain', job.id); e.dataTransfer.effectAllowed = 'move'; onDragStart(job) }}
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
          <span className="flex items-center gap-1.5 text-[0.8125rem] text-text-secondary">
            <span className={`lamp lamp-${lamp} !h-2.5 !w-2.5`} aria-hidden="true" />{statusWord(job.status)}
          </span>
          {promise && promise.tone !== 'none' ? (
            <span className={`inline-flex items-center gap-1 text-[0.8125rem] ${promise.tone === 'late' ? 'font-bold text-red' : promise.tone === 'soon' ? 'font-bold text-amber' : 'text-text-secondary'}`}>
              {promise.tone === 'late' && <Icon name="alert" className="h-4 w-4" />}
              {promise.text}
            </span>
          ) : <DueLine job={job} todayKey={todayKey} />}
          {rush && <span className="tag tag-red">{job.priority === 'Rush' ? 'Rush' : 'High priority'}</span>}
        </span>
        {flow && (showParts || flow.labels.length > 0 || flow.est_hours !== null) && (
          <span className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
            {showParts && (
              <span className={`flex items-center gap-1.5 text-[0.8125rem] ${attention ? 'font-bold text-red' : 'text-text-secondary'}`}>
                <span className={`lamp ${PARTS_LAMP[PARTS_TONE[flow.parts]]} !h-2.5 !w-2.5`} aria-hidden="true" />
                <span>
                  {PARTS_SHORT[flow.parts]}
                  {flow.parts_eta && flow.parts !== 'in' && <span className="num font-normal">{attention === 'late' ? `, was due ${shortYmd(flow.parts_eta)}` : `, due ${shortYmd(flow.parts_eta)}`}</span>}
                </span>
              </span>
            )}
            {flow.est_hours !== null && <span className="num text-[0.8125rem] text-text-secondary">{hoursLabel(flow.est_hours)}</span>}
            {flow.labels.map(l => <span key={l} className="tag tag-blue">{l}</span>)}
          </span>
        )}
      </button>
    </div>
  )
}
