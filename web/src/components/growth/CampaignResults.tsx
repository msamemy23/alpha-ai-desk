'use client'
import { useCallback, useEffect, useState } from 'react'
import { EmptyBlock, ErrorCard } from '@/components/ListKit'
import Notice from '@/components/Notice'
import { Segmented } from '@/components/ScreenParts'
import { load } from '@/components/automations/api'
import { money, outcomeParts } from '@/components/automations/model'
import type { Outcome, Results } from '@/components/automations/model'
import { CATALOG_BY_ID } from '@/lib/automation-catalog'
import { Section } from './parts'
import type { PromotionView } from './promotions-model'

const RANGES = [{ key: '7', label: '7 days' }, { key: '30', label: '30 days' }, { key: '90', label: '90 days' }]

/** The campaign dashboard: what the texts and emails did, in plain numbers. Sent, delivered, replied, booked, and what was paid afterwards. */
export default function CampaignResults() {
  const [days, setDays] = useState(30)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [results, setResults] = useState<Results | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})

  const reload = useCallback(async (d: number) => {
    const [r, p] = await Promise.all([
      load(`/api/automations/insights?days=${d}`, x => (x.results ?? null) as Results | null),
      load('/api/growth/promotions', x => (Array.isArray(x.promotions) ? x.promotions : []) as PromotionView[]),
    ])
    if (p.ok) setNames(Object.fromEntries(p.value.map(x => [x.id, x.name])))
    if (r.ok) { setResults(r.value); setState('ready'); setError('') } else { setError(r.error); setState(s => (s === 'ready' ? 'ready' : 'error')) }
  }, [])
  useEffect(() => { void reload(days) }, [days, reload])

  const delivery = results?.delivery_tracking === true
  const autos = results ? Object.entries(results.by_automation).filter(([id]) => CATALOG_BY_ID[id]).sort((a, b) => b[1].sent - a[1].sent) : []
  const promos = results ? Object.entries(results.by_campaign).sort((a, b) => b[1].sent - a[1].sent) : []

  return (
    <Section
      title="What your texts and emails did"
      hint="Messages sent by your automations and promotions, and what happened after."
      action={<div className="w-full max-w-xs sm:w-64"><Segmented label="Time range" idPrefix="growth-results-range" options={RANGES} value={String(days)} onChange={k => { setState('loading'); setDays(Number(k)) }} columns="grid-cols-3" /></div>}
    >
      {state === 'loading' && !results ? <div className="space-y-3" role="status" aria-busy="true" aria-label="Loading results"><div className="skeleton h-24" /><div className="skeleton h-32" /></div>
        : state === 'error' && !results ? <ErrorCard title="Message results did not load" message={error || 'Check your connection and try again.'} onRetry={() => { setState('loading'); void reload(days) }} />
        : results && !results.available ? <Notice kind="info">Counting results needs a database update. Ask your developer to apply it. Sending keeps working in the meantime.</Notice>
        : results ? (
          <>
            {state === 'error' && <Notice kind="error" className="mb-3">The numbers could not be refreshed. {error}</Notice>}
            {results.total.sent === 0 ? (
              <EmptyBlock icon="reports" title="No messages sent in this time">Send a promotion or switch on an automation. Here you will see how many were delivered, how many replied, how many booked and what they paid.</EmptyBlock>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border sm:grid-cols-5">
                  <Big label="Sent" value={results.total.sent.toLocaleString('en-US')} />
                  <Big label="Delivered" value={delivery ? results.total.delivered.toLocaleString('en-US') : '–'} hint={delivery ? '' : 'Not reported yet'} />
                  <Big label="Replied" value={results.total.replied.toLocaleString('en-US')} />
                  <Big label="Booked" value={results.total.booked.toLocaleString('en-US')} />
                  <Big label="Paid afterwards" value={money(results.total.revenue)} strong />
                </div>

                {promos.length > 0 && (
                  <>
                    <h3 className="section-title mb-2 mt-6">By promotion</h3>
                    <ul className="ledger" aria-label="Results by promotion">
                      {promos.map(([id, o]) => <Line key={id} title={names[id] || 'A promotion'} o={o} delivery={delivery} revenue />)}
                    </ul>
                  </>
                )}
                {autos.length > 0 && (
                  <>
                    <h3 className="section-title mb-2 mt-6">By automation</h3>
                    <ul className="ledger" aria-label="Results by automation">
                      {autos.map(([id, o]) => <Line key={id} title={CATALOG_BY_ID[id].name} o={o} delivery={delivery} revenue={CATALOG_BY_ID[id].claimsRevenue === true} />)}
                    </ul>
                  </>
                )}
                <p className="mt-4 max-w-2xl text-[0.875rem] text-text-secondary">
                  How this is counted: a reply, booking or payment is credited to the last message that customer got before it, once. Replies count within 7 days, bookings within 14 days and payments within 30 days.
                  Reminders and review requests are not credited with bookings or money.
                </p>
              </>
            )}
          </>
        ) : null}
    </Section>
  )
}

function Line({ title, o, delivery, revenue }: { title: string; o: Outcome; delivery: boolean; revenue: boolean }) {
  return (
    <li>
      <div className="ledger-row">
        <span className="ledger-main">
          <span className="ledger-title block">{title}</span>
          <span className="ledger-sub !whitespace-normal block">{outcomeParts(o, { delivery, revenue, paid: false }).join(' · ')}</span>
        </span>
        {revenue && <span className="ledger-amt shrink-0" aria-label={`${money(o.revenue)} paid afterwards`}>{money(o.revenue)}</span>}
      </div>
    </li>
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
