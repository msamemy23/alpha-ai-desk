'use client'
import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Icon from '@/components/Icon'
import { phonePretty } from '@/lib/today'
import { clock, dayHeading, deliveryOf, dialNumber } from './utils'
import type { Thread } from './utils'

const CLUSTER_MS = 10 * 60 * 1000

/** One conversation: header, bubbles, and a composer that stays at the bottom. */
export default function ThreadView({ thread, showBack, onBack, onSend, keyboardInset = 0, vehicle }: {
  thread: Thread
  showBack: boolean
  onBack: () => void
  /** Returns an error message, or null when the text went out. */
  onSend: (body: string) => Promise<string | null>
  keyboardInset?: number
  vehicle?: string
}) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const scroller = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const msgs = thread.messages

  // Stay at the newest message when the thread opens, a message arrives, or the keyboard moves things.
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [thread.key, msgs.length, keyboardInset])

  const grow = () => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 136) + 'px'
  }

  const send = async (text: string, fromDraft: boolean) => {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    setError('')
    const problem = await onSend(body)
    setSending(false)
    if (problem) { setError(problem); return }
    if (fromDraft) {
      setDraft('')
      requestAnimationFrame(() => { if (box.current) box.current.style.height = 'auto' })
    }
  }

  const now = new Date()
  const shown = msgs.map((m, i) => {
    const prev = msgs[i - 1]
    const next = msgs[i + 1]
    const t = new Date(m.created_at).getTime()
    const newDay = !prev || new Date(prev.created_at).toDateString() !== new Date(m.created_at).toDateString()
    const lastOfRun = !next
      || next.direction !== m.direction
      || new Date(next.created_at).getTime() - t > CLUSTER_MS
      || new Date(next.created_at).toDateString() !== new Date(m.created_at).toDateString()
    return { m, newDay, lastOfRun }
  })

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-base">
      <header className="flex items-center gap-1 border-b border-border bg-bg-card px-2 py-2 sm:px-3">
        {showBack && (
          <button type="button" className="btn-icon shrink-0" onClick={onBack} aria-label="Back to all conversations">
            <Icon name="chevronLeft" className="h-6 w-6" />
          </button>
        )}
        <div className={`min-w-0 flex-1 ${showBack ? '' : 'pl-2'}`}>
          <h2 className="display truncate text-[1.125rem] font-bold leading-tight">{thread.name || phonePretty(thread.contact)}</h2>
          <p className="truncate text-[0.875rem] text-text-secondary">
            {thread.name && thread.name !== phonePretty(thread.contact) ? phonePretty(thread.contact) : 'Text conversation'}
            {vehicle ? ` · ${vehicle}` : ''}
          </p>
        </div>
        <button type="button" className="btn btn-secondary btn-sm shrink-0" onClick={() => dialNumber(thread.contact, thread.name)}>
          <Icon name="phone" className="h-4 w-4" />Call
        </button>
        {thread.customerId && (
          <Link href={`/customers?customer=${encodeURIComponent(thread.customerId)}`} className="btn-icon shrink-0" aria-label={`Open ${thread.name} in Customers`} title="Open customer">
            <Icon name="user" className="h-5 w-5" />
          </Link>
        )}
      </header>

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5" role="log" aria-live="polite" aria-label={`Texts with ${thread.name || 'this number'}`}>
        {msgs.length === 0 && (
          <div className="mx-auto mt-10 max-w-xs text-center">
            <p className="font-bold">No texts with {thread.name || phonePretty(thread.contact)} yet</p>
            <p className="mt-1 text-[0.9375rem] text-text-secondary">Write below to send the first one.</p>
          </div>
        )}
        <ol className="mx-auto flex max-w-3xl flex-col">
          {shown.map(({ m, newDay, lastOfRun }) => {
            const out = m.direction !== 'inbound'
            const delivery = deliveryOf(m)
            const failed = delivery?.tone === 'fail'
            return (
              <li key={m.id} className="flex flex-col">
                {newDay && (
                  <p className="mb-3 mt-5 text-center text-[0.8125rem] font-bold text-text-secondary first:mt-0">{dayHeading(m.created_at, now)}</p>
                )}
                <div className={`flex flex-col ${out ? 'items-end' : 'items-start'} ${lastOfRun ? 'mb-3' : 'mb-1'}`}>
                  <div
                    className={`max-w-[86%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[1rem] leading-snug ${
                      out
                        ? `rounded-br-md bg-blue text-[rgb(var(--c-on-blue))] ${failed ? 'ring-2 ring-red ring-offset-2 ring-offset-bg-base' : ''}`
                        : 'rounded-bl-md border border-border bg-bg-chrome text-text-primary'
                    }`}
                  >
                    {m.body}
                  </div>
                  {(lastOfRun || failed) && (
                    <p className="mt-1 flex items-center gap-1.5 text-[0.8125rem] text-text-secondary">
                      {delivery && <span className={`lamp ${delivery.tone === 'fail' ? 'lamp-red' : delivery.tone === 'wait' ? 'lamp-amber' : 'lamp-green'}`} aria-hidden="true" style={{ width: '0.5rem', height: '0.5rem', boxShadow: 'none' }} />}
                      <span>{clock(m.created_at)}</span>
                      {delivery && <span className={failed ? 'font-bold text-red' : ''}>· {delivery.label}</span>}
                      {failed && (
                        <button type="button" className="ml-1 font-bold text-blue underline underline-offset-2" onClick={() => send(m.body, false)} disabled={sending}>Send again</button>
                      )}
                    </p>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      </div>

      <form
        className="border-t border-border bg-bg-card px-2 py-2 sm:px-3"
        onSubmit={e => { e.preventDefault(); send(draft, true) }}
      >
        {error && <p role="alert" className="mx-1 mb-2 text-[0.9375rem] font-bold text-red">{error}</p>}
        <div className="mx-auto flex max-w-3xl items-end gap-2">
          <label className="min-w-0 flex-1">
            <span className="sr-only">Write a text to {thread.name || 'this number'}</span>
            <textarea
              ref={box} rows={1} value={draft}
              onChange={e => { setDraft(e.target.value); grow() }}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey && !window.matchMedia('(pointer: coarse)').matches) { e.preventDefault(); send(draft, true) }
              }}
              placeholder="Write a text"
              enterKeyHint="send"
              className="form-input block max-h-[8.5rem] resize-none py-2.5 leading-snug"
            />
          </label>
          <button type="submit" className="btn btn-primary h-11 w-11 shrink-0 px-0 sm:h-10 sm:w-10" disabled={sending || !draft.trim()} aria-label={sending ? 'Sending' : 'Send text'}>
            <Icon name="send" className="h-5 w-5" />
          </button>
        </div>
      </form>
    </div>
  )
}
