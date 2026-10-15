'use client'
import { DueLine } from '@/components/jobs/JobCards'
import { carLine, roShort, statusLamp, statusWord } from '@/components/jobs/types'
import type { BoardJob } from './types'

/** One car on a technician's column. Tap to give it to someone else or open it. On a computer, drag it to another column. */
export default function BoardCard({ job, todayKey, draggable, dragging, onOpen, onDragStart, onDragEnd }: {
  job: BoardJob
  todayKey: string
  draggable: boolean
  dragging: boolean
  onOpen: (j: BoardJob) => void
  onDragStart: (j: BoardJob) => void
  onDragEnd: () => void
}) {
  const lamp = statusLamp(job.status)
  const rush = job.priority === 'Rush' || job.priority === 'High'
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
          <DueLine job={job} todayKey={todayKey} />
          {rush && <span className="tag tag-red">{job.priority === 'Rush' ? 'Rush' : 'High priority'}</span>}
        </span>
      </button>
    </div>
  )
}
