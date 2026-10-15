'use client'
import { useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import Sheet from '@/components/Sheet'
import { EmptyBlock, SearchField } from '@/components/ListKit'
import { Fact } from '@/components/ScreenParts'
import type { ToastKind } from '@/components/ScreenParts'
import { phonePretty } from '@/lib/today'
import { getAuthJsonHeaders, safeUrl, sourceLabel } from './helpers'
import type { Rec } from './helpers'
import OutreachButtons from './OutreachButtons'
import type { OutreachMethod } from './OutreachButtons'

interface Props {
  title: string
  leads: Rec[]
  scanning: boolean
  scanHint: string
  onClose: () => void
  onOutreach: (lead: Rec, method: OutreachMethod) => void
  onRefresh: () => Promise<void>
  notify: (message: string, kind?: ToastKind) => void
}

const parseJson = (v: unknown): Rec => {
  if (!v) return {}
  if (typeof v !== 'string') return v as Rec
  try { return JSON.parse(v) || {} } catch { return {} }
}

export default function LeadReport({ title, leads, scanning, scanHint, onClose, onOutreach, onRefresh, notify }: Props) {
  const [filter, setFilter] = useState({ size: 'all', industry: 'all', sort: 'score' })
  const [search, setSearch] = useState('')
  const [enriching, setEnriching] = useState<string | null>(null)
  const [bulkEnriching, setBulkEnriching] = useState(false)
  const [openContacts, setOpenContacts] = useState<string | null>(null)

  const industries = useMemo(() => Array.from(new Set(leads.map(l => l.industry || l.business_type || 'Unknown').filter(Boolean))) as string[], [leads])

  const filtered = useMemo(() => {
    const score = (l: Rec) => Number(parseJson(l.deep_research).fleet_score || 0)
    const r = leads.filter(l => {
      if (search && !JSON.stringify(l).toLowerCase().includes(search.toLowerCase())) return false
      if (filter.industry !== 'all' && (l.industry || l.business_type) !== filter.industry) return false
      if (filter.size === 'small' && parseInt(l.fleet_size || l.employee_count || '0') > 10) return false
      if (filter.size === 'large' && parseInt(l.fleet_size || l.employee_count || '0') <= 10) return false
      return true
    })
    if (filter.sort === 'score') r.sort((a, b) => score(b) - score(a))
    if (filter.sort === 'rating') r.sort((a, b) => (b.google_rating || 0) - (a.google_rating || 0))
    if (filter.sort === 'name') r.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    return r
  }, [leads, filter, search])

  const apolloOf = (l: Rec) => { const a = parseJson(l.apollo_data); return Object.keys(a).length ? a : null }

  const enrichLead = async (leadId: string) => {
    setEnriching(leadId)
    try {
      const res = await fetch('/api/growth/apollo-enrich', { method: 'POST', headers: await getAuthJsonHeaders(), body: JSON.stringify({ lead_id: leadId }) })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.success) { notify('Contacts found.', 'success'); await onRefresh() }
      else notify(data.error || 'No contacts were found for this business.', 'error')
    } catch { notify('The contact search did not run. Check your connection and try again.', 'error') }
    setEnriching(null)
  }

  const enrichAll = async () => {
    const ids = filtered.filter(l => !l.apollo_enriched_at).map(l => l.id).filter(Boolean)
    if (!ids.length) { notify('Every business here already has contacts looked up.', 'info'); return }
    setBulkEnriching(true)
    try {
      const res = await fetch('/api/growth/apollo-enrich', { method: 'POST', headers: await getAuthJsonHeaders(), body: JSON.stringify({ bulk_lead_ids: ids }) })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.success) { notify(`Looked up contacts for ${data.enriched || 0} businesses.`, 'success'); await onRefresh() }
      else notify(data.error || 'The contact search did not finish.', 'error')
    } catch { notify('The contact search did not run. Check your connection and try again.', 'error') }
    setBulkEnriching(false)
  }

  const needContacts = filtered.filter(l => !l.apollo_enriched_at && l.id).length

  return (
    <Sheet open onClose={onClose} title={title} wide>
      <p className="-mt-1 mb-3 text-[0.9375rem] text-text-secondary" aria-live="polite">
        {scanning ? scanHint : `${filtered.length} of ${leads.length} ${leads.length === 1 ? 'result' : 'results'}`}
      </p>

      {scanning && <div className="skeleton mb-4 h-2" role="status" aria-label="Searching" />}

      {leads.length > 0 && (
        <div className="mb-4 space-y-2">
          <SearchField value={search} onChange={setSearch} label="Search these results" placeholder="Search these results" />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div>
              <label htmlFor="rep-industry" className="sr-only">Industry</label>
              <select id="rep-industry" className="form-select" value={filter.industry} onChange={e => setFilter(p => ({ ...p, industry: e.target.value }))}>
                <option value="all">Any industry</option>
                {industries.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="rep-size" className="sr-only">Size</label>
              <select id="rep-size" className="form-select" value={filter.size} onChange={e => setFilter(p => ({ ...p, size: e.target.value }))}>
                <option value="all">Any size</option>
                <option value="small">Small (1 to 10)</option>
                <option value="large">Large (11 or more)</option>
              </select>
            </div>
            <div className="col-span-2 sm:col-span-1">
              <label htmlFor="rep-sort" className="sr-only">Sort by</label>
              <select id="rep-sort" className="form-select" value={filter.sort} onChange={e => setFilter(p => ({ ...p, sort: e.target.value }))}>
                <option value="score">Best match first</option>
                <option value="rating">Best rated first</option>
                <option value="name">A to Z</option>
              </select>
            </div>
          </div>
          <button type="button" className="btn btn-secondary w-full sm:w-auto" onClick={enrichAll} disabled={bulkEnriching || needContacts === 0}>
            <Icon name="search" className="h-4 w-4" />
            {bulkEnriching ? 'Finding contacts…' : needContacts === 0 ? 'Contacts found for all' : `Find contacts for ${needContacts} ${needContacts === 1 ? 'business' : 'businesses'}`}
          </button>
        </div>
      )}

      {leads.length === 0 && !scanning && (
        <EmptyBlock icon="search" title="Nothing found yet">Start a search from the Leads view and the results will show up here.</EmptyBlock>
      )}
      {leads.length > 0 && filtered.length === 0 && (
        <EmptyBlock title="No results match">Clear the search or choose &quot;Any&quot; in the filters to see everything.</EmptyBlock>
      )}

      <ul className="space-y-3">
        {filtered.map((l, i) => {
          const nd = parseJson(l.notes)
          const d = parseJson(l.deep_research)
          const score = d.fleet_score || nd.fleet_score
          const annual = d.annual_value_estimate || nd.annual_value_estimate
          const pitch = d.outreach_pitch || nd.outreach_pitch
          const apollo = apolloOf(l)
          const website = safeUrl(l.website)
          const facebook = safeUrl(l.facebook_url)
          const linkedin = safeUrl(l.linkedin_url)
          return (
            <li key={l.id || i} className="rounded-lg border border-border bg-bg-base p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="section-title min-w-0 break-words">{l.name}</h3>
                {l.confidence && <span className={`tag ${l.confidence === 'high' ? 'tag-green' : 'tag-amber'} text-[0.8125rem]`}>{String(l.confidence).charAt(0).toUpperCase() + String(l.confidence).slice(1)} confidence</span>}
                {score && <span className="tag tag-blue text-[0.8125rem]">Match {score} of 10</span>}
              </div>
              {l.owner_name && <p className="mt-0.5 text-[0.9375rem] text-text-secondary">{l.owner_title || 'Owner'}: <span className="font-bold text-text-primary">{l.owner_name}</span></p>}

              {l.id && <div className="mt-3"><OutreachButtons lead={l} onOutreach={onOutreach} /></div>}

              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
                {l.phone && <Fact label="Phone"><a href={`tel:${l.phone}`} className="font-bold text-blue underline-offset-2 hover:underline">{phonePretty(l.phone)}</a></Fact>}
                {l.email && <Fact label="Email"><a href={`mailto:${l.email}`} className="break-all font-bold text-blue underline-offset-2 hover:underline">{l.email}</a></Fact>}
                {l.address && <Fact label="Address">{l.address}</Fact>}
                {l.website && <Fact label="Website">{website ? <a href={website} target="_blank" rel="noopener noreferrer" className="break-all font-bold text-blue underline-offset-2 hover:underline">{String(l.website).replace(/^https?:\/\//i, '')}</a> : String(l.website)}</Fact>}
                {l.google_rating && <Fact label="Google rating">{l.google_rating} stars ({l.google_reviews_count || 'unknown number of'} reviews)</Fact>}
                {l.fleet_size && <Fact label="Fleet size">{l.fleet_size} vehicles</Fact>}
                {l.vehicle_types && <Fact label="Vehicle types">{l.vehicle_types}</Fact>}
                {l.employee_count && <Fact label="Employees">{l.employee_count}</Fact>}
                {l.revenue_estimate && <Fact label="Revenue">{l.revenue_estimate}</Fact>}
                {l.years_in_business && <Fact label="In business">{l.years_in_business} years</Fact>}
                {l.industry && <Fact label="Industry">{l.industry}</Fact>}
                {l.service_area && <Fact label="Service area">{l.service_area}</Fact>}
                {l.has_maintenance_contract !== null && l.has_maintenance_contract !== undefined && (
                  <Fact label="Repair contract">
                    <span className="inline-flex items-center gap-2"><span className={`lamp ${l.has_maintenance_contract ? 'lamp-amber' : 'lamp-green'}`} aria-hidden="true" />{l.has_maintenance_contract ? 'Already has one' : 'None'}</span>
                  </Fact>
                )}
                {l.current_shop && <Fact label="Current shop">{l.current_shop}</Fact>}
                {annual && <Fact label="Yearly value">{annual}</Fact>}
              </dl>

              {l.pain_points && <p className="mt-3 rounded-md bg-bg-hover px-3 py-2 text-[0.9375rem]"><span className="font-bold">Problems they have: </span>{l.pain_points}</p>}
              {pitch && <p className="mt-2 rounded-md bg-bg-hover px-3 py-2 text-[0.9375rem]"><span className="font-bold">What to say: </span>{pitch}</p>}

              {l.id && (
                <div className="mt-3">
                  {apollo ? (
                    <div>
                      <button type="button" className="btn btn-ghost -ml-2" onClick={() => setOpenContacts(openContacts === l.id ? null : l.id)} aria-expanded={openContacts === l.id}>
                        <Icon name="chevronDown" className={`h-4 w-4 transition-transform ${openContacts === l.id ? 'rotate-180' : ''}`} />
                        {openContacts === l.id ? 'Hide' : 'Show'} contacts ({apollo.people_found ?? apollo.contacts?.length ?? 0})
                      </button>
                      {openContacts === l.id && (
                        <ul className="mt-1 space-y-2">
                          {(apollo.contacts || []).map((c: Rec, ci: number) => {
                            const li = safeUrl(c.linkedin)
                            return (
                              <li key={ci} className="rounded-md border border-border px-3 py-2 text-[0.9375rem]">
                                <p className="font-bold">{c.name}{c.title ? <span className="font-normal text-text-secondary"> · {c.title}</span> : null}</p>
                                {c.email && <p><a href={`mailto:${c.email}`} className="break-all text-blue underline-offset-2 hover:underline">{c.email}</a></p>}
                                {c.phone && <p><a href={`tel:${c.phone}`} className="text-blue underline-offset-2 hover:underline">{phonePretty(c.phone)}</a></p>}
                                {li && <p><a href={li} target="_blank" rel="noopener noreferrer" className="text-blue underline-offset-2 hover:underline">LinkedIn page</a></p>}
                              </li>
                            )
                          })}
                          {(apollo.contacts || []).length === 0 && <li className="text-[0.9375rem] text-text-secondary">No contacts were found for this business.</li>}
                        </ul>
                      )}
                    </div>
                  ) : (
                    <button type="button" className="btn btn-secondary" onClick={() => enrichLead(l.id)} disabled={enriching === l.id || bulkEnriching}>
                      <Icon name="search" className="h-4 w-4" />
                      {enriching === l.id ? 'Finding contacts…' : 'Find contacts at this business'}
                    </button>
                  )}
                </div>
              )}

              <div className="mt-3 flex flex-wrap items-center gap-2">
                {facebook && <a href={facebook} target="_blank" rel="noopener noreferrer" className="btn btn-secondary no-underline"><Icon name="globe" className="h-4 w-4" />Facebook page</a>}
                {linkedin && <a href={linkedin} target="_blank" rel="noopener noreferrer" className="btn btn-secondary no-underline"><Icon name="link" className="h-4 w-4" />LinkedIn page</a>}
                {l.source && <span className="tag tag-gray text-[0.8125rem]">{sourceLabel(l.source)}</span>}
              </div>
            </li>
          )
        })}
      </ul>
    </Sheet>
  )
}
