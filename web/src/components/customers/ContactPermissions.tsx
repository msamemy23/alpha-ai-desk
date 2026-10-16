'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { consentView } from '@/lib/customers/consent'
import type { ChannelState, ChannelView } from '@/lib/customers/consent'
import { JSON_HEADERS, asText, fetchJson } from './http'

interface Prefs { doNotCall: boolean; doNotEmail: boolean; bestTime: string; channel: string }
interface SmsRecord { optedOut: boolean; source: string; updatedAt: string }
interface Loaded { available: boolean; prefs: Prefs; sms: SmsRecord | null; smsCheckFailed: boolean }

type Choice = 'doNotCall' | 'doNotEmail'

const LAMP: Record<ChannelState, string> = { ok: 'lamp-green', blocked: 'lamp-red', missing: 'lamp-off', unknown: 'lamp-amber' }

const CHOICES: Array<{ key: Choice; field: 'do_not_call' | 'do_not_email'; label: string; hint: string }> = [
  { key: 'doNotCall', field: 'do_not_call', label: 'Do not call this customer', hint: 'Alpha will not call them. You can still call them yourself.' },
  { key: 'doNotEmail', field: 'do_not_email', label: 'Do not email this customer', hint: 'Records that they asked not to get email.' },
]

function readLoaded(d: Record<string, unknown>): Loaded {
  const p = d.prefs && typeof d.prefs === 'object' ? (d.prefs as Record<string, unknown>) : {}
  const s = d.sms && typeof d.sms === 'object' ? (d.sms as Record<string, unknown>) : null
  return {
    available: d.available === true,
    prefs: { doNotCall: p.do_not_call === true, doNotEmail: p.do_not_email === true, bestTime: asText(p.best_time), channel: asText(p.preferred_channel) },
    sms: s ? { optedOut: s.opted_out === true, source: asText(s.source), updatedAt: asText(s.updated_at) } : null,
    smsCheckFailed: d.sms_check_failed === true,
  }
}

function Row({ icon, name, view, note }: { icon: string; name: string; view: ChannelView; note?: string }) {
  return (
    <li className="px-3 py-3">
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-bold">
          <Icon name={icon} className="h-5 w-5 shrink-0 text-text-secondary" />{name}
        </span>
        <span className="flex items-center gap-1.5 text-right font-bold">
          <span className={`lamp ${LAMP[view.state]}`} aria-hidden="true" />{view.label}
        </span>
      </div>
      <p className="mt-1 break-words text-[0.9375rem] text-text-secondary">{view.detail}</p>
      {note && <p className="mt-1 break-words text-[0.9375rem]">{note}</p>}
    </li>
  )
}

function Switch({ label, hint, on, onToggle, disabled }: { label: string; hint: string; on: boolean; onToggle: () => void; disabled: boolean }) {
  return (
    <button
      type="button" role="switch" aria-checked={on} onClick={onToggle} disabled={disabled}
      className="flex min-h-[52px] w-full items-center gap-3 px-3 py-2 text-left hover:bg-bg-hover disabled:opacity-60"
    >
      <span className="min-w-0 flex-1">
        <span className="block font-bold">{label}</span>
        <span className="block text-[0.9375rem] text-text-secondary">{hint}</span>
      </span>
      <span className={`w-8 shrink-0 text-right text-[0.875rem] font-bold ${on ? 'text-blue' : 'text-text-secondary'}`}>{on ? 'On' : 'Off'}</span>
      <span aria-hidden="true" className={`relative inline-block h-7 w-12 shrink-0 rounded-full border ${on ? 'border-blue bg-blue' : 'border-line bg-bg-input'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full ${on ? 'left-[1.5rem] bg-[rgb(var(--c-on-blue))]' : 'left-0.5 bg-text-secondary'}`} />
      </span>
    </button>
  )
}

/**
 * Who can contact this customer, in plain words: a lamp and a sentence for Text, Call and Email,
 * and two switches the shop can use to record that a customer asked not to be called or emailed.
 * Text permission is never switched back on here. Only the customer's own START reply does that.
 */
export default function ContactPermissions({ customerId, phone, email, refreshKey = 0 }: {
  customerId: string
  phone: string
  email: string
  /** Change this number to read the choices again, for example after a call ended with a request not to be called. */
  refreshKey?: number
}) {
  const [data, setData] = useState<Loaded | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [saving, setSaving] = useState<Record<Choice, boolean>>({ doNotCall: false, doNotEmail: false })
  const [saveError, setSaveError] = useState('')
  const seq = useRef(0)
  const customerRef = useRef(customerId)
  const savingRef = useRef<Record<Choice, boolean>>({ doNotCall: false, doNotEmail: false })
  const shownFor = useRef('')

  const load = useCallback(async (quiet: boolean) => {
    const mine = ++seq.current
    if (!quiet) { setStatus('loading'); setData(null) }
    setSaveError('')
    try {
      const r = await fetchJson(`/api/customers/contact-prefs?customer_id=${encodeURIComponent(customerId)}`, { cache: 'no-store' })
      if (mine !== seq.current) return
      if (r.ok && r.data && r.data.ok === true) { setData(readLoaded(r.data)); setStatus('ready') }
      else { setData(null); setStatus('error') }
    } catch {
      if (mine !== seq.current) return
      setData(null)
      setStatus('error')
    }
  }, [customerId])

  useEffect(() => {
    customerRef.current = customerId
    // Reading again after a change should not flash the loading state; opening a different customer should.
    const quiet = shownFor.current === customerId
    shownFor.current = customerId
    void load(quiet)
  }, [load, customerId, refreshKey])

  const toggle = async (choice: (typeof CHOICES)[number]) => {
    if (!data || savingRef.current[choice.key]) return
    const before = data.prefs[choice.key]
    const next = !before
    const forCustomer = customerId
    const set = (value: boolean) => setData(d => (d ? { ...d, prefs: { ...d.prefs, [choice.key]: value } } : d))
    savingRef.current[choice.key] = true
    setSaving(s => ({ ...s, [choice.key]: true }))
    setSaveError('')
    set(next)
    try {
      const r = await fetchJson('/api/customers/contact-prefs', {
        method: 'PUT',
        headers: JSON_HEADERS,
        body: JSON.stringify({ customer_id: customerId, [choice.field]: next }),
      })
      if (!(r.ok && r.data && r.data.ok === true)) throw new Error(asText(r.data?.error))
    } catch (e) {
      if (customerRef.current !== forCustomer) return
      set(before)
      const why = e instanceof Error ? e.message : ''
      setSaveError(`That change was not saved. ${why || 'Check your connection and try again.'}`)
    } finally {
      savingRef.current[choice.key] = false
      setSaving(s => ({ ...s, [choice.key]: false }))
    }
  }

  if (status === 'loading') {
    return <div className="space-y-2" aria-busy="true" aria-label="Loading contact choices">{[0, 1, 2].map(i => <div key={i} className="skeleton h-14" />)}</div>
  }

  if (status === 'error' || !data) {
    return (
      <Notice kind="error">
        <p className="font-bold">Contact choices could not be loaded.</p>
        <p className="mt-1">Check your connection and try again.</p>
        <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => void load(false)}>Try again</button>
      </Notice>
    )
  }

  const view = consentView({
    phone: phone || '',
    email: email || '',
    cardOptedOut: false,
    record: data.smsCheckFailed ? undefined : (data.sms ? { optedOut: data.sms.optedOut, source: data.sms.source, updatedAt: data.sms.updatedAt } : null),
    prefs: { doNotCall: data.prefs.doNotCall, doNotEmail: data.prefs.doNotEmail, doNotText: false, bestTime: data.prefs.bestTime, channel: data.prefs.channel },
  })

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border rounded-lg border border-border bg-bg-base">
        <Row icon="inbox" name="Text" view={view.text} note={view.text.state === 'blocked' ? 'Only the customer can turn texts back on, by replying START.' : undefined} />
        <Row icon="phone" name="Call" view={view.call} />
        <Row icon="mail" name="Email" view={view.email} />
      </ul>

      {!data.available ? (
        <Notice kind="info">Contact choices need a database update. Everything else still works.</Notice>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border bg-bg-base">
          {CHOICES.map(c => (
            <Switch key={c.key} label={c.label} hint={c.hint} on={data.prefs[c.key]} disabled={saving[c.key]} onToggle={() => void toggle(c)} />
          ))}
        </div>
      )}

      {saveError && <p role="alert" className="form-error !text-[0.9375rem]">{saveError}</p>}
    </div>
  )
}
