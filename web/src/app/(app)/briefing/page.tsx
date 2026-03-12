'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase, calcTotals, formatCurrency } from '@/lib/supabase'

export default function BriefingPage() {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<{
    openJobs: Record<string,unknown>[]
    staleJobs: Record<string,unknown>[]
    overdueInvoices: Record<string,unknown>[]
    todayAppointments: Record<string,unknown>[]
    unreadMessages: number
    weekRevenue: number
    monthRevenue: number
    partsWaiting: Record<string,unknown>[]
  } | null>(null)

  const load = useCallback(async () => {
    const [{ data: jobs }, { data: docs }, { count: unread }] = await Promise.all([
      supabase.from('jobs').select('*').order('created_at', { ascending: false }),
      supabase.from('documents').select('*').order('created_at', { ascending: false }),
      supabase.from('messages').select('*', { count: 'exact', head: true }).eq('read', false).eq('direction', 'inbound'),
    ])

    const now = new Date()
    const threeDaysAgo = new Date(now.getTime() - 3 * 86400000).toISOString()
    const weekAgo = new Date(now.getTime() - 7 * 86400000).toISOString()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

    const openJobs = (jobs || []).filter((j: Record<string,unknown>) => !['Paid','Closed'].includes(j.status as string))
    const staleJobs = openJobs.filter((j: Record<string,unknown>) =>
      !['Completed','Ready for Pickup'].includes(j.status as string) &&
      ((j.updated_at as string) || (j.created_at as string)) < threeDaysAgo
    )
    const partsWaiting = (jobs || []).filter((j: Record<string,unknown>) => j.status === 'Waiting on Parts')
    const overdueInvoices = (docs || []).filter((d: Record<string,unknown>) =>
      d.type === 'Invoice' && ['Unpaid','Partial'].includes(d.status as string)
    )

    const weekReceipts = (docs || []).filter((d: Record<string,unknown>) => d.type === 'Receipt' && (d.created_at as string) >= weekAgo)
    const monthReceipts = (docs || []).filter((d: Record<string,unknown>) => d.type === 'Receipt' && (d.created_at as string) >= monthStart)

    setData({
      openJobs,
      staleJobs,
      overdueInvoices,
      todayAppointments: openJobs.slice(0, 5),
      unreadMessages: unread || 0,
      weekRevenue: weekReceipts.reduce((s: number, d: Record<string,unknown>) => s + calcTotals(d).total, 0),
      monthRevenue: monthReceipts.reduce((s: number, d: Record<string,unknown>) => s + calcTotals(d).total, 0),
      partsWaiting,
    })
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="p-8 text-text-muted">Loading briefing…</div>
  if (!data) return null

  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  return (
    <div className="p-8 animate-fade-in max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold">Daily Briefing</h1>
        <p className="text-text-muted text-sm mt-1">{today}</p>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="card text-center">
          <div className="text-2xl font-bold text-blue">{data.openJobs.length}</div>
          <div className="text-xs text-text-muted mt-1">Open Jobs</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold text-amber">{data.staleJobs.length}</div>
          <div className="text-xs text-text-muted mt-1">Stale Jobs</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold text-red">{data.overdueInvoices.length}</div>
          <div className="text-xs text-text-muted mt-1">Overdue Invoices</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold text-green">{data.unreadMessages}</div>
          <div className="text-xs text-text-muted mt-1">Unread Messages</div>
        </div>
      </div>

      {/* Revenue */}
      <div className="grid grid-cols-2 gap-4 mb-8">
        <div className="card">
          <div className="text-xs text-text-muted uppercase tracking-wider mb-1">This Week</div>
          <div className="text-xl font-bold text-green">{formatCurrency(data.weekRevenue)}</div>
        </div>
        <div className="card">
          <div className="text-xs text-text-muted uppercase tracking-wider mb-1">This Month</div>
          <div className="text-xl font-bold text-green">{formatCurrency(data.monthRevenue)}</div>
        </div>
      </div>

      {/* Stale jobs */}
      {data.staleJobs.length > 0 && (
        <div className="card mb-6 border-amber/30">
          <h2 className="text-sm font-bold uppercase tracking-wider text-amber mb-3">Stale Jobs — Need Attention</h2>
          <div className="space-y-2">
            {data.staleJobs.map(j => (
              <div key={j.id as string} className="flex items-center justify-between p-2 bg-bg-hover rounded-lg">
                <div>
                  <div className="text-sm font-medium">{j.customer_name as string || 'Unknown'}</div>
                  <div className="text-xs text-text-muted">{j.concern as string || 'No details'}</div>
                </div>
                <span className="tag tag-amber text-xs">{j.status as string}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Overdue invoices */}
      {data.overdueInvoices.length > 0 && (
        <div className="card mb-6 border-red/30">
          <h2 className="text-sm font-bold uppercase tracking-wider text-red mb-3">Overdue Invoices</h2>
          <div className="space-y-2">
            {data.overdueInvoices.map(d => (
              <div key={d.id as string} className="flex items-center justify-between p-2 bg-bg-hover rounded-lg">
                <div>
                  <div className="text-sm font-medium">{d.doc_number as string} — {d.customer_name as string || 'Unknown'}</div>
                </div>
                <span className="text-sm font-semibold text-red">{formatCurrency(calcTotals(d).balanceDue)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Parts waiting */}
      {data.partsWaiting.length > 0 && (
        <div className="card mb-6">
          <h2 className="text-sm font-bold uppercase tracking-wider text-text-secondary mb-3">Waiting on Parts</h2>
          <div className="space-y-2">
            {data.partsWaiting.map(j => (
              <div key={j.id as string} className="flex items-center justify-between p-2 bg-bg-hover rounded-lg">
                <div className="text-sm font-medium">{j.customer_name as string || 'Unknown'}</div>
                <div className="text-xs text-text-muted">{[j.vehicle_year, j.vehicle_make, j.vehicle_model].filter(Boolean).join(' ')}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Today's work */}
      <div className="card">
        <h2 className="text-sm font-bold uppercase tracking-wider text-text-secondary mb-3">Today&apos;s Active Jobs</h2>
        {data.openJobs.length === 0 ? (
          <p className="text-sm text-text-muted">No open jobs — slow day!</p>
        ) : (
          <div className="space-y-2">
            {data.openJobs.slice(0, 10).map(j => (
              <div key={j.id as string} className="flex items-center justify-between p-2 bg-bg-hover rounded-lg">
                <div>
                  <div className="text-sm font-medium">{j.customer_name as string || 'Unknown'}</div>
                  <div className="text-xs text-text-muted">{[j.vehicle_year, j.vehicle_make, j.vehicle_model].filter(Boolean).join(' ')}</div>
                </div>
                <span className="tag tag-blue text-xs">{j.status as string}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
