'use client'
import type { Dispatch, SetStateAction } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { sentenceCase } from '@/components/ListKit'
import { marginOf, parseCount, parseMoney, roundCents } from '@/lib/list-logic'
import { Field, Section } from '@/components/forms/Field'
import FormActions from '@/components/forms/FormActions'
import FormError from '@/components/forms/FormError'
import { ADJUST_REASONS } from '@/lib/inventory-logic'
import type { Vendor } from '@/lib/inventory-logic'
import { money } from './types'
import type { Part, PartErrors, PartForm } from './types'

const lastOrdered = (v: string) => {
  const d = new Date(v)
  return Number.isFinite(d.getTime()) ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''
}

/** Add or change one part. Every box is text, so typing "0.50" or clearing a box behaves the way it looks. */
export default function PartFormFields({
  form, setForm, errors, original, categories, duplicate, saving, error, onSave, onCancel, onDelete, countReason, onCountReason, onHistory, extrasStatus, vendors, barcodeOwner,
}: {
  form: PartForm
  setForm: Dispatch<SetStateAction<PartForm>>
  errors: PartErrors
  /** The saved part when editing; null when adding. */
  original: Part | null
  categories: string[]
  /** Another part with the same part number, if there is one. */
  duplicate: Part | null
  saving: boolean
  error: string
  onSave: () => void
  onCancel: () => void
  onDelete?: () => void
  /** Why the on-hand number was changed, written to the part's history. Asked only when it was changed. */
  countReason: string
  onCountReason: (reason: string) => void
  /** Opens who changed this part's numbers. Only for a part that is already saved. */
  onHistory?: () => void
  /** Whether the barcode and ordering details can be shown: still loading, ready, or not available on this database yet. */
  extrasStatus: 'loading' | 'ready' | 'unavailable'
  /** Vendors to pick a preferred one from. */
  vendors: Vendor[]
  /** Another part that already carries the barcode typed, if there is one. */
  barcodeOwner: Part | null
}) {
  const set = (k: keyof PartForm) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [k]: e.target.value }))
  const inv = (k: keyof PartErrors) => (errors[k] ? { 'aria-invalid': true as const, 'aria-describedby': `inv-${k}-err` } : {})
  const cost = parseMoney(form.cost)
  const retail = parseMoney(form.retail_price)
  const m = marginOf(form.cost, form.retail_price)
  const onOrder = parseCount(form.qty_on_order) ?? 0
  const underCost = cost !== null && retail !== null && retail > 0 && cost > retail

  const receive = () => {
    const have = parseCount(form.qty_on_hand) ?? 0
    setForm(f => ({ ...f, qty_on_hand: String(have + onOrder), qty_on_order: '0' }))
    onCountReason('received')
  }
  const countChanged = !!original && (parseCount(form.qty_on_hand) ?? 0) !== (original.qty_on_hand ?? 0)

  return (
    <form className="space-y-5" onSubmit={e => { e.preventDefault(); onSave() }} noValidate>
      <section>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="inv-name" label="Part name (required)" error={errors.name} className="sm:col-span-2">
            <input id="inv-name" className="form-input" autoFocus={!original} autoComplete="off" {...inv('name')} value={form.name} onChange={set('name')} placeholder="Oil filter" />
          </Field>
          <Field id="inv-pn" label="Part number" hint={duplicate ? `Heads up: ${duplicate.name}${duplicate.brand ? ` (${duplicate.brand})` : ''} already has this part number.` : undefined}>
            <input id="inv-pn" className="form-input" autoComplete="off" autoCapitalize="characters" value={form.part_number} onChange={set('part_number')} placeholder="MO-301" />
          </Field>
          <Field id="inv-brand" label="Brand">
            <input id="inv-brand" className="form-input" autoComplete="off" value={form.brand} onChange={set('brand')} placeholder="Motorcraft, OEM" />
          </Field>
          <Field id="inv-category" label="Category">
            <select id="inv-category" className="form-select" value={form.category} onChange={set('category')}>
              <option value="">Choose a category</option>
              {categories.map(c => <option key={c} value={c}>{sentenceCase(c)}</option>)}
            </select>
          </Field>
          <Field id="inv-loc" label="Storage location">
            <input id="inv-loc" className="form-input" autoComplete="off" value={form.location} onChange={set('location')} placeholder="Shelf A3, bin 12" />
          </Field>
          <Field id="inv-desc" label="Description" className="sm:col-span-2">
            <textarea id="inv-desc" className="form-textarea" rows={2} value={form.description} onChange={set('description')} />
          </Field>
        </div>
      </section>

      <Section title="Pricing">
        <div className="grid grid-cols-2 gap-4">
          <Field id="inv-cost" label="Your cost" error={errors.cost}>
            <input id="inv-cost" className="form-input num" inputMode="decimal" autoComplete="off" {...inv('cost')} value={form.cost} onChange={set('cost')} placeholder="0.00" />
          </Field>
          <Field id="inv-retail_price" label="Retail price" error={errors.retail_price}>
            <input id="inv-retail_price" className="form-input num" inputMode="decimal" autoComplete="off" {...inv('retail_price')} value={form.retail_price} onChange={set('retail_price')} placeholder="0.00" />
          </Field>
        </div>
        <p className="form-hint !text-[0.875rem] !text-text-secondary">Your cost is what you pay. Retail is what you charge.</p>
        {m.marginPct !== null && !underCost && (
          <p className="num mt-2 text-[0.9375rem] text-text-secondary" aria-live="polite">
            Margin <span className="font-bold text-text-primary">{m.marginPct % 1 === 0 ? m.marginPct.toFixed(0) : m.marginPct.toFixed(1)}%</span>, {money(m.profit)} profit on each.
          </p>
        )}
        {underCost && (
          <Notice kind="warn" className="mt-2">
            <span className="num">Retail is {money(roundCents((cost ?? 0) - (retail ?? 0)))} below your cost, so each one loses money.</span> Check both prices.
          </Notice>
        )}
      </Section>

      <Section title="Stock">
        <div className="grid grid-cols-3 gap-3">
          <Field id="inv-qty_on_hand" label="On hand" error={errors.qty_on_hand}>
            <input id="inv-qty_on_hand" className="form-input num" inputMode="numeric" autoComplete="off" {...inv('qty_on_hand')} value={form.qty_on_hand} onChange={set('qty_on_hand')} />
          </Field>
          <Field id="inv-qty_reorder" label="Reorder at" error={errors.qty_reorder}>
            <input id="inv-qty_reorder" className="form-input num" inputMode="numeric" autoComplete="off" {...inv('qty_reorder')} value={form.qty_reorder} onChange={set('qty_reorder')} />
          </Field>
          <Field id="inv-qty_on_order" label="On order" error={errors.qty_on_order}>
            <input id="inv-qty_on_order" className="form-input num" inputMode="numeric" autoComplete="off" {...inv('qty_on_order')} value={form.qty_on_order} onChange={set('qty_on_order')} />
          </Field>
        </div>
        <p className="form-hint !text-[0.875rem] !text-text-secondary">The part shows as low stock when the amount on hand drops to the reorder number or below. Leave it at 0 to skip the warning.</p>
        {countChanged && (
          <Field id="inv-reason" label={`Why did the count change from ${original?.qty_on_hand ?? 0} to ${parseCount(form.qty_on_hand) ?? 0}?`} hint="This goes in the part's history with your name." className="mt-3">
            <select id="inv-reason" className="form-select" value={countReason} onChange={e => onCountReason(e.target.value)}>
              {ADJUST_REASONS.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </Field>
        )}
        {onOrder > 0 && (
          <button type="button" className="btn btn-secondary mt-3" onClick={receive}>
            <Icon name="box" className="h-5 w-5" />Order arrived: add <span className="num">{onOrder}</span> to on hand
          </button>
        )}
        {original?.last_ordered && lastOrdered(original.last_ordered) && <p className="form-hint !text-[0.875rem] !text-text-secondary">Last ordered {lastOrdered(original.last_ordered)}.</p>}
      </Section>

      <Section title="Supplier">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="inv-supplier" label="Supplier">
            <input id="inv-supplier" className="form-input" autoComplete="off" value={form.supplier} onChange={set('supplier')} placeholder="Your parts store or distributor" />
          </Field>
          <Field id="inv-spn" label="Supplier part number">
            <input id="inv-spn" className="form-input" autoComplete="off" autoCapitalize="characters" value={form.supplier_part_number} onChange={set('supplier_part_number')} />
          </Field>
          <Field id="inv-notes" label="Notes" className="sm:col-span-2">
            <textarea id="inv-notes" className="form-textarea" rows={2} value={form.notes} onChange={set('notes')} placeholder="Fitment, substitutions, who to call" />
          </Field>
        </div>
      </Section>

      <Section title="Barcode and ordering">
        {extrasStatus === 'loading' && <p className="text-[0.9375rem] text-text-secondary" role="status">Loading barcode and ordering details…</p>}
        {extrasStatus === 'unavailable' && (
          <Notice kind="info">Barcodes and ordering details are not available right now, so they are left out here. Everything else on this part still saves.</Notice>
        )}
        {extrasStatus === 'ready' && (<>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="inv-barcode" label="Barcode" error={errors.barcode} hint={barcodeOwner ? `Heads up: ${barcodeOwner.name} already has this barcode.` : 'Scan the label with a USB or Bluetooth scanner, or type the numbers under the bars. Scanning it into Search later finds this part.'} className="sm:col-span-2">
              <input
                id="inv-barcode" className="form-input num" inputMode="numeric" autoComplete="off" autoCapitalize="characters" {...inv('barcode')} value={form.barcode} onChange={set('barcode')}
                onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }} placeholder="Scan or type"
              />
            </Field>
            <Field id="inv-max_qty" label="Order up to" error={errors.max_qty} hint="When this runs low, Alpha suggests enough to get back up to this many. Blank uses twice the reorder number.">
              <input id="inv-max_qty" className="form-input num" inputMode="numeric" autoComplete="off" {...inv('max_qty')} value={form.max_qty} onChange={set('max_qty')} placeholder="12" />
            </Field>
            <Field id="inv-order_multiple" label="Case size" error={errors.order_multiple} hint="If the vendor sells by the case, orders go up in this many at a time.">
              <input id="inv-order_multiple" className="form-input num" inputMode="numeric" autoComplete="off" {...inv('order_multiple')} value={form.order_multiple} onChange={set('order_multiple')} placeholder="6" />
            </Field>
            <Field id="inv-core_charge" label="Core charge" error={errors.core_charge} hint="A deposit the vendor adds on each one and credits back when you return the old part.">
              <input id="inv-core_charge" className="form-input num" inputMode="decimal" autoComplete="off" {...inv('core_charge')} value={form.core_charge} onChange={set('core_charge')} placeholder="0.00" />
            </Field>
            <Field id="inv-vendor" label="Preferred vendor" hint="New orders for this part start with this vendor.">
              <select id="inv-vendor" className="form-select" value={form.preferred_vendor_id} onChange={set('preferred_vendor_id')}>
                <option value="">No preference</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}{v.active ? '' : ' (not used anymore)'}</option>)}
              </select>
            </Field>
          </div>
        </>)}
      </Section>

      {error && <FormError>{error}</FormError>}

      <FormActions>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save part'}</button>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        {onHistory && <button type="button" className="btn btn-ghost" onClick={onHistory} disabled={saving}><Icon name="clock" className="h-5 w-5" />Who changed the numbers</button>}
        {onDelete && <button type="button" className="btn btn-danger ml-auto" onClick={onDelete} disabled={saving}><Icon name="trash" className="h-5 w-5" />Delete</button>}
      </FormActions>
    </form>
  )
}
