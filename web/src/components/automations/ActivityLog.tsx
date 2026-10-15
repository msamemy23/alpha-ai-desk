'use client'
import { useState } from 'react'
import { EmptyBlock, ErrorCard, RowsSkeleton } from '@/components/ListKit'
import { ago } from './parts'
import type { Sent } from './useActivity'

interface Props {
  items: Sent[]
  state: 'loading' | 'ready' | 'error'
  missing: string[]
  onRetry: () => void
}

const SHOWN = 10

/** What automations sent in the last 30 days, with the words when they were saved. */
export default function ActivityLog({ items, state, missing, onRetry }: Props) {
  const [more, setMore] = useState(false)
  const rows = more ? items : items.slice(0, SHOWN)
  return (
    <section aria-labelledby="auto-log">
      <h2 id="auto-log" className="section-title">What went out</h2>
      <p className="mb-3 mt-1 text-[0.9375rem] text-text-secondary">
        Texts and reminders sent by automations in the last 30 days. Promotional texts and automatic lead emails do not keep a record here. Look in your Inbox for those.
      </p>
      {state === 'loading' && <RowsSkeleton rows={3} label="Loading what went out" />}
      {state === 'error' && <ErrorCard title="This list did not load" message="Check your connection and try again." onRetry={onRetry} className="max-w-xl" />}
      {state === 'ready' && (
        <>
          {missing.length > 0 && <p className="mb-2 text-[0.9375rem] text-text-secondary" role="status">Some records could not be read: {missing.join(', ')}. They may be missing from this list.</p>}
          {items.length === 0 ? (
            <EmptyBlock icon="send" title="Nothing has gone out yet">When an automation sends a text, it shows up here with who got it.</EmptyBlock>
          ) : (
            <>
              <ul className="ledger">
                {rows.map(r => (
                  <li key={r.id}>
                    <div className="ledger-row !items-start">
                      <span className={`lamp mt-[0.45rem] ${r.ok ? 'lamp-green' : 'lamp-red'}`} aria-hidden="true" />
                      <span className="ledger-main">
                        <span className="ledger-title block break-words">{r.what} to {r.who}</span>
                        <span className="ledger-sub block break-words">{r.ok ? 'Sent' : `Did not send${r.why ? `: ${r.why}` : ''}`}, {ago(r.at)}</span>
                        {r.words && <span className="mt-0.5 line-clamp-2 block break-words text-[0.9375rem] text-text-secondary">{r.words}</span>}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              {items.length > SHOWN && (
                <button type="button" className="btn btn-secondary mt-3 w-full sm:w-auto" onClick={() => setMore(v => !v)}>
                  {more ? 'Show fewer' : `Show ${items.length - SHOWN} more`}
                </button>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}
