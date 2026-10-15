'use client'
import { useState } from 'react'
import Icon from '@/components/Icon'
import { phonePretty } from '@/lib/today'
import type { Customer } from './types'

/** Send a text or an email to one customer. Posts to the same /api/send-message as before. */
export default function SendPanel({ customer, channel, onBack, onSent }: {
  customer: Customer
  channel: 'sms' | 'email'
  onBack: () => void
  onSent: (message: string) => void
}) {
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const to = channel === 'sms' ? customer.phone : customer.email

  const send = async () => {
    if (!body.trim() || sending) return
    if (!to) { setError(channel === 'sms' ? 'This customer has no phone number. Add one, then try again.' : 'This customer has no email address. Add one, then try again.'); return }
    setSending(true)
    setError('')
    try {
      const res = await fetch('/api/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to, body, channel, customerId: customer.id }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || data.error) throw new Error(data.error || 'The message did not send. Check your connection and try again.')
      onSent(channel === 'sms' ? `Text sent to ${customer.name || 'customer'}.` : `Email sent to ${customer.name || 'customer'}.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The message did not send. Try again.')
    } finally { setSending(false) }
  }

  return (
    <form className="space-y-4" onSubmit={e => { e.preventDefault(); send() }}>
      <button type="button" className="btn btn-ghost -ml-2" onClick={onBack}>
        <Icon name="chevronLeft" className="h-4 w-4" />Back to {customer.name || 'customer'}
      </button>
      <p className="text-text-secondary">
        To: <strong className="text-text-primary">{customer.name}</strong> · {channel === 'sms' ? phonePretty(to) : to}
      </p>
      <div>
        <label className="form-label !text-[0.875rem]" htmlFor="sp-body">{channel === 'sms' ? 'Text message' : 'Email message'}</label>
        <textarea id="sp-body" className="form-textarea" rows={5} autoFocus value={body} onChange={e => setBody(e.target.value)} placeholder="Write your message" />
        {channel === 'sms' && <p className="form-hint !text-[0.875rem] !text-text-secondary num">{body.length} {body.length === 1 ? 'character' : 'characters'}{body.length > 160 ? `. Goes out as ${Math.ceil(body.length / 153)} texts.` : ''}</p>}
      </div>
      {error && <p role="alert" className="form-error !text-[0.875rem]">{error}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn btn-secondary" onClick={onBack} disabled={sending}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={sending || !body.trim()}>
          <Icon name="send" className="h-5 w-5" />{sending ? 'Sending…' : channel === 'sms' ? 'Send text' : 'Send email'}
        </button>
      </div>
    </form>
  )
}
