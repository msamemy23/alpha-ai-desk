'use client'
import Icon from '@/components/Icon'
import { dayShort, fmtTime, parseYmd } from './types'
import type { Appointment } from './types'

/**
 * Cars that were booked but have not shown up, once the grace time has passed. One tap to text them, mark the no-show,
 * or open the booking. A no-show is never marked by itself: the person at the desk decides.
 */
export default function LateStrip({ items, todayKey, graceMinutes, busyId, onText, onNoShow, onOpen }: {
  items: Appointment[]
  todayKey: string
  graceMinutes: number
  busyId: string | null
  onText: (a: Appointment) => void
  onNoShow: (a: Appointment) => void
  onOpen: (a: Appointment) => void
}) {
  if (items.length === 0) return null
  const shown = items.slice(0, 5)
  return (
    <section className="mb-4 rounded-md border border-amber/50 bg-amber/[0.08]" aria-label="Late arrivals">
      <h2 className="flex items-center gap-2 px-4 pt-3 font-bold"><Icon name="clock" className="h-5 w-5 text-amber" />{items.length} {items.length === 1 ? 'car has' : 'cars have'} not shown up</h2>
      <p className="px-4 text-[0.875rem] text-text-secondary">Flagged {graceMinutes} minutes after the booked time.</p>
      <ul className="mt-1 divide-y divide-border">
        {shown.map(a => {
          const busy = busyId === a.id
          return (
            <li key={a.id} className="px-4 py-2.5">
              <button type="button" className="block w-full text-left" onClick={() => onOpen(a)}>
                <span className="font-bold">{a.customer_name}</span>
                <span className="num text-text-secondary"> · {a.date === todayKey ? fmtTime(a.time) : `${dayShort(parseYmd(a.date))}, ${fmtTime(a.time)}`}</span>
                {a.service && <span className="block text-[0.875rem] text-text-secondary">{a.service}</span>}
              </button>
              <div className="mt-2 flex flex-wrap gap-2">
                {a.phone && <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onText(a)}><Icon name="send" className="h-4 w-4" />Text them</button>}
                <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onNoShow(a)}>Mark no-show</button>
              </div>
            </li>
          )
        })}
      </ul>
      {items.length > shown.length && <p className="px-4 pb-3 pt-1 text-[0.875rem] text-text-secondary">And {items.length - shown.length} more in the list view.</p>}
    </section>
  )
}
