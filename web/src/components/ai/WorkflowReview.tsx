'use client'

import type { ReactNode } from 'react'
import type { Approval } from '@/lib/ai/workflow/engine'
import { calculateDocumentTotals, partLineTotal, laborLineTotal } from '@/lib/document-money'
import Icon from '@/components/Icon'

const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const label = (value: string) => {
  const words = value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').trim().toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

// What each action does, in plain words. `sends` marks actions that reach a customer;
// `danger` marks actions that remove or void something.
const ACTIONS: Record<string, { title: string; effect: string; approve: string; sends?: boolean; danger?: boolean }> = {
  sendEstimateEmail: { title: 'Email a document', effect: 'Alpha will email this document to the customer.', approve: 'send email', sends: true },
  createCustomer: { title: 'Add a customer', effect: 'Alpha will add this person to your customer list.', approve: 'add customer' },
  updateCustomer: { title: 'Change a customer', effect: 'Alpha will change these details on the customer record.', approve: 'save changes' },
  createJob: { title: 'Open a job', effect: 'Alpha will open this job on your shop board.', approve: 'open job' },
  updateJobStatus: { title: 'Change a job status', effect: 'Alpha will move this job to the status below.', approve: 'change status' },
  voidDocument: { title: 'Void a document', effect: 'Alpha will void this document. It will no longer count.', approve: 'void document', danger: true },
  deleteRecord: { title: 'Delete a record', effect: 'Alpha will delete this record. This cannot be undone.', approve: 'delete', danger: true },
  scheduleFollowUp: { title: 'Schedule a follow-up', effect: 'Alpha will schedule this follow-up.', approve: 'schedule it' },
  addStaff: { title: 'Add a staff member', effect: 'Alpha will add this person to your staff list.', approve: 'add staff member' },
  removeStaff: { title: 'Deactivate a staff member', effect: 'Alpha will mark this person inactive. Their history stays.', approve: 'deactivate', danger: true },
  createAppointment: { title: 'Book an appointment', effect: 'Alpha will add this appointment to your schedule.', approve: 'book it' },
  updateAppointment: { title: 'Change an appointment', effect: 'Alpha will change this appointment.', approve: 'save changes' },
  deleteAppointment: { title: 'Delete an appointment', effect: 'Alpha will remove this appointment from your schedule.', approve: 'delete', danger: true },
  updateInventory: { title: 'Update inventory', effect: 'Alpha will change this inventory item.', approve: 'update inventory' },
  convertEstimateToInvoice: { title: 'Turn an estimate into an invoice', effect: 'Alpha will create an invoice from this estimate.', approve: 'create invoice' },
  updateDocument: { title: 'Change a document', effect: 'Alpha will change this document. It will not be sent and no payment is recorded.', approve: 'save changes' },
}

/**
 * The one approval card used everywhere Alpha asks before it acts (documents,
 * data changes, texts and emails). It always says what will happen, shows the
 * details, and offers an explicit Approve and Cancel. Nothing runs until Approve.
 */
export function ApprovalFrame({
  ariaLabel, testId, waiting = false, title, effect, tags, children, warnings = [], busy, approveLabel, danger = false, onApprove, onCancel, note,
}: {
  ariaLabel: string
  testId?: string
  waiting?: boolean
  title: string
  effect: string
  tags?: ReactNode
  children?: ReactNode
  warnings?: string[]
  busy: boolean
  approveLabel: string
  danger?: boolean
  onApprove: () => void
  onCancel?: () => void
  note?: string
}) {
  return <section aria-label={ariaLabel} data-testid={testId} className="w-full max-w-[40rem] rounded-lg border border-line border-l-[6px] border-l-[rgb(var(--lamp-amber))] bg-bg-card p-4 sm:p-5">
    <div className="flex flex-wrap items-center gap-2 text-[0.9375rem] font-bold">
      <span className="lamp lamp-amber" aria-hidden="true" />
      {waiting ? 'Waiting on a result' : 'Needs your OK'}
      {tags}
    </div>
    <h3 className="display mt-2 text-[1.25rem] font-bold leading-snug">{title}</h3>
    <p className="mt-1 text-text-secondary">{effect}</p>

    {children && <div className="mt-4 border-t border-border pt-4">{children}</div>}

    {warnings.length > 0 && <ul className="mt-4 space-y-2">
      {warnings.map(warning => <li key={warning} className="flex items-start gap-2 rounded-md bg-amber/[0.16] px-3 py-2 text-[0.9375rem]">
        <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-amber" />
        <span>{warning}</span>
      </li>)}
    </ul>}

    {waiting && <p className="mt-4 text-[0.9375rem] text-text-secondary">The last attempt did not confirm a result. Retrying checks the same operation, so nothing is done twice.</p>}

    <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
      {onCancel && <button type="button" className="btn btn-secondary btn-lg w-full sm:w-auto sm:min-w-[8rem]" disabled={busy} onClick={onCancel}>Cancel</button>}
      <button type="button" className={`btn btn-lg w-full sm:w-auto sm:min-w-[11rem] ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy} onClick={onApprove}>{approveLabel}</button>
    </div>
    {note && <p className="mt-3 text-[0.8125rem] text-text-secondary">{note}</p>}
  </section>
}

/** Plain list of the details an action will use. Nested values are shown as JSON. */
export function PayloadList({ payload }: { payload: Record<string, unknown> }) {
  const entries = Object.entries(payload)
  if (!entries.length) return <p className="text-[0.9375rem] text-text-secondary">No extra details.</p>
  return <dl className="space-y-3 text-[0.9375rem]">
    {entries.map(([key, value]) => <div key={key}>
      <dt className="text-[0.8125rem] font-bold text-text-secondary">{label(key)}</dt>
      <dd className="whitespace-pre-wrap break-words">{value !== null && typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? 'Not provided')}</dd>
    </div>)}
  </dl>
}

export function WorkflowReview({ approval, busy, onDecision }: { approval: Approval; busy: boolean; onDecision: (decision: 'confirm' | 'cancel') => void }) {
  const draft = approval.payload
  const document = approval.action === 'createInvoice'
  const parts = Array.isArray(draft.parts) ? draft.parts as Record<string, unknown>[] : []
  const labors = Array.isArray(draft.labors) ? draft.labors as Record<string, unknown>[] : []
  const totals = document ? calculateDocumentTotals(draft) : null
  const pending = approval.status === 'pending'
  const docType = String(draft.type || 'Invoice')
  const meta = ACTIONS[approval.action]
  const title = document ? `Save this ${docType.toLowerCase()} as a draft` : meta?.title || label(approval.action)
  const effect = document
    ? `Alpha will save this ${docType.toLowerCase()} as a draft. Nothing is emailed, texted, charged or marked paid.`
    : meta?.effect || 'Alpha will run this action with the details below.'
  const approveText = busy ? 'Checking result…' : pending ? `Approve and ${document ? 'save draft' : meta?.approve || 'continue'}` : 'Retry same operation'
  const vehicle = [draft.vehicle_year, draft.vehicle_make, draft.vehicle_model].filter(Boolean).join(' ')

  return <ApprovalFrame
    ariaLabel="Action review"
    testId="workflow-review"
    waiting={!pending}
    title={title}
    effect={effect}
    tags={<>
      {meta?.sends && <span className="tag tag-gray">Sends a message</span>}
      {meta?.danger && <span className="tag tag-red">Cannot be undone</span>}
    </>}
    warnings={approval.warnings}
    busy={busy}
    approveLabel={approveText}
    danger={!!meta?.danger}
    onApprove={() => onDecision('confirm')}
    onCancel={pending ? () => onDecision('cancel') : undefined}
    note="Want something different? Tell Alpha what to change. This review is replaced when you do."
  >
    {document ? <>
      <p className="text-[0.8125rem] font-bold text-text-secondary">For</p>
      <p className="font-bold">{String(draft.customer_name || 'No customer name')}</p>
      {vehicle && <p className="text-text-secondary">{vehicle}</p>}
      {!!draft.customer_phone && <p className="text-[0.9375rem] text-text-secondary">Phone {String(draft.customer_phone)}</p>}
      {!!draft.customer_email && <p className="text-[0.9375rem] text-text-secondary">Email {String(draft.customer_email)}</p>}

      {(parts.length > 0 || labors.length > 0) && <ul className="ledger mt-3">
        {parts.map((part, index) => <li key={`part-${index}`} className="flex items-start justify-between gap-3 py-2.5">
          <span className="min-w-0"><span className="block font-bold">{String(part.name)}</span><span className="num block text-[0.875rem] text-text-secondary">{String(part.qty)} × {money(Number(part.unitPrice))}</span></span>
          <span className="num shrink-0 font-bold">{money(partLineTotal(part))}</span>
        </li>)}
        {labors.map((labor, index) => <li key={`labor-${index}`} className="flex items-start justify-between gap-3 py-2.5">
          <span className="min-w-0"><span className="block font-bold">{String(labor.operation)}</span><span className="num block text-[0.875rem] text-text-secondary">{labor.amount === undefined ? `${labor.hours} hr × ${money(Number(labor.rate))}` : 'Flat labor'}</span></span>
          <span className="num shrink-0 font-bold">{money(laborLineTotal(labor))}</span>
        </li>)}
      </ul>}

      {totals && <dl className="mt-3 space-y-1.5 text-[0.9375rem]">
        <div className="flex justify-between gap-3"><dt className="text-text-secondary">Parts</dt><dd className="num">{money(totals.partsTotal)}</dd></div>
        {totals.coreTotal > 0 && <div className="flex justify-between gap-3"><dt className="text-text-secondary">Core charges</dt><dd className="num">{money(totals.coreTotal)}</dd></div>}
        <div className="flex justify-between gap-3"><dt className="text-text-secondary">Labor</dt><dd className="num">{money(totals.laborTotal)}</dd></div>
        {totals.shopSupplies > 0 && <div className="flex justify-between gap-3"><dt className="text-text-secondary">Shop supplies</dt><dd className="num">{money(totals.shopSupplies)}</dd></div>}
        {totals.sublet > 0 && <div className="flex justify-between gap-3"><dt className="text-text-secondary">Sublet</dt><dd className="num">{money(totals.sublet)}</dd></div>}
        <div className="flex justify-between gap-3"><dt className="text-text-secondary">Subtotal</dt><dd className="num">{money(totals.subtotal)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-text-secondary">Tax {draft.apply_tax === false ? '(not applied)' : `(${draft.tax_rate}%)`}</dt><dd className="num">{money(totals.taxAmount)}</dd></div>
        {totals.deposit > 0 && <div className="flex justify-between gap-3"><dt className="text-text-secondary">Deposit</dt><dd className="num">{money(totals.deposit)}</dd></div>}
        <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2"><dt className="font-bold">Total</dt><dd className="num display text-[1.375rem] font-bold">{money(totals.total)}</dd></div>
      </dl>}

      {!!draft.notes && <p className="mt-3 whitespace-pre-wrap text-[0.9375rem]">{String(draft.notes)}</p>}
      {!!approval.sources?.length && <div className="mt-3 space-y-1 text-[0.8125rem] text-text-secondary">
        <p className="font-bold">Sources used for quoted prices</p>
        {approval.sources.map(source => <a key={source.url} className="block truncate text-blue underline-offset-2 hover:underline" href={source.url} target="_blank" rel="noreferrer">{source.label}: {source.url}</a>)}
      </div>}
      <p className="mt-3 text-[0.8125rem] text-text-secondary">An email address and a linked customer record are optional. You can add them after it is saved.</p>
    </> : <PayloadList payload={draft} />}
  </ApprovalFrame>
}
