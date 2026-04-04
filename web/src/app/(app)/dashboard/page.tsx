'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { supabase, calcTotals, formatCurrency, getShopProfile, getShopId } from '@/lib/supabase'

interface ShopProfile {
  shop_name: string
  phone: string
  address: string
  city_state_zip: string
}

interface Stats {
  openJobs: number
  unpaidTotal: number
  customersCount: number
  monthRevenue: number
  recentJobs: Record<string, unknown>[]
  recentMessages: Record<string, unknown>[]
  allJobs: Record<string, unknown>[]
  allDocs: Record<string, unknown>[]
  staleJobs: Record<string, unknown>[]
  overdueInvoices: Record<string, unknown>[]
  recentCalls: Record<string, unknown>[]
}

export default function DashboardPage() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [briefingDismissed, setBriefingDismissed] = useState(false)
  const [briefingExpanded, setBriefingExpanded] = useState(true)
  const [aiInsight, setAiInsight] = useState('')
  const [insightLoading, setInsightLoading] = useState(false)
  const [slowDayMsg, setSlowDayMsg] = useState('')
  const [slowDaySending, setSlowDaySending] = useState(false)
  const [slowDayResult, setSlowDayResult] = useState<{sent:number;total:number}|null>(null)
  const [aiAlerts, setAiAlerts] = useState<{id:string;title:string;body:string;priority?:string}[]>([])
  const [shopProfile, setShopProfile] = useState<ShopProfile | null>(null)
  const [profileLoaded, setProfileLoaded] = useState(false)


  useEffect(() => {
    fetch('/api/seed-settings', { method: 'POST' }).catch(() => {})
    const today = new Date().toISOString().split('T')[0]
    const dismissed = localStorage.getItem('briefing_dismissed')
    if (dismissed === today) setBriefingDismissed(true)
    fetch('/api/notifications').then(r => r.json()).then(d => {
      if (d.notifications) setAiAlerts(d.notifications.slice(0, 3))
    }).catch(() => {})
    getShopProfile().then(p => {
      setShopProfile(p)
      setProfileLoaded(true)
    }).catch(() => setProfileLoaded(true))
  }, [])

  const load = useCallback(async () => {
    const shopId = await getShopId()

    const [{ data: jobs }, { data: docs }, { data: customers }, { data: messages }, { data: calls }] = await Promise.all([
      supabase.from('jobs').select('*').eq('shop_id', shopId ?? '').order('created_at', { ascending: false }),
      supabase.from('documents').select('*').eq('shop_id', shopId ?? '').order('created_at', { ascending: false }),
      supabase.from('customers').select('id').eq('shop_id', shopId ?? ''),
      supabase.from('messages').select('*').eq('shop_id', shopId ?? '').order('created_at', { ascending: false }).limit(5),
      supabase.from('ai_calls').select('*').eq('shop_id', shopId ?? '').order('started_at', { ascending: false }).limit(5),
    ])

    const openJobs = (jobs || []).filter((j: Record<string,unknown>) => !['Paid','Closed'].includes(j.status as string)).length
    const unpaidDocs = (docs || []).filter((d: Record<string,unknown>) => ['Unpaid','Partial','Draft'].includes(d.status as string))
    const unpaidTotal = unpaidDocs.reduce((s: number, d: Record<string,unknown>) => s + calcTotals(d).balanceDue, 0)
    const now = new Date(); const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    const monthDocs = (docs || []).filter((d: Record<string,unknown>) => (d.type === 'Receipt' || d.type === 'Invoice') && d.status === 'Paid' && (d.created_at as string) >= monthStart)
    const monthRevenue = monthDocs.reduce((s: number, d: Record<string,unknown>) => s + calcTotals(d).total, 0)

    const chartDays: { label: string; revenue: number }[] = []
    for (let i = 6; i >= 0; i--) {
      const day = new Date(); day.setDate(day.getDate() - i); day.setHours(0,0,0,0)
      const next = new Date(day); next.setDate(next.getDate() + 1)
      const dayRevenue = (docs || []).filter((d: Record<string,unknown>) =>
        (d.type === 'Receipt' || d.type === 'Invoice') && d.status === 'Paid' &&
        (d.created_at as string) >= day.toISOString() && (d.created_at as string) < next.toISOString()
      ).reduce((s: number, d: Record<string,unknown>) => s + calcTotals(d).total, 0)
      chartDays.push({ label: day.toLocaleDateString('en-US',{weekday:'short'}), revenue: dayRevenue })
    }

    const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString()
    const staleJobs = (jobs || []).filter((j: Record<string,unknown>) =>
      !['Paid','Closed','Completed','Ready for Pickup'].includes(j.status as string) &&
      (j.updated_at as string || j.created_at as string) < threeDaysAgo
    ) as Record<string,unknown>[]

    const overdueInvoices = (docs || []).filter((d: Record<string,unknown>) =>
      d.type === 'Invoice' && ['Unpaid','Partial'].includes(d.status as string)
    ) as Record<string,unknown>[]

    setStats({
      openJobs,
      unpaidTotal,
      customersCount: (customers || []).length,
      monthRevenue,
      recentJobs: (jobs || []).filter((j: Record<string,unknown>) => !['Paid','Closed'].includes(j.status as string)).slice(0, 8) as Record<string,unknown>[],
      recentMessages: (messages || []) as Record<string,unknown>[],
      allJobs: (jobs || []) as Record<string,unknown>[],
      allDocs: (docs || []) as Record<string,unknown>[],
      staleJobs,
      overdueInvoices,
      chartDays,
      recentCalls: (calls || []) as Record<string,unknown>[],
    })
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    const channel = supabase.channel('dashboard')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_calls' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const dismissBriefing = () => {
    setBriefingDismissed(true)
    localStorage.setItem('briefing_dismissed', new Date().toISOString().split('T')[0])
  }

  const generateInsight = async () => {
    if (!stats) return
    setInsightLoading(true)
    try {
      const { data: settings } = await supabase.from('settings').select('ai_api_key,ai_model,ai_base_url').limit(1).single()
      const apiKey = (settings?.ai_api_key as string) || process.env.NEXT_PUBLIC_OPENROUTER_API_KEY || ''
      const model = (settings?.ai_model as string) || 'meta-llama/llama-3.3-70b-instruct:free'
      const baseUrl = (settings?.ai_base_url as string) || 'https://openrouter.ai/api/v1'
      if (!apiKey) { setAiInsight('Configure your AI API key in Settings to use AI insights.'); return }

      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString()
      const recentJobs = stats.allJobs.filter(j => (j.created_at as string) >= thirtyDaysAgo)
      const recentDocs = stats.allDocs.filter(d => (d.created_at as string) >= thirtyDaysAgo)

      const statusCounts: Record<string,number> = {}
      recentJobs.forEach(j => { statusCounts[j.status as string] = (statusCounts[j.status as string] || 0) + 1 })

      const revenue = recentDocs.filter(d => d.type === 'Receipt').reduce((s, d) => s + calcTotals(d).total, 0)
      const avgJobValue = recentDocs.length > 0 ? revenue / Math.max(recentDocs.filter(d => d.type === 'Receipt').length, 1) : 0

      const summary = `Last 30 days: ${recentJobs.length} jobs, ${formatCurrency(revenue)} revenue, avg ticket ${formatCurrency(avgJobValue)}. Status breakdown: ${Object.entries(statusCounts).map(([k,v]) => `${k}:${v}`).join(', ')}. ${stats.staleJobs.length} stale jobs, ${stats.overdueInvoices.length} overdue invoices, ${stats.customersCount} total customers.`

      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: 'You are a business analyst for an auto repair shop. Give 2-3 brief, actionable insights based on the data. Keep it under 150 words. Be specific with numbers.' },
            { role: 'user', content: summary }
          ],
          max_tokens: 300,
        })
      })
      const data = await res.json()
      setAiInsight(data.choices?.[0]?.message?.content || 'Unable to generate insight.')
    } catch { setAiInsight('Failed to generate insight. Check your AI settings.') }
    finally { setInsightLoading(false) }
  }

  const sendSlowDayOutreach = async () => {
    setSlowDaySending(true); setSlowDayResult(null)
    try {
      const res = await fetch('/api/outreach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'follow_up_cold',
          filter: { daysSinceLastVisit: 60 },
          template: slowDayMsg || undefined,
          channel: 'sms',
        })
      })
      const data = await res.json()
      setSlowDayResult({ sent: data.sent || 0, total: data.total || 0 })
    } catch { setSlowDayResult({ sent: 0, total: 0 }) }
    finally { setSlowDaySending(false) }
  }

  if (loading) return <div className="p-8 text-text-muted">Loading…</div>

  const STATUS_COLOR: Record<string,string> = {
    'New': 'bg-blue', 'In Progress': 'bg-amber', 'Completed': 'bg-green',
    'Ready for Pickup': 'bg-green', 'Waiting on Parts': 'bg-amber', 'Paid': 'bg-bg-hover', 'Closed': 'bg-bg-hover'
  }

  const CALL_STATUS_COLOR: Record<string,string> = {
    'ringing': 'text-amber',
    'active':  'text-green',
    'ended':   'text-text-muted',
  }

  const techMap: Record<string, { jobs: number; hours: number; revenue: number }> = {}
  stats!.allJobs.forEach(j => {
    const labors = (j.labors as Record<string,unknown>[]) || []
    labors.forEach(l => {
      const tech = (l.tech as string) || ''
      if (!tech) return
      if (!techMap[tech]) techMap[tech] = { jobs: 0, hours: 0, revenue: 0 }
      techMap[tech].jobs++
      techMap[tech].hours += Number(l.hours) || 0
      techMap[tech].revenue += (Number(l.hours) || 0) * (Number(l.rate) || 0)
    })
  })
  const techs = Object.entries(techMap).sort((a, b) => b[1].revenue - a[1].revenue)

  const isSlowDay = stats!.openJobs < 3
  const shopName = shopProfile?.shop_name || 'Alpha International Auto Center'
  const hasProfile = profileLoaded && shopProfile && shopProfile.shop_name

  // Helper: extract caller number from task string or caller field
  const getCallerDisplay = (call: Record<string,unknown>) => {
    if (call.caller) return call.caller as string
    const task = (call.task as string) || ''
    const match = task.match(/Inbound call from ([^\s.]+)/)
    return match ? match[1] : 'Unknown'
  }

  const formatCallTime = (call: Record<string,unknown>) => {
    const ts = call.started_at as number
    if (!ts) return ''
    const d = new Date(ts)
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true })
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 lg:space-y-8 animate-fade-in">
      <div>
        <h1 className="text-xl sm:text-2xl font-bold">Dashboard</h1>
        <p className="text-text-muted text-sm mt-1">{shopName}</p>
      </div>

      {/* Onboarding banner — show if profile is missing */}
      {profileLoaded && !hasProfile && (
        <div className="card border-amber/40 bg-amber/5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-xl">🚀</span>
            <div>
              <p className="text-sm font-semibold">Finish setting up your shop</p>
              <p className="text-xs text-text-muted">Add your shop name, phone, and services to get started.</p>
            </div>
          </div>
          <Link href="/onboarding" className="btn btn-primary btn-sm shrink-0">Complete Setup</Link>
        </div>
      )}

      {/* Feature 2: Morning Briefing */}
      {!briefingDismissed && (
        <div className="card border-blue/30 bg-blue/5">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <span className="text-xl">☀️</span>
              <h2 className="text-sm font-bold uppercase tracking-wider text-blue">{(() => { const h = new Date().getHours(); return h < 5 ? 'Good Night' : h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : h < 21 ? 'Good Evening' : 'Good Night' })()} — Daily Briefing</h2>
            </div>
            <div className="flex gap-2">
              <button className="btn btn-secondary btn-sm" onClick={() => setBriefingExpanded(!briefingExpanded)}>
                {briefingExpanded ? 'Collapse' : 'Expand'}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={dismissBriefing}>Dismiss</button>
            </div>
          </div>
          {briefingExpanded && (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-4">
              <div className="bg-bg-card border border-border rounded-lg p-3">
                <div className="text-xs text-text-muted">Open Jobs</div>
                <div className="text-lg font-bold text-blue">{stats!.openJobs}</div>
              </div>
              <div className="bg-bg-card border border-border rounded-lg p-3">
                <div className="text-xs text-text-muted">Stale Jobs (&gt;3 days)</div>
                <div className="text-lg font-bold text-amber">{stats!.staleJobs.length}</div>
                {stats!.staleJobs.length > 0 && (
                  <div className="text-xs text-text-muted mt-1 truncate">{(stats!.staleJobs[0].customer_name as string) || 'Unknown'}{stats!.staleJobs.length > 1 ? ` +${stats!.staleJobs.length - 1} more` : ''}</div>
                )}
              </div>
              <div className="bg-bg-card border border-border rounded-lg p-3">
                <div className="text-xs text-text-muted">Overdue Invoices</div>
                <div className="text-lg font-bold text-red">{stats!.overdueInvoices.length}</div>
                <div className="text-xs text-text-muted mt-1">{formatCurrency(stats!.overdueInvoices.reduce((s, d) => s + calcTotals(d).balanceDue, 0))} outstanding</div>
              </div>
              <div className="bg-bg-card border border-border rounded-lg p-3">
                <div className="text-xs text-text-muted">Unread Messages</div>
                <div className="text-lg font-bold text-green">{stats!.recentMessages.filter(m => !m.read && m.direction === 'inbound').length}</div>
              </div>
            </div>
          )}
        </div>
      )}

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
            <div className={`text-lg sm:text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-text-muted mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* AI Alert Card */}
      {aiAlerts.length > 0 && (
        <div className="card border-amber/30 bg-amber/5">
          <h2 className="text-sm font-bold uppercase tracking-wider text-amber mb-3">🤖 AI Alerts</h2>
          <div className="space-y-3">
            {aiAlerts.map(alert => (
              <div key={alert.id} className="flex items-start justify-between gap-3 bg-bg-card border border-border rounded-lg p-3">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{alert.title}</p>
                  <p className="text-xs text-text-muted mt-0.5 truncate">{alert.body}</p>
                </div>
                <button
                  className="btn btn-primary btn-sm shrink-0"
                  onClick={() => {
                    localStorage.setItem('ai_prefill', alert.body)
                    window.location.href = '/ai'
                  }}
                >
                  Ask AI
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Feature 11: AI Insights + Feature 19: Slow Day Outreach */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between mb-4 gap-2">
            <h2 className="text-sm font-bold uppercase tracking-wider text-text-secondary">🧠 AI Business Insights</h2>
            <button className="btn btn-primary btn-sm" onClick={generateInsight} disabled={insightLoading}>
              {insightLoading ? 'Analyzing…' : 'Generate Insight'}
            </button>
          </div>
          {aiInsight ? (
            <div className="text-sm text-text-primary whitespace-pre-wrap leading-relaxed">{aiInsight}</div>
          ) : (
            <p className="text-sm text-text-muted">Click &quot;Generate Insight&quot; to get AI-powered analysis of your shop&apos;s last 30 days.</p>
          )}
        </div>

        {isSlowDay && (
          <div className="card border-amber/30 bg-amber/5">
            <h2 className="text-sm font-bold uppercase tracking-wider text-amber mb-3">📣 Slow Day — Send Outreach?</h2>
            <p className="text-sm text-text-muted mb-3">Only {stats!.openJobs} open jobs today. Reach out to customers who haven&apos;t visited in 60+ days.</p>
            <textarea
              className="form-textarea mb-3"
              rows={2}
              placeholder="Custom message (optional)..."
              value={slowDayMsg}
              onChange={e => setSlowDayMsg(e.target.value)}
            />
            <button className="btn btn-primary w-full" onClick={sendSlowDayOutreach} disabled={slowDaySending}>
              {slowDaySending ? 'Sending…' : '🚀 Send Outreach SMS'}
            </button>
            {slowDayResult && (
              <div className="mt-3 bg-green/10 border border-green/30 rounded-lg p-3 text-sm text-green">
                Sent {slowDayResult.sent} of {slowDayResult.total} eligible customers.
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Jobs */}
        <div className="card">
          <h2 className="text-sm font-bold uppercase tracking-wider text-text-secondary mb-4">Active Jobs</h2>
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

      {/* Live Calls */}
      {stats!.recentCalls.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold uppercase tracking-wider text-text-secondary">📞 Recent Calls</h2>
            <Link href="/voicemail" className="text-xs text-blue hover:underline">View all →</Link>
          </div>
          <div className="space-y-3">
            {stats!.recentCalls.map((call: Record<string,unknown>) => {
              const status = (call.status as string) || 'ended'
              const caller = getCallerDisplay(call)
              const summary = (call.summary as string) || ''
              return (
                <div key={call.id as string} className={`flex items-start gap-3 p-3 rounded-lg border ${status === 'ringing' ? 'bg-amber/5 border-amber/30 animate-pulse' : status === 'active' ? 'bg-green/5 border-green/30' : 'bg-bg-hover border-border'}`}>
                  <span className="text-lg shrink-0">{status === 'ringing' ? '📲' : status === 'active' ? '📞' : '📵'}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold">{caller}</span>
                      <span className={`text-xs font-bold uppercase ${CALL_STATUS_COLOR[status] || 'text-text-muted'}`}>{status}</span>
                    </div>
                    <div className="text-xs text-text-muted mt-0.5">{formatCallTime(call)}</div>
                    {summary && <div className="text-xs text-text-muted mt-1 truncate">{summary}</div>}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Feature 18: Tech Performance Dashboard */}
      {techs.length > 0 && (
        <div className="card">
          <h2 className="text-sm font-bold uppercase tracking-wider text-text-secondary mb-4">👨‍🔧 Technician Performance</h2>
          <div className="overflow-x-auto">
            <table className="data-table w-full">
              <thead>
                <tr><th>Technician</th><th>Jobs</th><th>Hours</th><th>Revenue</th><th>Avg $/Job</th></tr>
              </thead>
              <tbody>
                {techs.map(([name, data]) => (
                  <tr key={name}>
                    <td className="font-medium">{name}</td>
                    <td>{data.jobs}</td>
                    <td>{data.hours.toFixed(1)}</td>
                    <td className="font-semibold text-green">{formatCurrency(data.revenue)}</td>
                    <td>{formatCurrency(data.jobs > 0 ? data.revenue / data.jobs : 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
