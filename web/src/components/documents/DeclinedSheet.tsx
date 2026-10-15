'use client'
import { formatCurrency } from '@/lib/supabase'
import { whenLabel } from '@/lib/doc-history'
import { ErrorMsg, WarnMsg } from './Dialogs'
import type { DeclinedWork } from './api'

const day = (iso: string) => new Date(iso.length <= 10 ? iso + 'T00:00:00' : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/**
 * Work customers said no to, kept so it is not lost. Each one can become a new estimate in one tap, be put off
 * for later, or be dismissed.
 */
export default function DeclinedSheet({ work, available, error, busyId, onMake, onSnooze, onDismiss, onRetry, onClose }: {
  work: DeclinedWork[] | null
  available: boolean
  error: string
  busyId: string | null
  onMake: (w: DeclinedWork) => void
  onSnooze: (w: DeclinedWork) => void
  onDismiss: (w: DeclinedWork) => void
  onRetry: () => void
  onClose: () => void
}) {
  const nowMs = Date.now()
  if (!available) return (
    <div>
      <WarnMsg>Declined work needs a database update first. Ask whoever manages your account to apply it.</WarnMsg>
      <div className="mt-5 flex justify-end"><button type="button" className="btn btn-secondary" onClick={onClose}>Close</button></div>
    </div>
  )
  if (work === null && !error) return <div className="space-y-2" aria-busy="true" aria-label="Loading declined work">{[0, 1, 2].map(i => <div key={i} className="skeleton h-20" />)}</div>
  return (
    <div>
      <p className="text-[0.9375rem] text-text-secondary">When a customer declines a job on an estimate, it is saved here with what it would have cost. Follow up later, or turn it into a new estimate in one tap.</p>
      {error && (
        <div className="mt-3">
          <ErrorMsg>{error}</ErrorMsg>
          <button type="button" className="btn btn-secondary mt-3" onClick={onRetry}>Try again</button>
        </div>
      )}
      {work && work.length === 0 && !error && (
        <div className="empty-state mt-4">
          <p className="font-bold text-text-primary">Nothing declined</p>
          <p className="mx-auto mt-1 max-w-md">Jobs a customer says no to will show up here.</p>
        </div>
      )}
      {work && work.length > 0 && (
        <ul className="mt-4 max-h-[56dvh] space-y-3 overflow-y-auto overscroll-contain">
          {work.map(w => {
            const due = w.remind_after && w.remind_after <= new Date(nowMs).toISOString().slice(0, 10)
            return (
              <li key={w.id} className="card !p-3.5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-bold">{w.job}</p>
                    <p className="text-[0.9375rem] text-text-secondary">{[w.customer_name || 'No customer', w.vehicle].filter(Boolean).join(' · ')}</p>
                    <p className="text-[0.8125rem] text-text-secondary">Declined {whenLabel(w.declined_at, nowMs).toLowerCase()}{w.remind_after ? `. ${due ? 'Time to follow up' : `Follow up ${day(w.remind_after)}`}` : ''}</p>
                  </div>
                  <span className="display num shrink-0 text-[1.0625rem] font-bold">{formatCurrency(Number(w.amount) || 0)}</span>
                </div>
                {Array.isArray(w.lines) && w.lines.length > 0 && (
                  <ul className="mt-2 list-disc pl-5 text-[0.875rem] text-text-secondary">
                    {w.lines.slice(0, 5).map((l, i) => <li key={i} className="break-words">{l.description}</li>)}
                  </ul>
                )}
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" className="btn btn-primary btn-sm" disabled={busyId === w.id} onClick={() => onMake(w)}>Make a new estimate</button>
                  <button type="button" className="btn btn-secondary btn-sm" disabled={busyId === w.id} onClick={() => onSnooze(w)}>Remind me in 30 days</button>
                  <button type="button" className="btn btn-ghost btn-sm" disabled={busyId === w.id} onClick={() => onDismiss(w)}>Dismiss</button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <div className="mt-5 flex justify-end"><button type="button" className="btn btn-secondary" onClick={onClose}>Close</button></div>
    </div>
  )
}
