'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import Sheet from '@/components/Sheet'
import { phonePretty } from '@/lib/today'
import { digitsOnly } from './utils'
import type { ContactRef } from './utils'

type Channel = 'sms' | 'email'

/** Write a new text or email. Picks a customer by name, or takes any phone number or address. */
export default function NewMessageSheet({ onClose, contacts, initialTo = '', initialChannel = 'sms', onSend, onSent }: {
  onClose: () => void
  contacts: ContactRef[]
  initialTo?: string
  initialChannel?: Channel
  /** Returns an error message, or null when it went out. */
  onSend: (to: string, body: string, channel: Channel) => Promise<string | null>
  onSent: (to: string, channel: Channel) => void
}) {
  const [channel, setChannel] = useState<Channel>(initialChannel)
  const [to, setTo] = useState(initialTo)
  const [body, setBody] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const toBox = useRef<HTMLInputElement>(null)
  const bodyBox = useRef<HTMLTextAreaElement>(null)

  // Sheet focuses its own frame when it opens, so move focus on the next frame.
  useEffect(() => {
    const id = requestAnimationFrame(() => (initialTo ? bodyBox.current : toBox.current)?.focus())
    return () => cancelAnimationFrame(id)
  }, [initialTo])

  const query = to.trim()
  const looksLikeAddress = channel === 'sms' ? digitsOnly(query).length >= 7 && !/[a-z]/i.test(query) : query.includes('@')
  const suggestions = useMemo(() => {
    if (query.length < 2 || looksLikeAddress) return []
    const q = query.toLowerCase()
    const qd = digitsOnly(query)
    return contacts
      .filter(c => (c.name || '').toLowerCase().includes(q) || (qd.length >= 3 && digitsOnly(c.phone).includes(qd)) || (c.email || '').toLowerCase().includes(q))
      .slice(0, 5)
  }, [contacts, query, looksLikeAddress])

  const validTo = channel === 'sms' ? digitsOnly(to).length >= 10 : /\S+@\S+\.\S+/.test(to.trim())

  const submit = async () => {
    if (sending) return
    if (!validTo) { setError(channel === 'sms' ? 'Enter a full 10-digit phone number, or pick a customer.' : 'Enter a full email address, or pick a customer.'); return }
    if (!body.trim()) { setError('Write a message first.'); return }
    setSending(true); setError('')
    const problem = await onSend(to.trim(), body, channel)
    setSending(false)
    if (problem) setError(problem)
    else onSent(to.trim(), channel)
  }

  return (
    <Sheet open onClose={onClose} title="New message">
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); submit() }} noValidate>
        <div role="tablist" aria-label="How to send" className="flex gap-1 rounded-lg border border-border bg-bg-chrome/60 p-1">
          {(['sms', 'email'] as const).map(c => (
            <button
              key={c} type="button" role="tab" aria-selected={channel === c} onClick={() => { setChannel(c); setError('') }}
              className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-md border px-3 text-[0.9375rem] font-bold sm:min-h-[40px] ${channel === c ? 'border-line bg-bg-card text-blue' : 'border-transparent text-text-secondary hover:bg-bg-hover'}`}
            >
              <Icon name={c === 'sms' ? 'inbox' : 'mail'} className="h-5 w-5" />{c === 'sms' ? 'Text' : 'Email'}
            </button>
          ))}
        </div>

        <div>
          <label className="form-label" htmlFor="nm-to">{channel === 'sms' ? 'To (name or phone number)' : 'To (name or email address)'}</label>
          <input
            ref={toBox} id="nm-to" className="form-input" autoComplete="off"
            type={looksLikeAddress || query === '' ? (channel === 'sms' ? 'tel' : 'email') : 'text'}
            inputMode={channel === 'sms' ? 'tel' : 'email'}
            value={to} onChange={e => { setTo(e.target.value); setError('') }}
            placeholder={channel === 'sms' ? 'Marcus Bell or (713) 555-0142' : 'name@example.com'}
          />
          {suggestions.length > 0 && (
            <ul className="mt-2 overflow-hidden rounded-lg border border-border" aria-label="Customers that match">
              {suggestions.map(c => {
                const value = channel === 'sms' ? c.phone : c.email
                return (
                  <li key={c.id} className="border-b border-border last:border-b-0">
                    <button
                      type="button" disabled={!value}
                      className="flex min-h-[48px] w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-bg-hover disabled:cursor-not-allowed disabled:opacity-60"
                      onClick={() => { setTo(value); setError('') }}
                    >
                      <span className="min-w-0 truncate font-bold">{c.name || 'Unnamed customer'}</span>
                      <span className="shrink-0 text-[0.9375rem] text-text-secondary">{value ? (channel === 'sms' ? phonePretty(value) : value) : channel === 'sms' ? 'No phone number' : 'No email'}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div>
          <label className="form-label" htmlFor="nm-body">Message</label>
          <textarea ref={bodyBox} id="nm-body" className="form-textarea" rows={5} value={body} onChange={e => { setBody(e.target.value); setError('') }} placeholder="Write your message" />
        </div>

        {error && <p role="alert" className="form-error">{error}</p>}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={sending}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={sending}>
            <Icon name="send" className="h-5 w-5" />{sending ? 'Sending…' : channel === 'sms' ? 'Send text' : 'Send email'}
          </button>
        </div>
      </form>
    </Sheet>
  )
}
