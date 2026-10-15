'use client'
import { useMemo, useState } from 'react'
import { formatCurrency } from '@/lib/supabase'
import { calculateDocumentTotals } from '@/lib/document-money'
import { applyPercentDiscount, clearAllDiscounts, discountSummary } from '@/lib/doc-pricing'
import type { DiscountScope } from '@/lib/doc-pricing'
import { makeFeeLine } from '@/lib/doc-lines'
import type { Line } from '@/lib/doc-lines'
import type { FeePreset } from '@/lib/doc-prefs'
import { Field, NumInput } from './LineCards'
import { ErrorMsg } from './Dialogs'

const actions = 'mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end'
const SCOPES: { id: DiscountScope; label: string; hint: string }[] = [
  { id: 'all', label: 'Everything', hint: 'Labor and parts' },
  { id: 'labor', label: 'Labor only', hint: 'Hourly and flat labor' },
  { id: 'parts', label: 'Parts only', hint: 'Fees and outside work are not discounted' },
]

/**
 * Percent off the whole document, labor or parts. The original price stays on each line, so the customer sees
 * what they saved, and taking the discount off puts the original prices back exactly.
 */
export function DiscountForm({ doc, onApply, onClose }: {
  doc: Record<string, unknown>
  onApply: (r: { parts: Line[]; labors: Line[] }, words: string) => void
  onClose: () => void
}) {
  const [scope, setScope] = useState<DiscountScope>('all')
  const [pct, setPct] = useState('10')
  const n = Number(pct)
  const valid = Number.isFinite(n) && n > 0 && n <= 100
  const saved = discountSummary(doc)
  const next = useMemo(() => (valid ? applyPercentDiscount(doc, scope, n) : null), [doc, scope, n, valid])
  const before = calculateDocumentTotals(doc)
  const after = next ? calculateDocumentTotals({ ...doc, parts: next.parts, labors: next.labors }) : null
  const takesOff = after ? Math.round((before.total - after.total) * 100) / 100 : 0

  return (
    <form onSubmit={e => { e.preventDefault(); if (next) onApply(next, `${n}% off ${scope === 'all' ? 'everything' : scope}`) }}>
      <fieldset>
        <legend className="form-label">What does the discount apply to?</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {SCOPES.map(s => (
            <button key={s.id} type="button" aria-pressed={scope === s.id} onClick={() => setScope(s.id)}
              className={`min-h-[56px] rounded-md border px-3 py-2 text-left ${scope === s.id ? 'border-blue bg-blue/10 text-blue' : 'border-line bg-bg-card hover:bg-bg-hover'}`}>
              <span className="block font-bold">{s.label}</span>
              <span className="block text-[0.8125rem] text-text-secondary">{s.hint}</span>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="mt-4">
        <Field id="disc-pct" label="Percent off">
          <NumInput id="disc-pct" step="1" value={pct} onChange={setPct} />
        </Field>
        <div className="mt-2 flex flex-wrap gap-2">
          {[5, 10, 15, 20].map(v => <button key={v} type="button" className="btn btn-secondary btn-sm" onClick={() => setPct(String(v))}>{v}%</button>)}
        </div>
        {!valid && pct !== '' && <p className="form-error">Enter a percent between 1 and 100.</p>}
      </div>

      <div className="mt-4 rounded-md border border-border bg-bg-card px-3 py-2.5 text-[0.9375rem]" aria-live="polite">
        {after ? (
          <>
            <p className="flex items-baseline justify-between gap-3"><span>Takes off</span><span className="num font-bold">{formatCurrency(takesOff)}</span></p>
            <p className="flex items-baseline justify-between gap-3"><span>New total with tax</span><span className="num font-bold">{formatCurrency(after.total)}</span></p>
          </>
        ) : <p className="text-text-secondary">Enter a percent to see the new total.</p>}
        {saved.total > 0 && <p className="mt-1 text-[0.8125rem] text-text-secondary">Already discounted by {formatCurrency(saved.total)}. A new percent starts again from the original prices.</p>}
      </div>

      <div className={actions}>
        {saved.total > 0 && (
          <button type="button" className="btn btn-secondary sm:mr-auto" onClick={() => onApply(clearAllDiscounts(doc), 'Discounts removed')}>Take all discounts off</button>
        )}
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={!next}>Apply discount</button>
      </div>
    </form>
  )
}

/** Add a fee (disposal, environmental) or outside work (machine shop, towing) as its own line. */
export function FeeForm({ presets, jobNames, onAdd, onClose }: {
  presets: FeePreset[]
  jobNames: string[]
  onAdd: (line: Line) => void
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [taxable, setTaxable] = useState(true)
  const [kind, setKind] = useState<'fee' | 'sublet'>('fee')
  const [job, setJob] = useState('')
  const [error, setError] = useState('')
  const amt = Number(amount)

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Say what the charge is for.'); return }
    if (!Number.isFinite(amt) || amt <= 0) { setError('Enter the amount.'); return }
    onAdd(makeFeeLine({ name: name.trim(), amount: amt, taxable, kind, job: job.trim() || undefined }))
  }

  return (
    <form onSubmit={submit}>
      {presets.length > 0 && (
        <div className="mb-4">
          <p className="form-label">Your usual charges</p>
          <div className="flex flex-wrap gap-2">
            {presets.map(p => (
              <button key={p.id} type="button" className="btn btn-secondary btn-sm" onClick={() => { setName(p.name); setAmount(String(p.amount)); setTaxable(p.taxable); setKind(p.kind); setError('') }}>
                {p.name} {formatCurrency(p.amount)}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field id="fee-kind" label="What kind of charge" className="col-span-2">
          <select id="fee-kind" className="form-select" value={kind} onChange={e => setKind(e.target.value as 'fee' | 'sublet')}>
            <option value="fee">Shop fee (disposal, environmental, diagnostic)</option>
            <option value="sublet">Outside work (machine shop, towing, alignment)</option>
          </select>
        </Field>
        <Field id="fee-name" label="Description" className="col-span-2">
          <input id="fee-name" className="form-input" value={name} maxLength={120} autoFocus={presets.length === 0} onChange={e => { setName(e.target.value); setError('') }} placeholder="Tire disposal" />
        </Field>
        <Field id="fee-amount" label="Amount" className="col-span-1">
          <NumInput id="fee-amount" money value={amount} onChange={v => { setAmount(v); setError('') }} placeholder="0.00" />
        </Field>
        <Field id="fee-job" label="Belongs to job" className="col-span-1">
          <input id="fee-job" className="form-input" list="fee-jobs" value={job} maxLength={80} onChange={e => setJob(e.target.value)} placeholder="Optional" />
          <datalist id="fee-jobs">{jobNames.map(j => <option key={j} value={j} />)}</datalist>
        </Field>
        <label className="col-span-2 flex min-h-[44px] cursor-pointer items-center gap-2.5 text-[0.9375rem]">
          <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--c-blue))]" checked={taxable} onChange={e => setTaxable(e.target.checked)} />
          Charge sales tax on this
        </label>
      </div>
      {error && <div className="mt-3"><ErrorMsg>{error}</ErrorMsg></div>}
      <div className={actions}>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" className="btn btn-primary">Add the charge</button>
      </div>
    </form>
  )
}
