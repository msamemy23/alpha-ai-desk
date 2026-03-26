'use client'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
type Rec = Record<string, any>
// Removed: hardcoded reviewUrl - now loaded from settings

function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error' | 'info'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t) }, [onClose])
  const bg = type === 'success' ? 'bg-emerald-500' : type === 'error' ? 'bg-red-500' : 'bg-blue-500'
  return (<div className={`fixed top-4 right-4 z-[100] ${bg} text-white px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 text-sm font-medium animate-slide-in`}>{message}<button onClick={onClose} className="ml-2 opacity-70 hover:opacity-100">x</button></div>)
}
function timeAgo(d: string) { if (!d) return 'Never'; const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000); if (days === 0) return 'Today'; if (days === 1) return 'Yesterday'; if (days < 30) return `${days}d ago`; if (days < 365) return `${Math.floor(days / 30)}mo ago`; return `${Math.floor(days / 365)}y ago` }
function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  return (<div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}><div className={`bg-[#1a2332] rounded-2xl shadow-2xl ${wide ? 'max-w-4xl' : 'max-w-lg'} w-full max-h-[85vh] overflow-y-auto p-6`} onClick={e => e.stopPropagation()}><div className="flex items-center justify-between mb-4"><h2 className="text-lg font-bold text-white">{title}</h2><button onClick={onClose} className="text-gray-400 hover:text-white text-xl">x</button></div>{children}</div></div>)
}
function DeepResearchModal({ title, leads, onClose, onOutreach, sending }: { title: string; leads: any[]; onClose: () => void; onOutreach: (id: string, method: string) => void; sending: string | null }) {
  const [filter, setFilter] = useState({ size: 'all', industry: 'all', sort: 'score' })
  const [search, setSearch] = useState('')
    const [enriching, setEnriching] = useState<string | null>(null)
  const [bulkEnriching, setBulkEnriching] = useState(false)
  const [enrichedCount, setEnrichedCount] = useState(0)
  const [expandedApollo, setExpandedApollo] = useState<string | null>(null)
  const industries = useMemo(() => Array.from(new Set(leads.map(l => l.industry || l.business_type || 'Unknown').filter(Boolean))), [leads])
  const filtered = useMemo(() => {
    let r = leads.filter(l => {
      if (search && !JSON.stringify(l).toLowerCase().includes(search.toLowerCase())) return false
      if (filter.industry !== 'all' && (l.industry || l.business_type) !== filter.industry) return false
      if (filter.size === 'small' && parseInt(l.fleet_size || l.employee_count || '0') > 10) return false
      if (filter.size === 'large' && parseInt(l.fleet_size || l.employee_count || '0') < 10) return false
      return true
    })
    if (filter.sort === 'score') r.sort((a, b) => (b.deep_research?.fleet_score || 0) - (a.deep_research?.fleet_score || 0))
    if (filter.sort === 'rating') r.sort((a, b) => (b.google_rating || 0) - (a.google_rating || 0))
    if (filter.sort === 'name') r.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    return r
  }, [leads, filter, search])
  const n = (l: any) => { try { return typeof l.notes === 'string' ? JSON.parse(l.notes) : (l.notes || {}) } catch { return {} } }
  const dr = (l: any) => (typeof l.deep_research === 'string' ? JSON.parse(l.deep_research) : l.deep_research) || {}
    const ap = (l: any) => { try { return typeof l.apollo_data === 'string' ? JSON.parse(l.apollo_data) : (l.apollo_data || null) } catch { return null } }
  const enrichLead = async (leadId: string) => { setEnriching(leadId); try { const res = await fetch('/api/growth/apollo-enrich', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lead_id: leadId }) }); const data = await res.json(); if (data.success) { setEnrichedCount(c => c + 1); window.location.reload() } } catch {} setEnriching(null) }
  const enrichAll = async () => { setBulkEnriching(true); setEnrichedCount(0); const ids = filtered.filter(l => !l.apollo_enriched_at).map(l => l.id).filter(Boolean); if (!ids.length) { setBulkEnriching(false); return }; try { const res = await fetch('/api/growth/apollo-enrich', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bulk_lead_ids: ids }) }); const data = await res.json(); if (data.success) { setEnrichedCount(data.enriched || 0); setTimeout(() => window.location.reload(), 1500) } } catch {} setBulkEnriching(false) }
  return (<div className="fixed inset-0 z-50 bg-black/80" onClick={onClose}><div className="h-full w-full flex flex-col bg-[#0f1923]" onClick={e => e.stopPropagation()}>
    <div className="flex items-center justify-between p-4 border-b border-white/10 bg-[#1a2332]">
      <div><h2 className="text-xl font-bold text-white">{title}</h2><p className="text-xs text-gray-400">{filtered.length} of {leads.length} results</p></div>
      <div className="flex items-center gap-3">
        <input className="bg-[#0f1923] border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 w-48" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
        <select className="bg-[#0f1923] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-gray-300" value={filter.industry} onChange={e => setFilter(p => ({...p, industry: e.target.value}))}><option value="all">All Industries</option>{industries.map(i => <option key={i} value={i}>{i}</option>)}</select>
        <select className="bg-[#0f1923] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-gray-300" value={filter.size} onChange={e => setFilter(p => ({...p, size: e.target.value}))}><option value="all">All Sizes</option><option value="small">Small (1-10)</option><option value="large">Large (10+)</option></select>
        <select className="bg-[#0f1923] border border-white/10 rounded-lg px-2 py-1.5 text-xs text-gray-300" value={filter.sort} onChange={e => setFilter(p => ({...p, sort: e.target.value}))}><option value="score">Sort: Score</option><option value="rating">Sort: Rating</option><option value="name">Sort: Name</option></select>
              <button onClick={enrichAll} disabled={bulkEnriching} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${bulkEnriching ? 'bg-yellow-600 text-white animate-pulse' : 'bg-gradient-to-r from-orange-500 to-pink-500 text-white hover:from-orange-400 hover:to-pink-400'}`}>{bulkEnriching ? `Enriching ${enrichedCount}...` : 'Enrich All (Apollo)'}</button>
        <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl ml-2">x</button>
      </div>
    </div>
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {filtered.map((l, i) => { const nd = n(l); const d = dr(l); return (
        <div key={l.id || i} className="bg-[#1a2332] border border-white/10 rounded-2xl p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="flex items-center gap-2"><h3 className="text-lg font-bold text-white">{l.name}</h3>{l.confidence && <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${l.confidence === 'high' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-yellow-500/20 text-yellow-400'}`}>{l.confidence}</span>}{(d.fleet_score || nd.fleet_score) && <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 font-bold">{d.fleet_score || nd.fleet_score}/10</span>}</div>
              {l.owner_name && <p className="text-sm text-gray-300 mt-0.5">{l.owner_title || 'Owner'}: <span className="text-white font-medium">{l.owner_name}</span></p>}
            </div>
            <div className="flex gap-1.5">{l.id && <><button onClick={() => onOutreach(l.id, 'sms')} disabled={sending === l.id || !l.phone} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${l.phone ? 'bg-blue-600 text-white hover:bg-blue-500' : 'bg-white/5 text-gray-600'}`}>{sending === l.id ? '...' : 'SMS'}</button><button onClick={() => onOutreach(l.id, 'email')} disabled={sending === l.id || !l.email} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${l.email ? 'bg-purple-600 text-white hover:bg-purple-500' : 'bg-white/5 text-gray-600'}`}>{sending === l.id ? '...' : 'Email'}</button><button onClick={() => onOutreach(l.id, 'ai_call')} disabled={sending === l.id || !l.phone} className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${l.phone ? 'bg-emerald-600 text-white hover:bg-emerald-500' : 'bg-white/5 text-gray-600'}`}>{sending === l.id ? '...' : 'AI Call'}</button></>}</div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs mb-3">
            {l.phone && <div className="bg-[#0f1923] rounded-lg p-2"><span className="text-gray-500">Phone</span><p className="text-blue-400 font-medium">{l.phone}</p></div>}
            {l.email && <div className="bg-[#0f1923] rounded-lg p-2"><span className="text-gray-500">Email</span><p className="text-purple-400 font-medium truncate">{l.email}</p></div>}
            {l.address && <div className="bg-[#0f1923] rounded-lg p-2"><span className="text-gray-500">Address</span><p className="text-gray-300">{l.address}</p></div>}
            {l.website && <div className="bg-[#0f1923] rounded-lg p-2"><span className="text-gray-500">Website</span><p className="text-cyan-400 truncate">{l.website}</p></div>}
            {(l.google_rating) && <div className="bg-[#0f1923] rounded-lg p-2"><span className="text-gray-500">Google</span><p className="text-yellow-400 font-medium">{l.google_rating} ({l.google_reviews_count || '?'} reviews)</p></div>}
            {l.fleet_size && <div className="bg-[#0f1923] rounded-lg p-2"><span className="text-gray-500">Fleet Size</span><p className="text-white font-medium">{l.fleet_size} vehicles</p></div>}
            {l.vehicle_types && <div className="bg-[#0f1923] rounded-lg p-2"><span className="text-gray-500">Vehicle Types</span><p className="text-gray-300">{l.vehicle_types}</p></div>}
            {l.employee_count && <div className="bg-[#0f1923] rounded-lg p-2"><span className="text-gray-500">Employees</span><p className="text-gray-300">{l.employee_count}</p></div>}
            {l.revenue_estimate && <div className="bg-[#0f1923] rounded-lg p-2"><span className="text-gray-500">Revenue</span><p className="text-emerald-400 font-medium">{l.revenue_estimate}</p></div>}
            {l.years_in_business && <div className="bg-[#0f1923] rounded-lg p-2"><span className="text-gray-500">Years</span><p className="text-gray-300">{l.years_in_business} years</p></div>}
            {l.industry && <div className="bg-[#0f1923] rounded-lg p-2"><span className="text-gray-500">Industry</span><p className="text-gray-300">{l.industry}</p></div>}
            {l.service_area && <div className="bg-[#0f1923] rounded-lg p-2"><span className="text-gray-500">Service Area</span><p className="text-gray-300">{l.service_area}</p></div>}
            {l.has_maintenance_contract !== null && l.has_maintenance_contract !== undefined && <div className="bg-[#0f1923] rounded-lg p-2"><span className="text-gray-500">Contract</span><p className={l.has_maintenance_contract ? 'text-red-400' : 'text-emerald-400'}>{l.has_maintenance_contract ? 'Has contract' : 'No contract'}</p></div>}
            {l.current_shop && <div className="bg-[#0f1923] rounded-lg p-2"><span className="text-gray-500">Current Shop</span><p className="text-orange-400">{l.current_shop}</p></div>}
            {(d.annual_value_estimate || nd.annual_value_estimate) && <div className="bg-[#0f1923] rounded-lg p-2"><span className="text-gray-500">Annual Value</span><p className="text-emerald-400 font-bold">{d.annual_value_estimate || nd.annual_value_estimate}</p></div>}
          </div>
          {l.pain_points && <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-2 mb-2 text-xs"><span className="text-red-400 font-semibold">Pain Points:</span> <span className="text-red-300">{l.pain_points}</span></div>}
          {(d.outreach_pitch || nd.outreach_pitch) && <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-2 mb-2 text-xs"><span className="text-blue-400 font-semibold">Pitch:</span> <span className="text-blue-300">{d.outreach_pitch || nd.outreach_pitch}</span></div>}
                          {(() => { const apollo = ap(l); return apollo ? (<div className="mt-3 p-3 bg-gradient-to-r from-orange-500/10 to-pink-500/10 border border-orange-500/20 rounded-xl"><div className="flex items-center justify-between mb-2"><span className="text-xs font-bold text-orange-400">Apollo Intel ({apollo.people_found} contacts)</span><button onClick={() => setExpandedApollo(expandedApollo === l.id ? null : l.id)} className="text-[10px] text-orange-300 hover:text-white">{expandedApollo === l.id ? 'Collapse' : 'Expand'}</button></div>{expandedApollo === l.id && apollo.contacts?.map((c: any, ci: number) => (<div key={ci} className="p-2 bg-black/20 rounded-lg mb-1.5 text-xs"><div className="flex items-center justify-between"><span className="text-white font-semibold">{c.name}</span><span className="text-orange-300">{c.title}</span></div>{c.email && <p className="text-blue-400 mt-0.5">{c.email}</p>}{c.phone && <p className="text-emerald-400 mt-0.5">{c.phone}</p>}{c.linkedin && <a href={c.linkedin} target="_blank" className="text-purple-400 hover:text-purple-300 mt-0.5 block">LinkedIn Profile</a>}</div>))}</div>) : (<button onClick={() => enrichLead(l.id)} disabled={enriching === l.id} className={`mt-3 w-full py-2 rounded-xl text-xs font-semibold ${enriching === l.id ? 'bg-yellow-600/20 text-yellow-400 animate-pulse' : 'bg-gradient-to-r from-orange-500/20 to-pink-500/20 text-orange-400 hover:from-orange-500/30 hover:to-pink-500/30 border border-orange-500/20'}`}>{enriching === l.id ? 'Enriching via Apollo...' : 'Enrich with Apollo (Find Contacts)'}</button>) })()}
          <div className="flex gap-2 mt-2">
            {l.facebook_url && <a href={l.facebook_url} target="_blank" className="text-[10px] px-2 py-1 rounded bg-blue-500/10 text-blue-400">Facebook</a>}
            {l.linkedin_url && <a href={l.linkedin_url} target="_blank" className="text-[10px] px-2 py-1 rounded bg-blue-500/10 text-blue-400">LinkedIn</a>}
            {l.source && <span className="text-[10px] px-2 py-1 rounded bg-white/5 text-gray-500">{l.source.replace(/-/g, ' ')}</span>}
          </div>
        </div>
      ) })}
      {filtered.length === 0 && <p className="text-gray-500 text-center py-20">No results match your filters.</p>}
    </div>
  </div></div>)
}
type Tab = 'followups' | 'reviews' | 'referrals' | 'leads' | 'social' | 'capture' | 'intel' | 'ads' | 'roi'
const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'followups', label: 'Follow-ups', icon: '\ud83d\udd01' },
  { key: 'reviews', label: 'Reviews', icon: '\u2b50' },
  { key: 'referrals', label: 'Referrals', icon: '\ud83e\udd1d' },
  { key: 'leads', label: 'Lead Gen', icon: '\ud83c\udfaf' },
  { key: 'social', label: 'Social Post', icon: '\ud83d\udcf1' },
  { key: 'capture', label: 'Capture', icon: '\ud83d\udcde' },
  { key: 'intel', label: 'Smart Search', icon: '\ud83d\udd0d' },
  { key: 'ads', label: 'Ads', icon: '\ud83d\udce2' },
]
export default function GrowthPage() {
  const [tab, setTab] = useState<Tab>('followups')
  const [customers, setCustomers] = useState<Rec[]>([])
  const [referrals, setReferrals] = useState<Rec[]>([])
  const [leads, setLeads] = useState<Rec[]>([])
  const [campaigns, setCampaigns] = useState<Rec[]>([])
  const [activityLog, setActivityLog] = useState<Rec[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null)
  const [scanningCompetitor, setScanningCompetitor] = useState(false)
  const [scanningSocial, setScanningSocial] = useState(false)
  const [scanningFleet, setScanningFleet] = useState(false)
  const [captureName, setCaptureName] = useState('')
  const [capturePhone, setCapturePhone] = useState('')
  const [captureService, setCaptureService] = useState('')
  const [captureSource, setCaptureSource] = useState('walk-in')
    const [callHistory, setCallHistory] = useState<Rec[]>([])
  const [showImportModal, setShowImportModal] = useState(false)
  const [importName, setImportName] = useState('')
  const [importPhone, setImportPhone] = useState('')
  const [importService, setImportService] = useState('')
  const [importSource, setImportSource] = useState('manual')
  const [importNotes, setImportNotes] = useState('')
  const [reviewUrl, setReviewUrl] = useState('https://g.page/r/your-shop/review')
  const [leadSearch, setLeadSearch] = useState('')
  const [showAdsModal, setShowAdsModal] = useState(false)
  const [adsPlatform, setAdsPlatform] = useState<'google' | 'facebook'>('google')
  const [adsCampaignName, setAdsCampaignName] = useState('')
  const [adsBudget, setAdsBudget] = useState('20')
  const [adsKeywords, setAdsKeywords] = useState('oil change Houston, auto repair near me')
  const [adsSaving, setAdsSaving] = useState(false)
  const [postText, setPostText] = useState('')
  const [postPlatforms, setPostPlatforms] = useState(['facebook', 'google'])
  const [postMedia, setPostMedia] = useState<File[]>([])
  const [posting, setPosting] = useState(false)
  const [postHistory, setPostHistory] = useState<Rec[]>([])
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [intelQuery, setIntelQuery] = useState('')
  const [intelResults, setIntelResults] = useState<any>(null)
  const [intelSearching, setIntelSearching] = useState(false)
  const [aiMode, setAiMode] = useState(false)
  const [reportModal, setReportModal] = useState<{ title: string; leads: any[] } | null>(null)
  const [outreachHistory, setOutreachHistory] = useState<Rec[]>([])
  const notify = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => { setToast({ message, type }) }, [])
  const load = useCallback(async () => { setLoading(true); try { const [c, r, l, camp, acts, posts, oh] = await Promise.all([supabase.from('customers').select('*').order('created_at', { ascending: false }), supabase.from('referrals').select('*').order('created_at', { ascending: false }), supabase.from('leads').select('*').order('created_at', { ascending: false }), supabase.from('growth_campaigns').select('*').order('created_at', { ascending: false }), supabase.from('growth_activity').select('*').order('created_at', { ascending: false }).limit(50), supabase.from('social_posts').select('*').order('created_at', { ascending: false }).limit(20), supabase.from('outreach_history').select('*').order('created_at', { ascending: false }).limit(50)]); setCustomers(c.data || []); setReferrals(r.data || []); setLeads(l.data || []); setCampaigns(camp.data || []); setActivityLog(acts.data || []); setPostHistory(posts.data || []); setOutreachHistory(oh.data || []) } catch { notify('Failed to load', 'error') } setLoading(false) }, [notify])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    supabase.from('settings').select('google_review_url').limit(1).single()
      .then(({ data }) => { if (data?.google_review_url) setReviewUrl(data.google_review_url) })
  }, [])
    useEffect(() => { if (tab === 'capture') supabase.from('call_history').select('*').order('start_time', { ascending: false }).limit(50).then(({ data }) => setCallHistory(data || [])) }, [tab])
  const staleCustomers = customers.filter(c => {
    const lastSeen = c.last_contact || c.last_visit || c.created_at
    if (!lastSeen) return true // no date = definitely needs follow-up
    const daysSince = (Date.now() - new Date(lastSeen).getTime()) / 86400000
    return daysSince > 60 // 60 days = 2 months inactive
  })
  const logActivity = async (action: string, target: string, details: string, status: string) => { await supabase.from('growth_activity').insert({ action, target, details, status, created_at: new Date().toISOString() }) }
  const sendSms = async (to: string, message: string) => { const res = await fetch('/api/send-sms', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ to, message }) }); if (!res.ok) throw new Error('SMS failed'); return res.json() }
  const doOutreach = async (leadId: string, method: string) => { setSending(leadId); try { const res = await fetch('/api/growth/outreach', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ lead_id: leadId, method, ai_mode: aiMode }) }); const d = await res.json(); if (d.success) { notify(`${method.toUpperCase()} sent!`, 'success'); await load() } else notify(d.error || 'Failed', 'error') } catch { notify('Outreach failed', 'error') } setSending(null) }
  const sendFollowUp = async (c: Rec) => { if (!c.phone) return notify('No phone', 'error'); setSending(c.id); try { await sendSms(c.phone, `Hi ${c.name?.split(' ')[0] || 'there'}! It's Alpha International Auto Center. Time for a checkup? Reply YES or call (713) 663-6979!`); await supabase.from('customers').update({ last_contact: new Date().toISOString() }).eq('id', c.id); await logActivity('follow_up_sms', c.name, `Sent to ${c.phone}`, 'sent'); notify(`Follow-up sent to ${c.name}`, 'success'); await load() } catch { notify('Failed', 'error') } setSending(null) }
  const bulkFollowUp = async () => { const eligible = staleCustomers.filter(c => c.phone); if (!eligible.length) return notify('No customers with phone', 'error'); if (!confirm(`Send follow-up to ${eligible.length} customers?`)) return; let sent = 0; for (const c of eligible) { try { await sendFollowUp(c); sent++ } catch {} } notify(`Sent ${sent} of ${eligible.length}`, 'success') }
  const requestReview = async (c: Rec) => { if (!c.phone) return notify('No phone', 'error'); setSending(c.id); try { await sendSms(c.phone, `Hi ${c.name?.split(' ')[0]}! Thanks for choosing Alpha International. We'd love your feedback! ${reviewUrl}`); await supabase.from('customers').update({ review_requested: new Date().toISOString() }).eq('id', c.id); await logActivity('review_request', c.name, `Sent to ${c.phone}`, 'sent'); notify(`Review request sent to ${c.name}`, 'success'); await load() } catch { notify('Failed', 'error') } setSending(null) }
  const generateReferral = async (c: Rec) => { const code = `ALPHA-${c.name?.split(' ')[0]?.toUpperCase() || 'REF'}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`; await supabase.from('referrals').insert({ customer_id: c.id, customer_name: c.name, code, discount_percent: 10, uses: 0 }); if (c.phone) await sendSms(c.phone, `Hey ${c.name?.split(' ')[0]}! Share code ${code} with friends - they get 10% off, you get $25 credit!`); await logActivity('referral_created', c.name, `Code: ${code}`, 'active'); notify(`Referral code ${code} created`, 'success'); await load() }
  const captureLead = async () => { if (!captureName.trim()) return notify('Name required', 'error'); await supabase.from('leads').insert({ name: captureName.trim(), phone: capturePhone.trim() || null, service_needed: captureService.trim() || null, source: captureSource, status: 'new', follow_up_date: new Date(Date.now() + 86400000).toISOString().split('T')[0] }); setCaptureName(''); setCapturePhone(''); setCaptureService(''); notify('Lead captured!', 'success'); await load() }
  const importLead = async () => { if (!importName.trim()) return notify('Name required', 'error'); await supabase.from('leads').insert({ name: importName.trim(), phone: importPhone.trim() || null, service_needed: importService.trim() || null, source: importSource, notes: importNotes.trim() || null, status: 'new', follow_up_date: new Date(Date.now() + 86400000).toISOString().split('T')[0] }); setImportName(''); setImportPhone(''); setImportService(''); setImportNotes(''); setShowImportModal(false); notify('Lead imported!', 'success'); await load() }
    const openScanPopup = async (source: string, title: string, scanFn: () => Promise<void>) => { const { data: existing } = await supabase.from('leads').select('*').eq('source', source).order('created_at', { ascending: false }); setReportModal({ title, leads: existing || [] }); scanFn() }
  const aiScanCompetitors = async () => { setScanningCompetitor(true); try { const r = await fetch('/api/growth/ai-competitor-leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ city: 'Houston TX' }) }); const d = await r.json(); if (d.leads?.length) { const fl = await supabase.from('leads').select('*').eq('source', 'ai-competitor-scan').order('created_at', { ascending: false }); setReportModal(prev => prev ? { ...prev, leads: fl.data || [] } : null) } notify(`AI found ${d.total_leads || 0} leads!`, 'success'); await load() } catch { notify('Scan failed', 'error') } setScanningCompetitor(false) }
  const aiScanSocial = async () => { setScanningSocial(true); try { const r = await fetch('/api/growth/ai-social-leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ city: 'Houston TX' }) }); const d = await r.json(); if (d.leads?.length) { const fl = await supabase.from('leads').select('*').eq('source', 'ai-social-scan').order('created_at', { ascending: false }); setReportModal(prev => prev ? { ...prev, leads: fl.data || [] } : null) } notify(`AI found ${d.total_leads || 0} leads!`, 'success'); await load() } catch { notify('Scan failed', 'error') } setScanningSocial(false) }
  const aiScanFleet = async () => { setScanningFleet(true); try { const r = await fetch('/api/growth/ai-fleet-leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ city: 'Houston TX' }) }); const d = await r.json(); if (d.leads?.length) { const fl = await supabase.from('leads').select('*').eq('source', 'ai-fleet-scan').order('created_at', { ascending: false }); setReportModal(prev => prev ? { ...prev, leads: fl.data || [] } : null) } notify(`AI found ${d.total_leads || 0} leads!`, 'success'); await load() } catch { notify('Scan failed', 'error') } setScanningFleet(false) }
  const smartSearch = async () => { if (!intelQuery.trim()) return notify('Enter a search', 'error'); setIntelSearching(true); setIntelResults(null); try { const r = await fetch('/api/growth/smart-search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query: intelQuery.trim() }) }); setIntelResults(await r.json()); notify('Search complete!', 'success') } catch { notify('Search failed', 'error') } setIntelSearching(false) }
  const createSocialPost = async () => { if (!postText.trim()) return notify('Write something', 'error'); if (!postPlatforms.length) return notify('Select platform', 'error'); setPosting(true); try { const r = await fetch('/api/growth/social-post', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: postText.trim(), platforms: postPlatforms }) }); const d = await r.json(); setPostText(''); setPostMedia([]); notify(d.message || 'Posted!', 'success'); await load() } catch { notify('Post failed', 'error') } setPosting(false) }
  const saveAdCampaign = async () => { if (!adsCampaignName.trim()) return notify('Name required', 'error'); setAdsSaving(true); await supabase.from('growth_campaigns').insert({ name: adsCampaignName.trim(), platform: adsPlatform, objective: 'leads', budget_per_day: parseFloat(adsBudget) || 20, keywords: adsKeywords, status: 'draft', spend: 0 }); setAdsCampaignName(''); setAdsBudget('20'); setAdsSaving(false); setShowAdsModal(false); notify('Campaign saved!', 'success'); await load() }
  const filteredLeads = leads.filter(l => !leadSearch || l.name?.toLowerCase().includes(leadSearch.toLowerCase()) || l.phone?.includes(leadSearch))
  const card = 'bg-[#1a2332] border border-white/10 rounded-2xl p-5 shadow-lg'
  const btn = 'px-4 py-2.5 rounded-xl text-sm font-semibold transition-all cursor-pointer'
  const btnP = `${btn} bg-blue-600 text-white hover:bg-blue-500`
  const btnS = `${btn} bg-white/5 text-gray-300 hover:bg-white/10 border border-white/10`
  const btnG = `${btn} bg-emerald-600 text-white hover:bg-emerald-500`
  const inp = 'w-full bg-[#0f1923] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 outline-none'
  const lbl = 'text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block'
  return (<div className="min-h-screen bg-[#0f1923] p-6">
    {toast && <Toast {...toast} onClose={() => setToast(null)} />}
    {reportModal && <DeepResearchModal title={reportModal.title} leads={reportModal.leads} onClose={() => setReportModal(null)} onOutreach={doOutreach} sending={sending} />}
    {showImportModal && <Modal title="Import Lead" onClose={() => setShowImportModal(false)}><div className="space-y-4"><div><label className={lbl}>Name *</label><input className={inp} value={importName} onChange={e => setImportName(e.target.value)} placeholder="John Smith" /></div><div><label className={lbl}>Phone</label><input className={inp} value={importPhone} onChange={e => setImportPhone(e.target.value)} placeholder="(713) 555-0000" /></div><div><label className={lbl}>Service</label><input className={inp} value={importService} onChange={e => setImportService(e.target.value)} placeholder="Oil change..." /></div><div><label className={lbl}>Notes</label><textarea className={inp} rows={2} value={importNotes} onChange={e => setImportNotes(e.target.value)} /></div><button onClick={importLead} className={`${btnG} w-full`}>Save Lead</button></div></Modal>}
    {showAdsModal && <Modal title={`Create ${adsPlatform === 'google' ? 'Google' : 'Facebook'} Campaign`} onClose={() => setShowAdsModal(false)}><div className="space-y-4"><div className="flex gap-2"><button onClick={() => setAdsPlatform('google')} className={`flex-1 py-2 rounded-xl text-sm font-semibold border-2 ${adsPlatform === 'google' ? 'border-blue-500 bg-blue-500/10 text-blue-400' : 'border-white/10 text-gray-400'}`}>Google Ads</button><button onClick={() => setAdsPlatform('facebook')} className={`flex-1 py-2 rounded-xl text-sm font-semibold border-2 ${adsPlatform === 'facebook' ? 'border-blue-500 bg-blue-500/10 text-blue-400' : 'border-white/10 text-gray-400'}`}>Facebook Ads</button></div><div><label className={lbl}>Campaign Name *</label><input className={inp} value={adsCampaignName} onChange={e => setAdsCampaignName(e.target.value)} placeholder="Spring Special" /></div><div><label className={lbl}>Daily Budget ($)</label><input className={inp} type="number" min="5" value={adsBudget} onChange={e => setAdsBudget(e.target.value)} /></div><div className="p-3 bg-yellow-500/10 rounded-xl text-xs text-yellow-300">Saves as draft.</div><button onClick={saveAdCampaign} disabled={adsSaving} className={`${btnP} w-full`}>{adsSaving ? 'Saving...' : 'Save Draft'}</button></div></Modal>}
    <div className="flex items-center justify-between mb-8"><div><h1 className="text-3xl font-bold text-white">Growth Center</h1><p className="text-gray-400 text-sm mt-1">Acquire, retain, and grow your customer base</p></div><div className="flex items-center gap-3"><div className="flex items-center gap-2 bg-[#0f1923] rounded-xl px-4 py-2 border border-white/10"><span className="text-xs text-gray-400">Manual</span><button onClick={() => setAiMode(!aiMode)} className={`relative w-12 h-6 rounded-full transition-all ${aiMode ? 'bg-emerald-600' : 'bg-gray-600'}`}><span className={`absolute top-0.5 ${aiMode ? 'left-6' : 'left-0.5'} w-5 h-5 rounded-full bg-white transition-all shadow`} /></button><span className={`text-xs font-semibold ${aiMode ? 'text-emerald-400' : 'text-gray-400'}`}>AI Autopilot</span></div><button onClick={load} className={btnS} disabled={loading}>{loading ? 'Loading...' : 'Refresh'}</button></div></div>
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">{[{ label: 'Customers', value: customers.length, color: 'text-white' }, { label: 'Need Follow-up', value: staleCustomers.length, color: 'text-amber-400' }, { label: 'Active Referrals', value: referrals.length, color: 'text-emerald-400' }, { label: 'Open Leads', value: leads.filter(l => l.status !== 'converted').length, color: 'text-blue-400' }].map((s, i) => (<div key={i} className={card}><p className="text-xs font-semibold text-gray-400 uppercase">{s.label}</p><p className={`text-3xl font-bold mt-2 ${s.color}`}>{s.value}</p></div>))}</div>
    {activityLog.length > 0 && <div className={`${card} mb-8`}><h3 className="font-bold text-white mb-3">Recent Activity</h3><div className="space-y-1 max-h-32 overflow-y-auto">{activityLog.slice(0, 5).map((a, i) => (<div key={i} className="flex items-center justify-between text-xs py-1.5 border-b border-white/5"><span className="text-gray-300">{a.action?.replace(/_/g, ' ')} - <span className="text-white font-medium">{a.target}</span></span><span className="text-gray-500">{timeAgo(a.created_at)}</span></div>))}</div></div>}
    <div className="flex gap-1 mb-8 bg-[#0f1923] p-1.5 rounded-2xl overflow-x-auto">{TABS.map(t => (<button key={t.key} onClick={() => setTab(t.key)} className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold whitespace-nowrap transition-all ${tab === t.key ? 'bg-blue-600 text-white shadow-lg' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}><span>{t.icon}</span> {t.label}</button>))}</div>
    {tab === 'followups' && <div className={card}><div className="flex items-center justify-between mb-5"><div><h2 className="text-xl font-bold text-white">Automated Follow-ups</h2><p className="text-sm text-gray-400 mt-1">Customers inactive 60+ days</p></div>{staleCustomers.filter(c => c.phone).length > 0 && <button onClick={bulkFollowUp} className={btnP}>Send All ({staleCustomers.filter(c => c.phone).length})</button>}</div>{staleCustomers.length === 0 ? <div className="text-center py-12"><p className="text-gray-400">All customers are active!</p></div> : <div className="space-y-2">{staleCustomers.map(c => (<div key={c.id} className="flex items-center justify-between p-4 bg-[#0f1923] rounded-xl"><div><p className="font-semibold text-white">{c.name}</p><p className="text-xs text-gray-500">{c.phone || 'No phone'} - Last: {timeAgo(c.last_visit || c.created_at)}</p></div><button onClick={() => sendFollowUp(c)} disabled={sending === c.id || !c.phone} className={c.phone ? btnP : btnS}>{sending === c.id ? 'Sending...' : 'Send Text'}</button></div>))}</div>}</div>}
    {tab === 'reviews' && <div className="space-y-5"><div className={card}><div className="flex items-center justify-between mb-4"><div><h2 className="text-xl font-bold text-white">⭐ Your Google Review Link</h2><p className="text-sm text-gray-400 mt-1">Share this link — customers can leave a review in one tap</p></div></div><div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 p-4 bg-[#0f1923] rounded-xl border border-white/10"><span className="flex-1 text-sm text-blue-400 break-all font-mono">{reviewUrl}</span><div className="flex gap-2 flex-shrink-0"><button onClick={() => { navigator.clipboard.writeText(reviewUrl); notify('Link copied!', 'success') }} className={btnS}>📋 Copy</button><a href={reviewUrl} target="_blank" rel="noopener noreferrer" className={btnG}>⭐ Open</a></div></div></div><div className={card}><div className="mb-5"><h2 className="text-xl font-bold text-white">Request Reviews</h2><p className="text-sm text-gray-400 mt-1">Ask happy customers for Google reviews</p></div><div className="space-y-2">{customers.slice(0, 50).map(c => (<div key={c.id} className="flex items-center justify-between p-4 bg-[#0f1923] rounded-xl"><div><p className="font-semibold text-white">{c.name}</p><p className="text-xs text-gray-500">{c.phone || 'No phone'}{c.review_requested ? ` - Requested ${timeAgo(c.review_requested)}` : ''}</p></div><button onClick={() => requestReview(c)} disabled={sending === c.id || !c.phone} className={c.review_requested ? btnS : btnG}>{sending === c.id ? 'Sending...' : c.review_requested ? 'Resend' : 'Ask for Review'}</button></div>))}</div></div></div>}
    {tab === 'referrals' && <div className="space-y-6"><div className={card}><div className="mb-5"><h2 className="text-xl font-bold text-white">Referral System</h2><p className="text-sm text-gray-400 mt-1">Generate codes. They share, everyone saves.</p></div><div className="space-y-2">{customers.slice(0, 30).map(c => { const ex = referrals.find(r => r.customer_id === c.id); return (<div key={c.id} className="flex items-center justify-between p-4 bg-[#0f1923] rounded-xl"><div><p className="font-semibold text-white">{c.name}</p>{ex ? <p className="text-xs text-emerald-400 font-mono">{ex.code} - {ex.uses || 0} uses</p> : <p className="text-xs text-gray-500">{c.phone || 'No phone'}</p>}</div>{ex ? <span className="text-xs bg-emerald-500/20 text-emerald-400 px-3 py-1.5 rounded-lg font-semibold">Active</span> : <button onClick={() => generateReferral(c)} className={btnP}>Generate Code</button>}</div>) })}</div></div></div>}
    {tab === 'leads' && <div className="space-y-6"><div className={card}><div className="flex items-center justify-between mb-5"><div><h2 className="text-xl font-bold text-white">AI Lead Generation</h2><p className="text-sm text-gray-400 mt-1">Deep research on businesses. Click scan - get a full intel report.</p></div>{aiMode && <span className="text-xs bg-emerald-500/20 text-emerald-400 px-3 py-1.5 rounded-lg font-semibold">AI Autopilot ON</span>}</div><div className="grid md:grid-cols-3 gap-4 mb-5"><button className={`p-4 rounded-2xl border-2 border-dashed text-left transition-all ${scanningCompetitor ? 'border-orange-500 bg-orange-500/10' : 'border-orange-500/30 hover:border-orange-500 hover:bg-orange-500/5'}`} onClick={aiScanCompetitors} disabled={scanningCompetitor}><div className="text-2xl mb-2">{scanningCompetitor ? '\u23f3' : '\ud83d\udd25'}</div><h3 className="font-bold text-white text-sm">Steal Competitor Customers</h3><p className="text-xs text-gray-400 mt-1">{scanningCompetitor ? 'Deep researching competitors...' : 'Finds unhappy customers with owner info, reviews & outreach'}</p></button><button className={`p-4 rounded-2xl border-2 border-dashed text-left transition-all ${scanningSocial ? 'border-blue-500 bg-blue-500/10' : 'border-blue-500/30 hover:border-blue-500 hover:bg-blue-500/5'}`} onClick={() => openScanPopup('ai-social-scan', 'Deep Research: Social Media Leads', aiScanSocial)} disabled={scanningSocial}><div className="text-2xl mb-2">{scanningSocial ? '\u23f3' : '\ud83d\udcf1'}</div><h3 className="font-bold text-white text-sm">Find Social Media Leads</h3><p className="text-xs text-gray-400 mt-1">{scanningSocial ? 'Scanning social posts...' : 'Finds people posting about car problems in Houston'}</p></button><button className={`p-4 rounded-2xl border-2 border-dashed text-left transition-all ${scanningFleet ? 'border-emerald-500 bg-emerald-500/10' : 'border-emerald-500/30 hover:border-emerald-500 hover:bg-emerald-500/5'}`} onClick={() => openScanPopup('ai-fleet-scan', 'Deep Research: Fleet Businesses', aiScanFleet)} disabled={scanningFleet}><div className="text-2xl mb-2">{scanningFleet ? '\u23f3' : '\ud83d\ude9a'}</div><h3 className="font-bold text-white text-sm">Find Fleet Businesses</h3><p className="text-xs text-gray-400 mt-1">{scanningFleet ? 'Deep researching 25+ business types...' : 'Owner, fleet size, vehicles, contracts, revenue & more'}</p></button></div><div className="flex gap-3"><input className={inp} placeholder="Search leads..." value={leadSearch} onChange={e => setLeadSearch(e.target.value)} /><button className={btnS} onClick={() => { setImportSource('manual'); setShowImportModal(true) }}>+ Manual</button></div></div>
    <div className={card}><div className="flex items-center justify-between mb-4"><h3 className="font-bold text-white">All Leads ({filteredLeads.length})</h3><button onClick={() => { const aiLeads = filteredLeads.filter(l => ['ai-competitor-scan','ai-social-scan','ai-fleet-scan'].includes(l.source)); if (aiLeads.length) setReportModal({ title: 'All AI Leads - Deep Research', leads: aiLeads }) }} className={btnS}>View Full Report</button></div>{filteredLeads.length === 0 ? <p className="text-gray-500 text-center py-8">No leads yet. Click an AI button above!</p> : <div className="space-y-2">{filteredLeads.map(l => { const isAI = ['ai-competitor-scan', 'ai-social-scan', 'ai-fleet-scan'].includes(l.source); return (<div key={l.id} className="flex items-center justify-between p-4 bg-[#0f1923] rounded-xl"><div className="flex-1 min-w-0"><div className="flex items-center gap-2"><p className="font-semibold text-white truncate">{l.name}</p>{isAI && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-400 font-semibold">AI</span>}<span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${l.status === 'new' ? 'bg-blue-500/20 text-blue-400' : l.status === 'contacted' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-emerald-500/20 text-emerald-400'}`}>{l.status}</span>{l.owner_name && <span className="text-[10px] text-gray-500">{l.owner_name}</span>}</div><p className="text-xs text-gray-500">{l.source?.replace(/-/g, ' ')} - {l.service_needed || 'General'}{l.fleet_size ? ` - ${l.fleet_size} vehicles` : ''}</p></div><div className="flex gap-1.5 ml-3"><button onClick={() => doOutreach(l.id, 'sms')} disabled={sending === l.id || !l.phone} className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold ${l.phone ? 'bg-blue-600 text-white hover:bg-blue-500' : 'bg-white/5 text-gray-500'}`}>{sending === l.id ? '...' : 'SMS'}</button><button onClick={() => doOutreach(l.id, 'email')} disabled={sending === l.id || !l.email} className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold ${l.email ? 'bg-purple-600 text-white hover:bg-purple-500' : 'bg-white/5 text-gray-500'}`}>{sending === l.id ? '...' : 'Email'}</button><button onClick={() => doOutreach(l.id, 'ai_call')} disabled={sending === l.id || !l.phone} className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold ${l.phone ? 'bg-emerald-600 text-white hover:bg-emerald-500' : 'bg-white/5 text-gray-500'}`}>{sending === l.id ? '...' : 'AI Call'}</button></div></div>) })}</div>}</div></div>}
    {tab === 'social' && <div className="space-y-6"><div className={card}><h2 className="text-xl font-bold text-white mb-5">Create Social Post</h2><div className="space-y-4"><div className="flex gap-3 flex-wrap">{['facebook', 'instagram', 'google', 'tiktok'].map(p => (<button key={p} onClick={() => setPostPlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p])} className={`${btn} border-2 capitalize ${postPlatforms.includes(p) ? 'border-blue-500 bg-blue-500/10 text-blue-400' : 'border-white/10 text-gray-400'}`}>{p}</button>))}</div><textarea className={inp} rows={4} value={postText} onChange={e => setPostText(e.target.value)} placeholder="What's happening at Alpha International today?" /><div className="flex items-center gap-3"><input ref={fileInputRef} type="file" multiple accept="image/*,video/*" className="hidden" onChange={e => { if (e.target.files) setPostMedia(Array.from(e.target.files)) }} /><button onClick={() => fileInputRef.current?.click()} className={btnS}>Add Photos ({postMedia.length})</button><button onClick={createSocialPost} disabled={posting} className={`${btnP} ml-auto`}>{posting ? 'Posting...' : 'Post Now'}</button></div></div></div>{postText.trim() && <div className={card}><h3 className="font-bold text-white mb-4">📱 Post Preview</h3><div className="flex gap-4 flex-wrap">{postPlatforms.map(platform => (<div key={platform} className="flex-1 min-w-[200px] max-w-xs bg-[#0f1923] rounded-2xl overflow-hidden border border-white/10"><div className="p-3 border-b border-white/10 flex items-center gap-2"><div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center text-white text-xs font-bold">A</div><div><p className="text-xs font-semibold text-white">Alpha International Auto</p><p className="text-[10px] text-gray-500 capitalize">{platform} · Just now</p></div></div><div className="p-3"><p className="text-sm text-gray-200 whitespace-pre-wrap">{postText}</p>{postMedia.length > 0 && <div className="mt-2 text-xs text-gray-500">{postMedia.length} photo(s) attached</div>}</div><div className="px-3 pb-3 flex gap-3 text-xs text-gray-500"><span>👍 Like</span><span>💬 Comment</span><span>↗️ Share</span></div></div>))}</div></div>}{postHistory.length > 0 && <div className={card}><h3 className="font-bold text-white mb-3">Post History</h3><div className="space-y-2">{postHistory.map((p, i) => (<div key={i} className="p-3 bg-[#0f1923] rounded-xl"><div className="flex justify-between"><span className="text-sm text-white font-medium">{p.platforms?.join(', ')}</span><span className="text-xs text-gray-500">{timeAgo(p.created_at)}</span></div><p className="text-xs text-gray-400 mt-1 line-clamp-2">{p.text}</p></div>))}</div></div>}</div>}
        {tab === 'capture' && <div className="space-y-6"><div className={card}><h2 className="text-lg font-bold mb-4">Walk-in / Call Capture</h2><div className="grid grid-cols-1 sm:grid-cols-2 gap-4"><div><label className="text-xs text-gray-400">NAME *</label><input value={captureName} onChange={e => setCaptureName(e.target.value)} placeholder="John Smith" className="w-full bg-gray-800 rounded p-2 mt-1" /></div><div><label className="text-xs text-gray-400">PHONE</label><input value={capturePhone} onChange={e => setCapturePhone(e.target.value)} placeholder="(713) 555-0000" className="w-full bg-gray-800 rounded p-2 mt-1" /></div><div><label className="text-xs text-gray-400">SERVICE</label><input value={captureService} onChange={e => setCaptureService(e.target.value)} placeholder="Oil change, brakes..." className="w-full bg-gray-800 rounded p-2 mt-1" /></div><div><label className="text-xs text-gray-400">SOURCE</label><select value={captureSource} onChange={e => setCaptureSource(e.target.value)} className="w-full bg-gray-800 rounded p-2 mt-1"><option>Walk-in</option><option>Phone Call</option><option>Facebook</option><option>Google</option></select></div></div><button onClick={captureLead} className="mt-4 bg-teal-600 hover:bg-teal-500 px-6 py-2 rounded font-bold">Capture Lead</button></div><div className={card}><div className="flex items-center justify-between mb-4"><h2 className="text-lg font-bold">Recent Call History</h2><button onClick={() => fetch('/api/telnyx/sync-calls?action=sync').then(() => supabase.from('call_history').select('*').order('start_time', { ascending: false }).limit(50).then(({ data }) => setCallHistory(data || [])))} className="text-xs bg-gray-700 hover:bg-gray-600 px-3 py-1 rounded">Sync Calls</button></div>{callHistory.length === 0 ? <p className="text-gray-500 text-center py-8">No call history yet. Click Sync to pull calls.</p> : <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-gray-400 text-left border-b border-gray-700"><th className="py-2 px-2">Direction</th><th className="py-2 px-2">From</th><th className="py-2 px-2">To</th><th className="py-2 px-2">Duration</th><th className="py-2 px-2">Customer</th><th className="py-2 px-2">Date</th></tr></thead><tbody>{callHistory.map((c: any) => <tr key={c.id} className="border-b border-gray-800 hover:bg-gray-800/50"><td className="py-2 px-2">{c.direction === 'inbound' ? '📞 In' : '📱 Out'}</td><td className="py-2 px-2 text-xs">{c.from_number}</td><td className="py-2 px-2 text-xs">{c.to_number}</td><td className="py-2 px-2">{c.duration_secs ? `${Math.floor(c.duration_secs/60)}:${String(Math.floor(c.duration_secs%60)).padStart(2,'0')}` : '-'}</td><td className="py-2 px-2">{c.matched_customer_name || <span className="text-gray-500">Unknown</span>}</td><td className="py-2 px-2 text-xs text-gray-400">{c.start_time ? new Date(c.start_time).toLocaleString() : '-'}</td></tr>)}</tbody></table></div>}</div></div>}
    {tab === 'intel' && <div className="space-y-6"><div className={card}><h2 className="text-xl font-bold text-white mb-2">Smart Customer Search</h2><p className="text-sm text-gray-400 mb-5">Enter a name - AI investigates social media, phone, email.</p><div className="flex gap-3"><input className={inp} value={intelQuery} onChange={e => setIntelQuery(e.target.value)} placeholder="Enter name, business, or Google reviewer..." onKeyDown={e => e.key === 'Enter' && smartSearch()} /><button onClick={smartSearch} disabled={intelSearching} className={btnP}>{intelSearching ? 'Searching...' : 'Investigate'}</button></div></div>{intelResults && <div className={card}><h3 className="font-bold text-white mb-4">Results: {intelQuery}</h3><div className="space-y-3">{intelResults.results?.map((r: any, i: number) => (<div key={i} className="p-4 bg-[#0f1923] rounded-xl"><div className="flex items-center justify-between mb-2"><span className="text-sm font-semibold text-white">{r.source || 'Web'}</span><span className={`text-xs px-2 py-0.5 rounded ${r.confidence === 'high' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-yellow-500/20 text-yellow-400'}`}>{r.confidence || 'medium'}</span></div>{r.name && <p className="text-sm text-gray-300">Name: {r.name}</p>}{r.phone && <p className="text-sm text-blue-400">Phone: {r.phone}</p>}{r.email && <p className="text-sm text-gray-300">Email: {r.email}</p>}{r.social && <p className="text-sm text-purple-400">Social: {r.social}</p>}</div>)) || <p className="text-gray-500">No results.</p>}</div>{intelResults.summary && <div className="mt-4 p-3 bg-blue-500/10 rounded-xl text-sm text-blue-300">{intelResults.summary}</div>}</div>}</div>}
    {tab === 'ads' && <div className="space-y-6"><div className={card}><h2 className="text-xl font-bold text-white mb-5">Ad Campaigns</h2><div className="grid md:grid-cols-2 gap-4"><div className="p-6 border-2 border-dashed border-white/10 rounded-2xl text-center hover:border-blue-500/50 cursor-pointer" onClick={() => { setAdsPlatform('google'); setShowAdsModal(true) }}><h3 className="font-bold text-white text-lg">Google Ads</h3><p className="text-sm text-gray-400 mt-2">Target Houston searches</p><button className={`${btnP} mt-4`}>Create Campaign</button></div><div className="p-6 border-2 border-dashed border-white/10 rounded-2xl text-center hover:border-blue-500/50 cursor-pointer" onClick={() => { setAdsPlatform('facebook'); setShowAdsModal(true) }}><h3 className="font-bold text-white text-lg">Facebook Ads</h3><p className="text-sm text-gray-400 mt-2">Target Houston drivers</p><button className={`${btnP} mt-4`}>Create Campaign</button></div></div></div>{campaigns.length > 0 && <div className={card}><h3 className="font-bold text-white mb-4">Campaigns ({campaigns.length})</h3><div className="space-y-2">{campaigns.map(c => (<div key={c.id} className="flex items-center justify-between p-4 bg-[#0f1923] rounded-xl"><div><p className="font-semibold text-white">{c.name}</p><p className="text-xs text-gray-500">{c.platform} - <span className={`px-2 py-0.5 rounded text-xs font-semibold ${c.status === 'active' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-yellow-500/20 text-yellow-400'}`}>{c.status}</span></p></div><span className="text-sm text-gray-300">${c.spend || 0}</span></div>))}</div></div>}</div>}
    {tab === 'roi' && <div className="space-y-6">
      <div className={card}>
        <h2 className="text-xl font-bold text-white mb-5">💰 ROI Tracking</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-2">
          {[
            { label: 'Leads Generated', value: leads.length, color: 'text-blue-400' },
            { label: 'Converted', value: leads.filter((l: any) => l.status === 'converted').length, color: 'text-emerald-400' },
            { label: 'Conversion Rate', value: leads.length ? Math.round(leads.filter((l: any) => l.status === 'converted').length / leads.length * 100) + '%' : '0%', color: 'text-yellow-400' },
            { label: 'Active Referrals', value: referrals.length, color: 'text-purple-400' },
          ].map((s, i) => (
            <div key={i} className="bg-[#0f1923] rounded-2xl p-4">
              <p className="text-xs font-semibold text-gray-400 uppercase mb-2">{s.label}</p>
              <p className={"text-3xl font-bold " + s.color}>{s.value}</p>
            </div>
          ))}
        </div>
      </div>
      <div className={card}>
        <h3 className="font-bold text-white mb-4">Lead Sources Breakdown</h3>
        <div className="space-y-3">
          {(() => {
            const srcMap: Record<string, number> = {}
            leads.forEach((l: any) => { const s = l.source || 'manual'; srcMap[s] = (srcMap[s] || 0) + 1 })
            const total = leads.length || 1
            return Object.entries(srcMap).sort((a, b) => (b[1] as number) - (a[1] as number)).map(([source, count]) => (
              <div key={source}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-300 capitalize">{source.replace(/-/g, ' ')}</span>
                  <span className="text-white font-semibold">{count as number} <span className="text-gray-500">({Math.round((count as number)/total*100)}%)</span></span>
                </div>
                <div className="h-2 rounded-full bg-white/5 overflow-hidden">
                  <div className="h-full bg-blue-600 rounded-full transition-all" style={{ width: ((count as number)/total*100) + '%' }} />
                </div>
              </div>
            ))
          })()}
          {leads.length === 0 && <p className="text-gray-500 text-center py-4">No leads yet. Generate from the Lead Gen tab!</p>}
        </div>
      </div>
      <div className={card}>
        <h3 className="font-bold text-white mb-4">Outreach Performance</h3>
        <div className="grid grid-cols-3 gap-4 mb-4">
          {[
            { label: 'SMS Sent', value: outreachHistory.filter((o: any) => o.method === 'sms').length, color: 'text-blue-400' },
            { label: 'Emails Sent', value: outreachHistory.filter((o: any) => o.method === 'email').length, color: 'text-purple-400' },
            { label: 'AI Calls', value: outreachHistory.filter((o: any) => o.method === 'ai_call').length, color: 'text-emerald-400' },
          ].map((s, i) => (
            <div key={i} className="bg-[#0f1923] rounded-xl p-3 text-center">
              <p className={"text-2xl font-bold " + s.color}>{s.value}</p>
              <p className="text-xs text-gray-400 mt-1">{s.label}</p>
            </div>
          ))}
        </div>
        {outreachHistory.length === 0 && <p className="text-gray-500 text-center py-4">No outreach history yet. Send outreach from Lead Gen to track.</p>}
        {outreachHistory.length > 0 && (
          <div className="space-y-1 max-h-48 overflow-y-auto mt-2">
            {outreachHistory.slice(0, 20).map((o: any, i: number) => (
              <div key={i} className="flex items-center justify-between p-2.5 bg-[#0f1923] rounded-lg text-xs">
                <span className="text-gray-300">{o.lead_name || o.target || 'Lead'}</span>
                <span className={"px-2 py-0.5 rounded font-semibold " + (o.method === 'sms' ? 'bg-blue-500/20 text-blue-400' : o.method === 'email' ? 'bg-purple-500/20 text-purple-400' : 'bg-emerald-500/20 text-emerald-400')}>{o.method}</span>
                <span className="text-gray-500">{timeAgo(o.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className={card}>
        <h3 className="font-bold text-white mb-4">Campaign Summary</h3>
        <div className="grid grid-cols-2 gap-4">
          {[
            { label: 'Customers Needing Follow-up', value: staleCustomers.length, color: 'text-amber-400' },
            { label: 'Activity Logged', value: activityLog.length, color: 'text-white' },
            { label: 'Total Customers', value: customers.length, color: 'text-blue-400' },
            { label: 'Ad Campaigns', value: campaigns.length, color: 'text-emerald-400' },
          ].map((s, i) => (
            <div key={i} className="bg-[#0f1923] rounded-xl p-4">
              <p className="text-xs text-gray-400 uppercase mb-1">{s.label}</p>
              <p className={"text-3xl font-bold " + s.color}>{s.value}</p>
            </div>
          ))}
        </div>
      </div>
    </div>}

    </div>)
}

