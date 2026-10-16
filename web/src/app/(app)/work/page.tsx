'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase, getShopId, calcTotals } from '@/lib/supabase'
import { money0, ageLabel } from '@/lib/today'
import { docLamp, docStatusLabel, docTypeLabel } from '@/lib/doc-status'
import Icon from '@/components/Icon'

type Row = Record<string, unknown>

const TOOLS = [
  { href: '/jobs', label: 'Jobs', icon: 'wrench', hint: 'Repair orders in progress' },
  { href: '/shopboard', label: 'Shop board', icon: 'board', hint: 'See every car by stage' },
  { href: '/dvi', label: 'Inspections', icon: 'inspect', hint: 'Photo inspection reports' },
  { href: '/canned-jobs', label: 'Canned jobs', icon: 'bolt', hint: 'Saved jobs you quote often' },
  { href: '/estimates?declined=1', label: 'Declined work', icon: 'flag', hint: 'Jobs customers said no to' },
  { href: '/insurance', label: 'Insurance claims', icon: 'shield', hint: 'Claims and adjuster notes' },
  { href: '/appointments', label: 'Schedule', icon: 'calendar', hint: 'Who is coming in' },
]

export default function WorkPage() {
  const [docs, setDocs] = useState<Row[] | null>(null)
  const [openJobs, setOpenJobs] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const shopId = await getShopId()
      if (!shopId) { setError('We could not find your shop. Refresh, or sign out and back in.'); return }
      const [d, j] = await Promise.all([
        supabase.from('documents').select('id,type,doc_number,status,customer_name,vehicle_year,vehicle_make,vehicle_model,parts,labors,tax_rate,apply_tax,shop_supplies,amount_paid,created_at').eq('shop_id', shopId).order('created_at', { ascending: false }).limit(500),
        supabase.from('jobs').select('id,status').eq('shop_id', shopId).not('status', 'in', '("Paid","Closed")'),
      ])
      if (d.error) throw d.error
      setDocs((d.data || []) as Row[])
      setOpenJobs((j.data || []).length)
      setError(null)
    } catch {
      setError('Your paperwork could not load. Check your connection and try again.')
    }
  }, [])

  useEffect(() => {
    load()
    const ch = supabase.channel('work_hub').on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, () => load()).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  const stats = useMemo(() => {
    const all = docs || []
    const est = all.filter(d => d.type === 'Estimate' && ['Draft', 'Sent'].includes(String(d.status)))
    const owed = all.filter(d => d.type === 'Invoice' && ['Unpaid', 'Partial', 'Sent'].includes(String(d.status))).map(d => calcTotals(d).balanceDue).filter(v => v > 0.005)
    return {
      est: { n: est.length, total: est.reduce((s, d) => s + calcTotals(d).total, 0) },
      owed: { n: owed.length, total: owed.reduce((s, v) => s + v, 0) },
    }
  }, [docs])

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div>
          <h1 className="page-title">Work</h1>
          <p className="page-subtitle">Estimates, invoices and the cars in your shop.</p>
        </div>
        <div className="toolbar">
          <Link href="/estimates?new=1" className="btn btn-primary"><Icon name="plus" className="h-5 w-5" />New estimate</Link>
          <Link href="/invoices?new=1" className="btn btn-secondary"><Icon name="plus" className="h-5 w-5" />New invoice</Link>
        </div>
      </header>

      {error && !docs && (
        <div role="alert" className="card mb-6 max-w-xl">
          <p className="text-red">{error}</p>
          <button className="btn btn-secondary btn-sm mt-3" onClick={() => { setError(null); load() }}>Try again</button>
        </div>
      )}

      <ul className="mb-9 grid gap-3 sm:grid-cols-3">
        <li>
          <Link href="/estimates" className="rotag lamp-amber">
            <span className="text-[0.875rem] font-bold text-text-secondary">Estimates waiting</span>
            <span className="display num mt-1 block text-[2rem] font-bold leading-none">{docs ? stats.est.n : '–'}</span>
            <span className="mt-1 block text-[0.9375rem] text-text-secondary">{docs ? `${money0(stats.est.total)} not yet approved` : 'Loading…'}</span>
          </Link>
        </li>
        <li>
          <Link href="/invoices" className={`rotag ${stats.owed.n > 0 ? 'lamp-red' : 'lamp-green'}`}>
            <span className="text-[0.875rem] font-bold text-text-secondary">Invoices unpaid</span>
            <span className="display num mt-1 block text-[2rem] font-bold leading-none">{docs ? stats.owed.n : '–'}</span>
            <span className="mt-1 block text-[0.9375rem] text-text-secondary">{docs ? (stats.owed.n ? `${money0(stats.owed.total)} to collect` : 'Everything is paid') : 'Loading…'}</span>
          </Link>
        </li>
        <li>
          <Link href="/jobs" className="rotag lamp-blue">
            <span className="text-[0.875rem] font-bold text-text-secondary">Cars in the shop</span>
            <span className="display num mt-1 block text-[2rem] font-bold leading-none">{docs ? openJobs : '–'}</span>
            <span className="mt-1 block text-[0.9375rem] text-text-secondary">{docs ? (openJobs ? 'Open repair orders' : 'No open repair orders') : 'Loading…'}</span>
          </Link>
        </li>
      </ul>

      <div className="grid gap-9 lg:grid-cols-[minmax(0,1fr)_20rem] lg:gap-10">
        <section aria-labelledby="recent-h" className="min-w-0">
          <div className="mb-2 flex items-end justify-between">
            <h2 id="recent-h" className="section-title">Latest paperwork</h2>
            <span className="flex gap-4 text-[0.9375rem] font-bold">
              <Link href="/estimates" className="text-blue underline-offset-4 hover:underline">All estimates</Link>
              <Link href="/invoices" className="text-blue underline-offset-4 hover:underline">All invoices</Link>
            </span>
          </div>
          {!docs ? (
            <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3, 4].map(i => <div key={i} className="skeleton h-16" />)}</div>
          ) : docs.length === 0 ? (
            <div className="empty-state">
              <p className="font-bold text-text-primary">No estimates or invoices yet</p>
              <p className="mt-1">Start with an estimate. Alpha can fill in the parts and labor from a description of the job.</p>
              <Link href="/estimates?new=1" className="btn btn-primary mt-4">Write your first estimate</Link>
            </div>
          ) : (
            <ul className="ledger">
              {docs.slice(0, 10).map(d => {
                const lamp = docLamp(String(d.type), String(d.status))
                const t = calcTotals(d)
                const car = [d.vehicle_year, d.vehicle_make, d.vehicle_model].filter(Boolean).join(' ')
                const href = `${d.type === 'Estimate' ? '/estimates' : '/invoices'}?document=${encodeURIComponent(String(d.id))}`
                return (
                  <li key={String(d.id)}>
                    <Link href={href} className="ledger-row">
                      <span className={`lamp lamp-${lamp}`} aria-hidden="true" />
                      <span className="ledger-main">
                        <span className="ledger-title block">{String(d.customer_name || 'No customer')}</span>
                        <span className="ledger-sub block">{docTypeLabel(String(d.type))} {String(d.doc_number || '')} · {docStatusLabel(String(d.type), String(d.status))}{car ? ` · ${car}` : ''}</span>
                      </span>
                      <span className="text-right">
                        <span className="ledger-amt block">{money0(t.total)}</span>
                        <span className="block text-[0.8125rem] text-text-muted">{ageLabel(String(d.created_at))}</span>
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section aria-labelledby="tools-h">
          <h2 id="tools-h" className="section-title mb-2">Shop tools</h2>
          <ul className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2 lg:grid-cols-1">
            {TOOLS.map(t => (
              <li key={t.href}>
                <Link href={t.href} className="flex min-h-[56px] items-center gap-3 rounded-md border border-border bg-bg-card px-3 no-underline hover:bg-bg-hover">
                  <Icon name={t.icon} className="h-5 w-5 shrink-0 text-text-secondary" />
                  <span className="min-w-0">
                    <span className="block font-bold leading-tight">{t.label}</span>
                    <span className="block truncate text-[0.8125rem] text-text-secondary">{t.hint}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}
