'use client'
import { useState } from 'react'
import Icon from '@/components/Icon'
import JobPostCard from './JobPostCard'
import { JobFlowCardWithSettings } from './JobFlowCard'
import StatusLinkCard from './StatusLinkCard'
import { formatCurrency } from '@/lib/supabase'
import { phonePretty } from '@/lib/today'
import { statusTextBody } from '@/lib/jobflow'
import { STATUSES, carLine, dueInfo, firstName, longDate, nextStep, openedLabel, stageOf, statusLamp, statusWord } from './types'
import type { Job, JobDoc, JobInspection } from './types'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="shrink-0 text-text-secondary">{label}</dt>
      <dd className="min-w-0 break-words text-right">{children}</dd>
    </div>
  )
}

export default function JobDetail({
  job: j, docs, inspections = [], phone, shopName, shopPhone, todayKey, busy, error, textSent, note, startTexting,
  onStatus, onEdit, onCall, onSendText, onDelete,
}: {
  job: Job
  docs: JobDoc[]
  /** Inspections already done for this car, newest first. */
  inspections?: JobInspection[]
  phone: string
  shopName: string
  shopPhone: string
  todayKey: string
  busy: boolean
  error: string
  textSent: string
  /** What just changed ("Now ready for pickup."), shown here because the page behind the sheet is covered. */
  note?: string
  /** Opens straight to the text composer, for the "Text the customer" button on a notice. */
  startTexting?: boolean
  onStatus: (status: string) => void
  onEdit: () => void
  onCall: () => void
  onSendText: (body: string) => void
  onDelete: () => void
}) {
  const [composing, setComposing] = useState(Boolean(startTexting))
  const who = firstName(j.customer_name) || 'there'
  const car = carLine(j)
  const yourCar = car ? `your ${car}` : 'your vehicle'
  const shop = shopName || 'the shop'
  const call = shopPhone ? ` Call ${shopPhone} with any questions.` : ''
  const templates = [
    { key: 'started', label: 'Work started', text: `Hi ${who}, this is ${shop}. We have started work on ${yourCar}. We will message you when it is ready.` },
    { key: 'approve', label: 'Needs your OK', text: `Hi ${who}, this is ${shop}. We looked over ${yourCar} and have an estimate ready for you.${shopPhone ? ` Reply here or call ${shopPhone} to approve it.` : ' Reply here to approve it.'}` },
    { key: 'parts', label: 'Waiting on parts', text: `Hi ${who}, this is ${shop}. We are waiting on a part for ${yourCar}. We will update you as soon as it arrives.` },
    { key: 'ready', label: 'Ready for pickup', text: `Hi ${who}, ${yourCar} is ready for pickup at ${shop}.${call}` },
  ]
  const stage = stageOf(j.status).key
  const first = stage === 'ready' ? 'ready' : j.status === 'Waiting on Parts' ? 'parts' : j.status === 'Waiting on Customer' ? 'approve' : 'started'
  const [body, setBody] = useState(templates.find(t => t.key === first)?.text || templates[0].text)

  const step = nextStep(j, docs)
  const due = dueInfo(j, todayKey)
  const lamp = statusLamp(j.status)
  const customerQ = j.customer_id ? `&customer=${encodeURIComponent(j.customer_id)}` : ''
  const writeHref = (kind: 'estimates' | 'invoices') => `/${kind}?new=1&job=${encodeURIComponent(j.id)}${customerQ}`

  if (composing) {
    return (
      <form onSubmit={e => { e.preventDefault(); if (body.trim() && !busy) onSendText(body) }} className="space-y-3">
        <button type="button" className="btn btn-ghost btn-sm -ml-2" onClick={() => setComposing(false)}>
          <Icon name="chevronLeft" className="h-4 w-4" />Back to job
        </button>
        <p className="text-text-secondary">To: <strong className="text-text-primary">{j.customer_name}</strong> · {phonePretty(phone)}</p>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Message starters">
          {templates.map(t => (
            <button key={t.key} type="button" className="inline-flex min-h-[36px] items-center rounded-full border border-line bg-bg-card px-3 text-[0.875rem] font-bold hover:bg-bg-hover" onClick={() => setBody(t.text)}>{t.label}</button>
          ))}
        </div>
        <div>
          <label htmlFor="jd-body" className="form-label">Text message</label>
          <textarea id="jd-body" className="form-textarea" rows={5} value={body} onChange={e => setBody(e.target.value)} />
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

  const estimates = docs.filter(d => d.type === 'Estimate')
  const invoices = docs.filter(d => d.type !== 'Estimate')

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <p className="flex items-center gap-2 font-bold"><span className={`lamp lamp-${lamp}`} aria-hidden="true" />{statusWord(j.status)}</p>
        {(j.priority === 'Rush' || j.priority === 'High') && <span className="tag tag-red">{j.priority === 'Rush' ? 'Rush' : 'High priority'}</span>}
        {j.is_insurance && <a className="tag tag-blue no-underline" href="/insurance">Insurance claim</a>}
      </div>
      <p className="mt-1 text-[0.9375rem] text-text-secondary">{[j.ro_number, openedLabel(j.created_at, todayKey)].filter(Boolean).join(' · ')}</p>

      <dl className="mt-3 divide-y divide-border rounded-md border border-border bg-bg-base px-3 text-[0.9375rem]">
        <Row label="Vehicle">
          {car || 'Not noted'}
          {[j.vehicle_color, j.vehicle_engine].filter(Boolean).length > 0 && <span className="block text-[0.8125rem] text-text-secondary">{[j.vehicle_color, j.vehicle_engine].filter(Boolean).join(' · ')}</span>}
          {j.vehicle_vin && <span className="num block text-[0.8125rem] text-text-secondary">VIN {j.vehicle_vin}</span>}
          {[j.vehicle_plate && `Plate ${j.vehicle_plate}`, j.vehicle_mileage && `${j.vehicle_mileage} miles`].filter(Boolean).length > 0 && (
            <span className="block text-[0.8125rem] text-text-secondary">{[j.vehicle_plate && `Plate ${j.vehicle_plate}`, j.vehicle_mileage && `${j.vehicle_mileage} miles`].filter(Boolean).join(' · ')}</span>
          )}
        </Row>
        {j.concern && <Row label="Concern">{j.concern}</Row>}
        <Row label="Technician">{j.tech || 'Unassigned'}</Row>
        <Row label="Promised">
          {j.promise_date ? longDate(j.promise_date) : 'No date set'}
          {due && due.tone !== 'later' && <span className={`block text-[0.8125rem] font-bold ${due.tone === 'late' ? 'text-red' : 'text-amber'}`}>{due.text}</span>}
        </Row>
        {phone && <Row label="Phone">{phonePretty(phone)}</Row>}
        {j.internal_notes && <Row label="Shop notes">{j.internal_notes}</Row>}
        {j.customer_notes && <Row label="Customer notes">{j.customer_notes}</Row>}
      </dl>

      {textSent && <p role="status" className="mt-3 flex items-center gap-2 text-green"><Icon name="check" className="h-5 w-5" />{textSent}</p>}
      {note && !textSent && (
        <div role="status" className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-green/40 bg-green/[0.08] px-3 py-2.5 text-[0.9375rem]">
          <span className="flex items-center gap-2"><Icon name="check" className="h-5 w-5 shrink-0 text-green" />{note}</span>
          {phone && (stage === 'ready' || stage === 'waiting') && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setBody(templates.find(t => t.key === first)?.text || templates[0].text); setComposing(true) }}>
              <Icon name="send" className="h-4 w-4" />Text {who === 'there' ? 'the customer' : who}
            </button>
          )}
        </div>
      )}
      {error && <p role="alert" className="form-error">{error}</p>}

      <div className="mt-4 space-y-2">
        {step && (
          step.to
            ? <button type="button" className="btn btn-primary w-full" disabled={busy} onClick={() => onStatus(step.to as string)}><Icon name={step.icon} className="h-5 w-5" />{busy ? 'Saving…' : step.label}</button>
            : <a className="btn btn-primary w-full no-underline" href={step.href}><Icon name={step.icon} className="h-5 w-5" />{step.label}</a>
        )}
        <div>
          <label htmlFor="jd-status" className="form-label">Change status</label>
          <select id="jd-status" className="form-select" value={j.status} disabled={busy} onChange={e => onStatus(e.target.value)}>
            {STATUSES.map(s => <option key={s} value={s}>{statusWord(s)}</option>)}
            {!(STATUSES as readonly string[]).includes(j.status) && <option value={j.status}>{j.status}</option>}
          </select>
        </div>
      </div>

      <section className="mt-5" aria-label="Inspections">
        <h3 className="section-title mb-1.5">Inspection</h3>
        {inspections.length === 0 ? (
          <p className="text-[0.9375rem] text-text-secondary">No inspection yet. Walk the car, rate each part, and text the customer photos and prices.</p>
        ) : (
          <ul className="ledger">
            {inspections.map(i => (
              <li key={i.id}>
                <a className="ledger-row no-underline" href={`/dvi?id=${encodeURIComponent(i.id)}`}>
                  <span className={`lamp lamp-${i.overall_status === 'red' ? 'red' : i.overall_status === 'yellow' ? 'amber' : i.overall_status === 'green' ? 'green' : 'off'} shrink-0`} aria-hidden="true" />
                  <span className="ledger-main">
                    <span className="ledger-title block">{i.customer_approved ? 'Customer approved work' : i.sent_to_customer ? 'Sent to the customer' : i.overall_status === 'pending' || !i.overall_status ? 'Not started' : 'Being checked'}</span>
                    <span className="ledger-sub block">{openedLabel(i.created_at, todayKey)}</span>
                  </span>
                  <Icon name="chevronRight" className="h-5 w-5 shrink-0 text-text-muted" />
                </a>
              </li>
            ))}
          </ul>
        )}
        <a className="btn btn-secondary mt-3 w-full no-underline" href={`/dvi?new=1&job=${encodeURIComponent(j.id)}`}><Icon name="inspect" className="h-5 w-5" />{inspections.length === 0 ? 'Start inspection' : 'Start another inspection'}</a>
      </section>

      <JobFlowCardWithSettings jobId={j.id} promiseDate={j.promise_date ? j.promise_date.slice(0, 10) : null} />

      <StatusLinkCard
        jobId={j.id}
        canText={Boolean(phone)}
        onText={url => { setBody(statusTextBody({ customer: j.customer_name || '', car, shop: shopName, statusUrl: url })); setComposing(true) }}
      />

      <JobPostCard jobId={j.id} />

      <section className="mt-5" aria-label="Estimates and invoices">
        <h3 className="section-title mb-1.5">Estimates and invoices</h3>
        {docs.length === 0 ? (
          <p className="text-[0.9375rem] text-text-secondary">Nothing written for this job yet.</p>
        ) : (
          <ul className="ledger">
            {[...estimates, ...invoices].map(d => (
              <li key={d.id}>
                <a className="ledger-row no-underline" href={`/${d.type === 'Estimate' ? 'estimates' : d.type === 'Receipt' ? 'receipts' : 'invoices'}?document=${encodeURIComponent(d.id)}`}>
                  <span className="ledger-main">
                    <span className="ledger-title block">{d.type} {d.doc_number}</span>
                    <span className="ledger-sub block">{d.status}{d.type !== 'Estimate' && d.paid > 0 ? ` · ${formatCurrency(d.paid)} paid` : ''}</span>
                  </span>
                  <span className="ledger-amt">{formatCurrency(d.total)}</span>
                </a>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3 grid grid-cols-2 gap-2">
          <a className="btn btn-secondary no-underline" href={writeHref('estimates')}><Icon name="doc" className="h-5 w-5" />Write estimate</a>
          <a className="btn btn-secondary no-underline" href={writeHref('invoices')}><Icon name="invoice" className="h-5 w-5" />Write invoice</a>
        </div>
      </section>

      <div className="mt-4 grid grid-cols-2 gap-2">
        {phone ? <button type="button" className="btn btn-secondary" onClick={onCall}><Icon name="phone" className="h-5 w-5" />Call</button> : <span className="flex items-center justify-center text-[0.875rem] text-text-secondary">No phone on file</span>}
        {phone && <button type="button" className="btn btn-secondary" onClick={() => setComposing(true)}><Icon name="send" className="h-5 w-5" />Text</button>}
        <button type="button" className="btn btn-secondary col-span-2" onClick={onEdit}><Icon name="edit" className="h-5 w-5" />Edit job</button>
      </div>
      <div className="mt-2 flex justify-center">
        <button type="button" className="btn btn-ghost btn-sm !text-red" disabled={busy} onClick={onDelete}>Delete job</button>
      </div>
    </div>
  )
}
