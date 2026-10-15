'use client'
import { useState } from 'react'
import { addDaysIso } from '@/lib/doc-approval'
import { Field } from './LineCards'
import { ErrorMsg } from './Dialogs'

const actions = 'mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end'
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)

const REASONS = ['Customer cancelled', 'Written for the wrong car', 'Made twice by mistake', 'Replaced by a new estimate']

/** Void keeps the record and its number, turns the customer's links off, and needs a reason. */
export function VoidForm({ noun, docNumber, customerName, hasLinks, busy, error, onConfirm, onClose }: {
  noun: string; docNumber: string; customerName: string; hasLinks: boolean; busy: boolean; error: string
  onConfirm: (reason: string) => void; onClose: () => void
}) {
  const [reason, setReason] = useState('')
  const clean = reason.replace(/\s+/g, ' ').trim()
  const ok = clean.length >= 3 && clean.length <= 300
  return (
    <form onSubmit={e => { e.preventDefault(); if (ok && !busy) onConfirm(clean) }}>
      <p className="text-[0.9375rem]">
        {cap(noun)} {docNumber}{customerName ? ` for ${customerName}` : ''} stays on record, marked void, and its number is not used again.
        {hasLinks ? ' Any link the customer has stops working.' : ''} You can restore it later. A document with payments on it cannot be voided.
      </p>
      <div className="mt-4">
        <Field id="void-reason" label="Why is it being voided?" hint="Kept in the history. 3 to 300 characters.">
          <textarea id="void-reason" className="form-textarea" rows={3} value={reason} maxLength={300} autoFocus onChange={e => setReason(e.target.value)} />
        </Field>
        <div className="mt-2 flex flex-wrap gap-2">
          {REASONS.map(r => <button key={r} type="button" className="btn btn-secondary btn-sm" onClick={() => setReason(r)}>{r}</button>)}
        </div>
      </div>
      {error && <div className="mt-3"><ErrorMsg>{error}</ErrorMsg></div>}
      <div className={actions}>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Keep it</button>
        <button type="submit" className="btn btn-danger" disabled={!ok || busy}>{busy ? 'Voiding…' : `Void ${noun}`}</button>
      </div>
    </form>
  )
}

export function RestoreForm({ noun, docNumber, busy, error, onConfirm, onClose }: {
  noun: string; docNumber: string; busy: boolean; error: string; onConfirm: () => void; onClose: () => void
}) {
  return (
    <div>
      <p className="text-[0.9375rem]">{cap(noun)} {docNumber} comes back as it was. Links that were turned off stay off. Send it again if the customer needs a new one.</p>
      {error && <div className="mt-3"><ErrorMsg>{error}</ErrorMsg></div>}
      <div className={actions}>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={busy}>{busy ? 'Restoring…' : `Restore ${noun}`}</button>
      </div>
    </div>
  )
}

/** Delete is only for drafts nobody saw and voided documents with no payments and no signature. */
export function DeleteForm({ noun, docNumber, customerName, status, busy, error, onConfirm, onVoidInstead, onClose }: {
  noun: string; docNumber: string; customerName: string; status: string; busy: boolean; error: string
  onConfirm: () => void; onVoidInstead: () => void; onClose: () => void
}) {
  const allowed = status === 'Draft' || status === 'Void'
  return (
    <div>
      {allowed ? (
        <p className="text-[0.9375rem]">
          {cap(noun)} {docNumber}{customerName ? ` for ${customerName}` : ''} will be removed for good. This cannot be undone. A short note that it was deleted stays in the activity log.
        </p>
      ) : (
        <p className="text-[0.9375rem]">
          {cap(noun)} {docNumber} has been sent or worked on, so it cannot be deleted. Void it instead: it stays on record with your reason, the customer links stop working, and you can restore it later.
        </p>
      )}
      {error && <div className="mt-3"><ErrorMsg>{error}</ErrorMsg></div>}
      <div className={actions}>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Keep it</button>
        {allowed ? (
          <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={busy}>{busy ? 'Deleting…' : `Delete ${noun}`}</button>
        ) : (
          <button type="button" className="btn btn-danger" onClick={onVoidInstead}>Void it instead</button>
        )}
      </div>
    </div>
  )
}

/** Change the good-through date of an estimate. The customer's open links get the same extra time. */
export function ExtendForm({ docNumber, current, today, busy, error, onConfirm, onClose }: {
  docNumber: string; current: string; today: string; busy: boolean; error: string; onConfirm: (iso: string) => void; onClose: () => void
}) {
  const base = current && current > today ? current : today
  const [date, setDate] = useState(addDaysIso(base, 14))
  const quick: [string, number][] = [['+7 days', 7], ['+14 days', 14], ['+30 days', 30]]
  return (
    <form onSubmit={e => { e.preventDefault(); if (date && !busy) onConfirm(date) }}>
      <p className="text-[0.9375rem]">Estimate {docNumber} {current ? `is good through ${new Date(current + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}` : 'has no end date'}. Pick a new date.</p>
      <div className="mt-4">
        <Field id="ext-date" label="Good through">
          <input id="ext-date" className="form-input" type="date" min={today} value={date} onChange={e => setDate(e.target.value)} />
        </Field>
        <div className="mt-2 flex flex-wrap gap-2">
          {quick.map(([label, n]) => <button key={n} type="button" className="btn btn-secondary btn-sm" onClick={() => setDate(addDaysIso(base, n))}>{label}</button>)}
        </div>
      </div>
      {error && <div className="mt-3"><ErrorMsg>{error}</ErrorMsg></div>}
      <div className={actions}>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={!date || busy}>{busy ? 'Saving…' : 'Change the date'}</button>
      </div>
    </form>
  )
}

export function LinksOffForm({ noun, busy, error, onConfirm, onClose }: { noun: string; busy: boolean; error: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <div>
      <p className="text-[0.9375rem]">Every link the customer has for this {noun} stops working. An answer they already gave is kept. You can send a new link any time.</p>
      {error && <div className="mt-3"><ErrorMsg>{error}</ErrorMsg></div>}
      <div className={actions}>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-danger" onClick={onConfirm} disabled={busy}>{busy ? 'Turning off…' : 'Turn off the links'}</button>
      </div>
    </div>
  )
}
