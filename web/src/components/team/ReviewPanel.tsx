'use client'
import { useState } from 'react'
import Icon from '@/components/Icon'
import { addDaysKey, dayLabel, fmtDuration } from '@/lib/timeclock'
import type { Approval, ApprovalState, ReviewFlag } from '@/lib/payroll'

/** Review one person's pay period and approve it. An approved period is locked: its punches cannot be changed until the approval is removed. */
export default function ReviewPanel({ start, days, flags, approval, state, ended, currentMinutes, available, busy, error, onApprove, onUnapprove }: {
  start: string
  days: number
  flags: ReviewFlag[]
  approval: Approval | undefined
  state: ApprovalState
  /** The pay period is over, so it can be approved. */
  ended: boolean
  currentMinutes: number
  /** The database update for approvals has been applied. */
  available: boolean
  busy: boolean
  error: string
  onApprove: (note: string) => void
  onUnapprove: () => void
}) {
  const [note, setNote] = useState('')
  const [confirming, setConfirming] = useState(false)
  const fix = flags.filter(f => f.severity === 'fix')
  const check = flags.filter(f => f.severity === 'check')
  const end = addDaysKey(start, days - 1)

  return (
    <section aria-label="Review and approve" className="mt-5 rounded-md border border-border bg-bg-card p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="section-title">Review and approve</h3>
        {state === 'approved' && <span className="inline-flex items-center gap-1.5 text-[0.9375rem] font-bold"><span className="lamp lamp-green" aria-hidden="true" />Approved</span>}
        {state === 'changed' && <span className="inline-flex items-center gap-1.5 text-[0.9375rem] font-bold"><span className="lamp lamp-amber" aria-hidden="true" />Changed since approved</span>}
        {state === 'open' && <span className="inline-flex items-center gap-1.5 text-[0.9375rem] font-bold"><span className="lamp lamp-off" aria-hidden="true" />Not approved</span>}
      </div>

      {flags.length === 0 ? (
        <p className="mt-2 flex items-center gap-2 text-[0.9375rem]"><Icon name="check" className="h-5 w-5 text-green" />Nothing needs a second look in this period.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {[...fix, ...check].map((f, i) => (
            <li key={i} className="flex items-start gap-2 text-[0.9375rem]">
              <span className={`lamp mt-1.5 shrink-0 ${f.severity === 'fix' ? 'lamp-red' : 'lamp-amber'}`} aria-hidden="true" />
              <span className="min-w-0"><strong>{f.severity === 'fix' ? 'Fix: ' : 'Check: '}</strong>{f.text}</span>
            </li>
          ))}
        </ul>
      )}

      {!available ? (
        <p className="mt-3 text-[0.875rem] text-text-secondary">Approving time needs a database update. Ask whoever set up the app to apply it.</p>
      ) : state === 'approved' || state === 'changed' ? (
        <div className="mt-3 space-y-2">
          <p className="num text-[0.9375rem]">
            Approved with {fmtDuration(approval ? approval.minutes_total : 0)}{approval && approval.approved_at ? ` on ${new Date(approval.approved_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}.
            {approval && approval.note ? ` Note: ${approval.note}` : ''}
          </p>
          {state === 'changed' && <p className="text-[0.9375rem]">The hours are now {fmtDuration(currentMinutes)}. They moved after the approval, so check them and approve again.</p>}
          {state === 'approved' && <p className="text-[0.875rem] text-text-secondary">This pay period is locked. Remove the approval to change a punch.</p>}
          {confirming ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setConfirming(false)}>Keep approved</button>
              <button type="button" className="btn btn-danger" disabled={busy} onClick={() => { setConfirming(false); onUnapprove() }}>{busy ? 'Removing…' : 'Remove approval'}</button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => setConfirming(true)}>Remove approval</button>
              {state === 'changed' && <button type="button" className="btn btn-primary" disabled={busy || fix.length > 0} onClick={() => onApprove(note)}>{busy ? 'Saving…' : 'Approve again'}</button>}
            </div>
          )}
        </div>
      ) : !ended ? (
        <p className="mt-3 text-[0.9375rem] text-text-secondary">This pay period runs to {dayLabel(end)}. It can be approved once it has ended.</p>
      ) : (
        <div className="mt-3 space-y-2">
          <div>
            <label htmlFor="rv-note" className="form-label">Note (optional)</label>
            <input id="rv-note" className="form-input" maxLength={300} autoComplete="off" value={note} onChange={e => setNote(e.target.value)} placeholder="Checked against the paper sheets" />
          </div>
          {fix.length > 0 && <p className="text-[0.875rem] text-text-secondary">Fix the items above first. Then you can approve {fmtDuration(currentMinutes)}.</p>}
          <div className="flex sm:justify-end">
            <button type="button" className="btn btn-primary w-full sm:w-auto" disabled={busy || fix.length > 0} onClick={() => onApprove(note)}>
              <Icon name="check" className="h-5 w-5" />{busy ? 'Approving…' : `Approve ${fmtDuration(currentMinutes)}`}
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="form-error">{error}</p>}
    </section>
  )
}
