'use client'
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

type Rec = Record<string, any>

const GOOGLE_REVIEW_URL = 'https://g.page/r/CSSKpJahtMmSEBM/review'

// ── Toast notification system ────────────────────────────────────────────
function Toast({ message, type, onClose }: { message: string; type: 'success' | 'error' | 'info'; onClose: () => void }) {
  useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t) }, [onClose])
  const bg = type === 'success' ? 'bg-emerald-500' : type === 'error' ? 'bg-red-500' : 'bg-blue-500'
  return (
    <div className={`fixed top-4 right-4 z-[100] ${bg} text-white px-5 py-3 rounded-xl shadow-2xl flex items-center gap-3 animate-slide-in max-w-sm`}>
      <span className="text-lg">{type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ'}</span>
      <span className="text-sm font-medium">{message}</span>
      <button onClick={onClose} className="ml-auto text-white/70 hover:text-white text-lg">×</button>
    </div>
  )
}

function timeAgo(d: string) {
  if (!d) return 'Never'
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  return `${Math.floor(days / 365)}y ago`
}

type Tab = 'followups' | 'reviews' | 'referrals' | 'leads' | 'capture' | 'ads'
const TABS: { key: Tab; label: string; icon: string; desc: string }[] = [
  { key: 'followups', label: 'Follow-ups', icon: '\ud83d\udd01', desc: 'Re-engage inactive customers' },
  { key: 'reviews',   label: 'Reviews',    icon: '⭐', desc: 'Build your reputation' },
  { key: 'referrals', label: 'Referrals',  icon: '\ud83e\udd1d', desc: 'Turn customers into promoters' },
  { key: 'leads',     label: 'Lead Gen',   icon: '\ud83c\udfaf', desc: 'Find and convert new leads' },
  { key: 'capture',   label: 'Capture',    icon: '\ud83d\udcde', desc: 'Log walk-ins and calls' },
  { key: 'ads',       label: 'Ads',        icon: '\ud83d\udce2', desc: 'Run ad campaigns' },
]

// ── Modal ──────────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-[#1e2a3a] rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto border border-white/10" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-white/10">
          <h2 className="text-lg font-bold text-white">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl leading-none">×</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  )
}

export default function GrowthPage() {
  const [tab, setTab] = useState<Tab>('followups')
  const [customers, setCustomers] = useState<Rec[]>([])
  const [referrals, setReferrals] = useState<Rec[]>([])
  const [leads, setLeads] = useState<Rec[]>([])
  const [campaigns, setCampaigns] = useState<Rec[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState<string | null>(null)
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null)
  const [scanning, setScanning] = useState(false)

  // Capture form
  const [captureName, setCaptureName] = useState('')
  const [capturePhone, setCapturePhone] = useState('')
  const [captureService, setCaptureService] = useState('')
  const [captureSource, setCaptureSource] = useState('walk-in')

  // Lead import modal
  const [showImportModal, setShowImportModal] = useState(false)
  const [importName, setImportName] = useState('')
  const [importPhone, setImportPhone] = useState('')
  const [importService, setImportService] = useState('')
  const [importSource, setImportSource] = useState('manual')
  const [importNotes, setImportNotes] = useState('')
  const [leadSearch, setLeadSearch] = useState('')

  // Ads modal
  const [showAdsModal, setShowAdsModal] = useState(false)
  const [adsPlatform, setAdsPlatform] = useState<'google' | 'facebook'>('google')
  const [adsCampaignName, setAdsCampaignName] = useState('')
  const [adsBudget, setAdsBudget] = useState('20')
  const [adsObjective, setAdsObjective] = useState('leads')
  const [adsKeywords, setAdsKeywords] = useState('oil change Houston, auto repair near me, brake service Houston')
  const [adsSaving, setAdsSaving] = useState(false)

  const notify = useCallback((message: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToast({ message, type })
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [c, r, l, camp] = await Promise.all([
        supabase.from('customers').select('*').order('created_at', { ascending: false }),
        supabase.from('referrals').select('*').order('created_at', { ascending: false }),
        supabase.from('leads').select('*').order('created_at', { ascending: false }),
        supabase.from('growth_campaigns').select('*').order('created_at', { ascending: false }),
      ])
      setCustomers(c.data || [])
      setReferrals(r.data || [])
      setLeads(l.data || [])
      setCampaigns(camp.data || [])
    } catch { notify('Failed to load data', 'error') }
    setLoading(false)
  }, [notify])

  useEffect(() => { load() }, [load])

  const staleCustomers = customers.filter(c => {
    if (!c.last_visit && !c.created_at) return false
    const last = new Date(c.last_visit || c.created_at)
    return (Date.now() - last.getTime()) > 180 * 86400000
  })

  const sendSms = async (to: string, message: string) => {
    const res = await fetch('/api/send-sms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, message })
    })
    if (!res.ok) throw new Error('SMS failed')
    return res.json()
  }

  const sendFollowUp = async (c: Rec) => {
    if (!c.phone) return notify('No phone number', 'error')
    setSending(c.id)
    try {
      const name = c.name?.split(' ')[0] || 'there'
      await sendSms(c.phone, `Hi ${name}! It's Alpha International Auto Center. Been a while since your last visit — time for a checkup? Reply YES to book or call (713) 663-6979!`)
      await supabase.from('customers').update({ last_contact: new Date().toISOString() }).eq('id', c.id)
      notify(`Follow-up sent to ${c.name}`, 'success')
      await load()
    } catch { notify('Failed to send', 'error') }
    setSending(null)
  }

  const bulkFollowUp = async () => {
    const eligible = staleCustomers.filter(c => c.phone)
    if (!eligible.length) return notify('No customers with phone numbers', 'error')
    if (!confirm(`Send follow-up to ${eligible.length} customers?`)) return
    let sent = 0
    for (const c of eligible) {
      try { await sendFollowUp(c); sent++ } catch {}
    }
    notify(`Sent ${sent} of ${eligible.length} follow-ups`, 'success')
  }

  const requestReview = async (c: Rec) => {
    if (!c.phone) return notify('No phone number', 'error')
    setSending(c.id)
    try {
      const name = c.name?.split(' ')[0] || 'there'
      await sendSms(c.phone, `Hi ${name}! Thanks for choosing Alpha International Auto Center. We'd love your feedback! ${GOOGLE_REVIEW_URL}`)
      await supabase.from('customers').update({ review_requested: new Date().toISOString() }).eq('id', c.id)
      notify(`Review request sent to ${c.name}`, 'success')
      await load()
    } catch { notify('Failed to send', 'error') }
    setSending(null)
  }

  const generateReferral = async (c: Rec) => {
    const code = `ALPHA-${c.name?.split(' ')[0]?.toUpperCase() || 'REF'}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
    await supabase.from('referrals').insert({ customer_id: c.id, customer_name: c.name, code, discount_percent: 10, uses: 0 })
    if (c.phone) {
      await sendSms(c.phone, `Hey ${c.name?.split(' ')[0]}! Share code ${code} with friends — they get 10% off, you get $25 credit at Alpha International!`)
    }
    notify(`Referral code ${code} created`, 'success')
    await load()
  }

  const captureLead = async () => {
    if (!captureName.trim()) return notify('Name is required', 'error')
    await supabase.from('leads').insert({
      name: captureName.trim(), phone: capturePhone.trim() || null,
      service_needed: captureService.trim() || null, source: captureSource,
      status: 'new', follow_up_date: new Date(Date.now() + 86400000).toISOString().split('T')[0]
    })
    setCaptureName(''); setCapturePhone(''); setCaptureService('')
    notify('Lead captured!', 'success')
    await load()
  }

  const followUpLead = async (lead: Rec) => {
    if (!lead.phone) return notify('No phone for this lead', 'error')
    setSending(lead.id)
    try {
      await sendSms(lead.phone, `Hi ${lead.name?.split(' ')[0] || 'there'}! This is Alpha International Auto Center. You inquired about ${lead.service_needed || 'auto repair'}. Ready to schedule? Call us at (713) 663-6979!`)
      await supabase.from('leads').update({ status: 'contacted', last_contact: new Date().toISOString() }).eq('id', lead.id)
      notify(`Followed up with ${lead.name}`, 'success')
      await load()
    } catch { notify('Failed to send', 'error') }
    setSending(null)
  }

  const importLead = async () => {
    if (!importName.trim()) return notify('Name is required', 'error')
    await supabase.from('leads').insert({
      name: importName.trim(), phone: importPhone.trim() || null,
      service_needed: importService.trim() || null, source: importSource,
      notes: importNotes.trim() || null, status: 'new',
      follow_up_date: new Date(Date.now() + 86400000).toISOString().split('T')[0]
    })
    setImportName(''); setImportPhone(''); setImportService(''); setImportNotes('')
    setShowImportModal(false)
    notify('Lead imported!', 'success')
    await load()
  }

  const scanCompetitors = async () => {
    setScanning(true)
    try {
      const r = await fetch('/api/growth/scan-competitors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'auto repair shop Houston TX', radius: 15000 })
      })
      const d = await r.json()
      notify(`Scan complete! Found ${d.total || 0} competitors, ${d.low_review_leads || 0} unhappy customers`, 'success')
      await load()
    } catch { notify('Scan failed — check API key', 'error') }
    setScanning(false)
  }

  const saveAdCampaign = async () => {
    if (!adsCampaignName.trim()) return notify('Campaign name required', 'error')
    setAdsSaving(true)
    await supabase.from('growth_campaigns').insert({
      name: adsCampaignName.trim(), platform: adsPlatform, objective: adsObjective,
      budget_per_day: parseFloat(adsBudget) || 20, keywords: adsKeywords, status: 'draft', spend: 0
    })
    setAdsCampaignName(''); setAdsBudget('20'); setAdsObjective('leads')
    setAdsSaving(false); setShowAdsModal(false)
    notify(`Campaign saved as draft!`, 'success')
    await load()
  }

  const filteredLeads = leads.filter(l =>
    !leadSearch || l.name?.toLowerCase().includes(leadSearch.toLowerCase()) ||
    l.phone?.includes(leadSearch) || l.service_needed?.toLowerCase().includes(leadSearch.toLowerCase())
  )

  // Styles
  const card = 'bg-[#1a2332] border border-white/10 rounded-2xl p-5 shadow-lg'
  const btn = 'px-4 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 cursor-pointer'
  const btnPrimary = `${btn} bg-blue-600 text-white hover:bg-blue-500 hover:shadow-lg hover:shadow-blue-600/25`
  const btnSecondary = `${btn} bg-white/5 text-gray-300 hover:bg-white/10 border border-white/10`
  const btnSuccess = `${btn} bg-emerald-600 text-white hover:bg-emerald-500 hover:shadow-lg hover:shadow-emerald-600/25`
  const btnDanger = `${btn} bg-red-600/20 text-red-400 hover:bg-red-600/30`
  const input = 'w-full bg-[#0f1923] border border-white/10 rounded-xl px-4 py-2.5 text-sm text-white placeholder-gray-500 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none'
  const label = 'text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1.5 block'

  return (
    <div className="min-h-screen">
      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      {/* Modals */}
      {showImportModal && (
        <Modal title="Import New Lead" onClose={() => setShowImportModal(false)}>
          <div className="space-y-4">
            <div><label className={label}>Full Name *</label><input className={input} value={importName} onChange={e => setImportName(e.target.value)} placeholder="John Smith" /></div>
            <div><label className={label}>Phone</label><input className={input} value={importPhone} onChange={e => setImportPhone(e.target.value)} placeholder="(713) 555-0000" /></div>
            <div><label className={label}>Service Needed</label><input className={input} value={importService} onChange={e => setImportService(e.target.value)} placeholder="Oil change, brakes..." /></div>
            <div><label className={label}>Source</label>
              <select className={input} value={importSource} onChange={e => setImportSource(e.target.value)}>
                <option value="manual">Manual Import</option><option value="facebook">Facebook</option>
                <option value="nextdoor">Nextdoor</option><option value="google">Google</option>
                <option value="referral">Referral</option><option value="competitor">Competitor Review</option>
                <option value="fleet">Fleet Lead</option><option value="other">Other</option>
              </select>
            </div>
            <div><label className={label}>Notes</label><textarea className={input} rows={3} value={importNotes} onChange={e => setImportNotes(e.target.value)} placeholder="Extra context..." /></div>
            <button onClick={importLead} className={`${btnSuccess} w-full`}>Save Lead</button>
          </div>
        </Modal>
      )}

      {showAdsModal && (
        <Modal title={`Create ${adsPlatform === 'google' ? 'Google' : 'Facebook'} Ad Campaign`} onClose={() => setShowAdsModal(false)}>
          <div className="space-y-4">
            <div className="flex gap-2">
              <button onClick={() => setAdsPlatform('google')} className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all ${adsPlatform === 'google' ? 'border-blue-500 bg-blue-500/10 text-blue-400' : 'border-white/10 text-gray-400'}`}>Google Ads</button>
              <button onClick={() => setAdsPlatform('facebook')} className={`flex-1 py-2.5 rounded-xl text-sm font-semibold border-2 transition-all ${adsPlatform === 'facebook' ? 'border-blue-500 bg-blue-500/10 text-blue-400' : 'border-white/10 text-gray-400'}`}>Facebook Ads</button>
            </div>
            <div><label className={label}>Campaign Name *</label><input className={input} value={adsCampaignName} onChange={e => setAdsCampaignName(e.target.value)} placeholder="Spring Oil Change Special" /></div>
            <div><label className={label}>Objective</label>
              <select className={input} value={adsObjective} onChange={e => setAdsObjective(e.target.value)}>
                <option value="leads">Lead Generation</option><option value="traffic">Website Traffic</option>
                <option value="calls">Phone Calls</option><option value="awareness">Brand Awareness</option>
              </select>
            </div>
            <div><label className={label}>Daily Budget ($)</label><input className={input} type="number" min="5" value={adsBudget} onChange={e => setAdsBudget(e.target.value)} /></div>
            {adsPlatform === 'google' && (<div><label className={label}>Target Keywords</label><textarea className={input} rows={3} value={adsKeywords} onChange={e => setAdsKeywords(e.target.value)} /><p className="text-xs text-gray-500 mt-1">Comma-separated keywords for Google Ads</p></div>)}
            {adsPlatform === 'facebook' && (<div className="p-3 bg-blue-500/10 rounded-xl text-xs text-blue-300">Campaign will target Houston-area drivers aged 22-65</div>)}
            <div className="p-3 bg-yellow-500/10 rounded-xl text-xs text-yellow-300">Saves as draft. Activate from your {adsPlatform === 'google' ? 'Google Ads' : 'Meta Ads Manager'} dashboard.</div>
            <button onClick={saveAdCampaign} disabled={adsSaving} className={`${btnPrimary} w-full`}>{adsSaving ? 'Saving...' : 'Save Campaign Draft'}</button>
          </div>
        </Modal>
      )}

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">Growth Center</h1>
          <p className="text-gray-400 text-sm mt-1">Acquire, retain, and grow your customer base</p>
        </div>
        <button onClick={load} className={btnSecondary} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {[
          { label: 'Total Customers', value: customers.length, color: 'text-white', icon: '\ud83d\udc65' },
          { label: 'Need Follow-up', value: staleCustomers.length, color: 'text-amber-400', icon: '⏰' },
          { label: 'Active Referrals', value: referrals.length, color: 'text-emerald-400', icon: '\ud83e\udd1d' },
          { label: 'Open Leads', value: leads.filter(l => l.status !== 'converted').length, color: 'text-blue-400', icon: '\ud83c\udfaf' },
        ].map((s, i) => (
          <div key={i} className={card}>
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{s.label}</p>
              <span className="text-2xl">{s.icon}</span>
            </div>
            <p className={`text-3xl font-bold mt-2 ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 mb-8 bg-[#0f1923] p-1.5 rounded-2xl overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-5 py-3 rounded-xl text-sm font-semibold whitespace-nowrap transition-all ${
              tab === t.key ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/25' : 'text-gray-400 hover:text-white hover:bg-white/5'
            }`}>
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* FOLLOW-UPS TAB */}
      {tab === 'followups' && (
        <div className={card}>
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-xl font-bold text-white">Automated Follow-ups</h2>
              <p className="text-sm text-gray-400 mt-1">Customers inactive 6+ months. Re-engage with one click.</p>
            </div>
            {staleCustomers.filter(c => c.phone).length > 0 && (
              <button onClick={bulkFollowUp} className={btnPrimary}>
                Send All ({staleCustomers.filter(c => c.phone).length})
              </button>
            )}
          </div>
          {staleCustomers.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-4xl mb-3">✅</p>
              <p className="text-gray-400 font-medium">All customers are active!</p>
              <p className="text-gray-500 text-sm mt-1">No one needs a follow-up right now</p>
            </div>
          ) : (
            <div className="space-y-2">
              {staleCustomers.map(c => (
                <div key={c.id} className="flex items-center justify-between p-4 bg-[#0f1923] rounded-xl hover:bg-[#162030] transition-colors">
                  <div>
                    <p className="font-semibold text-white">{c.name}</p>
                    <p className="text-xs text-gray-500">{c.phone || 'No phone'} · Last: {timeAgo(c.last_visit || c.created_at)}</p>
                  </div>
                  <button onClick={() => sendFollowUp(c)} disabled={sending === c.id || !c.phone}
                    className={c.phone ? btnPrimary : btnSecondary}>
                    {sending === c.id ? 'Sending...' : 'Send Text'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* REVIEWS TAB */}
      {tab === 'reviews' && (
        <div className={card}>
          <div className="mb-5">
            <h2 className="text-xl font-bold text-white">Reviews & Reputation</h2>
            <p className="text-sm text-gray-400 mt-1">Ask happy customers for Google reviews to boost your ranking.</p>
          </div>
          <div className="space-y-2">
            {customers.slice(0, 50).map(c => (
              <div key={c.id} className="flex items-center justify-between p-4 bg-[#0f1923] rounded-xl hover:bg-[#162030] transition-colors">
                <div>
                  <p className="font-semibold text-white">{c.name}</p>
                  <p className="text-xs text-gray-500">{c.phone || 'No phone'}{c.review_requested ? ` · Requested ${timeAgo(c.review_requested)}` : ''}</p>
                </div>
                <button onClick={() => requestReview(c)} disabled={sending === c.id || !c.phone}
                  className={c.review_requested ? btnSecondary : btnSuccess}>
                  {sending === c.id ? 'Sending...' : c.review_requested ? 'Resend' : 'Ask for Review'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* REFERRALS TAB */}
      {tab === 'referrals' && (
        <div className="space-y-6">
          <div className={card}>
            <div className="mb-5">
              <h2 className="text-xl font-bold text-white">Referral System</h2>
              <p className="text-sm text-gray-400 mt-1">Generate codes for customers. They share, everyone saves.</p>
            </div>
            <div className="space-y-2">
              {customers.slice(0, 30).map(c => {
                const existing = referrals.find(r => r.customer_id === c.id)
                return (
                  <div key={c.id} className="flex items-center justify-between p-4 bg-[#0f1923] rounded-xl hover:bg-[#162030] transition-colors">
                    <div>
                      <p className="font-semibold text-white">{c.name}</p>
                      {existing ? (
                        <p className="text-xs text-emerald-400 font-mono">{existing.code} · {existing.uses || 0} uses</p>
                      ) : (
                        <p className="text-xs text-gray-500">{c.phone || 'No phone'}</p>
                      )}
                    </div>
                    {existing ? (
                      <span className="text-xs bg-emerald-500/20 text-emerald-400 px-3 py-1.5 rounded-lg font-semibold">Active</span>
                    ) : (
                      <button onClick={() => generateReferral(c)} className={btnPrimary}>Generate Code</button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
          {referrals.length > 0 && (
            <div className={card}>
              <h3 className="font-bold text-white mb-4">All Referral Codes</h3>
              <div className="space-y-2">
                {referrals.map(r => (
                  <div key={r.id} className="flex items-center justify-between p-3 border-b border-white/5">
                    <div>
                      <span className="font-mono text-sm text-blue-400">{r.code}</span>
                      <span className="text-xs text-gray-500 ml-2">by {r.customer_name}</span>
                    </div>
                    <span className="text-sm text-gray-300">{r.uses || 0} referrals · {r.discount_percent}% off</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* LEAD GEN TAB */}
      {tab === 'leads' && (
        <div className="space-y-6">
          <div className={card}>
            <div className="mb-5">
              <h2 className="text-xl font-bold text-white">Lead Generation & Outreach</h2>
              <p className="text-sm text-gray-400 mt-1">Track, import, and follow up on all leads.</p>
            </div>
            <div className="grid md:grid-cols-4 gap-3 mb-5">
              <button className={`${btn} bg-gradient-to-r from-orange-600 to-red-600 text-white hover:opacity-90`} onClick={() => { setImportSource('competitor'); setImportNotes('Found via competitor Google review'); setShowImportModal(true) }}>Import Competitor Lead</button>
              <button className={`${btn} bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:opacity-90`} onClick={() => { setImportSource('facebook'); setImportNotes('Found via social media'); setShowImportModal(true) }}>Import Social Lead</button>
              <button className={`${btn} bg-gradient-to-r from-emerald-600 to-teal-600 text-white hover:opacity-90`} onClick={() => { setImportSource('fleet'); setImportNotes('Houston business with fleet vehicles'); setShowImportModal(true) }}>Import Fleet Lead</button>
              <button className={`${btn} bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:opacity-90`} onClick={scanCompetitors} disabled={scanning}>
                {scanning ? 'Scanning...' : 'AI Scan Competitors'}
              </button>
            </div>
            <div className="flex gap-3">
              <input className={input} placeholder="Search leads by name, phone, service..." value={leadSearch} onChange={e => setLeadSearch(e.target.value)} />
              <button className={btnSuccess} onClick={() => { setImportSource('manual'); setImportNotes(''); setShowImportModal(true) }}>+ Add Lead</button>
            </div>
          </div>
          <div className={card}>
            <h3 className="font-bold text-white mb-4">All Leads ({filteredLeads.length}{leadSearch ? ` of ${leads.length}` : ''})</h3>
            {filteredLeads.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-4xl mb-3">\ud83d\udcad</p>
                <p className="text-gray-400">{leadSearch ? 'No leads match your search.' : 'No leads yet. Import or scan to get started.'}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredLeads.map(l => (
                  <div key={l.id} className="flex items-center justify-between p-4 bg-[#0f1923] rounded-xl hover:bg-[#162030] transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-white truncate">{l.name}</p>
                      <p className="text-xs text-gray-500 truncate">
                        {l.source} · {l.service_needed || 'General'} ·{' '}
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                          l.status === 'new' ? 'bg-blue-500/20 text-blue-400' : l.status === 'contacted' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-emerald-500/20 text-emerald-400'
                        }`}>{l.status}</span>
                        {l.notes && <span className="ml-1 text-gray-600 italic"> · {l.notes}</span>}
                      </p>
                    </div>
                    <button onClick={() => followUpLead(l)} disabled={sending === l.id || !l.phone}
                      className={`ml-3 ${l.phone ? btnPrimary : btnSecondary}`}>
                      {sending === l.id ? 'Sending...' : 'Follow Up'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* CAPTURE TAB */}
      {tab === 'capture' && (
        <div className="space-y-6">
          <div className={card}>
            <div className="mb-5">
              <h2 className="text-xl font-bold text-white">Walk-in / Call Capture</h2>
              <p className="text-sm text-gray-400 mt-1">Log anyone who calls or walks in. AI follows up if they don't book.</p>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div><label className={label}>Name *</label><input className={input} value={captureName} onChange={e => setCaptureName(e.target.value)} placeholder="John Smith" /></div>
              <div><label className={label}>Phone</label><input className={input} value={capturePhone} onChange={e => setCapturePhone(e.target.value)} placeholder="(713) 555-0000" /></div>
              <div><label className={label}>Service Needed</label><input className={input} value={captureService} onChange={e => setCaptureService(e.target.value)} placeholder="Oil change, brakes..." /></div>
              <div><label className={label}>Source</label>
                <select className={input} value={captureSource} onChange={e => setCaptureSource(e.target.value)}>
                  <option value="walk-in">Walk-in</option><option value="phone">Phone Call</option>
                  <option value="facebook">Facebook</option><option value="google">Google</option>
                  <option value="referral">Referral</option><option value="other">Other</option>
                </select>
              </div>
            </div>
            <button onClick={captureLead} className={`${btnSuccess} mt-5 w-full`}>Capture Lead</button>
          </div>
          <div className={card}>
            <h3 className="font-bold text-white mb-4">Recent Captures</h3>
            <div className="space-y-2">
              {leads.filter(l => ['walk-in', 'phone'].includes(l.source)).length === 0 ? (
                <p className="text-gray-500 text-center py-8">No walk-in or phone captures yet.</p>
              ) : leads.filter(l => ['walk-in', 'phone'].includes(l.source)).map(l => (
                <div key={l.id} className="flex items-center justify-between p-4 bg-[#0f1923] rounded-xl hover:bg-[#162030] transition-colors">
                  <div>
                    <p className="font-semibold text-white">{l.name}</p>
                    <p className="text-xs text-gray-500">{l.source} · {l.service_needed || 'General'} · {timeAgo(l.created_at)}</p>
                  </div>
                  <button onClick={() => followUpLead(l)} disabled={!l.phone || sending === l.id}
                    className={l.phone ? btnPrimary : btnSecondary}>
                    {sending === l.id ? 'Sending...' : 'Follow Up'}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ADS TAB */}
      {tab === 'ads' && (
        <div className="space-y-6">
          <div className={card}>
            <div className="mb-5">
              <h2 className="text-xl font-bold text-white">Ad Campaigns</h2>
              <p className="text-sm text-gray-400 mt-1">Create campaign drafts targeting Houston drivers.</p>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="p-6 border-2 border-dashed border-white/10 rounded-2xl text-center hover:border-blue-500/50 transition-colors cursor-pointer" onClick={() => { setAdsPlatform('google'); setShowAdsModal(true) }}>
                <p className="text-4xl mb-3">\ud83d\udd0d</p>
                <h3 className="font-bold text-white text-lg">Google Ads</h3>
                <p className="text-sm text-gray-400 mt-2">Target Houston searches: oil change, auto repair, brake service</p>
                <button className={`${btnPrimary} mt-4`}>Create Campaign</button>
              </div>
              <div className="p-6 border-2 border-dashed border-white/10 rounded-2xl text-center hover:border-blue-500/50 transition-colors cursor-pointer" onClick={() => { setAdsPlatform('facebook'); setShowAdsModal(true) }}>
                <p className="text-4xl mb-3">\ud83d\udcd8</p>
                <h3 className="font-bold text-white text-lg">Facebook Ads</h3>
                <p className="text-sm text-gray-400 mt-2">Target Houston drivers with special offers and promotions</p>
                <button className={`${btnPrimary} mt-4`}>Create Campaign</button>
              </div>
            </div>
          </div>
          {campaigns.length > 0 ? (
            <div className={card}>
              <h3 className="font-bold text-white mb-4">Campaign History ({campaigns.length})</h3>
              <div className="space-y-2">
                {campaigns.map(c => (
                  <div key={c.id} className="flex items-center justify-between p-4 bg-[#0f1923] rounded-xl">
                    <div>
                      <p className="font-semibold text-white">{c.name}</p>
                      <p className="text-xs text-gray-500">
                        {c.platform} ·{' '}
                        <span className={`inline-block px-2 py-0.5 rounded text-xs font-semibold ${
                          c.status === 'active' ? 'bg-emerald-500/20 text-emerald-400' : c.status === 'draft' ? 'bg-yellow-500/20 text-yellow-400' : 'bg-white/10 text-gray-400'
                        }`}>{c.status}</span>
                        {' '}· {timeAgo(c.created_at)}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-gray-300">${c.spend || 0} spent</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className={card}>
              <p className="text-gray-500 text-center py-8">No campaigns yet. Create your first one above!</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
