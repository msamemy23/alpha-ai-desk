'use client'
import { useEffect, useRef } from 'react'
import Notice from '@/components/Notice'
import { FILE_WORDS, viewApproval } from './approval'
import { StatusLine } from './parts'
import type { PendingApproval } from './live'

/** The words on the approve button for where the request is up to. */
export function approveButtonText(phase: PendingApproval['phase'], normal: string): string {
  if (phase === 'deciding') return 'Approving…'
  if (phase === 'sending') return 'Sending…'
  if (phase === 'retry') return 'Try again'
  return normal
}

/**
 * Anything that sends, buys, agrees, deletes or saves a file stops here and shows exactly what will happen.
 * Nothing happens until Approve is pressed. The request is for this one action and lasts 10 minutes.
 */
export default function ApprovalCard({
  pending, onApprove, onDeny,
}: { pending: PendingApproval; onApprove: () => void; onDeny: () => void }) {
  const ref = useRef<HTMLElement>(null)
  const view = viewApproval(pending.details, pending.actor)
  const busy = pending.phase === 'deciding' || pending.phase === 'sending'

  // When the card appears, keyboard and screen reader users land on it.
  useEffect(() => { ref.current?.focus() }, [])

  return (
    <section
      ref={ref}
      tabIndex={-1}
      role="group"
      aria-labelledby="browser-approval-title"
      aria-busy={busy}
      className="card border-amber/60 outline-none"
    >
      <StatusLine lamp="amber">Waiting for your OK</StatusLine>
      <h3 id="browser-approval-title" className="section-title mt-2 break-words">{view.title}</h3>
      <p className="mt-1 text-[0.875rem] text-text-secondary">{view.asker}</p>
      <p className="mt-3 break-words text-[1rem] leading-snug text-text-primary">{view.headline}</p>

      <dl className="mt-3 space-y-2 text-[0.9375rem]">
        {view.host && (
          <div className="min-w-0">
            <dt className="text-[0.8125rem] font-bold text-text-secondary">Website</dt>
            <dd className="break-words">{view.host}</dd>
          </div>
        )}
        {view.address && (
          <div className="min-w-0">
            <dt className="text-[0.8125rem] font-bold text-text-secondary">Address</dt>
            <dd className="break-all">{view.address}</dd>
          </div>
        )}
        {view.fields.length > 0 && (
          <div className="min-w-0">
            <dt className="text-[0.8125rem] font-bold text-text-secondary">What will be sent</dt>
            <dd>
              <ul className="mt-1 divide-y divide-[rgb(var(--c-border))] rounded-md border border-border">
                {view.fields.map((f, i) => (
                  <li key={i} className="flex flex-wrap gap-x-3 px-3 py-2">
                    <span className="font-bold">{f.label}</span>
                    <span className="min-w-0 break-words text-text-secondary">{f.value || 'Left empty'}</span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
      </dl>

      {view.why && <p className="mt-3 break-words text-[0.9375rem] text-text-secondary">{view.why}</p>}
      {pending.details.kind === 'download' && <p className="mt-2 text-[0.9375rem] text-text-secondary">{FILE_WORDS}</p>}
      <p className="mt-2 text-[0.875rem] text-text-secondary">{view.lasts}</p>

      {pending.error && <Notice kind={pending.phase === 'retry' ? 'warn' : 'error'} className="mt-3">{pending.error}</Notice>}

      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <button type="button" className="btn btn-primary w-full sm:w-auto" onClick={onApprove} disabled={busy}>
          {approveButtonText(pending.phase, view.approve)}
        </button>
        <button type="button" className="btn btn-secondary w-full sm:w-auto" onClick={onDeny} disabled={busy}>{view.deny}</button>
      </div>
    </section>
  )
}
