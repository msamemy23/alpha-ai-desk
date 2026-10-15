'use client'
import { useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import { breakMinutes, dayKey, dayLabel, fmtDuration, fmtTimeOfDay, fromLocalInput, hoursFor, noteText, toLocalInput, validateEntry } from '@/lib/timeclock'
import type { ClockEntry, Person } from '@/lib/timeclock'

const REASONS = ['Forgot to clock in', 'Forgot to clock out', 'Clock was down', 'Wrong time punched']

export interface EntryPayload { id?: number; clock_in: string; clock_out: string | null; reason: string }

/** Add a missed punch, or fix one. Every change needs a reason, and it stays on the entry. */
export default function EntryForm({ person, entry, others, nowMs, defaultDay, busy, error, onSave, onDelete, onCancel }: {
  person: Person
  /** The entry being fixed, or null when adding one. */
  entry: ClockEntry | null
  /** This person's other entries, to catch overlaps before saving. */
  others: ClockEntry[]
  nowMs: number
  /** yyyy-mm-dd the form starts on when adding. */
  defaultDay: string
  busy: boolean
  error: string
  onSave: (p: EntryPayload) => void
  /** Called with the reason for removing the entry. */
  onDelete?: (reason: string) => void
  onCancel: () => void
}) {
  const stillOpen = !!entry && !entry.clock_out
  const [start, setStart] = useState(() => (entry ? toLocalInput(entry.clock_in) : `${defaultDay}T08:00`))
  const [end, setEnd] = useState(() => {
    if (entry) return toLocalInput(entry.clock_out)
    const five = `${defaultDay}T17:00`
    // Never offer a clock-out that is still in the future.
    return nowMs && Date.parse(five) > nowMs ? toLocalInput(new Date(nowMs).toISOString()) : five
  })
  const [reason, setReason] = useState(() => (entry ? noteText(entry.note) : ''))
  const [shown, setShown] = useState('')
  const [confirming, setConfirming] = useState(false)

  const startIso = fromLocalInput(start)
  const endIso = fromLocalInput(end)
  const problem = useMemo(() => {
    if (!startIso) return 'Enter the clock-in time.'
    if (!endIso && !stillOpen) return 'Enter the clock-out time.'
    if (end && !endIso) return 'Enter a valid clock-out time.'
    return validateEntry({ clock_in: startIso, clock_out: endIso }, { nowMs: nowMs || Date.now(), others, selfId: entry?.id ?? null, allowOpen: stillOpen })
  }, [startIso, endIso, end, stillOpen, nowMs, others, entry])

  const preview = !problem && startIso && endIso ? fmtDuration(hoursFor(startIso, endIso, entry ? breakMinutes(entry, nowMs) : 0) * 60) : ''
  const message = shown || error

  const submit = () => {
    if (reason.trim().length < 3) { setShown('Say why you are changing this, in a few words.'); return }
    if (problem) { setShown(problem); return }
    setShown('')
    onSave({ ...(entry ? { id: entry.id } : {}), clock_in: startIso as string, clock_out: endIso, reason: reason.trim() })
  }

  if (confirming && entry) {
    const remove = () => {
      if (reason.trim().length < 3) { setShown('Say why you are removing this, in a few words.'); return }
      setShown('')
      onDelete?.(reason.trim())
    }
    return (
      <div className="space-y-4">
        <p className="text-[0.9375rem]">
          Remove {person.name}’s entry on {dayLabel(dayKey(new Date(entry.clock_in)))}, {fmtTimeOfDay(entry.clock_in)} to {entry.clock_out ? fmtTimeOfDay(entry.clock_out) : 'now'}?
          It comes off the timesheet. A copy stays in the change history, so an owner or manager can put it back.
        </p>
        <div>
          <label htmlFor="ef-why-del" className="form-label">Why are you removing it?</label>
          <input id="ef-why-del" className="form-input" autoComplete="off" maxLength={140} value={reason} onChange={e => { setReason(e.target.value); setShown('') }} placeholder="Punched in by mistake" />
        </div>
        {(shown || error) && <p role="alert" className="form-error">{shown || error}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={() => { setConfirming(false); setShown('') }} disabled={busy}>Keep entry</button>
          <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>{busy ? 'Removing…' : 'Remove entry'}</button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={e => { e.preventDefault(); submit() }} className="space-y-4" noValidate>
      <button type="button" className="btn btn-ghost btn-sm -ml-2" onClick={onCancel}>
        <Icon name="chevronLeft" className="h-4 w-4" />Back to {person.name}
      </button>
      <p className="font-bold">{entry ? 'Fix a time entry' : 'Add a missed punch'}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="ef-in" className="form-label">Clock in</label>
          <input id="ef-in" type="datetime-local" className="form-input" value={start} onChange={e => { setStart(e.target.value); setShown('') }} required />
        </div>
        <div>
          <label htmlFor="ef-out" className="form-label">Clock out</label>
          <input id="ef-out" type="datetime-local" className="form-input" value={end} onChange={e => { setEnd(e.target.value); setShown('') }} aria-describedby={stillOpen ? 'ef-out-help' : undefined} />
          {stillOpen && <p id="ef-out-help" className="mt-1 text-[0.8125rem] text-text-secondary">Clear this to leave {person.name} clocked in.</p>}
        </div>
      </div>
      {preview && <p className="num text-[0.9375rem] text-text-secondary" aria-live="polite">That is {preview} of work{entry && breakMinutes(entry, nowMs) > 0 ? `, after ${fmtDuration(breakMinutes(entry, nowMs))} of breaks` : ''}.</p>}
      <div>
        <label htmlFor="ef-why" className="form-label">Why are you changing this?</label>
        <input id="ef-why" className="form-input" autoComplete="off" maxLength={140} value={reason} onChange={e => { setReason(e.target.value); setShown('') }} placeholder="Forgot to clock out" />
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Common reasons">
          {REASONS.map(r => (
            <button key={r} type="button" className="inline-flex min-h-[36px] items-center rounded-full border border-line bg-bg-card px-3 text-[0.875rem] font-bold hover:bg-bg-hover" onClick={() => { setReason(r); setShown('') }}>{r}</button>
          ))}
        </div>
      </div>
      {message && <p role="alert" className="form-error">{message}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        {entry && onDelete && <button type="button" className="btn btn-ghost !text-red sm:mr-auto" onClick={() => setConfirming(true)} disabled={busy}><Icon name="trash" className="h-5 w-5" />Remove entry</button>}
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : entry ? 'Save changes' : 'Add entry'}</button>
      </div>
    </form>
  )
}
