'use client'
import { useId, useState } from 'react'
import { formatCurrency } from '@/lib/supabase'
import { getLaborFlatAmount, laborLineTotal, partLineTotal, nonNegativeMoney, quantityFromUnknown } from '@/lib/document-money'
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

function LineShell({ title, total, readOnly, onRemove, removeLabel, children }: { title: string; total: number; readOnly: boolean; onRemove: () => void; removeLabel: string; children: React.ReactNode }) {
  return (
    <li className="card !p-3.5 sm:!p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="min-w-0 truncate text-[0.9375rem] font-bold">{title}</h3>
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

export function PartCard({ index, part: p, readOnly, autoFocus, onChange, onRemove }: {
  index: number; part: Line; readOnly: boolean; autoFocus: boolean; onChange: (patch: Line) => void; onRemove: () => void
}) {
  const uid = useId()
  const hasExtras = !!(p.warranty || p.cost || p.core)
  const [open, setOpen] = useState(hasExtras)
  const id = (k: string) => `${uid}-${k}`
  const name = String(p.name || '')
  const cost = nonNegativeMoney(p.cost)
  const price = nonNegativeMoney(p.unitPrice)
  return (
    <LineShell
      title={name ? `Part ${index + 1}: ${name}` : `Part ${index + 1}`}
      total={partLineTotal(p)}
      readOnly={readOnly}
      onRemove={onRemove}
      removeLabel={`Remove part ${index + 1}${name ? `: ${name}` : ''}`}
    >
      <div className="grid grid-cols-6 gap-x-3 gap-y-3">
        <Field id={id('name')} label="Part name" className="col-span-6 sm:col-span-3">
          <input id={id('name')} className="form-input" value={name} readOnly={readOnly} autoFocus={autoFocus} placeholder="Front brake pads" onChange={e => onChange({ name: e.target.value })} />
        </Field>
        <Field id={id('brand')} label="Brand (optional)" className="col-span-6 sm:col-span-3">
          <input id={id('brand')} className="form-input" value={String(p.brand || '')} readOnly={readOnly} onChange={e => onChange({ brand: e.target.value })} />
        </Field>
        <Field id={id('qty')} label="Quantity" className="col-span-2">
          <NumInput id={id('qty')} step="1" value={(p.qty as number | string | undefined) ?? 1} readOnly={readOnly} onChange={v => onChange({ qty: Number(v) })} />
        </Field>
        <Field id={id('price')} label="Price each" className="col-span-4 sm:col-span-2">
          <NumInput id={id('price')} money value={(p.unitPrice as number | string | undefined) ?? 0} readOnly={readOnly} onChange={v => onChange({ unitPrice: Number(v) })} />
        </Field>
        <div className="col-span-6 flex min-h-[44px] items-center sm:col-span-2 sm:mt-[1.625rem] sm:min-h-[40px]">
          <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-[0.9375rem]">
            <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--c-blue))]" checked={p.taxable !== false} disabled={readOnly} onChange={e => onChange({ taxable: e.target.checked })} />
            Charge tax on this part
          </label>
        </div>
      </div>

      <div className="mt-2 border-t border-border pt-1">
        <button type="button" className="flex min-h-[44px] w-full items-center justify-between gap-2 text-left text-[0.9375rem] font-bold text-blue" aria-expanded={open} aria-controls={id('more')} onClick={() => setOpen(o => !o)}>
          <span>More details <span className="font-normal text-text-secondary">(warranty, status, your cost, core charge)</span></span>
          <Icon name="chevronDown" className={`h-5 w-5 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
        {open && (
          <div id={id('more')} className="grid grid-cols-2 gap-x-3 gap-y-3 pb-1 pt-2 sm:grid-cols-4">
            <Field id={id('warranty')} label="Part warranty" className="col-span-2">
              <input id={id('warranty')} className="form-input" placeholder="12 months or 12,000 miles" value={String(p.warranty || '')} readOnly={readOnly} onChange={e => onChange({ warranty: e.target.value })} />
            </Field>
            <Field id={id('status')} label="Part status" className="col-span-2">
              <select id={id('status')} className="form-select" value={String(p.status || 'Ordered')} disabled={readOnly} onChange={e => onChange({ status: e.target.value })}>
                {PART_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field id={id('cost')} label="Your cost (private)" hint="Never prints or sends." className="col-span-1 sm:col-span-2">
              <NumInput id={id('cost')} money value={(p.cost as number | string | undefined) ? (p.cost as number | string) : ''} placeholder="0.00" readOnly={readOnly} onChange={v => onChange({ cost: Number(v) })} />
            </Field>
            <Field id={id('core')} label="Core charge" hint="Refundable. Added to the total." className="col-span-1 sm:col-span-2">
              <NumInput id={id('core')} money value={(p.core as number | string | undefined) ? (p.core as number | string) : ''} placeholder="0.00" readOnly={readOnly} onChange={v => onChange({ core: Number(v) })} />
            </Field>
            {cost > 0 && price > 0 && (
              <p className="col-span-2 text-[0.9375rem] text-green sm:col-span-4 num">Profit on this line: {formatCurrency((price - cost) * quantityFromUnknown(p.qty))}</p>
            )}
          </div>
        )}
      </div>
    </LineShell>
  )
}

export function LaborCard({ index, labor: l, staff, readOnly, autoFocus, onChange, onRemove }: {
  index: number; labor: Line; staff: string[]; readOnly: boolean; autoFocus: boolean; onChange: (patch: Line) => void; onRemove: () => void
}) {
  const uid = useId()
  const id = (k: string) => `${uid}-${k}`
  const flat = getLaborFlatAmount(l) !== null
  const op = String(l.operation || '')
  const tech = String(l.tech || '')
  const techOptions = tech && !staff.includes(tech) ? [tech, ...staff] : staff
  return (
    <LineShell
      title={op ? `Labor ${index + 1}: ${op}` : `Labor ${index + 1}`}
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
            <select id={id('tech')} className="form-select" value={tech} disabled={readOnly} onChange={e => onChange({ tech: e.target.value })}>
              <option value="">No one yet</option>
              {techOptions.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
          ) : (
            <input id={id('tech')} className="form-input" value={tech} readOnly={readOnly} placeholder="Name" onChange={e => onChange({ tech: e.target.value })} />
          )}
        </Field>
        <Field id={id('hrs')} label={flat ? 'Pricing' : 'Hours'} className="col-span-2">
          {flat ? (
            <input id={id('hrs')} className="form-input" value="Flat price" readOnly />
          ) : (
            <NumInput id={id('hrs')} step="0.1" value={(l.hours as number | string | undefined) ?? 0} readOnly={readOnly} onChange={v => onChange({ hours: Number(v) })} />
          )}
        </Field>
        <Field id={id('rate')} label={flat ? 'Amount' : 'Rate per hour'} className="col-span-4 sm:col-span-2">
          <NumInput
            id={id('rate')}
            money
            value={flat ? Number(getLaborFlatAmount(l) || 0) : ((l.rate as number | string | undefined) ?? '')}
            readOnly={readOnly}
            onChange={v => onChange(flat ? { amount: Number(v), pricing: 'flat' } : { rate: Number(v) })}
          />
        </Field>
      </div>
    </LineShell>
  )
}
