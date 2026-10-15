'use client'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import { ErrorCard, FilterChips } from '@/components/ListKit'
import { useStaff } from '@/components/team/useTeam'
import AccountingTab, { isAccountingSection } from '@/components/reports/AccountingTab'
import type { AccountingSection } from '@/components/reports/AccountingTab'
import CallsTab from '@/components/reports/CallsTab'
import DrillSheet from '@/components/reports/DrillSheet'
import type { DrillTarget } from '@/components/reports/DrillSheet'
import EmailedTab from '@/components/reports/EmailedTab'
import JobsTab from '@/components/reports/JobsTab'
import MoneyTab from '@/components/reports/MoneyTab'
import OverviewTab from '@/components/reports/OverviewTab'
import ProfitTab from '@/components/reports/ProfitTab'
import RangeBar from '@/components/reports/RangeBar'
import SalesTab from '@/components/reports/SalesTab'
import TechsTab from '@/components/reports/TechsTab'
import { KpiSkeleton } from '@/components/reports/parts'
import { bundleInput } from '@/components/reports/bundle'
import type { Ctx } from '@/components/reports/types'
import { useBooks } from '@/components/reports/useBooks'
import { useReportData } from '@/components/reports/useReportData'
import { DEFAULT_RANGE, periodPhrase, rangeFromParams, rangeToParams, resolveRange } from '@/lib/report-ranges'
import type { RangeState } from '@/lib/report-ranges'
import { withAiOnlyCalls } from '@/lib/report-calls'
import { isSale, keyOf, rangeLabel, withFallbackPayments } from '@/lib/reports'

type Tab = 'overview' | 'sales' | 'profit' | 'money' | 'jobs' | 'techs' | 'calls' | 'accounting' | 'emailed'
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'sales', label: 'Sales' },
  { key: 'profit', label: 'Profit' },
  { key: 'money', label: 'Money' },
  { key: 'jobs', label: 'Jobs' },
  { key: 'techs', label: 'Technicians' },
  { key: 'calls', label: 'Calls' },
  { key: 'accounting', label: 'Accounting' },
  { key: 'emailed', label: 'Emailed' },
]
const isTab = (v: string | null): v is Tab => TABS.some(t => t.key === v)
const NEEDS_MONEY: Tab[] = ['overview', 'sales', 'profit', 'money']

export default function ReportsPage() {
  // Anything that depends on today's date waits for the browser, so the server and browser never disagree.
  const [todayKey, setTodayKey] = useState('')
  const [range, setRange] = useState<RangeState>(DEFAULT_RANGE)
  const [tab, setTab] = useState<Tab>('overview')
  const [section, setSection] = useState<AccountingSection>('package')
  const [refreshing, setRefreshing] = useState(false)
  const [drill, setDrill] = useState<DrillTarget | null>(null)
  const { docs, extended, payments, jobs, calls, aiCalls, shop, reload } = useReportData()
  const staff = useStaff()
  const books = useBooks(todayKey !== '')

  useEffect(() => {
    setTodayKey(keyOf(new Date()))
    const q = new URLSearchParams(window.location.search)
    const t = q.get('tab'), s = q.get('section')
    if (isTab(t)) setTab(t)
    if (isAccountingSection(s)) setSection(s)
    setRange(rangeFromParams(q))
  }, [])

  const writeUrl = useCallback((next: { tab?: Tab; section?: AccountingSection; range?: RangeState }) => {
    const q = new URLSearchParams(window.location.search)
    if (next.tab) q.set('tab', next.tab)
    if (next.section) q.set('section', next.section)
    if (next.range) {
      for (const k of ['period', 'from', 'to', 'compare', 'cfrom', 'cto']) q.delete(k)
      for (const [k, v] of Object.entries(rangeToParams(next.range))) q.set(k, v)
    }
    window.history.replaceState(null, '', `?${q.toString()}`)
  }, [])
  const chooseTab = useCallback((t: Tab) => { setTab(t); writeUrl({ tab: t }) }, [writeUrl])
  const chooseSection = useCallback((s: AccountingSection) => { setSection(s); setTab('accounting'); writeUrl({ tab: 'accounting', section: s }) }, [writeUrl])
  const chooseRange = useCallback((r: RangeState) => { setRange(r); writeUrl({ range: r }) }, [writeUrl])

  const refresh = async () => { setRefreshing(true); try { await Promise.all([reload(), staff.reload(), books.reload()]) } finally { setRefreshing(false) } }

  const earliest = useMemo(() => docs.rows.reduce((m, d) => (d.date && (!m || d.date < m) ? d.date : m), ''), [docs.rows])
  const resolved = useMemo(() => (todayKey ? resolveRange(range.spec, range.cmp, todayKey, earliest || undefined) : null), [range, todayKey, earliest])
  const pays = useMemo(() => withFallbackPayments(docs.rows, payments.rows), [docs.rows, payments.rows])
  const ctx: Ctx | null = useMemo(
    () => (resolved ? {
      todayKey, spec: range.spec, range: resolved.range, previous: resolved.previous, vs: resolved.vs, phrase: periodPhrase(range.spec, resolved.range), title: resolved.title,
      docs: docs.rows, payments: pays, extended, shop, drill: setDrill,
    } : null),
    [resolved, todayKey, range.spec, docs.rows, pays, extended, shop],
  )

  const booksData = books.state.status === 'ready' ? books.state.books : null
  const callList = useMemo(() => {
    if (!calls.loaded || calls.error) return null
    if (!aiCalls.loaded) return null
    return withAiOnlyCalls(calls.rows, aiCalls.error ? [] : aiCalls.rows)
  }, [calls, aiCalls])
  const input = useMemo(() => (ctx ? bundleInput(ctx, booksData, callList) : null), [ctx, booksData, callList])
  const laborCost = booksData && booksData.settings.state === 'ok' ? booksData.settings.value.laborCostPerHour : null

  const moneyError = docs.error || payments.error
  const moneyLoaded = docs.loaded && payments.loaded
  const hasSales = useMemo(() => docs.rows.some(isSale), [docs.rows])
  const needsMoney = NEEDS_MONEY.includes(tab) || (tab === 'accounting' && ['package', 'close', 'quickbooks'].includes(section))
  const needsDocsOnly = tab === 'techs'

  const body = () => {
    if (!ctx || !input || !resolved) {
      return (
        <div className="space-y-4">
          <KpiSkeleton />
          <div className="skeleton h-64" role="status" aria-label="Loading chart" />
        </div>
      )
    }
    if (tab === 'emailed') return <EmailedTab today={todayKey} />
    if (needsMoney || needsDocsOnly) {
      if (!(needsDocsOnly ? docs.loaded : moneyLoaded)) {
        return (
          <div className="space-y-4">
            <KpiSkeleton />
            <div className="skeleton h-64" role="status" aria-label="Loading chart" />
          </div>
        )
      }
      const err = needsDocsOnly ? docs.error : moneyError
      if (err) return <ErrorCard title="Reports could not load the money figures" message={err || 'Check your connection and try again.'} onRetry={refresh} busy={refreshing} />
      if (!hasSales && !needsDocsOnly && tab !== 'accounting') {
        return (
          <div className="empty-state">
            <p className="font-bold text-text-primary">No invoices yet</p>
            <p className="mx-auto mt-1 max-w-md">Reports are built from your invoices and payments. Write your first invoice and this fills in.</p>
            <Link href="/invoices?new=1" className="btn btn-primary mt-4">Write an invoice</Link>
          </div>
        )
      }
    }
    switch (tab) {
      case 'overview': return <OverviewTab ctx={ctx} calls={callList} laborCostPerHour={laborCost} />
      case 'sales': return <SalesTab ctx={ctx} input={input} />
      case 'profit': return <ProfitTab ctx={ctx} input={input} books={{ state: books.state, reload: books.reload }} onGoSettings={() => chooseSection('settings')} />
      case 'money': return <MoneyTab ctx={ctx} input={input} books={{ state: books.state }} onGoSettings={() => chooseSection('settings')} />
      case 'techs': return <TechsTab ctx={ctx} jobs={jobs.rows} people={staff.people} peopleError={staff.error} />
      case 'jobs':
        if (!jobs.loaded) return <KpiSkeleton count={3} />
        if (jobs.error) return <ErrorCard title="Jobs did not load" message={jobs.error} onRetry={refresh} busy={refreshing} />
        return <JobsTab ctx={ctx} jobs={jobs.rows} />
      case 'calls':
        if (!calls.loaded) return <KpiSkeleton count={4} />
        if (calls.error) return <ErrorCard title="Calls did not load" message={calls.error} onRetry={refresh} busy={refreshing} />
        return <CallsTab ctx={ctx} calls={calls.rows} ai={aiCalls} />
      case 'accounting':
        return <AccountingTab ctx={ctx} books={books} people={staff.people} peopleError={staff.error} retryPeople={staff.reload} section={section} onSection={chooseSection} />
      default: return null
    }
  }

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-subtitle num">
            {resolved ? `${rangeLabel(resolved.range)}${resolved.previous ? `. Compared with ${rangeLabel(resolved.previous)}.` : '. No comparison.'}` : 'Loading'}
          </p>
        </div>
        <button type="button" className="btn btn-secondary" onClick={refresh} disabled={refreshing} aria-label="Refresh reports">
          <Icon name="refresh" className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
          <span className="hidden sm:inline">{refreshing ? 'Refreshing' : 'Refresh'}</span>
        </button>
      </header>

      <div className="mb-4">
        <FilterChips<Tab> label="Report" options={TABS} value={tab} onChange={chooseTab} scroll />
      </div>

      {resolved && tab !== 'emailed' && <RangeBar value={range} resolved={resolved} onChange={chooseRange} today={todayKey} />}

      {body()}
      <DrillSheet target={drill} onClose={() => setDrill(null)} />
    </div>
  )
}
