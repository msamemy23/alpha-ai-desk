'use client'
import { useMemo } from 'react'
import Icon from '@/components/Icon'
import { dayLoad } from '@/lib/schedule-capacity'
import type { CapacitySettings, LoadLevel, Slot } from '@/lib/schedule-capacity'
import { addDays, parseYmd, startOfWeek, ymd } from './types'

const LAMP: Record<LoadLevel, string> = { closed: 'lamp-off', open: 'lamp-blue', busy: 'lamp-amber', full: 'lamp-amber', over: 'lamp-red' }

/**
 * A month at a glance. Each day shows how many cars are booked and a lamp for how full it is, with the word in the
 * label for screen readers. Tap a day to open it. Works at phone width: seven narrow columns, each at least 44px tall.
 */
export default function MonthGrid({ month, todayKey, pickedKey, cap, appts, onPick, onMonth }: {
  month: Date
  todayKey: string
  pickedKey: string
  cap: CapacitySettings
  appts: Slot[]
  onPick: (d: Date) => void
  onMonth: (dir: number) => void
}) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const start = startOfWeek(first)
  const weeks = Math.ceil((((first.getDay() + 6) % 7) + new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()) / 7)
  const days = useMemo(() => Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i)), [start, weeks])
  const loads = useMemo(() => new Map(days.map(d => [ymd(d), dayLoad(cap, appts, ymd(d))])), [days, cap, appts])
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <button type="button" className="btn-icon" onClick={() => onMonth(-1)} aria-label="Previous month"><Icon name="chevronLeft" className="h-6 w-6" /></button>
        <h2 className="display min-w-0 flex-1 text-center text-[1.125rem] font-bold" aria-live="polite">{month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</h2>
        <button type="button" className="btn-icon" onClick={() => onMonth(1)} aria-label="Next month"><Icon name="chevronRight" className="h-6 w-6" /></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[0.75rem] font-bold text-text-secondary" aria-hidden="true">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => <span key={d}>{d}</span>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1" role="group" aria-label="Days of the month">
        {days.map(d => {
          const k = ymd(d)
          const l = loads.get(k)
          const inMonth = d.getMonth() === month.getMonth()
          const on = k === pickedKey
          const n = l?.count ?? 0
          const label = `${parseYmd(k).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}: ${l && l.level === 'closed' ? 'closed' : `${n} ${n === 1 ? 'appointment' : 'appointments'}, ${l?.word.toLowerCase() ?? ''}`}`
          return (
            <button key={k} type="button" aria-pressed={on} aria-label={label} onClick={() => onPick(d)}
              className={`flex min-h-[56px] flex-col items-center justify-start rounded-md border px-0.5 py-1.5 ${on ? 'border-blue bg-blue/10 text-blue' : 'border-border bg-bg-card hover:bg-bg-hover'} ${inMonth ? '' : 'opacity-50'} ${l?.level === 'closed' ? 'bg-bg-hover' : ''}`}>
              <span className={`display num text-[1rem] font-bold leading-tight ${k === todayKey && !on ? 'text-blue' : ''}`}>{d.getDate()}</span>
              {l && l.level !== 'closed' && (
                <span className="num mt-0.5 flex items-center gap-1 text-[0.75rem] text-text-secondary">
                  <span className={`lamp ${LAMP[l.level]} !h-2 !w-2`} aria-hidden="true" />{n > 0 ? n : ''}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.8125rem] text-text-secondary">
        <span className="flex items-center gap-1.5"><span className="lamp lamp-blue !h-2 !w-2" aria-hidden="true" />Open</span>
        <span className="flex items-center gap-1.5"><span className="lamp lamp-amber !h-2 !w-2" aria-hidden="true" />Getting busy or nearly full</span>
        <span className="flex items-center gap-1.5"><span className="lamp lamp-red !h-2 !w-2" aria-hidden="true" />Over capacity</span>
      </p>
    </div>
  )
}
