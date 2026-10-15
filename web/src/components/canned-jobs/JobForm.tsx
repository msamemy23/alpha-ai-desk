'use client'
import type { Dispatch, SetStateAction } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { sentenceCase } from '@/components/ListKit'
import { Field, Section } from '@/components/forms/Field'
import FormActions from '@/components/forms/FormActions'
import FormError from '@/components/forms/FormError'
import { parseCount, parseMoney, roundCents } from '@/lib/list-logic'
import { money, newKey, totalOf } from './types'
import type { JobErrors, JobForm as Form, PartRow } from './types'

/** Add or change one canned job. Every box is text, so "0.5" and a cleared box act the way they look. */
export default function JobForm({
  form, setForm, rows, setRows, errors, categories, shopRate, saving, error, isNew,
  onSave, onCancel, onDuplicate, onDelete, onPick,
}: {
  form: Form
  setForm: Dispatch<SetStateAction<Form>>
  rows: PartRow[]
  setRows: Dispatch<SetStateAction<PartRow[]>>
  errors: JobErrors
  categories: string[]
  /** The shop's own labor rate, used when the rate box is left empty. */
  shopRate: number | null
  saving: boolean
  error: string
  isNew: boolean
  onSave: () => void
  onCancel: () => void
  onDuplicate?: () => void
  onDelete?: () => void
  onPick: () => void
}) {
  const set = (k: 'name' | 'description' | 'notes' | 'category' | 'labor_hours' | 'labor_rate') => (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: e.target.value }))
  const bad = (k: 'name' | 'labor_hours' | 'labor_rate') => (errors[k] ? { 'aria-invalid': true as const, 'aria-describedby': `cj-${k}-err` } : {})
  const t = totalOf(form, rows, shopRate)
  const rate = parseMoney(form.labor_rate)
  const differsFromShop = shopRate !== null && rate !== null && Math.abs(rate - shopRate) > 0.004

  const update = (key: string, patch: Partial<PartRow>) => setRows(rs => rs.map(r => r.key === key ? { ...r, ...patch } : r))
  const addRow = () => {
    const key = newKey()
    setRows(rs => [...rs, { key, name: '', part_number: '', cost: '', qty: '1' }])
    requestAnimationFrame(() => document.getElementById(`cj-pname-${key}`)?.focus())
  }

  return (
    <form className="space-y-5" onSubmit={e => { e.preventDefault(); onSave() }} noValidate>
      <section>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="cj-name" label="Job name (required)" error={errors.name} className="sm:col-span-2">
            <input id="cj-name" className="form-input" autoComplete="off" autoFocus={isNew} {...bad('name')} value={form.name} onChange={set('name')} placeholder="Full synthetic oil change" />
          </Field>
          <Field id="cj-category" label="Category">
            <select id="cj-category" className="form-select" value={form.category} onChange={set('category')}>
              {categories.map(c => <option key={c} value={c}>{sentenceCase(c)}</option>)}
            </select>
          </Field>
          <div className="flex items-end">
            <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-[0.9375rem] font-bold">
              <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--c-blue))]" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
              Show on estimates
            </label>
          </div>
          <Field id="cj-desc" label="What is included" className="sm:col-span-2" hint={form.active ? undefined : 'This job is hidden. It stays here, but Add a canned job on an estimate will not list it.'}>
            <textarea id="cj-desc" className="form-textarea" rows={2} value={form.description} onChange={set('description')} placeholder="Up to 5 quarts, new filter, fluid top-off" />
          </Field>
        </div>
      </section>

      <Section title="Labor">
        <div className="grid grid-cols-2 gap-4">
          <Field id="cj-labor_hours" label="Labor hours" error={errors.labor_hours}>
            <input id="cj-labor_hours" className="form-input num" inputMode="decimal" autoComplete="off" {...bad('labor_hours')} value={form.labor_hours} onChange={set('labor_hours')} placeholder="1.5" />
          </Field>
          <Field id="cj-labor_rate" label="Rate per hour ($)" error={errors.labor_rate}>
            <input id="cj-labor_rate" className="form-input num" inputMode="decimal" autoComplete="off" {...bad('labor_rate')} value={form.labor_rate} onChange={set('labor_rate')} placeholder={shopRate ? String(shopRate) : '0.00'} />
          </Field>
        </div>
        {shopRate !== null && (
          <p className="num mt-2 text-[0.875rem] text-text-secondary">
            {form.labor_rate.trim() === '' ? `Left empty, this job uses your shop rate of ${money(shopRate)} per hour.` : differsFromShop ? `Your shop rate is ${money(shopRate)} per hour.` : 'This is your shop rate.'}
            {differsFromShop && <button type="button" className="ml-2 inline-flex min-h-[44px] items-center font-bold text-blue underline underline-offset-2" onClick={() => setForm(f => ({ ...f, labor_rate: String(shopRate) }))}>Use shop rate</button>}
          </p>
        )}
      </Section>

      <Section title="Parts">
        <p className="mb-3 text-[0.875rem] text-text-secondary">Price each is what the customer is charged per part on the estimate, not what you pay.</p>
        {rows.length === 0 ? (
          <p className="text-text-secondary">No parts on this job. Add one below.</p>
        ) : (
          <ul className="space-y-3">
            {rows.map((r, i) => {
              const re = errors.rows[r.key] || {}
              const line = roundCents((parseMoney(r.cost) ?? 0) * Math.max(1, parseCount(r.qty) ?? 1))
              return (
                <li key={r.key} className="rounded-md border border-border bg-bg-base p-3">
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_6.5rem_4.5rem]">
                    <Field id={`cj-pname-${r.key}`} label="Part name" error={re.name} className="col-span-2 sm:col-span-1">
                      <input id={`cj-pname-${r.key}`} className="form-input" autoComplete="off" aria-invalid={re.name ? true : undefined} aria-describedby={re.name ? `cj-pname-${r.key}-err` : undefined} value={r.name} onChange={e => update(r.key, { name: e.target.value })} />
                    </Field>
                    <Field id={`cj-pnum-${r.key}`} label="Part number" className="col-span-2 sm:col-span-1">
                      <input id={`cj-pnum-${r.key}`} className="form-input" autoComplete="off" autoCapitalize="characters" value={r.part_number} onChange={e => update(r.key, { part_number: e.target.value })} />
                    </Field>
                    <Field id={`cj-pcost-${r.key}`} label="Price each" error={re.cost}>
                      <input id={`cj-pcost-${r.key}`} className="form-input num" inputMode="decimal" autoComplete="off" placeholder="0.00" aria-invalid={re.cost ? true : undefined} aria-describedby={re.cost ? `cj-pcost-${r.key}-err` : undefined} value={r.cost} onChange={e => update(r.key, { cost: e.target.value })} />
                    </Field>
                    <Field id={`cj-pqty-${r.key}`} label="Qty" error={re.qty}>
                      <input id={`cj-pqty-${r.key}`} className="form-input num" inputMode="numeric" autoComplete="off" aria-invalid={re.qty ? true : undefined} aria-describedby={re.qty ? `cj-pqty-${r.key}-err` : undefined} value={r.qty} onChange={e => update(r.key, { qty: e.target.value })} />
                    </Field>
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="num text-[0.9375rem] text-text-secondary">Line total <span className="font-bold text-text-primary">{money(line)}</span></span>
                    <button type="button" className="btn btn-ghost text-red" onClick={() => setRows(rs => rs.filter(x => x.key !== r.key))} aria-label={`Remove part ${r.name.trim() || i + 1}`}>
                      <Icon name="trash" className="h-5 w-5" />Remove
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <button type="button" className="btn btn-secondary" onClick={onPick}><Icon name="box" className="h-5 w-5" />Add from inventory</button>
          <button type="button" className="btn btn-secondary" onClick={addRow}><Icon name="plus" className="h-5 w-5" />Add a part by hand</button>
        </div>
      </Section>

      <section className="rounded-md border border-border bg-text-primary/[0.04] p-4">
        <dl className="space-y-1 text-[0.9375rem]">
          <div className="flex justify-between gap-3"><dt className="text-text-secondary">Labor</dt><dd className="num">{money(t.labor)}</dd></div>
          <div className="flex justify-between gap-3"><dt className="text-text-secondary">Parts</dt><dd className="num">{money(t.parts)}</dd></div>
          <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2">
            <dt className="font-bold">Price before tax</dt>
            <dd className="display num text-[1.5rem] font-bold" aria-live="polite">{money(t.total)}</dd>
          </div>
        </dl>
      </section>
      {t.total === 0 && form.name.trim() && <Notice kind="warn">This job adds up to $0.00. Add labor hours or a part price if that is not what you want.</Notice>}

      <Field id="cj-notes" label="Notes and warranty">
        <textarea id="cj-notes" className="form-textarea" rows={2} value={form.notes} onChange={set('notes')} placeholder="Warranty terms, what is not covered" />
      </Field>

      {error && <FormError>{error}</FormError>}

      <FormActions>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save canned job'}</button>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        {onDuplicate && <button type="button" className="btn btn-secondary" onClick={onDuplicate} disabled={saving}><Icon name="copy" className="h-5 w-5" />Duplicate</button>}
        {onDelete && <button type="button" className="btn btn-danger ml-auto" onClick={onDelete} disabled={saving}><Icon name="trash" className="h-5 w-5" />Delete</button>}
      </FormActions>
    </form>
  )
}
