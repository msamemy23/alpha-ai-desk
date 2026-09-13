'use client'

import type { Approval } from '@/lib/ai/workflow/engine'
import { calculateDocumentTotals, partLineTotal, laborLineTotal } from '@/lib/document-money'

const money = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
const label = (value: string) => value.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ')

export function WorkflowReview({ approval, busy, onDecision }: { approval: Approval; busy: boolean; onDecision: (decision: 'confirm' | 'cancel') => void }) {
  const draft = approval.payload
  const document = approval.action === 'createInvoice'
  const parts = Array.isArray(draft.parts) ? draft.parts as Record<string, unknown>[] : []
  const labors = Array.isArray(draft.labors) ? draft.labors as Record<string, unknown>[] : []
  const totals = document ? calculateDocumentTotals(draft) : null
  return <section aria-label="Action review" data-testid="workflow-review" className="w-full max-w-3xl rounded-xl border border-blue/40 bg-bg-card p-4 space-y-3">
    <div className="font-semibold">{document ? `${draft.type} · review before saving` : label(approval.action)}</div>
    {document ? <>
      <div>{String(draft.customer_name || '')}</div>
      <div className="text-sm text-text-secondary">{[draft.vehicle_year, draft.vehicle_make, draft.vehicle_model].filter(Boolean).join(' ')}</div>
      {!!draft.customer_phone && <div className="text-sm">Phone: {String(draft.customer_phone)}</div>}
      {!!draft.customer_email && <div className="text-sm">Email: {String(draft.customer_email)}</div>}
      <div className="divide-y divide-border">
        {parts.map((part, index) => <div key={`part-${index}`} className="flex justify-between gap-3 py-2 text-sm"><span>{String(part.name)} · {String(part.qty)} × {money(Number(part.unitPrice))}</span><span>{money(partLineTotal(part))}</span></div>)}
        {labors.map((labor, index) => <div key={`labor-${index}`} className="flex justify-between gap-3 py-2 text-sm"><span>{String(labor.operation)}{labor.amount === undefined ? ` · ${labor.hours} hr × ${money(Number(labor.rate))}` : ' · flat labor'}</span><span>{money(laborLineTotal(labor))}</span></div>)}
      </div>
      {totals && <div className="text-sm space-y-1 border-t border-border pt-2">
        <div className="flex justify-between"><span>Parts</span><span>{money(totals.partsTotal)}</span></div>
        {totals.coreTotal > 0 && <div className="flex justify-between"><span>Core charges</span><span>{money(totals.coreTotal)}</span></div>}
        <div className="flex justify-between"><span>Labor</span><span>{money(totals.laborTotal)}</span></div>
        {totals.shopSupplies > 0 && <div className="flex justify-between"><span>Shop supplies</span><span>{money(totals.shopSupplies)}</span></div>}
        {totals.sublet > 0 && <div className="flex justify-between"><span>Sublet</span><span>{money(totals.sublet)}</span></div>}
        <div className="flex justify-between"><span>Subtotal</span><span>{money(totals.subtotal)}</span></div>
        <div className="flex justify-between"><span>Tax {draft.apply_tax === false ? '(not applied)' : `(${draft.tax_rate}%)`}</span><span>{money(totals.taxAmount)}</span></div>
        {totals.deposit > 0 && <div className="flex justify-between"><span>Deposit</span><span>{money(totals.deposit)}</span></div>}
        <div className="flex justify-between font-semibold"><span>Total</span><span>{money(totals.total)}</span></div>
      </div>}
      {!!draft.notes && <div className="text-sm whitespace-pre-wrap">{String(draft.notes)}</div>}
      {!!approval.sources?.length && <div className="text-xs text-text-muted space-y-1"><div className="font-semibold">Sources used for quoted prices</div>{approval.sources.map(source => <a key={source.url} className="block truncate text-blue hover:underline" href={source.url} target="_blank" rel="noreferrer">{source.label}: {source.url}</a>)}</div>}
      <p className="text-xs text-text-muted">Saves a draft only. Does not email, text, charge or mark paid. Email and a customer record are not required.</p>
    </> : <dl className="space-y-2 text-sm">{Object.entries(draft).map(([key, value]) => <div key={key}><dt className="text-text-muted capitalize">{label(key)}</dt><dd className="whitespace-pre-wrap break-words">{typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value ?? 'Not provided')}</dd></div>)}</dl>}
    {approval.warnings.map(warning => <p key={warning} className="text-sm text-amber-600">{warning}</p>)}
    <div className="flex flex-wrap gap-2">
      <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => onDecision('confirm')}>{busy ? 'Checking result…' : approval.status === 'pending' ? (document ? 'Confirm and save draft' : 'Confirm action') : 'Retry same operation'}</button>
      {approval.status === 'pending' && <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => onDecision('cancel')}>Cancel</button>}
    </div>
    <p className="text-xs text-text-muted">To change this review, tell Alpha what to change. The old confirmation will be invalidated.</p>
  </section>
}
