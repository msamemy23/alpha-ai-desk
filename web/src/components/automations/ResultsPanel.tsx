'use client'
import { ErrorCard, EmptyBlock } from '@/components/ListKit'
import Notice from '@/components/Notice'
import { Segmented } from '@/components/ScreenParts'
import { iconFor, money, outcomeParts } from './model'
import type { Card, Outcome, Results } from './model'
import Icon from '@/components/Icon'

interface Props {
  state: 'loading' | 'ready' | 'error'
  error: string
  results: Results | null
  cards: Card[]
  days: number
  onDays: (d: number) => void
  onRetry: () => void
}

const RANGES = [{ key: '7', label: 'Last 7 days' }, { key: '30', label: 'Last 30 days' }, { key: '90', label: 'Last 90 days' }]

/** What the automations did, in plain numbers: sent, delivered, replied, booked, and the dollars paid afterwards. */
export default function ResultsPanel({ state, error, results, cards, days, onDays, onRetry }: Props) {
  const delivery = results?.delivery_tracking === true
  return (
    <div>
      <div className="mb-4 max-w-md">
        <Segmented label="Time range" idPrefix="results-range" options={RANGES} value={String(days)} onChange={k => onDays(Number(k))} columns="grid-cols-3" />
      </div>

      {state === 'loading' && !results ? (
        <div className="space-y-3" role="status" aria-busy="true" aria-label="Loading results"><div className="skeleton h-24" /><div className="skeleton h-40" /></div>
      ) : state === 'error' && !results ? (
        <ErrorCard title="The results did not load" message={error || 'Check your connection and try again.'} onRetry={onRetry} />
      ) : results && !results.available ? (
        <Notice kind="info">Results need a database update before they can be counted. Ask your developer to apply it. Automations keep working in the meantime.</Notice>
      ) : results ? (
        <>
          {state === 'error' && <Notice kind="error" className="mb-3">The numbers could not be refreshed. {error}</Notice>}
          {results.total.sent === 0 ? (
            <EmptyBlock icon="reports" title="No messages sent in this time">When automations send texts, you will see here how many were delivered, how many people replied, how many booked, and what they paid.</EmptyBlock>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-5">
                <Big label="Sent" value={results.total.sent.toLocaleString('en-US')} />
                <Big label="Delivered" value={delivery ? results.total.delivered.toLocaleString('en-US') : '–'} hint={delivery ? '' : 'Not reported yet'} />
                <Big label="Replied" value={results.total.replied.toLocaleString('en-US')} />
                <Big label="Booked" value={results.total.booked.toLocaleString('en-US')} />
                <Big label="Paid afterwards" value={money(results.total.revenue)} strong />
              </div>
              <ul className="ledger mt-5" aria-label="Results by automation">
                {cards.filter(c => c.kind === 'engine' && results.by_automation[c.id]).map(c => {
                  const o = results.by_automation[c.id] as Outcome
                  return (
                    <li key={c.id}>
                      <div className="ledger-row">
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-bg-hover text-text-secondary"><Icon name={iconFor(c.icon)} className="h-5 w-5" /></span>
                        <span className="ledger-main">
                          <span className="ledger-title block">{c.name}</span>
                          <span className="ledger-sub !whitespace-normal block">{outcomeParts(o, { delivery, revenue: c.claims_revenue, paid: false }).join(' · ')}</span>
                        </span>
                        {c.claims_revenue && <span className="ledger-amt shrink-0" aria-label={`${money(o.revenue)} paid afterwards`}>{money(o.revenue)}</span>}
                      </div>
                    </li>
                  )
                })}
              </ul>
              <p className="mt-4 max-w-2xl text-[0.875rem] text-text-secondary">
                How this is counted: a reply, booking or payment is credited to the last message that customer got before it, once. Replies count within 7 days, bookings within 14 days and payments within 30 days.
                Reminders and review requests are not credited with bookings or money. One-off promotions are counted on Get more customers.
              </p>
            </>
          )}
        </>
      ) : null}
    </div>
  )
}

function Big({ label, value, hint, strong }: { label: string; value: string; hint?: string; strong?: boolean }) {
  return (
    <div className="bg-bg-card px-3 py-3">
      <p className="text-[0.8125rem] font-bold text-text-secondary">{label}</p>
      <p className={`display num mt-0.5 text-[1.5rem] leading-none ${strong ? 'font-bold' : ''}`}>{value}</p>
      {hint ? <p className="mt-1 text-[0.75rem] text-text-secondary">{hint}</p> : null}
    </div>
  )
}
