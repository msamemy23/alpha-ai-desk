'use client'

import { useState } from 'react'
import { formatCurrency, supabase } from '@/lib/supabase'
import Icon from '@/components/Icon'
import { EmptyBlock, ErrorCard, hostOf, Pill, safeHref } from '@/components/ListKit'

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

const confidenceLamp = (value: PartsLookupResult['sourceConfidence'] | undefined) =>
  value === 'verified_exact_product_page' ? 'green' as const : value === 'search_result_only' ? 'amber' as const : 'off' as const

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

function SourceLink({ url, store }: { url: string; store: string }) {
  return (
    <a className="mt-1 inline-flex min-h-[44px] items-center gap-1.5 font-bold text-blue underline-offset-4 hover:underline sm:min-h-[32px]" href={safeHref(url)} target="_blank" rel="noreferrer noopener">
      View on {store || hostOf(url) || 'the store'}
      <Icon name="openExternal" className="h-4 w-4" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  )
}

export default function PartsLookupPage() {
  const [query, setQuery] = useState('')
  const [vehicle, setVehicle] = useState({ year: '', make: '', model: '' })
  const [stores, setStores] = useState<string[]>([])
  const [result, setResult] = useState<PartsLookupResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)
  const [handoffError, setHandoffError] = useState('')

  const verifiedCount = (result?.options || []).reduce((count, option) => count + option.parts.length, 0) + (result?.kits.length || 0)
  const canSearch = [vehicle.year, vehicle.make, vehicle.model, query].some(v => v.trim())

  const search = async () => {
    const request = [vehicle.year, vehicle.make, vehicle.model, query].filter(Boolean).join(' ').trim()
    if (!request) return
    setLoading(true)
    setSearched(true)
    setError('')
    setHandoffError('')
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
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) setError('The stores took too long to answer. Try again, or pick fewer stores.')
      else setError(err instanceof Error && err.message ? err.message : 'Parts lookup failed')
    } finally {
      setLoading(false)
    }
  }

  const toggleStore = (value: string) => {
    setStores(prev => prev.includes(value) ? prev.filter(item => item !== value) : [...prev, value])
  }

  const buildEstimate = () => {
    if (!result || verifiedCount === 0) return
    try {
      localStorage.setItem('ai_prefill', buildEstimatePrompt(result))
    } catch {
      setHandoffError('Your browser blocked saving the parts for Ask Alpha. Allow site storage and try again.')
      return
    }
    window.location.href = '/ai'
  }

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div>
          <h1 className="page-title">Parts lookup</h1>
          <p className="page-subtitle">Real prices from store pages, or the source link when a price cannot be verified.</p>
        </div>
      </header>

      <form className="card" onSubmit={e => { e.preventDefault(); if (canSearch && !loading) void search() }}>
        <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 sm:grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)]">
          <div>
            <label className="form-label" htmlFor="pl-year">Year</label>
            <input id="pl-year" className="form-input num" inputMode="numeric" maxLength={4} autoComplete="off" placeholder="2016" value={vehicle.year} onChange={e => setVehicle(v => ({ ...v, year: e.target.value }))} />
          </div>
          <div>
            <label className="form-label" htmlFor="pl-make">Make</label>
            <input id="pl-make" className="form-input" autoComplete="off" placeholder="Toyota" value={vehicle.make} onChange={e => setVehicle(v => ({ ...v, make: e.target.value }))} />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="form-label" htmlFor="pl-model">Model</label>
            <input id="pl-model" className="form-input" autoComplete="off" placeholder="Camry" value={vehicle.model} onChange={e => setVehicle(v => ({ ...v, model: e.target.value }))} />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="form-label" htmlFor="pl-part">Part or service</label>
            <input id="pl-part" className="form-input" autoComplete="off" placeholder="Front brake pads" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
        </div>

        <fieldset className="mt-4">
          <legend className="form-label">Stores to check</legend>
          <div className="flex flex-wrap gap-2">
            {STORE_CHOICES.map(store => {
              const on = stores.includes(store.value)
              return (
                <button
                  key={store.value}
                  type="button"
                  aria-pressed={on}
                  className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-4 text-[0.9375rem] font-bold transition-colors sm:min-h-[38px] ${on ? 'border-blue bg-blue/10 text-blue' : 'border-[rgb(var(--c-line))] bg-bg-card text-text-primary hover:bg-bg-hover'}`}
                  onClick={() => toggleStore(store.value)}
                >
                  {on && <Icon name="check" className="h-4 w-4" strokeWidth={2.4} />}
                  {store.label}
                </button>
              )
            })}
          </div>
          <p className="form-hint">Leave all off to check every store.</p>
        </fieldset>

        <button type="submit" className="btn btn-primary btn-lg mt-4 w-full sm:w-auto" disabled={loading || !canSearch}>
          <Icon name="search" className="h-5 w-5" />
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      <div className="mt-6" aria-live="polite">
        {loading && (
          <div role="status" aria-busy="true">
            <p className="mb-3 text-text-secondary">Checking store pages. This can take up to a minute.</p>
            <div className="space-y-3">
              <div className="skeleton h-24" />
              <div className="skeleton h-24" />
              <div className="skeleton h-24" />
            </div>
          </div>
        )}

        {!loading && error && <ErrorCard title="Parts lookup did not finish" message={error} onRetry={() => void search()} />}

        {!loading && !error && !searched && (
          <EmptyBlock icon="parts" title="Search for a part">
            Enter the car and the part or service you need. Alpha checks store pages and only shows prices it can verify.
          </EmptyBlock>
        )}

        {!loading && !error && searched && !result && (
          <EmptyBlock icon="search" title="No sources found">
            Try fewer words, check the spelling, or turn on more stores.
          </EmptyBlock>
        )}

        {result && !loading && (
          <section className="space-y-5" aria-labelledby="pl-result">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h2 id="pl-result" className="section-title text-[1.375rem]">{result.vehicle || result.query}</h2>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Pill lamp={confidenceLamp(result.sourceConfidence)}>{confidenceLabel(result.sourceConfidence)}</Pill>
                  <Pill><span className="num">{verifiedCount}</span>&nbsp;verified price {verifiedCount === 1 ? 'item' : 'items'}</Pill>
                  {result.positions?.length ? <Pill>{result.positions.join(', ')}</Pill> : null}
                </div>
              </div>
              <div className="flex flex-col gap-2 sm:items-end">
                <button className="btn btn-primary" onClick={buildEstimate} disabled={verifiedCount === 0}><Icon name="alpha" className="h-5 w-5" />Build estimate from these parts</button>
                {result.laborHours ? <p className="num text-[0.9375rem] text-text-secondary">Labor reference: {result.laborHours} h × {formatCurrency(result.laborRate)} per hour</p> : null}
              </div>
            </div>
            {handoffError && <p role="alert" className="text-[0.9375rem] font-bold text-red">{handoffError}</p>}

            {verifiedCount === 0 && (
              <div className="rounded-lg border border-amber/60 bg-amber/[0.1] p-4">
                <p className="flex items-center gap-2 font-bold text-text-primary"><Icon name="alert" className="h-5 w-5 shrink-0 text-amber" />No exact prices verified</p>
                <p className="mt-1 text-text-secondary">The lookup found sources, but no price passed verification. Open the source links below and check the price yourself before you build an estimate.</p>
              </div>
            )}

            {result.options.map(option => (
              <section key={`${option.brand}-${option.tier}`} className="panel" aria-label={`${option.brand || 'Option'} ${option.tier}`}>
                <div className="panel-header">
                  <h3 className="section-title min-w-0">{option.brand || 'Option'} <span className="font-normal text-text-secondary">{option.tier}</span></h3>
                  <span className="display num shrink-0 text-[1.25rem] font-bold">{formatCurrency(option.partsTotal)}</span>
                </div>
                <ul className="ledger !border-t-0">
                  {option.parts.map(part => (
                    <li key={`${part.position}-${part.url}`}>
                      <div className="ledger-row items-start py-3">
                        <div className="ledger-main">
                          <p className="font-bold leading-snug">{part.position}: {part.name}</p>
                          <p className="text-[0.9375rem] text-text-secondary">{part.store}{part.partNumber ? <> · <span className="num">{part.partNumber}</span></> : null}</p>
                          <p className="mt-0.5 flex items-center gap-1.5 text-[0.9375rem] text-text-secondary">
                            <span className={`lamp lamp-${confidenceLamp(part.sourceConfidence)}`} aria-hidden="true" />
                            {part.sourceConfidence ? confidenceLabel(part.sourceConfidence) : 'Search result only'}
                          </p>
                          <SourceLink url={part.url} store={part.store} />
                        </div>
                        <div className="shrink-0 text-right">
                          <p className="ledger-amt">{formatCurrency(part.price)}</p>
                          <p className="num text-[0.875rem] text-text-secondary">× {part.quantity || 1}</p>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}

            {result.kits.length > 0 && (
              <section className="panel" aria-label="Kits">
                <div className="panel-header"><h3 className="section-title">Kits</h3></div>
                <ul className="ledger !border-t-0">
                  {result.kits.map(kit => (
                    <li key={`${kit.name}-${kit.url}`}>
                      <div className="ledger-row items-start py-3">
                        <div className="ledger-main">
                          <p className="font-bold leading-snug">{kit.name}</p>
                          <p className="text-[0.9375rem] text-text-secondary">{kit.store}{kit.includes ? ` · ${kit.includes}` : ''}</p>
                          <p className="mt-0.5 flex items-center gap-1.5 text-[0.9375rem] text-text-secondary">
                            <span className={`lamp lamp-${confidenceLamp(kit.sourceConfidence)}`} aria-hidden="true" />
                            {kit.sourceConfidence ? confidenceLabel(kit.sourceConfidence) : 'Search result only'}
                          </p>
                          <SourceLink url={kit.url} store={kit.store} />
                        </div>
                        <p className="ledger-amt shrink-0">{formatCurrency(kit.price)}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {result.searchUrls?.length ? (
              <section className="panel" aria-label="Source links">
                <div className="panel-header"><h3 className="section-title">Source links</h3></div>
                <ul className="ledger !border-t-0">
                  {result.searchUrls.slice(0, 10).map(item => (
                    <li key={item.url}>
                      <a className="ledger-row" href={safeHref(item.url)} target="_blank" rel="noreferrer noopener">
                        <span className="ledger-main">
                          <span className="ledger-title block">{item.store}</span>
                          <span className="ledger-sub block">{hostOf(item.url) || item.url}</span>
                        </span>
                        <Icon name="openExternal" className="h-5 w-5 shrink-0 text-text-secondary" />
                        <span className="sr-only">(opens in a new tab)</span>
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {result.warnings?.length ? (
              <div className="rounded-lg border border-amber/60 bg-amber/[0.1] p-4">
                <p className="flex items-center gap-2 font-bold text-text-primary"><Icon name="info" className="h-5 w-5 shrink-0 text-amber" />Check before you quote</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-text-secondary">
                  {result.warnings.slice(0, 4).map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </div>
            ) : null}
          </section>
        )}
      </div>
    </div>
  )
}
