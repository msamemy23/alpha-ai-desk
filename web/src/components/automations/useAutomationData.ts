'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getShopProfile } from '@/lib/supabase'
import { cityFromProfile } from '@/lib/growth-text'
import { load } from './api'
import type { HistoryRow, Overview, Results, RunRow, Upcoming } from './model'
import type { CustomAutomation } from './types'

type Remote<T> = { state: 'loading' | 'ready' | 'error'; value: T; error: string }

/** Everything the Automations screen reads. Each list is kept apart, so one failing never hides the others. */
export function useAutomationData() {
  const [overview, setOverview] = useState<Remote<Overview | null>>({ state: 'loading', value: null, error: '' })
  const [custom, setCustom] = useState<Remote<CustomAutomation[]>>({ state: 'loading', value: [], error: '' })
  const [results, setResults] = useState<Remote<{ results: Results | null; upcoming: Upcoming | null }>>({ state: 'loading', value: { results: null, upcoming: null }, error: '' })
  const [days, setDays] = useState(30)
  const [city, setCity] = useState<{ search: string; label: string } | null>(null)
  const daysRef = useRef(days)
  useEffect(() => { daysRef.current = days }, [days])

  const loadOverview = useCallback(async () => {
    const r = await load('/api/system-automations', d => ({
      cards: Array.isArray(d.automations) ? d.automations : [],
      rules: d.rules,
      shop: d.shop,
      scheduler: d.scheduler,
      needsDatabaseUpdate: d.needs_database_update === true,
      attention: Array.isArray(d.attention) ? d.attention : [],
    }) as unknown as Overview)
    // A failed refresh keeps what was on screen, and says so.
    setOverview(prev => r.ok ? { state: 'ready', value: r.value, error: '' } : { state: 'error', value: prev.value, error: r.error })
  }, [])

  const loadCustom = useCallback(async () => {
    const r = await load('/api/automations', d => (Array.isArray(d.data) ? d.data : []) as CustomAutomation[])
    setCustom(prev => r.ok ? { state: 'ready', value: r.value, error: '' } : { state: 'error', value: prev.value, error: r.error })
  }, [])

  const loadResults = useCallback(async (nextDays?: number) => {
    const d = nextDays ?? daysRef.current
    const r = await load(`/api/automations/insights?days=${d}`, x => ({ results: (x.results ?? null) as Results | null, upcoming: (x.upcoming ?? null) as Upcoming | null }))
    setResults(prev => r.ok ? { state: 'ready', value: r.value, error: '' } : { state: 'error', value: prev.value, error: r.error })
  }, [])

  const reload = useCallback(() => {
    setOverview(p => ({ ...p, state: p.value ? p.state : 'loading' }))
    void loadOverview(); void loadCustom()
  }, [loadOverview, loadCustom])

  useEffect(() => { void loadOverview(); void loadCustom(); void loadResults() }, [loadOverview, loadCustom, loadResults])
  useEffect(() => {
    let cancelled = false
    getShopProfile().then(p => { if (!cancelled) setCity(cityFromProfile(p?.city_state_zip)) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const changeDays = useCallback((next: number) => { setDays(next); setResults(p => ({ ...p, state: 'loading' })); void loadResults(next) }, [loadResults])

  return { overview, custom, setCustom, results, days, changeDays, city, reload, loadOverview, loadCustom, loadResults }
}

export interface HistoryState {
  messages: HistoryRow[]
  runs: RunRow[]
  state: 'loading' | 'ready' | 'error'
  error: string
  available: boolean
  next: string | null
  loadingMore: boolean
}

/** The readable history: every message with its outcome, and every run. Loaded when the History tab opens. */
export function useHistory(enabled: boolean, filter: { automation: string; status: string }) {
  const [h, setH] = useState<HistoryState>({ messages: [], runs: [], state: 'loading', error: '', available: true, next: null, loadingMore: false })
  const key = `${filter.automation}|${filter.status}`
  const seq = useRef(0)

  const query = useCallback((extra = '') => {
    const q = new URLSearchParams({ limit: '50' })
    if (filter.automation) q.set('automation', filter.automation)
    if (filter.status) q.set('status', filter.status)
    return `/api/automations/history?${q.toString()}${extra}`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const reload = useCallback(async () => {
    const mine = ++seq.current
    setH(p => ({ ...p, state: p.messages.length ? p.state : 'loading' }))
    const runsUrl = `/api/automations/history?kind=runs&limit=15${filter.automation ? `&automation=${encodeURIComponent(filter.automation)}` : ''}`
    const [m, r] = await Promise.all([
      load(query(), d => ({ rows: (Array.isArray(d.messages) ? d.messages : []) as HistoryRow[], available: d.available !== false, next: typeof d.next === 'string' && d.next ? d.next : null })),
      load(runsUrl, d => (Array.isArray(d.runs) ? d.runs : []) as RunRow[]),
    ])
    if (mine !== seq.current) return
    setH(p => m.ok
      ? { messages: m.value.rows, runs: r.ok ? r.value : p.runs, state: 'ready', error: '', available: m.value.available, next: m.value.next, loadingMore: false }
      : { ...p, state: 'error', error: m.error, loadingMore: false })
  }, [query, filter.automation])

  const more = useCallback(async () => {
    if (!h.next) return
    setH(p => ({ ...p, loadingMore: true }))
    const r = await load(query(`&before=${encodeURIComponent(h.next as string)}`), d => ({ rows: (Array.isArray(d.messages) ? d.messages : []) as HistoryRow[], next: typeof d.next === 'string' && d.next ? d.next : null }))
    setH(p => r.ok ? { ...p, messages: [...p.messages, ...r.value.rows.filter(x => !p.messages.some(y => y.id === x.id))], next: r.value.next, loadingMore: false } : { ...p, loadingMore: false, error: r.error })
  }, [h.next, query])

  useEffect(() => { if (enabled) void reload() }, [enabled, reload])
  return { ...h, reload, more }
}
