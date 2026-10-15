'use client'
import { dayLoad, loadText, hoursText } from '@/lib/schedule-capacity'
import type { CapacitySettings, LoadLevel, Slot } from '@/lib/schedule-capacity'

const LAMP: Record<LoadLevel, string> = { closed: 'lamp-off', open: 'lamp-green', busy: 'lamp-amber', full: 'lamp-amber', over: 'lamp-red' }

/**
 * How full one day is: a bar, a lamp and the words ("Getting busy, 5 h 30 min booked of 14 h").
 * It never blocks anything. Until the shop says how many technicians it has, it only shows the hours booked.
 */
export default function CapacityBar({ cap, appts, ymd, onSettings }: { cap: CapacitySettings; appts: Slot[]; ymd: string; onSettings?: () => void }) {
  const l = dayLoad(cap, appts, ymd)
  if (l.level === 'closed') return <p className="mb-3 text-[0.9375rem] text-text-secondary">The shop is closed this day.</p>
  const pct = Math.min(100, l.pct ?? 0)
  return (
    <div className="mb-3 rounded-md border border-border bg-bg-card px-3 py-2.5">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.9375rem]">
        <span className={`lamp ${LAMP[l.level]} shrink-0`} aria-hidden="true" />
        <span className="font-bold">{l.capacityMinutes ? l.word : 'Booked'}</span>
        <span className="num text-text-secondary">{loadText(l)}</span>
        {l.dropoffs + l.waiters > 0 && <span className="num text-text-secondary">· {l.dropoffs} {l.dropoffs === 1 ? 'drop-off' : 'drop-offs'}, {l.waiters} waiting</span>}
      </p>
      {l.capacityMinutes ? (
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-bg-hover" role="img" aria-label={`${l.pct ?? 0} percent of the day's technician time is booked`}>
          <div className={`h-full rounded-full ${l.level === 'over' ? 'bg-red' : l.level === 'full' || l.level === 'busy' ? 'bg-amber' : 'bg-blue'}`} style={{ width: `${pct}%` }} />
        </div>
      ) : onSettings ? (
        <p className="mt-1 text-[0.8125rem] text-text-secondary">{hoursText(l.bookedMinutes)} of work is booked. <button type="button" className="font-bold text-blue underline underline-offset-2" onClick={onSettings}>Say how many technicians you have</button> to see how full the day is.</p>
      ) : null}
    </div>
  )
}
