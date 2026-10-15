'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { formatCurrency } from '@/lib/supabase'
import { phonePretty } from '@/lib/today'
import { linkLine } from '@/lib/doc-history'
import type { LinkSummary } from '@/lib/doc-history'
import Icon from '@/components/Icon'
import { previewSend, sendNow } from './api'
import type { SendPreview } from './api'
import { ErrorMsg, OkMsg, WarnMsg } from './Dialogs'

type Channel = 'sms' | 'email' | 'copy'

export interface SentResult { channel: Channel; status: string; sentAt: string; link: string; expiresAt: string }

const actions = 'mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end'

/**
 * Sending an estimate or invoice. The shop picks how (text, email, or a link to paste anywhere), sees exactly what
 * the customer will receive and where it goes, and only then sends. Nothing leaves before that second step.
 */
export default function SendSheet({ documentId, noun, docNumber, customerName, total, email, phone, link, hasOptions, onSent, onClose }: {
  documentId: string
  noun: string
  docNumber: string
  customerName: string
  total: number
  email: string
  phone: string
  link?: LinkSummary
  /** The estimate has good, better, best choices; the customer will see them. */
  hasOptions?: boolean
  onSent: (r: SentResult) => void
  onClose: () => void
}) {
  const first: Channel = phone ? 'sms' : email ? 'email' : 'copy'
  const [channel, setChannel] = useState<Channel>(first)
  const [preview, setPreview] = useState<SendPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<SentResult | null>(null)
  const [copied, setCopied] = useState(false)
  const [showText, setShowText] = useState(false)
  const seq = useRef(0)
  const linkRef = useRef<HTMLInputElement>(null)
  const sentBefore = linkLine(link, Date.now())

  const loadPreview = useCallback(async (ch: Channel) => {
    const mine = ++seq.current
    setLoading(true); setLoadError(''); setPreview(null); setError('')
    const r = await previewSend(documentId, ch, { ...(email ? { email } : {}), ...(phone ? { phone } : {}) })
    if (mine !== seq.current) return
    if (r.ok && r.data.preview) setPreview(r.data.preview)
    else setLoadError(r.error || 'The preview did not load. Try again.')
    setLoading(false)
  }, [documentId, email, phone])

  useEffect(() => { void loadPreview(channel) }, [channel, loadPreview])

  const send = async () => {
    if (busy || !preview || preview.blocked) return
    setBusy(true); setError('')
    const r = await sendNow(documentId, channel, { ...(email ? { email } : {}), ...(phone ? { phone } : {}) })
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    const result: SentResult = { channel, status: r.data.status, sentAt: r.data.sentAt, link: r.data.link, expiresAt: r.data.expiresAt }
    setDone(result)
    onSent(result)
  }

  const copy = async () => {
    const url = done?.link || ''
    try { await navigator.clipboard.writeText(url); setCopied(true) } catch {
      linkRef.current?.select()
      try { setCopied(document.execCommand('copy')) } catch { setCopied(false) }
    }
  }

  const goodThrough = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

  if (done) {
    return (
      <div>
        <OkMsg>
          {done.channel === 'sms' ? `Text sent to ${phonePretty(phone)}.` : done.channel === 'email' ? `Email sent to ${email}.` : 'The link is ready.'}
          {' '}The customer can open it until {goodThrough(done.expiresAt)}.
        </OkMsg>
        {done.channel === 'copy' && (
          <div className="mt-4">
            <label htmlFor="send-link" className="form-label">Customer link</label>
            <div className="flex gap-2">
              <input id="send-link" ref={linkRef} className="form-input" readOnly value={done.link} onFocus={e => e.currentTarget.select()} />
              <button type="button" className="btn btn-secondary shrink-0" onClick={copy}>
                <Icon name="copy" className="h-5 w-5" />
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="form-hint">Paste it into a text, an email or a chat. Nobody is notified until you send it yourself.</p>
          </div>
        )}
        <p className="mt-3 text-[0.9375rem] text-text-secondary">You will see when {customerName || 'the customer'} opens it and what they answer, right on the {noun}.</p>
        <div className={actions}>
          <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    )
  }

  const channels: { id: Channel; label: string; to: string; icon: string }[] = [
    { id: 'sms', label: 'Text message', to: phone ? phonePretty(phone) : 'No phone on file', icon: 'phone' },
    { id: 'email', label: 'Email', to: email || 'No email on file', icon: 'mail' },
    { id: 'copy', label: 'Copy link', to: 'Paste it anywhere', icon: 'link' },
  ]
  const sendLabel = busy
    ? 'Sending…'
    : channel === 'sms' ? 'Send text now' : channel === 'email' ? 'Send email now' : 'Make the link'

  return (
    <div>
      <div className="rounded-md border border-border bg-bg-card px-3 py-2.5">
        <p className="font-bold">{noun[0].toUpperCase() + noun.slice(1)} {docNumber}</p>
        <p className="text-[0.9375rem] text-text-secondary num">{customerName || 'No customer chosen'} · {formatCurrency(total)}</p>
        {sentBefore && <p className="mt-1 text-[0.875rem] text-text-secondary">{sentBefore}</p>}
      </div>

      <fieldset className="mt-4">
        <legend className="form-label">How should it go?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {channels.map(c => {
            const on = channel === c.id
            return (
              <button
                key={c.id}
                type="button"
                aria-pressed={on}
                onClick={() => setChannel(c.id)}
                disabled={busy}
                className={`flex min-h-[60px] items-center gap-3 rounded-md border px-3 text-left ${on ? 'border-blue bg-blue/10' : 'border-line bg-bg-card hover:bg-bg-hover'}`}
              >
                <Icon name={c.icon} className={`h-5 w-5 shrink-0 ${on ? 'text-blue' : 'text-text-secondary'}`} />
                <span className="min-w-0">
                  <span className={`block font-bold ${on ? 'text-blue' : ''}`}>{c.label}</span>
                  <span className="block truncate text-[0.875rem] text-text-secondary">{c.to}</span>
                </span>
              </button>
            )
          })}
        </div>
      </fieldset>

      <section className="mt-4" aria-labelledby="send-preview-title" aria-live="polite">
        <h3 id="send-preview-title" className="text-[0.9375rem] font-bold">What the customer gets</h3>
        {loading ? (
          <div className="mt-2 space-y-2" aria-busy="true" aria-label="Loading the preview">
            <div className="skeleton h-5 w-2/3" />
            <div className="skeleton h-40" />
          </div>
        ) : loadError ? (
          <div className="mt-2">
            <ErrorMsg>{loadError}</ErrorMsg>
            <button type="button" className="btn btn-secondary mt-3" onClick={() => void loadPreview(channel)}>Try again</button>
          </div>
        ) : preview ? (
          <div className="mt-2">
            {preview.blocked && <WarnMsg>{preview.blocked} {channel === 'copy' ? '' : 'Fix that on the document, or choose another way to send.'}</WarnMsg>}
            {channel === 'copy' ? (
              <p className="mt-2 text-[0.9375rem] text-text-secondary">This makes a private link to the {noun}. The customer sees every line, can approve or decline each job, and signs on their phone. Nothing is sent from here.</p>
            ) : (
              <div className={`${preview.blocked ? 'mt-3 opacity-70' : 'mt-2'} rounded-md border border-border`}>
                <dl className="space-y-1 border-b border-border bg-bg-card px-3 py-2 text-[0.9375rem]">
                  <div className="flex gap-2"><dt className="w-14 shrink-0 font-bold text-text-secondary">To</dt><dd className="min-w-0 break-words">{preview.to || 'Nobody yet'}</dd></div>
                  {preview.subject && <div className="flex gap-2"><dt className="w-14 shrink-0 font-bold text-text-secondary">Subject</dt><dd className="min-w-0 break-words">{preview.subject}</dd></div>}
                </dl>
                {channel === 'email' && preview.html && !showText ? (
                  <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="block h-[22rem] w-full rounded-b-md" style={{ background: '#fff' /* an email is always shown on white, like a mail app */ }} />
                ) : (
                  <pre className="max-h-[22rem] overflow-y-auto whitespace-pre-wrap break-words px-3 py-3 font-sans text-[0.9375rem]">{preview.text}</pre>
                )}
              </div>
            )}
            {channel === 'email' && preview.html && (
              <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => setShowText(s => !s)}>{showText ? 'Show how it looks' : 'Show the plain text version'}</button>
            )}
            {channel !== 'copy' && <p className="mt-2 text-[0.8125rem] text-text-secondary">The link in the message is a private one, made when you send. This preview shows a placeholder.</p>}
          </div>
        ) : null}
      </section>

      {hasOptions && <p className="mt-3 text-[0.875rem] text-text-secondary">This estimate has choices (like good, better, best). The customer picks one for each before they approve.</p>}
      {error && <div className="mt-3"><ErrorMsg>{error}</ErrorMsg></div>}

      <div className={actions}>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={send} disabled={busy || loading || !preview || !!preview.blocked}>
          <Icon name={channel === 'copy' ? 'link' : 'send'} className="h-5 w-5" />
          {sendLabel}
        </button>
      </div>
    </div>
  )
}
