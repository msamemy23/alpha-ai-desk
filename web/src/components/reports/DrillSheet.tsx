'use client'
import Link from 'next/link'
import Icon from '@/components/Icon'
import Sheet from '@/components/Sheet'
import { money2 } from '@/lib/reports'
import type { ReportDoc } from '@/lib/reports'

const fmtDate = (k: string) => (k ? new Date(`${k.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'No date')

/** Where a piece of paperwork opens: invoices and receipts each have their own list. */
export const docHref = (d: Pick<ReportDoc, 'id' | 'type'>): string => `${d.type === 'Receipt' ? '/receipts' : d.type === 'Estimate' ? '/estimates' : '/invoices'}?document=${encodeURIComponent(d.id)}`

export interface DrillTarget { title: string; sub?: string; docs: ReportDoc[]; /** What the right-hand figure on each row is. */ amountLabel?: string; amount?: (d: ReportDoc) => number }

/**
 * The paperwork behind a number. Tap any row to open that invoice. Shows the same invoices the figure was added up from,
 * so what the owner reads here can be checked against what was counted.
 */
export default function DrillSheet({ target, onClose }: { target: DrillTarget | null; onClose: () => void }) {
  const docs = target ? [...target.docs].sort((a, b) => b.date.localeCompare(a.date) || b.total - a.total) : []
  const show = docs.slice(0, 200)
  const amount = target?.amount ?? ((d: ReportDoc) => d.total)
  const total = Math.round(docs.reduce((s, d) => s + amount(d), 0) * 100) / 100
  return (
    <Sheet open={!!target} onClose={onClose} title={target?.title || 'Invoices'} wide>
      {target && (
        <div>
          {target.sub && <p className="mb-2 text-[0.9375rem] text-text-secondary">{target.sub}</p>}
          <p className="mb-3 text-[0.9375rem]"><span className="font-bold">{docs.length}</span> {docs.length === 1 ? 'document' : 'documents'}, <span className="num font-bold">{money2(total)}</span> {target.amountLabel || 'total'}</p>
          {docs.length === 0 ? (
            <p className="text-text-secondary">Nothing was counted in this figure.</p>
          ) : (
            <ul className="ledger max-h-[60vh] overflow-y-auto">
              {show.map(d => (
                <li key={d.id}>
                  <Link href={docHref(d)} className="ledger-row">
                    <span className="ledger-main">
                      <span className="ledger-title block">{d.customer || 'No customer name'}</span>
                      <span className="ledger-sub !whitespace-normal block">{[d.type, d.number, fmtDate(d.date), d.vehicle].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="ledger-amt">{money2(amount(d))}</span>
                    <Icon name="chevronRight" className="h-5 w-5 shrink-0 text-text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {docs.length > show.length && <p className="mt-3 text-[0.875rem] text-text-secondary">Showing the first {show.length} of {docs.length}. Pick a shorter period to see the rest.</p>}
        </div>
      )}
    </Sheet>
  )
}
