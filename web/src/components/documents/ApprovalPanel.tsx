'use client'
/* A signature is a data URL image, so a plain img tag is correct here. */
/* eslint-disable @next/next/no-img-element */
import { formatCurrency } from '@/lib/supabase'
import { expiryWords, expiryState } from '@/lib/doc-approval'
import { linkLine, whenLabel } from '@/lib/doc-history'
import type { LinkSummary } from '@/lib/doc-history'
import Icon from '@/components/Icon'
import type { SignatureInfo } from './api'
import { WarnMsg } from './Dialogs'

const METHODS: Record<string, string> = { drawn: 'Drew it on screen', typed: 'Typed their name', click: 'Tapped approve', tap: 'Tapped approve' }
const OUTCOMES: Record<string, string> = { approved: 'Approved all the work', partial: 'Approved some of the work', declined: 'Declined the estimate', signed: 'Signed' }

/**
 * The estimate's side of the customer's answer: when it was sent and looked at, the good-through date, and, once
 * answered, the signed record with who, when, how, from what device, and whether the stored record still matches
 * the seal made when it was signed.
 */
export default function ApprovalPanel({ docNumber, status, isNew, expiresDate, today, link, sig, sigLoading, sigError, signerFallback, hasOpenLink, canEdit, onSend, onExtend, onLinksOff, onMarkApproved, onRetrySig }: {
  docNumber: string
  status: string
  isNew: boolean
  expiresDate: string
  today: string
  link: LinkSummary | undefined
  sig: SignatureInfo | null
  sigLoading: boolean
  sigError: string
  signerFallback: string
  hasOpenLink: boolean
  canEdit: boolean
  onSend: () => void
  onExtend: () => void
  onLinksOff: () => void
  onMarkApproved: () => void
  onRetrySig: () => void
}) {
  const nowMs = Date.now()
  const seen = linkLine(link, nowMs)
  const ex = expiryState(expiresDate, today)
  const closed = status === 'Void' || status === 'Declined'
  const signed = !!sig && !!(sig.signed_at || sig.signature_data)
  const verified = sig?.verified

  return (
    <section aria-labelledby="sec-approval" className="card">
      <h2 id="sec-approval" className="section-title mb-2">Customer approval</h2>

      {isNew ? (
        <p className="text-text-secondary">Save the estimate first. Then send it, and you will see here when the customer looks at it and what they answer.</p>
      ) : (
        <>
          {seen && <p className="flex items-center gap-2 text-[0.9375rem]"><span className={`lamp ${link?.answeredAt ? 'lamp-green' : 'lamp-blue'}`} aria-hidden="true" />{seen}</p>}
          {!seen && !signed && <p className="text-text-secondary">Not sent yet. Send it to get the customer&apos;s approval and signature.</p>}

          {expiresDate && !closed && status !== 'Approved' && (
            <p className={`mt-1 text-[0.9375rem] ${ex.state === 'expired' ? 'font-bold text-red' : ex.state === 'soon' || ex.state === 'today' ? 'font-bold text-amber' : 'text-text-secondary'}`}>
              {expiryWords(expiresDate, today)}
            </p>
          )}

          {sigLoading && <div className="skeleton mt-3 h-24" aria-busy="true" aria-label="Loading the signed record" />}
          {sigError && <div className="mt-3"><WarnMsg>{sigError}</WarnMsg><button type="button" className="btn btn-secondary btn-sm mt-2" onClick={onRetrySig}>Try again</button></div>}

          {signed && sig && (
            <div className="mt-3 border-t border-border pt-3">
              <p className="flex items-center gap-2 font-bold"><span className="lamp lamp-green" aria-hidden="true" />{OUTCOMES[sig.outcome || ''] || 'Signed'} by {sig.signer_name || signerFallback}</p>
              {sig.signature_data && (
                <img src={sig.signature_data} alt={`Signature of ${sig.signer_name || signerFallback}`} className="mt-2 max-h-24 max-w-full rounded-md border border-border p-2" style={{ background: '#fff' /* a signature is dark ink on white paper in either theme */ }} />
              )}
              <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-[0.9375rem]">
                {sig.signed_at && <><dt className="text-text-secondary">When</dt><dd className="num">{new Date(sig.signed_at).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}</dd></>}
                {sig.method && <><dt className="text-text-secondary">How</dt><dd>{METHODS[sig.method] || sig.method}</dd></>}
                {sig.source !== 'legacy' && sig.total_after != null && (
                  <><dt className="text-text-secondary">Approved total</dt><dd className="num">{formatCurrency(Number(sig.total_after) || 0)}{Number(sig.total_before) !== Number(sig.total_after) ? ` (was ${formatCurrency(Number(sig.total_before) || 0)})` : ''}</dd></>
                )}
                {sig.device && <><dt className="text-text-secondary">Device</dt><dd className="break-words">{sig.device}</dd></>}
                {sig.ip && <><dt className="text-text-secondary">Network address</dt><dd className="num break-all">{sig.ip}</dd></>}
                {sig.record_id && <><dt className="text-text-secondary">Record</dt><dd className="num break-all">{sig.record_id}</dd></>}
              </dl>
              {sig.note && <p className="mt-2 rounded-md border border-border bg-bg-card px-3 py-2 text-[0.9375rem]"><span className="font-bold">Customer note: </span>{sig.note}</p>}
              {verified && (
                <p className={`mt-3 flex items-start gap-2 text-[0.9375rem] ${verified.ok ? 'text-green' : 'text-red'}`}>
                  <Icon name={verified.ok ? 'shield' : 'alert'} className="mt-0.5 h-5 w-5 shrink-0" />
                  <span>{verified.ok ? 'This record matches the seal made when it was signed.' : `This record does not match its seal. ${verified.reason || ''}`}</span>
                </p>
              )}
              {sig.source === 'legacy' && <p className="mt-2 text-[0.8125rem] text-text-secondary">Signed on an older link. The device and seal were not kept for these.</p>}
              {(sig.all?.length || 0) > 1 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-[0.9375rem] font-bold text-blue">{sig.all!.length} signed records on this {docNumber ? 'document' : 'estimate'}</summary>
                  <ul className="mt-2 space-y-1 text-[0.875rem] text-text-secondary">
                    {sig.all!.map(r => <li key={r.id}>{OUTCOMES[r.outcome] || 'Signed'} by {r.signer_name}, {whenLabel(r.signed_at, nowMs).toLowerCase()}, {formatCurrency(r.total_after)}{r.verified && !r.verified.ok ? '. Does not match its seal' : ''}</li>)}
                  </ul>
                </details>
              )}
            </div>
          )}

          {canEdit && (
            <div className="mt-4 flex flex-wrap gap-2">
              {!closed && status !== 'Approved' && (
                <button type="button" className="btn btn-primary w-full sm:w-auto" onClick={onSend}>
                  <Icon name="send" className="h-5 w-5" />
                  {link?.sentAt ? 'Send again' : 'Send to customer'}
                </button>
              )}
              {!closed && (status === 'Sent' || status === 'Draft') && (
                <button type="button" className="btn btn-secondary w-full sm:w-auto" onClick={onMarkApproved}>
                  <Icon name="check" className="h-5 w-5" />
                  They said yes in person
                </button>
              )}
              {!closed && status !== 'Approved' && (
                <button type="button" className="btn btn-secondary w-full sm:w-auto" onClick={onExtend}>
                  <Icon name="calendar" className="h-5 w-5" />
                  {expiresDate ? 'Change good-through date' : 'Set a good-through date'}
                </button>
              )}
              {hasOpenLink && (
                <button type="button" className="btn btn-ghost w-full sm:w-auto" onClick={onLinksOff}>
                  <Icon name="lock" className="h-5 w-5" />
                  Turn off the customer link
                </button>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
