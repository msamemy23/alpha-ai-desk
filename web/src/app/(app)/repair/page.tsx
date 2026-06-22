'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import type { RepairManualPage, RepairSearchResult, RepairSource, RepairVehicle } from '@/lib/repair/sources'
import { buildRepairPresentation } from '@/lib/repair/presentation'

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

const WORKSPACE_TABS = [
  'Overview',
  'Safety',
  'Tools',
  'Parts/Fluids',
  'Procedure Links',
  'Torque/Specs',
  'Wiring/Diagrams',
  'Estimate Builder',
  'Shop Notes',
] as const

type WorkspaceTab = typeof WORKSPACE_TABS[number]

const MAIN_TABS = ['Easy Answer', 'AI Repair', 'Sources', 'Estimate', 'Advanced'] as const
type MainTab = typeof MAIN_TABS[number]

const DTC_GUIDES: Record<string, { meaning: string; checks: string[]; dontAssume: string[]; action: string }> = {
  P0420: {
    meaning: 'Catalyst system efficiency below threshold, Bank 1.',
    checks: [
      'Confirm the code, freeze-frame data, and whether other engine or misfire codes are present.',
      'Check for exhaust leaks before or near the catalytic converter.',
      'Review upstream and downstream oxygen sensor activity on a warm engine.',
      'Check fuel trims, misfire history, coolant temp, and oil/coolant contamination issues.',
      'Verify converter condition only after the basic checks pass.',
    ],
    dontAssume: [
      'Do not sell a catalytic converter just because P0420 is stored.',
      'Do not replace oxygen sensors until signal behavior and exhaust leaks are checked.',
    ],
    action: 'Create a diagnostic estimate first. Verify data before quoting converter or sensor replacement.',
  },
  P0300: {
    meaning: 'Random or multiple cylinder misfire detected.',
    checks: [
      'Check freeze-frame data, misfire counters, fuel trims, and pending cylinder-specific codes.',
      'Inspect plugs, coils, vacuum leaks, fuel pressure, compression, and injector operation.',
      'Check for TSBs before replacing parts.',
    ],
    dontAssume: ['Do not replace all coils until the failed cylinder/system is verified.'],
    action: 'Start with diagnostic labor and document test results before parts.',
  },
  P0171: {
    meaning: 'System too lean, Bank 1.',
    checks: [
      'Check fuel trims at idle and under load.',
      'Inspect for vacuum leaks, intake leaks, PCV issues, exhaust leaks, and weak fuel delivery.',
      'Verify MAF readings and oxygen sensor response.',
    ],
    dontAssume: ['Do not replace oxygen sensors just because the mixture is lean.'],
    action: 'Quote diagnosis first, then parts after trim data confirms the cause.',
  },
}

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
  return [vehicle.year, vehicle.make, vehicle.model, vehicle.trim, vehicle.engine].filter(Boolean).join(' ').trim() || 'Vehicle not fully identified'
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

function riskTone(status: string) {
  if (status === 'critical') return 'border-red/40 bg-red/10 text-red'
  if (status === 'elevated') return 'border-amber/30 bg-amber/10 text-amber'
  return 'border-green/30 bg-green/10 text-green'
}

function matchTone(status: string) {
  if (status === 'exact_procedure') return 'border-green/30 bg-green/10 text-green'
  if (status === 'likely_section') return 'border-blue/30 bg-blue/10 text-blue'
  if (status === 'diagram_or_spec') return 'border-amber/30 bg-amber/10 text-amber'
  return 'border-white/10 bg-white/[0.04] text-text-secondary'
}

function coverageTone(status: string) {
  if (status === 'found' || status === 'link_ready') return 'border-green/30 bg-green/10 text-green'
  if (status === 'needs_database' || status === 'unknown') return 'border-amber/30 bg-amber/10 text-amber'
  return 'border-white/10 bg-white/[0.04] text-text-muted'
}

function money(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? `$${value.toFixed(2)}` : 'Needs price'
}

function allocateTotal(total: number, count: number) {
  const lineCount = Math.max(1, count)
  const cents = Math.round(total * 100)
  const base = Math.floor(cents / lineCount)
  const remainder = cents - base * lineCount
  return Array.from({ length: lineCount }, (_unused, index) => (base + (index < remainder ? 1 : 0)) / 100)
}

function detectDtcCode(value: string) {
  return value.match(/\b[PCBU][0-9A-F]{4}\b/i)?.[0]?.toUpperCase() || ''
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
  const [activeTab, setActiveTab] = useState<WorkspaceTab>('Overview')
  const [customerName, setCustomerName] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [lockedTotal, setLockedTotal] = useState('')
  const [estimateMessage, setEstimateMessage] = useState('')
  const [creatingEstimate, setCreatingEstimate] = useState(false)
  const [procedureNotes, setProcedureNotes] = useState('')
  const [procedureTools, setProcedureTools] = useState('')
  const [procedurePartsFluids, setProcedurePartsFluids] = useState('')
  const [approvedBy, setApprovedBy] = useState('')
  const [procedureMessage, setProcedureMessage] = useState('')
  const [savingProcedure, setSavingProcedure] = useState(false)
  const [viewerImage, setViewerImage] = useState<{ url: string; alt: string } | null>(null)
  const [imageScale, setImageScale] = useState(1)
  const [bookmarkedImages, setBookmarkedImages] = useState<Array<{ url: string; alt: string }>>([])
  const [mainTab, setMainTab] = useState<MainTab>('Easy Answer')
  const urlQueryHandled = useRef(false)

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

  const procedureLinkMatches = useMemo(() => {
    const matches = result?.manualMatches || []
    return matches.filter(item => item.category !== 'diagram' && item.category !== 'spec')
  }, [result])

  const specMatches = useMemo(() => {
    const matches = result?.manualMatches || []
    return matches.filter(item => item.category === 'spec' || /torque|spec|capacity|fluid/i.test(item.title))
  }, [result])

  const diagramMatches = useMemo(() => {
    const matches = result?.manualMatches || []
    return matches.filter(item => item.category === 'diagram' || item.matchType === 'diagram_or_spec' || /wiring|diagram|schematic|connector|pinout/i.test(item.title))
  }, [result])

  const repairView = useMemo(() => {
    if (!result) return null
    return buildRepairPresentation(query || result.query, result)
  }, [query, result])

  const simpleAnswer = useMemo(() => {
    if (!result) return null
    const dtc = detectDtcCode(`${result.query} ${query}`)
    const dtcGuide = dtc ? DTC_GUIDES[dtc] : undefined
    const firstOperation = result.operationLines[0]
    return {
      dtc,
      title: dtcGuide ? `${dtc}: ${dtcGuide.meaning}` : (firstOperation?.label || result.draft.operation || 'Repair lookup'),
      system: firstOperation?.system || result.safetyProfile.systems[0] || 'general repair',
      checks: dtcGuide?.checks || result.draft.checklist.slice(0, 5),
      dontAssume: dtcGuide?.dontAssume || [
        'Do not quote torque specs, labor times, or procedures until a source is opened and verified.',
        'Do not replace parts until the failure is confirmed by inspection or testing.',
      ],
      action: dtcGuide?.action || (result.estimateDraft.totalLocked ? 'Review the itemized estimate draft, verify sources, then create the estimate.' : 'Verify the source and enter a price or diagnostic labor before creating an estimate.'),
    }
  }, [query, result])

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
    setActiveTab('Overview')
    setMainTab('Easy Answer')
    setEstimateMessage('')
    setProcedureMessage('')
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
      setLockedTotal(data.data?.estimateDraft?.targetTotal ? String(data.data.estimateDraft.targetTotal) : '')
      const firstManual = (data.data?.sources || []).find((item: RepairSource) => isManualProvider(item))
      if (firstManual) void loadManual(firstManual.url, true)
      if (override) setQuery(override)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Repair lookup failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (urlQueryHandled.current) return
    const params = new URLSearchParams(window.location.search)
    const urlQuery = params.get('query') || params.get('q')
    if (!urlQuery) return
    urlQueryHandled.current = true
    setQuery(urlQuery)
    void runSearch(urlQuery)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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

  const openRepairAi = () => {
    if (!result) return
    const lines = [
      'REPAIR ONLY MODE. Stay focused on this repair/diagnostic problem and do not switch to general shop tasks unless I ask to leave repair mode.',
      `Vehicle: ${vehicleText(result.normalizedVehicle)}`,
      simpleAnswer?.dtc ? `Code: ${simpleAnswer.dtc}` : '',
      `Problem: ${simpleAnswer?.title || result.draft.operation}`,
      '',
      'Explain this in plain English for a mechanic. Give me:',
      '1. What it means',
      '2. What to check first',
      '3. What not to assume',
      '4. What estimate or diagnostic note to create',
      '',
      'Work items:',
      ...result.operationLines.map(item => `- ${item.label} (${item.system})`),
      '',
      'Important: do not invent torque specs, labor times, wiring pinouts, or protected procedure text.',
    ].filter(Boolean)
    localStorage.setItem('ai_repair_mode', 'true')
    localStorage.setItem('ai_prefill', lines.join('\n'))
    window.location.href = '/ai?mode=repair'
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

  const estimateDraftForCurrentTotal = () => {
    if (!result) return null
    const total = Number(String(lockedTotal).replace(/[$,\s]/g, ''))
    if (!Number.isFinite(total) || total <= 0) return result.estimateDraft
    const priced = result.operationLines.filter(line => line.kind === 'labor')
    const estimateLines = priced.length ? priced : result.operationLines.filter(line => line.kind !== 'parts')
    const amounts = allocateTotal(total, estimateLines.length || 1)
    let amountIndex = 0
    return {
      ...result.estimateDraft,
      targetTotal: total,
      totalLocked: true,
      parts: [],
      labors: estimateLines.map(line => ({
        operation: line.label,
        amount: amounts[amountIndex++],
        pricing: 'flat',
        source_status: line.sourceStatus,
        risk: line.risk,
      })),
      notes: `${result.estimateDraft.notes}\nLocked total entered in Repair Workspace: $${total.toFixed(2)}.`,
    }
  }

  const createEstimate = async () => {
    if (!result) return
    setCreatingEstimate(true)
    setEstimateMessage('')
    try {
      const estimateDraft = estimateDraftForCurrentTotal()
      const res = await fetch('/api/repair-estimate', {
        method: 'POST',
        headers: await getAuthJsonHeaders(),
        body: JSON.stringify({
          customerName: customerName.trim() || 'Customer',
          customerEmail: customerEmail.trim(),
          customerPhone: customerPhone.trim(),
          vehicle: result.normalizedVehicle,
          estimateDraft,
          operationLines: result.operationLines,
          notes: `Source links:\n${[...pinnedSources, ...result.sources.slice(0, 5)].map(item => `${item.provider}: ${item.title} ${item.url}`).join('\n')}`,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || 'Estimate creation failed')
      setEstimateMessage(`Created estimate ${data.data.docNumber}. Open Estimates to review and send.`)
    } catch (err) {
      setEstimateMessage(err instanceof Error ? err.message : 'Estimate creation failed')
    } finally {
      setCreatingEstimate(false)
    }
  }

  const saveProcedureCard = async (status: 'draft' | 'verified') => {
    if (!result) return
    setSavingProcedure(true)
    setProcedureMessage('')
    try {
      const title = `${vehicleText(result.normalizedVehicle)} - ${result.draft.operation}`
      const res = await fetch('/api/repair-procedures', {
        method: 'POST',
        headers: await getAuthJsonHeaders(),
        body: JSON.stringify({
          title,
          operation: result.draft.operation,
          status,
          confidence: status === 'verified' ? 'shop_verified' : 'source_linked',
          vehicle: result.normalizedVehicle,
          systems: result.safetyProfile.systems,
          tools: procedureTools.split(/\r?\n|,/).map(item => item.trim()).filter(Boolean),
          partsFluids: procedurePartsFluids.split(/\r?\n|,/).map(item => item.trim()).filter(Boolean),
          safetyGates: result.safetyProfile.gates,
          operationLines: result.operationLines,
          sourceLinks: [...pinnedSources, ...result.sources.slice(0, 8), ...result.manualMatches.slice(0, 8)],
          technicianNotes: procedureNotes,
          approvedBy,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || 'Save failed')
      if (data.data?.migrationRequired) setProcedureMessage(data.data.message || 'Repair workspace database tables need migration before procedure cards can be saved.')
      else setProcedureMessage(status === 'verified' ? 'Verified procedure card saved.' : 'Procedure draft saved.')
    } catch (err) {
      setProcedureMessage(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSavingProcedure(false)
    }
  }

  const bookmarkImage = (image: { url: string; alt: string }) => {
    setBookmarkedImages(prev => prev.some(item => item.url === image.url) ? prev : [image, ...prev].slice(0, 12))
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
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-5">
          <input className="form-input" placeholder="Trim" value={vehicle.trim || ''} onChange={e => setVehicle(v => ({ ...v, trim: e.target.value }))} />
          <input className="form-input" placeholder="Drivetrain" value={vehicle.drivetrain || ''} onChange={e => setVehicle(v => ({ ...v, drivetrain: e.target.value }))} />
          <input className="form-input" placeholder="Transmission" value={vehicle.transmission || ''} onChange={e => setVehicle(v => ({ ...v, transmission: e.target.value }))} />
          <input className="form-input" placeholder="Brake package" value={vehicle.brakeSystem || ''} onChange={e => setVehicle(v => ({ ...v, brakeSystem: e.target.value }))} />
          <input className="form-input" placeholder="ADAS / emissions notes" value={vehicle.adas || ''} onChange={e => setVehicle(v => ({ ...v, adas: e.target.value }))} />
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
          <section className="rounded-lg border border-border bg-bg-card p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md border border-blue/30 bg-blue/10 px-2 py-1 text-[11px] font-black text-blue">Easy Repair View</span>
                  <span className={`rounded-md border px-2 py-1 text-[11px] font-black ${result.workflow.vehicleMatch.confidence >= 70 ? 'border-green/30 bg-green/10 text-green' : 'border-amber/30 bg-amber/10 text-amber'}`}>
                    {result.workflow.vehicleMatch.confidence}% vehicle confidence
                  </span>
                  <span className={`rounded-md border px-2 py-1 text-[11px] font-black ${riskTone(result.safetyProfile.level)}`}>
                    {result.safetyProfile.level} risk
                  </span>
                </div>
                <h2 className="mt-3 text-2xl font-black">{vehicleText(result.normalizedVehicle)}</h2>
                <p className="mt-2 text-sm leading-6 text-text-secondary">{simpleAnswer?.title}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-primary btn-sm" onClick={() => setMainTab('Estimate')}>Create Estimate</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setMainTab('Sources')}>Open Sources</button>
                <button className="btn btn-secondary btn-sm" onClick={openRepairAi}>Ask AI Repair</button>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-bg-card p-2">
            <div className="flex gap-2 overflow-x-auto">
              {MAIN_TABS.map(tab => (
                <button
                  key={tab}
                  className={`shrink-0 rounded-md border px-4 py-2 text-sm font-black transition-colors ${mainTab === tab ? 'border-blue/50 bg-blue/15 text-blue' : 'border-transparent bg-transparent text-text-secondary hover:border-border hover:bg-bg-hover'}`}
                  onClick={() => setMainTab(tab)}
                >
                  {tab}
                </button>
              ))}
            </div>
          </section>

          {mainTab === 'Easy Answer' && (
            <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
              <div className="space-y-4">
                <div className="rounded-lg border border-green/25 bg-green/10 p-5">
                  <div className="text-xs font-black uppercase text-green">Mechanic Answer</div>
                  <h3 className="mt-2 text-xl font-black">{repairView?.title || simpleAnswer?.title}</h3>
                  <p className="mt-3 max-w-3xl text-sm leading-6 text-text-secondary">{repairView?.plainAnswer}</p>
                  <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-bold">
                    <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1">{repairView?.vehicle || vehicleText(result.normalizedVehicle)}</span>
                    {repairView?.needsExactVehicle && <span className="rounded-md border border-amber/30 bg-amber/10 px-2 py-1 text-amber">needs exact engine/trim for exact diagrams</span>}
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-bg-card p-5">
                  <div className="text-xs font-black uppercase text-blue">{repairView?.needsExactVehicle ? 'Pick The Exact Manual' : 'Open The Info'}</div>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {(repairView?.actionLinks || []).map(link => (
                      <a key={`${link.kind}-${link.url}`} href={link.url} target="_blank" rel="noreferrer" className="rounded-md border border-white/10 bg-bg-hover p-3 transition-colors hover:border-blue/50 hover:bg-blue/10">
                        <span className="block text-sm font-black text-text-primary">{link.label}</span>
                        <span className="mt-1 block text-xs leading-5 text-text-secondary">{link.detail}</span>
                        <span className="mt-2 inline-flex rounded border border-white/10 px-2 py-1 text-[10px] font-black uppercase text-text-muted">{link.confidence.replace('_', ' ')}</span>
                      </a>
                    ))}
                    {!repairView?.actionLinks.length && <div className="text-sm text-text-muted">No direct source page found yet. Use Advanced sources to narrow the manual.</div>}
                  </div>
                </div>

                <div className="rounded-lg border border-border bg-bg-card p-5">
                  <div className="text-xs font-black uppercase text-text-muted">What To Check First</div>
                  <ol className="mt-3 space-y-3 text-sm leading-6 text-text-secondary">
                    {(repairView?.checks || simpleAnswer?.checks || []).slice(0, 4).map((item, index) => (
                      <li key={item} className="flex gap-3">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-blue/15 text-xs font-black text-blue">{index + 1}</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>

              <aside className="space-y-4">
                <div className="rounded-lg border border-border bg-bg-card p-4">
                  <div className="text-xs font-black uppercase text-text-muted">Quick Actions</div>
                  <div className="mt-3 grid gap-2">
                    <button className="btn btn-primary btn-sm" onClick={() => setMainTab('Estimate')}>Create Diagnostic Estimate</button>
                    <button className="btn btn-secondary btn-sm" onClick={() => setMainTab('Sources')}>Show Source Links</button>
                    <button className="btn btn-secondary btn-sm" onClick={openRepairAi}>Open AI Repair Chat</button>
                    <button className="btn btn-secondary btn-sm" onClick={saveDraft}>Save Local Note</button>
                  </div>
                </div>
                <div className="rounded-lg border border-green/30 bg-green/10 p-4">
                  <div className="text-xs font-black uppercase text-green">Next Shop Action</div>
                  <p className="mt-3 text-sm leading-6 text-green">{repairView?.action || simpleAnswer?.action}</p>
                </div>
                <div className="rounded-lg border border-amber/30 bg-amber/10 p-4">
                  <div className="text-xs font-black uppercase text-amber">Do Not Assume</div>
                  <div className="mt-3 space-y-2 text-sm leading-6 text-amber">
                    {(repairView?.dontAssume || simpleAnswer?.dontAssume || []).slice(0, 2).map(item => <div key={item}>- {item}</div>)}
                  </div>
                </div>
              </aside>
            </section>
          )}

          {mainTab === 'AI Repair' && (
            <section className="rounded-lg border border-border bg-bg-card p-6">
              <div className="max-w-3xl">
                <div className="text-xs font-black uppercase text-blue">AI Repair Chat</div>
                <h3 className="mt-2 text-xl font-black">Repair-only chat for this job</h3>
                <p className="mt-3 text-sm leading-6 text-text-secondary">This opens Alpha AI with this vehicle, code/problem, work items, and a repair-only instruction. It will focus on explaining the repair, what to check, and what estimate or diagnostic note to create.</p>
                <button className="btn btn-primary mt-4" onClick={openRepairAi}>Open AI Repair Chat</button>
              </div>
            </section>
          )}

          {mainTab === 'Sources' && (
            <section className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
              <div className="rounded-lg border border-border bg-bg-card p-4">
                <div className="mb-3 flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="text-xs font-black uppercase text-blue">Source Links</div>
                    <div className="mt-1 text-sm text-text-secondary">Open these only when you need proof, diagrams, TSBs, or manual details.</div>
                  </div>
                  <button className="btn btn-secondary btn-sm" onClick={copySources}>Copy Sources</button>
                </div>
                <div className="space-y-2">
                  {result.sources.slice(0, 12).map(item => (
                    <article key={item.id} className="rounded-lg border border-border bg-bg-hover p-3">
                      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0">
                          <div className="flex flex-wrap gap-2">
                            <span className={`rounded-md border px-2 py-1 text-[10px] font-black ${providerTone(item.provider)}`}>{item.provider}</span>
                            <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-black text-text-secondary">{item.category}</span>
                          </div>
                          <h4 className="mt-2 text-sm font-black">{item.title}</h4>
                          <p className="mt-1 text-xs leading-5 text-text-muted">{item.description}</p>
                        </div>
                        {isManualProvider(item)
                          ? <button className="btn btn-secondary btn-sm shrink-0" onClick={() => { setMainTab('Advanced'); setActiveTab('Procedure Links'); void loadManual(item.url) }}>Preview</button>
                          : <a className="btn btn-secondary btn-sm shrink-0" href={item.url} target="_blank" rel="noreferrer">Open</a>}
                      </div>
                    </article>
                  ))}
                </div>
              </div>
              <aside className="rounded-lg border border-border bg-bg-card p-4">
                <div className="text-xs font-black uppercase text-text-muted">Possible Source Pages</div>
                <div className="mt-3 space-y-2">
                  {result.manualMatches.slice(0, 8).map(match => (
                    <button key={match.url} className={`block w-full rounded-lg border p-3 text-left ${matchTone(match.matchType)}`} onClick={() => { setMainTab('Advanced'); setActiveTab('Procedure Links'); void loadManual(match.url) }}>
                      <span className="block text-sm font-black">{match.title}</span>
                      <span className="mt-1 block text-xs opacity-80">{match.provider} / {match.matchType.replace(/_/g, ' ')}</span>
                    </button>
                  ))}
                  {result.manualMatches.length === 0 && <div className="text-sm text-text-muted">No deep source page match yet.</div>}
                </div>
              </aside>
            </section>
          )}

          {mainTab === 'Estimate' && (
            <section className="rounded-lg border border-border bg-bg-card p-5">
              <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="space-y-4">
                  <div>
                    <div className="text-xs font-black uppercase text-blue">Estimate Builder</div>
                    <h3 className="mt-2 text-xl font-black">{result.estimateDraft.totalLocked ? `Locked total ${money(result.estimateDraft.targetTotal)}` : 'Enter a diagnostic or repair total'}</h3>
                  </div>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    <input className="form-input" placeholder="Customer name" value={customerName} onChange={e => setCustomerName(e.target.value)} />
                    <input className="form-input" placeholder="Total, e.g. 430" value={lockedTotal} onChange={e => setLockedTotal(e.target.value)} />
                    <input className="form-input" placeholder="Customer email" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} />
                    <input className="form-input" placeholder="Customer phone" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} />
                  </div>
                  <div className="rounded-lg border border-border bg-bg-hover p-4">
                    <div className="text-sm font-black">Work Items</div>
                    <div className="mt-3 space-y-2">
                      {(estimateDraftForCurrentTotal()?.labors || []).map((line, index) => (
                        <div key={`${line.operation}-${index}`} className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.025] px-3 py-2 text-sm">
                          <span>{String(line.operation)}</span>
                          <span className="font-black">{money(typeof line.amount === 'number' ? line.amount : null)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <button className="btn btn-primary" onClick={() => void createEstimate()} disabled={creatingEstimate || !lockedTotal.trim()}>{creatingEstimate ? 'Creating...' : 'Create Estimate Draft'}</button>
                  {estimateMessage && <div className="rounded-lg border border-border bg-bg-hover p-3 text-sm text-text-secondary">{estimateMessage}</div>}
                </div>
                <aside className="rounded-lg border border-amber/30 bg-amber/10 p-4">
                  <div className="text-xs font-black uppercase text-amber">Before Saving</div>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-amber">
                    <li>- Verify the vehicle and source links.</li>
                    <li>- Use a diagnostic total for DTC work unless the failed part is proven.</li>
                    <li>- The app will not save a zero-dollar estimate.</li>
                  </ul>
                </aside>
              </div>
            </section>
          )}

          {mainTab === 'Advanced' && (
            <>
          <section className="rounded-lg border border-border bg-bg-card/95 p-4 shadow-xl">
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-md border px-2 py-1 text-[11px] font-black ${result.workflow.vehicleMatch.confidence >= 70 ? 'border-green/30 bg-green/10 text-green' : 'border-amber/30 bg-amber/10 text-amber'}`}>
                    {result.workflow.vehicleMatch.confidence}% vehicle confidence
                  </span>
                  <span className={`rounded-md border px-2 py-1 text-[11px] font-black ${riskTone(result.safetyProfile.level)}`}>
                    {result.safetyProfile.level} risk
                  </span>
                  <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 text-[11px] font-black text-text-secondary">
                    {result.operationLines.length} operation lines
                  </span>
                </div>
                <h2 className="mt-2 text-xl font-black">{vehicleText(result.normalizedVehicle)}</h2>
                <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-text-secondary md:grid-cols-4">
                  <div><span className="text-text-muted">VIN:</span> {result.normalizedVehicle.vin || 'missing'}</div>
                  <div><span className="text-text-muted">Drive:</span> {result.normalizedVehicle.drivetrain || 'missing'}</div>
                  <div><span className="text-text-muted">Trans:</span> {result.normalizedVehicle.transmission || 'missing'}</div>
                  <div><span className="text-text-muted">Brakes:</span> {result.normalizedVehicle.brakeSystem || 'missing'}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                {Object.entries(result.coverageDashboard).filter(([key]) => !['indexedPages', 'indexedLinks', 'exactMatches', 'likelyMatches', 'diagrams', 'specs'].includes(key)).map(([key, value]) => (
                  <div key={key} className={`rounded-md border px-2 py-2 font-black ${coverageTone(String(value))}`}>
                    <div className="text-[10px] uppercase opacity-80">{key.replace(/([A-Z])/g, ' $1')}</div>
                    <div>{String(value).replace(/_/g, ' ')}</div>
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 gap-3 lg:grid-cols-4">
            <div className="rounded-lg border border-border bg-bg-card p-4">
              <div className="text-xs font-black uppercase text-text-muted">Vehicle</div>
              <div className="mt-2 text-lg font-black">{vehicleText(result.normalizedVehicle)}</div>
              <div className="mt-2 text-xs text-text-secondary">{result.workflow.vehicleMatch.label} - {result.workflow.vehicleMatch.confidence}%</div>
            </div>
            <div className="rounded-lg border border-border bg-bg-card p-4">
              <div className="text-xs font-black uppercase text-text-muted">Deep Matches</div>
              <div className="mt-2 text-3xl font-black">{result.manualMatches.length}</div>
              <div className="mt-1 text-xs text-text-secondary">{result.coverageDashboard.indexedPages} pages / {result.coverageDashboard.indexedLinks} links indexed</div>
            </div>
            <div className="rounded-lg border border-border bg-bg-card p-4">
              <div className="text-xs font-black uppercase text-text-muted">Exact Candidates</div>
              <div className="mt-2 text-3xl font-black">{result.coverageDashboard.exactMatches}</div>
              <div className="mt-1 text-xs text-text-secondary">{result.coverageDashboard.likelyMatches} likely sections</div>
            </div>
            <div className="rounded-lg border border-border bg-bg-card p-4">
              <div className="text-xs font-black uppercase text-text-muted">Estimate Readiness</div>
              <div className="mt-2 text-sm font-black text-amber">{result.estimateDraft.totalLocked ? `Locked ${money(result.estimateDraft.targetTotal)}` : 'Needs price'}</div>
              <div className="mt-1 text-xs text-text-secondary">No zero-dollar estimate saves</div>
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
                          <button className="btn btn-secondary btn-sm" onClick={() => { setActiveTab('Procedure Links'); void loadManual(item.url) }}>Preview</button>
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
                  <div>
                    <div className="text-xs font-black uppercase text-blue">Repair Workspace</div>
                    <h2 className="mt-2 text-xl font-black">{result.draft.operation}</h2>
                    <p className="mt-2 text-sm leading-6 text-text-secondary">Use the tabs like a shop workflow: identify, verify sources, review safety, build the estimate, then save a shop-owned procedure card.</p>
                  </div>
                  <a className="btn btn-secondary btn-sm" href="/estimates">Open Estimates</a>
                </div>

                <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
                  {WORKSPACE_TABS.map(tab => (
                    <button
                      key={tab}
                      className={`shrink-0 rounded-md border px-3 py-2 text-xs font-black transition-colors ${activeTab === tab ? 'border-blue/50 bg-blue/15 text-blue' : 'border-border bg-bg-hover text-text-secondary hover:border-blue/40'}`}
                      onClick={() => setActiveTab(tab)}
                    >
                      {tab}
                    </button>
                  ))}
                </div>

                <div className="mt-5">
                  {activeTab === 'Overview' && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        {result.operationLines.map(line => (
                          <div key={line.id} className={`rounded-lg border p-4 ${riskTone(line.risk)}`}>
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-sm font-black">{line.label}</div>
                                <div className="mt-1 text-xs opacity-80">{line.system} / {line.sourceStatus.replace(/_/g, ' ')}</div>
                              </div>
                              <div className="text-right text-xs font-black">{money(line.estimateAmount)}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <div className="rounded-lg border border-border bg-bg-hover p-4">
                        <div className="text-sm font-black">Shop Procedure Matches</div>
                        <div className="mt-3 space-y-2">
                          {(result.shopProcedures || []).length === 0 && <div className="text-sm text-text-muted">{result.coverageDashboard.shopProcedure === 'needs_database' ? 'Install the repair workspace migration to enable shop-owned procedure cards.' : 'No shop-owned procedure card exists for this vehicle/operation yet.'}</div>}
                          {(result.shopProcedures || []).map(card => (
                            <div key={card.id} className="rounded-md border border-white/10 bg-white/[0.025] p-3">
                              <div className="text-sm font-black">{card.title}</div>
                              <div className="mt-1 text-xs text-text-muted">{card.status} / {card.confidence}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {activeTab === 'Safety' && (
                    <div className="space-y-3">
                      <div className={`rounded-lg border p-4 ${riskTone(result.safetyProfile.level)}`}>
                        <div className="text-sm font-black">{result.safetyProfile.level.toUpperCase()} safety profile</div>
                        <div className="mt-2 text-xs opacity-90">Systems: {result.safetyProfile.systems.join(', ') || 'general repair'}</div>
                      </div>
                      {result.safetyProfile.gates.map(gate => (
                        <div key={gate.id} className="rounded-lg border border-border bg-bg-hover p-4">
                          <div className="text-sm font-black">{gate.label}</div>
                          <div className="mt-2 text-sm leading-6 text-text-secondary">{gate.reason}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {activeTab === 'Tools' && (
                    <div className="space-y-4">
                      <div className="rounded-lg border border-border bg-bg-hover p-4 text-sm leading-6 text-text-secondary">Record shop-owned tool notes here. These notes are saved to the procedure card, not copied from a manual.</div>
                      <textarea className="form-input min-h-40" placeholder="Lift/support points, scan tool, brake service mode, cooling pressure tester, pullers, torque wrench ranges..." value={procedureTools} onChange={e => setProcedureTools(e.target.value)} />
                    </div>
                  )}

                  {activeTab === 'Parts/Fluids' && (
                    <div className="space-y-4">
                      <div className="rounded-lg border border-border bg-bg-hover p-4 text-sm leading-6 text-text-secondary">List parts, fluids, capacities to verify, and customer-supplied notes. Do not enter unverified prices here.</div>
                      <textarea className="form-input min-h-40" placeholder="Pads/rotors, coolant type to verify, bulbs, reservoir, alignment, customer supplied parts..." value={procedurePartsFluids} onChange={e => setProcedurePartsFluids(e.target.value)} />
                    </div>
                  )}

                  {activeTab === 'Procedure Links' && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 gap-3">
                        {procedureLinkMatches.slice(0, 8).map(match => (
                          <div key={match.url} className={`rounded-lg border p-3 ${matchTone(match.matchType)}`}>
                            <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                              <div className="min-w-0">
                                <div className="text-xs font-black uppercase">{match.provider} / {match.matchType.replace(/_/g, ' ')} / score {match.score}</div>
                                <div className="mt-1 text-sm font-black">{match.title}</div>
                                <div className="mt-1 text-xs opacity-80">{match.path.join(' > ')}</div>
                              </div>
                              <button className="btn btn-secondary btn-sm shrink-0" onClick={() => void loadManual(match.url)}>Preview</button>
                            </div>
                          </div>
                        ))}
                        {procedureLinkMatches.length === 0 && <div className="rounded-lg border border-border bg-bg-hover p-6 text-sm text-text-muted">No deep procedure match yet. Open a manual source from the Source Stack and use the manual tree.</div>}
                      </div>

                      <div className="rounded-lg border border-border bg-bg-hover p-4">
                        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                          <div className="min-w-0">
                            <div className="text-xs font-black uppercase text-blue">Manual Reader</div>
                            <h3 className="mt-2 truncate text-lg font-black">{manualPage?.title || 'Select a LEMON or CHARM source'}</h3>
                            <p className="mt-2 text-sm leading-6 text-text-secondary">{manualPage ? manualPage.warning : 'Preview source structure, follow breadcrumbs, and open exact procedure links without storing copied manual content.'}</p>
                          </div>
                          {manualPage && <a className="btn btn-secondary btn-sm shrink-0" href={manualPage.url} target="_blank" rel="noreferrer">Open Original</a>}
                        </div>
                        {manualLoading && <div className="mt-5 rounded-lg border border-border bg-bg-card p-6 text-center text-sm text-text-muted">Loading manual preview...</div>}
                        {manualError && <div className="mt-5 rounded-lg border border-red/30 bg-red/10 p-4 text-sm text-red">{manualError}</div>}
                        {manualPage && !manualLoading && (
                          <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
                            <div className="space-y-3">
                              {manualPage.sections.length === 0 && <div className="rounded-lg border border-border bg-bg-card p-6 text-sm text-text-muted">This source page is mostly a directory. Choose a child link from the manual tree.</div>}
                              {manualPage.sections.map(section => (
                                <section key={`${section.heading}-${section.text.slice(0, 20)}`} className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
                                  <h3 className="text-sm font-black">{section.heading}</h3>
                                  <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-text-secondary">{section.text}</p>
                                </section>
                              ))}
                            </div>
                            <aside className="rounded-lg border border-white/10 bg-white/[0.025] p-3">
                              <div className="text-xs font-black uppercase text-text-muted">Manual Tree</div>
                              <input className="form-input mt-3 h-9 text-xs" placeholder="Filter links..." value={readerFilter} onChange={e => setReaderFilter(e.target.value)} />
                              <div className="mt-3 max-h-[520px] space-y-2 overflow-y-auto pr-1">
                                {filteredManualLinks.map(link => (
                                  <button key={link.url} className="block w-full rounded-md border border-border bg-bg-card px-3 py-2 text-left text-xs font-bold text-text-secondary hover:border-blue/40 hover:text-text-primary" onClick={() => void loadManual(link.url)}>
                                    <span className="block truncate">{link.title}</span>
                                    <span className="mt-1 block text-[10px] uppercase text-text-muted">{link.category}{link.isDirectory ? ' / directory' : ''}</span>
                                  </button>
                                ))}
                                {filteredManualLinks.length === 0 && <div className="text-sm text-text-muted">No child links on this page.</div>}
                              </div>
                            </aside>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {activeTab === 'Torque/Specs' && (
                    <div className="space-y-3">
                      {specMatches.length === 0 && <div className="rounded-lg border border-amber/30 bg-amber/10 p-4 text-sm text-amber">No verified spec page found yet. Open source manuals and verify specs manually before quoting or work.</div>}
                      {specMatches.map(match => (
                        <div key={match.url} className={`rounded-lg border p-3 ${matchTone(match.matchType)}`}>
                          <div className="text-sm font-black">{match.title}</div>
                          <div className="mt-1 text-xs opacity-80">{match.note}</div>
                          <button className="btn btn-secondary btn-sm mt-3" onClick={() => void loadManual(match.url)}>Preview Source</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {activeTab === 'Wiring/Diagrams' && (
                    <div className="space-y-4">
                      {diagramMatches.map(match => (
                        <div key={match.url} className={`rounded-lg border p-3 ${matchTone(match.matchType)}`}>
                          <div className="text-sm font-black">{match.title}</div>
                          <button className="btn btn-secondary btn-sm mt-3" onClick={() => void loadManual(match.url)}>Preview Diagram Source</button>
                        </div>
                      ))}
                      {manualPage?.images.length ? (
                        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                          {manualPage.images.slice(0, 12).map(image => (
                            <button key={image.url} className="overflow-hidden rounded-lg border border-white/10 bg-bg-hover p-2" onClick={() => { setViewerImage(image); setImageScale(1) }}>
                              <img src={image.url} alt={image.alt} className="h-32 w-full object-contain" />
                              <span className="mt-2 block truncate text-left text-xs text-text-muted">{image.alt}</span>
                            </button>
                          ))}
                        </div>
                      ) : <div className="rounded-lg border border-border bg-bg-hover p-6 text-sm text-text-muted">Open a manual page with images to use the diagram viewer.</div>}
                    </div>
                  )}

                  {activeTab === 'Estimate Builder' && (
                    <div className="space-y-4">
                      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                        <input className="form-input" placeholder="Customer name" value={customerName} onChange={e => setCustomerName(e.target.value)} />
                        <input className="form-input" placeholder="Locked total, e.g. 430" value={lockedTotal} onChange={e => setLockedTotal(e.target.value)} />
                        <input className="form-input" placeholder="Customer email" value={customerEmail} onChange={e => setCustomerEmail(e.target.value)} />
                        <input className="form-input" placeholder="Customer phone" value={customerPhone} onChange={e => setCustomerPhone(e.target.value)} />
                      </div>
                      <div className="rounded-lg border border-border bg-bg-hover p-4">
                        <div className="text-sm font-black">Estimate Lines</div>
                        <div className="mt-3 space-y-2">
                          {(estimateDraftForCurrentTotal()?.labors || []).map((line, index) => (
                            <div key={`${line.operation}-${index}`} className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-white/[0.025] px-3 py-2 text-sm">
                              <span>{String(line.operation)}</span>
                              <span className="font-black">{money(typeof line.amount === 'number' ? line.amount : null)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <button className="btn btn-primary" onClick={() => void createEstimate()} disabled={creatingEstimate || !lockedTotal.trim()}>{creatingEstimate ? 'Creating...' : 'Create Estimate Draft'}</button>
                      {estimateMessage && <div className="rounded-lg border border-border bg-bg-hover p-3 text-sm text-text-secondary">{estimateMessage}</div>}
                    </div>
                  )}

                  {activeTab === 'Shop Notes' && (
                    <div className="space-y-4">
                      <textarea className="form-input min-h-44" placeholder="Write your shop-owned procedure notes here. Do not paste protected manual text." value={procedureNotes} onChange={e => setProcedureNotes(e.target.value)} />
                      <input className="form-input" placeholder="Approved by / technician" value={approvedBy} onChange={e => setApprovedBy(e.target.value)} />
                      <div className="flex flex-wrap gap-2">
                        <button className="btn btn-secondary" onClick={() => void saveProcedureCard('draft')} disabled={savingProcedure}>Save Draft Procedure</button>
                        <button className="btn btn-primary" onClick={() => void saveProcedureCard('verified')} disabled={savingProcedure || !approvedBy.trim()}>Save Verified Procedure</button>
                      </div>
                      {procedureMessage && <div className="rounded-lg border border-border bg-bg-hover p-3 text-sm text-text-secondary">{procedureMessage}</div>}
                    </div>
                  )}
                </div>
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
                <div className="text-xs font-black uppercase text-blue">Estimate Draft</div>
                <div className="mt-3 space-y-2">
                  {(estimateDraftForCurrentTotal()?.labors || []).slice(0, 6).map((line, index) => (
                    <div key={`${line.operation}-${index}`} className="flex items-center justify-between gap-2 rounded-md border border-white/10 bg-white/[0.025] px-3 py-2 text-xs">
                      <span className="truncate">{String(line.operation)}</span>
                      <span className="font-black">{money(typeof line.amount === 'number' ? line.amount : null)}</span>
                    </div>
                  ))}
                </div>
                <button className="btn btn-primary btn-sm mt-3 w-full" onClick={() => setActiveTab('Estimate Builder')}>Open Estimate Builder</button>
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
                <div className="text-xs font-black uppercase text-text-muted">Bookmarked Diagrams</div>
                <div className="mt-3 space-y-2">
                  {bookmarkedImages.length === 0 && <div className="text-sm text-text-muted">Open a manual image, then bookmark it for the procedure card.</div>}
                  {bookmarkedImages.map(image => (
                    <button key={image.url} className="flex w-full items-center gap-3 rounded-lg border border-white/10 bg-white/[0.025] p-2 text-left" onClick={() => { setViewerImage(image); setImageScale(1) }}>
                      <img src={image.url} alt={image.alt} className="h-12 w-16 object-contain" />
                      <span className="min-w-0 truncate text-xs font-bold text-text-secondary">{image.alt}</span>
                    </button>
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

      {viewerImage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4">
          <div className="flex max-h-[92vh] w-full max-w-6xl flex-col rounded-lg border border-border bg-bg-card shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
              <div className="min-w-0">
                <div className="text-xs font-black uppercase text-blue">Diagram Viewer</div>
                <div className="truncate text-sm font-bold">{viewerImage.alt}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button className="btn btn-secondary btn-sm" onClick={() => setImageScale(scale => Math.max(0.5, scale - 0.25))}>Zoom Out</button>
                <button className="btn btn-secondary btn-sm" onClick={() => setImageScale(scale => Math.min(3, scale + 0.25))}>Zoom In</button>
                <button className="btn btn-secondary btn-sm" onClick={() => bookmarkImage(viewerImage)}>Bookmark</button>
                <a className="btn btn-secondary btn-sm" href={viewerImage.url} target="_blank" rel="noreferrer">Open Original</a>
                <button className="btn btn-primary btn-sm" onClick={() => setViewerImage(null)}>Close</button>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-6">
              <img src={viewerImage.url} alt={viewerImage.alt} className="mx-auto max-w-none object-contain transition-transform" style={{ transform: `scale(${imageScale})`, transformOrigin: 'top center' }} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
