'use client'
import { useState } from 'react'
import Icon from '@/components/Icon'
import { phonePretty } from '@/lib/today'
import { dayLong, durationLabel, firstName, fmtTime, parseYmd, statusLamp, statusWord, timeRange } from './types'
import type { Appointment } from './types'

/** The one thing to do next for each status, in plain words. */
function nextStep(status: string): { label: string; to: string; icon: string } | null {
  switch (status) {
    case 'Scheduled': return { label: 'Mark confirmed', to: 'Confirmed', icon: 'check' }
    case 'Confirmed': return { label: 'Customer arrived', to: 'In Progress', icon: 'wrench' }
    case 'In Progress': return { label: 'Mark done', to: 'Completed', icon: 'check' }
    default: return null
  }
}

export default function ApptDetail({ appt: a, shopName, shopPhone, busy, error, textSent, onStatus, onEdit, onCall, onSendText, onClose }: {
  appt: Appointment
  shopName: string
  shopPhone: string
  busy: boolean
  error: string
  textSent: string
  onStatus: (status: string) => void
  onEdit: () => void
  onCall: () => void
  onSendText: (body: string) => void
  onClose: () => void
}) {
  const [composing, setComposing] = useState(false)
  const day = dayLong(parseYmd(a.date))
  const who = firstName(a.customer_name)
  const what = a.service ? `your ${a.service.toLowerCase()}` : 'your appointment'
  const templates = [
    { key: 'confirm', label: 'Confirm booking', text: `Hi ${who}, this is ${shopName || 'the shop'} confirming ${what} on ${day} at ${fmtTime(a.time)}. Reply here if you need to change it.${shopPhone ? ` Or call ${shopPhone}.` : ''}` },
    { key: 'remind', label: 'Reminder', text: `Hi ${who}, a reminder from ${shopName || 'the shop'}: ${what} is ${day} at ${fmtTime(a.time)}. Reply here if something has changed.` },
    { key: 'ready', label: 'Ready for pickup', text: `Hi ${who}, ${a.vehicle ? `your ${a.vehicle} is` : 'your vehicle is'} ready for pickup at ${shopName || 'the shop'}.${shopPhone ? ` Call ${shopPhone} with any questions.` : ''}` },
  ]
  const [body, setBody] = useState(templates[0].text)
  const step = nextStep(a.status)
  const lamp = statusLamp(a.status)
  const closed = a.status === 'Completed' || a.status === 'Cancelled' || a.status === 'No Show'
  const estimateHref = `/estimates?new=1${a.customer_id ? `&customer=${encodeURIComponent(a.customer_id)}` : ''}`

  if (composing) {
    return (
      <form onSubmit={e => { e.preventDefault(); if (body.trim() && !busy) onSendText(body) }} className="space-y-3">
        <button type="button" className="btn btn-ghost btn-sm -ml-2" onClick={() => setComposing(false)}>
          <Icon name="chevronLeft" className="h-4 w-4" />Back to appointment
        </button>
        <p className="text-text-secondary">To: <strong className="text-text-primary">{a.customer_name}</strong> · {phonePretty(a.phone)}</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Message starters">
          {templates.map(t => (
            <button key={t.key} type="button" className="inline-flex min-h-[36px] items-center rounded-full border border-line bg-bg-card px-3 text-[0.875rem] font-bold hover:bg-bg-hover" onClick={() => setBody(t.text)}>{t.label}</button>
          ))}
        </div>
        <div>
          <label htmlFor="ad-body" className="form-label">Text message</label>
          <textarea id="ad-body" className="form-textarea" rows={5} value={body} onChange={e => setBody(e.target.value)} />
        </div>
        {error && <p role="alert" className="form-error">{error}</p>}
        {textSent && <p role="status" className="flex items-center gap-2 text-green"><Icon name="check" className="h-5 w-5" />{textSent}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={() => setComposing(false)} disabled={busy}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={busy || !body.trim()}><Icon name="send" className="h-5 w-5" />{busy ? 'Sending…' : 'Send text'}</button>
        </div>
      </form>
    )
  }

  return (
    <div>
      <p className="flex items-center gap-2 font-bold"><span className={`lamp lamp-${lamp}`} aria-hidden="true" />{statusWord(a.status)}</p>
      <dl className="mt-3 divide-y divide-border rounded-md border border-border bg-bg-base px-3 text-[0.9375rem]">
        <Row label="When" value={`${day}, ${timeRange(a)}`} sub={durationLabel(Number(a.duration) || 60)} />
        {a.service && <Row label="Service" value={a.service} />}
        {a.vehicle && <Row label="Vehicle" value={a.vehicle} />}
        {a.tech && a.tech !== 'Unassigned' && <Row label="Technician" value={a.tech} />}
        {a.phone && <Row label="Phone" value={phonePretty(a.phone)} />}
        {a.notes && <Row label="Notes" value={a.notes} />}
      </dl>
      {textSent && <p role="status" className="mt-3 flex items-center gap-2 text-green"><Icon name="check" className="h-5 w-5" />{textSent}</p>}
      {error && <p role="alert" className="form-error">{error}</p>}

      <div className="mt-4 space-y-2">
        {step ? (
          <button type="button" className="btn btn-primary w-full" disabled={busy} onClick={() => onStatus(step.to)}>
            <Icon name={step.icon} className="h-5 w-5" />{busy ? 'Saving…' : step.label}
          </button>
        ) : (
          <button type="button" className="btn btn-secondary w-full" disabled={busy} onClick={() => onStatus('Scheduled')}>Put back on the schedule</button>
        )}
        <div className="grid grid-cols-2 gap-2">
          {a.phone && <button type="button" className="btn btn-secondary" onClick={onCall}><Icon name="phone" className="h-5 w-5" />Call</button>}
          {a.phone && <button type="button" className="btn btn-secondary" onClick={() => setComposing(true)}><Icon name="send" className="h-5 w-5" />Text</button>}
          <a className="btn btn-secondary" href={estimateHref}><Icon name="doc" className="h-5 w-5" />Write estimate</a>
          <button type="button" className="btn btn-secondary" onClick={onEdit}><Icon name="edit" className="h-5 w-5" />Edit</button>
        </div>
        {!closed && (
          <div className="flex flex-wrap justify-center gap-x-2 pt-1">
            <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => onStatus('No Show')}>Customer did not show</button>
            <button type="button" className="btn btn-ghost btn-sm !text-red" disabled={busy} onClick={() => onStatus('Cancelled')}>Cancel appointment</button>
          </div>
        )}
      </div>
      <button type="button" className="sr-only" onClick={onClose}>Close</button>
    </div>
  )
}

function Row({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-text-secondary">{label}</dt>
      <dd className="min-w-0 break-words text-right">{value}{sub && <span className="block text-[0.8125rem] text-text-secondary">{sub}</span>}</dd>
    </div>
  )
}
