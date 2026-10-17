'use client'
import { useEffect, useState } from 'react'
import Icon from '@/components/Icon'
import { api } from '@/components/inbox/api'
import { canOpenMessages, dialNumber, NO_MESSAGES_NOTE, OWN_PHONE_NOTE, platformOf, smsHref } from '@/lib/own-phone'
import type { Platform } from '@/lib/own-phone'

/**
 * "Send it from your own phone". Opens the phone's Messages app with the customer's number and the words already in, so the owner
 * reads it and presses Send there. It is for an owner who does not want to use the shop number (an iPhone cannot be driven from the web,
 * and Google Messages for web only pairs with Android). Alpha sends nothing and cannot tell whether the text was sent.
 */
export default function PhoneTextActions({ phone, body, onOpened, title = 'Send it from your own phone' }: {
  phone: string
  body: string
  /** The owner tapped Open in Messages. This does not mean the text was sent. */
  onOpened?: () => void
  title?: string
}) {
  const [platform, setPlatform] = useState<Platform | null>(null)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)
  // Whether this number asked not to get texts. Unknown (null) never blocks: the owner is still the one pressing Send.
  const [stopped, setStopped] = useState<boolean | null>(null)

  // The browser's own description of the device is only known after the page loads, so nothing is guessed on the server.
  useEffect(() => {
    try { setPlatform(platformOf(navigator.userAgent, navigator.maxTouchPoints || 0)) } catch { setPlatform('other') }
  }, [])
  useEffect(() => { setCopied(false); setCopyFailed(false) }, [body, phone])

  // A customer who texted STOP stays stopped when the owner texts by hand too. Asked of the server, which holds the shop's STOP list.
  const number = dialNumber(phone)
  useEffect(() => {
    setStopped(null)
    if (!number) return
    let live = true
    void api<{ optedOut?: boolean; known?: boolean }>('/api/sms-consent', { body: { phone: number } }).then(r => {
      if (live && r.ok && r.data?.known) setStopped(r.data.optedOut === true)
    })
    return () => { live = false }
  }, [number])

  const text = body.trim()
  const ready = Boolean(number) && text.length > 0 && stopped !== true
  const openable = platform !== null && canOpenMessages(platform)
  const href = platform && ready ? smsHref(phone, body, platform) : ''

  const copy = async () => {
    setCopyFailed(false)
    try { await navigator.clipboard.writeText(text); setCopied(true) } catch { setCopied(false); setCopyFailed(true) }
  }

  return (
    <div role="group" aria-label={title} className="rounded-md border border-border bg-bg-base p-3">
      <p className="font-bold">{title}</p>
      {stopped === true
        ? <p role="alert" className="mt-0.5 text-[0.875rem] font-bold text-red">This number replied STOP and asked not to get texts, so Alpha will not open or copy one.</p>
        : <p className="mt-0.5 text-[0.875rem] text-text-secondary">{platform && !openable ? NO_MESSAGES_NOTE : OWN_PHONE_NOTE}</p>}
      <div className={`mt-2.5 grid gap-2 ${platform === null || openable ? 'sm:grid-cols-2' : ''}`}>
        {(platform === null || openable) && (href
          ? <a className="btn btn-secondary no-underline" href={href} onClick={() => onOpened?.()}><Icon name="send" className="h-5 w-5" />Open in Messages</a>
          : <button type="button" className="btn btn-secondary" disabled><Icon name="send" className="h-5 w-5" />Open in Messages</button>)}
        <button type="button" className="btn btn-secondary" onClick={() => void copy()} disabled={!text || stopped === true}>
          <Icon name="copy" className="h-5 w-5" />{copied ? 'Copied' : 'Copy the text'}
        </button>
      </div>
      {!ready && stopped !== true && <p className="mt-2 text-[0.8125rem] text-text-secondary">{dialNumber(phone) ? 'Write the message first.' : 'Pick a customer or enter a full phone number first.'}</p>}
      {copied && <p role="status" className="mt-2 flex items-center gap-2 text-[0.875rem] text-green"><Icon name="check" className="h-4 w-4 shrink-0" />Text copied. Paste it into Messages.</p>}
      {copyFailed && <p role="alert" className="form-error">Copying did not work here. Press and hold the message to copy it.</p>}
    </div>
  )
}
