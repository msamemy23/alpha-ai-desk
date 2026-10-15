'use client'
import { useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import {
  breakMinutes, dayKey, dayLabel, entriesFor, entryDay, fmtDuration, isStale, fmtTimeOfDay, minutesInDays, minutesOnDay, overtimeMinutes,
  roleLabel, statusOf, weekKeys, weekLabel, workedMinutes,
} from '@/lib/timeclock'
import type { ClockEntry, Person } from '@/lib/timeclock'
import EntryForm from './EntryForm'
import type { EntryPayload } from './EntryForm'
import PersonForm from './PersonForm'
import { Avatar, EntryNote, StatusLine } from './parts'

export type ClockAction = 'clock_in' | 'clock_out' | 'start_break' | 'end_break'

/** Each call resolves to an error message, or '' when it worked. */
export interface PersonApi {
  clock: (action: ClockAction) => Promise<string>
  saveEntry: (p: EntryPayload) => Promise<string>
  deleteEntry: (id: number) => Promise<string>
  savePerson: (v: { name: string; role: string }) => Promise<string>
  setActive: (active: boolean) => Promise<string>
}

type Mode = { kind: 'view' } | { kind: 'entry'; entry: ClockEntry | null } | { kind: 'person' }

const DONE: Record<ClockAction, string> = {
  clock_in: 'Clocked in.',
  clock_out: 'Clocked out.',
  start_break: 'Break started.',
  end_break: 'Break ended.',
}

/** One person: where they are now, their week of punches, and the ways to fix or change things. */
export default function PersonSheet({ person, entries, weekStart, nowMs, breaks, focusDay, api }: {
  person: Person
  /** Every entry loaded for the week (and any still running). Filtered to this person here. */
  entries: ClockEntry[]
  weekStart: string
  nowMs: number
  breaks: boolean
  focusDay: string | null
  api: PersonApi
}) {
  const [mode, setMode] = useState<Mode>({ kind: 'view' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  const todayKey = nowMs ? dayKey(new Date(nowMs)) : ''
  const mine = useMemo(() => entriesFor(entries, person), [entries, person])
  const keys = useMemo(() => weekKeys(weekStart), [weekStart])
  const inWeek = useMemo(() => mine.filter(e => keys.includes(entryDay(e))).sort((a, b) => Date.parse(a.clock_in) - Date.parse(b.clock_in)), [mine, keys])
  const status = statusOf(mine, person, nowMs)
  const weekMin = minutesInDays(mine, keys, nowMs)
  const over = overtimeMinutes(weekMin)

  const run = async (work: () => Promise<string>, done?: () => void) => {
    setBusy(true); setError(''); setNote('')
    const err = await work()
    setBusy(false)
    if (err) setError(err); else done?.()
  }

  if (mode.kind === 'entry') {
    const entry = mode.entry
    return (
      <EntryForm
        key={entry ? `e${entry.id}` : 'new'}
        person={person}
        entry={entry}
        others={mine}
        nowMs={nowMs}
        defaultDay={focusDay || todayKey || dayKey(new Date())}
        busy={busy}
        error={error}
        onCancel={() => { setError(''); setMode({ kind: 'view' }) }}
        onSave={p => void run(() => api.saveEntry(p), () => { setNote(entry ? 'Entry saved.' : 'Entry added.'); setMode({ kind: 'view' }) })}
        onDelete={entry ? () => void run(() => api.deleteEntry(entry.id), () => { setNote('Entry deleted.'); setMode({ kind: 'view' }) }) : undefined}
      />
    )
  }

  if (mode.kind === 'person') {
    return (
      <PersonForm
        person={person}
        busy={busy}
        error={error}
        onCancel={() => { setError(''); setMode({ kind: 'view' }) }}
        onSave={v => void run(() => api.savePerson(v), () => { setNote('Saved.'); setMode({ kind: 'view' }) })}
        onRemove={() => void run(() => api.setActive(false))}
        onRestore={() => void run(() => api.setActive(true), () => { setNote(`${person.name} is back on the team.`); setMode({ kind: 'view' }) })}
      />
    )
  }

  const clock = (a: ClockAction) => void run(() => api.clock(a), () => setNote(DONE[a]))
  const days = keys.map(k => ({ key: k, list: inWeek.filter(e => entryDay(e) === k) })).filter(d => d.list.length > 0)

  return (
    <div>
      <div className="flex items-center gap-3">
        <Avatar name={person.name} size={48} />
        <div className="min-w-0">
          <p className="truncate font-bold">{person.name}</p>
          <p className="text-[0.9375rem] text-text-secondary">{roleLabel(person.role)}{person.active ? '' : ' · No longer on the team'}</p>
        </div>
      </div>

      {person.active && (
        <div className="mt-4 rounded-md border border-border bg-bg-base px-3 py-3">
          <StatusLine status={status} todayKey={todayKey} className="font-bold" />
          <p className="num mt-1 text-[0.9375rem] text-text-secondary">
            Today {fmtDuration(minutesOnDay(mine, todayKey, nowMs))} · This week {fmtDuration(weekMin)}
          </p>
          {status.overlong && <p className="mt-2 text-[0.9375rem]">This has been running for more than a day, so it needs the real clock-out time. Use Fix on the entry below.</p>}
          <div className={`mt-3 grid grid-cols-2 gap-2 ${status.overlong ? 'hidden' : ''}`}>
            {status.state === 'out' && <button type="button" className="btn btn-primary col-span-2" disabled={busy} onClick={() => clock('clock_in')}><Icon name="clock" className="h-5 w-5" />{busy ? 'Saving…' : 'Clock in'}</button>}
            {status.state === 'in' && breaks && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => clock('start_break')}><Icon name="pause" className="h-5 w-5" />Start break</button>}
            {status.state === 'break' && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => clock('end_break')}><Icon name="play" className="h-5 w-5" />End break</button>}
            {status.state !== 'out' && <button type="button" className={`btn btn-secondary ${breaks ? '' : 'col-span-2'}`} disabled={busy} onClick={() => clock('clock_out')}><Icon name="clock" className="h-5 w-5" />Clock out</button>}
          </div>
        </div>
      )}
      {note && <p role="status" className="mt-3 flex items-center gap-2 text-green"><Icon name="check" className="h-5 w-5" />{note}</p>}
      {error && <p role="alert" className="form-error">{error}</p>}

      <h3 className="section-title mt-5">Week of {weekLabel(weekStart)}</h3>
      <p className="num mt-1 text-[0.9375rem]">
        <strong>{fmtDuration(weekMin)}</strong> worked
        {over > 0 && <span className="ml-2 inline-flex items-center gap-1.5 font-bold text-amber"><span className="lamp lamp-amber" aria-hidden="true" />Overtime: {fmtDuration(over)} over 40 hours</span>}
      </p>
      {days.length === 0 ? (
        <p className="mt-3 rounded-md border border-dashed border-border px-3 py-5 text-center text-[0.9375rem] text-text-secondary">No time recorded this week.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border rounded-md border border-border">
          {days.map(d => (
            <li key={d.key} className={d.key === focusDay ? 'bg-blue/[0.06]' : ''} aria-current={d.key === focusDay ? 'date' : undefined}>
              <div className="flex items-baseline justify-between gap-3 border-b border-border bg-bg-chrome/50 px-3 py-1.5">
                <h4 className="text-[0.9375rem] font-bold">{dayLabel(d.key)}</h4>
                <span className="num text-[0.875rem] text-text-secondary">{fmtDuration(minutesOnDay(d.list, d.key, nowMs))}</span>
              </div>
              <ul className="divide-y divide-border">
                {d.list.map(e => {
                  const brk = breakMinutes(e, nowMs)
                  return (
                    <li key={e.id} className="flex items-start gap-3 px-3 py-2">
                      <div className="min-w-0 flex-1">
                        <p className="num font-bold">{fmtTimeOfDay(e.clock_in)} to {e.clock_out ? fmtTimeOfDay(e.clock_out) : 'now'}</p>
                        <p className="num text-[0.8125rem] text-text-secondary">
                          {fmtDuration(workedMinutes(e, nowMs))}
                          {brk > 0 ? ` · break ${fmtDuration(brk)}` : ''}
                          {!e.clock_out && !isStale(e, nowMs) ? ' · still running' : ''}
                        </p>
                        {isStale(e, nowMs) && <p className="mt-0.5 flex items-center gap-1.5 text-[0.8125rem] font-bold text-red"><Icon name="alert" className="h-4 w-4" />Still clocked in. Use Fix to set the real clock-out. Until then it counts as 0 hours.</p>}
                        <EntryNote entry={e} />
                      </div>
                      <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => { setError(''); setNote(''); setMode({ kind: 'entry', entry: e }) }} aria-label={`Fix the entry on ${dayLabel(d.key)}, ${fmtTimeOfDay(e.clock_in)}`}>
                        <Icon name="edit" className="h-4 w-4" />Fix
                      </button>
                    </li>
                  )
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        <button type="button" className="btn btn-secondary" onClick={() => { setError(''); setNote(''); setMode({ kind: 'entry', entry: null }) }}><Icon name="plus" className="h-5 w-5" />Add a missed punch</button>
        <button type="button" className="btn btn-secondary" onClick={() => { setError(''); setNote(''); setMode({ kind: 'person' }) }}><Icon name="edit" className="h-5 w-5" />{person.active ? 'Edit person' : 'Edit or add back'}</button>
      </div>
    </div>
  )
}
