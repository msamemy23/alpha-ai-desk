'use client'
import Icon from '@/components/Icon'
import { dayKey, entriesFor, fmtDuration, minutesOnDay, roleLabel, statusOf } from '@/lib/timeclock'
import type { ClockEntry, Person } from '@/lib/timeclock'
import type { ClockAction } from './PersonSheet'
import { Avatar, StatusLine } from './parts'

/** Who is in right now. Clock people in and out here without opening anything. */
export default function TodayView({ people, entries, nowMs, breaks, busyId, onClock, onOpen, onAdd }: {
  people: Person[]
  entries: ClockEntry[]
  nowMs: number
  breaks: boolean
  /** Person being clocked right now, so only their buttons wait. */
  busyId: number | null
  onClock: (p: Person, a: ClockAction) => void
  onOpen: (p: Person) => void
  onAdd: () => void
}) {
  const todayKey = dayKey(new Date(nowMs))
  const rows = people
    .filter(p => p.active)
    .map(p => {
      const mine = entriesFor(entries, p)
      return { p, status: statusOf(mine, p, nowMs), today: minutesOnDay(mine, todayKey, nowMs) }
    })
    // People on the clock first, then everyone else, each group by name.
    .sort((a, b) => (a.status.entry ? 0 : 1) - (b.status.entry ? 0 : 1) || a.p.name.localeCompare(b.p.name))

  if (rows.length === 0) {
    return (
      <div className="empty-state">
        <Icon name="staff" className="mx-auto mb-3 h-8 w-8 text-text-muted" />
        <p className="font-bold text-text-primary">No one on your team yet</p>
        <p className="mx-auto mt-1 max-w-md">Add your technicians and staff. They can then be clocked in and out here and given cars on the Shop board.</p>
        <button type="button" className="btn btn-primary mt-4" onClick={onAdd}><Icon name="plus" className="h-5 w-5" />Add the first person</button>
      </div>
    )
  }

  return (
    <ul className="ledger" aria-label="Team clock">
      {rows.map(({ p, status, today }) => {
        const waiting = busyId === p.id
        return (
          <li key={p.id}>
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2.5 px-3 py-3 sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1.3fr)_5rem_auto] sm:gap-x-4">
              <button type="button" className="-m-1.5 flex min-w-0 items-center gap-3 rounded-md p-1.5 text-left hover:bg-bg-hover" onClick={() => onOpen(p)}>
                <Avatar name={p.name} />
                <span className="min-w-0">
                  <span className="ledger-title block">{p.name}</span>
                  <span className="ledger-sub block">{roleLabel(p.role)}</span>
                </span>
              </button>
              <span className="num text-right sm:order-3">
                <span className="block font-bold">{fmtDuration(today)}</span>
                <span className="block text-[0.8125rem] text-text-secondary">today</span>
              </span>
              <StatusLine status={status} todayKey={todayKey} className="col-span-2 text-[0.9375rem] text-text-secondary sm:order-2 sm:col-span-1" />
              <div className="col-span-2 flex gap-2 sm:order-4 sm:col-span-1">
                {status.overlong ? (
                  <button type="button" className="btn btn-secondary flex-1 sm:flex-none" onClick={() => onOpen(p)} aria-label={`Fix the time for ${p.name}`}>
                    <Icon name="edit" className="h-5 w-5" />Fix time
                  </button>
                ) : status.state === 'out' ? (
                  <button type="button" className="btn btn-primary flex-1 sm:flex-none" disabled={waiting} onClick={() => onClock(p, 'clock_in')} aria-label={`Clock in ${p.name}`}>
                    <Icon name="clock" className="h-5 w-5" />{waiting ? 'Saving…' : 'Clock in'}
                  </button>
                ) : (
                  <>
                    {breaks && status.state === 'in' && (
                      <button type="button" className="btn btn-secondary flex-1 sm:flex-none" disabled={waiting} onClick={() => onClock(p, 'start_break')} aria-label={`Start a break for ${p.name}`}>
                        <Icon name="pause" className="h-5 w-5" />Break
                      </button>
                    )}
                    {status.state === 'break' && (
                      <button type="button" className="btn btn-primary flex-1 sm:flex-none" disabled={waiting} onClick={() => onClock(p, 'end_break')} aria-label={`End the break for ${p.name}`}>
                        <Icon name="play" className="h-5 w-5" />End break
                      </button>
                    )}
                    <button type="button" className="btn btn-secondary flex-1 sm:flex-none" disabled={waiting} onClick={() => onClock(p, 'clock_out')} aria-label={`Clock out ${p.name}`}>
                      {waiting ? 'Saving…' : 'Clock out'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
