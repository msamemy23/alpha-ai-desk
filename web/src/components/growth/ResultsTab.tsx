'use client'
import { useMemo } from 'react'
import { EmptyBlock, ErrorCard } from '@/components/ListKit'
import CampaignResults from './CampaignResults'
import { Section } from './parts'
import { sourceLabel, timeAgo } from './helpers'
import type { Rec } from './helpers'

interface Props {
  loading: boolean
  failed: { customers: boolean; visits: boolean; leads: boolean; referrals: boolean; outreach: boolean; campaigns: boolean }
  customers: Rec[]
  leads: Rec[]
  referrals: Rec[]
  outreach: Rec[]
  campaigns: Rec[]
  quietCount: number
  onRetry: () => void
}

const Missing = () => <p className="text-[0.9375rem] text-text-secondary">This part did not load. Use Try again above.</p>

const METHOD_WORD: Record<string, string> = { sms: 'Text', email: 'Email', ai_call: 'Call by Alpha' }

export default function ResultsTab({ loading, failed, customers, leads, referrals, outreach, campaigns, quietCount, onRetry }: Props) {
  const converted = leads.filter(l => l.status === 'converted').length
  const rate = leads.length ? Math.round((converted / leads.length) * 100) : 0
  const sources = useMemo(() => {
    const m: Record<string, number> = {}
    leads.forEach(l => { const s = l.source || 'manual'; m[s] = (m[s] || 0) + 1 })
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [leads])
  const total = leads.length || 1
  const leadName = useMemo(() => new Map(leads.map(l => [String(l.id), String(l.name || '')])), [leads])
  const count = (m: string) => outreach.filter(o => o.method === m).length
  const asked = customers.filter(c => c.review_requested).length
  const anyFailed = failed.customers || failed.visits || failed.leads || failed.referrals || failed.outreach || failed.campaigns

  return (
    <>
      {anyFailed && <ErrorCard title="Some results did not load" message="The numbers below may be missing some of your data. Check your connection and try again." onRetry={onRetry} busy={loading} className="mb-4" />}
      <CampaignResults />

      <Section title="How it is going">
        {loading ? <div className="skeleton h-24" aria-busy="true" /> : (
          <dl className="panel grid grid-cols-2 sm:grid-cols-4">
            {[
              { label: 'Leads found', value: failed.leads ? '–' : leads.length },
              { label: 'Became customers', value: failed.leads ? '–' : converted },
              { label: 'Lead to customer', value: failed.leads ? '–' : `${rate}%` },
              { label: 'Referral codes', value: failed.referrals ? '–' : referrals.length },
            ].map((s, i) => (
              <div key={s.label} className={`px-4 py-3 ${i < 2 ? 'border-b border-border sm:border-b-0' : ''} ${i % 2 === 0 ? 'border-r border-border sm:border-r-0' : ''} ${i > 0 ? 'sm:border-l sm:border-border' : ''}`}>
                <dt className="text-[0.875rem] font-bold text-text-secondary">{s.label}</dt>
                <dd className="display num text-[1.75rem] font-bold leading-tight">{s.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </Section>

      <Section title="Where leads come from">
        {loading ? <div className="skeleton h-24" aria-busy="true" /> : failed.leads ? <Missing /> : leads.length === 0 ? <EmptyBlock icon="flag" title="No leads yet">Run a search or add a lead and the sources will show here.</EmptyBlock> : (
          <ul className="space-y-3">
            {sources.map(([source, n]) => (
              <li key={source}>
                <div className="mb-1 flex justify-between gap-3 text-[0.9375rem]">
                  <span>{sourceLabel(source)}</span>
                  <span className="num font-bold">{n} <span className="font-normal text-text-secondary">({Math.round((n / total) * 100)}%)</span></span>
                </div>
                <div className="h-2.5 overflow-hidden rounded-full bg-text-primary/10" role="img" aria-label={`${sourceLabel(source)}: ${Math.round((n / total) * 100)} percent of leads`}>
                  <div className="h-full rounded-full bg-blue" style={{ width: `${(n / total) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Messages sent to leads">
        {loading ? <div className="skeleton h-24" aria-busy="true" /> : failed.outreach ? <Missing /> : (
          <>
            <dl className="panel mb-3 grid grid-cols-3 divide-x divide-border">
              {[{ label: 'Texts', value: count('sms') }, { label: 'Emails', value: count('email') }, { label: 'Calls by Alpha', value: count('ai_call') }].map(s => (
                <div key={s.label} className="px-3 py-3 text-center">
                  <dt className="text-[0.875rem] font-bold text-text-secondary">{s.label}</dt>
                  <dd className="display num text-[1.5rem] font-bold leading-tight">{s.value}</dd>
                </div>
              ))}
            </dl>
            {outreach.length === 0 ? <EmptyBlock icon="send" title="Nothing sent yet">Text or email a lead from the Leads view and it will be counted here.</EmptyBlock> : (
              <ul className="ledger">
                {outreach.slice(0, 10).map((o, i) => (
                  <li key={o.id || i}>
                    <div className="ledger-row !min-h-[3.25rem]">
                      <span className="ledger-main"><span className="ledger-title block">{o.lead_name || leadName.get(String(o.lead_id)) || o.to_contact || 'Lead'}</span></span>
                      <span className="tag tag-gray shrink-0 text-[0.8125rem]">{METHOD_WORD[o.method] || String(o.method || '')}</span>
                      <span className="w-24 shrink-0 text-right text-[0.8125rem] text-text-secondary">{timeAgo(o.created_at)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </Section>

      <Section title="At a glance">
        {loading ? <div className="skeleton h-24" aria-busy="true" /> : (
          <dl className="panel grid grid-cols-2 sm:grid-cols-4">
            {[
              { label: 'Customers', value: failed.customers ? '–' : customers.length },
              { label: 'Need a follow-up', value: failed.customers || failed.visits ? '–' : quietCount },
              { label: 'Asked for a review', value: failed.customers ? '–' : asked },
              { label: 'Ad campaigns', value: failed.campaigns ? '–' : campaigns.length },
            ].map((s, i) => (
              <div key={s.label} className={`px-4 py-3 ${i < 2 ? 'border-b border-border sm:border-b-0' : ''} ${i % 2 === 0 ? 'border-r border-border sm:border-r-0' : ''} ${i > 0 ? 'sm:border-l sm:border-border' : ''}`}>
                <dt className="text-[0.875rem] font-bold text-text-secondary">{s.label}</dt>
                <dd className="display num text-[1.75rem] font-bold leading-tight">{s.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </Section>
    </>
  )
}
