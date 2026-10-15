'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getShopId, supabase } from '@/lib/supabase'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { EmptyBlock, ErrorCard, hostOf, Pill, safeHref } from '@/components/ListKit'
import { estimatePrompt, lookupErrorText, roundCents, searchStock, usd } from '@/lib/list-logic'
import { KitPanel, OptionPanel } from '@/components/parts/ResultViews'
import { QUICK_PARTS, STORE_CHOICES, confidenceLabel, confidenceLamp } from '@/components/parts/types'
import type { KitOption, PartOption, PartsLookupResult, StockItem } from '@/components/parts/types'

const SAVED = 'parts_lookup_last'
const SAVED_FOR_MS = 30 * 60 * 1000
const TIMEOUT_MS = 50_000

interface CarChoice { id: string; label: string; year: string; make: string; model: string }

class LookupError extends Error {}

async function getAuthJsonHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (token) headers.Authorization = `Bearer ${token}`
  return headers
}

/** The lookup is built by an AI and the shape can drift. Anything missing becomes an empty list, never a crash. */
function tidy(raw: Partial<PartsLookupResult> | null | undefined): PartsLookupResult {
  const r = raw || {}
  const options: PartOption[] = (Array.isArray(r.options) ? r.options : []).map(o => ({ ...o, parts: Array.isArray(o?.parts) ? o.parts : [] })).filter(o => o.parts.length > 0)
  return {
    vehicle: String(r.vehicle || ''),
    query: String(r.query || ''),
    positions: Array.isArray(r.positions) ? r.positions : [],
    options,
    kits: Array.isArray(r.kits) ? r.kits : [],
    taxRate: r.taxRate ?? null,
    laborHours: Number(r.laborHours) > 0 ? Number(r.laborHours) : null,
    laborRate: Number(r.laborRate) > 0 ? Number(r.laborRate) : null,
    laborGuidance: r.laborGuidance,
    searchUrls: Array.isArray(r.searchUrls) ? r.searchUrls : [],
    sourceConfidence: r.sourceConfidence || 'price_unavailable',
    warnings: Array.isArray(r.warnings) ? r.warnings : [],
  }
}

export default function PartsLookupPage() {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [vehicle, setVehicle] = useState({ year: '', make: '', model: '' })
  const [stores, setStores] = useState<string[]>([])
  const [result, setResult] = useState<PartsLookupResult | null>(null)
  const [checkedAt, setCheckedAt] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)
  const [yearError, setYearError] = useState('')
  const [handoffError, setHandoffError] = useState('')
  const [stock, setStock] = useState<StockItem[]>([])
  const [cars, setCars] = useState<CarChoice[]>([])
  const resultsRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  const verifiedCount = (result?.options || []).reduce((count, option) => count + option.parts.length, 0) + (result?.kits.length || 0)
  const canSearch = [vehicle.year, vehicle.make, vehicle.model, query].some(v => v.trim())
  const noCar = !vehicle.year.trim() && !vehicle.make.trim() && !vehicle.model.trim()

  // The shop's own shelf and customers' cars make the lookup faster; the page works without them.
  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const shopId = await getShopId()
        if (!shopId) return
        const [inv, cust] = await Promise.all([
          supabase.from('inventory').select('id,name,part_number,supplier_part_number,brand,category,qty_on_hand,location').eq('shop_id', shopId).limit(2000),
          supabase.from('customers').select('id,name,vehicle_year,vehicle_make,vehicle_model').eq('shop_id', shopId).limit(1000),
        ])
        if (!live) return
        if (!inv.error) setStock((inv.data || []) as StockItem[])
        if (!cust.error) {
          const list: CarChoice[] = []
          for (const c of (cust.data || []) as Array<Record<string, unknown>>) {
            const make = String(c.vehicle_make || '').trim(), model = String(c.vehicle_model || '').trim(), year = String(c.vehicle_year || '').trim()
            if (!make || !model) continue
            list.push({ id: String(c.id), label: `${[year, make, model].filter(Boolean).join(' ')}, ${String(c.name || 'No name')}`, year, make, model })
          }
          list.sort((a, b) => a.label.localeCompare(b.label))
          setCars(list)
        }
      } catch { /* the lookup still works without them */ }
    })()
    return () => { live = false }
  }, [])

  // Come back to the last search after opening a store page or another screen.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(SAVED)
      if (!raw) return
      const s = JSON.parse(raw)
      if (!s || typeof s.at !== 'number' || Date.now() - s.at > SAVED_FOR_MS) return
      setVehicle({ year: String(s.vehicle?.year || ''), make: String(s.vehicle?.make || ''), model: String(s.vehicle?.model || '') })
      setQuery(String(s.query || ''))
      setStores(Array.isArray(s.stores) ? s.stores.map(String) : [])
      setResult(tidy(s.result)); setCheckedAt(s.at); setSearched(true)
    } catch { /* nothing saved, or the browser blocks storage */ }
  }, [])

  useEffect(() => () => abortRef.current?.abort(), [])

  const bringIntoView = () => requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }))

  const search = async () => {
    const request = [vehicle.year, vehicle.make, vehicle.model, query].map(v => v.trim()).filter(Boolean).join(' ')
    if (!request || loading) return
    if (vehicle.year.trim() && !/^\d{4}$/.test(vehicle.year.trim())) {
      setYearError('Enter the year as four digits, like 2016.')
      document.getElementById('pl-year')?.focus()
      return
    }
    setYearError('')
    const controller = new AbortController()
    abortRef.current = controller
    let timedOut = false
    const timer = setTimeout(() => { timedOut = true; controller.abort() }, TIMEOUT_MS)
    setLoading(true); setSearched(true); setError(''); setHandoffError(''); setResult(null)
    bringIntoView()
    try {
      const res = await fetch('/api/parts-lookup', {
        method: 'POST',
        headers: await getAuthJsonHeaders(),
        body: JSON.stringify({ query: request, stores }),
        signal: controller.signal,
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok || !data.ok) throw new LookupError(lookupErrorText(res.status, data.code, data.error))
      const tidied = tidy(data.data)
      const at = Date.now()
      setResult(tidied); setCheckedAt(at)
      try { sessionStorage.setItem(SAVED, JSON.stringify({ at, vehicle, query, stores, result: tidied })) } catch { /* fine without it */ }
      bringIntoView()
    } catch (err) {
      if (controller.signal.aborted && !timedOut) return // the person pressed Cancel
      setError(timedOut ? 'The stores took too long to answer. Try again, or pick fewer stores.' : err instanceof LookupError ? err.message : 'We could not reach the lookup. Check your connection, then search again.')
      bringIntoView()
    } finally {
      clearTimeout(timer)
      if (abortRef.current === controller) { abortRef.current = null; setLoading(false) }
    }
  }

  const cancel = () => {
    abortRef.current?.abort(); abortRef.current = null
    setLoading(false); setSearched(false)
  }

  const clearAll = () => {
    setQuery(''); setVehicle({ year: '', make: '', model: '' }); setStores([]); setResult(null); setCheckedAt(null)
    setSearched(false); setError(''); setYearError(''); setHandoffError('')
    try { sessionStorage.removeItem(SAVED) } catch { /* nothing to clear */ }
  }

  const toggleStore = (value: string) => setStores(prev => prev.includes(value) ? prev.filter(item => item !== value) : [...prev, value])

  const hand = useCallback((pick: { option?: PartOption; kit?: KitOption }) => {
    if (!result) return
    try {
      localStorage.setItem('ai_prefill', estimatePrompt({ vehicle: result.vehicle, query: result.query, laborHours: result.laborHours, laborRate: result.laborRate, ...pick }))
    } catch {
      setHandoffError('Your browser blocked saving the parts for Ask Alpha. Allow site storage for Alpha, then try again.')
      return
    }
    router.push('/ai')
  }, [result, router])

  const onShelf = useMemo(() => searchStock(stock, query, 5), [stock, query])
  const laborCost = result?.laborHours && result.laborRate ? roundCents(result.laborHours * result.laborRate) : null
  const warnings = (result?.warnings || []).filter(w => w !== result?.laborGuidance?.note).slice(0, 6)
  const checkedText = checkedAt ? new Date(checkedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div>
          <h1 className="page-title">Parts lookup</h1>
          <p className="page-subtitle">Real prices from store pages, or the source link when a price cannot be verified.</p>
        </div>
      </header>

      <form className="card" onSubmit={e => { e.preventDefault(); if (canSearch && !loading) void search() }} aria-label="Parts search">
        {cars.length > 0 && (
          <div className="mb-4">
            <label className="form-label !text-[0.875rem]" htmlFor="pl-car">Start from a car in your shop</label>
            <select
              id="pl-car"
              className="form-select"
              value=""
              onChange={e => { const c = cars.find(x => x.id === e.target.value); if (c) { setVehicle({ year: c.year, make: c.make, model: c.model }); setYearError('') } }}
            >
              <option value="">Choose a customer&apos;s car</option>
              {cars.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
        )}

        <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-3 sm:grid-cols-[6rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.5fr)]">
          <div>
            <label className="form-label !text-[0.875rem]" htmlFor="pl-year">Year</label>
            <input
              id="pl-year" className="form-input num" inputMode="numeric" maxLength={4} autoComplete="off" placeholder="2016"
              aria-invalid={yearError ? true : undefined} aria-describedby={yearError ? 'pl-year-err' : undefined}
              value={vehicle.year} onChange={e => { setVehicle(v => ({ ...v, year: e.target.value })); setYearError('') }}
            />
          </div>
          <div>
            <label className="form-label !text-[0.875rem]" htmlFor="pl-make">Make</label>
            <input id="pl-make" className="form-input" autoComplete="off" placeholder="Toyota" value={vehicle.make} onChange={e => setVehicle(v => ({ ...v, make: e.target.value }))} />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="form-label !text-[0.875rem]" htmlFor="pl-model">Model</label>
            <input id="pl-model" className="form-input" autoComplete="off" placeholder="Camry" value={vehicle.model} onChange={e => setVehicle(v => ({ ...v, model: e.target.value }))} />
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="form-label !text-[0.875rem]" htmlFor="pl-part">Part or service</label>
            <input id="pl-part" className="form-input" autoComplete="off" placeholder="Front brake pads" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
        </div>
        {yearError && <p id="pl-year-err" role="alert" className="form-error !text-[0.875rem]">{yearError}</p>}

        <div className="-mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0" role="group" aria-label="Common parts">
          {QUICK_PARTS.map(p => (
            <button key={p} type="button" className="inline-flex min-h-[44px] shrink-0 items-center whitespace-nowrap rounded-full border border-[rgb(var(--c-line))] bg-bg-card px-4 text-[0.9375rem] text-text-primary hover:bg-bg-hover sm:min-h-[38px]" onClick={() => setQuery(p)}>{p}</button>
          ))}
        </div>

        <fieldset className="mt-4">
          <legend className="form-label !text-[0.875rem]">Stores to check</legend>
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
          <p className="form-hint !text-[0.875rem] !text-text-secondary">{stores.length ? `Checking ${stores.length} ${stores.length === 1 ? 'store' : 'stores'}.` : 'Leave all off to check every store.'}</p>
        </fieldset>

        {query.trim() && noCar && (
          <Notice kind="info" className="mt-4">Add the year, make and model so the parts fit this car. Without a car, results can be for the wrong one.</Notice>
        )}

        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
          <button type="submit" className="btn btn-primary btn-lg w-full sm:w-auto" disabled={loading || !canSearch}>
            <Icon name="search" className="h-5 w-5" />
            {loading ? 'Searching…' : 'Search'}
          </button>
          {(result || searched || query || !noCar) && !loading && (
            <button type="button" className="btn btn-secondary btn-lg w-full sm:w-auto" onClick={clearAll}>Clear</button>
          )}
        </div>
      </form>

      <div ref={resultsRef} className="mt-6 scroll-mt-20" aria-live="polite">
        {loading && (
          <div role="status" aria-busy="true">
            <p className="mb-3 text-text-secondary">Checking store pages. This can take up to a minute.</p>
            <div className="space-y-3">
              <div className="skeleton h-24" />
              <div className="skeleton h-24" />
              <div className="skeleton h-24" />
            </div>
            <button type="button" className="btn btn-secondary mt-4" onClick={cancel}>Cancel search</button>
          </div>
        )}

        {!loading && error && <ErrorCard title="Parts lookup did not finish" message={error} onRetry={() => void search()} />}

        {!loading && !error && !searched && onShelf.length === 0 && (
          <EmptyBlock icon="parts" title="Search for a part">
            Enter the car and the part or service you need. Alpha checks store pages and only shows prices it can verify.
          </EmptyBlock>
        )}

        {!loading && !error && !searched && onShelf.length > 0 && <ShelfCard items={onShelf} />}

        {!loading && !error && searched && !result && (
          <EmptyBlock icon="search" title="No sources found">
            Try fewer words, check the spelling, or turn on more stores.
          </EmptyBlock>
        )}

        {result && !loading && (
          <section className="space-y-5" aria-labelledby="pl-result">
            <div className="min-w-0">
              <h2 id="pl-result" className="section-title text-[1.375rem]">{result.vehicle || result.query}</h2>
              <div className="mt-2 flex flex-wrap gap-2">
                <Pill lamp={confidenceLamp(result.sourceConfidence)}>{confidenceLabel(result.sourceConfidence)}</Pill>
                <Pill><span className="num">{verifiedCount}</span>&nbsp;verified price {verifiedCount === 1 ? 'item' : 'items'}</Pill>
                {result.positions?.length ? <Pill>{result.positions.join(', ')}</Pill> : null}
              </div>
              {checkedText && <p className="mt-2 text-[0.9375rem] text-text-secondary">Checked at {checkedText}. Prices and stock change, so confirm on the store page before you order.</p>}
            </div>
            {handoffError && <Notice kind="error">{handoffError}</Notice>}

            {(result.laborHours || result.laborGuidance) && (
              <Notice kind="info">
                <p className="font-bold">Labor reference{result.laborGuidance?.operation ? `: ${result.laborGuidance.operation}` : ''}</p>
                <p className="num mt-0.5">
                  {result.laborHours ? `${result.laborHours} ${result.laborHours === 1 ? 'hour' : 'hours'}` : 'No hours given'}
                  {laborCost !== null ? ` at ${usd(result.laborRate)} per hour is ${usd(laborCost)}.` : '.'}
                </p>
                <p className="mt-0.5">This is a generic baseline, not a labor guide. Check the time before you quote.{!result.laborRate && <> Set your labor rate in <Link href="/settings" className="font-bold text-blue underline underline-offset-2">Settings</Link> to see the cost.</>}</p>
              </Notice>
            )}

            {onShelf.length > 0 && <ShelfCard items={onShelf} />}

            {verifiedCount === 0 && (
              <div className="rounded-lg border border-amber/60 bg-amber/[0.1] p-4">
                <p className="flex items-center gap-2 font-bold text-text-primary"><Icon name="alert" className="h-5 w-5 shrink-0 text-amber" />No exact prices verified</p>
                <p className="mt-1 text-text-secondary">The lookup found sources, but no price passed verification. Open the source links below and check the price yourself before you build an estimate.</p>
              </div>
            )}

            {result.options.length > 0 && (
              <p className="text-[0.9375rem] text-text-secondary">Build an estimate sends the parts and labor to Ask Alpha, which starts drafting right away.</p>
            )}

            {result.options.map((option, i) => (
              <OptionPanel key={`${option.brand}-${option.tier}-${i}`} option={option} stock={stock} onBuild={() => hand({ option })} />
            ))}

            {result.kits.length > 0 && <KitPanel kits={result.kits} onBuild={kit => hand({ kit })} />}

            {result.searchUrls.length > 0 && (
              <section className="panel" aria-label="Source links">
                <div className="panel-header"><h3 className="section-title">Source links</h3></div>
                <ul className="ledger !border-t-0">
                  {result.searchUrls.slice(0, 10).map((item, i) => (
                    <li key={`${item.url}-${i}`}>
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
            )}

            {warnings.length > 0 && (
              <Notice kind="warn">
                <p className="font-bold">Check before you quote</p>
                <ul className="mt-1 list-disc space-y-1 pl-5">
                  {warnings.map((w, i) => <li key={i}>{w}</li>)}
                </ul>
              </Notice>
            )}
          </section>
        )}
      </div>
    </div>
  )
}

/** Matches on the shop's own shelf for what is typed in the part box. */
function ShelfCard({ items }: { items: StockItem[] }) {
  return (
    <section className="panel" aria-label="Already on your shelf">
      <div className="panel-header">
        <h3 className="section-title">Already on your shelf</h3>
        <Link href="/inventory" className="inline-flex min-h-[44px] items-center font-bold text-blue underline-offset-4 hover:underline">Open inventory</Link>
      </div>
      <ul className="ledger !border-t-0">
        {items.map(p => {
          const have = p.qty_on_hand || 0
          return (
            <li key={p.id}>
              <div className="ledger-row items-start py-3">
                <div className="ledger-main">
                  <p className="font-bold leading-snug">{p.name}</p>
                  <p className="text-[0.9375rem] text-text-secondary">{[p.brand, p.part_number, p.location].filter(Boolean).join(' · ') || 'No details'}</p>
                </div>
                <p className="flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[0.9375rem] font-bold">
                  <span className={`lamp ${have > 0 ? 'lamp-green' : 'lamp-red'}`} aria-hidden="true" />
                  {have > 0 ? <><span className="num">{have}</span>&nbsp;on hand</> : 'None on hand'}
                </p>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
