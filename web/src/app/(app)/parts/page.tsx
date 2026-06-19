'use client'

import { useState } from 'react'
import { formatCurrency, supabase } from '@/lib/supabase'

interface PartResult {
  position: string
  name: string
  partNumber?: string
  price: number
  url: string
  store: string
  quantity: number
  sourceConfidence?: 'verified_exact_product_page' | 'search_result_only'
}

interface PartOption {
  tier: string
  brand: string
  parts: PartResult[]
  partsTotal: number
}

interface KitOption {
  name: string
  brand: string
  price: number
  url: string
  store: string
  includes?: string
  positions?: string
  sourceConfidence?: 'verified_exact_product_page' | 'search_result_only'
}

interface PartsLookupResult {
  vehicle: string
  query: string
  positions: string[]
  options: PartOption[]
  kits: KitOption[]
  taxRate: number
  laborHours: number | null
  laborRate: number
  searchUrls: Array<{ store: string; url: string }>
  sourceConfidence: 'verified_exact_product_page' | 'search_result_only' | 'price_unavailable'
  warnings?: string[]
}

const STORE_CHOICES = [
  { label: 'AutoZone', value: 'autozone' },
  { label: "O'Reilly", value: 'oreilly' },
  { label: 'NAPA', value: 'napa' },
  { label: 'RockAuto', value: 'rockauto' },
  { label: 'Advance', value: 'advance' },
]

async function getAuthJsonHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

function confidenceLabel(value: PartsLookupResult['sourceConfidence']) {
  if (value === 'verified_exact_product_page') return 'Verified exact product page'
  if (value === 'search_result_only') return 'Search result only'
  return 'Price unavailable'
}

function buildEstimatePrompt(result: PartsLookupResult) {
  const lines = [
    `Build an estimate from these verified parts for ${result.vehicle || result.query}.`,
    `Use labor reference ${result.laborHours || 0} hours at $${result.laborRate}/hr if appropriate.`,
  ]
  for (const option of result.options.slice(0, 1)) {
    lines.push(`${option.brand} ${option.tier}:`)
    for (const part of option.parts) {
      lines.push(`- ${part.position}: ${part.name} ${part.partNumber || ''} ${formatCurrency(part.price)} x${part.quantity || 1} ${part.url}`)
    }
  }
  for (const kit of result.kits.slice(0, 1)) {
    lines.push(`Kit: ${kit.name} ${formatCurrency(kit.price)} ${kit.url}`)
  }
  return lines.join('\n')
}

export default function PartsLookupPage() {
  const [query, setQuery] = useState('')
  const [vehicle, setVehicle] = useState({ year: '', make: '', model: '' })
  const [stores, setStores] = useState<string[]>([])
  const [result, setResult] = useState<PartsLookupResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)

  const verifiedCount = (result?.options || []).reduce((count, option) => count + option.parts.length, 0) + (result?.kits.length || 0)

  const search = async () => {
    const request = [vehicle.year, vehicle.make, vehicle.model, query].filter(Boolean).join(' ').trim()
    if (!request) return
    setLoading(true)
    setSearched(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch('/api/parts-lookup', {
        method: 'POST',
        headers: await getAuthJsonHeaders(),
        body: JSON.stringify({ query: request, stores }),
        signal: AbortSignal.timeout(50000),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new Error(data.error || 'Parts lookup failed')
      setResult(data.data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Parts lookup failed')
    } finally {
      setLoading(false)
    }
  }

  const toggleStore = (value: string) => {
    setStores(prev => prev.includes(value) ? prev.filter(item => item !== value) : [...prev, value])
  }

  const buildEstimate = () => {
    if (!result || verifiedCount === 0) return
    localStorage.setItem('ai_prefill', buildEstimatePrompt(result))
    window.location.href = '/ai'
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 animate-fade-in space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-xs font-black uppercase tracking-[0.18em] text-blue">Verified Sourcing</div>
          <h1 className="mt-2 text-2xl font-black tracking-tight">Parts Lookup</h1>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-text-secondary">
            Prices only show when they are visible in returned source evidence. Otherwise this page shows source links without making up numbers.
          </p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={buildEstimate} disabled={!result || verifiedCount === 0}>
          Build Estimate From Verified Parts
        </button>
      </div>

      <section className="rounded-lg border border-border bg-bg-card p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
          <input className="form-input" placeholder="Year" value={vehicle.year} onChange={e => setVehicle(v => ({ ...v, year: e.target.value }))} />
          <input className="form-input" placeholder="Make" value={vehicle.make} onChange={e => setVehicle(v => ({ ...v, make: e.target.value }))} />
          <input className="form-input" placeholder="Model" value={vehicle.model} onChange={e => setVehicle(v => ({ ...v, model: e.target.value }))} />
          <input className="form-input" placeholder="Part or service" value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void search() }} />
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {STORE_CHOICES.map(store => (
            <button
              key={store.value}
              className={`rounded-md border px-3 py-2 text-xs font-bold transition-colors ${stores.includes(store.value) ? 'border-blue/50 bg-blue/15 text-blue' : 'border-border bg-bg-hover text-text-secondary hover:border-blue/40'}`}
              onClick={() => toggleStore(store.value)}
            >
              {store.label}
            </button>
          ))}
          <button className="btn btn-primary btn-sm ml-auto" onClick={search} disabled={loading || (![vehicle.year, vehicle.make, vehicle.model, query].some(Boolean))}>
            {loading ? 'Searching...' : 'Search'}
          </button>
        </div>
      </section>

      {error && <div className="rounded-lg border border-red/30 bg-red/10 p-4 text-sm text-red">{error}</div>}

      {result && (
        <section className="rounded-lg border border-border bg-bg-card p-4">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
            <div>
              <h2 className="text-lg font-black">{result.vehicle || result.query}</h2>
              <div className="mt-2 flex flex-wrap gap-2 text-xs">
                <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 font-bold">{confidenceLabel(result.sourceConfidence)}</span>
                <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 font-bold">{verifiedCount} verified price item{verifiedCount === 1 ? '' : 's'}</span>
                {result.positions?.length ? <span className="rounded-md border border-white/10 bg-white/[0.04] px-2 py-1 font-bold">{result.positions.join(', ')}</span> : null}
              </div>
            </div>
            {result.laborHours ? (
              <div className="text-right text-sm">
                <div className="font-bold">Labor Reference</div>
                <div className="text-text-secondary">{result.laborHours} hrs x {formatCurrency(result.laborRate)}</div>
              </div>
            ) : null}
          </div>

          {verifiedCount === 0 && (
            <div className="py-8">
              <div className="text-sm font-bold">No exact prices verified.</div>
              <p className="mt-2 text-sm text-text-secondary">The lookup found sources, but no price passed verification. Use the source links below and verify manually before building an estimate.</p>
            </div>
          )}

          <div className="mt-4 space-y-3">
            {result.options.map(option => (
              <div key={`${option.brand}-${option.tier}`} className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div className="font-black">{option.brand || 'Option'} <span className="text-text-muted">({option.tier})</span></div>
                  <div className="font-black text-green">{formatCurrency(option.partsTotal)}</div>
                </div>
                <div className="mt-3 divide-y divide-border">
                  {option.parts.map(part => (
                    <div key={`${part.position}-${part.url}`} className="grid gap-2 py-3 md:grid-cols-[1fr_auto]">
                      <div>
                        <div className="font-bold">{part.position}: {part.name}</div>
                        <div className="mt-1 text-xs text-text-muted">{part.store}{part.partNumber ? ` - ${part.partNumber}` : ''} - {part.sourceConfidence ? confidenceLabel(part.sourceConfidence) : 'Search result only'}</div>
                        <a className="mt-1 block truncate text-xs text-blue hover:underline" href={part.url} target="_blank" rel="noreferrer">{part.url}</a>
                      </div>
                      <div className="text-right font-black text-green">{formatCurrency(part.price)} x{part.quantity || 1}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {result.kits.map(kit => (
              <div key={`${kit.name}-${kit.url}`} className="rounded-lg border border-white/10 bg-white/[0.025] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-black">{kit.name}</div>
                    <div className="mt-1 text-xs text-text-muted">{kit.store}{kit.includes ? ` - ${kit.includes}` : ''}</div>
                    <a className="mt-1 block truncate text-xs text-blue hover:underline" href={kit.url} target="_blank" rel="noreferrer">{kit.url}</a>
                  </div>
                  <div className="font-black text-green">{formatCurrency(kit.price)}</div>
                </div>
              </div>
            ))}
          </div>

          {result.searchUrls?.length ? (
            <div className="mt-5 rounded-lg border border-white/10 bg-white/[0.025] p-4">
              <div className="mb-2 text-sm font-black">Source Links</div>
              <div className="space-y-2">
                {result.searchUrls.slice(0, 10).map(item => (
                  <a key={item.url} className="block truncate text-sm text-blue hover:underline" href={item.url} target="_blank" rel="noreferrer">
                    {item.store}: {item.url}
                  </a>
                ))}
              </div>
            </div>
          ) : null}

          {result.warnings?.length ? (
            <div className="mt-4 rounded-lg border border-amber/30 bg-amber/10 p-3 text-xs text-amber">
              {result.warnings.slice(0, 4).join(' ')}
            </div>
          ) : null}
        </section>
      )}

      {searched && !loading && !result && !error && (
        <div className="rounded-lg border border-border bg-bg-card p-10 text-center text-sm text-text-muted">No sources found.</div>
      )}
    </div>
  )
}
