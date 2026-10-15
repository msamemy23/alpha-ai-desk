'use client'
import { useId, useState } from 'react'
import { formatCurrency } from '@/lib/supabase'
import { getLaborFlatAmount, laborLineTotal, partLineTotal, nonNegativeMoney, quantityFromUnknown } from '@/lib/document-money'
import { clearDiscountPatch, laborDiscountPatch, partDiscountPatch } from '@/lib/doc-pricing'
import { jobNameOf, lineSavings, partKind } from '@/lib/doc-lines'
import type { HoursHistory } from '@/lib/canned-match'
import Icon from '@/components/Icon'
import type { Line } from './types'

const PART_STATUSES = ['Ordered', 'Backordered', 'Received', 'Installed', 'Returned']

/** A labelled field. The label is always visible, never only a placeholder. */
export function Field({ id, label, hint, className = '', children }: { id: string; label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="form-label">{label}</label>
      {children}
      {hint && <p className="form-hint">{hint}</p>}
    </div>
  )
}

/** A number input with an optional dollar sign. Selects its contents on focus so a phone can overtype it. */
export function NumInput({ id, value, onChange, step = '0.01', money = false, readOnly = false, placeholder, autoFocus, ariaLabel }: {
  id: string; value: string | number; onChange: (v: string) => void; step?: string; money?: boolean; readOnly?: boolean; placeholder?: string; autoFocus?: boolean; ariaLabel?: string
}) {
  return (
    <div className="relative">
      {money && <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary">$</span>}
      <input
        id={id}
        className={`form-input num ${money ? 'pl-7' : ''}`}
        type="number"
        inputMode="decimal"
        step={step}
        min="0"
        value={value}
        placeholder={placeholder}
        readOnly={readOnly}
        autoFocus={autoFocus}
        aria-label={ariaLabel}
        onFocus={e => e.currentTarget.select()}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  )
}

/** Helpers a line card can use when the page supplies them. Everything is optional. */
export interface LineTools {
  /** Job names already on the document, offered while typing a job name. */
  jobNames: string[]
  /** The shop's suggested selling price for a part cost (its markup rules), or null for no suggestion. */
  suggestPrice?: (cost: number) => number | null
  /** What the shop has charged for similar work before. */
  hoursHint?: (operation: string) => HoursHistory | null
  /** The hourly rate for a technician (or the shop rate for nobody). */
  rateForTech?: (tech: string) => number | null
}

function LineShell({ title, sub, total, readOnly, onRemove, removeLabel, badge, children }: {
  title: string; sub?: string; total: number; readOnly: boolean; onRemove: () => void; removeLabel: string; badge?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <li className="card !p-3.5 sm:!p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-[0.9375rem] font-bold">{title}</h3>
          {(sub || badge) && <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-text-secondary">{sub}{badge}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="display num text-[1.0625rem] font-bold" aria-label={`Line total ${formatCurrency(total)}`}>{formatCurrency(total)}</span>
          {!readOnly && (
            <button type="button" className="btn btn-ghost btn-sm !text-red" onClick={onRemove} aria-label={removeLabel}>
              <Icon name="trash" className="h-4 w-4" />
              Remove
            </button>
          )}
        </div>
      </div>
      {children}
    </li>
  )
}

/** The job name and the note to the customer: the same two fields on every kind of line. */
function JobAndNote({ idBase, line, readOnly, tools, onChange }: { idBase: string; line: Line; readOnly: boolean; tools?: LineTools; onChange: (patch: Line) => void }) {
  const listId = `${idBase}-jobs`
  return (
    <>
      <Field id={`${idBase}-job`} label="Job" hint="Lines with the same job name are approved or declined together." className="col-span-2">
        <input id={`${idBase}-job`} className="form-input" list={listId} value={String(line.job || '')} readOnly={readOnly} maxLength={80} placeholder="Front brakes" onChange={e => onChange({ job: e.target.value })} />
        <datalist id={listId}>{(tools?.jobNames || []).map(j => <option key={j} value={j} />)}</datalist>
      </Field>
      <Field id={`${idBase}-note`} label="Note for the customer" hint="Prints under this line." className="col-span-2">
        <input id={`${idBase}-note`} className="form-input" value={String(line.note || '')} readOnly={readOnly} maxLength={300} placeholder="Pads were worn to 2 mm" onChange={e => onChange({ note: e.target.value })} />
      </Field>
    </>
  )
}

/** Percent off one line, with the original price kept so the customer sees what they saved. */
function DiscountRow({ idBase, line, kind, readOnly, onChange }: { idBase: string; line: Line; kind: 'part' | 'labor'; readOnly: boolean; onChange: (patch: Line) => void }) {
  const [pct, setPct] = useState('')
  const saved = lineSavings(line, kind)
  const was = kind === 'part' ? nonNegativeMoney(line.listPrice) : getLaborFlatAmount(line) !== null ? nonNegativeMoney(line.listAmount) : nonNegativeMoney(line.listRate)
  const n = Number(pct)
  const apply = () => {
    if (!(n > 0 && n <= 100)) return
    onChange(kind === 'part' ? partDiscountPatch(line, { pct: n }) : laborDiscountPatch(line, { pct: n }))
    setPct('')
  }
  return (
    <div className="col-span-2 sm:col-span-4">
      {saved > 0 ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="tag tag-green">{Number(line.discountPct) || 0}% off</span>
          <span className="text-[0.9375rem] text-text-secondary num">Was {formatCurrency(was)}{kind === 'labor' && getLaborFlatAmount(line) === null ? ' per hour' : kind === 'part' ? ' each' : ''}. Saves {formatCurrency(saved)}.</span>
          {!readOnly && <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange(clearDiscountPatch(line, kind))}>Take it off</button>}
        </div>
      ) : !readOnly ? (
        <div className="flex items-end gap-2">
          <Field id={`${idBase}-disc`} label="Discount (percent off)" className="w-40">
            <NumInput id={`${idBase}-disc`} step="1" value={pct} placeholder="10" onChange={setPct} />
          </Field>
          <button type="button" className="btn btn-secondary btn-sm" onClick={apply} disabled={!(n > 0 && n <= 100)}>Apply</button>
        </div>
      ) : null}
    </div>
  )
}

export function PartCard({ index, part: p, readOnly, autoFocus, tools, onChange, onRemove }: {
  index: number; part: Line; readOnly: boolean; autoFocus: boolean; tools?: LineTools; onChange: (patch: Line) => void; onRemove: () => void
}) {
  const uid = useId()
  const hasExtras = !!(p.warranty || p.cost || p.core || p.job || p.note || p.listPrice)
  const [open, setOpen] = useState(hasExtras)
  const id = (k: string) => `${uid}-${k}`
  const name = String(p.name || '')
  const cost = nonNegativeMoney(p.cost)
  const price = nonNegativeMoney(p.unitPrice)
  const kind = partKind(p)
  const noun = kind === 'fee' ? 'Fee' : kind === 'sublet' ? 'Outside work' : 'Part'
  const job = jobNameOf(p)
  const suggestion = tools?.suggestPrice && cost > 0 && !readOnly ? tools.suggestPrice(cost) : null
  const locked = readOnly
  return (
    <LineShell
      title={name ? `${noun} ${index + 1}: ${name}` : `${noun} ${index + 1}`}
      sub={job ? `Job: ${job}` : undefined}
      badge={p.approved === true ? <span className="tag tag-green">Approved</span> : undefined}
      total={partLineTotal(p)}
      readOnly={readOnly}
      onRemove={onRemove}
      removeLabel={`Remove ${noun.toLowerCase()} ${index + 1}${name ? `: ${name}` : ''}`}
    >
      <div className="grid grid-cols-6 gap-x-3 gap-y-3">
        <Field id={id('name')} label={kind === 'part' ? 'Part name' : 'Description'} className="col-span-6 sm:col-span-3">
          <input id={id('name')} className="form-input" value={name} readOnly={locked} autoFocus={autoFocus} placeholder={kind === 'part' ? 'Front brake pads' : 'Tire disposal'} onChange={e => onChange({ name: e.target.value })} />
        </Field>
        <Field id={id('brand')} label="Brand (optional)" className="col-span-6 sm:col-span-3">
          <input id={id('brand')} className="form-input" value={String(p.brand || '')} readOnly={locked} onChange={e => onChange({ brand: e.target.value })} />
        </Field>
        <Field id={id('qty')} label="Quantity" className="col-span-2">
          <NumInput id={id('qty')} step="1" value={(p.qty as number | string | undefined) ?? 1} readOnly={locked} onChange={v => {
            const qty = Number(v)
            // A discounted line is worked out again at the new quantity, so the price stays a whole number of cents.
            onChange(Number(p.listPrice) > 0 && Number(p.discountPct) > 0 ? { qty, ...partDiscountPatch({ ...p, qty }, { pct: Number(p.discountPct) }) } : { qty })
          }} />
        </Field>
        <Field id={id('price')} label="Price each" className="col-span-4 sm:col-span-2">
          <NumInput id={id('price')} money value={(p.unitPrice as number | string | undefined) ?? 0} readOnly={locked} onChange={v => onChange({ unitPrice: Number(v), listPrice: undefined, discountPct: undefined })} />
        </Field>
        <div className="col-span-6 flex min-h-[44px] items-center sm:col-span-2 sm:mt-[1.625rem] sm:min-h-[40px]">
          <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-[0.9375rem]">
            <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--c-blue))]" checked={p.taxable !== false} disabled={locked} onChange={e => onChange({ taxable: e.target.checked })} />
            Charge tax on this {kind === 'part' ? 'part' : 'charge'}
          </label>
        </div>
      </div>

      <div className="mt-2 border-t border-border pt-1">
        <button type="button" className="flex min-h-[44px] w-full items-center justify-between gap-2 text-left text-[0.9375rem] font-bold text-blue" aria-expanded={open} aria-controls={id('more')} onClick={() => setOpen(o => !o)}>
          <span>More details <span className="font-normal text-text-secondary">(job, note, discount, warranty, your cost, core charge)</span></span>
          <Icon name="chevronDown" className={`h-5 w-5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div id={id('more')} className="grid grid-cols-2 gap-x-3 gap-y-3 pb-1 pt-2 sm:grid-cols-4">
            <JobAndNote idBase={uid} line={p} readOnly={locked} tools={tools} onChange={onChange} />
            <DiscountRow idBase={uid} line={p} kind="part" readOnly={locked} onChange={onChange} />
            <Field id={id('warranty')} label="Part warranty" className="col-span-2">
              <input id={id('warranty')} className="form-input" placeholder="12 months or 12,000 miles" value={String(p.warranty || '')} readOnly={locked} onChange={e => onChange({ warranty: e.target.value })} />
            </Field>
            <Field id={id('status')} label="Part status" className="col-span-2">
              <select id={id('status')} className="form-select" value={String(p.status || 'Ordered')} disabled={locked} onChange={e => onChange({ status: e.target.value })}>
                {PART_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field id={id('cost')} label="Your cost (private)" hint="Never prints or sends." className="col-span-1 sm:col-span-2">
              <NumInput id={id('cost')} money value={(p.cost as number | string | undefined) ? (p.cost as number | string) : ''} placeholder="0.00" readOnly={locked} onChange={v => onChange({ cost: Number(v) })} />
            </Field>
            <Field id={id('core')} label="Core charge" hint="Refundable. Added to the total." className="col-span-1 sm:col-span-2">
              <NumInput id={id('core')} money value={(p.core as number | string | undefined) ? (p.core as number | string) : ''} placeholder="0.00" readOnly={locked} onChange={v => onChange({ core: Number(v) })} />
            </Field>
            {cost > 0 && price > 0 && (
              <p className="col-span-2 text-[0.9375rem] text-green sm:col-span-4 num">Profit on this line: {formatCurrency((price - cost) * quantityFromUnknown(p.qty))} ({Math.round(((price - cost) / price) * 100)}% of the price)</p>
            )}
            {suggestion !== null && suggestion > 0 && Math.abs(suggestion - price) >= 0.005 && (
              <div className="col-span-2 flex flex-wrap items-center gap-2 sm:col-span-4">
                <span className="text-[0.9375rem] text-text-secondary num">Your markup rules suggest {formatCurrency(suggestion)} each.</span>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange({ unitPrice: suggestion, listPrice: undefined, discountPct: undefined })}>Use it</button>
              </div>
            )}
          </div>
        )}
      </div>
    </LineShell>
  )
}

export function LaborCard({ index, labor: l, staff, readOnly, autoFocus, tools, onChange, onRemove }: {
  index: number; labor: Line; staff: string[]; readOnly: boolean; autoFocus: boolean; tools?: LineTools; onChange: (patch: Line) => void; onRemove: () => void
}) {
  const uid = useId()
  const id = (k: string) => `${uid}-${k}`
  const flat = getLaborFlatAmount(l) !== null
  const op = String(l.operation || '')
  const tech = String(l.tech || '')
  const techOptions = tech && !staff.includes(tech) ? [tech, ...staff] : staff
  const job = jobNameOf(l)
  const [open, setOpen] = useState(!!(l.job || l.note || l.listRate || l.listAmount))
  const hours = Number(l.hours) || 0
  const history = !flat && !readOnly && op.trim().length >= 4 ? tools?.hoursHint?.(op) ?? null : null

  // Choosing a technician moves the rate to that technician's rate, but only when the rate was the default one.
  const pickTech = (next: string) => {
    const patch: Line = { tech: next }
    if (!flat && tools?.rateForTech) {
      const before = tools.rateForTech(tech)
      const after = tools.rateForTech(next)
      const current = Number(l.rate)
      if (after !== null && (l.rate === undefined || l.rate === '' || (before !== null && Math.abs(current - before) < 0.005)) && !l.listRate) patch.rate = after
    }
    onChange(patch)
  }

  return (
    <LineShell
      title={op ? `Labor ${index + 1}: ${op}` : `Labor ${index + 1}`}
      sub={job ? `Job: ${job}` : undefined}
      badge={l.approved === true ? <span className="tag tag-green">Approved</span> : undefined}
      total={laborLineTotal(l)}
      readOnly={readOnly}
      onRemove={onRemove}
      removeLabel={`Remove labor ${index + 1}${op ? `: ${op}` : ''}`}
    >
      <div className="grid grid-cols-6 gap-x-3 gap-y-3">
        <Field id={id('op')} label="Work to do" className="col-span-6 sm:col-span-3">
          <input id={id('op')} className="form-input" value={op} readOnly={readOnly} autoFocus={autoFocus} placeholder="Replace front pads and rotors" onChange={e => onChange({ operation: e.target.value })} />
        </Field>
        <Field id={id('tech')} label="Technician (optional)" className="col-span-6 sm:col-span-3">
          {techOptions.length > 0 ? (
            <select id={id('tech')} className="form-select" value={tech} disabled={readOnly} onChange={e => pickTech(e.target.value)}>
              <option value="">No one yet</option>
              {techOptions.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          ) : (
            <input id={id('tech')} className="form-input" value={tech} readOnly={readOnly} placeholder="Name" onChange={e => pickTech(e.target.value)} />
          )}
        </Field>
        <Field id={id('hrs')} label={flat ? 'Pricing' : 'Hours'} className="col-span-2">
          {flat ? (
            <input id={id('hrs')} className="form-input" value="Flat price" readOnly />
          ) : (
            <NumInput id={id('hrs')} step="0.1" value={(l.hours as number | string | undefined) ?? 0} readOnly={readOnly} onChange={v => {
              const next = Number(v)
              onChange(Number(l.listRate) > 0 && Number(l.discountPct) > 0 ? { hours: next, ...laborDiscountPatch({ ...l, hours: next }, { pct: Number(l.discountPct) }) } : { hours: next })
            }} />
          )}
        </Field>
        <Field id={id('rate')} label={flat ? 'Amount' : 'Rate per hour'} className="col-span-4 sm:col-span-2">
          <NumInput
            id={id('rate')}
            money
            value={flat ? Number(getLaborFlatAmount(l) || 0) : ((l.rate as number | string | undefined) ?? '')}
            readOnly={readOnly}
            onChange={v => onChange(flat ? { amount: Number(v), pricing: 'flat', listAmount: undefined, discountPct: undefined } : { rate: Number(v), listRate: undefined, discountPct: undefined })}
          />
        </Field>
        {history && history.count > 0 && Math.abs(history.averageHours - hours) >= 0.05 && (
          <div className="col-span-6 flex flex-wrap items-center gap-2 sm:col-span-2 sm:mt-[1.625rem]">
            <span className="text-[0.875rem] text-text-secondary num">
              {history.sameCar ? 'On this car' : 'Usually'} {history.averageHours} h ({history.count} {history.count === 1 ? 'time' : 'times'}{history.low !== history.high ? `, ${history.low} to ${history.high} h` : ''})
            </span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange({ hours: history.averageHours })}>Use {history.averageHours} h</button>
          </div>
        )}
      </div>

      <div className="mt-2 border-t border-border pt-1">
        <button type="button" className="flex min-h-[44px] w-full items-center justify-between gap-2 text-left text-[0.9375rem] font-bold text-blue" aria-expanded={open} aria-controls={id('more')} onClick={() => setOpen(o => !o)}>
          <span>More details <span className="font-normal text-text-secondary">(job, note, discount)</span></span>
          <Icon name="chevronDown" className={`h-5 w-5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div id={id('more')} className="grid grid-cols-2 gap-x-3 gap-y-3 pb-1 pt-2 sm:grid-cols-4">
            <JobAndNote idBase={uid} line={l} readOnly={readOnly} tools={tools} onChange={onChange} />
            <DiscountRow idBase={uid} line={l} kind="labor" readOnly={readOnly} onChange={onChange} />
          </div>
        )}
      </div>
    </LineShell>
  )
}
