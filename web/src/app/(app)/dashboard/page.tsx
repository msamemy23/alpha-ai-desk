'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase, calcTotals, formatCurrency } from '@/lib/supabase'

interface Stats {
  openJobs: number
  unpaidTotal: number
  customersCount: number
  monthRevenue: number
  recentJobs: Record<string, unknown>[]
  recentMessages: Record<string, unknown>[]
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const [{ data: jobs }, { data: docs }, { data: customers }, { data: messages }] = await Promise.all([
      supabase.from('jobs').select('*').order('created_at', { ascending: false }),
      supabase.from('documents').select('*').order('created_at', { ascending: false }),
      supabase.from('customers').select('id'),
      supabase.from('messages').select('*').order('created_at', { ascending: false }).limit(5),
    ])

    const openJobs = (jobs || []).filter((j: Record<string,unknown>) => !['Paid','Closed'].includes(j.status as string)).length
    const unpaidDocs = (docs || []).filter((d: Record<string,unknown>) => ['Unpaid','Partial','Draft'].includes(d.status as string))
    const unpaidTotal = unpaidDocs.reduce((s: number, d: Record<string,unknown>) => s + calcTotals(d).balanceDue, 0)
    const now = new Date(); const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const monthDocs = (docs || []).filter((d: Record<string,unknown>) => d.type === 'Receipt' && (d.created_at as string) >= monthStart)
    const monthRevenue = monthDocs.reduce((s: number, d: Record<string,unknown>) => s + calcTotals(d).total, 0)

    setStats({
      openJobs,
      unpaidTotal,
      customersCount: (customers || []).length,
      monthRevenue,
      recentJobs: (jobs || []).slice(0, 6) as Record<string,unknown>[],
      recentMessages: (messages || []) as Record<string,unknown>[],
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const channel = supabase.channel('dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, load)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, load)
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  if (loading) return <div className="p-8 text-text-muted">Loading…</div>

  const STATUS_COLOR: Record<string,string> = {
    'New': 'bg-blue', 'In Progress': 'bg-amber', 'Completed': 'bg-green',
    'Ready for Pickup': 'bg-green', 'Waiting on Parts': 'bg-amber', 'Paid': 'bg-bg-hover', 'Closed': 'bg-bg-hover'
  }

  return (
    <div className="p-8 space-y-8 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-text-muted text-sm mt-1">Alpha International Auto Center</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: 'Open Jobs', value: stats!.openJobs, color: 'text-blue', icon: '🔧' },
          { label: 'Unpaid Balance', value: formatCurrency(stats!.unpaidTotal), color: 'text-red', icon: '💰' },
          { label: 'Total Customers', value: stats!.customersCount, color: 'text-green', icon: '👤' },
          { label: 'Month Revenue', value: formatCurrency(stats!.monthRevenue), color: 'text-amber', icon: '📈' },
        ].map(s => (
          <div key={s.label} className="card">
            <div className="text-2xl mb-2">{s.icon}</div>
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-text-muted mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Jobs */}
        <div className="card">
          <h2 className="text-sm font-bold uppercase tracking-wider text-text-secondary mb-4">Recent Jobs</h2>
          <div className="space-y-3">
            {stats!.recentJobs.length === 0 && <p className="text-text-muted text-sm">No jobs yet</p>}
            {stats!.recentJobs.map((j: Record<string,unknown>) => (
              <div key={j.id as string} className="flex items-center gap-3">
                <span className={`w-2 h-2 rounded-full ${STATUS_COLOR[j.status as string] || 'bg-bg-hover'}`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{j.customer_name as string || 'Unknown'}</div>
                  <div className="text-xs text-text-muted truncate">{j.concern as string}</div>
                </div>
                <span className="tag tag-gray text-xs shrink-0">{j.status as string}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Recent Messages */}
        <div className="card">
          <h2 className="text-sm font-bold uppercase tracking-wider text-text-secondary mb-4">Recent Messages</h2>
          <div className="space-y-3">
            {stats!.recentMessages.length === 0 && <p className="text-text-muted text-sm">No messages yet</p>}
            {stats!.recentMessages.map((m: Record<string,unknown>) => (
              <div key={m.id as string} className={`flex items-start gap-3 p-3 rounded-lg ${!m.read && m.direction === 'inbound' ? 'bg-blue/5 border border-blue/20' : 'bg-bg-hover'}`}>
                <span className="text-lg">{m.channel === 'sms' ? '💬' : '📧'}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-text-secondary">{m.direction === 'inbound' ? m.from_address as string : `To: ${m.to_address as string}`}</div>
                  <div className="text-sm truncate mt-0.5">{m.body as string}</div>
                </div>
                {!m.read && m.direction === 'inbound' && (
                  <span className="w-2 h-2 rounded-full bg-blue mt-1.5 shrink-0" />
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
