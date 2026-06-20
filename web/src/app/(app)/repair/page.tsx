'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { RepairSearchResult, RepairSource, RepairVehicle } from '@/lib/repair/sources'

const CATEGORIES = [
  { value: 'all', label: 'All' },
  { value: 'manual', label: 'Manuals' },
  { value: 'procedure', label: 'Procedures' },
  { value: 'diagram', label: 'Diagrams' },
  { value: 'spec', label: 'Specs' },
  { value: 'labor', label: 'Labor' },
  { value: 'tsb', label: 'TSBs' },
  { value: 'recall', label: 'Recalls' },
  { value: 'oem_link', label: 'OEM Links' },
]

const EXAMPLES = [
  '2004 Honda Civic front brakes',
  '2018 Jeep Wrangler coolant tank turn signal bulbs',
  '2005 Honda Civic front lower control arms',
  'P0420 2012 Honda Accord diagnostic procedure',
]

type SavedDraft = {
  id: string
  title: string
  operation: string
  vehicle: string
  checklist: string[]
  sourceUrls: string[]
  savedAt: string
}

async function getAuthJsonHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

function vehicleText(vehicle: RepairVehicle) {
  return [vehicle.year, vehicle.make, vehicle.model, vehicle.engine].filter(Boolean).join(' ').trim() || 'Vehicle not fully identified'
}

function confidenceText(value: RepairSource['confidence']) {
  switch (value) {
    case 'official_government': return 'Official government'
    case 'official_oem_index': return 'OEM index'
    case 'public_manual': return 'Public manual'
    case 'source_directory': return 'Source directory'
    case 'shop_draft': return 'Shop draft'
    default: return 'Search result'
  }
}

function providerTone(provider: RepairSource['provider']) {
  if (provider === 'LEMON') return 'border-green/30 bg-green/10 text-green'
  if (provider === 'CHARM') return 'border-blue/30 bg-blue/10 text-blue'
  if (provider === 'NHTSA') return 'border-amber/30 bg-amber/10 text-amber'
  if (provider === 'OEM1Stop') return 'border-purple-400/30 bg-purple-400/10 text-purple-300'
  return 'border-white/10 bg-white/[0.04] text-text-secondary'
}

function buildEstimatePrompt(result: RepairSearchResult) {
  const lines = [
    `Build a draft estimate from this source-backed repair research.`,
    `Vehicle: ${vehicleText(result.normalizedVehicle)}`,
    `Operation: ${result.draft.operation}`,
    `Status: technician review required before final labor/specs.`,
    '',
    'Internal repair checklist:',
    ...result.draft.checklist.map(item => `- ${item}`),
    '',
    'Source links:',
    ...result.sources.slice(0, 8).map(item => `- ${item.provider} ${item.category}: ${item.title} ${item.url}`),
    '',
    'Do not invent torque specs, procedures, labor hours, or prices. Use source links and ask for missing verification.',
  ]
  return lines.join('\n')
}

function sourceSummary(source: RepairSource) {
  return `${source.provider} ${source.category}: ${source.title}\n${source.url}`
}

export default function RepairPage() {
  const [query, setQuery] = useState('')
  const [vehicle, setVehicle] = useState<RepairVehicle>({ year: '', make: '', model: '', engine: '', vin: '' })
  const [result, setResult] = useState<RepairSearchResult | null>(null)
  const [category, setCategory] = useState('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [savedDrafts, setSavedDrafts] = useState<SavedDraft[]>([])

  useEffect(() => {
    try {
      const raw = localStorage.getItem('alpha_repair_drafts')
      if (raw) setSavedDrafts(JSON.parse(raw))
    } catch {
      setSavedDrafts([])
    }
  }, [])

  const filteredSources = useMemo(() => {
    const sources = result?.sources || []
    if (category === 'all') return sources
    return sources.filter(item => item.category === category)
  }, [result, category])

  const sourceCounts = useMemo(() => {
    const counts = result?.counts || {}
    return CATEGORIES.map(item => ({
      ...item,
      count: item.value === 'all' ? (result?.sources.length || 0) : Number(counts[item.value as keyof typeof counts] || 0),
    }))
  }, [result])

  const runSearch = async (override?: string) => {
    const requested = (override || query).trim()
    const combined = [
      vehicle.vin,
      vehicle.year,
      vehicle.make,
      vehicle.model,
      vehicle.engine,
      requested,
    ].filter(Boolean).join(' ').trim()
    if (!combined) return
    setLoading(true)
    setError('')
    setResult(null)
    setCategory('all')
    try {
      const res = await fetch('/api/repair-search', {
        method: 'POST',
        headers: await getAuthJsonHeaders(),
        body: JSON.stringify({ query: combined, vehicle }),
        signal: AbortSignal.timeout(60000),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || 'Repair lookup failed')
      setResult(data.data)
      if (override) setQuery(override)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Repair lookup failed')
    } finally {
      setLoading(false)
    }
  }

  const sendToAlpha = () => {
    if (!result) return
    localStorage.setItem('ai_prefill', buildEstimatePrompt(result))
    window.location.href = '/ai'
  }

  const saveDraft = () => {
    if (!result) return
    const draft: SavedDraft = {
      id: `${Date.now()}`,
      title: result.draft.title,
      operation: result.draft.operation,
      vehicle: vehicleText(result.normalizedVehicle),
      checklist: result.draft.checklist,
      sourceUrls: result.sources.slice(0, 10).map(item => item.url),
      savedAt: new Date().toISOString(),
    }
    const next = [draft, ...savedDrafts].slice(0, 20)
    setSavedDrafts(next)
    localStorage.setItem('alpha_repair_drafts', JSON.stringify(next))
  }

  const copySources = async () => {
    if (!result) return
    await navigator.clipboard.writeText(result.sources.map(sourceSummary).join('\n\n'))
  }

  const removeDraft = (id: string) => {
    const next = savedDrafts.filter(item => item.id !== id)
    setSavedDrafts(next)
    localStorage.setItem('alpha_repair_drafts', JSON.stringify(next))
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 animate-fade-in space-y-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.18em] text-blue">Repair Intelligence</div>
          <h1 className="mt-2 text-2xl font-black tracking-tight">Repair</h1>
          <p className="mt-2 max-w-4xl text-sm leading-6 text-text-secondary">
            Source-backed repair research using LEMON, CHARM, NHTSA, OEM1Stop, AutoZone links, and shop-reviewed draft cards.
            Specs, procedures, labor, and wiring must be verified from the source before work starts.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-secondary btn-sm" onClick={copySources} disabled={!result}>Copy Sources</button>
          <button className="btn btn-secondary btn-sm" onClick={saveDraft} disabled={!result}>Save Draft</button>
          <button className="btn btn-primary btn-sm" onClick={sendToAlpha} disabled={!result}>Build Estimate Draft</button>
        </div>
      </div>

      <section className="rounded-lg border border-border bg-bg-card p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
          <input className="form-input" placeholder="VIN" value={vehicle.vin || ''} onChange={e => setVehicle(v => ({ ...v, vin: e.target.value }))} />
          <input className="form-input" placeholder="Year" value={vehicle.year || ''} onChange={e => setVehicle(v => ({ ...v, year: e.target.value }))} />
          <input className="form-input" placeholder="Make" value={vehicle.make || ''} onChange={e => setVehicle(v => ({ ...v, make: e.target.value }))} />
          <input className="form-input" placeholder="Model" value={vehicle.model || ''} onChange={e => setVehicle(v => ({ ...v, model: e.target.value }))} />
          <input className="form-input" placeholder="Engine / trim" value={vehicle.engine || ''} onChange={e => setVehicle(v => ({ ...v, engine: e.target.value }))} />
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto]">
          <input
            className="form-input"
            placeholder="Search repair, DTC, symptom, component, procedure..."
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void runSearch() }}
          />
          <button className="btn btn-primary min-h-10" onClick={() => void runSearch()} disabled={loading}>
            {loading ? 'Searching...' : 'Search Repair Sources'}
          </button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map(example => (
            <button
              key={example}
              className="rounded-md border border-border bg-bg-hover px-3 py-2 text-xs font-bold text-text-secondary transition-colors hover:border-blue/40 hover:text-text-primary"
              onClick={() => void runSearch(example)}
            >
              {example}
            </button>
          ))}
        </div>
      </section>

      {error && <div className="rounded-lg border border-red/30 bg-red/10 p-4 text-sm text-red">{error}</div>}

      {result && (
        <>
          <section className="grid grid-cols-1 gap-3 lg:grid-cols-4">
            <div className="rounded-lg border border-border bg-bg-card p-4">
              <div className="text-xs font-black uppercase text-text-muted">Vehicle</div>
              <div className="mt-2 text-lg font-black">{vehicleText(result.normalizedVehicle)}</div>
              <div className="mt-2 text-xs text-text-secondary">{result.normalizedVehicle.vin || 'No VIN decoded'}</div>
            </div>
            <div className="rounded-lg border border-border bg-bg-card p-4">
              <div className="text-xs font-black uppercase text-text-muted">Sources</div>
              <div className="mt-2 text-3xl font-black">{result.sources.length}</div>
              <div className="mt-1 text-xs text-text-secondary">Free/public source cards</div>
            </div>
            <div className="rounded-lg border border-border bg-bg-card p-4">
              <div className="text-xs font-black uppercase text-text-muted">Manual Coverage</div>
              <div className="mt-2 text-3xl font-black">{(result.counts.manual || 0) + (result.counts.procedure || 0)}</div>
              <div className="mt-1 text-xs text-text-secondary">LEMON/CHARM and guide links</div>
            </div>
            <div className="rounded-lg border border-border bg-bg-card p-4">
              <div className="text-xs font-black uppercase text-text-muted">Safety Status</div>
              <div className="mt-2 text-sm font-black text-amber">Tech review required</div>
              <div className="mt-1 text-xs text-text-secondary">No invented specs or procedures</div>
            </div>
          </section>

          {result.warnings.length > 0 && (
            <div className="rounded-lg border border-amber/30 bg-amber/10 p-4 text-sm text-amber">
              {result.warnings.join(' ')}
            </div>
          )}

          <section className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {sourceCounts.map(item => (
                  <button
                    key={item.value}
                    className={`rounded-md border px-3 py-2 text-xs font-black transition-colors ${category === item.value ? 'border-blue/50 bg-blue/15 text-blue' : 'border-border bg-bg-card text-text-secondary hover:border-blue/40'}`}
                    onClick={() => setCategory(item.value)}
                  >
                    {item.label} {item.count}
                  </button>
                ))}
              </div>

              <div className="space-y-3">
                {filteredSources.map(item => (
                  <article key={item.id} className="rounded-lg border border-border bg-bg-card p-4">
                    <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-md border px-2 py-1 text-[11px] font-black ${providerTone(item.provider)}`}>{item.provider}</span>
                          <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] font-black text-text-secondary">{item.category}</span>
                          <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] font-black text-text-secondary">{confidenceText(item.confidence)}</span>
                        </div>
                        <h2 className="mt-3 text-base font-black">{item.title}</h2>
                        <p className="mt-2 text-sm leading-6 text-text-secondary">{item.description}</p>
                        <a className="mt-2 block truncate text-xs text-blue hover:underline" href={item.url} target="_blank" rel="noreferrer">{item.url}</a>
                      </div>
                      <a className="btn btn-secondary btn-sm shrink-0" href={item.url} target="_blank" rel="noreferrer">Open Source</a>
                    </div>
                  </article>
                ))}
                {filteredSources.length === 0 && (
                  <div className="rounded-lg border border-border bg-bg-card p-8 text-center text-sm text-text-muted">No source cards in this category.</div>
                )}
              </div>
            </div>

            <aside className="space-y-4">
              <section className="rounded-lg border border-border bg-bg-card p-4">
                <div className="text-xs font-black uppercase text-blue">Shop Draft</div>
                <h2 className="mt-2 text-lg font-black">{result.draft.title}</h2>
                <div className="mt-2 rounded-md border border-amber/30 bg-amber/10 px-3 py-2 text-xs font-bold text-amber">Technician verification required</div>
                <div className="mt-4 text-sm font-black">Checklist</div>
                <ul className="mt-2 space-y-2 text-sm text-text-secondary">
                  {result.draft.checklist.map(item => <li key={item} className="leading-6">- {item}</li>)}
                </ul>
                <div className="mt-4 text-sm font-black">Estimate Notes</div>
                <ul className="mt-2 space-y-2 text-sm text-text-secondary">
                  {result.draft.estimateNotes.map(item => <li key={item} className="leading-6">- {item}</li>)}
                </ul>
              </section>

              <section className="rounded-lg border border-border bg-bg-card p-4">
                <div className="text-xs font-black uppercase text-text-muted">Saved Drafts</div>
                <div className="mt-3 space-y-2">
                  {savedDrafts.length === 0 && <div className="text-sm text-text-muted">No local repair drafts saved yet.</div>}
                  {savedDrafts.map(item => (
                    <div key={item.id} className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
                      <div className="text-sm font-black">{item.title}</div>
                      <div className="mt-1 text-xs text-text-muted">{new Date(item.savedAt).toLocaleString()}</div>
                      <button className="mt-2 text-xs font-bold text-red hover:underline" onClick={() => removeDraft(item.id)}>Remove</button>
                    </div>
                  ))}
                </div>
              </section>
            </aside>
          </section>
        </>
      )}

      {!result && !loading && !error && (
        <section className="rounded-lg border border-border bg-bg-card p-8">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div>
              <div className="text-sm font-black">Source-backed</div>
              <p className="mt-2 text-sm leading-6 text-text-secondary">Uses free public repair/manual directories and official government/OEM indexes. No blind copied ALLDATA content.</p>
            </div>
            <div>
              <div className="text-sm font-black">After-2014 coverage</div>
              <p className="mt-2 text-sm leading-6 text-text-secondary">LEMON is preferred for newer vehicles and CHARM is included for older 1982-2013 depth.</p>
            </div>
            <div>
              <div className="text-sm font-black">Shop-owned procedures</div>
              <p className="mt-2 text-sm leading-6 text-text-secondary">Draft cards are marked for tech review and can become your own internal procedures after verification.</p>
            </div>
          </div>
        </section>
      )}
    </div>
  )
}
