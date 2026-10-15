'use client'
import Link from 'next/link'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import { ErrorCard, FilterChips } from '@/components/ListKit'
import { useStaff } from '@/components/team/useTeam'
import CallsTab from '@/components/reports/CallsTab'
import JobsTab from '@/components/reports/JobsTab'
import MoneyTab from '@/components/reports/MoneyTab'
import OverviewTab from '@/components/reports/OverviewTab'
import TechsTab from '@/components/reports/TechsTab'
import { KpiSkeleton } from '@/components/reports/parts'
import type { Ctx } from '@/components/reports/types'
import { useReportData } from '@/components/reports/useReportData'
import { PERIODS, isSale, keyOf, periodFor, rangeLabel, withFallbackPayments } from '@/lib/reports'
import type { PeriodKey } from '@/lib/reports'

type Tab = 'overview' | 'money' | 'jobs' | 'techs' | 'calls'
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'money', label: 'Money' },
  { key: 'jobs', label: 'Jobs' },
  { key: 'techs', label: 'Technicians' },
  { key: 'calls', label: 'Calls' },
]
const isTab = (v: string | null): v is Tab => TABS.some(t => t.key === v)
const isPeriod = (v: string | null): v is PeriodKey => PERIODS.some(p => p.key === v)

export default function ReportsPage() {
  // Anything that depends on today's date waits for the browser, so the server and browser never disagree.
  const [todayKey, setTodayKey] = useState('')
  const [period, setPeriod] = useState<PeriodKey>('30d')
  const [tab, setTab] = useState<Tab>('overview')
  const [refreshing, setRefreshing] = useState(false)
  const { docs, payments, jobs, calls, reload } = useReportData()
  const staff = useStaff()

  useEffect(() => {
    setTodayKey(keyOf(new Date()))
    const q = new URLSearchParams(window.location.search)
    const t = q.get('tab'), p = q.get('period')
    if (isTab(t)) setTab(t)
    if (isPeriod(p)) setPeriod(p)
  }, [])

  const choose = useCallback((next: { tab?: Tab; period?: PeriodKey }) => {
    if (next.tab) setTab(next.tab)
    if (next.period) setPeriod(next.period)
    const q = new URLSearchParams(window.location.search)
    if (next.tab) q.set('tab', next.tab)
    if (next.period) q.set('period', next.period)
    window.history.replaceState(null, '', `?${q.toString()}`)
  }, [])

  const refresh = async () => { setRefreshing(true); try { await Promise.all([reload(), staff.reload()]) } finally { setRefreshing(false) } }

  const info = useMemo(() => (todayKey ? periodFor(period, todayKey) : null), [period, todayKey])
  const pays = useMemo(() => withFallbackPayments(docs.rows, payments.rows), [docs.rows, payments.rows])
  const ctx: Ctx | null = useMemo(
    () => (info ? { todayKey, period, range: info.range, previous: info.previous, docs: docs.rows, payments: pays } : null),
    [info, todayKey, period, docs.rows, pays],
  )

  const moneyError = docs.error || payments.error
  const moneyLoaded = docs.loaded && payments.loaded
  const hasSales = useMemo(() => docs.rows.some(isSale), [docs.rows])
  const needsDocs = tab === 'overview' || tab === 'money' || tab === 'techs'

  const body = () => {
    if (!ctx || (needsDocs && !(tab === 'techs' ? docs.loaded : moneyLoaded))) {
      return (
        <div className="space-y-4">
          <KpiSkeleton />
          <div className="skeleton h-64" role="status" aria-label="Loading chart" />
        </div>
      )
    }
    if (needsDocs && (tab === 'techs' ? docs.error : moneyError)) {
      return <ErrorCard title="Reports could not load the money figures" message={(tab === 'techs' ? docs.error : moneyError) || 'Check your connection and try again.'} onRetry={refresh} busy={refreshing} />
    }
    if (needsDocs && !hasSales && tab !== 'techs') {
      return (
        <div className="empty-state">
          <p className="font-bold text-text-primary">No invoices yet</p>
          <p className="mx-auto mt-1 max-w-md">Reports are built from your invoices and payments. Write your first invoice and this fills in.</p>
          <Link href="/invoices?new=1" className="btn btn-primary mt-4">Write an invoice</Link>
        </div>
      )
    }
    switch (tab) {
      case 'overview': return <OverviewTab ctx={ctx} calls={calls} />
      case 'money': return <MoneyTab ctx={ctx} />
      case 'techs': return <TechsTab ctx={ctx} jobs={jobs.rows} people={staff.people} peopleError={staff.error} />
      case 'jobs':
        if (!jobs.loaded) return <KpiSkeleton count={3} />
        if (jobs.error) return <ErrorCard title="Jobs did not load" message={jobs.error} onRetry={refresh} busy={refreshing} />
        return <JobsTab ctx={ctx} jobs={jobs.rows} />
      case 'calls':
        if (!calls.loaded) return <KpiSkeleton count={4} />
        if (calls.error) return <ErrorCard title="Calls did not load" message={calls.error} onRetry={refresh} busy={refreshing} />
        return <CallsTab ctx={ctx} calls={calls.rows} />
    }
  }

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div>
          <h1 className="page-title">Reports</h1>
          <p className="page-subtitle num">
            {info ? `${rangeLabel(info.range)}. Compared with ${rangeLabel(info.previous)}.` : 'Loading'}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1 sm:w-48 sm:flex-none">
            <label htmlFor="report-period" className="form-label">Period</label>
            <select id="report-period" className="form-select" value={period} onChange={e => choose({ period: e.target.value as PeriodKey })}>
              {PERIODS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
          </div>
          <button type="button" className="btn btn-secondary" onClick={refresh} disabled={refreshing} aria-label="Refresh reports">
            <Icon name="refresh" className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{refreshing ? 'Refreshing' : 'Refresh'}</span>
          </button>
        </div>
      </header>

      <div className="mb-4">
        <FilterChips<Tab> label="Report" options={TABS} value={tab} onChange={k => choose({ tab: k })} scroll />
      </div>

      {body()}
    </div>
  )
}
