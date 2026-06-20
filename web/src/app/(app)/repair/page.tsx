'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { RepairManualPage, RepairSearchResult, RepairSource, RepairVehicle } from '@/lib/repair/sources'

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

function isManualProvider(source: RepairSource) {
  return source.provider === 'LEMON' || source.provider === 'CHARM'
}

function workflowTone(status: string) {
  if (status === 'ready') return 'border-green/30 bg-green/10 text-green'
  if (status === 'needs_source') return 'border-amber/30 bg-amber/10 text-amber'
  return 'border-blue/30 bg-blue/10 text-blue'
}

export default function RepairPage() {
  const [query, setQuery] = useState('')
  const [vehicle, setVehicle] = useState<RepairVehicle>({ year: '', make: '', model: '', engine: '', vin: '' })
  const [result, setResult] = useState<RepairSearchResult | null>(null)
  const [category, setCategory] = useState('all')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [savedDrafts, setSavedDrafts] = useState<SavedDraft[]>([])
  const [manualPage, setManualPage] = useState<RepairManualPage | null>(null)
  const [manualLoading, setManualLoading] = useState(false)
  const [manualError, setManualError] = useState('')
  const [selectedManualUrl, setSelectedManualUrl] = useState('')
  const [pinnedSources, setPinnedSources] = useState<RepairSource[]>([])
  const [readerFilter, setReaderFilter] = useState('')

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

  const filteredManualLinks = useMemo(() => {
    const links = manualPage?.links || []
    const filter = readerFilter.trim().toLowerCase()
    if (!filter) return links
    return links.filter(item => `${item.title} ${item.category}`.toLowerCase().includes(filter))
  }, [manualPage, readerFilter])

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
    setManualPage(null)
    setManualError('')
    setSelectedManualUrl('')
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
      const firstManual = (data.data?.sources || []).find((item: RepairSource) => isManualProvider(item))
      if (firstManual) void loadManual(firstManual.url, true)
      if (override) setQuery(override)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Repair lookup failed')
    } finally {
      setLoading(false)
    }
  }

  const loadManual = async (url: string, quiet = false) => {
    if (!url) return
    setSelectedManualUrl(url)
    setManualLoading(true)
    setManualError('')
    if (!quiet) setManualPage(null)
    try {
      const res = await fetch('/api/repair-manual', {
        method: 'POST',
        headers: await getAuthJsonHeaders(),
        body: JSON.stringify({ url }),
        signal: AbortSignal.timeout(45000),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || 'Manual preview failed')
      setManualPage(data.data)
      setReaderFilter('')
    } catch (err) {
      setManualError(err instanceof Error ? err.message : 'Manual preview failed')
    } finally {
      setManualLoading(false)
    }
  }

  const pinSource = (source: RepairSource) => {
    setPinnedSources(prev => {
      if (prev.some(item => item.url === source.url)) return prev
      return [source, ...prev].slice(0, 8)
    })
  }

  const sendToAlpha = () => {
    if (!result) return
    const pinned = pinnedSources.length
      ? `\n\nPinned sources:\n${pinnedSources.map(item => `- ${item.provider} ${item.category}: ${item.title} ${item.url}`).join('\n')}`
      : ''
    localStorage.setItem('ai_prefill', `${buildEstimatePrompt(result)}${pinned}`)
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

          <section className="rounded-lg border border-border bg-bg-card p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="text-xs font-black uppercase text-blue">Repair Workflow</div>
                <div className="mt-1 text-sm text-text-secondary">
                  {result.workflow.vehicleMatch.label}{result.workflow.vehicleMatch.missing.length ? ` - missing ${result.workflow.vehicleMatch.missing.join(', ')}` : ''}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(result.workflow.coverage).map(([key, value]) => (
                  <span key={key} className={`rounded-md border px-2 py-1 text-[11px] font-black ${value ? 'border-green/30 bg-green/10 text-green' : 'border-white/10 bg-white/[0.04] text-text-muted'}`}>
                    {key.replace(/([A-Z])/g, ' $1')} {value ? 'yes' : 'no'}
                  </span>
                ))}
              </div>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-4">
              {result.workflow.steps.map(step => (
                <div key={step.id} className={`rounded-lg border p-3 ${workflowTone(step.status)}`}>
                  <div className="text-sm font-black">{step.label}</div>
                  <div className="mt-2 text-xs leading-5 opacity-90">{step.detail}</div>
                </div>
              ))}
            </div>
          </section>

          {result.warnings.length > 0 && (
            <div className="rounded-lg border border-amber/30 bg-amber/10 p-4 text-sm text-amber">
              {result.warnings.join(' ')}
            </div>
          )}

          <section className="grid grid-cols-1 gap-5 xl:grid-cols-[330px_minmax(0,1fr)_360px]">
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-bg-card p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-black uppercase text-text-muted">Source Stack</div>
                    <div className="mt-1 text-sm font-black">{filteredSources.length} visible</div>
                  </div>
                  <button className="text-xs font-bold text-blue hover:underline" onClick={() => setCategory('all')}>Reset</button>
                </div>
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
              </div>

              <div className="max-h-[760px] space-y-2 overflow-y-auto pr-1">
                {filteredSources.map(item => (
                  <article key={item.id} className={`rounded-lg border p-3 transition-colors ${selectedManualUrl === item.url ? 'border-blue/50 bg-blue/10' : 'border-border bg-bg-card hover:border-blue/30'}`}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-md border px-2 py-1 text-[10px] font-black ${providerTone(item.provider)}`}>{item.provider}</span>
                        <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-black text-text-secondary">{item.category}</span>
                      </div>
                      <h2 className="mt-2 line-clamp-2 text-sm font-black">{item.title}</h2>
                      <div className="mt-1 text-[11px] text-text-muted">{confidenceText(item.confidence)}</div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {isManualProvider(item) ? (
                          <button className="btn btn-secondary btn-sm" onClick={() => void loadManual(item.url)}>Preview</button>
                        ) : (
                          <a className="btn btn-secondary btn-sm" href={item.url} target="_blank" rel="noreferrer">Open</a>
                        )}
                        <button className="btn btn-secondary btn-sm" onClick={() => pinSource(item)}>Pin</button>
                      </div>
                    </div>
                  </article>
                ))}
                {filteredSources.length === 0 && (
                  <div className="rounded-lg border border-border bg-bg-card p-8 text-center text-sm text-text-muted">No source cards in this category.</div>
                )}
              </div>
            </div>

            <div className="space-y-4">
              <section className="rounded-lg border border-border bg-bg-card p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="text-xs font-black uppercase text-blue">Manual Reader</div>
                    <h2 className="mt-2 truncate text-xl font-black">{manualPage?.title || 'Select a LEMON or CHARM source'}</h2>
                    <p className="mt-2 text-sm leading-6 text-text-secondary">
                      {manualPage ? manualPage.warning : 'Preview source structure, follow breadcrumbs, and open exact procedure links without storing copied manual content.'}
                    </p>
                  </div>
                  {manualPage && <a className="btn btn-secondary btn-sm shrink-0" href={manualPage.url} target="_blank" rel="noreferrer">Open Original</a>}
                </div>

                {manualLoading && <div className="mt-5 rounded-lg border border-border bg-bg-hover p-6 text-center text-sm text-text-muted">Loading manual preview...</div>}
                {manualError && <div className="mt-5 rounded-lg border border-red/30 bg-red/10 p-4 text-sm text-red">{manualError}</div>}

                {manualPage && !manualLoading && (
                  <div className="mt-5 space-y-4">
                    {manualPage.breadcrumbs.length > 0 && (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        {manualPage.breadcrumbs.map((crumb, index) => (
                          <button key={`${crumb.url}-${index}`} className="rounded-md border border-border bg-bg-hover px-2 py-1 font-bold text-text-secondary hover:border-blue/40 hover:text-text-primary" onClick={() => void loadManual(crumb.url)}>
                            {crumb.title}
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
                      <div className="space-y-3">
                        {manualPage.sections.length === 0 && (
                          <div className="rounded-lg border border-border bg-bg-hover p-6 text-sm text-text-muted">
                            This source page is mostly a directory. Choose a child link from the manual tree.
                          </div>
                        )}
                        {manualPage.sections.map(section => (
                          <section key={`${section.heading}-${section.text.slice(0, 20)}`} className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
                            <h3 className="text-sm font-black">{section.heading}</h3>
                            <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-text-secondary">{section.text}</p>
                          </section>
                        ))}
                        {manualPage.images.length > 0 && (
                          <div className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
                            <div className="mb-3 text-sm font-black">Images / Diagrams</div>
                            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                              {manualPage.images.slice(0, 6).map(image => (
                                <a key={image.url} href={image.url} target="_blank" rel="noreferrer" className="overflow-hidden rounded-lg border border-white/10 bg-bg-hover">
                                  <img src={image.url} alt={image.alt} className="h-28 w-full object-contain" />
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>

                      <aside className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
                        <div className="text-xs font-black uppercase text-text-muted">Manual Tree</div>
                        <input
                          className="form-input mt-3 h-9 text-xs"
                          placeholder="Filter links..."
                          value={readerFilter}
                          onChange={e => setReaderFilter(e.target.value)}
                        />
                        <div className="mt-3 max-h-[560px] space-y-2 overflow-y-auto pr-1">
                          {filteredManualLinks.map(link => (
                            <button
                              key={link.url}
                              className="block w-full rounded-md border border-border bg-bg-card px-3 py-2 text-left text-xs font-bold text-text-secondary hover:border-blue/40 hover:text-text-primary"
                              onClick={() => void loadManual(link.url)}
                            >
                              <span className="block truncate">{link.title}</span>
                              <span className="mt-1 block text-[10px] uppercase text-text-muted">{link.category}{link.isDirectory ? ' / directory' : ''}</span>
                            </button>
                          ))}
                          {filteredManualLinks.length === 0 && <div className="text-sm text-text-muted">No child links on this page.</div>}
                        </div>
                      </aside>
                    </div>
                  </div>
                )}
              </section>
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
                <div className="text-xs font-black uppercase text-text-muted">Pinned Sources</div>
                <div className="mt-3 space-y-2">
                  {pinnedSources.length === 0 && <div className="text-sm text-text-muted">Pin source cards that should follow the estimate or job.</div>}
                  {pinnedSources.map(item => (
                    <div key={item.url} className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
                      <div className="flex items-center gap-2">
                        <span className={`rounded-md border px-2 py-1 text-[10px] font-black ${providerTone(item.provider)}`}>{item.provider}</span>
                        <span className="text-[10px] font-bold uppercase text-text-muted">{item.category}</span>
                      </div>
                      <div className="mt-2 line-clamp-2 text-sm font-black">{item.title}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-border bg-bg-card p-4">
                <div className="text-xs font-black uppercase text-amber">Safety Gates</div>
                <ul className="mt-3 space-y-2 text-sm text-text-secondary">
                  {result.workflow.safetyGates.map(item => <li key={item} className="leading-6">- {item}</li>)}
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
