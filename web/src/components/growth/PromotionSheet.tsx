'use client'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import Sheet from '@/components/Sheet'
import { Segmented, Switch } from '@/components/ScreenParts'
import { call } from '@/components/automations/api'
import { looksLikePhone, plural, quietWords, whenWords } from '@/components/automations/model'
import { smsSegments, templateProblems, unknownPlaceholders } from '@/lib/automation-rules'
import {
  audienceProblems, audienceToForm, emptyForm, formToAudience, isLocalValue, sameAudience, shopLocalValue, tomorrowMorning,
} from './promotions-model'
import type { AudienceForm, PromotionPreview, PromotionShop, PromotionView } from './promotions-model'

export interface PromotionSeed { name: string; message: string; email_subject: string; audience: Record<string, unknown> }

interface Props {
  /** The draft being edited. Null starts a new one. */
  promotion: PromotionView | null
  /** Wording and audience to start from (a copy of an earlier promotion). */
  seed?: PromotionSeed | null
  shop: PromotionShop
  onClose: () => void
  onChanged: () => void
  notify: (message: string, kind?: 'success' | 'error' | 'info') => void
}

const ALLOWED = ['name', 'shop', 'contact']
const CHIPS: Array<[string, string]> = [['name', 'First name'], ['shop', 'Shop name'], ['contact', 'How to reach you']]
const PHONE_KEY = 'alpha_test_phone'
const readPhone = (): string => { try { return window.localStorage.getItem(PHONE_KEY) || '' } catch { return '' } }
const savePhone = (v: string) => { try { window.localStorage.setItem(PHONE_KEY, v) } catch { /* the number just is not remembered */ } }

type Live = { state: 'idle' | 'loading' | 'ready' | 'error'; data: PromotionPreview | null; error: string }

/** Write a promotion, choose who gets it, read the exact messages, then send now or at a set time. Nothing leaves until the last button. */
export default function PromotionSheet({ promotion, seed, shop, onClose, onChanged, notify }: Props) {
  const base = useId()
  const start = promotion || seed || null
  const initialForm = useMemo(() => (start ? audienceToForm(start.audience) : emptyForm()), [start])
  const [name, setName] = useState(start?.name || '')
  const [message, setMessage] = useState(start?.message || '')
  const [subject, setSubject] = useState(start?.email_subject || '')
  const [form, setForm] = useState<AudienceForm>(initialForm)
  const [when, setWhen] = useState<'now' | 'later'>('now')
  const [local, setLocal] = useState(() => tomorrowMorning(Date.now(), shop.timezone))
  const [id, setId] = useState<string | null>(promotion?.id || null)
  const [live, setLive] = useState<Live>({ state: 'idle', data: null, error: '' })
  const [confirming, setConfirming] = useState(false)
  const [working, setWorking] = useState<'' | 'save' | 'send' | 'test'>('')
  const [error, setError] = useState('')
  const [tried, setTried] = useState(false)
  const [phone, setPhone] = useState('')
  const [tested, setTested] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [showLeft, setShowLeft] = useState(false)
  const busy = useRef(false)
  const area = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { setPhone(readPhone()) }, [])

  const audience = useMemo(() => formToAudience(form), [form])
  const filterProblems = useMemo(() => audienceProblems(form), [form])
  const messageProblems = useMemo(() => {
    if (!message.trim()) return []
    const out = templateProblems(message, { klass: 'marketing', channel: 'sms' })
    const stray = unknownPlaceholders(message, ALLOWED).filter(k => !out.some(e => e.includes(`{${k}}`)))
    if (stray.length) out.push(`A promotion can only use ${ALLOWED.map(a => `{${a}}`).join(', ')}. Remove ${stray.map(k => `{${k}}`).join(', ')}.`)
    return [...new Set(out)]
  }, [message])
  const messageOk = message.trim().length > 0 && messageProblems.length === 0
  const parts = useMemo(() => smsSegments(`${message.replace(/\{[^{}]*\}/g, 'xxxxxxxxxxxx')} Reply STOP to opt out.`), [message])
  const laterOk = when === 'now' || isLocalValue(local)
  const dirty = name !== (start?.name || '') || message !== (start?.message || '') || subject !== (start?.email_subject || '') || !sameAudience(form, initialForm)

  // The people and the exact words, rebuilt a moment after you stop typing. Nothing is written.
  const liveKey = JSON.stringify([messageOk ? message : '', subject, audience, when === 'later' && laterOk ? local : '', filterProblems.length])
  useEffect(() => {
    if (filterProblems.length) { setLive({ state: 'idle', data: null, error: '' }); return }
    let stale = false
    setLive(p => ({ ...p, state: 'loading' }))
    const t = setTimeout(async () => {
      const r = await call('/api/growth/promotions', {
        action: 'preview', name: name || 'Preview', message: messageOk ? message : '', email_subject: subject, audience,
        audience_only: !messageOk, ...(when === 'later' && laterOk ? { send_local: local } : {}),
      })
      if (stale) return
      setLive(r.ok ? { state: 'ready', data: r.data as unknown as PromotionPreview, error: '' } : { state: 'error', data: null, error: r.error })
    }, 600)
    return () => { stale = true; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey])

  const setF = (patch: Partial<AudienceForm>) => { setForm(p => ({ ...p, ...patch })); setError(''); setConfirming(false) }
  const edited = () => { setError(''); setConfirming(false); setTested('') }

  const insert = (key: string) => {
    const el = area.current
    const token = `{${key}}`
    if (!el) { setMessage(m => `${m}${token}`); edited(); return }
    const a = el.selectionStart ?? message.length
    const b = el.selectionEnd ?? message.length
    setMessage(`${message.slice(0, a)}${token}${message.slice(b)}`); edited()
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + token.length, a + token.length) })
  }

  /** Writes the draft, or updates it. Returns its id, or the reason it could not be saved. */
  const persist = async (): Promise<{ id: string } | { error: string }> => {
    const r = await call('/api/growth/promotions', { action: 'save', ...(id ? { id } : {}), name, message, email_subject: subject, audience })
    if (!r.ok) return { error: r.error }
    const saved = String(r.data.id || id || '')
    if (!saved) return { error: 'The draft could not be saved. Try again.' }
    setId(saved)
    return { id: saved }
  }

  const problemsNow = (): string => {
    if (!name.trim()) return 'Give the promotion a name so you can find it later.'
    if (!message.trim()) return 'Write the message first. Alpha never makes up an offer for you.'
    if (messageProblems.length) return messageProblems[0]
    if (filterProblems.length) return filterProblems[0]
    return ''
  }

  const saveDraft = async () => {
    setTried(true)
    const p = problemsNow()
    if (p || busy.current) { if (p) setError(p); return }
    busy.current = true; setWorking('save'); setError('')
    try {
      const out = await persist()
      if ('error' in out) { setError(out.error); return }
      notify('Draft saved. Nothing has been sent.', 'success')
      onChanged(); onClose()
    } finally { busy.current = false; setWorking('') }
  }

  const sendNow = async () => {
    if (busy.current) return
    busy.current = true; setWorking('send'); setError('')
    try {
      const out = await persist()
      if ('error' in out) { setError(out.error); setConfirming(false); return }
      const r = await call('/api/growth/promotions', { action: 'send', id: out.id, ...(when === 'later' ? { send_local: local } : {}) })
      onChanged()
      if (!r.ok) { setError(r.error); setConfirming(false); return }
      notify(String(r.data.message || 'Done.'), 'success')
      onClose()
    } finally { busy.current = false; setWorking('') }
  }

  const askToSend = () => {
    setTried(true)
    const p = problemsNow()
    if (p) { setError(p); return }
    if (!laterOk) { setError('Pick a date and time for the promotion.'); return }
    setError(''); setConfirming(true)
  }

  const sendTest = async () => {
    if (busy.current) return
    if (!messageOk) { setError('Write a valid message first, then test it.'); return }
    if (!looksLikePhone(phone)) { setError('Enter your own mobile number with the area code.'); return }
    busy.current = true; setWorking('test'); setError(''); setTested('')
    try {
      savePhone(phone)
      const r = await call('/api/system-automations', { action: 'test_send', id: 'sms_blast', to: phone, config: { message, email_subject: subject } })
      if (r.ok) setTested(String(r.data.message || 'Test text sent to your phone.')); else setError(r.error)
    } finally { busy.current = false; setWorking('') }
  }

  const d = live.data
  const c = d?.counts
  const shown = showAll ? d?.recipients || [] : (d?.recipients || []).slice(0, 3)
  const noReach = !shop.sms_ready && !shop.email_ready
  const cannotSend = noReach ? 'Texting is not set up yet. Add your Telnyx key and number in Settings first.' : !shop.master_enabled ? 'All automations are switched off, and that includes promotions. Switch them back on in Automations first.' : ''
  const willReceive = c?.will_receive ?? 0
  const title = promotion ? 'Edit promotion' : 'New promotion'

  return (
    <Sheet open onClose={() => { if (!working) onClose() }} title={title} wide dirty={dirty}>
      <form onSubmit={e => { e.preventDefault(); void saveDraft() }} className="space-y-5 text-[0.9375rem]" noValidate>
        <div>
          <label htmlFor={`${base}-name`} className="form-label">Name</label>
          <input id={`${base}-name`} className="form-input" value={name} maxLength={120} onChange={e => { setName(e.target.value); edited() }} placeholder="For example: Fall brake check" aria-invalid={tried && !name.trim()} />
          <p className="form-hint">Only you see this. It helps you find the promotion later.</p>
        </div>

        <div>
          <label htmlFor={`${base}-message`} className="form-label">Message</label>
          <textarea
            id={`${base}-message`} ref={area} className="form-textarea" rows={5} value={message} maxLength={1000} onChange={e => { setMessage(e.target.value); edited() }}
            aria-invalid={tried && (!message.trim() || messageProblems.length > 0)} aria-describedby={`${base}-message-hint`}
            placeholder="Hi {name}, this is {shop}. Write the offer or news in your own words. {contact}"
          />
          <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Add a detail from the customer or shop">
            {CHIPS.map(([k, label]) => (
              <button key={k} type="button" className="tag tag-gray min-h-[2.25rem] cursor-pointer px-3" onClick={() => insert(k)} aria-label={`Add ${label}`}>+ {label}</button>
            ))}
          </div>
          <p id={`${base}-message-hint`} className="form-hint">
            <span className="num">{[...message].length}</span> characters · {plural(parts.parts, 'text part')}. An opt-out line is added to the end for you.
            Alpha never makes up prices, offers or promises: only what you write goes out.
          </p>
          {messageProblems.map(p => <p key={p} className="form-error">{p}</p>)}
        </div>

        {shop.email_ready && (
          <div>
            <label htmlFor={`${base}-subject`} className="form-label">Email subject (optional)</label>
            <input id={`${base}-subject`} className="form-input" value={subject} maxLength={120} onChange={e => { setSubject(e.target.value); edited() }} placeholder="A message from your shop" />
            <p className="form-hint">Used only for customers who have an email address but no number we can text.</p>
          </div>
        )}

        <fieldset className="rounded-md border border-border p-3">
          <legend className="px-1 font-bold">Who gets it</legend>
          <p className="mb-3 text-text-secondary">Leave a box empty to not filter on it. Anyone who replied STOP, or has no usable number, is always left out.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id={`${base}-notin`} label="Not in for at least (days)" value={form.notInDays} onChange={v => setF({ notInDays: v })} placeholder="For example 180" numeric />
            <Field id={`${base}-within`} label="In within the last (days)" value={form.inWithinDays} onChange={v => setF({ inWithinDays: v })} placeholder="For example 365" numeric />
            <Field id={`${base}-makes`} label="Drives (makes, comma separated)" value={form.makes} onChange={v => setF({ makes: v })} placeholder="Toyota, Honda" />
            <Field id={`${base}-tags`} label="Tagged (comma separated)" value={form.tags} onChange={v => setF({ tags: v })} placeholder="fleet, vip" />
            <Field id={`${base}-y1`} label="Model year from" value={form.yearMin} onChange={v => setF({ yearMin: v })} placeholder="2010" numeric />
            <Field id={`${base}-y2`} label="Model year to" value={form.yearMax} onChange={v => setF({ yearMax: v })} placeholder="2020" numeric />
            <Field id={`${base}-s1`} label="Spent at least ($)" value={form.minSpend} onChange={v => setF({ minSpend: v })} placeholder="500" numeric />
            <Field id={`${base}-s2`} label="Spent at most ($)" value={form.maxSpend} onChange={v => setF({ maxSpend: v })} placeholder="5000" numeric />
          </div>
          {form.tags.trim() && (
            <div className="mt-3 max-w-xs">
              <label htmlFor={`${base}-tagmode`} className="form-label">With several tags</label>
              <select id={`${base}-tagmode`} className="form-select" value={form.tagMode} onChange={e => setF({ tagMode: e.target.value === 'all' ? 'all' : 'any' })}>
                <option value="any">Has any of them</option>
                <option value="all">Has all of them</option>
              </select>
            </div>
          )}
          <div className="mt-3 flex items-center justify-between gap-3">
            <span id={`${base}-email`}>Only customers with an email address</span>
            <Switch checked={form.hasEmail} onChange={v => setF({ hasEmail: v })} label="Only customers with an email address" />
          </div>
          {filterProblems.map(p => <p key={p} className="form-error">{p}</p>)}
        </fieldset>

        <section aria-labelledby={`${base}-who`} aria-live="polite">
          <h3 id={`${base}-who`} className="section-title mb-2">Who this reaches</h3>
          {filterProblems.length > 0 ? (
            <p className="text-text-secondary">Fix the filters above to see who this reaches.</p>
          ) : live.state === 'error' ? (
            <Notice kind="error">
              <p className="font-bold">The list did not load.</p>
              <p>{live.error}</p>
            </Notice>
          ) : !d ? (
            <div className="space-y-2" role="status" aria-busy="true" aria-label="Working out who this reaches"><div className="skeleton h-16" /><div className="skeleton h-20" /></div>
          ) : (
            <div className={live.state === 'loading' ? 'opacity-60' : ''}>
              {d.problems.map(p => <Notice key={p} kind="warn" className="mb-2">{p}</Notice>)}
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-4">
                <Count label="Match your filters" value={d.matched} />
                <Count label="Will be messaged" value={c?.will_receive ?? 0} strong />
                <Count label="Held until morning" value={c?.held_for_quiet_hours ?? 0} />
                <Count label="Left out" value={c?.left_out ?? 0} />
              </div>
              {(c?.over_limit ?? 0) > 0 && <p className="mt-2 text-text-secondary">{plural(c?.over_limit ?? 0, 'person', 'people')} already got a marketing text this week, so they are waiting for their next turn.</p>}
              {messageOk && (c?.emails ?? 0) > 0 && <p className="mt-2 text-text-secondary">{plural(c?.texts ?? 0, 'text')} and {plural(c?.emails ?? 0, 'email')}.</p>}
              <p className="mt-2 text-text-secondary">{quietWords({ quiet_start_hour: d.quiet_hours.start, quiet_end_hour: d.quiet_hours.end, skip_sundays: d.quiet_hours.skip_sundays })}. A text that would land then waits until morning.</p>
            </div>
          )}
        </section>

        {messageOk && d && d.recipients.length > 0 && (
          <section aria-labelledby={`${base}-exact`}>
            <h3 id={`${base}-exact`} className="section-title mb-2">The exact messages</h3>
            <ul className="space-y-3">
              {shown.map((r, i) => (
                <li key={`${r.to}-${i}`} className="rounded-md border border-border bg-bg-card p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                    <p className="min-w-0 break-words font-bold">{r.name} <span className="font-normal text-text-secondary">· {r.to}</span></p>
                    <p className="text-[0.8125rem] text-text-secondary">{r.held ? 'Held until ' : 'Goes out '}{whenWords(r.send_at_iso, shop.timezone)}</p>
                  </div>
                  {r.subject && <p className="mt-1 break-words text-text-secondary">Subject: {r.subject}</p>}
                  <p className="mt-2 whitespace-pre-wrap break-words rounded-md bg-bg-hover px-3 py-2">{r.text}</p>
                  <p className="mt-1.5 text-[0.8125rem] text-text-secondary">{r.channel === 'sms' ? plural(r.parts, 'text part') : 'Email'}</p>
                </li>
              ))}
            </ul>
            {d.recipients.length > 3 && (
              <button type="button" className="btn btn-secondary mt-3" onClick={() => setShowAll(v => !v)} aria-expanded={showAll}>
                {showAll ? 'Show fewer' : `Show all ${d.recipients.length}${willReceive > d.recipients.length ? ` of ${willReceive}` : ''}`}
              </button>
            )}
          </section>
        )}

        {d && ((d.left_out_by.length > 0) || (c?.left_out ?? 0) > 0) && (
          <section aria-labelledby={`${base}-left`}>
            <h3 id={`${base}-left`} className="section-title mb-2">Left out, and why</h3>
            <ul className="space-y-1">
              {d.left_out_by.map(s => <li key={s.reason} className="flex justify-between gap-3"><span>{s.label}</span><span className="num font-bold">{s.count.toLocaleString('en-US')}</span></li>)}
            </ul>
            {d.left_out.length > 0 && (
              <>
                <button type="button" className="btn btn-ghost mt-2" onClick={() => setShowLeft(v => !v)} aria-expanded={showLeft}>{showLeft ? 'Hide names' : 'Show names'}</button>
                {showLeft && (
                  <ul className="mt-1 divide-y divide-border rounded-md border border-border">
                    {d.left_out.map((s, i) => <li key={`${s.name}-${i}`} className="flex flex-wrap justify-between gap-x-3 px-3 py-2"><span className="break-words font-bold">{s.name}</span><span className="text-text-secondary">{s.label}</span></li>)}
                  </ul>
                )}
              </>
            )}
          </section>
        )}

        <section className="rounded-md border border-border p-3" aria-labelledby={`${base}-test`}>
          <h3 id={`${base}-test`} className="font-bold">Send a test to yourself</h3>
          <p className="mt-0.5 text-text-secondary">Texts the message to your own phone only. Marked [Test]. No customer is contacted.</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <label className="sr-only" htmlFor={`${base}-phone`}>Your mobile number</label>
            <input id={`${base}-phone`} className="form-input sm:max-w-[16rem]" type="tel" inputMode="tel" autoComplete="tel" placeholder="Your mobile number" value={phone} onChange={e => { setPhone(e.target.value); setTested(''); setError('') }} />
            <button type="button" className="btn btn-secondary" onClick={() => void sendTest()} disabled={working !== '' || !messageOk || !shop.sms_ready} aria-busy={working === 'test'}>
              <Icon name="send" className="h-5 w-5" />{working === 'test' ? 'Sending…' : 'Send test'}
            </button>
          </div>
          {!shop.sms_ready && <p className="form-hint">Texting is not set up yet, so a test cannot be sent.</p>}
          {tested && <p role="status" className="mt-2 font-bold text-green">{tested}</p>}
        </section>

        <section aria-labelledby={`${base}-when`}>
          <h3 id={`${base}-when`} className="section-title mb-2">When</h3>
          <div className="max-w-sm">
            <Segmented label="When to send" idPrefix={`${base}-when-seg`} columns="grid-cols-2" options={[{ key: 'now', label: 'Send now' }, { key: 'later', label: 'Send later' }]} value={when} onChange={v => { setWhen(v); edited() }} />
          </div>
          {when === 'later' && (
            <div className="mt-3 max-w-xs">
              <label htmlFor={`${base}-local`} className="form-label">Date and time (shop clock)</label>
              <input id={`${base}-local`} className="form-input" type="datetime-local" value={local} min={shopLocalValue(Date.now() + 10 * 60_000, shop.timezone)} onChange={e => { setLocal(e.target.value); edited() }} />
              <p className="form-hint">Who gets it is worked out now, so what you see here is what goes out. Each person is checked again right before their message.</p>
            </div>
          )}
        </section>

        {cannotSend && <Notice kind="warn">{cannotSend}</Notice>}
        {error && <Notice kind="error">{error}</Notice>}

        {confirming ? (
          <div className="rounded-md border border-border bg-bg-hover p-3" role="alertdialog" aria-label="Confirm sending">
            <p className="font-bold">
              {when === 'later'
                ? `Schedule this for ${plural(willReceive, 'person', 'people')}?`
                : `Send this to ${plural(willReceive, 'person', 'people')} now?`}
            </p>
            <p className="mt-1 text-text-secondary">
              {when === 'later' ? `They go out ${d?.first_send_iso ? whenWords(d.first_send_iso, shop.timezone) : 'at the time you picked'}. ` : ''}
              Texts that have gone out cannot be taken back. You can stop the rest while they are going out.
            </p>
            <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)} disabled={working === 'send'}>Go back</button>
              <button type="button" className="btn btn-primary" onClick={() => void sendNow()} disabled={working === 'send'} aria-busy={working === 'send'}>
                <Icon name="send" className="h-5 w-5" />{working === 'send' ? 'Sending…' : when === 'later' ? 'Yes, schedule it' : 'Yes, send it'}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={working !== ''}>Cancel</button>
            <button type="submit" className="btn btn-secondary" disabled={working !== ''} aria-busy={working === 'save'}>{working === 'save' ? 'Saving…' : 'Save draft'}</button>
            <button type="button" className="btn btn-primary" onClick={askToSend} disabled={working !== '' || cannotSend !== '' || (messageOk && live.state === 'ready' && willReceive === 0)}>
              <Icon name="send" className="h-5 w-5" />{when === 'later' ? 'Review and schedule' : 'Review and send'}
            </button>
          </div>
        )}
      </form>
    </Sheet>
  )
}

function Field({ id, label, value, onChange, placeholder, numeric }: { id: string; label: string; value: string; onChange: (v: string) => void; placeholder?: string; numeric?: boolean }) {
  return (
    <div>
      <label htmlFor={id} className="form-label">{label}</label>
      <input id={id} className="form-input" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} inputMode={numeric ? 'numeric' : undefined} autoComplete="off" />
    </div>
  )
}

function Count({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <div className="bg-bg-card px-3 py-3">
      <p className="text-[0.8125rem] font-bold text-text-secondary">{label}</p>
      <p className={`display num mt-0.5 text-[1.5rem] leading-none ${strong ? 'font-bold' : ''}`}>{value.toLocaleString('en-US')}</p>
    </div>
  )
}
