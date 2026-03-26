'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Invoice { id: string; customer_name: string; total: number; amount_paid: number; status: string; created_at: string; payment_method: string }
interface Job { id: string; status: string; tech: string; concern: string; created_at: string }
interface CallRecord { id: string; direction: string; duration_secs: number; start_time: string; status: string }

function fmtCur(n: number) { return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) }

type Period = '7d' | '30d' | '90d' | 'ytd'

function exportCsv(rows: string[][], filename: string) {
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

export default function ReportsPage() {
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [calls, setCalls] = useState<CallRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [period, setPeriod] = useState<Period>('30d')
  const [tab, setTab] = useState<'overview'|'revenue'|'jobs'|'calls'|'tax'>('overview')

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const [{ data: inv }, { data: j }, { data: c }] = await Promise.all([
          supabase.from('invoices').select('id,customer_name,total,amount_paid,status,created_at,payment_method').order('created_at', { ascending: false }).limit(1000),
          supabase.from('jobs').select('id,status,tech,concern,created_at').order('created_at', { ascending: false }).limit(2000),
          supabase.from('call_history').select('id,direction,duration_secs,start_time,status').order('start_time', { ascending: false }).limit(2000),
        ])
        setInvoices((inv || []) as Invoice[])
        setJobs((j || []) as Job[])
        setCalls((c || []) as CallRecord[])
      } finally { setLoading(false) }
    }
    load()
  }, [])

  function periodStart(): Date {
    const d = new Date()
    if (period === '7d') d.setDate(d.getDate() - 7)
    else if (period === '30d') d.setDate(d.getDate() - 30)
    else if (period === '90d') d.setDate(d.getDate() - 90)
    else { d.setMonth(0); d.setDate(1) }
    return d
  }

  const start = periodStart()
  const filteredInvoices = invoices.filter(i => new Date(i.created_at) >= start)
  const filteredJobs = jobs.filter(j => new Date(j.created_at) >= start)
  const filteredCalls = calls.filter(c => new Date(c.start_time) >= start)

  const totalRevenue = filteredInvoices.reduce((s, i) => s + (i.amount_paid || i.total || 0), 0)
  const avgTicket = filteredInvoices.length ? totalRevenue / filteredInvoices.length : 0
  const completedJobs = filteredJobs.filter(j => ['Completed','Paid','Closed'].includes(j.status)).length
  const inboundCalls = filteredCalls.filter(c => c.direction === 'inbound').length
  const avgCallDuration = filteredCalls.length ? filteredCalls.reduce((s, c) => s + (c.duration_secs || 0), 0) / filteredCalls.length : 0

  // Monthly revenue (last 6 months)
  const monthlyRevenue: Record<string, number> = {}
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i)
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`
    monthlyRevenue[key] = 0
  }
  for (const inv of invoices) {
    const key = inv.created_at?.slice(0, 7)
    if (key && Object.prototype.hasOwnProperty.call(monthlyRevenue, key)) {
      monthlyRevenue[key] += (inv.amount_paid || inv.total || 0)
    }
  }
  const monthlyData = Object.entries(monthlyRevenue).map(([k, v]) => ({
    label: new Date(k + '-15').toLocaleDateString('en-US', { month: 'short' }),
    value: v
  }))
  const maxMonthly = Math.max(...monthlyData.map(m => m.value), 1)

  const payMethods: Record<string, number> = {}
  for (const inv of filteredInvoices) {
    const pm = inv.payment_method || 'Other'
    payMethods[pm] = (payMethods[pm] || 0) + (inv.amount_paid || inv.total || 0)
  }

  const techStats: Record<string, { jobs: number; name: string }> = {}
  for (const j of filteredJobs) {
    if (!j.tech || j.tech === 'Unassigned') continue
    if (!techStats[j.tech]) techStats[j.tech] = { jobs: 0, name: j.tech }
    techStats[j.tech].jobs++
  }
  const techList = Object.values(techStats).sort((a, b) => b.jobs - a.jobs)

  const services: Record<string, number> = {}
  for (const j of filteredJobs) {
    if (!j.concern) continue
    const svc = j.concern.toLowerCase().trim().slice(0, 40)
    services[svc] = (services[svc] || 0) + 1
  }
  const topServices = Object.entries(services).sort((a, b) => b[1] - a[1]).slice(0, 10)

  // Tax report: quarterly grouping
  const quarterlyTax: Record<string, { revenue: number; count: number; invoices: Invoice[] }> = {}
  for (const inv of invoices) {
    const d = new Date(inv.created_at)
    const q = Math.ceil((d.getMonth() + 1) / 3)
    const key = `${d.getFullYear()} Q${q}`
    if (!quarterlyTax[key]) quarterlyTax[key] = { revenue: 0, count: 0, invoices: [] }
    quarterlyTax[key].revenue += (inv.amount_paid || inv.total || 0)
    quarterlyTax[key].count++
    quarterlyTax[key].invoices.push(inv)
  }
  const quarterList = Object.entries(quarterlyTax).sort((a, b) => b[0].localeCompare(a[0]))

  const exportTaxCsv = () => {
    const rows = [['Date', 'Customer', 'Invoice Total', 'Amount Paid', 'Payment Method', 'Status']]
    for (const inv of filteredInvoices) {
      rows.push([
        new Date(inv.created_at).toLocaleDateString('en-US'),
        inv.customer_name || '',
        (inv.total || 0).toFixed(2),
        (inv.amount_paid || 0).toFixed(2),
        inv.payment_method || '',
        inv.status || ''
      ])
    }
    const pLabel = period === 'ytd' ? 'YTD' : period === '7d' ? '7days' : period === '30d' ? '30days' : '90days'
    exportCsv(rows, `alpha_tax_report_${pLabel}_${new Date().toISOString().slice(0,10)}.csv`)
  }

  if (loading) return <div className="p-8 text-center text-text-muted animate-pulse">Loading reports...</div>

  return (
    <div className="p-4 sm:p-6 lg:p-8 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-bold">Reports & Analytics</h1>
        <div className="flex gap-1 bg-bg-card border border-border rounded-lg p-1">
          {(['7d','30d','90d','ytd'] as Period[]).map(p => (
            <button key={p} className={`px-3 py-1 text-sm rounded transition-colors ${period === p ? 'bg-blue text-white' : 'text-text-muted hover:text-text-primary'}`} onClick={() => setPeriod(p)}>
              {p === 'ytd' ? 'YTD' : p === '7d' ? '7 Days' : p === '30d' ? '30 Days' : '90 Days'}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="card p-4"><div className="text-xs text-text-muted mb-1">Total Revenue</div><div className="text-2xl font-extrabold text-green">{fmtCur(totalRevenue)}</div><div className="text-xs text-text-muted mt-1">{filteredInvoices.length} invoices</div></div>
        <div className="card p-4"><div className="text-xs text-text-muted mb-1">Avg Ticket</div><div className="text-2xl font-extrabold">{fmtCur(avgTicket)}</div><div className="text-xs text-text-muted mt-1">per invoice</div></div>
        <div className="card p-4"><div className="text-xs text-text-muted mb-1">Jobs Completed</div><div className="text-2xl font-extrabold text-blue">{completedJobs}</div><div className="text-xs text-text-muted mt-1">of {filteredJobs.length} total</div></div>
        <div className="card p-4"><div className="text-xs text-text-muted mb-1">Inbound Calls</div><div className="text-2xl font-extrabold">{inboundCalls}</div><div className="text-xs text-text-muted mt-1">avg {Math.round(avgCallDuration)}s</div></div>
      </div>

      <div className="flex gap-1 mb-5 bg-bg-card border border-border rounded-lg p-1 w-fit overflow-x-auto">
        {(['overview','revenue','jobs','calls','tax'] as const).map(t => (
          <button key={t} className={`px-4 py-1.5 rounded text-sm font-medium capitalize transition-colors whitespace-nowrap ${tab === t ? 'bg-blue text-white' : 'text-text-muted hover:text-text-primary'}`} onClick={() => setTab(t)}>
            {t === 'overview' ? 'Overview' : t === 'revenue' ? 'Revenue' : t === 'jobs' ? 'Jobs' : t === 'calls' ? 'Calls' : 'Tax Export'}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="card p-5">
            <h3 className="font-bold mb-4">Monthly Revenue</h3>
            <div className="flex items-end gap-2 h-40">
              {monthlyData.map(m => (
                <div key={m.label} className="flex-1 flex flex-col items-center gap-1">
                  <div className="text-xs text-text-muted font-semibold">{m.value > 0 ? fmtCur(m.value) : ''}</div>
                  <div className="w-full bg-blue/70 hover:bg-blue transition-colors rounded-t" style={{ height: `${Math.max(4, (m.value / maxMonthly) * 120)}px` }} title={`${m.label}: ${fmtCur(m.value)}`} />
                  <div className="text-xs text-text-muted">{m.label}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card p-5">
            <h3 className="font-bold mb-4">Payment Methods</h3>
            {Object.keys(payMethods).length === 0 ? (
              <div className="text-text-muted text-sm">No data for this period</div>
            ) : (
              <div className="space-y-3">
                {Object.entries(payMethods).sort((a, b) => b[1] - a[1]).map(([method, amount]) => (
                  <div key={method}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="capitalize">{method}</span>
                      <span className="font-semibold">{fmtCur(amount)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-bg-hover overflow-hidden">
                      <div className="h-full bg-blue rounded-full" style={{ width: `${totalRevenue > 0 ? (amount / totalRevenue) * 100 : 0}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card p-5">
            <h3 className="font-bold mb-4">Top Services</h3>
            {topServices.length === 0 ? <div className="text-text-muted text-sm">No data for this period</div> : (
              <div className="space-y-2">
                {topServices.map(([svc, count], i) => (
                  <div key={svc} className="flex items-center gap-3">
                    <div className="w-5 text-center text-xs text-text-muted font-bold">{i + 1}</div>
                    <div className="flex-1 text-sm capitalize">{svc}</div>
                    <span className="tag tag-blue">{count}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card p-5">
            <h3 className="font-bold mb-4">Tech Performance</h3>
            {techList.length === 0 ? <div className="text-text-muted text-sm">No data for this period</div> : (
              <table className="w-full text-sm">
                <thead><tr className="text-xs text-text-muted border-b border-border"><th className="text-left pb-2">Technician</th><th className="text-right pb-2">Jobs</th></tr></thead>
                <tbody>
                  {techList.map(t => (
                    <tr key={t.name} className="border-b border-border last:border-0">
                      <td className="py-2 font-medium">{t.name}</td>
                      <td className="py-2 text-right">{t.jobs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'revenue' && (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead><tr><th>Date</th><th>Customer</th><th>Total</th><th>Paid</th><th>Method</th><th>Status</th></tr></thead>
            <tbody>
              {filteredInvoices.slice(0, 100).map(inv => (
                <tr key={inv.id}>
                  <td className="text-sm text-text-muted">{new Date(inv.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                  <td className="font-medium">{inv.customer_name}</td>
                  <td className="font-semibold">{fmtCur(inv.total || 0)}</td>
                  <td className={`font-semibold ${(inv.amount_paid || 0) >= (inv.total || 0) ? 'text-green' : 'text-amber'}`}>{fmtCur(inv.amount_paid || 0)}</td>
                  <td className="text-sm text-text-muted capitalize">{inv.payment_method || '-'}</td>
                  <td><span className={`tag ${inv.status === 'Paid' ? 'tag-green' : inv.status === 'Partial' ? 'tag-amber' : 'tag-gray'}`}>{inv.status}</span></td>
                </tr>
              ))}
              {filteredInvoices.length === 0 && <tr><td colSpan={6} className="text-center py-8 text-text-muted">No invoices in this period</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'jobs' && (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead><tr><th>Date</th><th>Concern</th><th>Technician</th><th>Status</th></tr></thead>
            <tbody>
              {filteredJobs.slice(0, 100).map(j => (
                <tr key={j.id}>
                  <td className="text-sm text-text-muted">{new Date(j.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                  <td className="text-sm">{j.concern || '-'}</td>
                  <td className="text-sm text-text-muted">{j.tech || 'Unassigned'}</td>
                  <td><span className={`tag ${['Completed','Paid','Closed'].includes(j.status) ? 'tag-green' : j.status === 'In Progress' ? 'tag-amber' : 'tag-gray'}`}>{j.status}</span></td>
                </tr>
              ))}
              {filteredJobs.length === 0 && <tr><td colSpan={4} className="text-center py-8 text-text-muted">No jobs in this period</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'calls' && (
        <div className="space-y-5">
          <div className="grid grid-cols-3 gap-3 mb-2">
            <div className="card p-4 text-center"><div className="text-xl font-bold text-blue">{filteredCalls.filter(c => c.direction === 'inbound').length}</div><div className="text-xs text-text-muted">Inbound</div></div>
            <div className="card p-4 text-center"><div className="text-xl font-bold">{filteredCalls.filter(c => c.direction === 'outbound').length}</div><div className="text-xs text-text-muted">Outbound</div></div>
            <div className="card p-4 text-center"><div className="text-xl font-bold text-amber">{filteredCalls.filter(c => (c.duration_secs || 0) < 15).length}</div><div className="text-xs text-text-muted">Missed / Short</div></div>
          </div>
          <div className="card overflow-hidden">
            <table className="data-table">
              <thead><tr><th>Date</th><th>Direction</th><th>Duration</th><th>Status</th></tr></thead>
              <tbody>
                {filteredCalls.slice(0, 100).map(c => (
                  <tr key={c.id}>
                    <td className="text-sm text-text-muted">{new Date(c.start_time).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                    <td><span className={`tag ${c.direction === 'inbound' ? 'tag-blue' : 'tag-gray'}`}>{c.direction}</span></td>
                    <td className="text-sm">{c.duration_secs ? `${Math.round(c.duration_secs)}s` : '-'}</td>
                    <td className="text-sm text-text-muted capitalize">{c.status || '-'}</td>
                  </tr>
                ))}
                {filteredCalls.length === 0 && <tr><td colSpan={4} className="text-center py-8 text-text-muted">No calls in this period</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'tax' && (
        <div className="space-y-5">
          <div className="card p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold">Tax & Revenue Export</h2>
              <p className="text-sm text-text-muted mt-0.5">{filteredInvoices.length} invoices · {fmtCur(totalRevenue)} collected in selected period</p>
            </div>
            <button className="btn btn-primary" onClick={exportTaxCsv}>
              Download CSV
            </button>
          </div>

          <div className="card p-5">
            <h3 className="font-bold mb-4">Quarterly Summary (All Time)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-text-muted border-b border-border">
                    <th className="text-left pb-2 pr-4">Quarter</th>
                    <th className="text-right pb-2 pr-4">Invoices</th>
                    <th className="text-right pb-2 pr-4">Total Revenue</th>
                    <th className="text-right pb-2">Avg Ticket</th>
                  </tr>
                </thead>
                <tbody>
                  {quarterList.map(([quarter, data]) => (
                    <tr key={quarter} className="border-b border-border last:border-0">
                      <td className="py-2.5 pr-4 font-semibold">{quarter}</td>
                      <td className="py-2.5 pr-4 text-right text-text-muted">{data.count}</td>
                      <td className="py-2.5 pr-4 text-right font-bold text-green">{fmtCur(data.revenue)}</td>
                      <td className="py-2.5 text-right text-text-muted">{data.count > 0 ? fmtCur(data.revenue / data.count) : '-'}</td>
                    </tr>
                  ))}
                  {quarterList.length === 0 && (
                    <tr><td colSpan={4} className="text-center py-8 text-text-muted">No invoice data available</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <h3 className="font-bold">Invoice Detail - Selected Period</h3>
              <span className="text-sm text-text-muted">{filteredInvoices.length} records</span>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date</th><th>Customer</th><th>Invoice Total</th><th>Amount Paid</th><th>Payment Method</th><th>Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map(inv => (
                  <tr key={inv.id}>
                    <td className="text-sm text-text-muted whitespace-nowrap">
                      {new Date(inv.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    </td>
                    <td className="font-medium">{inv.customer_name || '-'}</td>
                    <td className="font-semibold">{fmtCur(inv.total || 0)}</td>
                    <td className={`font-semibold ${(inv.amount_paid || 0) >= (inv.total || 0) ? 'text-green' : 'text-amber'}`}>
                      {fmtCur(inv.amount_paid || 0)}
                    </td>
                    <td className="text-sm text-text-muted capitalize">{inv.payment_method || '-'}</td>
                    <td>
                      <span className={`tag ${inv.status === 'Paid' ? 'tag-green' : inv.status === 'Partial' ? 'tag-amber' : 'tag-gray'}`}>
                        {inv.status}
                      </span>
                    </td>
                  </tr>
                ))}
                {filteredInvoices.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-8 text-text-muted">No invoices in this period</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
