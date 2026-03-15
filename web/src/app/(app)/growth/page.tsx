'use client'
import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

type Rec = Record<string, any>
// supabase imported from @/lib/supabase

function timeAgo(d: string) {
  if (!d) return 'Never'
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days} days ago`
  if (days < 365) return `${Math.floor(days / 30)} months ago`
  return `${Math.floor(days / 365)}y ago`
}

type Tab = 'followups' | 'reviews' | 'referrals' | 'leads' | 'capture' | 'ads'
const TABS: { key: Tab; label: string; icon: string }[] = [
  { key: 'followups', label: 'Follow-ups', icon: '🔁' },
  { key: 'reviews', label: 'Reviews', icon: '⭐' },
  { key: 'referrals', label: 'Referrals', icon: '🤝' },
  { key: 'leads', label: 'Lead Gen', icon: '🎯' },
  { key: 'capture', label: 'Capture', icon: '📞' },
  { key: 'ads', label: 'Ads', icon: '📢' },
]

export default function GrowthPage() {
  const [tab, setTab] = useState<Tab>('followups')
  const [customers, setCustomers] = useState<Rec[]>([])
  const [referrals, setReferrals] = useState<Rec[]>([])
  const [leads, setLeads] = useState<Rec[]>([])
  const [campaigns, setCampaigns] = useState<Rec[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState<string | null>(null)
  // Capture form
  const [captureName, setCaptureName] = useState('')
  const [capturePhone, setCapturePhone] = useState('')
  const [captureService, setCaptureService] = useState('')
  const [captureSource, setCaptureSource] = useState('walk-in')
  // Review request
  const [reviewMsg, setReviewMsg] = useState('')

  const load = async () => {
    setLoading(true)
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
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // Get stale customers (no visit in 6+ months)
  const staleCustomers = customers.filter(c => {
    if (!c.last_visit && !c.created_at) return false
    const last = new Date(c.last_visit || c.created_at)
    return (Date.now() - last.getTime()) > 180 * 86400000
  })

  // Send follow-up text to stale customer
  const sendFollowUp = async (c: Rec) => {
    if (!c.phone) return alert('No phone number')
    setSending(c.id)
    try {
      const name = c.name?.split(' ')[0] || 'there'
      const msg = `Hi ${name}! It's Alpha International Auto Center. It's been a while since your last visit. Time for an oil change or checkup? Reply YES to book or call us at (713) 555-0123!`
      await fetch('/api/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: c.phone, message: msg })
      })
      await supabase.from('customers').update({ last_contact: new Date().toISOString() }).eq('id', c.id)
      alert(`Sent to ${c.name}`)
      await load()
    } catch { alert('Failed to send') }
    setSending(null)
  }

  // Bulk follow-up
  const bulkFollowUp = async () => {
    if (!confirm(`Send follow-up texts to ${staleCustomers.filter(c => c.phone).length} customers?`)) return
    for (const c of staleCustomers.filter(c => c.phone)) {
      await sendFollowUp(c)
    }
  }

  // Request Google review from customer
  const requestReview = async (c: Rec) => {
    if (!c.phone) return alert('No phone number')
    setSending(c.id)
    try {
      const name = c.name?.split(' ')[0] || 'there'
      const msg = `Hi ${name}! Thanks for choosing Alpha International Auto Center. We'd love your feedback! Please leave us a Google review: https://g.page/r/YOUR_GOOGLE_REVIEW_LINK/review`
      await fetch('/api/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: c.phone, message: msg })
      })
      await supabase.from('customers').update({ review_requested: new Date().toISOString() }).eq('id', c.id)
      alert(`Review request sent to ${c.name}`)
      await load()
    } catch { alert('Failed to send') }
    setSending(null)
  }

  // Generate referral code for customer
  const generateReferral = async (c: Rec) => {
    const code = `ALPHA-${c.name?.split(' ')[0]?.toUpperCase() || 'REF'}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
    await supabase.from('referrals').insert({
      customer_id: c.id,
      customer_name: c.name,
      code,
      discount_percent: 10,
      uses: 0,
      created_at: new Date().toISOString()
    })
    if (c.phone) {
      await fetch('/api/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: c.phone, message: `Hey ${c.name?.split(' ')[0]}! Share your referral code ${code} with friends. They get 10% off their first visit at Alpha International, and you get $25 credit for each referral!` })
      })
    }
    alert(`Referral code ${code} created`)
    await load()
  }

  // Capture walk-in / call lead
  const captureLead = async () => {
    if (!captureName.trim()) return alert('Name is required')
    await supabase.from('leads').insert({
      name: captureName.trim(),
      phone: capturePhone.trim() || null,
      service_needed: captureService.trim() || null,
      source: captureSource,
      status: 'new',
      follow_up_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
      created_at: new Date().toISOString()
    })
    setCaptureName(''); setCapturePhone(''); setCaptureService('')
    alert('Lead captured!')
    await load()
  }

  // Follow up on a lead
  const followUpLead = async (lead: Rec) => {
    if (!lead.phone) return alert('No phone number for this lead')
    setSending(lead.id)
    try {
      const msg = `Hi ${lead.name?.split(' ')[0] || 'there'}! This is Alpha International Auto Center. You recently inquired about ${lead.service_needed || 'auto repair'}. We'd love to get you scheduled! Reply or call us at (713) 555-0123.`
      await fetch('/api/send-sms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: lead.phone, message: msg })
      })
      await supabase.from('leads').update({ status: 'contacted', last_contact: new Date().toISOString() }).eq('id', lead.id)
      await load()
    } catch { alert('Failed to send') }
    setSending(null)
  }

  // Styles
  const card = 'bg-white border rounded-xl p-4 shadow-sm'
  const btn = 'px-4 py-2 rounded-lg text-sm font-medium transition-colors'
  const btnPrimary = `${btn} bg-blue-600 text-white hover:bg-blue-700`
  const btnSecondary = `${btn} bg-gray-100 text-gray-700 hover:bg-gray-200`
  const btnSuccess = `${btn} bg-green-600 text-white hover:bg-green-700`
  const input = 'w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500'

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Customer Growth</h1>
          <p className="text-gray-500 text-sm">Acquire, retain, and grow your customer base</p>
        </div>
        <button onClick={load} className={btnSecondary} disabled={loading}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <div className={card}>
          <p className="text-xs text-gray-500">Total Customers</p>
          <p className="text-2xl font-bold">{customers.length}</p>
        </div>
        <div className={card}>
          <p className="text-xs text-gray-500">Need Follow-up</p>
          <p className="text-2xl font-bold text-orange-600">{staleCustomers.length}</p>
        </div>
        <div className={card}>
          <p className="text-xs text-gray-500">Active Referrals</p>
          <p className="text-2xl font-bold text-green-600">{referrals.length}</p>
        </div>
        <div className={card}>
          <p className="text-xs text-gray-500">Open Leads</p>
          <p className="text-2xl font-bold text-blue-600">{leads.filter(l => l.status !== 'converted').length}</p>
        </div>
      </div>

      {/* Tab Navigation */}
      <div className="flex gap-1 mb-6 bg-gray-100 p-1 rounded-xl overflow-x-auto">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              tab === t.key ? 'bg-white shadow text-blue-700' : 'text-gray-600 hover:text-gray-900'
            }`}>
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* FOLLOW-UPS TAB */}
      {tab === 'followups' && (
        <div className={card}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Automated Follow-ups</h2>
            {staleCustomers.filter(c => c.phone).length > 0 && (
              <button onClick={bulkFollowUp} className={btnPrimary}>
                Send All ({staleCustomers.filter(c => c.phone).length})
              </button>
            )}
          </div>
          <p className="text-sm text-gray-500 mb-4">Customers who haven't visited in 6+ months. Re-engage them with a text.</p>
          {staleCustomers.length === 0 ? (
            <p className="text-gray-400 text-center py-8">All customers are active!</p>
          ) : (
            <div className="space-y-2">
              {staleCustomers.map(c => (
                <div key={c.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-sm">{c.name}</p>
                    <p className="text-xs text-gray-500">{c.phone || 'No phone'} &middot; Last visit: {timeAgo(c.last_visit || c.created_at)}</p>
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
          <h2 className="text-lg font-semibold mb-4">Review & Reputation</h2>
          <p className="text-sm text-gray-500 mb-4">Ask happy customers for Google reviews. Select customers to send a review request.</p>
          <div className="space-y-2">
            {customers.slice(0, 50).map(c => (
              <div key={c.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                <div>
                  <p className="font-medium text-sm">{c.name}</p>
                  <p className="text-xs text-gray-500">
                    {c.phone || 'No phone'}
                    {c.review_requested && ` · Review requested ${timeAgo(c.review_requested)}`}
                  </p>
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
        <div className="space-y-4">
          <div className={card}>
            <h2 className="text-lg font-semibold mb-4">Referral System</h2>
            <p className="text-sm text-gray-500 mb-4">Generate referral codes for customers. They share with friends, everyone saves.</p>
            <div className="space-y-2">
              {customers.slice(0, 30).map(c => {
                const existing = referrals.find(r => r.customer_id === c.id)
                return (
                  <div key={c.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div>
                      <p className="font-medium text-sm">{c.name}</p>
                      {existing ? (
                        <p className="text-xs text-green-600 font-mono">{existing.code} &middot; {existing.uses || 0} uses</p>
                      ) : (
                        <p className="text-xs text-gray-500">{c.phone || 'No phone'}</p>
                      )}
                    </div>
                    {existing ? (
                      <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded">Active</span>
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
              <h3 className="font-semibold mb-3">All Referral Codes</h3>
              <div className="space-y-2">
                {referrals.map(r => (
                  <div key={r.id} className="flex items-center justify-between p-2 border-b">
                    <div>
                      <span className="font-mono text-sm text-blue-600">{r.code}</span>
                      <span className="text-xs text-gray-500 ml-2">by {r.customer_name}</span>
                    </div>
                    <span className="text-sm">{r.uses || 0} referrals &middot; {r.discount_percent}% off</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* LEAD GEN TAB */}
      {tab === 'leads' && (
        <div className="space-y-4">
          <div className={card}>
            <h2 className="text-lg font-semibold mb-4">Lead Generation & Outreach</h2>
            <p className="text-sm text-gray-500 mb-4">Find people in Houston who need auto repair. Track and follow up on leads.</p>
            <div className="grid md:grid-cols-3 gap-3 mb-4">
              <button className={btnPrimary} onClick={() => alert('Coming soon: Scrape Google reviews of competitor shops to find unhappy customers')}>Scan Competitor Reviews</button>
              <button className={btnPrimary} onClick={() => alert('Coming soon: Monitor Facebook/Nextdoor for car trouble posts in Houston')}>Monitor Social Posts</button>
              <button className={btnPrimary} onClick={() => alert('Coming soon: Find Houston businesses with fleet vehicles needing service')}>Find Fleet Leads</button>
            </div>
          </div>
          <div className={card}>
            <h3 className="font-semibold mb-3">All Leads ({leads.length})</h3>
            {leads.length === 0 ? (
              <p className="text-gray-400 text-center py-8">No leads yet. Capture walk-ins or run outreach above.</p>
            ) : (
              <div className="space-y-2">
                {leads.map(l => (
                  <div key={l.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div>
                      <p className="font-medium text-sm">{l.name}</p>
                      <p className="text-xs text-gray-500">
                        {l.source} &middot; {l.service_needed || 'General'} &middot;
                        <span className={`ml-1 px-1.5 py-0.5 rounded text-xs ${l.status === 'new' ? 'bg-blue-100 text-blue-700' : l.status === 'contacted' ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>{l.status}</span>
                      </p>
                    </div>
                    <button onClick={() => followUpLead(l)} disabled={sending === l.id || !l.phone}
                      className={l.phone ? btnPrimary : btnSecondary}>
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
        <div className="space-y-4">
          <div className={card}>
            <h2 className="text-lg font-semibold mb-4">Walk-in / Call Capture</h2>
            <p className="text-sm text-gray-500 mb-4">When someone calls or walks in, capture their info. AI will follow up if they don't book.</p>
            <div className="grid md:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600">Name *</label>
                <input className={input} value={captureName} onChange={e => setCaptureName(e.target.value)} placeholder="John Smith" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Phone</label>
                <input className={input} value={capturePhone} onChange={e => setCapturePhone(e.target.value)} placeholder="(713) 555-0000" />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Service Needed</label>
                <input className={input} value={captureService} onChange={e => setCaptureService(e.target.value)} placeholder="Oil change, brake repair, etc." />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Source</label>
                <select className={input} value={captureSource} onChange={e => setCaptureSource(e.target.value)}>
                  <option value="walk-in">Walk-in</option>
                  <option value="phone">Phone Call</option>
                  <option value="facebook">Facebook</option>
                  <option value="google">Google</option>
                  <option value="referral">Referral</option>
                  <option value="other">Other</option>
                </select>
              </div>
            </div>
            <button onClick={captureLead} className={`${btnSuccess} mt-4 w-full`}>Capture Lead</button>
          </div>
          <div className={card}>
            <h3 className="font-semibold mb-3">Recent Captures</h3>
            <div className="space-y-2">
              {leads.filter(l => ['walk-in', 'phone'].includes(l.source)).map(l => (
                <div key={l.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div>
                    <p className="font-medium text-sm">{l.name}</p>
                    <p className="text-xs text-gray-500">{l.source} &middot; {l.service_needed || 'General'} &middot; {timeAgo(l.created_at)}</p>
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
        <div className="space-y-4">
          <div className={card}>
            <h2 className="text-lg font-semibold mb-4">Google/Facebook Ad Automation</h2>
            <p className="text-sm text-gray-500 mb-4">Auto-generate and manage ads targeting Houston drivers.</p>
            <div className="grid md:grid-cols-2 gap-4">
              <div className="p-4 border-2 border-dashed rounded-xl text-center">
                <p className="text-3xl mb-2">Google</p>
                <h3 className="font-semibold">Google Ads</h3>
                <p className="text-sm text-gray-500 mt-1">Target Houston searches for auto repair, oil change, brake service</p>
                <button className={`${btnPrimary} mt-3`} onClick={() => alert('Coming soon: Auto-generate Google Ads campaigns targeting Houston auto repair keywords')}>Create Campaign</button>
              </div>
              <div className="p-4 border-2 border-dashed rounded-xl text-center">
                <p className="text-3xl mb-2">Facebook</p>
                <h3 className="font-semibold">Facebook Ads</h3>
                <p className="text-sm text-gray-500 mt-1">Target Houston drivers with special offers and seasonal promotions</p>
                <button className={`${btnPrimary} mt-3`} onClick={() => alert('Coming soon: Auto-generate Facebook Ads with AI-created images and copy')}>Create Campaign</button>
              </div>
            </div>
          </div>
          {campaigns.length > 0 && (
            <div className={card}>
              <h3 className="font-semibold mb-3">Campaign History</h3>
              <div className="space-y-2">
                {campaigns.map(c => (
                  <div key={c.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <div>
                      <p className="font-medium text-sm">{c.name}</p>
                      <p className="text-xs text-gray-500">{c.platform} &middot; {c.status} &middot; {timeAgo(c.created_at)}</p>
                    </div>
                    <span className="text-sm font-medium">${c.spend || 0} spent</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
