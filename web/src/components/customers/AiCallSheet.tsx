'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import Sheet from '@/components/Sheet'
import { phonePretty } from '@/lib/today'
import { CALL_REASONS, MAX_FIELD, askedNotToBeCalled, callStateWords, reasonById } from '@/lib/ai-call'
import type { CallReasonId } from '@/lib/ai-call'
import { formatDuration } from '@/components/inbox/utils'
import { JSON_HEADERS, asText, asTextList, fetchJson } from './http'

type FieldName = 'vehicle' | 'when' | 'amount' | 'note'
type Values = Record<FieldName, string>

/** The request the owner approves. The same object is previewed and then started, so what was read is what is dialled. */
interface CallRequestBody { reason: CallReasonId | ''; vehicle: string; when: string; amount: string; note: string }

interface Preview {
  /** Which request this answer belongs to. Approve only works while it matches what is on screen. */
  key: string
  request: CallRequestBody
  name: string
  phone: string
  phonePretty: string
  hours: string
  plan: { ok: boolean; problems: string[]; disclosure: string; goals: string[]; limits: string[] }
  check: { ok: boolean; code: string; reason: string }
}

interface Line { speaker: string; text: string }
interface LiveData { status: string; transcript: Line[]; summary: string; duration: number }

export interface AiCallCustomer { id: string; name: string; phone: string }

const POLL_MS = 2500
const TYPING_DELAY_MS = 350
const START_TIMEOUT_MS = 30000
const STOP_WAIT_MS = 15000

const FIELD_COPY: Record<FieldName, { label: string; placeholder: string; hint?: string; multiline?: boolean }> = {
  vehicle: { label: 'Vehicle', placeholder: 'Year, make and model' },
  when: { label: 'Day and time', placeholder: 'For example, Tuesday at 3:30 PM' },
  amount: { label: 'Estimate total', placeholder: 'For example, $450.00', hint: 'Only spoken if you type it. Alpha never works out a price.' },
  note: { label: 'What Alpha should say', placeholder: 'Keep it short and about their car or visit', multiline: true },
}

const LAMP = { calling: 'lamp-amber', live: 'lamp-green', ended: 'lamp-off', unknown: 'lamp-off' } as const

const EMPTY_VALUES: Values = { vehicle: '', when: '', amount: '', note: '' }

/** Only the boxes the chosen reason uses are sent; anything typed under another reason is left out. */
function requestFor(reason: CallReasonId | '', v: Values): CallRequestBody {
  const uses = new Set<FieldName>(reasonById(reason)?.fields ?? [])
  const pick = (f: FieldName) => (uses.has(f) ? v[f].slice(0, MAX_FIELD) : '')
  return { reason, vehicle: pick('vehicle'), when: pick('when'), amount: pick('amount'), note: pick('note') }
}

function readPreview(d: Record<string, unknown>, request: CallRequestBody, key: string): Preview | null {
  const plan = d.plan && typeof d.plan === 'object' ? (d.plan as Record<string, unknown>) : null
  const check = d.check && typeof d.check === 'object' ? (d.check as Record<string, unknown>) : null
  if (!plan || !check) return null
  const who = d.customer && typeof d.customer === 'object' ? (d.customer as Record<string, unknown>) : {}
  return {
    key, request,
    name: asText(who.name), phone: asText(who.phone), phonePretty: asText(who.phone_pretty),
    hours: asText(d.hours),
    plan: { ok: plan.ok === true, problems: asTextList(plan.problems), disclosure: asText(plan.disclosure), goals: asTextList(plan.goals), limits: asTextList(plan.limits) },
    check: { ok: check.ok === true, code: asText(check.code), reason: asText(check.reason) },
  }
}

function readLive(d: Record<string, unknown>): LiveData {
  const transcript: Line[] = []
  if (Array.isArray(d.transcript)) {
    for (const x of d.transcript) {
      if (!x || typeof x !== 'object') continue
      const o = x as Record<string, unknown>
      const text = asText(o.text).trim()
      if (text) transcript.push({ speaker: asText(o.speaker), text })
    }
  }
  return {
    status: asText(d.status),
    transcript,
    summary: asText(d.summary).trim(),
    duration: typeof d.duration === 'number' && Number.isFinite(d.duration) ? d.duration : 0,
  }
}

function Who({ name, phone }: { name: string; phone: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-bg-base p-3">
      <Icon name="phone" className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" />
      <div className="min-w-0 flex-1">
        <p className="break-words font-bold">{name}</p>
        {phone && <p className="num text-[0.9375rem] text-text-secondary">{phone}</p>}
      </div>
    </div>
  )
}

/**
 * The "Call with Alpha" review card. Three steps in one sheet: read what Alpha will say and do, approve it,
 * then watch the call and stop it if needed. Nothing is dialled until the owner taps the approve button.
 * Closing the sheet during a live call leaves the call running; opening it again returns to that call.
 */
export default function AiCallSheet({ open, onClose, customer, vehicle = '', resumeCallId = '', onChanged }: {
  open: boolean
  onClose: () => void
  customer: AiCallCustomer
  /** The customer's most likely car, used to fill in the Vehicle box. */
  vehicle?: string
  /** Open straight onto a call that is already running, for example from the customer's call list. */
  resumeCallId?: string
  /** Called when a call starts, ends, or a contact choice is saved, so the screen behind can refresh. */
  onChanged?: () => void
}) {
  // A call that was started and not yet seen to end. Kept here so closing and reopening the sheet does not lose it.
  const [activeCallId, setActiveCallId] = useState('')
  const [dirty, setDirty] = useState(false)
  const busy = useRef(false)
  const sawEnd = useRef(false)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })

  const requestClose = () => {
    // The answer to "did the call start" must not be lost, so the sheet stays until it arrives.
    if (busy.current) return
    // A call that has ended and been looked at is finished with; the next open starts a fresh review.
    if (sawEnd.current) { sawEnd.current = false; setActiveCallId('') }
    setDirty(false)
    closeRef.current()
  }
  const requestCloseRef = useRef(requestClose)
  useEffect(() => { requestCloseRef.current = requestClose })

  // This sheet can sit on top of the customer sheet. Escape closes only this one, not both.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      requestCloseRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open])

  const startAt = resumeCallId || activeCallId

  return (
    // The wrapper keeps the page's vertical spacing rule from moving the full-screen overlay.
    <div className="!mt-0">
      <Sheet open={open} onClose={requestClose} title="Call with Alpha" wide dirty={dirty}>
        {startAt ? (
          <Live
            callId={startAt} customer={customer} onChanged={onChanged} onClose={requestClose} onDirty={setDirty}
            onEnded={() => { sawEnd.current = true }}
          />
        ) : (
          <Review
            customer={customer} vehicle={vehicle} onChanged={onChanged} onClose={requestClose} onDirty={setDirty}
            onBusy={b => { busy.current = b }}
            onStarted={id => { sawEnd.current = false; setActiveCallId(id) }}
          />
        )}
      </Sheet>
    </div>
  )
}

// ── Step 1 and 2: review, then approve ────────────────────────────────────────────────────────────────

function Review({ customer, vehicle, onStarted, onChanged, onClose, onDirty, onBusy }: {
  customer: AiCallCustomer
  vehicle: string
  onStarted: (callId: string) => void
  onChanged?: () => void
  onClose: () => void
  onDirty: (dirty: boolean) => void
  onBusy: (busy: boolean) => void
}) {
  const [reason, setReason] = useState<CallReasonId | ''>('')
  const [values, setValues] = useState<Values>({ ...EMPTY_VALUES, vehicle })
  const [preview, setPreview] = useState<Preview | null>(null)
  const [checking, setChecking] = useState(true)
  const [failed, setFailed] = useState(false)
  const [failedWhy, setFailedWhy] = useState('')
  const [retryTick, setRetryTick] = useState(0)
  const [approving, setApproving] = useState(false)
  const [startError, setStartError] = useState('')
  const [uncertain, setUncertain] = useState<{ callId: string } | null>(null)

  const vehicleTouched = useRef(false)
  const seq = useRef(0)
  const typingDelay = useRef(0)
  const approvingRef = useRef(false)
  // One approval is one call: a double tap or a retry of the same screen reuses this key, so the server dials once.
  const idemRef = useRef<{ key: string; requestKey: string } | null>(null)
  const cbRef = useRef({ onStarted, onChanged, onBusy })
  useEffect(() => { cbRef.current = { onStarted, onChanged, onBusy } })

  // The car can arrive after the sheet is open (the customer's history loads in the background).
  useEffect(() => {
    if (vehicleTouched.current) return
    setValues(v => (v.vehicle === vehicle ? v : { ...v, vehicle }))
  }, [vehicle])

  const reasonInfo = reasonById(reason)
  const request = useMemo(() => requestFor(reason, values), [reason, values])
  const requestKey = `${customer.id}:${JSON.stringify(request)}`

  useEffect(() => {
    const typed = values.vehicle !== vehicle || Boolean(values.when || values.amount || values.note)
    onDirty(reason !== '' || typed)
  }, [reason, values, vehicle, onDirty])

  // Ask the server what this call would be, on open and again after the owner stops typing.
  // The counter makes sure a slow answer to an older request can never replace a newer one.
  useEffect(() => {
    const mine = ++seq.current
    const wait = typingDelay.current
    typingDelay.current = 0
    const ctl = new AbortController()
    setChecking(true)
    setFailed(false)
    const timer = setTimeout(async () => {
      try {
        const r = await fetchJson('/api/ai-call/preview', {
          method: 'POST',
          headers: JSON_HEADERS,
          body: JSON.stringify({ customer_id: customer.id, request }),
          signal: ctl.signal,
        })
        if (mine !== seq.current) return
        const parsed = r.ok && r.data && r.data.ok === true ? readPreview(r.data, request, requestKey) : null
        if (parsed) {
          setPreview(parsed)
        } else {
          setPreview(null)
          setFailed(true)
          setFailedWhy(asText(r.data?.error))
        }
      } catch {
        if (mine !== seq.current) return
        setPreview(null)
        setFailed(true)
        setFailedWhy('')
      } finally {
        if (mine === seq.current) setChecking(false)
      }
    }, wait)
    return () => { clearTimeout(timer); ctl.abort() }
    // request is derived from requestKey, so the key alone decides when to ask again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, retryTick, customer.id])

  const setField = (f: FieldName, value: string) => {
    typingDelay.current = TYPING_DELAY_MS
    setStartError('')
    if (f === 'vehicle') vehicleTouched.current = true
    setValues(v => ({ ...v, [f]: value }))
  }

  const current = Boolean(preview) && preview?.key === requestKey && !checking
  const canApprove = current && preview!.plan.ok && preview!.check.ok && !approving && !uncertain

  const approve = async () => {
    if (approvingRef.current || !canApprove || !preview) return
    approvingRef.current = true
    cbRef.current.onBusy(true)
    setApproving(true)
    setStartError('')
    if (!idemRef.current || idemRef.current.requestKey !== preview.key) {
      idemRef.current = { key: typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`, requestKey: preview.key }
    }
    try {
      const r = await fetchJson('/api/ai-call/start', {
        method: 'POST',
        headers: { ...JSON_HEADERS, 'Idempotency-Key': idemRef.current.key },
        body: JSON.stringify({ customer_id: customer.id, request: preview.request, confirm: true }),
      }, START_TIMEOUT_MS)
      const d = r.data
      const callId = asText(d?.callId)
      if (d && d.ok === true && callId) {
        cbRef.current.onChanged?.()
        cbRef.current.onStarted(callId)
        return
      }
      if (!d || d.uncertain === true || d.ok === true) {
        // The request may have reached the phone line. No second attempt is made for the owner.
        setUncertain({ callId })
        cbRef.current.onChanged?.()
        return
      }
      // The server said plainly that no call was placed, so a fresh approval may use a fresh key.
      idemRef.current = null
      setStartError(asText(d.error) || 'The call did not start. Nothing was dialled.')
      setRetryTick(t => t + 1)
    } catch {
      setUncertain({ callId: '' })
      cbRef.current.onChanged?.()
    } finally {
      approvingRef.current = false
      cbRef.current.onBusy(false)
      setApproving(false)
    }
  }

  const name = preview?.name || customer.name || 'This customer'
  const number = preview?.phonePretty || phonePretty(preview?.phone || customer.phone)
  const stale = Boolean(preview) && !current

  // One line that says why the button is on or off. The notices above it already say it when a start failed.
  let hint = ''
  if (uncertain || startError) hint = ''
  else if (approving) hint = 'Starting the call. Keep this window open.'
  else if (failed) hint = 'This call cannot be approved until it has been checked.'
  else if (!current) hint = 'Checking this call…'
  else if (!preview!.plan.ok) hint = reason ? 'Fill in the boxes above, then approve.' : 'Pick a reason above, then approve.'
  else if (!preview!.check.ok) hint = 'This call cannot be placed right now.'
  else hint = `Alpha will call ${name} as soon as you approve.`

  return (
    <div className="space-y-5">
      <Who name={name} phone={number} />

      {preview && !preview.check.ok && (
        <Notice kind={preview.check.code === 'quiet_hours' ? 'warn' : 'error'}>
          {preview.check.reason || 'Alpha cannot call this number right now.'}
        </Notice>
      )}

      {failed && (
        <Notice kind="error">
          <p className="font-bold">Could not check this call. Nothing was dialled.</p>
          {failedWhy && <p className="mt-1 break-words">{failedWhy}</p>}
          <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => setRetryTick(t => t + 1)}>Try again</button>
        </Notice>
      )}

      <fieldset>
        <legend className="form-label">Why is Alpha calling?</legend>
        <div className="space-y-2">
          {CALL_REASONS.map(r => {
            const picked = r.id === reason
            return (
              <label key={r.id} className={`flex min-h-[52px] cursor-pointer items-start gap-3 rounded-lg border p-3 ${picked ? 'border-blue bg-blue/[0.06]' : 'border-border bg-bg-card'}`}>
                <input
                  type="radio" name="ac-reason" value={r.id} checked={picked}
                  onChange={() => { setStartError(''); setReason(r.id) }} disabled={approving}
                  className="mt-1 h-5 w-5 shrink-0 accent-[rgb(var(--c-blue))]"
                />
                <span className="min-w-0">
                  <span className="block font-bold">{r.label}</span>
                  {(!reason || picked) && <span className="block text-[0.9375rem] text-text-secondary">{r.hint}</span>}
                </span>
              </label>
            )
          })}
        </div>
      </fieldset>

      {reasonInfo && (
        <div className="space-y-4">
          {reasonInfo.fields.map(f => {
            const copy = FIELD_COPY[f]
            const required = reasonInfo.required.includes(f)
            const id = `ac-${f}`
            const hintId = copy.hint ? `${id}-hint` : undefined
            return (
              <div key={f}>
                <label className="form-label" htmlFor={id}>
                  {copy.label}
                  <span className="ml-1.5 font-normal text-text-secondary">{required ? 'Required' : 'Optional'}</span>
                </label>
                {copy.multiline ? (
                  <textarea
                    id={id} className="form-textarea" rows={3} maxLength={MAX_FIELD} value={values[f]}
                    onChange={e => setField(f, e.target.value)} placeholder={copy.placeholder}
                    aria-required={required} aria-describedby={hintId} disabled={approving}
                  />
                ) : (
                  <input
                    id={id} className="form-input" type="text" maxLength={MAX_FIELD} value={values[f]}
                    onChange={e => setField(f, e.target.value)} placeholder={copy.placeholder}
                    autoComplete="off" aria-required={required} aria-describedby={hintId} disabled={approving}
                  />
                )}
                {copy.hint && <p id={hintId} className="form-hint">{copy.hint}</p>}
              </div>
            )
          })}
        </div>
      )}

      {preview && preview.plan.problems.length > 0 && (
        <Notice kind="info">
          <p className="font-bold">Before Alpha can call</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {preview.plan.problems.map(p => <li key={p} className="break-words">{p}</li>)}
          </ul>
        </Notice>
      )}

      {!preview && !failed && (
        <div className="space-y-2" aria-busy="true" aria-label="Checking this call">
          {[0, 1, 2].map(i => <div key={i} className="skeleton h-16" />)}
        </div>
      )}

      {preview && (
        <div className={`space-y-5 ${stale ? 'opacity-60' : ''}`} aria-busy={stale}>
          <section aria-labelledby="ac-hears">
            <h3 id="ac-hears" className="section-title">What the customer hears first</h3>
            <blockquote className="mt-2 break-words rounded-md border-l-4 border-line bg-bg-base px-3 py-2">{preview.plan.disclosure}</blockquote>
          </section>

          <section aria-labelledby="ac-will">
            <h3 id="ac-will" className="section-title">What Alpha will do</h3>
            {preview.plan.goals.length > 0 ? (
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {preview.plan.goals.map((g, i) => <li key={i} className="break-words">{g}</li>)}
              </ul>
            ) : (
              <p className="mt-2 text-text-secondary">Pick a reason above to see what Alpha will do.</p>
            )}
          </section>

          <section aria-labelledby="ac-wont">
            <h3 id="ac-wont" className="section-title">What Alpha will not do</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              {preview.plan.limits.map((l, i) => <li key={i} className="break-words">{l}</li>)}
            </ul>
          </section>

          {preview.hours && (
            <section>
              <p className="break-words"><span className="font-bold">Calling hours:</span> {preview.hours}</p>
              <p className="text-[0.9375rem] text-text-secondary">Alpha only dials inside these hours, on your clock and on the customer&apos;s.</p>
            </section>
          )}
        </div>
      )}

      {/* Stays in view at the bottom of the sheet. The offsets reach over the sheet's own padding so nothing shows beneath it. */}
      <div className="sticky -mx-5 -mb-5 space-y-3 border-t border-border bg-bg-card px-5 pb-[calc(1.25rem_+_env(safe-area-inset-bottom))] pt-3 bottom-[calc(-1.25rem_-_env(safe-area-inset-bottom))] sm:-mx-6 sm:-mb-6 sm:bottom-[-1.5rem] sm:px-6 sm:pb-6">
        {startError && <Notice kind="error"><span className="break-words">{startError}</span></Notice>}
        {uncertain && (
          <Notice kind="error">
            <p>We could not confirm the call started. Check Alpha&apos;s calls on this customer before trying again.</p>
            {uncertain.callId && (
              <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => cbRef.current.onStarted(uncertain.callId)}>Check this call</button>
            )}
          </Notice>
        )}
        <p id="ac-approve-hint" role="status" className={hint ? 'text-[0.9375rem] text-text-secondary' : 'sr-only'}>{hint}</p>
        <div className="flex gap-2 sm:justify-end">
          <button type="button" className="btn btn-secondary shrink-0" onClick={onClose} disabled={approving}>{uncertain ? 'Close' : 'Cancel'}</button>
          <button type="button" className="btn btn-primary flex-1 sm:flex-none" onClick={() => void approve()} disabled={!canApprove} aria-describedby="ac-approve-hint">
            <Icon name="phone" className="h-5 w-5" />{approving ? 'Starting the call…' : 'Approve and call now'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Step 3: the live call ─────────────────────────────────────────────────────────────────────────────

function Live({ callId, customer, onEnded, onChanged, onClose, onDirty }: {
  callId: string
  customer: AiCallCustomer
  onEnded: () => void
  onChanged?: () => void
  onClose: () => void
  onDirty: (dirty: boolean) => void
}) {
  const [data, setData] = useState<LiveData | null>(null)
  const [failures, setFailures] = useState(0)
  const [stopping, setStopping] = useState(false)
  const [stopRequested, setStopRequested] = useState(false)
  const [stopError, setStopError] = useState('')
  const [dnc, setDnc] = useState<'idle' | 'saving' | 'done' | 'error'>('idle')
  const [dncError, setDncError] = useState('')

  const stopBusy = useRef(false)
  const dncBusy = useRef(false)
  const finished = useRef(false)
  const pinned = useRef(true)
  const logRef = useRef<HTMLDivElement>(null)
  const cbRef = useRef({ onEnded, onChanged })
  useEffect(() => { cbRef.current = { onEnded, onChanged } })

  const status = callStateWords(data?.status)
  const ended = status.state === 'ended'

  useEffect(() => { onDirty(!ended) }, [ended, onDirty])

  // Read the call every few seconds until it ends or the sheet closes. One request at a time.
  useEffect(() => {
    let alive = true
    let timer: ReturnType<typeof setTimeout> | undefined
    let ctl: AbortController | undefined
    const tick = async () => {
      ctl = new AbortController()
      let again = true
      try {
        const r = await fetchJson(`/api/call-summary/${encodeURIComponent(callId)}`, { cache: 'no-store', signal: ctl.signal })
        if (!alive) return
        if (r.ok && r.data && r.data.ok === true) {
          const next = readLive(r.data)
          setData(next)
          setFailures(0)
          if (callStateWords(next.status).state === 'ended') {
            again = false
            if (!finished.current) {
              finished.current = true
              cbRef.current.onEnded()
              cbRef.current.onChanged?.()
            }
          }
        } else {
          setFailures(n => n + 1)
        }
      } catch {
        if (!alive) return
        setFailures(n => n + 1)
      }
      if (alive && again) timer = setTimeout(tick, POLL_MS)
    }
    void tick()
    return () => { alive = false; clearTimeout(timer); ctl?.abort() }
  }, [callId])

  // If the hang up was accepted but the call still shows as running a while later, let the owner try again.
  useEffect(() => {
    if (!stopRequested || ended) return
    const t = setTimeout(() => {
      setStopRequested(false)
      setStopError('The call has not ended yet. Tap Stop the call to try again.')
    }, STOP_WAIT_MS)
    return () => clearTimeout(t)
  }, [stopRequested, ended])

  // Keep the newest words in view, unless the owner scrolled up to read earlier ones.
  const lineCount = data?.transcript.length ?? 0
  useEffect(() => {
    const el = logRef.current
    if (el && pinned.current) el.scrollTop = el.scrollHeight
  }, [lineCount])

  const stop = async () => {
    if (stopBusy.current || ended) return
    stopBusy.current = true
    setStopping(true)
    setStopError('')
    try {
      const r = await fetchJson('/api/ai-call/stop', { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ callId }) })
      if (r.data?.ok === true) setStopRequested(true)
      else setStopError(asText(r.data?.error) || 'The call may not have stopped. Try again.')
    } catch {
      setStopError('Could not reach the server. The call may still be going. Try again.')
    } finally {
      stopBusy.current = false
      setStopping(false)
    }
  }

  const asked = useMemo(
    () => ended && askedNotToBeCalled((data?.transcript ?? []).map(l => ({ speaker: l.speaker, text: l.text }))),
    [ended, data],
  )

  const markDoNotCall = async () => {
    if (dncBusy.current) return
    dncBusy.current = true
    setDnc('saving')
    setDncError('')
    try {
      const r = await fetchJson('/api/customers/contact-prefs', {
        method: 'PUT',
        headers: JSON_HEADERS,
        body: JSON.stringify({ customer_id: customer.id, do_not_call: true }),
      })
      if (r.data?.ok === true) {
        setDnc('done')
        cbRef.current.onChanged?.()
      } else {
        setDnc('error')
        setDncError(asText(r.data?.error) || 'That was not saved. Try again.')
      }
    } catch {
      setDnc('error')
      setDncError('That was not saved. Check your connection and try again.')
    } finally {
      dncBusy.current = false
    }
  }

  const hangingUp = stopRequested && !ended
  const lampClass = hangingUp ? 'lamp-amber' : LAMP[status.state]
  const label = hangingUp ? 'Hanging up' : status.label
  const stopLabel = stopping || stopRequested ? 'Stopping…' : 'Stop the call'
  const lines = data?.transcript ?? []

  return (
    <div className="space-y-5">
      <Who name={customer.name || 'This customer'} phone={phonePretty(customer.phone)} />

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[1.0625rem] font-bold">
        <p role="status" className="flex items-center gap-2">
          <span className={`lamp ${lampClass}`} aria-hidden="true" />
          <span>{label}</span>
        </p>
        {status.state === 'live' && data && data.duration > 0 && <span className="num font-normal text-text-secondary">{formatDuration(data.duration)} so far</span>}
      </div>

      {failures >= 3 && !ended && (
        <Notice kind="warn">Having trouble reading this call. The call itself is not affected. Still trying.</Notice>
      )}

      <div>
        <h3 className="form-label" id="ac-log-title">What is being said</h3>
        <div
          ref={logRef} role="log" aria-live="polite" aria-labelledby="ac-log-title" tabIndex={0}
          onScroll={e => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48 }}
          className="max-h-64 overflow-y-auto rounded-lg border border-border bg-bg-base p-3"
        >
          {lines.length === 0 ? (
            <p className="text-text-secondary">{ended ? 'No words were captured on this call.' : 'Waiting for the call to connect. Words appear here as they are said.'}</p>
          ) : (
            lines.map((l, i) => (
              <p key={i} className="break-words py-1">
                <span className="font-bold">{l.speaker === 'ai' ? 'Alpha' : 'Customer'}: </span>{l.text}
              </p>
            ))
          )}
        </div>
      </div>

      {!ended && (
        <div className="space-y-3">
          <button type="button" className="btn btn-danger btn-lg w-full" onClick={() => void stop()} disabled={stopping || stopRequested}>
            <Icon name="chatStop" className="h-5 w-5" />{stopLabel}
          </button>
          {stopError && <Notice kind="error"><span className="break-words">{stopError}</span></Notice>}
          <p className="text-[0.9375rem] text-text-secondary">Closing this window does not hang up the call. Use Stop the call.</p>
        </div>
      )}

      {ended && (
        <div className="space-y-4">
          <section aria-labelledby="ac-summary">
            <h3 id="ac-summary" className="section-title">Summary</h3>
            <p className="mt-2 whitespace-pre-line break-words">{data?.summary || 'No summary was written for this call.'}</p>
          </section>

          {asked && dnc !== 'done' && (
            <Notice kind="warn">
              <p className="font-bold">The customer asked not to be called again.</p>
              <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => void markDoNotCall()} disabled={dnc === 'saving'}>
                {dnc === 'saving' ? 'Saving…' : 'Mark do not call'}
              </button>
              {dnc === 'error' && <p role="alert" className="form-error">{dncError}</p>}
            </Notice>
          )}
          {asked && dnc === 'done' && (
            <Notice kind="success">Marked do not call. Alpha will not call this customer again.</Notice>
          )}

          <div className="flex justify-end">
            <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      )}
    </div>
  )
}
