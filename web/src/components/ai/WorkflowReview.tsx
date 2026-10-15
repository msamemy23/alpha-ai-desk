'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import type { Approval } from '@/lib/ai/workflow/engine'
import type { AiRules } from '@/lib/ai/shop-rules'
import type { ReviewRow } from '@/lib/ai/review'
import { buildWorkflowReview } from '@/lib/ai/review'
import { calculateDocumentTotals, partLineTotal, laborLineTotal } from '@/lib/document-money'
import Icon from '@/components/Icon'

const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const label = (value: string) => {
  const words = value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').trim().toLowerCase()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

type Tone = 'gray' | 'red' | 'green' | 'amber' | 'blue'

/** The small labels at the top of a review: who it reaches, and whether it can be undone. */
export function ReviewTags({ tags }: { tags: { text: string; tone: Tone }[] }) {
  return <>{tags.map(tag => <span key={tag.text} className={`tag tag-${tag.tone}`}>{tag.text}</span>)}</>
}

/** What the assistant did and did not check before asking. Never shown as checked when it was not. */
export function ReviewChecks({ checks, sources }: { checks?: { verified: string[]; unverified: string[] }; sources?: { label: string; url: string }[] }) {
  const verified = checks?.verified || []
  const unverified = checks?.unverified || []
  if (!verified.length && !unverified.length && !sources?.length) return null
  return <div data-testid="review-checks" className="mt-4 rounded-md border border-border bg-bg-base px-3 py-3 text-[0.9375rem]">
    <p className="text-[0.8125rem] font-bold text-text-secondary">What was checked</p>
    <ul className="mt-2 space-y-2">
      {verified.map(item => <li key={`v-${item}`} className="flex items-start gap-2">
        <Icon name="check" className="mt-0.5 h-5 w-5 shrink-0 text-green" />
        <span><span className="sr-only">Checked: </span>{item}</span>
      </li>)}
      {unverified.map(item => <li key={`u-${item}`} className="flex items-start gap-2">
        <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-amber" />
        <span><span className="font-bold">Not verified: </span>{item}</span>
      </li>)}
    </ul>
    {!!sources?.length && <div className="mt-3 space-y-1 border-t border-border pt-3 text-[0.8125rem] text-text-secondary">
      <p className="font-bold">Sources you can open and check</p>
      {sources.map(source => <a key={source.url} className="block truncate text-blue underline-offset-2 hover:underline" href={source.url} target="_blank" rel="noreferrer">{source.label}: {source.url}</a>)}
    </div>}
  </div>
}

/**
 * The one approval card used everywhere the assistant asks before it acts (documents,
 * data changes, texts and emails, connected apps). It always says what will happen and
 * whether it can be undone, shows the exact details, and offers Approve, Edit and Cancel.
 * Nothing runs until Approve, and a review the shop's rules forbid cannot be approved.
 */
export function ApprovalFrame({
  ariaLabel, testId, waiting = false, title, effect, tags, undoLine, irreversible = false, children, warnings = [], checks, sources, blockedReason = '',
  busy, approveLabel, danger = false, onApprove, onCancel, onEdit, editLabel = 'Change something', note,
}: {
  ariaLabel: string
  testId?: string
  waiting?: boolean
  title: string
  effect: string
  tags?: ReactNode
  undoLine?: string
  irreversible?: boolean
  children?: ReactNode
  warnings?: string[]
  checks?: { verified: string[]; unverified: string[] }
  sources?: { label: string; url: string }[]
  blockedReason?: string
  busy: boolean
  approveLabel: string
  danger?: boolean
  onApprove: () => void
  onCancel?: () => void
  onEdit?: () => void
  editLabel?: string
  note?: string
}) {
  const blocked = Boolean(blockedReason)
  return <section aria-label={ariaLabel} data-testid={testId} className={`w-full max-w-[40rem] rounded-lg border border-line border-l-[6px] bg-bg-card p-4 sm:p-5 ${blocked ? 'border-l-[rgb(var(--lamp-red))]' : 'border-l-[rgb(var(--lamp-amber))]'}`}>
    <div className="flex flex-wrap items-center gap-2 text-[0.9375rem] font-bold">
      <span className={`lamp ${blocked ? 'lamp-red' : 'lamp-amber'}`} aria-hidden="true" />
      {blocked ? 'Blocked by your shop rules' : waiting ? 'Waiting on a result' : 'Needs your OK'}
      {tags}
    </div>
    <h3 className="display mt-2 text-[1.25rem] font-bold leading-snug">{title}</h3>
    <p className="mt-1 text-text-secondary">{effect}</p>

    {children && <div className="mt-4 border-t border-border pt-4">{children}</div>}

    <ReviewChecks checks={checks} sources={sources} />

    {undoLine && <p data-testid="review-undo" className={`mt-4 flex items-start gap-2 text-[0.9375rem] ${irreversible ? 'font-bold text-red' : 'text-text-secondary'}`}>
      <Icon name={irreversible ? 'alert' : 'undo'} className="mt-0.5 h-5 w-5 shrink-0" />
      <span>{undoLine}</span>
    </p>}

    {warnings.length > 0 && <ul className="mt-4 space-y-2">
      {warnings.map(warning => <li key={warning} className="flex items-start gap-2 rounded-md bg-amber/[0.16] px-3 py-2 text-[0.9375rem]">
        <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-amber" />
        <span>{warning}</span>
      </li>)}
    </ul>}

    {blocked && <p role="alert" className="mt-4 rounded-md bg-red/[0.12] px-3 py-2 text-[0.9375rem]">
      <span className="font-bold">This cannot be approved. </span>{blockedReason}{' '}
      <Link href="/settings#assistant" className="font-bold text-blue underline underline-offset-4">Change your rules</Link>
    </p>}

    {waiting && <p className="mt-4 text-[0.9375rem] text-text-secondary">The last attempt did not confirm a result. Retrying checks the same operation, so nothing is done twice.</p>}

    <div className="mt-4 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
      {onCancel && <button type="button" className="btn btn-secondary btn-lg w-full sm:w-auto sm:min-w-[8rem]" disabled={busy} onClick={onCancel}>Cancel</button>}
      {onEdit && <button type="button" className="btn btn-secondary btn-lg w-full sm:w-auto sm:min-w-[8rem]" disabled={busy} onClick={onEdit}>{editLabel}</button>}
      <button type="button" className={`btn btn-lg w-full sm:w-auto sm:min-w-[11rem] ${danger ? 'btn-danger' : 'btn-primary'}`} disabled={busy || blocked} onClick={onApprove}>{approveLabel}</button>
    </div>
    {note && <p className="mt-3 text-[0.8125rem] text-text-secondary">{note}</p>}
  </section>
}

/** The details an action will use, as plain label and value pairs. Messages a customer will read sit in a box. */
export function ReviewRows({ rows }: { rows: ReviewRow[] }) {
  if (!rows.length) return <p className="text-[0.9375rem] text-text-secondary">No extra details.</p>
  return <dl className="space-y-3 text-[0.9375rem]">
    {rows.map((row, index) => <div key={`${row.label}-${index}`}>
      <dt className={row.kind === 'minor' ? 'text-[0.75rem] font-bold text-text-muted' : 'text-[0.8125rem] font-bold text-text-secondary'}>{row.label}</dt>
      {row.kind === 'words'
        ? <dd className="mt-1 whitespace-pre-wrap break-words rounded-md border border-border bg-bg-base px-3 py-2.5 text-base leading-relaxed">{row.value}</dd>
        : <dd className={`whitespace-pre-wrap break-words ${row.kind === 'minor' ? 'text-[0.8125rem] text-text-secondary' : ''}`}>{row.value}</dd>}
    </div>)}
  </dl>
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

export function WorkflowReview({ approval, busy, onDecision, onEdit, rules }: {
  approval: Approval
  busy: boolean
  onDecision: (decision: 'confirm' | 'cancel') => void
  /** Called when the owner wants to change something. The review stays until a new message replaces it. */
  onEdit?: () => void
  rules?: AiRules
}) {
  const draft = approval.payload
  const document = approval.action === 'createInvoice'
  const parts = Array.isArray(draft.parts) ? draft.parts as Record<string, unknown>[] : []
  const labors = Array.isArray(draft.labors) ? draft.labors as Record<string, unknown>[] : []
  const totals = document ? calculateDocumentTotals(draft) : null
  const pending = approval.status === 'pending'
  const model = buildWorkflowReview(approval, { rules })
  const approveText = busy ? 'Checking result…' : pending ? model.approveLabel : 'Retry same operation'
  const vehicle = [draft.vehicle_year, draft.vehicle_make, draft.vehicle_model].filter(Boolean).join(' ')

  return <ApprovalFrame
    ariaLabel="Action review"
    testId="workflow-review"
    waiting={!pending}
    title={model.title}
    effect={model.effect}
    tags={<ReviewTags tags={model.tags} />}
    undoLine={model.undoLine}
    irreversible={model.irreversible}
    warnings={approval.warnings}
    checks={approval.checks}
    sources={approval.sources}
    blockedReason={pending ? model.blockedReason : ''}
    busy={busy}
    approveLabel={approveText}
    danger={model.danger}
    onApprove={() => onDecision('confirm')}
    onCancel={pending ? () => onDecision('cancel') : undefined}
    onEdit={pending ? onEdit : undefined}
    note={onEdit ? 'Change something and the assistant prepares a new review. This one is replaced when you do.' : 'Want something different? Tell the assistant what to change. This review is replaced when you do.'}
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
      {!!approval.sources?.length && <p className="mt-3 text-[0.8125rem] text-text-secondary">Where the quoted prices came from is listed under “What was checked”.</p>}
      <p className="mt-3 text-[0.8125rem] text-text-secondary">An email address and a linked customer record are optional. You can add them after it is saved.</p>
    </> : <ReviewRows rows={model.rows} />}
  </ApprovalFrame>
}
