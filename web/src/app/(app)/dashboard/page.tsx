'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase, calcTotals, formatCurrency, getShopProfile, getShopId } from '@/lib/supabase'
import { addOpenAIOAuthHeaders } from '@/lib/openai-oauth-client'
import { laborLineTotal } from '@/lib/document-money'
import { summarizeToday, money0, ageLabel, DAY, type FeedItem, type Lamp } from '@/lib/today'
import Icon from '@/components/Icon'
import DailyNotes from '@/components/today/DailyNotes'

type Row = Record<string, unknown>

interface ShopProfile { shop_name: string; phone: string; address: string; city_state_zip: string }

interface Data {
  jobs: Row[]
  docs: Row[]
  customersCount: number
  unreadTexts: (Row & { customer_name?: string })[]
  missedCalls: Row[]
  appointments: Row[]
  aiCalls: Row[]
}

async function getAuthJsonHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (token) headers.Authorization = `Bearer ${token}`
  } catch {
    // Cookie auth can still succeed; the API will return the real error if not.
  }
  return addOpenAIOAuthHeaders(headers)
}

const JOB_LAMP: Record<string, Lamp | 'green'> = {
  'New': 'blue', 'Approved': 'blue', 'In Progress': 'blue',
  'Waiting on Parts': 'amber', 'Waiting on Customer': 'amber',
  'Completed': 'green', 'Ready for Pickup': 'green',
}

const ASK_IDEAS = [
  'Who owes me money right now?',
  'Write a text to customers with old estimates',
  'What should I do first today?',
]

const timeOf = (hhmm: string) => {
  const [h, m] = String(hhmm || '').split(':').map(Number)
  if (!Number.isFinite(h)) return ''
  const d = new Date(); d.setHours(h, m || 0, 0, 0)
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

const dayLabel = (ymd: string) => {
  const d = new Date(ymd + 'T12:00:00')
  const today = new Date(); today.setHours(12, 0, 0, 0)
  const diff = Math.round((d.getTime() - today.getTime()) / DAY)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  return d.toLocaleDateString('en-US', { weekday: 'long' })
}

export default function DashboardPage() {
  const [data, setData] = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [shop, setShop] = useState<ShopProfile | null>(null)
  const [shopLoaded, setShopLoaded] = useState(false)
  const [aiAlerts, setAiAlerts] = useState<{ id: string; title: string; body: string }[]>([])
  const [problems, setProblems] = useState(0)
  const [showAll, setShowAll] = useState(false)
  const [question, setQuestion] = useState('')
  const [insight, setInsight] = useState('')
  const [insightBusy, setInsightBusy] = useState(false)
  const [outreachMsg, setOutreachMsg] = useState('')
  const [outreachBusy, setOutreachBusy] = useState(false)
  const [outreachResult, setOutreachResult] = useState<{ sent: number; total: number } | null>(null)
  const [outreachError, setOutreachError] = useState('')

  useEffect(() => {
    fetch('/api/notifications').then(r => r.json()).then(d => {
      if (Array.isArray(d.notifications)) setAiAlerts(d.notifications.slice(0, 2))
      if (Number.isFinite(d.problems) && d.problems > 0) setProblems(Math.floor(d.problems))
    }).catch(() => {})
    getShopProfile().then(p => { setShop(p); setShopLoaded(true) }).catch(() => setShopLoaded(true))
  }, [])

  const load = useCallback(async () => {
    try {
      const shopId = await getShopId()
      if (!shopId) { setError('We could not find your shop. Refresh, or sign out and back in.'); return }
      const today = new Date().toISOString().slice(0, 10)
      const [jobs, docs, customers, texts, calls, appts, aiCalls] = await Promise.all([
        supabase.from('jobs').select('*').eq('shop_id', shopId).order('created_at', { ascending: false }),
        supabase.from('documents').select('*').eq('shop_id', shopId).order('created_at', { ascending: false }),
        supabase.from('customers').select('id', { count: 'exact', head: true }).eq('shop_id', shopId),
        supabase.from('messages').select('id,body,from_address,customer_id,created_at,read,direction').eq('shop_id', shopId).eq('direction', 'inbound').eq('read', false).order('created_at', { ascending: false }).limit(8),
        supabase.from('call_history').select('id,from_number,start_time,duration_secs,status,direction').eq('shop_id', shopId).eq('direction', 'inbound').lt('duration_secs', 15).gte('start_time', new Date(Date.now() - 3 * DAY).toISOString()).order('start_time', { ascending: false }).limit(8),
        supabase.from('appointments').select('*').eq('shop_id', shopId).gte('date', today).order('date').order('time').limit(12),
        supabase.from('ai_calls').select('*').eq('shop_id', shopId).order('started_at', { ascending: false }).limit(3),
      ])
      if (docs.error) throw docs.error

      // Put names on unread texts where we know the customer.
      const unread = (texts.data || []) as Row[]
      const ids = Array.from(new Set(unread.map(m => m.customer_id).filter(Boolean) as string[]))
      let names: Record<string, string> = {}
      if (ids.length) {
        const { data: named } = await supabase.from('customers').select('id,name').eq('shop_id', shopId).in('id', ids)
        names = Object.fromEntries((named || []).map((c: Row) => [String(c.id), String(c.name || '')]))
      }

      setData({
        jobs: (jobs.data || []) as Row[],
        docs: (docs.data || []) as Row[],
        customersCount: customers.count || 0,
        unreadTexts: unread.map(m => ({ ...m, customer_name: m.customer_id ? names[String(m.customer_id)] : undefined })),
        missedCalls: (calls.data || []) as Row[],
        appointments: ((appts.data || []) as Row[]).filter(a => !['Cancelled', 'Completed'].includes(String(a.status))),
        aiCalls: (aiCalls.data || []) as Row[],
      })
      setError(null)
    } catch {
      setError('Today could not load. Check your connection and try again.')
    }
  }, [])

  useEffect(() => {
    load()
    const channel = supabase.channel('today')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'documents' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  const view = useMemo(() => {
    if (!data) return null
    const now = Date.now()
    const threeDaysAgo = new Date(now - 3 * DAY).toISOString()
    const openJobs = data.jobs.filter(j => !['Paid', 'Closed'].includes(String(j.status)))
    const staleJobs = openJobs.filter(j => !['Completed', 'Ready for Pickup'].includes(String(j.status)) && String(j.updated_at || j.created_at) < threeDaysAgo)
    const summary = summarizeToday({
      docs: data.docs, unreadTexts: data.unreadTexts, missedCalls: data.missedCalls, staleJobs, aiAlerts, problems,
      setupIncomplete: shopLoaded && !(shop && shop.shop_name),
    })

    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
    const collected = (d: Row) => { const v = Number(d.amount_paid); return Number.isFinite(v) && v > 0 ? v : 0 }
    const paidDocs = data.docs.filter(d => (d.type === 'Receipt' || d.type === 'Invoice') && collected(d) > 0)
    const monthDocs = paidDocs.filter(d => String(d.created_at) >= monthStart)
    const monthRevenue = monthDocs.reduce((s, d) => s + collected(d), 0)

    const days: { label: string; short: string; revenue: number }[] = []
    for (let i = 13; i >= 0; i--) {
      const start = new Date(); start.setDate(start.getDate() - i); start.setHours(0, 0, 0, 0)
      const end = new Date(start); end.setDate(end.getDate() + 1)
      const revenue = paidDocs.filter(d => String(d.created_at) >= start.toISOString() && String(d.created_at) < end.toISOString()).reduce((s, d) => s + collected(d), 0)
      days.push({ label: start.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }), short: start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), revenue })
    }

    const techMap: Record<string, { jobs: number; hours: number; revenue: number }> = {}
    data.jobs.forEach(j => {
      const labors = (j.labors as Row[]) || []
      labors.forEach(l => {
        const tech = String(l.tech || '')
        if (!tech) return
        const t = (techMap[tech] ||= { jobs: 0, hours: 0, revenue: 0 })
        t.jobs++; t.hours += Number(l.hours) || 0; t.revenue += laborLineTotal(l)
      })
    })

    return {
      summary, openJobs, monthRevenue, monthPaidCount: monthDocs.length, days,
      techs: Object.entries(techMap).sort((a, b) => b[1].revenue - a[1].revenue),
    }
  }, [data, aiAlerts, problems, shop, shopLoaded])

  const callBack = (number: string, name?: string) => {
    window.dispatchEvent(new CustomEvent('phone:call', { detail: { number, name } }))
  }

  const askAlpha = (text: string) => {
    const t = text.trim()
    if (!t) return
    try { localStorage.setItem('ai_prefill', t) } catch { /* private mode: they can retype */ }
    window.location.href = '/ai'
  }

  const runInsight = async () => {
    if (!data) return
    setInsightBusy(true)
    try {
      const since = new Date(Date.now() - 30 * DAY).toISOString()
      const recentDocs = data.docs.filter(d => String(d.created_at) >= since)
      const sales = recentDocs.filter(d => d.type === 'Receipt' || d.type === 'Invoice')
      const revenue = sales.reduce((s, d) => s + calcTotals(d).total, 0)
      const summary = `Last 30 days: ${recentDocs.length} documents, ${sales.length} invoices worth ${formatCurrency(revenue)}, average ${formatCurrency(revenue / Math.max(sales.length, 1))}. ${view?.summary.estimatesWaiting.count ?? 0} estimates waiting, ${view?.summary.owed.count ?? 0} unpaid invoices worth ${formatCurrency(view?.summary.owed.total ?? 0)}, ${data.customersCount} customers.`
      const res = await fetch('/api/ai-completions', {
        method: 'POST',
        headers: await getAuthJsonHeaders(),
        body: JSON.stringify({
          model: 'meta-llama/llama-3.3-70b-instruct:free',
          messages: [
            { role: 'system', content: 'You are a business analyst for an auto repair shop. Give 2-3 brief, actionable insights based on the data. Keep it under 150 words. Be specific with numbers.' },
            { role: 'user', content: summary },
          ],
          max_tokens: 300,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'AI request failed')
      setInsight(json.choices?.[0]?.message?.content || 'Alpha did not have anything to add.')
    } catch {
      setInsight('Alpha could not check your numbers right now. Check your AI settings and try again.')
    } finally { setInsightBusy(false) }
  }

  const sendOutreach = async () => {
    if (!window.confirm('Text every customer who has not visited in 60 days? This sends real messages.')) return
    setOutreachBusy(true); setOutreachResult(null); setOutreachError('')
    try {
      const res = await fetch('/api/outreach', {
        method: 'POST',
        headers: await getAuthJsonHeaders(),
        body: JSON.stringify({ type: 'follow_up_cold', filter: { daysSinceLastVisit: 60 }, template: outreachMsg || undefined, channel: 'sms' }),
      })
      const json = await res.json()
      if (!res.ok || json.ok === false || json.error) throw new Error(json.error || 'Outreach could not be sent')
      setOutreachResult({ sent: json.sent || 0, total: json.total || 0 })
    } catch (e) {
      setOutreachError(e instanceof Error ? e.message : 'Outreach could not be sent')
    } finally { setOutreachBusy(false) }
  }

  // ---------- Loading and error ----------
  if (error && !data) {
    return (
      <div className="page-container">
        <div role="alert" className="card max-w-xl">
          <h1 className="section-title">Today could not load</h1>
          <p className="mt-1 text-text-secondary">{error}</p>
          <button className="btn btn-primary mt-4" onClick={() => { setError(null); load() }}>Try again</button>
        </div>
      </div>
    )
  }
  if (!data || !view) {
    return (
      <div className="page-container" aria-busy="true" aria-label="Loading Today">
        <div className="skeleton h-9 w-3/4 max-w-sm" />
        <div className="skeleton mt-3 h-4 w-1/2 max-w-xs" />
        <div className="mt-8 space-y-3">
          {[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-16 w-full" />)}
        </div>
      </div>
    )
  }

  const { summary } = view
  const needs = summary.feed.filter(f => f.lamp !== 'blue')
  const headLamp: Lamp | 'green' = needs.some(f => f.lamp === 'red') ? 'red' : needs.length ? 'amber' : 'green'
  const shown = showAll ? summary.feed : summary.feed.slice(0, 6)
  const maxDay = Math.max(...view.days.map(d => d.revenue), 1)
  const rangeTotal = view.days.reduce((s, d) => s + d.revenue, 0)
  const todayAppts = data.appointments.slice(0, 5)

  return (
    <div className="page-container animate-fade-in">
      {/* ---------- Headline ---------- */}
      <header className="mb-6">
        <p className="text-[0.9375rem] text-text-secondary">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
        <h1 className="page-title mt-1 flex items-center gap-3">
          <span className={`lamp lamp-${headLamp}`} aria-hidden="true" style={{ width: '0.9rem', height: '0.9rem' }} />
          {needs.length === 0 ? 'You are all caught up' : `${needs.length} thing${needs.length === 1 ? '' : 's'} need${needs.length === 1 ? 's' : ''} you`}
        </h1>
      </header>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_21rem] lg:gap-10">
        <div className="min-w-0 space-y-8">
          {/* ---------- Needs you ---------- */}
          <section aria-labelledby="needs-h">
            <h2 id="needs-h" className="sr-only">Needs you</h2>
            {summary.feed.length === 0 ? (
              <div className="empty-state">
                No unanswered texts, missed calls, unpaid invoices or stale estimates. Check back after your next customer.
              </div>
            ) : (
              <>
                <ul className="ledger">
                  {shown.map(item => <FeedRow key={item.id} item={item} onCall={callBack} />)}
                </ul>
                {summary.feed.length > 6 && (
                  <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => setShowAll(v => !v)}>
                    {showAll ? 'Show fewer' : `Show ${summary.feed.length - 6} more`}
                  </button>
                )}
              </>
            )}
          </section>

          {/* ---------- In the shop ---------- */}
          {view.openJobs.length > 0 && (
            <section aria-labelledby="shop-h">
              <div className="mb-3 flex items-end justify-between">
                <h2 id="shop-h" className="section-title">In the shop</h2>
                <Link href="/shopboard" className="text-[0.9375rem] font-bold text-blue underline-offset-4 hover:underline">Open shop board</Link>
              </div>
              <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0">
                {view.openJobs.slice(0, 6).map(j => {
                  const lamp = JOB_LAMP[String(j.status)] || 'off'
                  const car = [j.vehicle_year, j.vehicle_make, j.vehicle_model].filter(Boolean).join(' ')
                  return (
                    <li key={String(j.id)} className="w-[17rem] shrink-0 snap-start sm:w-auto">
                      <Link href={`/jobs?job=${encodeURIComponent(String(j.id))}`} className={`rotag lamp-${lamp}`}>
                        <span className="flex items-center gap-2 text-[0.875rem] font-bold text-text-secondary">
                          <span className={`lamp lamp-${lamp}`} aria-hidden="true" />
                          {String(j.status)}
                          {j.ro_number ? <span className="ml-auto num font-normal">RO {String(j.ro_number)}</span> : null}
                        </span>
                        <span className="display mt-2 block truncate text-[1.125rem] font-bold">{car || 'Vehicle not entered'}</span>
                        <span className="block truncate text-[0.9375rem] text-text-secondary">{String(j.customer_name || 'No customer')}</span>
                        {j.concern ? <span className="mt-1.5 line-clamp-2 block text-[0.9375rem]">{String(j.concern)}</span> : null}
                        <span className="mt-2 block text-[0.8125rem] text-text-muted">In {ageLabel(String(j.created_at)).replace(' ago', '')}{j.promise_date ? ` · promised ${String(j.promise_date)}` : ''}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          {/* ---------- Coming up ---------- */}
          {todayAppts.length > 0 && (
            <section aria-labelledby="up-h">
              <div className="mb-2 flex items-end justify-between">
                <h2 id="up-h" className="section-title">Coming up</h2>
                <Link href="/appointments" className="text-[0.9375rem] font-bold text-blue underline-offset-4 hover:underline">Open schedule</Link>
              </div>
              <ul className="ledger">
                {todayAppts.map(a => (
                  <li key={String(a.id)}>
                    <Link href="/appointments" className="ledger-row">
                      <span className="w-[4.5rem] shrink-0">
                        <span className="display num block font-bold leading-tight">{timeOf(String(a.time))}</span>
                        <span className="block text-[0.8125rem] text-text-secondary">{dayLabel(String(a.date))}</span>
                      </span>
                      <span className="ledger-main">
                        <span className="ledger-title block">{String(a.customer_name || 'Walk-in')}</span>
                        <span className="ledger-sub block">{[a.service, a.vehicle].filter(Boolean).join(' · ') || 'No details yet'}</span>
                      </span>
                      <Icon name="chevronRight" className="h-5 w-5 text-text-muted" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {/* ---------- Tech table (only when techs are logged) ---------- */}
          {view.techs.length > 0 && (
            <section aria-labelledby="tech-h">
              <h2 id="tech-h" className="section-title mb-2">Technicians</h2>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="data-table">
                  <thead><tr><th>Technician</th><th className="text-right">Jobs</th><th className="text-right">Hours</th><th className="text-right">Labor billed</th></tr></thead>
                  <tbody>
                    {view.techs.map(([name, t]) => (
                      <tr key={name}>
                        <td className="font-bold">{name}</td>
                        <td className="text-right num">{t.jobs}</td>
                        <td className="text-right num">{t.hours.toFixed(1)}</td>
                        <td className="text-right num font-bold">{formatCurrency(t.revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>

        {/* ---------- Side column ---------- */}
        <div className="min-w-0 space-y-8">
          <section aria-labelledby="money-h">
            <h2 id="money-h" className="section-title mb-2">Money</h2>
            <ul className="ledger">
              <li>
                <Link href="/invoices" className="ledger-row">
                  <span className="ledger-main">
                    <span className="ledger-title block">Collected this month</span>
                    <span className="ledger-sub block">{view.monthPaidCount} invoice{view.monthPaidCount === 1 ? '' : 's'} with payments</span>
                  </span>
                  <span className="ledger-amt text-[1.375rem]">{money0(view.monthRevenue)}</span>
                </Link>
              </li>
              <li>
                <Link href="/invoices" className="ledger-row">
                  <span className="ledger-main">
                    <span className="ledger-title block">Customers owe you</span>
                    <span className="ledger-sub block">{summary.owed.count === 0 ? 'Every invoice is paid' : `${summary.owed.count} unpaid invoice${summary.owed.count === 1 ? '' : 's'}`}</span>
                  </span>
                  <span className={`ledger-amt text-[1.375rem] ${summary.owed.total > 0 ? 'text-red' : ''}`}>{money0(summary.owed.total)}</span>
                </Link>
              </li>
              <li>
                <Link href="/estimates" className="ledger-row">
                  <span className="ledger-main">
                    <span className="ledger-title block">Estimates out</span>
                    <span className="ledger-sub block">{summary.estimatesWaiting.count === 0 ? 'No open estimates' : `${summary.estimatesWaiting.count} waiting, oldest ${summary.estimatesWaiting.oldDays} days`}</span>
                  </span>
                  <span className="ledger-amt text-[1.375rem]">{money0(summary.estimatesWaiting.total)}</span>
                </Link>
              </li>
            </ul>

            <figure className="mt-5" aria-label={`Payments collected over the last 14 days: ${money0(rangeTotal)} in total`}>
              <div className="flex h-24 items-end gap-1" role="img" aria-label={`Bar chart of payments over 14 days, total ${money0(rangeTotal)}`}>
                {view.days.map((d, i) => (
                  <div key={i} className="flex h-full flex-1 items-end" title={`${d.label}: ${money0(d.revenue)}`}>
                    <div
                      className={d.revenue > 0 ? 'w-full rounded-t-sm bg-blue' : 'w-full rounded-t-sm bg-border'}
                      style={{ height: d.revenue > 0 ? `${Math.max(8, (d.revenue / maxDay) * 100)}%` : '4px', opacity: i === view.days.length - 1 ? 1 : 0.78 }}
                    />
                  </div>
                ))}
              </div>
              <figcaption className="mt-1.5 flex justify-between text-[0.8125rem] text-text-secondary">
                <span>{view.days[0].short}</span>
                <span className="num">{money0(rangeTotal)} in 14 days</span>
                <span>Today</span>
              </figcaption>
            </figure>
          </section>

          <section aria-labelledby="ask-h">
            <h2 id="ask-h" className="section-title mb-2">Ask Alpha</h2>
            <form onSubmit={e => { e.preventDefault(); askAlpha(question) }} className="flex gap-2">
              <label className="min-w-0 flex-1">
                <span className="sr-only">Ask Alpha a question</span>
                <input className="form-input" value={question} onChange={e => setQuestion(e.target.value)} placeholder="What do you need done?" />
              </label>
              <button type="submit" className="btn btn-primary" disabled={!question.trim()}>Ask</button>
            </form>
            <ul className="mt-3 flex flex-wrap gap-2">
              {ASK_IDEAS.map(t => (
                <li key={t}><button type="button" className="rounded-full border border-line bg-bg-card px-3 py-1.5 text-[0.875rem] font-bold hover:bg-bg-hover" onClick={() => askAlpha(t)}>{t}</button></li>
              ))}
            </ul>

            <div className="mt-5">
              <button type="button" className="btn btn-secondary btn-sm" onClick={runInsight} disabled={insightBusy}>
                {insightBusy ? 'Checking your numbers…' : 'Check up on my shop'}
              </button>
              {insight && <p className="mt-3 whitespace-pre-wrap text-[0.9375rem] leading-relaxed" aria-live="polite">{insight}</p>}
            </div>

            <details className="mt-5 rounded-lg border border-border">
              <summary className="cursor-pointer list-none px-4 py-3 text-[0.9375rem] font-bold">Bring back customers who have gone quiet</summary>
              <div className="border-t border-border px-4 pb-4 pt-3">
                <p className="text-[0.9375rem] text-text-secondary">Sends a text to customers who have not visited in 60 days. Leave the message blank to use Alpha&apos;s default.</p>
                <label className="form-label mt-3" htmlFor="outreach-msg">Your message (optional)</label>
                <textarea id="outreach-msg" className="form-textarea" rows={3} value={outreachMsg} onChange={e => setOutreachMsg(e.target.value)} />
                <button type="button" className="btn btn-primary mt-3 w-full" onClick={sendOutreach} disabled={outreachBusy}>{outreachBusy ? 'Sending…' : 'Review and send'}</button>
                {outreachResult && <p className="mt-3 text-[0.9375rem] font-bold text-green" aria-live="polite">Sent {outreachResult.sent} of {outreachResult.total} eligible customers.</p>}
                {outreachError && <p className="form-error" role="alert">{outreachError}</p>}
              </div>
            </details>
          </section>

          {data.aiCalls.length > 0 && (
            <section aria-labelledby="calls-h">
              <div className="mb-2 flex items-end justify-between">
                <h2 id="calls-h" className="section-title">Alpha answered</h2>
                <Link href="/messages?tab=calls" className="text-[0.9375rem] font-bold text-blue underline-offset-4 hover:underline">All calls</Link>
              </div>
              <ul className="ledger">
                {data.aiCalls.map(c => {
                  const task = String(c.task || '')
                  const m = task.match(/Inbound call from ([^\s.]+)/)
                  const caller = String(c.caller && c.caller !== 'unknown' ? c.caller : m ? m[1] : 'Unknown caller')
                  return (
                    <li key={String(c.id)}>
                      <Link href="/messages?tab=calls" className="ledger-row">
                        <span className="ledger-main">
                          <span className="ledger-title block">{caller}</span>
                          <span className="ledger-sub block">{String(c.summary || 'No summary yet')}</span>
                        </span>
                        <span className="text-[0.8125rem] text-text-muted">{c.started_at ? ageLabel(new Date(Number(c.started_at) || String(c.started_at)).toISOString()).replace(' ago', '') : ''}</span>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}

          <DailyNotes />
        </div>
      </div>
    </div>
  )
}

function FeedRow({ item, onCall }: { item: FeedItem; onCall: (n: string, name?: string) => void }) {
  const inner = (
    <>
      <span className={`lamp lamp-${item.lamp}`} aria-hidden="true" />
      <span className="ledger-main">
        <span className="ledger-title block !whitespace-normal">{item.title}</span>
        <span className="ledger-sub block !whitespace-normal">{item.detail}</span>
      </span>
    </>
  )
  return (
    <li className="flex items-center">
      {item.href ? (
        <Link href={item.href} className="ledger-row min-w-0 flex-1">
          {inner}
          {!item.call && <Icon name="chevronRight" className="h-5 w-5 shrink-0 text-text-muted" />}
        </Link>
      ) : (
        <div className="ledger-row min-w-0 flex-1">{inner}</div>
      )}
      {item.call && (
        <button type="button" className="btn btn-secondary btn-sm mr-2 shrink-0" onClick={() => onCall(item.call!.number, item.call!.name)}>
          <Icon name="phone" className="h-4 w-4" />
          Call back
        </button>
      )}
    </li>
  )
}
