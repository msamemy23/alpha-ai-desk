'use client'
import { useState } from 'react'
import Notice from '@/components/Notice'
import { emailParts, smsText, urgencyCounts, URGENCY_WORD, URGENCIES } from '@/lib/dvi'
import type { Finding } from '@/lib/dvi'
import type { DviRow } from './types'

export type SendChannel = 'sms' | 'email'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Check the message, check the address, send. By text or by email; the customer gets a link to their own page when the link feature is on. */
export default function SendSheet({ row, list, goodCount, shop, phone, email, customerKnown, linkAvailable, sentWhen, busy, error, onSend }: {
  row: DviRow
  list: Finding[]
  goodCount: number
  shop: { name: string; phone: string }
  phone: string
  email: string
  customerKnown: boolean
  linkAvailable: boolean
  /** Already worded, e.g. "today at 2:14 PM", or empty if never sent. */
  sentWhen: string
  busy: boolean
  error: string
  onSend: (channel: SendChannel, to: string) => void
}) {
  const [channel, setChannel] = useState<SendChannel>('sms')
  const [toPhone, setToPhone] = useState(phone)
  const [toEmail, setToEmail] = useState(email)
  const [problem, setProblem] = useState('')
  const hasLink = linkAvailable && list.length > 0
  const o = { customer: row.customer_name, vehicle: row.vehicle, shop: shop.name, phone: shop.phone, url: hasLink ? '[link to their inspection page]' : null, list, goodCount }
  const sms = smsText(o)
  const mail = emailParts(o)
  const noPrice = list.filter(f => f.price === null).length
  const urgent = urgencyCounts(list)

  const go = () => {
    setProblem('')
    if (channel === 'sms') {
      if (toPhone.replace(/\D/g, '').length < 10) { setProblem('Enter a full phone number, with the area code.'); return }
      onSend('sms', toPhone.trim())
    } else {
      if (!EMAIL.test(toEmail.trim())) { setProblem('Enter a full email address, like name@example.com.'); return }
      onSend('email', toEmail.trim())
    }
  }

  return (
    <div>
      {sentWhen && <Notice kind="info" className="mb-3">Already sent {sentWhen}. Sending again messages them again.</Notice>}

      <div role="group" aria-label="How to send it" className="mb-3 grid grid-cols-2 gap-2">
        {([['sms', 'Text message'], ['email', 'Email']] as const).map(([k, label]) => (
          <button key={k} type="button" aria-pressed={channel === k} onClick={() => { setChannel(k); setProblem('') }}
            className={`min-h-[44px] rounded-md border px-3 text-[0.9375rem] font-bold ${channel === k ? 'border-blue bg-blue/10 text-blue' : 'border-[rgb(var(--c-line))] bg-bg-card hover:bg-bg-hover'}`}>{label}</button>
        ))}
      </div>

      {channel === 'sms' ? (
        <>
          <label className="form-label" htmlFor="dvi-send-to">Send to this number</label>
          <input id="dvi-send-to" className="form-input" type="tel" inputMode="tel" autoComplete="off" value={toPhone} onChange={e => setToPhone(e.target.value)} placeholder="(713) 555-0100" />
          <p className="mt-1 text-[0.8125rem] text-text-secondary">
            {customerKnown ? (phone ? `From ${row.customer_name}’s customer record.` : `${row.customer_name} has no phone number on file. Enter one here. It will not be saved to the customer.`) : 'This customer is not linked to a customer record, so check the number.'}
          </p>
          <h3 className="section-title mt-4">The text they will get</h3>
          <p className="mt-1.5 whitespace-pre-wrap break-words rounded-md border border-border bg-bg-base px-3 py-3 text-[0.9375rem] leading-relaxed">{sms}</p>
        </>
      ) : (
        <>
          <label className="form-label" htmlFor="dvi-send-email">Send to this email</label>
          <input id="dvi-send-email" className="form-input" type="email" inputMode="email" autoComplete="off" value={toEmail} onChange={e => setToEmail(e.target.value)} placeholder="name@example.com" />
          <p className="mt-1 text-[0.8125rem] text-text-secondary">
            {customerKnown ? (email ? `From ${row.customer_name}’s customer record.` : `${row.customer_name} has no email on file. Enter one here. It will not be saved to the customer.`) : 'This customer is not linked to a customer record, so check the address.'}
          </p>
          <h3 className="section-title mt-4">The email they will get</h3>
          <div className="mt-1.5 rounded-md border border-border bg-bg-base px-3 py-3 text-[0.9375rem] leading-relaxed">
            <p className="break-words font-bold">{mail.subject}</p>
            <p className="mt-2 whitespace-pre-wrap break-words">{mail.body}</p>
          </div>
        </>
      )}

      {list.length === 0 && <p className="mt-3 text-[0.9375rem] text-text-secondary">Nothing was marked Watch or Needs work, so the message tells them everything looks good and has no link.</p>}
      {list.length > 0 && !linkAvailable && <Notice kind="warn" className="mt-3">The customer page is not turned on yet, so the message lists what was found instead of linking to photos and prices.</Notice>}
      {list.length > 0 && (
        <p className="mt-3 text-[0.875rem] text-text-secondary">
          {URGENCIES.filter(u => urgent[u] > 0).map(u => `${urgent[u]} ${URGENCY_WORD[u].toLowerCase()}`).join(', ')}.
        </p>
      )}
      {hasLink && noPrice > 0 && <p className="mt-2 text-[0.9375rem] text-text-secondary">{noPrice} {noPrice === 1 ? 'item has' : 'items have'} no price. The customer can still approve {noPrice === 1 ? 'it' : 'them'}, and you quote after.</p>}

      {(problem || error) && <p role="alert" className="form-error">{problem || error}</p>}
      <button type="button" className="btn btn-primary mt-5 w-full" disabled={busy} onClick={go}>{busy ? 'Sending…' : sentWhen ? 'Send again' : channel === 'sms' ? 'Send text' : 'Send email'}</button>
    </div>
  )
}
