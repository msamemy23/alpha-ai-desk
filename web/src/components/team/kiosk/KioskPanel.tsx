'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import { SearchField } from '@/components/ListKit'
import { fmtDuration, fmtTimeOfDay } from '@/lib/timeclock'
import type { KioskJob, KioskPerson, KioskRoster } from '@/lib/kiosk-types'
import { readDeviceFix } from '../geoClient'
import { Avatar } from '../parts'
import PinPad from './PinPad'

export interface KioskReply {
  ok: boolean
  status: number
  error?: string
  code?: string
  person?: KioskPerson | null
  entry?: Record<string, unknown>
  hours_worked?: number
  location?: string | null
}
export type KioskCall = (body: Record<string, unknown>) => Promise<KioskReply>

type Step = 'pin' | 'actions' | 'jobs' | 'done'

/** Close the panel after this long with no touch, so the next person never finds the last person's actions open. */
const IDLE_MS = 45_000
const DONE_MS = 6_000

const jobTitle = (j: KioskJob): string => [j.ro ? `RO ${j.ro.replace(/^RO[-\s]*/i, '')}` : '', j.car || j.customer].filter(Boolean).join(', ') || 'Repair order'

/** One person at the tablet: PIN, then what they can do, then a plain confirmation. The PIN lives in memory only while this panel is open. */
export default function KioskPanel({ person, roster, nowMs, call, onChanged, onClose }: {
  person: KioskPerson
  roster: KioskRoster
  nowMs: number
  call: KioskCall
  onChanged: (p: KioskPerson | null) => void
  onClose: () => void
}) {
  const needsPin = roster.requirePin
  const [step, setStep] = useState<Step>(needsPin ? 'pin' : 'actions')
  const [pin, setPin] = useState('')
  const pinRef = useRef('')
  const [me, setMe] = useState(person)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [warn, setWarn] = useState('')
  const [canUndoNow, setCanUndoNow] = useState(false)
  const [q, setQ] = useState('')
  const touched = useRef(Date.now())

  const touch = useCallback(() => { touched.current = Date.now() }, [])
  // The page hands in a new onClose on every render. Keeping it in a ref stops the timer below from restarting each time.
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })
  useEffect(() => {
    const t = setInterval(() => {
      const limit = step === 'done' ? DONE_MS : IDLE_MS
      if (Date.now() - touched.current > limit) closeRef.current()
    }, 1000)
    return () => clearInterval(t)
  }, [step])
  // The PIN is forgotten the moment this panel goes away, and only then.
  useEffect(() => () => { pinRef.current = '' }, [])

  const send = async (body: Record<string, unknown>) => {
    setBusy(true); setError(''); touch()
    const r = await call({ ...body, staff_id: me.id, pin: pinRef.current })
    setBusy(false)
    return r
  }

  const checkPin = async () => {
    pinRef.current = pin
    const r = await send({ action: 'check' })
    if (!r.ok) {
      pinRef.current = ''; setPin('')
      setError(r.error || 'That did not work. Try again.')
      return
    }
    setStep('actions')
  }

  const act = async (action: string, extra: Record<string, unknown> = {}) => {
    const body: Record<string, unknown> = { action, ...extra }
    if (action === 'clock_in' && roster.locationMode !== 'off') {
      const g = await readDeviceFix()
      if (g.fix) body.geo = g.fix
    }
    const r = await send(body)
    if (!r.ok) {
      // A wrong or locked PIN sends the person back to the pad. Anything else is shown where they are.
      if (r.code === 'wrong' || r.code === 'locked') { pinRef.current = ''; setPin(''); setStep('pin') }
      setError(r.error || 'That did not work. Try again.')
      return
    }
    if (r.person) { setMe(r.person); onChanged(r.person) }
    const at = fmtTimeOfDay(String(r.entry?.clock_out || r.entry?.clock_in || new Date().toISOString()))
    setWarn('')
    setCanUndoNow(false)
    if (action === 'clock_in') {
      setMessage(`You are clocked in at ${at}.`)
      if (r.location === 'outside') setWarn('The tablet says you are away from the shop area. A manager will see that on your punch.')
    } else if (action === 'clock_out') {
      setMessage(`You are clocked out at ${at}${typeof r.hours_worked === 'number' ? `. This shift was ${fmtDuration(r.hours_worked * 60)}` : ''}.`)
      setCanUndoNow(true)
    } else if (action === 'start_break') setMessage('Your break has started.')
    else if (action === 'end_break') setMessage('Welcome back. Your break has ended.')
    else if (action === 'start_job') setMessage('Job started. Your time now counts on that repair order.')
    else if (action === 'stop_job') setMessage('Job stopped.')
    else if (action === 'undo_clock_out') setMessage('Your clock-out was taken back. You are clocked in again.')
    touch()
    setStep('done')
  }

  const jobs = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return needle ? roster.jobs.filter(j => [j.ro, j.customer, j.car].join(' ').toLowerCase().includes(needle)) : roster.jobs
  }, [roster.jobs, q])

  const since = me.since ? fmtTimeOfDay(me.since) : ''
  const stateLine = me.state === 'out' ? 'Clocked out' : me.state === 'break' ? `On break since ${since}` : `Clocked in since ${since}`
  const lamp = me.state === 'out' ? 'off' : me.state === 'break' ? 'amber' : 'green'

  return (
    <div onPointerDown={touch} onKeyDown={touch} className="space-y-4">
      <div className="flex items-center gap-3">
        <Avatar name={me.name} size={56} />
        <div className="min-w-0">
          <p className="truncate text-[1.25rem] font-bold">{me.name}</p>
          <p className="flex items-center gap-1.5 text-[0.9375rem] text-text-secondary"><span className={`lamp lamp-${lamp}`} aria-hidden="true" />{stateLine}</p>
        </div>
      </div>

      {me.needs_fix ? (
        <div className="space-y-3">
          <p className="flex items-start gap-2 rounded-md border border-amber/50 bg-amber/[0.10] px-3 py-2.5 text-[1rem]"><Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-amber" />You are still clocked in from an earlier day. Ask a manager to set your real clock-out time. Then you can clock in again.</p>
          <button type="button" className="btn btn-secondary min-h-[56px] w-full" onClick={onClose}>Close</button>
        </div>
      ) : step === 'pin' ? (
        needsPin && !me.has_pin ? (
          <div className="space-y-3">
            <p className="flex items-start gap-2 rounded-md border border-border bg-bg-base px-3 py-2.5 text-[1rem]"><Icon name="key" className="mt-0.5 h-5 w-5 shrink-0" />You do not have a PIN yet. Ask a manager to set one for you in Team, People.</p>
            <button type="button" className="btn btn-secondary min-h-[56px] w-full" onClick={onClose}>Close</button>
          </div>
        ) : (
          <>
            <PinPad value={pin} onChange={v => { setPin(v); setError('') }} onSubmit={() => void checkPin()} busy={busy} error={error} label="Enter your PIN" />
            <button type="button" className="btn btn-ghost mx-auto flex min-h-[48px]" onClick={onClose}>Cancel</button>
          </>
        )
      ) : step === 'actions' ? (
        <div className="space-y-2">
          {me.job && <p className="num rounded-md border border-border bg-bg-base px-3 py-2 text-[0.9375rem]">Working on <strong>{me.job.label}</strong> since {fmtTimeOfDay(me.job.started_at)}</p>}
          {me.state === 'out' && <button type="button" className="btn btn-primary min-h-[64px] w-full text-[1.25rem]" disabled={busy} onClick={() => void act('clock_in')}><Icon name="clock" className="h-6 w-6" />{busy ? 'Saving…' : 'Clock in'}</button>}
          {me.state === 'out' && me.can_undo && <button type="button" className="btn btn-secondary min-h-[56px] w-full" disabled={busy} onClick={() => void act('undo_clock_out')}><Icon name="undo" className="h-5 w-5" />Undo my clock-out</button>}
          {me.state === 'in' && (
            <>
              <button type="button" className="btn btn-secondary min-h-[56px] w-full" disabled={busy} onClick={() => { setQ(''); setStep('jobs') }}><Icon name="wrench" className="h-5 w-5" />{me.job ? 'Switch repair order' : 'Start a repair order'}</button>
              {me.job && <button type="button" className="btn btn-secondary min-h-[56px] w-full" disabled={busy} onClick={() => void act('stop_job')}>Stop this repair order</button>}
              <button type="button" className="btn btn-secondary min-h-[56px] w-full" disabled={busy} onClick={() => void act('start_break')}><Icon name="pause" className="h-5 w-5" />Start break</button>
              <button type="button" className="btn btn-primary min-h-[64px] w-full text-[1.25rem]" disabled={busy} onClick={() => void act('clock_out')}><Icon name="clock" className="h-6 w-6" />{busy ? 'Saving…' : 'Clock out'}</button>
            </>
          )}
          {me.state === 'break' && (
            <>
              <button type="button" className="btn btn-primary min-h-[64px] w-full text-[1.25rem]" disabled={busy} onClick={() => void act('end_break')}><Icon name="play" className="h-6 w-6" />{busy ? 'Saving…' : 'End break'}</button>
              <button type="button" className="btn btn-secondary min-h-[56px] w-full" disabled={busy} onClick={() => void act('clock_out')}>Clock out</button>
            </>
          )}
          {error && <p role="alert" className="form-error">{error}</p>}
          <button type="button" className="btn btn-ghost mx-auto flex min-h-[48px]" onClick={onClose}>Cancel</button>
        </div>
      ) : step === 'jobs' ? (
        <div className="space-y-2">
          <SearchField value={q} onChange={setQ} placeholder="Search by RO, customer or car" label="Search repair orders" />
          {roster.jobs.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-[1rem] text-text-secondary">There are no open repair orders.</p>
          ) : jobs.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-[1rem] text-text-secondary">No open repair orders match.</p>
          ) : (
            <ul className="max-h-[50vh] divide-y divide-border overflow-y-auto rounded-md border border-border">
              {jobs.map(j => (
                <li key={j.id}>
                  <button type="button" className="flex min-h-[56px] w-full items-center gap-3 px-3 py-2 text-left hover:bg-bg-hover" disabled={busy} onClick={() => void act('start_job', { job_id: j.id })}>
                    <span className="min-w-0 flex-1"><span className="block truncate font-bold">{jobTitle(j)}</span><span className="block truncate text-[0.875rem] text-text-secondary">{j.customer}</span></span>
                    <Icon name="chevronRight" className="h-5 w-5 shrink-0 text-text-muted" />
                  </button>
                </li>
              ))}
            </ul>
          )}
          {error && <p role="alert" className="form-error">{error}</p>}
          <button type="button" className="btn btn-secondary min-h-[56px] w-full" onClick={() => setStep('actions')}>Back</button>
        </div>
      ) : (
        <div className="space-y-3 text-center" role="status">
          <Icon name="check" className="mx-auto h-12 w-12 text-green" />
          <p className="text-[1.25rem] font-bold">{message}</p>
          {warn && <p className="rounded-md border border-amber/50 bg-amber/[0.10] px-3 py-2 text-[0.9375rem]">{warn}</p>}
          {canUndoNow && nowMs > 0 && <button type="button" className="btn btn-secondary min-h-[56px] w-full" disabled={busy} onClick={() => void act('undo_clock_out')}><Icon name="undo" className="h-5 w-5" />Wrong button? Undo clock-out</button>}
          {error && <p role="alert" className="form-error">{error}</p>}
          <button type="button" className="btn btn-primary min-h-[56px] w-full" onClick={onClose}>Done</button>
        </div>
      )}
    </div>
  )
}
