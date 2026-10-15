'use client'
import { durationLabel, fmtTime, statusLamp, statusWord } from './types'
import type { Appointment } from './types'

/** One appointment as a ledger row: time on the left, who and what in the middle, status on the right. */
export default function ApptRows({ items, onOpen, showDate }: { items: Appointment[]; onOpen: (a: Appointment) => void; showDate?: (a: Appointment) => string }) {
  return (
    <ul className="ledger">
      {items.map(a => {
        const closed = a.status === 'Cancelled' || a.status === 'No Show'
        const line = [a.service, a.vehicle].filter(Boolean).join(' · ')
        return (
          <li key={a.id}>
            <button type="button" className={`ledger-row ${closed ? 'opacity-70' : ''}`} onClick={() => onOpen(a)}>
              <span className="w-[5.25rem] shrink-0 whitespace-nowrap">
                <span className="num block font-bold">{fmtTime(a.time)}</span>
                <span className="block text-[0.8125rem] text-text-secondary">{showDate ? showDate(a) : durationLabel(Number(a.duration) || 60).replace(' minutes', ' min').replace(' hours', ' h').replace(' hour', ' h')}</span>
              </span>
              <span className="ledger-main">
                <span className={`ledger-title block ${closed ? 'line-through' : ''}`}>{a.customer_name}</span>
                <span className="ledger-sub block">{line || 'No service noted'}{a.tech && a.tech !== 'Unassigned' ? ` · ${a.tech}` : ''}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2 text-[0.875rem] text-text-secondary">
                <span className={`lamp lamp-${statusLamp(a.status)}`} aria-hidden="true" />
                <span className="hidden min-[400px]:inline">{statusWord(a.status)}</span>
                <span className="sr-only min-[400px]:hidden">{statusWord(a.status)}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}
