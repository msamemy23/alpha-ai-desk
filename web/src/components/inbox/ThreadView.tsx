'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Icon from '@/components/Icon'
import { phonePretty } from '@/lib/today'
import { buildTimeline, eventHeadline, eventLamp } from '@/lib/voice/timeline'
import { clock, dayHeading, deliveryOf, dialNumber } from './utils'
import type { Thread } from './utils'
import { AttachButton, MessageMedia, PendingStrip, useAttachments, useThreadMedia } from './Attachments'
import { AssignSheet, AssistantBar, DraftCard, TemplatesSheet } from './ThreadTools'
import { useThreadAi } from './useAiOverlay'
import type { Assignment, Teammate, Template } from './useAiOverlay'
import { useThreadEvents } from './useThreadEvents'
import { api } from './api'

const CLUSTER_MS = 10 * 60 * 1000

export interface ThreadExtras {
  /** The assistant's held reply for this conversation, if the shop approves replies first. */
  draft: { interactionId: string; text: string; at: string } | null
  assignee: Assignment | undefined
  team: Teammate[]
  assignAvailable: boolean
  templates: Template[]
  templatesStatus: 'loading' | 'ready' | 'error' | 'unavailable'
  reloadTemplates: () => Promise<void>
  /** Called after anything that changes the assistant's records, so the lists catch up. */
  onChanged: () => void
  shopName: string
  shopPhone: string
  canEdit: boolean
}

/** One conversation: header, bubbles, and a composer that stays at the bottom. */
export default function ThreadView({ thread, showBack, onBack, onSend, keyboardInset = 0, vehicle, extras }: {
  thread: Thread
  showBack: boolean
  onBack: () => void
  /** Returns an error message, or null when the text went out. */
  onSend: (body: string, mediaIds?: string[]) => Promise<string | null>
  keyboardInset?: number
  vehicle?: string
  extras?: ThreadExtras
}) {
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [assignOpen, setAssignOpen] = useState(false)
  const [heldBusy, setHeldBusy] = useState(false)
  const [editingHeld, setEditingHeld] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const box = useRef<HTMLTextAreaElement>(null)
  const msgs = thread.messages
  const attach = useAttachments(thread.contact)
  const ai = useThreadAi(thread.key)
  const media = useThreadMedia(useMemo(() => msgs.map(m => m.id), [msgs]))
  const lastId = msgs.length ? msgs[msgs.length - 1].id : ''
  const events = useThreadEvents(thread.key, lastId)
  const timeline = useMemo(() => buildTimeline(msgs, events), [msgs, events])
  const held = extras?.draft && !msgs.some(m => m.direction !== 'inbound' && m.created_at > extras.draft!.at) ? extras.draft : null

  // Stay at the newest message when the thread opens, a message arrives, or the keyboard moves things.
  useEffect(() => {
    const el = scroller.current
    if (el) el.scrollTop = el.scrollHeight
  }, [thread.key, timeline.length, keyboardInset, held?.interactionId])

  const grow = () => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 136) + 'px'
  }

  const closeHeld = async (id: string, action: 'sent' | 'dismiss') => {
    await api('/api/receptionist/draft', { body: { interactionId: id, action } })
    extras?.onChanged()
  }

  const send = async (text: string, fromDraft: boolean) => {
    const body = text.trim()
    const ids = fromDraft ? attach.ready : []
    if ((!body && ids.length === 0) || sending || (fromDraft && attach.busy)) return
    setSending(true)
    setError('')
    const problem = await onSend(body, ids)
    setSending(false)
    if (problem) { setError(problem); return }
    if (fromDraft) {
      setDraft('')
      attach.clear()
      requestAnimationFrame(() => { if (box.current) box.current.style.height = 'auto' })
      if (editingHeld) { const id = editingHeld; setEditingHeld(null); void closeHeld(id, 'sent') }
    }
  }

  const sendHeld = async () => {
    if (!held) return
    setHeldBusy(true); setError('')
    const problem = await onSend(held.text, [])
    if (problem) { setError(problem); setHeldBusy(false); return }
    await closeHeld(held.interactionId, 'sent')
    setHeldBusy(false)
  }
  const editHeld = () => {
    if (!held) return
    setDraft(held.text); setEditingHeld(held.interactionId)
    requestAnimationFrame(() => { grow(); box.current?.focus() })
  }
  const dismissHeld = async () => {
    if (!held) return
    setHeldBusy(true)
    await closeHeld(held.interactionId, 'dismiss')
    setHeldBusy(false)
  }

  const assign = async (assigneeId: string): Promise<string> => {
    const r = await api('/api/inbox/assign', { method: 'PUT', body: { key: thread.key, assigneeId } })
    extras?.onChanged()
    return r.ok ? '' : r.error
  }

  const now = new Date()
  const shown = timeline.map((item, i) => {
    const prev = timeline[i - 1]
    const next = timeline[i + 1]
    const t = Date.parse(item.at)
    const newDay = !prev || new Date(prev.at).toDateString() !== new Date(item.at).toDateString()
    const lastOfRun = !next
      || next.type !== 'message'
      || (item.type === 'message' && next.message.direction !== item.message.direction)
      || Date.parse(next.at) - t > CLUSTER_MS
      || new Date(next.at).toDateString() !== new Date(item.at).toDateString()
    return { item, newDay, lastOfRun }
  })
  const person = thread.name || phonePretty(thread.contact)
  const fillVals = { name: thread.name && thread.name !== phonePretty(thread.contact) ? thread.name : '', shop: extras?.shopName || '', phone: extras?.shopPhone ? phonePretty(extras.shopPhone) : '' }
  const canSend = !sending && !attach.busy && (draft.trim().length > 0 || attach.ready.length > 0)

  return (
    <div className="flex h-full min-h-0 flex-col bg-bg-base">
      <header className="flex items-center gap-1 border-b border-border bg-bg-card px-2 py-2 sm:px-3">
        {showBack && (
          <button type="button" className="btn-icon shrink-0" onClick={onBack} aria-label="Back to all conversations">
            <Icon name="chevronLeft" className="h-6 w-6" />
          </button>
        )}
        <div className={`min-w-0 flex-1 ${showBack ? '' : 'pl-2'}`}>
          <h2 className="display truncate text-[1.125rem] font-bold leading-tight">{person}</h2>
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

      {extras && extras.assignAvailable && (
        <div className="flex items-center gap-2 border-b border-border bg-bg-card px-3 py-1">
          <button type="button" className="inline-flex min-h-[44px] items-center gap-1.5 text-[0.9375rem] font-bold text-blue hover:underline sm:min-h-[36px]" onClick={() => setAssignOpen(true)}>
            <Icon name="user" className="h-4 w-4" />
            {extras.assignee ? `Handled by ${extras.assignee.assignee_name}` : 'Give to someone'}
          </button>
        </div>
      )}

      <AssistantBar ai={ai.state} onAct={async a => { const p = await ai.act(a); extras?.onChanged(); return p }} />

      <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5" role="log" aria-live="polite" aria-label={`Texts with ${thread.name || 'this number'}`}>
        {timeline.length === 0 && (
          <div className="mx-auto mt-10 max-w-xs text-center">
            <p className="font-bold">No texts with {person} yet</p>
            <p className="mt-1 text-[0.9375rem] text-text-secondary">Write below to send the first one.</p>
          </div>
        )}
        <ol className="mx-auto flex max-w-3xl flex-col">
          {shown.map(({ item, newDay, lastOfRun }) => {
            const heading = newDay && (
              <p className="mb-3 mt-5 text-center text-[0.8125rem] font-bold text-text-secondary first:mt-0">{dayHeading(item.at, now)}</p>
            )
            if (item.type === 'event') {
              const e = item.event
              const href = `${e.doc_type === 'Estimate' ? '/estimates' : '/invoices'}?document=${encodeURIComponent(e.document_id)}`
              return (
                <li key={`ev-${e.id}`} className="flex flex-col">
                  {heading}
                  <div className="mb-3 flex items-center justify-center gap-2 text-center text-[0.875rem] text-text-secondary">
                    <span className={`lamp lamp-${eventLamp(e.kind)}`} aria-hidden="true" style={{ width: '0.5rem', height: '0.5rem', boxShadow: 'none' }} />
                    <span>
                      <Link href={href} className="font-bold text-text-primary underline-offset-2 hover:underline">{eventHeadline(e)}</Link>
                      <span> · {clock(e.created_at)}</span>
                    </span>
                  </div>
                </li>
              )
            }
            const m = item.message
            const out = m.direction !== 'inbound'
            const delivery = deliveryOf(m)
            const failed = delivery?.tone === 'fail'
            const pics = media.get(m.id)
            const aiMade = out && m.ai_handled === true
            const hasBody = !!m.body
            return (
              <li key={m.id} className="flex flex-col">
                {heading}
                <div className={`flex flex-col ${out ? 'items-end' : 'items-start'} ${lastOfRun ? 'mb-3' : 'mb-1'}`}>
                  {pics && pics.length > 0 && <MessageMedia items={pics} out={out} who={out ? 'your shop' : person} />}
                  {(hasBody || !pics) && (
                    <div
                      className={`max-w-[86%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-[1rem] leading-snug ${
                        out
                          ? `rounded-br-md bg-blue text-[rgb(var(--c-on-blue))] ${failed ? 'ring-2 ring-red ring-offset-2 ring-offset-bg-base' : ''}`
                          : 'rounded-bl-md border border-border bg-bg-chrome text-text-primary'
                      }`}
                    >
                      {hasBody ? m.body : <span className="italic opacity-80">Picture or video</span>}
                    </div>
                  )}
                  {(lastOfRun || failed || aiMade) && (
                    <p className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[0.8125rem] text-text-secondary">
                      {delivery && <span className={`lamp ${delivery.tone === 'fail' ? 'lamp-red' : delivery.tone === 'wait' ? 'lamp-amber' : 'lamp-green'}`} aria-hidden="true" style={{ width: '0.5rem', height: '0.5rem', boxShadow: 'none' }} />}
                      <span>{clock(m.created_at)}</span>
                      {delivery && <span className={failed ? 'font-bold text-red' : ''}>· {delivery.label}</span>}
                      {aiMade && <span className="tag tag-gray">AI assistant</span>}
                      {failed && hasBody && (
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

      {held && (
        <DraftCard text={held.text} at={held.at} busy={heldBusy || sending} onSend={sendHeld} onEdit={editHeld} onDismiss={dismissHeld} />
      )}

      <form
        className="border-t border-border bg-bg-card px-2 py-2 sm:px-3"
        onSubmit={e => { e.preventDefault(); send(draft, true) }}
      >
        {error && <p role="alert" className="mx-1 mb-2 text-[0.9375rem] font-bold text-red">{error}</p>}
        <PendingStrip items={attach.items} onRemove={attach.remove} />
        <div className="mx-auto flex max-w-3xl items-end gap-1 sm:gap-2">
          <AttachButton onPick={attach.add} disabled={sending || attach.items.length >= 5} />
          {extras && (
            <button type="button" className="btn-icon h-11 w-11 shrink-0 sm:h-10 sm:w-10" onClick={() => setPickerOpen(true)} aria-label="Saved replies" title="Saved replies">
              <Icon name="copy" className="h-5 w-5" />
            </button>
          )}
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
          <button type="submit" className="btn btn-primary h-11 w-11 shrink-0 px-0 sm:h-10 sm:w-10" disabled={!canSend} aria-label={sending ? 'Sending' : 'Send text'}>
            <Icon name="send" className="h-5 w-5" />
          </button>
        </div>
      </form>

      {extras && (
        <>
          <TemplatesSheet
            open={pickerOpen} onClose={() => setPickerOpen(false)} templates={extras.templates} status={extras.templatesStatus}
            reload={extras.reloadTemplates} fill={fillVals} canEdit={extras.canEdit}
            onPick={text => { setDraft(text); setPickerOpen(false); requestAnimationFrame(() => { grow(); box.current?.focus() }) }}
          />
          <AssignSheet open={assignOpen} onClose={() => setAssignOpen(false)} team={extras.team} current={extras.assignee} available={extras.assignAvailable} onAssign={assign} />
        </>
      )}
    </div>
  )
}
