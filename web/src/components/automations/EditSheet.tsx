'use client'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import Notice from '@/components/Notice'
import Sheet from '@/components/Sheet'
import { Switch } from '@/components/ScreenParts'
import { hasEmoji, smsSegments, unknownPlaceholders } from '@/lib/automation-rules'
import { call } from './api'
import { WEEKDAYS, buildSchedule, parseSchedule, scheduleWords } from './model'
import type { Card, FieldInfo, Preview, ScheduleParts } from './model'

interface Props {
  card: Card
  onClose: () => void
  /** Saves only what changed. Returns an empty string when it worked, or the reason it did not. */
  onSave: (changes: Record<string, unknown>) => Promise<string>
}

const PLACEHOLDER_WORDS: Record<string, string> = {
  name: 'First name', shop: 'Shop name', shop_phone: 'Shop phone', contact: 'How to reach you', vehicle: 'Vehicle', service: 'Service',
  date: 'Date and time', amount: 'Amount', review_link: 'Review link', items: 'Work recommended',
}

const asText = (v: unknown): string => (v === null || v === undefined ? '' : String(v))

/** Change the words, the timing and the limits of one automation, with the real messages shown as you type. */
export default function EditSheet({ card, onClose, onSave }: Props) {
  const engine = card.kind === 'engine'
  const base = useId()
  const initial = useMemo(() => {
    const o: Record<string, unknown> = {}
    for (const f of card.fields) o[f.key] = f.value ?? f.default
    return o
  }, [card.fields])
  const [values, setValues] = useState<Record<string, unknown>>(initial)
  const [sched, setSched] = useState<ScheduleParts | null>(() => parseSchedule(asText(initial.schedule)))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [tried, setTried] = useState(false)
  const busy = useRef(false)
  const area = useRef<HTMLTextAreaElement>(null)

  const set = (key: string, v: unknown) => { setValues(p => ({ ...p, [key]: v })); setError('') }
  const message = asText(values.message)
  const changed = useMemo(() => {
    const c: Record<string, unknown> = {}
    for (const f of card.fields) {
      const a = values[f.key]
      const b = initial[f.key]
      if (f.type === 'number') { if (a === '' || a === undefined) continue; if (Number(a) !== Number(b)) c[f.key] = Number(a) }
      else if (a !== b) c[f.key] = a
    }
    return c
  }, [values, initial, card.fields])
  const dirty = Object.keys(changed).length > 0

  // Local checks, in the same words the server uses, so a problem shows while typing.
  const messageProblems = useMemo(() => {
    if (!engine) return []
    const out: string[] = []
    const t = message.trim()
    if (!t && card.id === 'sms_blast') return out
    if (!t) out.push('Write the message first.')
    const unknown = unknownPlaceholders(t)
    if (unknown.length) out.push(`These placeholders are not known: ${unknown.map(u => `{${u}}`).join(', ')}.`)
    if (hasEmoji(t)) out.push('Remove the emoji. They make texts cost more and look less professional.')
    return out
  }, [engine, message, card.id])
  const parts = useMemo(() => smsSegments(message.replace(/\{[^{}]*\}/g, 'xxxxxxxxxxxx') + (card.klass === 'marketing' ? ' Reply STOP to opt out.' : '')), [message, card.klass])

  // The real messages for the real people, rebuilt a moment after you stop typing.
  const [live, setLive] = useState<{ state: 'idle' | 'loading' | 'ready' | 'error'; data: Preview | null; error: string }>({ state: 'idle', data: null, error: '' })
  const liveKey = JSON.stringify(changed)
  useEffect(() => {
    if (!engine || messageProblems.length) { setLive({ state: 'idle', data: null, error: '' }); return }
    let stale = false
    setLive(p => ({ ...p, state: 'loading' }))
    const t = setTimeout(async () => {
      const r = await call('/api/system-automations', { action: 'preview', id: card.id, config: changed })
      if (stale) return
      setLive(r.ok ? { state: 'ready', data: r.data as unknown as Preview, error: '' } : { state: 'error', data: null, error: r.error })
    }, 700)
    return () => { stale = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey, engine, messageProblems.length, card.id])

  const insert = (key: string) => {
    const el = area.current
    const token = `{${key}}`
    if (!el) { set('message', `${message}${token}`); return }
    const start = el.selectionStart ?? message.length
    const end = el.selectionEnd ?? message.length
    set('message', `${message.slice(0, start)}${token}${message.slice(end)}`)
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(start + token.length, start + token.length) })
  }

  const updateSched = (patch: Partial<ScheduleParts>) => {
    const next = { ...(sched || { kind: 'daily', amount: 1, unit: 'hours', hour: 9, minute: 0, weekday: 1 } as ScheduleParts), ...patch }
    setSched(next)
    set('schedule', buildSchedule(next))
  }

  const submit = async () => {
    setTried(true)
    if (busy.current || !dirty || messageProblems.length) return
    busy.current = true; setSaving(true)
    const reason = await onSave(changed)
    busy.current = false; setSaving(false)
    if (reason) setError(reason); else onClose()
  }

  const numberFields = card.fields.filter(f => f.type === 'number' || f.type === 'boolean' || f.type === 'select' || (f.type === 'text' && !['schedule', 'email_subject'].includes(f.key)))
  const first = live.data?.recipients?.slice(0, 2) || []
  const messageChanged = 'message' in changed || 'email_subject' in changed

  return (
    <Sheet open onClose={() => { if (!saving) onClose() }} title={`Settings: ${card.name}`} wide dirty={dirty}>
      <form onSubmit={e => { e.preventDefault(); void submit() }} className="space-y-5" noValidate>
        {engine && (
          <div>
            <label htmlFor={`${base}-message`} className="form-label">Message</label>
            <textarea
              id={`${base}-message`} ref={area} className="form-textarea" rows={5} value={message} onChange={e => set('message', e.target.value)} maxLength={1000}
              aria-invalid={tried && messageProblems.length > 0} aria-describedby={`${base}-message-hint`}
            />
            <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Add a detail from the customer or shop">
              {card.placeholders.map(k => (
                <button key={k} type="button" className="tag tag-gray min-h-[2.25rem] cursor-pointer px-3" onClick={() => insert(k)} aria-label={`Add ${PLACEHOLDER_WORDS[k] || k}`}>
                  + {PLACEHOLDER_WORDS[k] || k}
                </button>
              ))}
            </div>
            <p id={`${base}-message-hint`} className="form-hint !text-text-secondary">
              <span className="num">{[...message].length}</span> characters · {parts.parts} text {parts.parts === 1 ? 'part' : 'parts'}.
              {card.klass === 'marketing' ? ' An opt-out line is added to the end for you.' : ''} Alpha never makes up prices, offers or promises: only what you write goes out.
            </p>
            {messageProblems.map(p => <p key={p} className="form-error">{p}</p>)}
          </div>
        )}

        {engine && card.fields.some(f => f.key === 'email_subject') && (
          <div>
            <label htmlFor={`${base}-subject`} className="form-label">Email subject</label>
            <input id={`${base}-subject`} className="form-input" value={asText(values.email_subject)} maxLength={150} onChange={e => set('email_subject', e.target.value)} />
            <p className="form-hint !text-text-secondary">Used when a customer has an email but no phone number. Plain words, no emoji.</p>
          </div>
        )}

        {engine && (
          <section aria-label="What the messages will say" className="rounded-md border border-border p-3">
            <h3 className="font-bold">What it would say right now</h3>
            {messageProblems.length ? <p className="mt-1 text-text-secondary">Fix the message above to see it.</p>
              : live.state === 'error' ? <p className="mt-1 text-red">{live.error}</p>
              : live.state === 'loading' && !live.data ? <div className="skeleton mt-2 h-16" role="status" aria-label="Loading a preview" />
              : first.length ? (
                <ul className={`mt-2 space-y-2 ${live.state === 'loading' ? 'opacity-60' : ''}`} aria-live="polite">
                  {first.map((r, i) => (
                    <li key={`${r.to}-${i}`} className="rounded-md bg-bg-hover px-3 py-2">
                      <p className="text-[0.8125rem] font-bold text-text-secondary">To {r.name}</p>
                      <p className="whitespace-pre-wrap break-words">{r.text}</p>
                    </li>
                  ))}
                  {(live.data?.counts.send || 0) > first.length && <li className="text-[0.8125rem] text-text-secondary">and {(live.data?.counts.send || 0) - first.length} more. Open Preview to see everyone.</li>}
                </ul>
              ) : <p className="mt-1 text-text-secondary">No one qualifies right now, so there is nothing to show. The settings still apply to the next person who does.</p>}
          </section>
        )}

        <section aria-labelledby={`${base}-when`}>
          <h3 id={`${base}-when`} className="font-bold">When it runs</h3>
          {sched ? (
            <div className="mt-2 grid gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor={`${base}-kind`} className="form-label">How often</label>
                <select id={`${base}-kind`} className="form-select" value={sched.kind} onChange={e => updateSched({ kind: e.target.value as ScheduleParts['kind'] })}>
                  <option value="every">Every few minutes or hours</option>
                  <option value="daily">Every day</option>
                  <option value="weekly">Every week</option>
                </select>
              </div>
              {sched.kind === 'every' ? (
                <>
                  <div>
                    <label htmlFor={`${base}-amount`} className="form-label">Every</label>
                    <input id={`${base}-amount`} className="form-input" type="number" inputMode="numeric" min={1} max={sched.unit === 'minutes' ? 720 : 72} value={sched.amount} onChange={e => updateSched({ amount: Number(e.target.value) || 1 })} />
                  </div>
                  <div>
                    <label htmlFor={`${base}-unit`} className="form-label">Unit</label>
                    <select id={`${base}-unit`} className="form-select" value={sched.unit} onChange={e => updateSched({ unit: e.target.value as 'minutes' | 'hours' })}>
                      <option value="minutes">minutes</option>
                      <option value="hours">hours</option>
                    </select>
                  </div>
                </>
              ) : (
                <>
                  {sched.kind === 'weekly' && (
                    <div>
                      <label htmlFor={`${base}-day`} className="form-label">On</label>
                      <select id={`${base}-day`} className="form-select" value={sched.weekday} onChange={e => updateSched({ weekday: Number(e.target.value) })}>
                        {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
                      </select>
                    </div>
                  )}
                  <div>
                    <label htmlFor={`${base}-time`} className="form-label">At</label>
                    <input id={`${base}-time`} className="form-input" type="time" value={`${String(sched.hour).padStart(2, '0')}:${String(sched.minute).padStart(2, '0')}`} onChange={e => { const [h, m] = e.target.value.split(':').map(Number); if (Number.isFinite(h)) updateSched({ hour: h, minute: m || 0 }) }} />
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="mt-2">
              <label htmlFor={`${base}-sched`} className="form-label">Schedule</label>
              <input id={`${base}-sched`} className="form-input" value={asText(values.schedule)} onChange={e => set('schedule', e.target.value)} />
              <p className="form-hint">Try &quot;Daily at 9am&quot;, &quot;Weekly on Monday at 10am&quot; or &quot;every 2 hours&quot;.</p>
            </div>
          )}
          <p className="form-hint !text-text-secondary">{scheduleWords(asText(values.schedule))}, in your shop’s time zone.</p>
        </section>

        {numberFields.length > 0 && (
          <section aria-labelledby={`${base}-limits`}>
            <h3 id={`${base}-limits`} className="font-bold">Rules for this automation</h3>
            <div className="mt-2 grid gap-4 sm:grid-cols-2">
              {numberFields.map(f => <FieldInput key={f.key} id={`${base}-${f.key}`} f={f} value={values[f.key]} onChange={v => set(f.key, v)} />)}
            </div>
          </section>
        )}

        {messageChanged && <Notice kind="info">Messages already waiting to go out were written with the old wording. Saving cancels them, and the next run rebuilds them with your new wording.</Notice>}
        {error && <Notice kind="error">{error}</Notice>}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={saving || !dirty || messageProblems.length > 0} aria-busy={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
        </div>
      </form>
    </Sheet>
  )
}

function FieldInput({ id, f, value, onChange }: { id: string; f: FieldInfo; value: unknown; onChange: (v: unknown) => void }) {
  if (f.type === 'boolean') {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 sm:col-span-2">
        <span id={`${id}-l`} className="py-2"><span className="font-bold">{f.label}</span>{f.help ? <span className="block text-[0.875rem] text-text-secondary">{f.help}</span> : null}</span>
        <Switch checked={value === true} onChange={onChange} label={f.label} />
      </div>
    )
  }
  return (
    <div>
      <label htmlFor={id} className="form-label">{f.label}{f.unit ? ` (${f.unit})` : ''}</label>
      {f.type === 'select' ? (
        <select id={id} className="form-select" value={asText(value)} onChange={e => onChange(e.target.value)}>
          {(f.options || []).map(o => <option key={o} value={o}>{o.replace(/_/g, ' ')}</option>)}
        </select>
      ) : f.type === 'number' ? (
        <input id={id} className="form-input" type="number" inputMode="decimal" min={f.min} max={f.max} value={value === undefined || value === null ? '' : String(value)} onChange={e => onChange(e.target.value === '' ? '' : Number(e.target.value))} />
      ) : (
        <input id={id} className="form-input" value={asText(value)} maxLength={200} onChange={e => onChange(e.target.value)} />
      )}
      {f.help ? <p className="form-hint !text-text-secondary">{f.help}</p> : f.type === 'number' && f.min !== undefined && f.max !== undefined ? <p className="form-hint">{f.min} to {f.max}</p> : null}
    </div>
  )
}
