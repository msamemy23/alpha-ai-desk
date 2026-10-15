'use client'
import { useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import {
  addDaysKey, breakMinutes, dayKey, dayLabel, entriesFor, entryDay, fmtDuration, fmtTimeOfDay, isStale, minutesOnDay, roleLabel, statusOf,
  undoableEntry, workedMinutes,
} from '@/lib/timeclock'
import type { ClockEntry, Person } from '@/lib/timeclock'
import { describeRules, periodKeys, periodLabel } from '@/lib/timerules'
import type { TimeRules } from '@/lib/timerules'
import { approvalCovering, approvalState, personPeriod, reviewFlags } from '@/lib/payroll'
import type { Approval } from '@/lib/payroll'
import { estimatePay, minutesByJob, runningSegment } from '@/lib/jobtime'
import type { JobSegment, PayMethod, PayRate } from '@/lib/jobtime'
import { distanceWords } from '@/lib/geo'
import EntryForm from './EntryForm'
import type { EntryPayload } from './EntryForm'
import HistoryPanel from './HistoryPanel'
import JobPanel from './JobPanel'
import PayPanel from './PayPanel'
import PersonForm from './PersonForm'
import PinPanel from './PinPanel'
import ReviewPanel from './ReviewPanel'
import { Avatar, EntryNote, StatusLine } from './parts'

export type ClockAction = 'clock_in' | 'clock_out' | 'start_break' | 'end_break' | 'undo_clock_out'

/** Each call resolves to an error message, or '' when it worked. */
export interface PersonApi {
  clock: (action: ClockAction) => Promise<string>
  startJob: (jobId: string) => Promise<string>
  stopJob: () => Promise<string>
  approve: (note: string) => Promise<string>
  unapprove: () => Promise<string>
  saveEntry: (p: EntryPayload) => Promise<string>
  deleteEntry: (id: number, reason: string) => Promise<string>
  restoreEntry: (changeId: number) => Promise<string>
  savePerson: (v: { name: string; role: string }) => Promise<string>
  setActive: (active: boolean) => Promise<string>
  setPin: (pin: string) => Promise<string>
  clearPin: () => Promise<string>
  savePay: (r: { method: PayMethod; value: number }) => Promise<string>
}

type Mode = { kind: 'view' } | { kind: 'entry'; entry: ClockEntry | null } | { kind: 'person' } | { kind: 'history' } | { kind: 'pin' } | { kind: 'pay' }

const DONE: Record<ClockAction, string> = {
  clock_in: 'Clocked in.',
  clock_out: 'Clocked out.',
  start_break: 'Break started.',
  end_break: 'Break ended.',
  undo_clock_out: 'Clock-out taken back. They are clocked in again.',
}

const SOURCE_WORDS: Record<string, string> = { kiosk: 'Shop tablet' }

function whereWords(e: ClockEntry): { text: string; tone: 'ok' | 'warn' } | null {
  if (e.in_location === 'inside') return { text: 'Clocked in at the shop', tone: 'ok' }
  if (e.in_location === 'outside') return { text: `Clocked in away from the shop${e.in_distance_m != null ? `, ${distanceWords(e.in_distance_m)}` : ''}`, tone: 'warn' }
  if (e.in_location === 'unknown') return { text: 'No location shared at clock-in', tone: 'warn' }
  return null
}

/** One person: where they are now, their pay period of punches, time on repair orders, review and approval, and the ways to fix or change things. */
export default function PersonSheet({
  person, entries, period, rules, nowMs, breaks, focusDay, segments, jobTimeOn, approvals, approvalsOn, canManage, canSeePay, hasPin, pinsOn, pay, payOn, api,
}: {
  person: Person
  /** Every entry loaded for the period (and any still running). Filtered to this person here. */
  entries: ClockEntry[]
  period: { start: string; days: number }
  rules: TimeRules
  nowMs: number
  breaks: boolean
  focusDay: string | null
  segments: JobSegment[]
  jobTimeOn: boolean
  approvals: Approval[]
  approvalsOn: boolean
  canManage: boolean
  canSeePay: boolean
  /** Whether this person has a PIN; null when that could not be checked. */
  hasPin: boolean | null
  pinsOn: boolean
  pay: PayRate | undefined
  payOn: boolean
  api: PersonApi
}) {
  const [mode, setMode] = useState<Mode>({ kind: 'view' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [reviewError, setReviewError] = useState('')

  const todayKey = nowMs ? dayKey(new Date(nowMs)) : ''
  const mine = useMemo(() => entriesFor(entries, person), [entries, person])
  const keys = useMemo(() => periodKeys(period.start, period.days), [period])
  const view = useMemo(() => personPeriod(person, entries, period.start, period.days, rules, nowMs), [person, entries, period, rules, nowMs])
  const status = statusOf(mine, person, nowMs)
  const undo = nowMs ? undoableEntry(mine, nowMs) : null
  const running = useMemo(() => runningSegment(segments, person), [segments, person])
  const approval = approvals.find(a => a.staff_id === person.id && a.period_start === period.start)
  const aState = approvalState(approval, view.entryMinutes)
  const lastDay = addDaysKey(period.start, period.days - 1)
  const ended = !!todayKey && todayKey > lastDay
  const flags = useMemo(() => reviewFlags(view, period.start, period.days, todayKey, nowMs), [view, period, todayKey, nowMs])

  const jobs = useMemo(() => {
    const mineSegs = segments.filter(s => (s.staff_id != null ? s.staff_id === person.id : s.staff_name.trim().toLowerCase() === person.name.trim().toLowerCase()) && keys.includes(dayKey(new Date(s.started_at))))
    const byJob = minutesByJob(mineSegs, nowMs)
    return [...byJob.values()].sort((a, b) => b.minutes - a.minutes)
  }, [segments, person, keys, nowMs])

  const run = async (work: () => Promise<string>, done?: () => void) => {
    setBusy(true); setError(''); setNote('')
    const err = await work()
    setBusy(false)
    if (err) setError(err); else done?.()
  }

  const back = () => { setError(''); setMode({ kind: 'view' }) }
  /** Approving happens far down the sheet, so its error shows there and not at the top. */
  const review = async (work: () => Promise<string>, done: () => void) => {
    setBusy(true); setReviewError(''); setError(''); setNote('')
    const err = await work()
    setBusy(false)
    if (err) setReviewError(err); else done()
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
        onCancel={back}
        onSave={p => void run(() => api.saveEntry(p), () => { setNote(entry ? 'Entry saved.' : 'Entry added.'); setMode({ kind: 'view' }) })}
        onDelete={entry ? reason => void run(() => api.deleteEntry(entry.id, reason), () => { setNote('Entry removed. It is in the change history and can be put back.'); setMode({ kind: 'view' }) }) : undefined}
      />
    )
  }

  if (mode.kind === 'person') {
    return (
      <PersonForm
        person={person}
        busy={busy}
        error={error}
        onCancel={back}
        onSave={v => void run(() => api.savePerson(v), () => { setNote('Saved.'); setMode({ kind: 'view' }) })}
        onRemove={() => void run(() => api.setActive(false))}
        onRestore={() => void run(() => api.setActive(true), () => { setNote(`${person.name} is back on the team.`); setMode({ kind: 'view' }) })}
      />
    )
  }

  if (mode.kind === 'history') {
    return <HistoryPanel staffId={person.id} name={person.name} onRestore={api.restoreEntry} onBack={() => { setMode({ kind: 'view' }) }} />
  }

  if (mode.kind === 'pin') {
    return (
      <PinPanel
        name={person.name}
        hasPin={pinsOn ? hasPin : null}
        unavailable={!pinsOn && hasPin === null}
        busy={busy}
        error={error}
        onBack={back}
        onSet={pin => void run(() => api.setPin(pin), () => { setNote('PIN saved.'); setMode({ kind: 'view' }) })}
        onClear={() => void run(() => api.clearPin(), () => { setNote('PIN removed.'); setMode({ kind: 'view' }) })}
      />
    )
  }

  if (mode.kind === 'pay') {
    return <PayPanel name={person.name} rate={pay} unavailable={!payOn} busy={busy} error={error} onBack={back} onSave={r => void run(() => api.savePay(r), () => { setNote('Pay rate saved.'); setMode({ kind: 'view' }) })} />
  }

  const clock = (a: ClockAction) => void run(() => api.clock(a), () => setNote(DONE[a]))
  const days = keys.map(k => ({ key: k, list: view.entries.filter(e => entryDay(e) === k) })).filter(d => d.list.length > 0)
  const otMin = view.split.overtime + view.split.double
  const estimate = canSeePay && pay && pay.method === 'hourly' ? estimatePay(pay, { regularMin: view.split.regular, overtimeMin: view.split.overtime, doubleMin: view.split.double, soldHours: 0, laborRevenue: 0 }) : null

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
            Today {fmtDuration(minutesOnDay(mine, todayKey, nowMs))} · This pay period {fmtDuration(view.totalMinutes)}
          </p>
          {status.overlong && <p className="mt-2 text-[0.9375rem]">This has been running for more than a day, so it needs the real clock-out time. Use Fix on the entry below.</p>}
          <div className={`mt-3 grid grid-cols-2 gap-2 ${status.overlong ? 'hidden' : ''}`}>
            {status.state === 'out' && <button type="button" className="btn btn-primary col-span-2" disabled={busy} onClick={() => clock('clock_in')}><Icon name="clock" className="h-5 w-5" />{busy ? 'Saving…' : 'Clock in'}</button>}
            {status.state === 'in' && breaks && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => clock('start_break')}><Icon name="pause" className="h-5 w-5" />Start break</button>}
            {status.state === 'break' && <button type="button" className="btn btn-primary" disabled={busy} onClick={() => clock('end_break')}><Icon name="play" className="h-5 w-5" />End break</button>}
            {status.state !== 'out' && <button type="button" className={`btn btn-secondary ${breaks ? '' : 'col-span-2'}`} disabled={busy} onClick={() => clock('clock_out')}><Icon name="clock" className="h-5 w-5" />Clock out</button>}
          </div>
          {status.state === 'in' && !breaks && <p className="mt-2 text-[0.8125rem] text-text-secondary">Breaks need a database update before they can be tracked.</p>}
          {undo && status.state === 'out' && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-bg-card px-3 py-2">
              <p className="min-w-0 text-[0.9375rem]">Clocked out at <strong className="num">{fmtTimeOfDay(undo.clock_out)}</strong>. Wrong button?</p>
              <button type="button" className="btn btn-secondary btn-sm" disabled={busy} onClick={() => clock('undo_clock_out')}><Icon name="undo" className="h-4 w-4" />Undo clock-out</button>
            </div>
          )}
          <JobPanel
            name={person.name}
            running={running}
            nowMs={nowMs}
            clockedIn={status.state !== 'out' && !status.overlong}
            onBreak={status.state === 'break'}
            unavailable={!jobTimeOn}
            busy={busy}
            onStart={id => void run(() => api.startJob(id), () => setNote('Job started. Time now counts on that repair order.'))}
            onStop={() => void run(() => api.stopJob(), () => setNote('Job stopped.'))}
          />
        </div>
      )}
      {note && <p role="status" className="mt-3 flex items-center gap-2 text-green"><Icon name="check" className="h-5 w-5" />{note}</p>}
      {error && <p role="alert" className="form-error">{error}</p>}

      <h3 className="section-title mt-5">Pay period {periodLabel(period.start, period.days)}</h3>
      <p className="num mt-1 text-[0.9375rem]"><strong>{fmtDuration(view.totalMinutes)}</strong> worked</p>
      {view.totalMinutes > 0 && (
        <p className="num mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-[0.9375rem]">
          <span>Regular {fmtDuration(view.split.regular)}</span>
          {view.split.overtime > 0 && <span className="inline-flex items-center gap-1.5 font-bold text-amber"><span className="lamp lamp-amber" aria-hidden="true" />Overtime {fmtDuration(view.split.overtime)}</span>}
          {view.split.double > 0 && <span className="inline-flex items-center gap-1.5 font-bold text-amber"><span className="lamp lamp-amber" aria-hidden="true" />Double time {fmtDuration(view.split.double)}</span>}
        </p>
      )}
      <p className="mt-1 text-[0.8125rem] text-text-secondary">{describeRules(rules)}</p>
      {days.length === 0 ? (
        <p className="mt-3 rounded-md border border-dashed border-border px-3 py-5 text-center text-[0.9375rem] text-text-secondary">No time recorded in this pay period.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border rounded-md border border-border">
          {days.map(d => {
            const locked = approvalCovering(approvals, person.id, d.key)
            return (
              <li key={d.key} className={d.key === focusDay ? 'bg-blue/[0.06]' : ''} aria-current={d.key === focusDay ? 'date' : undefined}>
                <div className="flex items-baseline justify-between gap-3 border-b border-border bg-bg-chrome/50 px-3 py-1.5">
                  <h4 className="text-[0.9375rem] font-bold">{dayLabel(d.key)}</h4>
                  <span className="num text-[0.875rem] text-text-secondary">{fmtDuration(minutesOnDay(d.list, d.key, nowMs))}</span>
                </div>
                <ul className="divide-y divide-border">
                  {d.list.map(e => {
                    const brk = breakMinutes(e, nowMs)
                    const where = whereWords(e)
                    return (
                      <li key={e.id} className="flex items-start gap-3 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="num font-bold">{fmtTimeOfDay(e.clock_in)} to {e.clock_out ? fmtTimeOfDay(e.clock_out) : 'now'}</p>
                          <p className="num text-[0.8125rem] text-text-secondary">
                            {fmtDuration(workedMinutes(e, nowMs))}
                            {brk > 0 ? ` · break ${fmtDuration(brk)}` : ''}
                            {!e.clock_out && !isStale(e, nowMs) ? ' · still running' : ''}
                            {e.punch_source && SOURCE_WORDS[e.punch_source] ? ` · ${SOURCE_WORDS[e.punch_source]}` : ''}
                          </p>
                          {isStale(e, nowMs) && <p className="mt-0.5 flex items-center gap-1.5 text-[0.8125rem] font-bold text-red"><Icon name="alert" className="h-4 w-4" />Still clocked in. Use Fix to set the real clock-out. Until then it counts as 0 hours.</p>}
                          {where && <p className={`mt-0.5 flex items-center gap-1.5 text-[0.8125rem] ${where.tone === 'warn' ? 'font-bold text-amber' : 'text-text-secondary'}`}><Icon name="map" className="h-4 w-4" />{where.text}</p>}
                          <EntryNote entry={e} />
                        </div>
                        {canManage && (locked ? (
                          <span className="flex shrink-0 items-center gap-1 pt-1 text-[0.8125rem] text-text-secondary"><Icon name="lock" className="h-4 w-4" />Locked</span>
                        ) : (
                          <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => { setError(''); setNote(''); setMode({ kind: 'entry', entry: e }) }} aria-label={`Fix the entry on ${dayLabel(d.key)}, ${fmtTimeOfDay(e.clock_in)}`}>
                            <Icon name="edit" className="h-4 w-4" />Fix
                          </button>
                        ))}
                      </li>
                    )
                  })}
                </ul>
              </li>
            )
          })}
        </ul>
      )}
      {!canManage && days.length > 0 && <p className="mt-2 text-[0.8125rem] text-text-secondary">An owner or manager fixes punches.</p>}

      {jobs.length > 0 && (
        <>
          <h3 className="section-title mt-5">Time on repair orders</h3>
          <ul className="mt-2 divide-y divide-border rounded-md border border-border">
            {jobs.map(j => (
              <li key={j.jobId} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 truncate">{j.label || 'Repair order'}</span>
                <span className="num shrink-0 font-bold">{fmtDuration(j.minutes)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[0.8125rem] text-text-secondary">Minutes between starting and stopping a job. The Efficiency tab compares them with the hours sold.</p>
        </>
      )}

      {canManage && person.active && (
        <ReviewPanel
          start={period.start}
          days={period.days}
          flags={flags}
          approval={approval}
          state={aState}
          ended={ended}
          currentMinutes={view.entryMinutes}
          available={approvalsOn}
          busy={busy}
          error={reviewError}
          onApprove={n => void review(() => api.approve(n), () => setNote('Pay period approved and locked.'))}
          onUnapprove={() => void review(() => api.unapprove(), () => setNote('Approval removed. The punches can be changed again.'))}
        />
      )}

      {canSeePay && (
        <section aria-label="Pay rate" className="mt-5 rounded-md border border-border bg-bg-card p-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="section-title">Pay</h3>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setError(''); setNote(''); setMode({ kind: 'pay' }) }}><Icon name="edit" className="h-4 w-4" />{pay ? 'Change' : 'Set rate'}</button>
          </div>
          {!payOn ? <p className="mt-1 text-[0.9375rem] text-text-secondary">Pay rates need a database update.</p>
            : !pay ? <p className="mt-1 text-[0.9375rem] text-text-secondary">No pay rate saved. Add one to see what the hours cost.</p>
            : pay.method === 'hourly' && estimate ? (
              <p className="num mt-1 text-[0.9375rem]">
                {estimate.basis}. About <strong>${(estimate.amount ?? 0).toFixed(2)}</strong> for this pay period{otMin > 0 ? `, with ${fmtDuration(otMin)} of overtime` : ''}.
                <span className="block text-[0.8125rem] text-text-secondary">A rough figure for your own planning, before taxes. It is not a payroll calculation.</span>
              </p>
            ) : (
              <p className="mt-1 text-[0.9375rem]">
                {pay.method === 'flat' ? `Flat rate: $${(pay.flat ?? 0).toFixed(2)} per hour sold.` : `Commission: ${pay.commissionPct ?? 0}% of labor sold.`}
                <span className="block text-[0.8125rem] text-text-secondary">What they earn depends on the repair orders they worked. See the Efficiency tab.</span>
              </p>
            )}
        </section>
      )}

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {canManage && <button type="button" className="btn btn-secondary" onClick={() => { setError(''); setNote(''); setMode({ kind: 'entry', entry: null }) }}><Icon name="plus" className="h-5 w-5" />Add a missed punch</button>}
        {canManage && <button type="button" className="btn btn-secondary" onClick={() => { setError(''); setNote(''); setMode({ kind: 'history' }) }}><Icon name="list" className="h-5 w-5" />Change history</button>}
        {canManage && person.active && <button type="button" className="btn btn-secondary" onClick={() => { setError(''); setNote(''); setMode({ kind: 'pin' }) }}><Icon name="key" className="h-5 w-5" />{hasPin ? 'Change tablet PIN' : 'Set tablet PIN'}</button>}
        {canManage && <button type="button" className="btn btn-secondary" onClick={() => { setError(''); setNote(''); setMode({ kind: 'person' }) }}><Icon name="edit" className="h-5 w-5" />{person.active ? 'Edit person' : 'Edit or add back'}</button>}
      </div>
    </div>
  )
}
