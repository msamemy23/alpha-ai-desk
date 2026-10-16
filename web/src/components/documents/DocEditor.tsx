'use client'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { formatCurrency } from '@/lib/supabase'
import { docLamp, docStatusLabel } from '@/lib/doc-status'
import { discountSummary } from '@/lib/doc-pricing'
import { jobNames } from '@/lib/doc-lines'
import Icon from '@/components/Icon'
import { Field, NumInput, PartCard, LaborCard } from './LineCards'
import { useViewportFit } from './useViewportFit'
import { docWord, fmtDate, isLocked } from './types'
import type { Doc, DocType, Line, Notice, Totals } from './types'

const statusesFor = (type: string) =>
  type === 'Receipt' ? ['Draft', 'Paid'] : type === 'Invoice' ? ['Draft', 'Sent', 'Unpaid', 'Partial', 'Paid'] : ['Draft', 'Sent', 'Approved', 'Paid']

const NO_WARRANTY_DETAILS = ['No Warranty', 'State Inspection — No Warranty']

export interface EditorProps {
  type: DocType
  isNew: boolean
  form: Partial<Doc>
  setForm: React.Dispatch<React.SetStateAction<Partial<Doc>>>
  totals: Totals
  dirty: boolean
  saving: boolean
  notice: Notice | null
  onClearNotice: () => void
  showUndo: (label: string, restore: () => void) => void
  staff: string[]
  signatureImg: string | null
  /** The customer-approval card for an estimate (when it was sent and looked at, and the signed record). */
  approvalPanel?: ReactNode
  /** For invoices and receipts: what the customer did with the link, in one line. */
  linkNote?: string
  warrantyLabels: string[]
  onBack: () => void
  onSave: () => void
  onPickCustomer: () => void
  onSend: () => void
  onSign: () => void
  onPay: () => void
  onPlan: () => void
  onConvert: () => void
  onApprove: () => void
  onPreview: () => void
  onMore: () => void
  onWarrantyPreset: (label: string) => void
  onSuggestWarranty: () => void
  /** What a new labor line charges per hour (from the shop's settings). */
  laborRate: number
  /** Opens the canned job picker. Left out when the shop has none. */
  onAddCanned?: () => void
  /** Brings a voided document back. Offered only while the document is void. */
  onRestore?: () => void
  /**
   * The shop's suggested selling price for a part cost, from its markup rules. Left out unless the shop turned the rules on in
   * Settings. It only adds a "Use it" button beside a part that has a cost; it never changes a price by itself.
   */
  suggestPrice?: (cost: number) => number | null
  /** Opens the saved templates. Shown only while the lines can still change. */
  onTemplates?: () => void
  /** Opens the whole-document discount. Shown only while the lines can still change. */
  onDiscount?: () => void
  /** Opens the fee and outside-work form. Shown only while the lines can still change. */
  onAddFee?: () => void
}

export default function DocEditor(p: EditorProps) {
  const { type, isNew, form, setForm, totals, dirty, saving, notice, staff } = p
  const rootRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const keyboardOpen = useViewportFit(rootRef, true)
  const [justAdded, setJustAdded] = useState<{ kind: 'part' | 'labor'; index: number } | null>(null)

  useEffect(() => { titleRef.current?.focus({ preventScroll: true }) }, [])
  useEffect(() => {
    if (!notice || notice.kind !== 'ok' || notice.undo) return
    const t = setTimeout(p.onClearNotice, 3500)
    return () => clearTimeout(t)
  }, [notice, p.onClearNotice])

  const docType = String(form.type || type)
  const noun = docWord(docType)
  const isEstimate = docType === 'Estimate'
  const status = String(form.status || 'Draft')
  const locked = isLocked(status)
  // A voided document stays on record but is not active: its lines and totals are read only until it is restored.
  const closed = status === 'Void'
  const frozen = locked || closed
  const lamp = docLamp(docType, status)
  const parts = (form.parts || []) as Line[]
  const labors = (form.labors || []) as Line[]
  const owed = Math.max(0, totals.balanceDue)
  const savedOff = frozen ? 0 : discountSummary(form as Record<string, unknown>).total
  // Without the shop's markup rules the part cards get nothing extra, exactly as before.
  const partTools = p.suggestPrice && !frozen ? { jobNames: jobNames(form as Record<string, unknown>), suggestPrice: p.suggestPrice } : undefined
  const customerName = String(form.customer_name || '')
  const sf = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))
  const rec = form as Record<string, string | undefined>

  const updatePart = (i: number, patch: Line) => setForm(f => { const next = [...((f.parts || []) as Line[])]; next[i] = { ...next[i], ...patch }; return { ...f, parts: next } })
  const updateLabor = (i: number, patch: Line) => setForm(f => { const next = [...((f.labors || []) as Line[])]; next[i] = { ...next[i], ...patch }; return { ...f, labors: next } })
  const removePart = (i: number) => {
    const line = parts[i]
    setForm(f => ({ ...f, parts: ((f.parts || []) as Line[]).filter((_, j) => j !== i) }))
    p.showUndo('Part removed.', () => setForm(f => { const next = [...((f.parts || []) as Line[])]; next.splice(i, 0, line); return { ...f, parts: next } }))
  }
  const removeLabor = (i: number) => {
    const line = labors[i]
    setForm(f => ({ ...f, labors: ((f.labors || []) as Line[]).filter((_, j) => j !== i) }))
    p.showUndo('Labor removed.', () => setForm(f => { const next = [...((f.labors || []) as Line[])]; next.splice(i, 0, line); return { ...f, labors: next } }))
  }
  const addPart = () => {
    setJustAdded({ kind: 'part', index: parts.length })
    setForm(f => ({ ...f, parts: [...((f.parts || []) as Line[]), { name: '', brand: '', qty: 1, unitPrice: 0, taxable: true, status: 'Ordered' }] }))
  }
  const addLabor = () => {
    setJustAdded({ kind: 'labor', index: labors.length })
    setForm(f => ({ ...f, labors: [...((f.labors || []) as Line[]), { operation: '', tech: '', hours: 0, rate: p.laborRate }] }))
  }

  /* ---------- the one next step, in plain words ---------- */
  const who = customerName || 'the customer'
  type Step = { title: string; body: string; lamp: string; buttons: { label: string; icon: string; onClick: () => void; primary?: boolean }[] }
  const step: Step = (() => {
    if (isNew) return { title: `New ${noun}`, body: 'Choose the customer, add parts and labor, then save. You can send it right after.', lamp: 'off', buttons: [] }
    if (closed) return { title: 'Voided', body: `This ${noun} stays on record but is not active. Restore it to work on it, send it or take a payment.`, lamp: 'off', buttons: p.onRestore ? [{ label: `Restore ${noun}`, icon: 'undo', onClick: p.onRestore, primary: true }] : [] }
    if (isEstimate) {
      if (status === 'Draft') return { title: 'Not sent yet', body: `Send it to ${who} so they can approve the work.`, lamp: 'off', buttons: [
        { label: 'Send estimate', icon: 'send', onClick: p.onSend, primary: true },
      ] }
      if (status === 'Sent') return { title: 'Waiting on customer', body: form.signature_signed_at ? `Signed by ${form.signature_signer_name || who}.` : `Sent to ${who}. You will see here when they look at it and what they answer. If they say yes in person, mark it approved.`, lamp: 'blue', buttons: [
        { label: 'Send again', icon: 'send', onClick: p.onSend, primary: true },
        { label: 'They said yes in person', icon: 'check', onClick: p.onApprove },
      ] }
      if (status === 'Approved') return { title: 'Approved', body: form.signature_signed_at ? `Signed by ${form.signature_signer_name || who}. Ready to turn into an invoice.` : 'Ready to turn into an invoice.', lamp: 'green', buttons: [
        { label: 'Convert to invoice', icon: 'invoice', onClick: p.onConvert, primary: true },
        { label: 'Send again', icon: 'send', onClick: p.onSend },
      ] }
      return { title: docStatusLabel(docType, status), body: '', lamp, buttons: [] }
    }
    if (status === 'Paid') return { title: 'Paid in full', body: 'Nothing more to collect.', lamp: 'green', buttons: [{ label: 'Send again', icon: 'send', onClick: p.onSend }] }
    if (status === 'Draft') return { title: 'Not sent yet', body: `Send it to ${who}, or record a payment if they already paid.`, lamp: 'off', buttons: [
      { label: 'Send invoice', icon: 'send', onClick: p.onSend, primary: true },
      ...(owed > 0 ? [{ label: 'Record payment', icon: 'dollar', onClick: p.onPay }] : []),
    ] }
    return { title: status === 'Partial' ? `Part paid, ${formatCurrency(owed)} due` : `Unpaid, ${formatCurrency(owed)} due`, body: status === 'Partial' ? `${formatCurrency(totals.amountPaid)} received so far.` : `${who} owes this amount.`, lamp: status === 'Partial' ? 'amber' : 'red', buttons: [
      ...(owed > 0 ? [{ label: 'Record payment', icon: 'dollar', onClick: p.onPay, primary: true }] : []),
      { label: 'Send again', icon: 'send', onClick: p.onSend },
    ] }
  })()

  const barLabel = isEstimate ? 'Total' : status === 'Paid' ? 'Paid in full' : ['Sent', 'Unpaid', 'Partial'].includes(status) ? 'Balance due' : 'Total'
  const barAmount = !isEstimate && ['Sent', 'Unpaid', 'Partial'].includes(status) ? owed : totals.total
  const saveLabel = saving ? 'Saving…' : isNew ? `Save ${noun}` : dirty ? 'Save changes' : 'Saved'

  const sectionTitle = 'section-title'
  const showWarrantyDetails = !!form.warranty_type && !NO_WARRANTY_DETAILS.includes(String(form.warranty_type))
  const plan = form.payment_plan

  return (
    <div
      ref={rootRef}
      className="fixed inset-x-0 top-[var(--vv-top,0px)] z-50 flex h-[var(--vv-h,100dvh)] flex-col bg-bg-base text-text-primary lg:static lg:top-auto lg:z-auto lg:block lg:h-auto"
    >
      {/* ---------- Header ---------- */}
      <header className="shrink-0 border-b border-border bg-bg-chrome pt-[env(safe-area-inset-top)] lg:sticky lg:top-0 lg:z-10 lg:bg-bg-base">
        <div className="mx-auto flex min-h-[3.5rem] max-w-[1180px] items-center gap-1 px-2 sm:px-5 lg:px-8 lg:py-2">
          <button type="button" className="btn-icon shrink-0" onClick={p.onBack} aria-label={`Back to ${type.toLowerCase()}s`}>
            <Icon name="chevronLeft" className="h-6 w-6" />
          </button>
          <div className="min-w-0 flex-1 px-1">
            <h1 ref={titleRef} tabIndex={-1} className="display num truncate text-[1.125rem] font-bold leading-tight outline-none lg:text-[1.5rem]">
              {isNew ? `New ${noun}` : form.doc_number || `${docType[0]}${docType.slice(1).toLowerCase()}`}
            </h1>
            <p className="flex min-w-0 items-center gap-2 text-[0.875rem] text-text-secondary">
              <span className={`lamp lamp-${lamp}`} aria-hidden="true" />
              <span className="truncate">
                {isNew ? `Not saved yet · ${form.doc_number || ''}` : docStatusLabel(docType, status)}
                {!isNew && dirty ? ' · Unsaved changes' : ''}
              </span>
            </p>
          </div>
          <button type="button" className="btn-icon shrink-0" onClick={p.onPreview} aria-label="Preview and print">
            <Icon name="print" className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* ---------- Body ---------- */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain lg:overflow-visible">
        <div className="mx-auto max-w-[1180px] px-4 pb-8 pt-4 sm:px-5 lg:px-8 lg:pb-10 lg:pt-5">
          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_23rem] xl:gap-x-8">
            {/* Next step */}
            <div className="min-w-0 space-y-3 xl:col-start-1">
              <div className={`rotag ${step.lamp === 'off' ? '' : `lamp-${step.lamp}`}`}>
                <h2 className="display text-[1.125rem] font-bold leading-6">{step.title}</h2>
                {step.body && <p className="mt-0.5 text-[0.9375rem] text-text-secondary">{step.body}</p>}
                {step.buttons.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {step.buttons.map(b => (
                      <button key={b.label} type="button" className={`btn ${b.primary ? 'btn-primary' : 'btn-secondary'}`} onClick={b.onClick}>
                        <Icon name={b.icon} className="h-5 w-5" />
                        {b.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {locked && (
                <p className="flex items-start gap-2 text-[0.9375rem] text-text-secondary">
                  <Icon name="lock" className="mt-0.5 h-5 w-5 shrink-0" />
                  A payment is recorded, so the lines, tax and totals are locked. You can still change the customer, notes and warranty.
                </p>
              )}
              {closed && (
                <p className="flex items-start gap-2 text-[0.9375rem] text-text-secondary">
                  <Icon name="lock" className="mt-0.5 h-5 w-5 shrink-0" />
                  This {noun} is voided, so the lines, tax and totals are read only. Restore it to change them.
                </p>
              )}
            </div>

            {/* Details */}
            <section aria-labelledby="sec-details" className="card min-w-0 xl:col-start-1">
              <h2 id="sec-details" className={`${sectionTitle} mb-3`}>{isEstimate ? 'Estimate' : docType} details</h2>
              <div className="grid grid-cols-2 gap-3">
                <Field id="f-date" label="Date">
                  <input id="f-date" className="form-input" type="date" value={form.doc_date || ''} onChange={sf('doc_date')} />
                </Field>
                <Field id="f-status" label="Status" hint={locked ? 'Changes with payments.' : closed ? 'Use Restore to bring it back.' : undefined}>
                  <select id="f-status" className="form-select" value={status} onChange={sf('status')} disabled={frozen}>
                    {(closed ? ['Void'] : statusesFor(type)
                      .filter(s => (['Paid', 'Partial'].includes(status) ? s === status : !['Paid', 'Partial'].includes(s))))
                      .map(s => <option key={s} value={s}>{docStatusLabel(docType, s)}</option>)}
                  </select>
                </Field>
              </div>
            </section>

            {/* Customer and vehicle */}
            <section aria-labelledby="sec-customer" className="card min-w-0 xl:col-start-1">
              <h2 id="sec-customer" className={`${sectionTitle} mb-3`}>Customer and vehicle</h2>
              <button
                type="button"
                onClick={p.onPickCustomer}
                className="flex min-h-[60px] w-full items-center gap-3 rounded-md border border-line bg-bg-input px-3 text-left hover:bg-bg-hover"
              >
                <Icon name="user" className="h-5 w-5 shrink-0 text-text-secondary" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.8125rem] font-bold text-text-secondary">Customer</span>
                  <span className={`block truncate font-bold ${customerName ? '' : 'text-text-secondary'}`}>{customerName || 'Choose a customer'}</span>
                </span>
                <span className="shrink-0 font-bold text-blue">{customerName ? 'Change' : 'Choose'}</span>
              </button>
              <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field id="f-phone" label="Customer phone">
                  <input id="f-phone" className="form-input" type="tel" inputMode="tel" autoComplete="off" value={rec.customer_phone || ''} onChange={sf('customer_phone')} placeholder="(555) 123-4567" />
                </Field>
                <Field id="f-email" label="Customer email">
                  <input id="f-email" className="form-input" type="email" inputMode="email" autoComplete="off" value={rec.customer_email || ''} onChange={sf('customer_email')} placeholder="name@example.com" />
                </Field>
              </div>
              <div className="mt-4 grid grid-cols-6 gap-3 sm:grid-cols-12">
                <Field id="f-year" label="Year" className="col-span-2 sm:col-span-2">
                  <input id="f-year" className="form-input num" inputMode="numeric" value={rec.vehicle_year || ''} onChange={sf('vehicle_year')} />
                </Field>
                <Field id="f-make" label="Make" className="col-span-4 sm:col-span-4">
                  <input id="f-make" className="form-input" value={rec.vehicle_make || ''} onChange={sf('vehicle_make')} />
                </Field>
                <Field id="f-model" label="Model" className="col-span-6 sm:col-span-6">
                  <input id="f-model" className="form-input" value={rec.vehicle_model || ''} onChange={sf('vehicle_model')} />
                </Field>
                <Field id="f-miles" label="Mileage" className="col-span-3 sm:col-span-3">
                  <input id="f-miles" className="form-input num" inputMode="numeric" value={rec.vehicle_mileage || ''} onChange={sf('vehicle_mileage')} />
                </Field>
                <Field id="f-plate" label="Plate" className="col-span-3 sm:col-span-3">
                  <input id="f-plate" className="form-input" autoCapitalize="characters" spellCheck={false} value={rec.vehicle_plate || ''} onChange={sf('vehicle_plate')} />
                </Field>
                <Field id="f-vin" label="VIN" className="col-span-6 sm:col-span-6">
                  <input id="f-vin" className="form-input" autoCapitalize="characters" spellCheck={false} value={rec.vehicle_vin || ''} onChange={sf('vehicle_vin')} />
                </Field>
              </div>
            </section>

            {/* Canned job */}
            {!frozen && (p.onAddCanned || p.onTemplates) && (
              <div className="min-w-0 xl:col-start-1">
                <div className="flex flex-col gap-2 sm:flex-row">
                  {p.onAddCanned && (
                    <button type="button" className="btn btn-secondary w-full justify-center sm:w-auto" onClick={p.onAddCanned}>
                      <Icon name="list" className="h-5 w-5" />
                      Add a canned job
                    </button>
                  )}
                  {p.onTemplates && (
                    <button type="button" className="btn btn-secondary w-full justify-center sm:w-auto" onClick={p.onTemplates}>
                      <Icon name="copy" className="h-5 w-5" />
                      Start from a template
                    </button>
                  )}
                </div>
                <p className="mt-1 text-[0.8125rem] text-text-secondary">{p.onTemplates ? 'Start from a saved job or a saved template.' : 'Start from a saved job.'} Its labor and parts are added below, and you can change them.</p>
              </div>
            )}

            {/* Parts */}
            <section aria-labelledby="sec-parts" className="min-w-0 xl:col-start-1">
              <div className="mb-2 flex items-end justify-between gap-3">
                <h2 id="sec-parts" className={sectionTitle}>Parts</h2>
                <span className="num text-[0.9375rem] text-text-secondary">{parts.length} {parts.length === 1 ? 'line' : 'lines'}, {formatCurrency(totals.partsTotal)}</span>
              </div>
              {parts.length === 0 && <p className="mb-3 rounded-lg border border-dashed border-border px-4 py-5 text-center text-[0.9375rem] text-text-secondary">No parts on this {noun}.{frozen ? '' : ' Add the parts you will use.'}</p>}
              <ul className="space-y-3">
                {parts.map((line, i) => (
                  <PartCard key={i} index={i} part={line} readOnly={frozen} autoFocus={justAdded?.kind === 'part' && justAdded.index === i} tools={partTools} onChange={patch => updatePart(i, patch)} onRemove={() => removePart(i)} />
                ))}
              </ul>
              {!frozen && (
                <button type="button" className="btn btn-secondary mt-3 w-full sm:w-auto" onClick={addPart}>
                  <Icon name="plus" className="h-5 w-5" />
                  Add part
                </button>
              )}
            </section>

            {/* Labor */}
            <section aria-labelledby="sec-labor" className="min-w-0 xl:col-start-1">
              <div className="mb-2 flex items-end justify-between gap-3">
                <h2 id="sec-labor" className={sectionTitle}>Labor</h2>
                <span className="num text-[0.9375rem] text-text-secondary">{labors.length} {labors.length === 1 ? 'line' : 'lines'}, {formatCurrency(totals.laborTotal)}</span>
              </div>
              {labors.length === 0 && <p className="mb-3 rounded-lg border border-dashed border-border px-4 py-5 text-center text-[0.9375rem] text-text-secondary">No labor on this {noun}.{frozen ? '' : ' Add the work to be done.'}</p>}
              <ul className="space-y-3">
                {labors.map((line, i) => (
                  <LaborCard key={i} index={i} labor={line} staff={staff} readOnly={frozen} autoFocus={justAdded?.kind === 'labor' && justAdded.index === i} onChange={patch => updateLabor(i, patch)} onRemove={() => removeLabor(i)} />
                ))}
              </ul>
              {!frozen && (
                <button type="button" className="btn btn-secondary mt-3 w-full sm:w-auto" onClick={addLabor}>
                  <Icon name="plus" className="h-5 w-5" />
                  Add labor
                </button>
              )}
            </section>

            {/* Totals and payment: after Labor on phones, the right column on wide screens */}
            <div className="min-w-0 space-y-5 xl:sticky xl:top-[5.25rem] xl:col-start-2 xl:row-span-6 xl:row-start-1 xl:self-start">
              <section aria-labelledby="sec-totals" className="card">
                <h2 id="sec-totals" className={`${sectionTitle} mb-3`}>Totals</h2>
                <div className="grid grid-cols-2 gap-x-3 gap-y-3">
                  <Field id="f-supplies" label="Shop supplies">
                    <NumInput id="f-supplies" money value={form.shop_supplies || 0} readOnly={frozen} onChange={v => setForm(f => ({ ...f, shop_supplies: v as unknown as number }))} />
                  </Field>
                  <Field id="f-taxrate" label="Tax rate (%)">
                    <NumInput id="f-taxrate" value={(form.tax_rate as number) ?? 0} readOnly={frozen} onChange={v => setForm(f => ({ ...f, tax_rate: v as unknown as number }))} />
                  </Field>
                  <label className="col-span-2 flex min-h-[44px] cursor-pointer items-center gap-2.5 text-[0.9375rem]">
                    <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--c-blue))]" checked={form.apply_tax !== false} disabled={frozen} onChange={e => setForm(f => ({ ...f, apply_tax: e.target.checked }))} />
                    Charge sales tax on parts and supplies
                  </label>
                  <Field id="f-deposit" label="Deposit shown on the printout" hint="Printed on the document. To take money, use Record payment." className="col-span-2">
                    <NumInput id="f-deposit" money value={form.deposit || 0} readOnly={frozen} onChange={v => setForm(f => ({ ...f, deposit: v as unknown as number }))} />
                  </Field>
                </div>

                {/* Changes prices, so it is offered only while the lines can still change (never when paid, part paid or void). */}
                {!frozen && (p.onDiscount || p.onAddFee) && (
                  <div className="mt-4 border-t border-border pt-3">
                    <h3 className="text-[0.9375rem] font-bold">Discount and fees</h3>
                    <p className="mt-0.5 text-[0.8125rem] text-text-secondary">
                      {savedOff > 0
                        ? `Discounts take ${formatCurrency(savedOff)} off. The original prices stay on the lines.`
                        : 'Take a percent off the whole document, or add a disposal or outside-work charge. Nothing changes until you save.'}
                    </p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      {p.onDiscount && (
                        <button type="button" className="btn btn-secondary justify-center" onClick={p.onDiscount}>
                          <Icon name="tag" className="h-5 w-5" />
                          Discount
                        </button>
                      )}
                      {p.onAddFee && (
                        <button type="button" className="btn btn-secondary justify-center" onClick={p.onAddFee}>
                          <Icon name="plus" className="h-5 w-5" />
                          Add a fee
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <dl className="mt-4 space-y-1.5 border-t border-border pt-3 text-[0.9375rem]">
                  <Row label="Parts" value={totals.partsTotal} />
                  <Row label="Labor" value={totals.laborTotal} />
                  {totals.coreTotal > 0 && <Row label="Core charges (refundable)" value={totals.coreTotal} />}
                  {totals.shopSupplies > 0 && <Row label="Shop supplies" value={totals.shopSupplies} />}
                  {totals.sublet > 0 && <Row label="Sublet" value={totals.sublet} />}
                  <Row label={totals.applyTax ? `Tax (${totals.taxRate}%)` : 'Tax (not charged)'} value={totals.taxAmount} />
                  <div className="!mt-2.5 flex items-baseline justify-between gap-4 border-t border-line pt-2.5">
                    <dt className="font-bold">{isEstimate ? 'Estimate total' : 'Total'}</dt>
                    <dd className="display num text-[1.375rem] font-bold">{formatCurrency(totals.total)}</dd>
                  </div>
                  {!isEstimate && totals.amountPaid > 0 && <Row label="Paid so far" value={totals.amountPaid} />}
                  {!isEstimate && !closed && (
                    <div className={`!mt-2 flex items-center justify-between gap-4 rounded-md px-3 py-2.5 ${status === 'Paid' || owed <= 0 ? 'bg-green/[0.14]' : 'bg-red/[0.1]'}`}>
                      <dt className="font-bold">{status === 'Paid' || owed <= 0 ? 'Paid in full' : 'Balance due'}</dt>
                      <dd className={`display num text-[1.5rem] font-bold ${status === 'Paid' || owed <= 0 ? 'text-green' : 'text-red'}`}>{formatCurrency(owed)}</dd>
                    </div>
                  )}
                </dl>
              </section>

              {isEstimate ? (
                p.approvalPanel ?? (
                  <section aria-labelledby="sec-approval" className="card">
                    <h2 id="sec-approval" className={`${sectionTitle} mb-2`}>Customer approval</h2>
                    {form.signature_signed_at ? (
                      <div>
                        <p className="flex items-center gap-2 font-bold"><span className="lamp lamp-green" aria-hidden="true" />Signed by {form.signature_signer_name || who}</p>
                        <p className="text-[0.9375rem] text-text-secondary">{new Date(String(form.signature_signed_at)).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</p>
                      </div>
                    ) : (
                      <p className="text-text-secondary">Not answered yet.</p>
                    )}
                  </section>
                )
              ) : (
                <section aria-labelledby="sec-payment" className="card">
                  <h2 id="sec-payment" className={`${sectionTitle} mb-2`}>Payment</h2>
                  {isNew ? (
                    <p className="text-text-secondary">Save the {noun} first. Then you can record payments and set up a payment plan.</p>
                  ) : (
                    <>
                      <p className="flex items-center gap-2 font-bold"><span className={`lamp lamp-${lamp}`} aria-hidden="true" />{docStatusLabel(docType, status)}</p>
                      <p className="mt-0.5 text-[0.9375rem] text-text-secondary num">
                        {closed ? 'Voided, so nothing is owed and no payment can be recorded.' : status === 'Paid' ? `${formatCurrency(totals.amountPaid || totals.total)} received${form.payment_method ? ` by ${form.payment_method}` : ''}.` : totals.amountPaid > 0 ? `${formatCurrency(totals.amountPaid)} received. ${formatCurrency(owed)} still due.` : `${formatCurrency(owed)} due.`}
                      </p>
                      {p.linkNote && <p className="mt-1 flex items-center gap-2 text-[0.9375rem] text-text-secondary"><span className="lamp lamp-blue" aria-hidden="true" />{p.linkNote}</p>}
                      <div className="mt-3 flex flex-wrap gap-2">
                        {owed > 0 && status !== 'Paid' && !closed && (
                          <button type="button" className="btn btn-primary w-full sm:w-auto" onClick={p.onPay}>
                            <Icon name="dollar" className="h-5 w-5" />
                            Record payment
                          </button>
                        )}
                        {type === 'Invoice' && !frozen && (
                          <button type="button" className="btn btn-secondary w-full sm:w-auto" onClick={p.onPlan}>
                            <Icon name="calendar" className="h-5 w-5" />
                            {plan?.enabled ? 'Change payment plan' : 'Set up payment plan'}
                          </button>
                        )}
                      </div>
                    </>
                  )}
                  {plan?.enabled && (
                    <div className="mt-4 border-t border-border pt-3">
                      <h3 className="text-[0.9375rem] font-bold">Payment plan</h3>
                      <p className="text-[0.9375rem] text-text-secondary num">Down payment {formatCurrency(plan.down_payment)}, then {plan.installments} {plan.frequency === 'biweekly' ? 'every two weeks' : plan.frequency} payments</p>
                      <ul className="mt-2">
                        {plan.payments.map((pay, i) => (
                          <li key={i}>
                            <label className="flex min-h-[44px] cursor-pointer items-center gap-3 text-[0.9375rem]">
                              <input
                                type="checkbox"
                                className="h-5 w-5 accent-[rgb(var(--c-blue))]"
                                checked={pay.paid}
                                disabled={locked}
                                onChange={e => {
                                  const cur = { ...form.payment_plan! }
                                  const payments = [...cur.payments]
                                  payments[i] = { ...payments[i], paid: e.target.checked }
                                  setForm(f => ({ ...f, payment_plan: { ...cur, payments } }))
                                }}
                              />
                              <span className={`num ${pay.paid ? 'text-text-muted line-through' : ''}`}>{fmtDate(pay.date)}</span>
                              <span className={`num ml-auto ${pay.paid ? 'text-text-muted line-through' : 'font-bold'}`}>{formatCurrency(pay.amount)}</span>
                              <span className="sr-only">{pay.paid ? 'paid' : 'not paid'}</span>
                            </label>
                          </li>
                        ))}
                      </ul>
                      {(() => {
                        const paidN = plan.payments.filter(x => x.paid).length
                        const totalN = plan.payments.length
                        const pct = totalN > 0 ? (paidN / totalN) * 100 : 0
                        return (
                          <div className="mt-2">
                            <div className="h-2 overflow-hidden rounded-full bg-bg-hover"><div className="h-full rounded-full bg-green transition-all" style={{ width: `${pct}%` }} /></div>
                            <p className="mt-1 text-[0.8125rem] text-text-secondary num">{paidN} of {totalN} plan payments marked paid</p>
                          </div>
                        )
                      })()}
                    </div>
                  )}
                </section>
              )}
            </div>

            {/* Notes and warranty */}
            <section aria-labelledby="sec-notes" className="card min-w-0 xl:col-start-1">
              <h2 id="sec-notes" className={`${sectionTitle} mb-3`}>Notes and warranty</h2>
              <div className="space-y-3">
                <Field id="f-notes" label="Notes for the customer" hint={`Prints on the ${noun}.`}>
                  <textarea id="f-notes" className="form-textarea" rows={3} value={form.notes || ''} onChange={sf('notes')} />
                </Field>
                <Field id="f-internal" label="Shop notes (private)" hint="Never shown to the customer.">
                  <textarea id="f-internal" className="form-textarea" rows={3} placeholder="Cost, warnings, declined work, what the tech found" value={rec.internal_notes || ''} onChange={sf('internal_notes')} />
                </Field>
                <Field id="f-warranty" label="Warranty">
                  <select id="f-warranty" className="form-select" value={form.warranty_type || 'No Warranty'} onChange={e => p.onWarrantyPreset(e.target.value)}>
                    {p.warrantyLabels.map(l => <option key={l} value={l}>{l}</option>)}
                  </select>
                </Field>
                <button type="button" className="btn btn-secondary btn-sm" onClick={p.onSuggestWarranty}>
                  <Icon name="sparkle" className="h-4 w-4" />
                  Suggest a warranty from the work
                </button>
                {showWarrantyDetails && (
                  <div className="grid grid-cols-2 gap-3 border-t border-border pt-3">
                    <Field id="f-wmonths" label="Months covered">
                      <input id="f-wmonths" className="form-input num" type="number" inputMode="numeric" value={form.warranty_months || ''} onChange={sf('warranty_months')} />
                    </Field>
                    <Field id="f-wmiles" label="Miles covered">
                      <input id="f-wmiles" className="form-input num" type="number" inputMode="numeric" value={form.warranty_mileage || ''} onChange={sf('warranty_mileage')} />
                    </Field>
                    <Field id="f-wstart" label="Starts on" className="col-span-2 sm:col-span-1">
                      <input id="f-wstart" className="form-input" type="date" value={form.warranty_start || form.doc_date || ''} onChange={sf('warranty_start')} />
                    </Field>
                    <Field id="f-wexcl" label="What is not covered" className="col-span-2">
                      <textarea id="f-wexcl" className="form-textarea" rows={3} value={form.warranty_exclusions || ''} onChange={sf('warranty_exclusions')} />
                    </Field>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>

      {/* ---------- Message strip and action bar ---------- */}
      <div className="shrink-0 lg:sticky lg:bottom-0 lg:z-10">
        {notice && (
          <div
            role={notice.kind === 'error' ? 'alert' : 'status'}
            className={`mx-auto flex max-w-[1180px] items-center justify-between gap-3 border-t px-4 py-2.5 text-[0.9375rem] sm:px-5 lg:px-8 ${notice.kind === 'error' ? 'border-red/50 bg-red/[0.08] text-red' : 'border-green/40 bg-bg-card text-text-primary'}`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <Icon name={notice.kind === 'error' ? 'alert' : 'check'} className={`h-5 w-5 shrink-0 ${notice.kind === 'error' ? '' : 'text-green'}`} />
              <span className="min-w-0 break-words">{notice.text}</span>
            </span>
            <span className="flex shrink-0 items-center gap-1">
              {notice.undo && <button type="button" className="btn btn-secondary btn-sm" onClick={() => { notice.undo?.(); p.onClearNotice() }}>Undo</button>}
              <button type="button" className="btn btn-ghost btn-sm" onClick={p.onClearNotice} aria-label="Dismiss message">Dismiss</button>
            </span>
          </div>
        )}
        <div className={`border-t border-border bg-bg-chrome ${keyboardOpen ? 'pb-1' : 'pb-[max(0.5rem,env(safe-area-inset-bottom))]'}`}>
          <div className="mx-auto flex max-w-[1180px] items-center gap-2 px-4 pt-2 sm:px-5 lg:px-8">
            <div className="min-w-0 flex-1">
              <p className="text-[0.8125rem] font-bold leading-tight text-text-secondary">{barLabel}</p>
              <p className="display num truncate text-[1.375rem] font-bold leading-tight" title={formatCurrency(barAmount)}>{formatCurrency(barAmount)}</p>
            </div>
            <button type="button" className="btn btn-secondary hidden lg:inline-flex" onClick={p.onPreview}>
              <Icon name="print" className="h-5 w-5" />
              Preview and print
            </button>
            {!isNew && !closed && (
              <button type="button" className="btn btn-secondary hidden lg:inline-flex" onClick={p.onSend}>
                <Icon name="send" className="h-5 w-5" />
                Send
              </button>
            )}
            <button type="button" className="btn btn-secondary" onClick={p.onMore} aria-label="More actions" aria-haspopup="dialog">
              <Icon name="more" className="h-5 w-5" />
              <span className="hidden sm:inline">More</span>
            </button>
            <button type="button" className={`btn ${dirty || isNew ? 'btn-primary' : 'btn-secondary'} min-w-[8.5rem]`} onClick={p.onSave} disabled={saving}>
              {!dirty && !isNew && !saving && <Icon name="check" className="h-5 w-5" />}
              {saveLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-text-secondary">{label}</dt>
      <dd className="num">{formatCurrency(value)}</dd>
    </div>
  )
}
