'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { getShopId, supabase } from '@/lib/supabase'
import { phonePretty } from '@/lib/today'
import Icon from '@/components/Icon'
import {
  fillName, followUpTemplate, hasPhone, leadEmailSubject, leadEmailTemplate, leadTextTemplate,
  referralCode, referralTemplate, reviewTemplate, splitForText, withOptOut,
} from '@/lib/growth-text'
import MessageSheet from './MessageSheet'
import type { Flag, Skipped, Who } from './MessageSheet'
import { IDLE_RUN, useBatchSend } from './useBatchSend'
import type { RunState } from './useBatchSend'
import { draftMessage, postOutreach, postSms } from './send'
import { isAfterHours } from './promotions-model'
import type { SmsResult } from './send'
import { unsupportedClaims } from '@/lib/automation-rules'
import { errText, isAiLead, timeAgo } from './helpers'
import type { Rec, ShopInfo } from './helpers'

export type Compose =
  | { kind: 'followup'; customers: Rec[] }
  | { kind: 'review'; customer: Rec }
  | { kind: 'referral'; customer: Rec }
  | { kind: 'lead'; lead: Rec; method: 'sms' | 'email' | 'ai_call' }

interface Props {
  compose: Compose
  shop: ShopInfo
  aiMode: boolean
  onClose: () => void
  /** Something was sent or saved, so the lists behind this sheet should refresh. */
  onChanged: () => void
  notify: (message: string, kind?: 'success' | 'error' | 'info') => void
}

const LEAD_DEFAULT_FLAG = 'Alpha found this lead on the web. They have not contacted your shop, so email them only if it is a good fit. They can unsubscribe in one click.'
const LEAD_NO_TEXT = 'Texting or calling someone who has not asked to hear from you needs their written permission. Alpha found this lead on the web, so use email, or call them yourself if they are a business.'

/** A lead that is a business has no first name to greet. Use the owner's name when Alpha found one. */
function greetingFor(lead: Rec): string {
  if (lead.source === 'ai-fleet-scan') return String(lead.owner_name || '')
  return String(lead.owner_name || lead.name || '')
}

async function logActivity(action: string, target: string, details: string) {
  const shopId = await getShopId()
  if (!shopId) throw new Error('No shop')
  const { error } = await supabase.from('growth_activity').insert({ shop_id: shopId, action, target, details, status: 'sent', created_at: new Date().toISOString() })
  if (error) throw new Error(error.message)
}

export default function SendFlow({ compose, shop, aiMode, onClose, onChanged, notify }: Props) {
  const session = useRef(typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now()))
  const { run, start, stop } = useBatchSend()
  const changed = useRef(false)

  // ── Who and what, by kind ──────────────────────────────────────────────
  const people: Rec[] = useMemo(() => {
    if (compose.kind === 'followup') return compose.customers
    if (compose.kind === 'review' || compose.kind === 'referral') return [compose.customer]
    return []
  }, [compose])
  const split = useMemo(() => splitForText(people), [people])

  const lead = compose.kind === 'lead' ? compose.lead : null
  const leadMethod = compose.kind === 'lead' ? compose.method : null
  const leadWho: Who[] = useMemo(() => {
    if (!lead || !leadMethod) return []
    if (leadMethod === 'email') return lead.email ? [{ id: String(lead.id), name: lead.name || 'Lead', to: String(lead.email) }] : []
    return hasPhone(lead.phone) ? [{ id: String(lead.id), name: lead.name || 'Lead', to: phonePretty(lead.phone) }] : []
  }, [lead, leadMethod])

  const [pctText, setPctText] = useState('10')
  const [creditText, setCreditText] = useState('25')
  const percent = Math.round(Number(pctText))
  const credit = Math.round(Number(creditText))
  const pctOk = pctText.trim() !== '' && percent >= 1 && percent <= 100
  const creditOk = creditText.trim() !== '' && credit >= 0
  const [code] = useState(() => (compose.kind === 'referral' ? referralCode(compose.customer.name) : ''))
  const [edited, setEdited] = useState(false)

  const initial = useMemo(() => {
    const name = shop.name || ''
    if (compose.kind === 'followup') return followUpTemplate(name, shop.phone)
    if (compose.kind === 'review') return reviewTemplate(name, shop.reviewUrl)
    if (compose.kind === 'referral') return referralTemplate(name, code, 10, 25)
    if (compose.kind === 'lead' && compose.method === 'email') return leadEmailTemplate(name, shop.phone, String(compose.lead.service_needed || ''))
    if (compose.kind === 'lead' && compose.method === 'sms') return leadTextTemplate(name, shop.phone, String(compose.lead.service_needed || ''))
    return ''
  }, [compose, shop.name, shop.phone, shop.reviewUrl, code])
  const [message, setMessage] = useState(initial)

  // Referral words follow the offer boxes until someone types their own.
  useEffect(() => {
    if (compose.kind !== 'referral' || edited) return
    setMessage(referralTemplate(shop.name || '', code, pctOk ? percent : 10, creditOk ? credit : 0))
  }, [compose.kind, edited, percent, credit, pctOk, creditOk, code, shop.name])

  // ── Alpha writes a draft for a lead, to be read and edited ─────────────
  const [drafting, setDrafting] = useState(false)
  const [draftNote, setDraftNote] = useState('')
  const [aiWritten, setAiWritten] = useState(false)
  const wantsDraft = compose.kind === 'lead' && compose.method !== 'ai_call' && aiMode
  const draft = useCallback(async () => {
    if (compose.kind !== 'lead' || compose.method === 'ai_call') return
    setDrafting(true); setDraftNote('')
    const channel = compose.method === 'email' ? 'email' : 'sms'
    const r = await draftMessage({ shopName: shop.name || 'our shop', shopPhone: shop.phone, channel, leadName: greetingFor(compose.lead), service: String(compose.lead.service_needed || '') })
    if (r.ok) {
      // The greeting has the real first name already, so no {name} is left in a draft.
      setMessage(channel === 'sms' ? withOptOut(r.text) : r.text)
      setEdited(true)
      setAiWritten(true)
    } else setDraftNote(`${r.error} This is the standard message instead. You can edit it.`)
    setDrafting(false)
  }, [compose, shop.name, shop.phone])
  const drafted = useRef(false)
  useEffect(() => {
    if (!wantsDraft || drafted.current || shop.state !== 'ready') return
    drafted.current = true
    void draft()
  }, [wantsDraft, draft, shop.state])

  // ── Sending ────────────────────────────────────────────────────────────
  const [error, setError] = useState('')
  const [off, setOff] = useState<Set<string>>(() => new Set())
  const toggle = (id: string) => setOff(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const [made, setMade] = useState<null | { code: string; texted: boolean }>(null)
  const [creating, setCreating] = useState(false)

  const sendCustomerText = useCallback((c: Rec): Promise<SmsResult> => (
    postSms({ to: String(c.phone), message: fillName(message, c.name), customerId: String(c.id), key: `growth:${session.current}:${String(c.id)}` })
  ), [message])

  const afterCustomerText = useCallback(async (c: Rec) => {
    changed.current = true
    const shopId = await getShopId()
    if (!shopId) throw new Error('No shop')
    const now = new Date().toISOString()
    if (compose.kind === 'review') {
      const { error: e } = await supabase.from('customers').update({ review_requested: now }).eq('id', c.id).eq('shop_id', shopId)
      if (e) throw e
      await logActivity('review_request', c.name, `Sent to ${c.phone}`)
    } else {
      const { error: e } = await supabase.from('customers').update({ last_contact: now }).eq('id', c.id).eq('shop_id', shopId)
      if (e) throw e
      await logActivity('follow_up_sms', c.name, `Sent to ${c.phone}`)
    }
  }, [compose.kind])

  const sendReferral = async () => {
    if (creating || run.phase !== 'idle') return
    const c = compose.kind === 'referral' ? compose.customer : null
    if (!c) return
    setCreating(true); setError('')
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('We could not find your shop. Refresh, or sign out and back in.')
      const { error: e } = await supabase.from('referrals').insert({ shop_id: shopId, customer_id: c.id, customer_name: c.name, code, discount_percent: percent, uses: 0 })
      if (e) throw new Error(e.message)
      changed.current = true
    } catch (e) {
      setError(`The code was not saved. ${errText(e, 'Check your connection and try again.')}`)
      setCreating(false)
      return
    }
    const canText = split.eligible.length > 0
    setMade({ code, texted: canText })
    setCreating(false)
    try { await logActivity('referral_created', c.name, `Code: ${code}`) } catch { /* the code exists; the activity note is a bonus */ }
    if (canText) await start(split.eligible, sendCustomerText)
  }

  const sendLead = async () => {
    if (!lead || !leadMethod) return
    const who = leadWho[0]
    if (!who) return
    setError('')
    const text = leadMethod === 'ai_call' ? undefined : fillName(message, greetingFor(lead))
    await start(
      [{ id: who.id, name: who.name }],
      async () => {
        const r = await postOutreach({ leadId: String(lead.id), method: leadMethod, aiMode, message: text, subject: leadMethod === 'email' ? leadEmailSubject(shop.name || '', String(lead.service_needed || '')) : undefined })
        return r.kind === 'failed' ? { kind: 'failed', error: r.error } : r
      },
      async () => { changed.current = true },
    )
  }

  const onSend = () => {
    if (compose.kind === 'referral') void sendReferral()
    else if (compose.kind === 'lead') void sendLead()
    else void start(split.eligible.filter(c => !off.has(String(c.id))), sendCustomerText, afterCustomerText)
  }

  const closeSheet = () => {
    if (changed.current) onChanged()
    onClose()
  }

  // A single successful send closes itself with a short message. Bigger sends stay open to show who was left out.
  const handled = useRef(false)
  useEffect(() => {
    if (run.phase !== 'done' || handled.current) return
    handled.current = true
    if (changed.current) onChanged()
    if (run.total === 1 && run.sent === 1 && run.failed === 0 && compose.kind !== 'referral') {
      const name = compose.kind === 'lead' ? (compose.lead.name || 'the lead') : String(people[0]?.name || 'them')
      if (compose.kind === 'lead' && compose.method === 'ai_call') notify(`Alpha is calling ${name}.`, 'success')
      else if (compose.kind === 'lead' && compose.method === 'email') notify(`Email sent to ${name}.`, 'success')
      else if (compose.kind === 'review') notify(`Review link sent to ${name}.`, 'success')
      else notify(`Text sent to ${name}.`, 'success')
      onClose()
    }
  }, [run, compose, people, onChanged, onClose, notify])

  // ── What to show ───────────────────────────────────────────────────────
  const who: Who[] = lead ? leadWho : split.eligible.map(c => ({ id: String(c.id), name: String(c.name || 'Customer'), to: phonePretty(c.phone) }))
  const skipped: Skipped[] = lead ? [] : [
    ...split.optedOut.map(c => ({ name: String(c.name || 'Customer'), reason: 'Replied STOP', kind: 'optedOut' as const })),
    ...split.noPhone.map(c => ({ name: String(c.name || 'Customer'), reason: 'No phone number', kind: 'noPhone' as const })),
    ...split.duplicate.map(c => ({ name: String(c.name || 'Customer'), reason: 'Same number as another', kind: 'duplicate' as const })),
  ]

  const flags: Flag[] = []
  let blocker = ''
  if (shop.state === 'loading') blocker = 'Loading your shop details…'
  else if (shop.state === 'error') blocker = 'Your shop details did not load, so the message cannot be written. Close this and try again.'
  else if (shop.state === 'ready' && !shop.name) {
    blocker = 'Add your shop name in Settings first.'
    flags.push({ kind: 'warn', text: <>Your shop name is missing, so people would not know who this is from. <Link href="/settings" className="font-bold text-blue underline underline-offset-2">Open settings</Link></> })
  }
  if (compose.kind === 'review' && shop.state === 'ready' && !shop.reviewUrl) {
    blocker = blocker || 'Add your Google review link in Settings first.'
    flags.push({ kind: 'warn', text: <>You have not added your Google review link yet. <Link href="/settings" className="font-bold text-blue underline underline-offset-2">Open settings</Link></> })
  }
  if (compose.kind === 'review' && compose.customer.review_requested) {
    flags.push({ kind: 'info', text: `You asked ${compose.customer.name || 'this customer'} for a review ${timeAgo(compose.customer.review_requested)}. Asking again too soon can annoy people.` })
  }
  if (compose.kind === 'referral' && !pctOk) blocker = blocker || 'Enter a discount from 1 to 100.'
  if (compose.kind === 'referral' && !creditOk) blocker = blocker || 'Enter a credit of 0 or more.'
  if (compose.kind === 'followup' && compose.customers.length > 0 && who.length === 0 && skipped.length > 0) {
    blocker = 'None of these customers can be texted.'
  }
  if (compose.kind === 'followup' && who.length > 1 && !blocker) {
    flags.push({ kind: 'info', text: 'Texts go out one at a time, so a long list takes a while. You can stop at any point and nobody after that is texted.' })
  }
  // A text to a whole list at night is the kind customers complain about. One-to-one texts are the owner's call, so they only get a note.
  if (compose.kind === 'followup' || compose.kind === 'review' || compose.kind === 'referral') {
    const hour = new Date().getHours()
    if (isAfterHours(hour)) {
      if (compose.kind === 'followup' && who.length > 1) {
        blocker = blocker || 'It is after hours. Texts to a list wait until 8 AM. Come back in the morning, or schedule it from Promotions.'
        flags.push({ kind: 'warn', text: <>It is after hours for your customers (9 PM to 8 AM). Texting a whole list now is held back. Use the Promotions tab to schedule it for the morning, and each customer is checked again right before their text.</> })
      } else {
        flags.push({ kind: 'info', text: 'It is after hours (9 PM to 8 AM). A text sent now reaches the customer at night. Waiting until morning is kinder.' })
      }
    }
  }
  if (compose.kind === 'lead') {
    if (leadWho.length === 0) blocker = compose.method === 'email' ? 'This lead has no email address.' : 'This lead has no phone number.'
    if (isAiLead(compose.lead) && compose.method !== 'email') blocker = blocker || LEAD_NO_TEXT
    if (isAiLead(compose.lead) && compose.method === 'email') flags.push({ kind: 'warn', text: LEAD_DEFAULT_FLAG })
    if (compose.method === 'ai_call') flags.push({ kind: 'warn', text: 'Alpha speaks with an AI voice. Calling people who have not asked to hear from you can break the law. Call only someone who would expect to hear from your shop.' })
    if (compose.method === 'email') flags.push({ kind: 'info', text: 'Your shop name, phone and address and an unsubscribe link are added at the bottom. Anyone who unsubscribes is never emailed again.' })
    const claims = aiWritten ? unsupportedClaims(message, shop.phone, shop.name, String(compose.lead.service_needed || '')) : []
    if (claims.length) flags.push({ kind: 'warn', text: `Alpha wrote ${claims.join(', ')} that you did not give it. Take it out unless it is true for your shop.` })
    if (wantsDraft && draftNote) flags.push({ kind: 'warn', text: draftNote })
    if (wantsDraft && !draftNote && !drafting && !edited && compose.method !== 'ai_call') flags.push({ kind: 'info', text: 'Alpha wrote this. Read it, change it if you like, then send.' })
  }
  if (compose.kind === 'referral' && !hasPhone(compose.customer.phone)) flags.push({ kind: 'info', text: `${compose.customer.name || 'This customer'} has no phone number, so nothing is texted. The code is saved and you can tell them yourself.` })
  if (compose.kind === 'referral' && split.optedOut.length > 0) flags.push({ kind: 'info', text: `${compose.customer.name || 'This customer'} has opted out of texts, so nothing is texted. The code is saved and you can tell them yourself.` })

  const top = compose.kind === 'referral' ? (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <label htmlFor="ref-pct" className="form-label">Friend’s discount (percent)</label>
        <input id="ref-pct" className="form-input" type="number" inputMode="numeric" min={1} max={100} value={pctText} onChange={e => setPctText(e.target.value)} aria-invalid={!pctOk} disabled={made !== null} />
        {!pctOk && <p className="form-error">Enter a number from 1 to 100.</p>}
      </div>
      <div>
        <label htmlFor="ref-credit" className="form-label">Credit for {compose.customer.name ? compose.customer.name.split(' ')[0] : 'them'} (dollars)</label>
        <input id="ref-credit" className="form-input" type="number" inputMode="numeric" min={0} value={creditText} onChange={e => setCreditText(e.target.value)} aria-invalid={!creditOk} disabled={made !== null} />
        {!creditOk && <p className="form-error">Enter 0 or more.</p>}
      </div>
      <p className="col-span-2 -mt-1 text-[0.8125rem] text-text-secondary">The discount is saved with the code. The credit is only a promise in the text, so remember to give it.</p>
    </div>
  ) : undefined

  const titles: Record<Compose['kind'], string> = {
    followup: people.length > 1 ? (who.length === 1 ? `Text ${who[0].name}` : `Text ${who.length} customers`) : `Text ${people[0]?.name || 'this customer'}`,
    review: `Ask ${people[0]?.name || 'this customer'} for a review`,
    referral: `Give ${people[0]?.name || 'this customer'} a referral code`,
    lead: compose.kind === 'lead'
      ? (compose.method === 'sms' ? `Text ${compose.lead.name || 'this lead'}` : compose.method === 'email' ? `Email ${compose.lead.name || 'this lead'}` : `Have Alpha call ${compose.lead.name || 'this lead'}`)
      : '',
  }

  const activeCount = who.filter(w => !off.has(w.id)).length
  const channel: 'text' | 'email' | 'call' = compose.kind === 'lead' ? (compose.method === 'email' ? 'email' : compose.method === 'ai_call' ? 'call' : 'text') : 'text'
  const sendLabel = compose.kind === 'referral'
    ? (split.eligible.length > 0 ? 'Save code and send text' : 'Save code')
    : compose.kind === 'lead'
      ? (compose.method === 'ai_call' ? 'Start the call' : compose.method === 'email' ? 'Send email' : 'Send text')
      : compose.kind === 'review' ? 'Send review link'
      : activeCount > 1 ? `Send ${activeCount} texts` : 'Send text'

  // A referral that was saved but could not be texted still needs a way out.
  const refDone: RunState | null = made && !made.texted ? { ...IDLE_RUN, phase: 'done' } : null
  const after = made ? (
    <div className="mt-3 rounded-lg border border-border bg-bg-base p-3">
      <p className="text-[0.9375rem]"><span className="font-bold">Code {made.code}</span> is saved for {compose.kind === 'referral' ? compose.customer.name : 'them'}.</p>
      <button type="button" className="btn btn-secondary mt-2" onClick={() => { void navigator.clipboard?.writeText(fillName(message, compose.kind === 'referral' ? compose.customer.name : '')).then(() => notify('Message copied.', 'success')).catch(() => notify('Could not copy. Press and hold the text to copy it.', 'error')) }}>
        <Icon name="copy" className="h-5 w-5" />Copy the message
      </button>
    </div>
  ) : undefined

  return (
    <MessageSheet
      title={titles[compose.kind]}
      channel={channel}
      onClose={closeSheet}
      who={who}
      off={off}
      onToggle={compose.kind === 'followup' && who.length > 1 ? toggle : undefined}
      skipped={skipped}
      top={top}
      subject={compose.kind === 'lead' && compose.method === 'email' ? leadEmailSubject(shop.name || '', String(compose.lead.service_needed || '')) : undefined}
      message={message}
      onMessage={channel === 'call' ? undefined : (m => { setMessage(m); setEdited(true) })}
      exampleName={compose.kind === 'lead' ? greetingFor(compose.lead) : undefined}
      flags={flags}
      blocker={blocker || (creating ? 'Saving…' : '')}
      sendLabel={creating ? 'Saving…' : sendLabel}
      run={refDone || run}
      onSend={onSend}
      onStop={stop}
      error={error}
      drafting={drafting}
      onRedraft={wantsDraft ? () => { void draft() } : undefined}
      after={after}
      callNote={compose.kind === 'lead' && compose.method === 'ai_call' ? (
        <p>Alpha will phone this lead right away and talk with them about {compose.lead.service_needed || 'their vehicle'} for {shop.name || 'your shop'}. There are no words to read first, because Alpha speaks live.</p>
      ) : undefined}
    />
  )
}
