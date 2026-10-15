'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { EmptyBlock, ErrorCard, FilterChips, RowsSkeleton, SearchField } from '@/components/ListKit'
import { Switch } from '@/components/ScreenParts'
import { phonePretty } from '@/lib/today'
import { Section } from './parts'
import OutreachButtons from './OutreachButtons'
import type { OutreachMethod } from './OutreachButtons'
import { AI_SOURCES, isAiLead, leadStatus, sourceLabel, timeAgo } from './helpers'
import type { Rec } from './helpers'

export type ScanKind = 'competitor' | 'social' | 'fleet'
export const SCANS: Record<ScanKind, { source: string; endpoint: string; title: string; icon: string; hint: string; failure: string; desc: (place: string) => string }> = {
  competitor: { source: 'ai-competitor-scan', endpoint: '/api/growth/ai-competitor-leads', title: 'Unhappy customers of other shops', icon: 'frown', hint: 'Looking at nearby shops and their reviews. This takes about a minute.', failure: 'The search did not finish', desc: () => 'Pulls the owner, reviews and a message you can send.' },
  social: { source: 'ai-social-scan', endpoint: '/api/growth/ai-social-leads', title: 'People posting about car trouble', icon: 'inbox', hint: 'Reading recent social posts. This takes about a minute.', failure: 'The search did not finish', desc: place => `People near ${place} asking for help with their car.` },
  fleet: { source: 'ai-fleet-scan', endpoint: '/api/growth/ai-fleet-leads', title: 'Businesses with vehicle fleets', icon: 'vehicle', hint: 'Researching local businesses that run vehicles. This takes about a minute.', failure: 'The search did not finish', desc: () => 'Owner, fleet size, vehicles and contracts for local businesses.' },
}

type StatusFilter = 'all' | 'new' | 'contacted' | 'converted' | 'not_interested'

interface Props {
  loading: boolean
  failed: boolean
  leads: Rec[]
  onRetry: () => void
  city: { search: string; label: string } | null
  cityReady: boolean
  scanning: ScanKind | null
  onScan: (kind: ScanKind) => void
  onLookup: () => void
  aiMode: boolean
  onAiMode: (on: boolean) => void
  onAdd: () => void
  onEdit: (lead: Rec) => void
  onOutreach: (lead: Rec, method: OutreachMethod) => void
  onReport: (title: string, sources: string[]) => void
  callState: 'idle' | 'loading' | 'error' | 'ready'
  callHistory: Rec[]
  onRetryCalls: () => void
  syncing: boolean
  onSync: () => void
}

export default function LeadsTab(p: Props) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const [callsOpen, setCallsOpen] = useState(false)
  const counts = useMemo(() => {
    const c: Record<StatusFilter, number> = { all: p.leads.length, new: 0, contacted: 0, converted: 0, not_interested: 0 }
    for (const l of p.leads) { const s = String(l.status || 'new'); if (s in c) c[s as StatusFilter] += 1 }
    return c
  }, [p.leads])
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    const digits = q.replace(/\D/g, '')
    return p.leads.filter(l => {
      if (status !== 'all' && String(l.status || 'new') !== status) return false
      if (!q) return true
      return String(l.name || '').toLowerCase().includes(q) || String(l.email || '').toLowerCase().includes(q) || (digits.length > 2 && String(l.phone || '').replace(/\D/g, '').includes(digits))
    })
  }, [p.leads, search, status])
  const noCity = p.cityReady && !p.city
  const place = p.city?.label || 'your area'

  return (
    <>
      <Section title="Find new customers" hint="Alpha searches for you. Each search takes about a minute and saves what it finds as leads. Nobody is contacted until you say so.">
        {noCity && (
          <Notice kind="warn" className="mb-3">
            Alpha needs your shop’s city to search near you. <Link href="/onboarding" className="font-bold text-blue underline underline-offset-2">Add it in the setup guide</Link>
          </Notice>
        )}
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(SCANS) as ScanKind[]).map(kind => (
            <li key={kind}>
              <button type="button" onClick={() => p.onScan(kind)} disabled={p.scanning !== null || !p.city} className="flex h-full min-h-[5rem] w-full items-start gap-3 rounded-lg border border-border bg-bg-card p-4 text-left hover:bg-bg-hover disabled:opacity-60">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-bg-hover text-text-secondary"><Icon name={SCANS[kind].icon} className="h-5 w-5" /></span>
                <span className="min-w-0">
                  <span className="block font-bold leading-tight">{p.scanning === kind ? 'Searching…' : `Find ${SCANS[kind].title.charAt(0).toLowerCase()}${SCANS[kind].title.slice(1)}`}</span>
                  <span className="mt-1 block text-[0.875rem] text-text-secondary">{SCANS[kind].desc(place)}</span>
                </span>
              </button>
            </li>
          ))}
          <li>
            <button type="button" onClick={p.onLookup} className="flex h-full min-h-[5rem] w-full items-start gap-3 rounded-lg border border-border bg-bg-card p-4 text-left hover:bg-bg-hover">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-bg-hover text-text-secondary"><Icon name="search" className="h-5 w-5" /></span>
              <span className="min-w-0">
                <span className="block font-bold leading-tight">Look up a person</span>
                <span className="mt-1 block text-[0.875rem] text-text-secondary">Search a name or business for a phone, email or social page.</span>
              </span>
            </button>
          </li>
        </ul>
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-border bg-bg-card p-3">
          <Switch checked={p.aiMode} onChange={p.onAiMode} label="Let Alpha draft the message" />
          <div className="min-w-0 pt-2.5">
            <p className="font-bold leading-tight">Let Alpha draft the message</p>
            <p className="mt-0.5 text-[0.875rem] text-text-secondary">{p.aiMode ? 'On: Alpha writes a draft each time you text or email a lead. You read and edit it before it goes.' : 'Off: texts and emails start from our standard words. You can edit them before they go.'}</p>
          </div>
        </div>
      </Section>

      <Section
        title={`Your leads${!p.loading && !p.failed ? ` (${p.leads.length})` : ''}`}
        action={(
          <div className="toolbar">
            {p.leads.some(isAiLead) && (
              <button type="button" className="btn btn-secondary" onClick={() => p.onReport('Everything Alpha found', [...AI_SOURCES])}>
                <Icon name="list" className="h-5 w-5" />Full report
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={p.onAdd}><Icon name="plus" className="h-5 w-5" />Add a lead</button>
          </div>
        )}
      >
        {p.failed ? <ErrorCard title="Your leads did not load" message="Check your connection and try again." onRetry={p.onRetry} busy={p.loading} />
          : p.loading ? <RowsSkeleton rows={4} label="Loading leads" />
          : p.leads.length === 0 ? (
            <EmptyBlock icon="flag" title="No leads yet" action={<button type="button" className="btn btn-primary" onClick={p.onAdd}><Icon name="plus" className="h-5 w-5" />Add a lead</button>}>
              Run one of the searches above, or add someone who walked in or called.
            </EmptyBlock>
          ) : (
            <>
              <SearchField className="mb-3 max-w-md" value={search} onChange={setSearch} label="Search your leads" placeholder="Search leads by name, phone or email" />
              <div className="mb-3">
                <FilterChips<StatusFilter>
                  label="Show leads that are"
                  scroll
                  value={status}
                  onChange={setStatus}
                  options={[
                    { key: 'all', label: 'All', count: counts.all },
                    { key: 'new', label: 'New', count: counts.new },
                    { key: 'contacted', label: 'Contacted', count: counts.contacted },
                    { key: 'converted', label: 'Customers', count: counts.converted },
                    { key: 'not_interested', label: 'Not interested', count: counts.not_interested },
                  ]}
                />
              </div>
              {shown.length === 0 ? (
                <EmptyBlock title="No leads match">Clear the search or choose All to see everyone.</EmptyBlock>
              ) : (
                <ul className="ledger">
                  {shown.map(l => {
                    const st = leadStatus(l.status)
                    return (
                      <li key={l.id} className="px-3 py-3">
                        <div className="flex items-start gap-3">
                          <span className={`lamp lamp-${st.lamp} mt-[0.45rem]`} aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-bold leading-tight">
                              <span className="break-words">{l.name}</span>
                              {isAiLead(l) && <span className="tag tag-gray text-[0.8125rem]">Found by Alpha</span>}
                            </p>
                            <p className="text-[0.9375rem] text-text-secondary">{st.word}{l.last_contact && l.status === 'contacted' ? ` ${timeAgo(l.last_contact)}` : ''} · {sourceLabel(l.source)} · {l.service_needed || 'General repair'}{l.fleet_size ? ` · ${l.fleet_size} vehicles` : ''}</p>
                            {(l.phone || l.email || l.owner_name) && <p className="break-words text-[0.9375rem] text-text-secondary">{[l.owner_name, l.phone ? phonePretty(l.phone) : '', l.email].filter(Boolean).join(' · ')}</p>}
                          </div>
                          <button type="button" className="btn btn-ghost -mr-2 shrink-0" onClick={() => p.onEdit(l)} aria-label={`Edit ${l.name}`}>Edit</button>
                        </div>
                        <div className="mt-2 sm:pl-[1.65rem]">
                          <OutreachButtons lead={l} onOutreach={p.onOutreach} />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          )}
      </Section>

      <Section
        title="Recent calls"
        hint="Calls to and from your shop number."
        action={<button type="button" className="btn btn-secondary" onClick={p.onSync} disabled={p.syncing}><Icon name="refresh" className="h-5 w-5" />{p.syncing ? 'Syncing…' : 'Sync calls'}</button>}
      >
        {p.callState === 'loading' || p.callState === 'idle' ? <RowsSkeleton rows={3} label="Loading calls" />
          : p.callState === 'error' ? <ErrorCard title="Your calls did not load" message="Check your connection and try again." onRetry={p.onRetryCalls} />
          : p.callHistory.length === 0 ? <EmptyBlock icon="phone" title="No calls yet">Tap Sync calls to pull in your recent calls.</EmptyBlock>
          : (
            <>
              <ul className="ledger">
                {p.callHistory.slice(0, callsOpen ? 50 : 8).map(c => {
                  const inbound = c.direction === 'inbound'
                  const secs = Number(c.duration_secs) || 0
                  const other = String(inbound ? c.from_number || '' : c.to_number || '')
                  return (
                    <li key={c.id}>
                      <div className="ledger-row">
                        <Icon name="phone" className="h-5 w-5 shrink-0 text-text-secondary" />
                        <span className="ledger-main">
                          <span className="ledger-title block">{c.matched_customer_name || phonePretty(other) || 'Unknown caller'}</span>
                          <span className="ledger-sub block">{inbound ? 'Incoming' : 'Outgoing'}{secs ? ` · ${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}` : ' · Not answered'}{c.matched_customer_name && other ? ` · ${phonePretty(other)}` : ''}</span>
                        </span>
                        <span className="shrink-0 text-right text-[0.8125rem] text-text-secondary">{c.start_time ? new Date(c.start_time).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}</span>
                      </div>
                    </li>
                  )
                })}
              </ul>
              {p.callHistory.length > 8 && <button type="button" className="btn btn-secondary mt-3 w-full sm:w-auto" onClick={() => setCallsOpen(o => !o)}>{callsOpen ? 'Show fewer calls' : `Show all ${Math.min(p.callHistory.length, 50)} calls`}</button>}
            </>
          )}
      </Section>
    </>
  )
}
