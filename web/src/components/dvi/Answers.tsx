'use client'
import Link from 'next/link'
import Icon from '@/components/Icon'
import { RATING_WORD, decisionSummary, fmtMoney } from '@/lib/dvi'
import type { Finding } from '@/lib/dvi'
import type { DviRow } from './types'

/** After an inspection is sent: has the customer looked, what did they say, and the next step (an estimate). */
export default function Answers({ row, list, linkAvailable, estimateHref, busy, onCopy, onStop, whenText }: {
  row: DviRow
  list: Finding[]
  linkAvailable: boolean
  estimateHref: string
  busy: boolean
  onCopy: () => void
  onStop: () => void
  whenText: (iso: string | null) => string
}) {
  const sum = decisionSummary(list, row.customer_decisions)
  return (
    <section className="panel mt-4" aria-label="The customer's answers">
      <div className="panel-header"><h2 className="section-title">Customer</h2></div>
      <div className="panel-body">
        <p className="flex flex-wrap items-center gap-x-2 text-[0.9375rem]">
          <span className={`lamp ${sum.answered ? 'lamp-green' : row.viewed_at ? 'lamp-blue' : 'lamp-amber'} shrink-0`} aria-hidden="true" />
          <span className="font-bold">
            {sum.answered ? `Answered ${whenText(row.customer_decided_at)}` : row.viewed_at ? 'Looked at it, no answer yet' : 'Waiting for them to open it'}
          </span>
          {row.sent_at && <span className="text-text-secondary">Texted {whenText(row.sent_at)}</span>}
        </p>

        {sum.answered && (
          <>
            <ul className="ledger mt-3" aria-label="Answers">
              {list.map(f => {
                const d = row.customer_decisions[f.id]
                return (
                  <li key={f.id}>
                    <div className="ledger-row">
                      <span className="ledger-main">
                        <span className="ledger-title block !whitespace-normal">{f.name}</span>
                        <span className="ledger-sub block !whitespace-normal">{RATING_WORD[f.status]}{f.price !== null ? ` · ${fmtMoney(f.price)}` : ''}</span>
                      </span>
                      <span className={`tag shrink-0 ${d === 'approved' ? 'tag-green' : d === 'declined' ? 'tag-gray' : 'tag-amber'}`}>{d === 'approved' ? 'Approved' : d === 'declined' ? 'Declined' : 'No answer'}</span>
                    </div>
                  </li>
                )
              })}
            </ul>
            {sum.approved > 0 && (
              <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-[0.9375rem]"><span className="font-bold">{sum.approved} approved</span>{sum.approvedTotal > 0 ? <> · <span className="num font-bold">{fmtMoney(sum.approvedTotal)}</span> before tax</> : ''}</p>
                <Link href={estimateHref} className="btn btn-primary no-underline"><Icon name="doc" className="h-5 w-5" />Write estimate from approved</Link>
              </div>
            )}
          </>
        )}

        {linkAvailable && row.has_link && (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
            <button type="button" className="btn btn-secondary btn-sm" onClick={onCopy} disabled={busy}><Icon name="copy" className="h-4 w-4" />Copy link</button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onStop} disabled={busy}>Turn the link off</button>
          </div>
        )}
      </div>
    </section>
  )
}
