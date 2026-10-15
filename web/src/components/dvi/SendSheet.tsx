'use client'
import { useState } from 'react'
import Notice from '@/components/Notice'
import { smsText } from '@/lib/dvi'
import type { Finding } from '@/lib/dvi'
import type { DviRow } from './types'

/** Check the text, check the number, send. The customer gets a link to their own page when the link feature is on. */
export default function SendSheet({ row, list, goodCount, shop, phone, customerKnown, linkAvailable, sentWhen, busy, error, onSend }: {
  row: DviRow
  list: Finding[]
  goodCount: number
  shop: { name: string; phone: string }
  phone: string
  customerKnown: boolean
  linkAvailable: boolean
  /** Already worded, e.g. "today at 2:14 PM", or empty if never sent. */
  sentWhen: string
  busy: boolean
  error: string
  onSend: (phone: string) => void
}) {
  const [to, setTo] = useState(phone)
  const [problem, setProblem] = useState('')
  const hasLink = linkAvailable && list.length > 0
  const body = smsText({ customer: row.customer_name, vehicle: row.vehicle, shop: shop.name, phone: shop.phone, url: hasLink ? '[link to their inspection page]' : null, list, goodCount })
  const noPrice = list.filter(f => f.price === null).length

  const go = () => {
    setProblem('')
    if (to.replace(/\D/g, '').length < 10) { setProblem('Enter a full phone number, with the area code.'); return }
    onSend(to.trim())
  }

  return (
    <div>
      {sentWhen && <Notice kind="info" className="mb-3">Already texted {sentWhen}. Sending again texts them again.</Notice>}

      <label className="form-label" htmlFor="dvi-send-to">Send to this number</label>
      <input id="dvi-send-to" className="form-input" type="tel" inputMode="tel" autoComplete="off" value={to} onChange={e => setTo(e.target.value)} placeholder="(713) 555-0100" />
      <p className="mt-1 text-[0.8125rem] text-text-secondary">
        {customerKnown ? (phone ? `From ${row.customer_name}’s customer record.` : `${row.customer_name} has no phone number on file. Enter one here. It will not be saved to the customer.`) : 'This customer is not linked to a customer record, so check the number.'}
      </p>

      <h3 className="section-title mt-4">The text they will get</h3>
      <p className="mt-1.5 whitespace-pre-wrap break-words rounded-md border border-border bg-bg-base px-3 py-3 text-[0.9375rem] leading-relaxed">{body}</p>

      {list.length === 0 && <p className="mt-3 text-[0.9375rem] text-text-secondary">Nothing was marked Watch or Needs work, so the text tells them everything looks good and has no link.</p>}
      {list.length > 0 && !linkAvailable && <Notice kind="warn" className="mt-3">The customer page is not turned on yet, so the text lists what was found instead of linking to photos and prices.</Notice>}
      {hasLink && noPrice > 0 && <p className="mt-3 text-[0.9375rem] text-text-secondary">{noPrice} {noPrice === 1 ? 'item has' : 'items have'} no price. The customer can still approve {noPrice === 1 ? 'it' : 'them'}, and you quote after.</p>}

      {(problem || error) && <p role="alert" className="form-error">{problem || error}</p>}
      <button type="button" className="btn btn-primary mt-5 w-full" disabled={busy} onClick={go}>{busy ? 'Sending…' : sentWhen ? 'Send again' : 'Send text'}</button>
    </div>
  )
}
