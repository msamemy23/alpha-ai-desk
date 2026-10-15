'use client'
import { dayKey, dayLabel, entryDay, fmtTimeOfDay, initials, noteKind, noteText } from '@/lib/timeclock'
import type { ClockEntry, ClockStatus } from '@/lib/timeclock'

export type LampColor = 'green' | 'amber' | 'red' | 'blue' | 'off'

/** A person's initials in a circle. No photos or emoji: it is the same on every screen and always readable. */
export function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className="grid shrink-0 place-items-center rounded-full border border-line bg-bg-hover font-bold leading-none text-text-primary"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.37) }}
    >
      {initials(name)}
    </span>
  )
}

/** The lamp and the words that go with it. Colour never stands alone. */
export function statusLine(s: ClockStatus, todayKey: string): { lamp: LampColor; word: string } {
  if (!s.entry) return { lamp: 'off', word: 'Clocked out' }
  const since = fmtTimeOfDay(s.entry.clock_in)
  const sameDay = entryDay(s.entry) === todayKey
  const when = sameDay ? since : `${dayLabel(entryDay(s.entry), 'weekday')} ${since}`
  if (s.stale) return { lamp: 'red', word: `Still clocked in from ${when}` }
  if (s.state === 'break') {
    const b = s.entry.break_started_at ? fmtTimeOfDay(s.entry.break_started_at) : ''
    return { lamp: 'amber', word: b ? `On break since ${b}` : 'On break' }
  }
  return { lamp: 'green', word: `Clocked in since ${when}` }
}

export function StatusLine({ status, todayKey, className = '' }: { status: ClockStatus; todayKey: string; className?: string }) {
  const { lamp, word } = statusLine(status, todayKey)
  return (
    <span className={`flex min-w-0 items-center gap-1.5 ${className}`}>
      <span className={`lamp lamp-${lamp} shrink-0`} aria-hidden="true" />
      <span className="min-w-0 truncate">{word}</span>
    </span>
  )
}

/** "Edited" or "Manual entry" beside a time entry, with the reason, so a changed punch is never a mystery. */
export function EntryNote({ entry }: { entry: ClockEntry }) {
  const kind = noteKind(entry.note)
  const text = noteText(entry.note)
  if (!kind && !text) return null
  return (
    <span className="mt-0.5 block text-[0.8125rem] text-text-secondary">
      {kind === 'edited' && <strong className="font-bold text-text-primary">Edited</strong>}
      {kind === 'manual' && <strong className="font-bold text-text-primary">Added by hand</strong>}
      {kind && text ? ': ' : ''}
      {text}
    </span>
  )
}

export const todayKeyOf = (nowMs: number): string => (nowMs ? dayKey(new Date(nowMs)) : '')
