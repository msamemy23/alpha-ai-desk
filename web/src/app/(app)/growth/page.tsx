'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getShopId } from '@/lib/supabase'
import Icon from '@/components/Icon'
import { ErrorCard } from '@/components/ListKit'
import { ScreenToast, Segmented, useToast } from '@/components/ScreenParts'
import ActivityLog from '@/components/growth/ActivityLog'
import AdsSheet from '@/components/growth/AdsSheet'
import FollowUpsTab from '@/components/growth/FollowUpsTab'
import LeadReport from '@/components/growth/LeadReport'
import LeadsTab, { SCANS } from '@/components/growth/LeadsTab'
import type { ScanKind } from '@/components/growth/LeadsTab'
import LeadSheet from '@/components/growth/LeadSheet'
import LookupSheet from '@/components/growth/LookupSheet'
import PostSheet from '@/components/growth/PostSheet'
import PostsTab from '@/components/growth/PostsTab'
import ReferralsTab from '@/components/growth/ReferralsTab'
import ResultsTab from '@/components/growth/ResultsTab'
import ReviewsTab from '@/components/growth/ReviewsTab'
import SendFlow from '@/components/growth/SendFlow'
import type { Compose } from '@/components/growth/SendFlow'
import { Stat } from '@/components/growth/parts'
import { getAuthJsonHeaders } from '@/components/growth/helpers'
import type { Rec } from '@/components/growth/helpers'
import type { OutreachMethod } from '@/components/growth/OutreachButtons'
import { useGrowthData } from '@/components/growth/useGrowthData'

type Tab = 'followups' | 'reviews' | 'referrals' | 'leads' | 'posts' | 'results'
const TABS: { key: Tab; label: string }[] = [
  { key: 'followups', label: 'Follow-ups' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'referrals', label: 'Referrals' },
  { key: 'leads', label: 'Leads' },
  { key: 'posts', label: 'Posts and ads' },
  { key: 'results', label: 'Results' },
]

export default function GrowthPage() {
  const d = useGrowthData()
  const { toast, notify, dismiss } = useToast()
  const [tab, setTab] = useState<Tab>('followups')
  const [aiMode, setAiMode] = useState(false)
  const [composing, setComposing] = useState<{ id: number; what: Compose } | null>(null)
  const seq = useRef(0)
  const setCompose = useCallback((what: Compose | null) => setComposing(what ? { id: ++seq.current, what } : null), [])
  const [report, setReport] = useState<{ title: string; sources: string[]; scan: ScanKind | null } | null>(null)
  const [scanning, setScanning] = useState<ScanKind | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [leadSheet, setLeadSheet] = useState<null | { lead: Rec | null }>(null)
  const [ads, setAds] = useState<null | 'google' | 'facebook'>(null)
  const [showPost, setShowPost] = useState(false)
  const [showLookup, setShowLookup] = useState(false)

  const { load, loadCalls, callState } = d
  useEffect(() => { if (tab === 'leads' && callState === 'idle') void loadCalls() }, [tab, callState, loadCalls])

  const refresh = useCallback(() => { void load({ quiet: true }) }, [load])
  const openLeads = d.leads.filter(l => !['converted', 'not_interested'].includes(String(l.status || 'new'))).length
  const reportLeads = report ? d.leads.filter(l => report.sources.includes(l.source)) : []

  // Escape on the lead report should not also close a message preview that sits on top of it.
  const composeOpen = useRef(false)
  useEffect(() => { composeOpen.current = composing !== null }, [composing])
  const closeReport = useCallback(() => { if (!composeOpen.current) setReport(null) }, [])
  const closeCompose = useCallback(() => setCompose(null), [setCompose])

  const outreach = (lead: Rec, method: OutreachMethod) => setCompose({ kind: 'lead', lead, method })

  const runScan = async (kind: ScanKind) => {
    const scan = SCANS[kind]
    if (!d.city) return notify('Add your shop’s city in the setup guide first, so Alpha knows where to search.', 'error')
    setReport({ title: scan.title, sources: [scan.source], scan: kind })
    setScanning(kind)
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('We could not find your shop')
      const r = await fetch(scan.endpoint, { method: 'POST', headers: await getAuthJsonHeaders(), body: JSON.stringify({ city: d.city.search }) })
      const body = await r.json().catch(() => ({}))
      if (!r.ok || body.error) throw new Error(body.error || scan.failure)
      const n = body.total_leads || 0
      notify(n ? `Alpha found ${n} ${n === 1 ? 'lead' : 'leads'}.` : 'Alpha did not find any new leads this time.', n ? 'success' : 'info')
      await load({ quiet: true })
    } catch (error) {
      notify(`${error instanceof Error && error.message ? error.message : scan.failure}. Try again in a few minutes.`, 'error')
      setReport(null)
    } finally { setScanning(null) }
  }

  const syncCalls = async () => {
    setSyncing(true)
    try {
      const response = await fetch('/api/telnyx/sync-calls?action=sync', { headers: await getAuthJsonHeaders() })
      if (!response.ok) { const detail = await response.json().catch(() => ({})); throw new Error(detail.error || 'Call sync failed') }
      await loadCalls()
      notify('Calls are up to date.', 'success')
    } catch (error) {
      notify(`${error instanceof Error ? error.message : 'Call sync failed'}. Try again.`, 'error')
    }
    setSyncing(false)
  }

  const changeTab = (next: Tab) => setTab(next)

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div>
          <h1 className="page-title">Get more customers</h1>
          <p className="page-subtitle">Bring customers back, ask for reviews and find new ones.</p>
        </div>
        <div className="toolbar">
          <button type="button" className="btn btn-secondary" onClick={() => load()} disabled={d.loading}>
            <Icon name="refresh" className="h-5 w-5" />
            {d.loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {d.fatal ? (
        <ErrorCard title="This page did not load" message={d.fatal} onRetry={() => load()} busy={d.loading} className="max-w-xl" />
      ) : (
        <>
          <div className="panel mb-4 grid grid-cols-2 divide-border overflow-hidden sm:grid-cols-4 sm:divide-x">
            <div className="border-b border-r border-border sm:border-b-0 sm:border-r-0"><Stat label="Customers" value={d.loading || d.failed.customers ? '–' : d.customers.length} /></div>
            <div className="border-b border-border sm:border-b-0"><Stat label="Need a follow-up" value={d.loading || d.failed.customers || d.failed.visits ? '–' : d.quiet.length} lamp={!d.loading && !d.failed.customers && !d.failed.visits ? (d.quiet.length ? 'amber' : 'green') : undefined} onClick={() => changeTab('followups')} /></div>
            <div className="border-r border-border sm:border-r-0"><Stat label="Referral codes" value={d.loading || d.failed.referrals ? '–' : d.referrals.length} onClick={() => changeTab('referrals')} /></div>
            <div><Stat label="Open leads" value={d.loading || d.failed.leads ? '–' : openLeads} onClick={() => changeTab('leads')} /></div>
          </div>

          <Segmented label="Choose what to work on" idPrefix="growth" options={TABS} value={tab} onChange={changeTab} />

          <div id="growth-panel" role="tabpanel" aria-labelledby={`growth-tab-${tab}`} className="mt-6">
            {tab === 'followups' && (
              <FollowUpsTab loading={d.loading} failed={d.failed} customers={d.customers} quiet={d.quiet} visits={d.visits} shop={d.shop} onRetry={() => load()} onText={customers => setCompose({ kind: 'followup', customers })} />
            )}
            {tab === 'reviews' && (
              <ReviewsTab loading={d.loading} failedCustomers={d.failed.customers} customers={d.customers} visits={d.visits} shop={d.shop} onRetry={() => load()} onRetryShop={() => void d.loadShop()} onAsk={customer => setCompose({ kind: 'review', customer })} notify={notify} />
            )}
            {tab === 'referrals' && (
              <ReferralsTab loading={d.loading} failed={d.failed.customers || d.failed.referrals} customers={d.customers} referrals={d.referrals} onRetry={() => load()} onCreate={customer => setCompose({ kind: 'referral', customer })} notify={notify} />
            )}
            {tab === 'leads' && (
              <LeadsTab
                loading={d.loading} failed={d.failed.leads} leads={d.leads} onRetry={() => load()}
                city={d.city} cityReady={d.cityState === 'ready'} scanning={scanning} onScan={runScan} onLookup={() => setShowLookup(true)}
                aiMode={aiMode} onAiMode={setAiMode}
                onAdd={() => setLeadSheet({ lead: null })} onEdit={lead => setLeadSheet({ lead })} onOutreach={outreach}
                onReport={(title, sources) => setReport({ title, sources, scan: null })}
                callState={d.callState} callHistory={d.callHistory} onRetryCalls={() => void loadCalls()} syncing={syncing} onSync={syncCalls}
              />
            )}
            {tab === 'posts' && (
              <PostsTab loading={d.loading} failedPosts={d.failed.posts} failedCampaigns={d.failed.campaigns} posts={d.postHistory} campaigns={d.campaigns} cityLabel={d.city?.label || null} onRetry={() => load()} onWrite={() => setShowPost(true)} onAd={setAds} />
            )}
            {tab === 'results' && (
              <ResultsTab loading={d.loading} failed={d.failed} customers={d.customers} leads={d.leads} referrals={d.referrals} outreach={d.outreachHistory} campaigns={d.campaigns} quietCount={d.quiet.length} onRetry={() => load()} />
            )}
          </div>

          {tab !== 'results' && !d.failed.activity && <ActivityLog items={d.activityLog} />}
        </>
      )}

      {report && (
        <LeadReport
          title={report.title}
          leads={reportLeads}
          scanning={!!report.scan && scanning === report.scan}
          scanHint={report.scan ? SCANS[report.scan].hint : ''}
          onClose={closeReport}
          onOutreach={outreach}
          onRefresh={async () => { await load({ quiet: true }) }}
          notify={notify}
        />
      )}

      {composing && <SendFlow key={composing.id} compose={composing.what} shop={d.shop} aiMode={aiMode} onClose={closeCompose} onChanged={refresh} notify={notify} />}

      {leadSheet && <LeadSheet lead={leadSheet.lead} onClose={() => setLeadSheet(null)} onSaved={message => { setLeadSheet(null); notify(message, 'success'); refresh() }} />}
      {ads && <AdsSheet platform={ads} cityLabel={d.city?.label || null} onClose={() => setAds(null)} onSaved={message => { setAds(null); notify(message, 'success'); refresh() }} />}
      {showPost && <PostSheet shopName={d.shop.name} onClose={() => setShowPost(false)} onSaved={message => { setShowPost(false); notify(message, 'success'); refresh() }} />}
      {showLookup && <LookupSheet onClose={() => setShowLookup(false)} />}

      <ScreenToast toast={toast} onClose={dismiss} />
    </div>
  )
}
