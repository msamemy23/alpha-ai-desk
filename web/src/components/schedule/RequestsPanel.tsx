'use client'
import { useMemo } from 'react'
import Icon from '@/components/Icon'
import { bookingWarnings, missRate } from '@/lib/schedule-capacity'
import type { CapacitySettings, ShopNow } from '@/lib/schedule-capacity'
import { isOnlineBooking } from '@/lib/booking'
import { phoneTail } from '@/components/appointments/errors'
import { phonePretty } from '@/lib/today'
import { dayShort, durationLabel, fmtTime, parseYmd } from './types'
import type { Appointment } from './types'

/**
 * Requests that came in from the public booking page and are waiting for the shop. Each one shows what is tight about
 * the time and whether the number has missed bookings before, so the shop can say yes, suggest another time, or say no.
 * Nothing is texted by accepting or declining. The shop chooses to text the customer afterwards.
 */
export default function RequestsPanel({ requests, all, cap, now, busyId, onAccept, onDecline, onSuggest, onOpen }: {
  requests: Appointment[]
  all: Appointment[]
  cap: CapacitySettings
  now: ShopNow
  busyId: string | null
  onAccept: (a: Appointment) => void
  onDecline: (a: Appointment) => void
  onSuggest: (a: Appointment) => void
  onOpen: (a: Appointment) => void
}) {
  const rows = useMemo(() => requests.map(a => {
    const tail = phoneTail(a.phone)
    const history = tail ? all.filter(x => x.id !== a.id && phoneTail(x.phone) === tail) : []
    const miss = missRate(history)
    const warn = bookingWarnings(cap, all.filter(x => x.id !== a.id), { id: a.id, date: a.date, time: a.time, duration: a.duration, tech: a.tech, kind: a.kind }, { now })
    return { a, miss, warn }
  }), [requests, all, cap, now])

  if (rows.length === 0) return null
  return (
    <section className="panel mb-4" aria-label="Booking requests">
      <div className="panel-header">
        <h2 className="section-title flex items-center gap-2"><span className="lamp lamp-amber" aria-hidden="true" />{rows.length} {rows.length === 1 ? 'request is' : 'requests are'} waiting for you</h2>
      </div>
      <ul className="divide-y divide-border">
        {rows.map(({ a, miss, warn }) => {
          const busy = busyId === a.id
          return (
            <li key={a.id} className="px-4 py-3">
              <button type="button" className="block w-full text-left" onClick={() => onOpen(a)} aria-label={`Open the request from ${a.customer_name}`}>
                <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="font-bold">{a.customer_name}</span>
                  <span className="num text-[0.9375rem]">{dayShort(parseYmd(a.date))}, {fmtTime(a.time)}</span>
                </p>
                <p className="text-[0.9375rem] text-text-secondary">
                  {[a.service, a.vehicle, durationLabel(Number(a.duration) || 60)].filter(Boolean).join(' · ')}
                </p>
                <p className="text-[0.875rem] text-text-secondary">
                  {a.phone ? phonePretty(a.phone) : 'No phone'}{a.kind ? ` · ${a.kind === 'wait' ? 'Will wait' : 'Dropping off'}` : ''}{isOnlineBooking(a.notes) ? ' · Booked online' : ''}
                </p>
              </button>
              {a.notes && <p className="mt-1 break-words rounded-md border border-border bg-bg-base px-2.5 py-1.5 text-[0.875rem]">{a.notes.replace(/^Booked online\.\s*/, '')}</p>}
              {(warn.length > 0 || miss.missed > 0) && (
                <ul className="mt-2 space-y-1" aria-label="Things to know about this request">
                  {miss.missed > 0 && <li className="flex items-start gap-2 text-[0.875rem]"><Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0 text-amber" />This number missed {miss.missed} of {miss.total} earlier {miss.total === 1 ? 'booking' : 'bookings'}.</li>}
                  {warn.map(w => <li key={w.code} className="flex items-start gap-2 text-[0.875rem]"><Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0 text-amber" />{w.text}</li>)}
                </ul>
              )}
              <div className="mt-3 grid grid-cols-3 gap-2">
                <button type="button" className="btn btn-primary" disabled={busy} onClick={() => onAccept(a)}><Icon name="check" className="h-5 w-5" />Accept</button>
                <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => onSuggest(a)}>Other time</button>
                <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => onDecline(a)}>Decline</button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
