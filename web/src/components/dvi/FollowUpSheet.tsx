'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Notice from '@/components/Notice'
import { cleanDecisions, findings } from '@/lib/dvi'
import { agoWords, followUpState, followUpText, inQuietHours, QUIET_WORDS } from '@/lib/dvi-followup'
import { smsParts, withOptOut } from '@/lib/growth-text'
import { nowIn } from '@/lib/schedule-capacity'
import { getShopId, supabase } from '@/lib/supabase'
import { normName } from '@/lib/shopboard'
import { postApi } from './api'
import type { StartCustomer } from './StartSheet'
import type { DviListRow } from './types'
import { loadInspection } from './useDvi'

/**
 * Follow up on an inspection the customer said no to, or never answered: a short, calm text about their own car that
 * names the work, links to booking (when the shop takes online bookings) and always ends with the opt-out line.
 * The shop reads it, can change it, and sends it. Nothing here sends by itself.
 */
export default function FollowUpSheet({ row, customers, shop, canRemember, onSent, onClose }: {
  row: DviListRow
  customers: StartCustomer[]
  shop: { name: string; phone: string }
  /** False when the follow-up columns do not exist yet: the text still goes, but "followed up" cannot be remembered. */
  canRemember: boolean
  onSent: (remembered: boolean) => void
  onClose: () => void
}) {
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading')
  const [loadError, setLoadError] = useState('')
  const [text, setText] = useState('')
  const [to, setTo] = useState('')
  const [tz, setTz] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [hasBooking, setHasBooking] = useState(false)
  const key = useRef('')
  const state = useMemo(() => followUpState(row), [row])

  const customer = useMemo(() => {
    const direct = row.customer_id ? customers.find(c => c.id === row.customer_id) : undefined
    if (direct) return direct
    const same = customers.filter(c => normName(c.name) === normName(row.customer_name))
    return same.length === 1 ? same[0] : undefined
  }, [customers, row.customer_id, row.customer_name])

  useEffect(() => {
    let live = true
    ;(async () => {
      const [loaded, share, settings] = await Promise.all([
        loadInspection(row.id),
        postApi('/api/inspection/share', { id: row.id }),
        fetch('/api/schedule/settings', { cache: 'no-store' }).then(r => r.json()).catch(() => null) as Promise<{ ok?: boolean; online?: { enabled?: boolean; slug?: string }; timezone?: string } | null>,
      ])
      if (!live) return
      if (!loaded.row) { setLoadError(loaded.error || 'The inspection did not load.'); setPhase('error'); return }
      const list = findings(loaded.row.sections)
      const decisions = cleanDecisions(loaded.row.customer_decisions, list.map(f => f.id))
      const items = (state?.kind === 'declined' ? list.filter(f => decisions[f.id] === 'declined') : list).map(f => f.name)
      const inspectionUrl = share.ok && typeof share.data.url === 'string' ? share.data.url : null
      const token = inspectionUrl ? inspectionUrl.split('/').pop() || '' : ''
      const origin = inspectionUrl ? new URL(inspectionUrl).origin : window.location.origin
      const slug = settings?.ok && settings.online?.enabled && settings.online.slug ? settings.online.slug : ''
      const bookUrl = slug ? `${origin}/book/${slug}${token ? `?r=${encodeURIComponent(token)}` : ''}` : null
      setHasBooking(Boolean(bookUrl))
      setTz(settings?.timezone || null)
      setTo(customer?.phone || '')
      setText(followUpText({
        kind: state?.kind || 'declined', customer: row.customer_name, vehicle: row.vehicle, shop: shop.name, phone: shop.phone,
        items, bookUrl, inspectionUrl: state?.kind === 'unanswered' ? inspectionUrl : null,
      }))
      setPhase('ready')
    })().catch(() => { if (live) { setLoadError('The follow-up could not be prepared. Check your connection and try again.'); setPhase('error') } })
    return () => { live = false }
    // The text is prepared once, when the sheet opens; the shop edits it from there.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row.id])

  const final = withOptOut(text)
  const parts = smsParts(final)
  const quiet = inQuietHours(nowIn(tz).minutes)

  const send = async () => {
    setProblem('')
    if (to.replace(/\D/g, '').length < 10) { setProblem('Enter a full phone number, with the area code.'); return }
    if (quiet) { setProblem(QUIET_WORDS); return }
    if (!text.trim()) { setProblem('The message is empty.'); return }
    setBusy(true)
    try {
      if (!key.current) key.current = `dvi-follow-${row.id}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
      const same = Boolean(customer?.phone) && (customer?.phone || '').replace(/\D/g, '').slice(-10) === to.replace(/\D/g, '').slice(-10)
      const sent = await postApi('/api/send-message', { to: to.trim(), body: final, channel: 'sms', ...(same && customer ? { customerId: customer.id } : {}), ...(row.job_id ? { jobId: row.job_id } : {}) }, { 'Idempotency-Key': key.current })
      if (!sent.ok) { setProblem(sent.error || 'The text was not sent.'); return }
      key.current = ''
      const at = new Date().toISOString()
      let remembered = false
      if (canRemember) {
        const shopId = await getShopId()
        if (shopId) {
          const { error } = await supabase.from('dvi').update({ followup_sent_at: at, followup_count: (row.followup_count || 0) + 1 }).eq('id', row.id).eq('shop_id', shopId)
          remembered = !error
        }
      }
      onSent(remembered)
    } finally { setBusy(false) }
  }

  if (phase === 'loading') return <div className="space-y-2" aria-busy="true" aria-label="Preparing the follow-up"><div className="skeleton h-10" /><div className="skeleton h-40" /><div className="skeleton h-12" /></div>
  if (phase === 'error') {
    return (
      <div>
        <Notice kind="error">{loadError}</Notice>
        <button type="button" className="btn btn-secondary mt-4 w-full" onClick={onClose}>Close</button>
      </div>
    )
  }

  return (
    <div>
      <p className="text-[0.9375rem]">
        {state?.kind === 'declined' ? `${row.customer_name || 'The customer'} said no to some of the work ${agoWords(state.days)}.` : `${row.customer_name || 'The customer'} has not answered the inspection sent ${agoWords(state?.days ?? 0)}.`}
        {state?.followedUp ? ` You followed up ${agoWords(Math.max(0, Math.floor((Date.now() - Date.parse(state.followedUp)) / 86_400_000)))}.` : ''}
      </p>

      <label className="form-label mt-4" htmlFor="follow-to">Send to this number</label>
      <input id="follow-to" className="form-input" type="tel" inputMode="tel" autoComplete="off" value={to} onChange={e => setTo(e.target.value)} placeholder="(713) 555-0100" />
      <p className="mt-1 text-[0.8125rem] text-text-secondary">{customer ? (customer.phone ? `From ${customer.name}’s customer record.` : `${customer.name} has no phone number on file. Enter one here.`) : 'This customer is not linked to a customer record, so check the number.'}</p>

      <label className="form-label mt-4" htmlFor="follow-text">The text they will get</label>
      <textarea id="follow-text" className="form-input" rows={7} value={text} onChange={e => setText(e.target.value)} maxLength={600} />
      <p className="mt-1 text-[0.8125rem] text-text-secondary">
        <span className="num">{parts.chars}</span> characters, {parts.parts} {parts.parts === 1 ? 'text' : 'texts'}. “Reply STOP to opt out.” is always added at the end.
        {!hasBooking && ' Online booking is off, so there is no booking link.'}
      </p>

      {quiet && <Notice kind="warn" className="mt-3">{QUIET_WORDS}</Notice>}
      {problem && <p role="alert" className="form-error">{problem}</p>}
      <div className="mt-5 grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Not now</button>
        <button type="button" className="btn btn-primary" onClick={() => void send()} disabled={busy || quiet}>{busy ? 'Sending…' : 'Send text'}</button>
      </div>
    </div>
  )
}
