'use client'
import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import Link from 'next/link'
import { getShopId, getShopProfile, supabase } from '@/lib/supabase'
import { phonePretty } from '@/lib/today'
import Icon from '@/components/Icon'
import Sheet from '@/components/Sheet'
import { EmptyBlock, ErrorCard, RowsSkeleton, SearchField } from '@/components/ListKit'
import { ScreenToast, Segmented, Switch, useToast } from '@/components/ScreenParts'
import LeadReport, { OutreachButtons } from './LeadReport'
import type { OutreachMethod } from './LeadReport'
import { AI_SOURCES, cityFromProfile, firstName, getAuthJsonHeaders, isAiLead, leadStatus, sourceLabel, timeAgo } from './helpers'
import type { Rec } from './helpers'

type Tab = 'followups' | 'reviews' | 'referrals' | 'leads' | 'posts' | 'results'
const TABS: { key: Tab; label: string }[] = [
  { key: 'followups', label: 'Follow-ups' },
  { key: 'reviews', label: 'Reviews' },
  { key: 'referrals', label: 'Referrals' },
  { key: 'leads', label: 'Leads' },
  { key: 'posts', label: 'Posts and ads' },
  { key: 'results', label: 'Results' },
]

type ScanKind = 'competitor' | 'social' | 'fleet'
const SCANS: Record<ScanKind, { source: string; endpoint: string; title: string; icon: string; hint: string; failure: string }> = {
  competitor: { source: 'ai-competitor-scan', endpoint: '/api/growth/ai-competitor-leads', title: 'Unhappy customers of other shops', icon: 'frown', hint: 'Looking at nearby shops and their reviews. This takes about a minute.', failure: 'The search did not finish' },
  social: { source: 'ai-social-scan', endpoint: '/api/growth/ai-social-leads', title: 'People posting about car trouble', icon: 'inbox', hint: 'Reading recent social posts. This takes about a minute.', failure: 'The search did not finish' },
  fleet: { source: 'ai-fleet-scan', endpoint: '/api/growth/ai-fleet-leads', title: 'Businesses with vehicle fleets', icon: 'vehicle', hint: 'Researching local businesses that run vehicles. This takes about a minute.', failure: 'The search did not finish' },
}

const PLATFORMS = [
  { key: 'facebook', label: 'Facebook' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'google', label: 'Google' },
  { key: 'tiktok', label: 'TikTok' },
]

const LEAD_SOURCES = [
  { value: 'Walk-in', label: 'Walk-in' },
  { value: 'Phone Call', label: 'Phone call' },
  { value: 'Facebook', label: 'Facebook' },
  { value: 'Google', label: 'Google' },
  { value: 'manual', label: 'Something else' },
]

const DAY = 86400000
const PAGE = 50

function Stat({ label, value, lamp, onClick }: { label: string; value: number | string; lamp?: 'amber' | 'green'; onClick?: () => void }) {
  const body = (
    <>
      <span className="block text-[0.8125rem] font-bold leading-tight text-text-secondary">{label}</span>
      <span className="mt-1 flex items-center gap-1.5">
        {lamp && <span className={`lamp lamp-${lamp}`} aria-hidden="true" />}
        <span className="display num text-[1.5rem] font-bold leading-none">{value}</span>
      </span>
    </>
  )
  const cls = 'block min-h-[4.5rem] w-full px-3 py-3 text-left'
  return onClick
    ? <button type="button" onClick={onClick} className={`${cls} hover:bg-bg-hover`}>{body}</button>
    : <div className={cls}>{body}</div>
}

function Section({ title, hint, action, children }: { title: string; hint?: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-6 first:mt-0">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="section-title">{title}</h2>
          {hint && <p className="mt-0.5 text-[0.9375rem] text-text-secondary">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

export default function GrowthPage() {
  const [tab, setTab] = useState<Tab>('followups')
  const [customers, setCustomers] = useState<Rec[]>([])
  const [referrals, setReferrals] = useState<Rec[]>([])
  const [leads, setLeads] = useState<Rec[]>([])
  const [campaigns, setCampaigns] = useState<Rec[]>([])
  const [activityLog, setActivityLog] = useState<Rec[]>([])
  const [postHistory, setPostHistory] = useState<Rec[]>([])
  const [outreachHistory, setOutreachHistory] = useState<Rec[]>([])
  const [callHistory, setCallHistory] = useState<Rec[]>([])
  const [callState, setCallState] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle')
  const [syncingCalls, setSyncingCalls] = useState(false)
  const [loading, setLoading] = useState(true)
  const [fatal, setFatal] = useState<string | null>(null)
  const [failed, setFailed] = useState<Record<string, boolean>>({})
  const [sending, setSending] = useState<string | null>(null)
  const [bulk, setBulk] = useState(false)
  const [scanning, setScanning] = useState<ScanKind | null>(null)
  const { toast, notify, dismiss } = useToast()

  const [shop, setShop] = useState<{ name: string; phone: string; reviewUrl: string; state: 'loading' | 'ready' | 'error' }>({ name: '', phone: '', reviewUrl: '', state: 'loading' })
  const [city, setCity] = useState<{ search: string; label: string } | null>(null)

  const [custSearch, setCustSearch] = useState('')
  const [custLimit, setCustLimit] = useState(PAGE)
  const [leadSearch, setLeadSearch] = useState('')
  const [callsOpen, setCallsOpen] = useState(false)
  const [aiMode, setAiMode] = useState(false)

  const [report, setReport] = useState<{ title: string; sources: string[]; scan: ScanKind | null } | null>(null)

  // Add a lead
  const [showAddLead, setShowAddLead] = useState(false)
  const [leadForm, setLeadForm] = useState({ name: '', phone: '', service: '', source: 'Walk-in', notes: '' })
  const [leadTried, setLeadTried] = useState(false)
  const [leadSaving, setLeadSaving] = useState(false)

  // Ads
  const [showAds, setShowAds] = useState(false)
  const [adsPlatform, setAdsPlatform] = useState<'google' | 'facebook'>('google')
  const [adsName, setAdsName] = useState('')
  const [adsBudget, setAdsBudget] = useState('20')
  const [adsKeywords, setAdsKeywords] = useState('')
  const [adsTried, setAdsTried] = useState(false)
  const [adsSaving, setAdsSaving] = useState(false)

  // Social post
  const [showPost, setShowPost] = useState(false)
  const [postText, setPostText] = useState('')
  const [postPlatforms, setPostPlatforms] = useState(['facebook', 'google'])
  const [postMedia, setPostMedia] = useState<File[]>([])
  const [posting, setPosting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Look up a person
  const [showLookup, setShowLookup] = useState(false)
  const [intelQuery, setIntelQuery] = useState('')
  const [intelResults, setIntelResults] = useState<Rec | null>(null)
  const [intelSearching, setIntelSearching] = useState(false)

  const cityLabel = city?.label || 'your area'

  // ── Loading ──────────────────────────────────────────────────────────────

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoading(true)
    try {
      const shopId = await getShopId()
      if (!shopId) { setFatal('We could not find your shop. Refresh, or sign out and back in.'); return }
      const [c, r, l, camp, acts, posts, oh] = await Promise.all([
        supabase.from('customers').select('*').eq('shop_id', shopId).order('created_at', { ascending: false }),
        supabase.from('referrals').select('*').eq('shop_id', shopId).order('created_at', { ascending: false }),
        supabase.from('leads').select('*').eq('shop_id', shopId).order('created_at', { ascending: false }),
        supabase.from('growth_campaigns').select('*').eq('shop_id', shopId).order('created_at', { ascending: false }),
        supabase.from('growth_activity').select('*').eq('shop_id', shopId).order('created_at', { ascending: false }).limit(50),
        supabase.from('social_posts').select('*').eq('shop_id', shopId).order('created_at', { ascending: false }).limit(20),
        supabase.from('outreach_history').select('*').eq('shop_id', shopId).order('created_at', { ascending: false }).limit(50),
      ])
      // Keep what we already had for anything that failed, and say so instead of showing an empty list.
      if (!c.error) setCustomers(c.data || [])
      if (!r.error) setReferrals(r.data || [])
      if (!l.error) setLeads(l.data || [])
      if (!camp.error) setCampaigns(camp.data || [])
      if (!acts.error) setActivityLog(acts.data || [])
      if (!posts.error) setPostHistory(posts.data || [])
      if (!oh.error) setOutreachHistory(oh.data || [])
      setFailed({ customers: !!c.error, referrals: !!r.error, leads: !!l.error, campaigns: !!camp.error, activity: !!acts.error, posts: !!posts.error, outreach: !!oh.error })
      setFatal(null)
    } catch {
      setFatal('Your customers and leads could not load. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const loadShop = useCallback(async () => {
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('No shop')
      const { data, error } = await supabase.from('settings').select('shop_name,shop_phone,google_review_url').eq('shop_id', shopId).limit(1).maybeSingle()
      if (error) throw error
      setShop({ name: data?.shop_name || '', phone: data?.shop_phone || '', reviewUrl: data?.google_review_url || '', state: 'ready' })
    } catch {
      setShop(s => ({ ...s, state: 'error' }))
    }
  }, [])
  useEffect(() => { void loadShop() }, [loadShop])

  useEffect(() => {
    let cancelled = false
    getShopProfile().then(p => { const c = cityFromProfile(p?.city_state_zip); if (!cancelled && c) setCity(c) }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const loadCalls = useCallback(async () => {
    setCallState('loading')
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('No shop')
      const { data, error } = await supabase.from('call_history').select('*').eq('shop_id', shopId).order('start_time', { ascending: false }).limit(50)
      if (error) throw error
      setCallHistory(data || [])
      setCallState('ready')
    } catch {
      setCallState('error')
    }
  }, [])
  useEffect(() => { if (tab === 'leads' && callState === 'idle') void loadCalls() }, [tab, callState, loadCalls])

  // ── Derived ──────────────────────────────────────────────────────────────

  const staleCustomers = useMemo(() => customers.filter(c => {
    const lastSeen = c.last_contact || c.last_visit || c.created_at
    if (!lastSeen) return true // no date = definitely needs follow-up
    const daysSince = (Date.now() - new Date(lastSeen).getTime()) / DAY
    return daysSince > 60 // 60 days = 2 months inactive
  }), [customers])
  const stalePhones = useMemo(() => staleCustomers.filter(c => c.phone), [staleCustomers])
  const openLeads = useMemo(() => leads.filter(l => l.status !== 'converted').length, [leads])
  const filteredLeads = useMemo(() => {
    const q = leadSearch.trim().toLowerCase()
    return leads.filter(l => !q || l.name?.toLowerCase().includes(q) || l.phone?.includes(leadSearch.trim()))
  }, [leads, leadSearch])
  const matchingCustomers = useMemo(() => {
    const q = custSearch.trim().toLowerCase()
    return customers.filter(c => !q || c.name?.toLowerCase().includes(q) || String(c.phone || '').includes(custSearch.trim()))
  }, [customers, custSearch])
  const reportLeads = useMemo(() => (report ? leads.filter(l => report.sources.includes(l.source)) : []), [report, leads])
  const busy = sending !== null || bulk

  const followUpText = (name?: unknown, shopName = shop.name || 'Our shop', shopPhone = shop.phone) =>
    'Hi ' + firstName(name) + '! It is time for a checkup at ' + shopName + '. Reply YES or call' + (shopPhone ? ' ' + shopPhone : ' us') + '.'

  const changeTab = (next: Tab) => { setTab(next); setCustSearch(''); setCustLimit(PAGE) }

  // ── Actions ──────────────────────────────────────────────────────────────

  const logActivity = async (action: string, target: string, details: string, status: string) => {
    const shopId = await getShopId()
    if (!shopId) throw new Error('No shop is associated with the signed-in user')
    const { error } = await supabase.from('growth_activity').insert({ shop_id: shopId, action, target, details, status, created_at: new Date().toISOString() })
    if (error) throw new Error(error.message)
  }
  const sendSms = async (to: string, message: string) => {
    const res = await fetch('/api/send-sms', { method: 'POST', headers: await getAuthJsonHeaders(), body: JSON.stringify({ to, message }) })
    if (!res.ok) throw new Error('The text did not send')
    return res.json()
  }

  /** Sends one follow-up text. Returns null on success or the problem. */
  const sendFollowUp = async (c: Rec, quiet = false): Promise<string | null> => {
    if (!c.phone) { if (!quiet) notify(`${c.name} has no phone number.`, 'error'); return 'No phone number' }
    setSending(`fu:${c.id}`)
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('No shop is associated with the signed-in user')
      const { data: settings, error: settingsError } = await supabase.from('settings').select('shop_name,shop_phone').eq('shop_id', shopId).maybeSingle()
      if (settingsError) throw settingsError
      const shopName = settings?.shop_name || 'Our shop'
      const shopPhone = settings?.shop_phone || ''
      await sendSms(c.phone, followUpText(c.name, shopName, shopPhone))
      const { error } = await supabase.from('customers').update({ last_contact: new Date().toISOString() }).eq('id', c.id).eq('shop_id', shopId)
      if (error) throw error
      await logActivity('follow_up_sms', c.name, 'Sent to ' + c.phone, 'sent')
      if (!quiet) { notify(`Text sent to ${c.name}.`, 'success'); await load({ quiet: true }) }
      return null
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The text did not send'
      if (!quiet) notify(`${c.name} was not texted: ${message}.`, 'error')
      return message
    } finally { setSending(null) }
  }

  const textOne = async (c: Rec) => {
    if (!window.confirm(`Text ${c.name} at ${phonePretty(c.phone)}?\n\n"${followUpText(c.name)}"`)) return
    await sendFollowUp(c)
  }

  const bulkFollowUp = async () => {
    const eligible = stalePhones
    if (!eligible.length) return notify('None of these customers has a phone number.', 'error')
    const label = `${eligible.length} ${eligible.length === 1 ? 'customer' : 'customers'}`
    if (!window.confirm(`Text ${label} who have not visited in 60 days?\n\nEach one gets:\n"${followUpText('[first name]')}"\n\nThis sends real text messages.`)) return
    setBulk(true)
    let sent = 0
    let firstProblem = ''
    for (const c of eligible) {
      const problem = await sendFollowUp(c, true)
      if (problem === null) sent++
      else if (!firstProblem) firstProblem = problem
    }
    setBulk(false)
    await load({ quiet: true })
    if (sent === eligible.length) notify(`Sent ${sent} ${sent === 1 ? 'text' : 'texts'}.`, 'success')
    else notify(`Sent ${sent} of ${eligible.length} texts. ${firstProblem ? 'First problem: ' + firstProblem + '.' : ''}`, 'error')
  }

  const reviewReady = shop.state === 'ready' && !!shop.reviewUrl
  const requestReview = async (c: Rec) => {
    if (!c.phone) return notify(`${c.name} has no phone number.`, 'error')
    if (!shop.reviewUrl) return notify('Add your Google review link in Settings first.', 'error')
    if (!window.confirm(`Text your review link to ${c.name} at ${phonePretty(c.phone)}?\n\n"Hi ${firstName(c.name)}! Thanks for choosing us. We would love your feedback: ${shop.reviewUrl}"`)) return
    setSending(`rv:${c.id}`)
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('No shop is associated with the signed-in user')
      await sendSms(c.phone, 'Hi ' + firstName(c.name) + '! Thanks for choosing us. We would love your feedback: ' + shop.reviewUrl)
      const { error } = await supabase.from('customers').update({ review_requested: new Date().toISOString() }).eq('id', c.id).eq('shop_id', shopId)
      if (error) throw error
      await logActivity('review_request', c.name, 'Sent to ' + c.phone, 'sent')
      notify(`Review link sent to ${c.name}.`, 'success')
      await load({ quiet: true })
    } catch (error) {
      notify(`${c.name} was not texted: ${error instanceof Error ? error.message : 'the text did not send'}.`, 'error')
    } finally { setSending(null) }
  }

  const copyReviewLink = async () => {
    try { await navigator.clipboard.writeText(shop.reviewUrl); notify('Review link copied.', 'success') }
    catch { notify('The link could not be copied. Press and hold it to copy.', 'error') }
  }

  const generateReferral = async (c: Rec) => {
    const code = `ALPHA-${c.name?.split(' ')[0]?.toUpperCase() || 'REF'}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
    const note = c.phone ? `\n\nThen text them: "Hey ${firstName(c.name)}! Share code ${code} with friends - they get 10% off, you get $25 credit!"` : '\n\nThey have no phone number, so nothing will be texted.'
    if (!window.confirm(`Create a referral code for ${c.name}?${note}`)) return
    const shopId = await getShopId()
    if (!shopId) return notify('We could not find your shop. Refresh, or sign out and back in.', 'error')
    setSending(`rf:${c.id}`)
    try {
      const { error } = await supabase.from('referrals').insert({ shop_id: shopId, customer_id: c.id, customer_name: c.name, code, discount_percent: 10, uses: 0 })
      if (error) return notify(`The code was not created: ${error.message}`, 'error')
      if (c.phone) await sendSms(c.phone, `Hey ${c.name?.split(' ')[0]}! Share code ${code} with friends - they get 10% off, you get $25 credit!`)
      await logActivity('referral_created', c.name, `Code: ${code}`, 'active')
      notify(c.phone ? `Code ${code} created and texted to ${c.name}.` : `Code ${code} created for ${c.name}.`, 'success')
      await load({ quiet: true })
    } catch (error) {
      notify(`The code was created, but the text did not send: ${error instanceof Error ? error.message : 'unknown problem'}.`, 'error')
      await load({ quiet: true })
    } finally { setSending(null) }
  }

  const outreach = async (l: Rec, method: OutreachMethod) => {
    const who = l.name || 'this lead'
    const ask = method === 'sms' ? `Text ${who} at ${phonePretty(l.phone)}?` : method === 'email' ? `Email ${who} at ${l.email}?` : `Have Alpha phone ${who} at ${phonePretty(l.phone)} now?`
    const what = method === 'ai_call' ? 'Alpha will place the call right away.' : aiMode ? 'Alpha will write the message for you.' : 'This sends our standard message.'
    if (!window.confirm(`${ask}\n\n${what}`)) return
    setSending(`${l.id}:${method}`)
    try {
      const res = await fetch('/api/growth/outreach', { method: 'POST', headers: await getAuthJsonHeaders(), body: JSON.stringify({ lead_id: l.id, method, ai_mode: aiMode }) })
      const d = await res.json()
      if (res.ok && d.success === true) {
        notify(method === 'sms' ? `Text sent to ${who}.` : method === 'email' ? `Email sent to ${who}.` : `Alpha is calling ${who}.`, 'success')
        await load({ quiet: true })
      } else notify(`${who} was not contacted: ${d.error || 'something went wrong'}.`, 'error')
    } catch { notify(`${who} was not contacted. Check your connection and try again.`, 'error') }
    setSending(null)
  }

  const openAddLead = (source = 'Walk-in') => { setLeadForm({ name: '', phone: '', service: '', source, notes: '' }); setLeadTried(false); setShowAddLead(true) }
  const addLead = async () => {
    setLeadTried(true)
    if (!leadForm.name.trim()) return
    const shopId = await getShopId()
    if (!shopId) return notify('We could not find your shop. Refresh, or sign out and back in.', 'error')
    setLeadSaving(true)
    const { error } = await supabase.from('leads').insert({
      shop_id: shopId, name: leadForm.name.trim(), phone: leadForm.phone.trim() || null, service_needed: leadForm.service.trim() || null,
      source: leadForm.source, notes: leadForm.notes.trim() || null, status: 'new', follow_up_date: new Date(Date.now() + DAY).toISOString().split('T')[0],
    })
    setLeadSaving(false)
    if (error) return notify(`The lead was not saved: ${error.message}`, 'error')
    setShowAddLead(false)
    notify(`${leadForm.name.trim()} was added to your leads.`, 'success')
    await load({ quiet: true })
  }

  const runScan = async (kind: ScanKind) => {
    const scan = SCANS[kind]
    setReport({ title: scan.title, sources: [scan.source], scan: kind })
    setScanning(kind)
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('We could not find your shop')
      const r = await fetch(scan.endpoint, { method: 'POST', headers: await getAuthJsonHeaders(), body: JSON.stringify({ city: city?.search || 'Houston TX' }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || d.error) throw new Error(d.error || scan.failure)
      const n = d.total_leads || 0
      notify(n ? `Alpha found ${n} ${n === 1 ? 'lead' : 'leads'}.` : 'Alpha did not find any new leads this time.', n ? 'success' : 'info')
      await load({ quiet: true })
    } catch (error) {
      notify(`${error instanceof Error ? error.message : scan.failure}. Try again in a few minutes.`, 'error')
    } finally { setScanning(null) }
  }

  const lookUp = async () => {
    if (!intelQuery.trim()) return notify('Type a name or business to look up.', 'error')
    setIntelSearching(true)
    setIntelResults(null)
    try {
      const r = await fetch('/api/growth/smart-search', { method: 'POST', headers: await getAuthJsonHeaders(), body: JSON.stringify({ query: intelQuery.trim() }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || d.error) throw new Error(d.error || 'The search failed')
      setIntelResults(d)
    } catch (error) {
      notify(`${error instanceof Error ? error.message : 'The search failed'}. Try again.`, 'error')
    } finally { setIntelSearching(false) }
  }

  const syncCalls = async () => {
    setSyncingCalls(true)
    try {
      const response = await fetch('/api/telnyx/sync-calls?action=sync', { headers: await getAuthJsonHeaders() })
      if (!response.ok) { const detail = await response.json().catch(() => ({})); throw new Error(detail.error || 'Call sync failed') }
      await loadCalls()
      notify('Calls are up to date.', 'success')
    } catch (error) {
      notify(`${error instanceof Error ? error.message : 'Call sync failed'}. Try again.`, 'error')
    }
    setSyncingCalls(false)
  }

  const createSocialPost = async () => {
    if (!postText.trim()) return notify('Write something for the post first.', 'error')
    if (!postPlatforms.length) return notify('Choose at least one place to post.', 'error')
    setPosting(true)
    try {
      const mediaUrls: string[] = []
      const mediaPaths: string[] = []
      for (const file of postMedia) {
        const form = new FormData()
        form.append('file', file)
        const headers = await getAuthJsonHeaders()
        delete headers['Content-Type']
        const upload = await fetch('/api/growth/social-media', { method: 'POST', headers, body: form })
        const uploadData = await upload.json().catch(() => ({}))
        if (!upload.ok || !uploadData.url) throw new Error(uploadData.error || 'Media upload failed')
        mediaUrls.push(uploadData.url)
        if (typeof uploadData.path === 'string') mediaPaths.push(uploadData.path)
      }
      const r = await fetch('/api/growth/social-post', {
        method: 'POST',
        headers: await getAuthJsonHeaders(),
        body: JSON.stringify({ text: postText.trim(), platforms: postPlatforms, media_urls: mediaUrls, media_paths: mediaPaths }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'Draft save failed')
      setPostText('')
      setPostMedia([])
      setShowPost(false)
      notify(d.message || 'Draft saved.', 'success')
      await load({ quiet: true })
    } catch (error) {
      notify(`The draft was not saved: ${error instanceof Error ? error.message : 'something went wrong'}.`, 'error')
    } finally {
      setPosting(false)
    }
  }

  const openAds = (platform: 'google' | 'facebook') => {
    setAdsPlatform(platform); setAdsTried(false)
    setAdsKeywords(adsKeywords || `oil change${city ? ' ' + city.label : ''}, auto repair near me`)
    setShowAds(true)
  }
  const saveAdCampaign = async () => {
    setAdsTried(true)
    if (!adsName.trim()) return
    const shopId = await getShopId()
    if (!shopId) return notify('We could not find your shop. Refresh, or sign out and back in.', 'error')
    setAdsSaving(true)
    const { error } = await supabase.from('growth_campaigns').insert({ shop_id: shopId, name: adsName.trim(), platform: adsPlatform, objective: 'leads', budget_per_day: parseFloat(adsBudget) || 20, keywords: adsKeywords, status: 'draft', spend: 0 })
    setAdsSaving(false)
    if (error) return notify(`The campaign was not saved: ${error.message}`, 'error')
    setAdsName(''); setAdsBudget('20')
    setShowAds(false)
    notify('Campaign draft saved.', 'success')
    await load({ quiet: true })
  }

  const closeReport = useCallback(() => setReport(null), [])
  const closeAddLead = useCallback(() => setShowAddLead(false), [])
  const closeAds = useCallback(() => setShowAds(false), [])
  const closePost = useCallback(() => setShowPost(false), [])
  const closeLookup = useCallback(() => setShowLookup(false), [])
  const refreshQuiet = useCallback(async () => { await load({ quiet: true }) }, [load])

  // ── Small render helpers ─────────────────────────────────────────────────

  const failedNote = (keys: string[], what: string) => keys.some(k => failed[k]) && (
    <ErrorCard title={`${what} did not load`} message="Check your connection and try again." onRetry={() => load()} busy={loading} className="mb-4" />
  )

  const noPhoneHint = (c: Rec) => (c.phone ? phonePretty(c.phone) : 'No phone number')

  // ── Views ────────────────────────────────────────────────────────────────

  const followUpsView = (
    <Section title="Customers to win back" hint="People who have not visited or heard from you in 60 days or more.">
      {failed.customers ? failedNote(['customers'], 'Your customers')
        : loading ? <RowsSkeleton rows={5} label="Loading customers" />
        : customers.length === 0 ? (
          <EmptyBlock icon="customers" title="No customers yet" action={<Link href="/customers" className="btn btn-primary">Go to customers</Link>}>
            Once you have customers, the ones who go quiet show up here with a one-tap text.
          </EmptyBlock>
        ) : staleCustomers.length === 0 ? (
          <EmptyBlock icon="check" title="Nobody has gone quiet">Every customer has visited or heard from you in the last 60 days. Check back later.</EmptyBlock>
        ) : (
          <>
            <div className="mb-4 rounded-lg border border-border bg-bg-card p-4">
              <p className="form-label">The text each customer gets</p>
              <p className="border-l-4 border-[rgb(var(--c-line))] pl-3 text-[0.9375rem]">&ldquo;{followUpText('[first name]')}&rdquo;</p>
              {shop.state === 'ready' && !shop.name && <p className="form-hint">Add your shop name in Settings so the text says who it is from.</p>}
              <button type="button" className="btn btn-primary mt-3 w-full sm:w-auto" onClick={bulkFollowUp} disabled={busy || stalePhones.length === 0}>
                <Icon name="send" className="h-5 w-5" />
                {bulk ? 'Sending texts…' : stalePhones.length === 0 ? 'No phone numbers to text' : `Text ${stalePhones.length} ${stalePhones.length === 1 ? 'customer who has' : 'customers who have'} not visited in 60 days`}
              </button>
              {stalePhones.length < staleCustomers.length && stalePhones.length > 0 && (
                <p className="form-hint">{staleCustomers.length - stalePhones.length} {staleCustomers.length - stalePhones.length === 1 ? 'customer has' : 'customers have'} no phone number and will be skipped.</p>
              )}
            </div>
            <ul className="ledger">
              {staleCustomers.map(c => (
                <li key={c.id}>
                  <div className="ledger-row">
                    <span className="lamp lamp-amber" aria-hidden="true" />
                    <span className="ledger-main">
                      <span className="ledger-title block">{c.name}</span>
                      <span className="ledger-sub block">{noPhoneHint(c)} · {c.last_visit || c.created_at ? `Last visit ${timeAgo(c.last_visit || c.created_at)}` : 'No visit on record'}</span>
                    </span>
                    <button type="button" className="btn btn-secondary shrink-0" onClick={() => textOne(c)} disabled={busy || !c.phone} aria-label={`Text ${c.name}`}>
                      {sending === `fu:${c.id}` ? 'Sending…' : 'Text'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
    </Section>
  )

  const customerListControls = (
    <>
      <SearchField className="mb-3 max-w-md" value={custSearch} onChange={v => { setCustSearch(v); setCustLimit(PAGE) }} label="Find a customer" placeholder="Find a customer by name or phone" />
    </>
  )
  const showMore = matchingCustomers.length > custLimit && (
    <button type="button" className="btn btn-secondary mt-3 w-full sm:w-auto" onClick={() => setCustLimit(n => n + PAGE)}>
      Show {Math.min(PAGE, matchingCustomers.length - custLimit)} more of {matchingCustomers.length - custLimit}
    </button>
  )

  const reviewsView = (
    <>
      <Section title="Your Google review link" hint="Customers can leave a review in one tap.">
        {shop.state === 'loading' ? <div className="skeleton h-28" aria-busy="true" />
          : shop.state === 'error' ? <ErrorCard title="Your review link did not load" message="Check your connection and try again." onRetry={() => { setShop(s => ({ ...s, state: 'loading' })); void loadShop() }} />
          : reviewReady ? (
            <div className="card">
              <p className="break-all rounded-md bg-bg-hover px-3 py-2 text-[0.9375rem] font-bold text-blue">{shop.reviewUrl}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="btn btn-secondary" onClick={copyReviewLink}><Icon name="copy" className="h-5 w-5" />Copy link</button>
                <a href={shop.reviewUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary no-underline"><Icon name="link" className="h-5 w-5" />Open link</a>
              </div>
            </div>
          ) : (
            <EmptyBlock icon="star" title="Add your Google review link" action={<Link href="/settings" className="btn btn-primary">Open settings</Link>}>
              Paste your Google review link in Settings. Then you can text it to customers here.
            </EmptyBlock>
          )}
      </Section>

      <Section title="Ask customers for a review" hint="Text your review link to someone who was happy with the work.">
        {failed.customers ? failedNote(['customers'], 'Your customers')
          : loading ? <RowsSkeleton rows={5} label="Loading customers" />
          : customers.length === 0 ? <EmptyBlock icon="customers" title="No customers yet">When you have customers you can ask them for reviews here.</EmptyBlock>
          : (
            <>
              {customerListControls}
              {matchingCustomers.length === 0 ? <EmptyBlock title="No customers match">Try a different name or phone number.</EmptyBlock> : (
                <ul className="ledger">
                  {matchingCustomers.slice(0, custLimit).map(c => (
                    <li key={c.id}>
                      <div className="ledger-row">
                        <span className="ledger-main">
                          <span className="ledger-title block">{c.name}</span>
                          <span className="ledger-sub block">{noPhoneHint(c)} · {c.review_requested ? `Asked ${timeAgo(c.review_requested)}` : 'Not asked yet'}</span>
                        </span>
                        <button type="button" className={`btn shrink-0 ${c.review_requested ? 'btn-secondary' : 'btn-primary'}`} onClick={() => requestReview(c)} disabled={busy || !c.phone || !reviewReady} aria-label={`${c.review_requested ? 'Text review link again to' : 'Text review link to'} ${c.name}`}>
                          {sending === `rv:${c.id}` ? 'Sending…' : c.review_requested ? 'Text again' : 'Text review link'}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              {showMore}
            </>
          )}
      </Section>
    </>
  )

  const referralsView = (
    <Section title="Referral codes" hint="Give a customer a code. Friends get 10% off and the customer gets a $25 credit.">
      {failed.customers || failed.referrals ? failedNote(['customers', 'referrals'], 'Referral codes')
        : loading ? <RowsSkeleton rows={5} label="Loading customers" />
        : customers.length === 0 ? <EmptyBlock icon="customers" title="No customers yet">When you have customers you can give them referral codes here.</EmptyBlock>
        : (
          <>
            {customerListControls}
            {matchingCustomers.length === 0 ? <EmptyBlock title="No customers match">Try a different name or phone number.</EmptyBlock> : (
              <ul className="ledger">
                {matchingCustomers.slice(0, custLimit).map(c => {
                  const ex = referrals.find(r => r.customer_id === c.id)
                  return (
                    <li key={c.id}>
                      <div className="ledger-row">
                        <span className="ledger-main">
                          <span className="ledger-title block">{c.name}</span>
                          <span className="ledger-sub block">{ex ? `Code ${ex.code} · used ${ex.uses || 0} ${(ex.uses || 0) === 1 ? 'time' : 'times'}` : noPhoneHint(c)}</span>
                        </span>
                        {ex ? (
                          <span className="inline-flex shrink-0 items-center gap-2 font-bold"><span className="lamp lamp-green" aria-hidden="true" />Active</span>
                        ) : (
                          <button type="button" className="btn btn-secondary shrink-0" onClick={() => generateReferral(c)} disabled={busy} aria-label={c.phone ? `Create a code and text it to ${c.name}` : `Create a code for ${c.name}`}>
                            {sending === `rf:${c.id}` ? 'Creating…' : c.phone ? 'Create and text code' : 'Create code'}
                          </button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            {showMore}
          </>
        )}
    </Section>
  )

  const scanCards: { kind: ScanKind; desc: string }[] = [
    { kind: 'competitor', desc: 'Pulls the owner, reviews and a message you can send.' },
    { kind: 'social', desc: `People near ${cityLabel} asking for help with their car.` },
    { kind: 'fleet', desc: 'Owner, fleet size, vehicles and contracts for local businesses.' },
  ]

  const leadsView = (
    <>
      <Section title="Find new customers" hint="Alpha searches for you. Each search takes about a minute and saves what it finds as leads.">
        <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {scanCards.map(({ kind, desc }) => (
            <li key={kind}>
              <button type="button" onClick={() => runScan(kind)} disabled={scanning !== null} className="flex h-full min-h-[5rem] w-full items-start gap-3 rounded-lg border border-border bg-bg-card p-4 text-left hover:bg-bg-hover disabled:opacity-60">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-bg-hover text-text-secondary"><Icon name={SCANS[kind].icon} className="h-5 w-5" /></span>
                <span className="min-w-0">
                  <span className="block font-bold leading-tight">{scanning === kind ? 'Searching…' : `Find ${SCANS[kind].title.charAt(0).toLowerCase()}${SCANS[kind].title.slice(1)}`}</span>
                  <span className="mt-1 block text-[0.875rem] text-text-secondary">{desc}</span>
                </span>
              </button>
            </li>
          ))}
          <li>
            <button type="button" onClick={() => setShowLookup(true)} className="flex h-full min-h-[5rem] w-full items-start gap-3 rounded-lg border border-border bg-bg-card p-4 text-left hover:bg-bg-hover">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-bg-hover text-text-secondary"><Icon name="search" className="h-5 w-5" /></span>
              <span className="min-w-0">
                <span className="block font-bold leading-tight">Look up a person</span>
                <span className="mt-1 block text-[0.875rem] text-text-secondary">Search a name or business for a phone, email or social page.</span>
              </span>
            </button>
          </li>
        </ul>
        <div className="mt-4 flex items-start gap-3 rounded-lg border border-border bg-bg-card p-3">
          <Switch checked={aiMode} onChange={setAiMode} label="Let Alpha write the message" />
          <div className="min-w-0 pt-2.5">
            <p className="font-bold leading-tight">Let Alpha write the message</p>
            <p className="mt-0.5 text-[0.875rem] text-text-secondary">{aiMode ? 'On: Alpha writes a short message for each lead you text or email.' : 'Off: texts use our standard message. Turn this on to send email.'}</p>
          </div>
        </div>
      </Section>

      <Section
        title={`Your leads${!loading && !failed.leads ? ` (${leads.length})` : ''}`}
        action={(
          <div className="toolbar">
            {leads.some(isAiLead) && (
              <button type="button" className="btn btn-secondary" onClick={() => setReport({ title: 'Everything Alpha found', sources: [...AI_SOURCES], scan: null })}>
                <Icon name="list" className="h-5 w-5" />Full report
              </button>
            )}
            <button type="button" className="btn btn-primary" onClick={() => openAddLead()}><Icon name="plus" className="h-5 w-5" />Add a lead</button>
          </div>
        )}
      >
        {failed.leads ? failedNote(['leads'], 'Your leads')
          : loading ? <RowsSkeleton rows={4} label="Loading leads" />
          : leads.length === 0 ? (
            <EmptyBlock icon="flag" title="No leads yet" action={<button type="button" className="btn btn-primary" onClick={() => openAddLead()}><Icon name="plus" className="h-5 w-5" />Add a lead</button>}>
              Run one of the searches above, or add someone who walked in or called.
            </EmptyBlock>
          ) : (
            <>
              <SearchField className="mb-3 max-w-md" value={leadSearch} onChange={setLeadSearch} label="Search your leads" placeholder="Search leads by name or phone" />
              {filteredLeads.length === 0 ? <EmptyBlock title="No leads match">Try a different name or phone number.</EmptyBlock> : (
                <ul className="ledger">
                  {filteredLeads.map(l => {
                    const st = leadStatus(l.status)
                    return (
                      <li key={l.id} className="px-3 py-3">
                        <div className="flex items-start gap-3">
                          <span className={`lamp lamp-${st.lamp} mt-[0.45rem]`} aria-hidden="true" />
                          <div className="min-w-0 flex-1">
                            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 font-bold leading-tight">
                              <span className="break-words">{l.name}</span>
                              {isAiLead(l) && <span className="tag tag-gray text-[0.8125rem]">Found by Alpha</span>}
                            </p>
                            <p className="text-[0.9375rem] text-text-secondary">{st.word} · {sourceLabel(l.source)} · {l.service_needed || 'General repair'}{l.fleet_size ? ` · ${l.fleet_size} vehicles` : ''}</p>
                            {(l.phone || l.email || l.owner_name) && <p className="break-words text-[0.9375rem] text-text-secondary">{[l.owner_name, l.phone ? phonePretty(l.phone) : '', l.email].filter(Boolean).join(' · ')}</p>}
                          </div>
                        </div>
                        <div className="mt-2 sm:pl-[1.65rem]">
                          <OutreachButtons lead={l} sending={sending} aiMode={aiMode} onOutreach={outreach} />
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </>
          )}
      </Section>

      <Section
        title="Recent calls"
        hint="Calls to and from your shop number."
        action={<button type="button" className="btn btn-secondary" onClick={syncCalls} disabled={syncingCalls}><Icon name="refresh" className="h-5 w-5" />{syncingCalls ? 'Syncing…' : 'Sync calls'}</button>}
      >
        {callState === 'loading' || callState === 'idle' ? <RowsSkeleton rows={3} label="Loading calls" />
          : callState === 'error' ? <ErrorCard title="Your calls did not load" message="Check your connection and try again." onRetry={loadCalls} />
          : callHistory.length === 0 ? <EmptyBlock icon="phone" title="No calls yet">Tap Sync calls to pull in your recent calls.</EmptyBlock>
          : (
            <>
              <ul className="ledger">
                {callHistory.slice(0, callsOpen ? 50 : 8).map(c => {
                  const inbound = c.direction === 'inbound'
                  const secs = Number(c.duration_secs) || 0
                  return (
                    <li key={c.id}>
                      <div className="ledger-row">
                        <Icon name="phone" className="h-5 w-5 shrink-0 text-text-secondary" />
                        <span className="ledger-main">
                          <span className="ledger-title block">{c.matched_customer_name || 'Unknown caller'}</span>
                          <span className="ledger-sub block">{inbound ? 'Incoming' : 'Outgoing'} · {phonePretty(inbound ? c.from_number : c.to_number)}{secs ? ` · ${Math.floor(secs / 60)}:${String(Math.floor(secs % 60)).padStart(2, '0')}` : ''}</span>
                        </span>
                        <span className="shrink-0 text-right text-[0.8125rem] text-text-secondary">{c.start_time ? new Date(c.start_time).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}</span>
                      </div>
                    </li>
                  )
                })}
              </ul>
              {callHistory.length > 8 && <button type="button" className="btn btn-secondary mt-3 w-full sm:w-auto" onClick={() => setCallsOpen(o => !o)}>{callsOpen ? 'Show fewer calls' : `Show all ${Math.min(callHistory.length, 50)} calls`}</button>}
            </>
          )}
      </Section>
    </>
  )

  const postsView = (
    <>
      <Section
        title="Social posts"
        hint="Write a post and save it as a draft. Nothing goes out until a connected app is authorized."
        action={<button type="button" className="btn btn-primary" onClick={() => setShowPost(true)}><Icon name="pen" className="h-5 w-5" />Write a post</button>}
      >
        {failed.posts ? failedNote(['posts'], 'Your post drafts')
          : loading ? <RowsSkeleton rows={2} label="Loading drafts" />
          : postHistory.length === 0 ? (
            <EmptyBlock icon="image" title="No post drafts yet">Write a short update about your shop. Alpha saves it as a draft you can review.</EmptyBlock>
          ) : (
            <ul className="ledger">
              {postHistory.map((p, i) => (
                <li key={p.id || i} className="px-3 py-3">
                  <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                    <span className="font-bold">{Array.isArray(p.platforms) ? p.platforms.map((x: string) => x.charAt(0).toUpperCase() + x.slice(1)).join(', ') : 'Draft'}</span>
                    <span className="text-[0.875rem] text-text-secondary">{timeAgo(p.created_at)}</span>
                  </p>
                  <p className="line-clamp-2 text-[0.9375rem] text-text-secondary">{p.text}</p>
                </li>
              ))}
            </ul>
          )}
      </Section>

      <Section title="Ad campaigns" hint="Plan an ad and save it as a draft. Saving does not start any ads or spend money.">
        <div className="toolbar mb-4">
          <button type="button" className="btn btn-secondary" onClick={() => openAds('google')}><Icon name="globe" className="h-5 w-5" />New Google ads campaign</button>
          <button type="button" className="btn btn-secondary" onClick={() => openAds('facebook')}><Icon name="globe" className="h-5 w-5" />New Facebook ads campaign</button>
        </div>
        {failed.campaigns ? failedNote(['campaigns'], 'Your campaigns')
          : loading ? <RowsSkeleton rows={2} label="Loading campaigns" />
          : campaigns.length === 0 ? <EmptyBlock icon="growth" title="No campaigns yet">Start with Google ads to reach people searching for repairs near {cityLabel}.</EmptyBlock>
          : (
            <ul className="ledger">
              {campaigns.map(c => (
                <li key={c.id}>
                  <div className="ledger-row">
                    <span className={`lamp ${c.status === 'active' ? 'lamp-green' : 'lamp-off'}`} aria-hidden="true" />
                    <span className="ledger-main">
                      <span className="ledger-title block">{c.name}</span>
                      <span className="ledger-sub block">{String(c.platform || '').charAt(0).toUpperCase() + String(c.platform || '').slice(1)} · {c.status === 'active' ? 'Running' : c.status === 'draft' ? 'Draft' : String(c.status || 'Draft').charAt(0).toUpperCase() + String(c.status || '').slice(1)}</span>
                    </span>
                    <span className="ledger-amt">${Number(c.spend || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
      </Section>
    </>
  )

  const resultsView = (() => {
    const converted = leads.filter(l => l.status === 'converted').length
    const rate = leads.length ? Math.round((converted / leads.length) * 100) : 0
    const srcMap: Record<string, number> = {}
    leads.forEach(l => { const s = l.source || 'manual'; srcMap[s] = (srcMap[s] || 0) + 1 })
    const total = leads.length || 1
    const count = (m: string) => outreachHistory.filter(o => o.method === m).length
    return (
      <>
        {failedNote(['leads', 'referrals', 'outreach', 'campaigns'], 'Some results')}
        <Section title="How it is going">
          {loading ? <div className="skeleton h-24" /> : (
            <dl className="panel grid grid-cols-2 divide-border sm:grid-cols-4 sm:divide-x">
              {[
                { label: 'Leads found', value: leads.length },
                { label: 'Became customers', value: converted },
                { label: 'Lead to customer', value: `${rate}%` },
                { label: 'Referral codes', value: referrals.length },
              ].map((s, i) => (
                <div key={s.label} className={`px-4 py-3 ${i < 2 ? 'border-b border-border sm:border-b-0' : ''} ${i % 2 === 0 ? 'border-r border-border sm:border-r-0' : ''}`}>
                  <dt className="text-[0.8125rem] font-bold text-text-secondary">{s.label}</dt>
                  <dd className="display num text-[1.75rem] font-bold leading-tight">{s.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </Section>

        <Section title="Where leads come from">
          {loading ? <div className="skeleton h-24" /> : leads.length === 0 ? <EmptyBlock icon="flag" title="No leads yet">Run a search or add a lead and the sources will show here.</EmptyBlock> : (
            <ul className="space-y-3">
              {Object.entries(srcMap).sort((a, b) => b[1] - a[1]).map(([source, n]) => (
                <li key={source}>
                  <div className="mb-1 flex justify-between gap-3 text-[0.9375rem]">
                    <span>{sourceLabel(source)}</span>
                    <span className="num font-bold">{n} <span className="font-normal text-text-secondary">({Math.round((n / total) * 100)}%)</span></span>
                  </div>
                  <div className="h-2.5 overflow-hidden rounded-full bg-text-primary/10" role="img" aria-label={`${sourceLabel(source)}: ${Math.round((n / total) * 100)} percent of leads`}>
                    <div className="h-full rounded-full bg-blue" style={{ width: `${(n / total) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Messages sent to leads">
          {loading ? <div className="skeleton h-24" /> : (
            <>
              <dl className="panel mb-3 grid grid-cols-3 divide-x divide-border">
                {[{ label: 'Texts', value: count('sms') }, { label: 'Emails', value: count('email') }, { label: 'Calls by Alpha', value: count('ai_call') }].map(s => (
                  <div key={s.label} className="px-3 py-3 text-center">
                    <dt className="text-[0.8125rem] font-bold text-text-secondary">{s.label}</dt>
                    <dd className="display num text-[1.5rem] font-bold leading-tight">{s.value}</dd>
                  </div>
                ))}
              </dl>
              {outreachHistory.length === 0 ? <EmptyBlock icon="send" title="Nothing sent yet">Text or email a lead from the Leads view and it will be counted here.</EmptyBlock> : (
                <ul className="ledger">
                  {outreachHistory.slice(0, 10).map((o, i) => (
                    <li key={o.id || i}>
                      <div className="ledger-row !min-h-[3.25rem]">
                        <span className="ledger-main"><span className="ledger-title block">{o.lead_name || o.target || o.to_contact || 'Lead'}</span></span>
                        <span className="tag tag-gray shrink-0 text-[0.8125rem]">{o.method === 'sms' ? 'Text' : o.method === 'email' ? 'Email' : o.method === 'ai_call' ? 'Call' : o.method}</span>
                        <span className="w-24 shrink-0 text-right text-[0.8125rem] text-text-secondary">{timeAgo(o.created_at)}</span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </Section>

        <Section title="At a glance">
          {loading ? <div className="skeleton h-24" /> : (
            <dl className="panel grid grid-cols-2 sm:grid-cols-4">
              {[
                { label: 'Customers', value: customers.length },
                { label: 'Need a follow-up', value: staleCustomers.length },
                { label: 'Ad campaigns', value: campaigns.length },
                { label: 'Things sent lately', value: activityLog.length },
              ].map((s, i) => (
                <div key={s.label} className={`px-4 py-3 ${i < 2 ? 'border-b border-border sm:border-b-0' : ''} ${i % 2 === 0 ? 'border-r border-border sm:border-r-0' : ''} ${i > 0 ? 'sm:border-l sm:border-border' : ''}`}>
                  <dt className="text-[0.8125rem] font-bold text-text-secondary">{s.label}</dt>
                  <dd className="display num text-[1.75rem] font-bold leading-tight">{s.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </Section>
      </>
    )
  })()

  const views: Record<Tab, React.ReactNode> = { followups: followUpsView, reviews: reviewsView, referrals: referralsView, leads: leadsView, posts: postsView, results: resultsView }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div>
          <h1 className="page-title">Get more customers</h1>
          <p className="page-subtitle">Bring customers back, ask for reviews and find new ones.</p>
        </div>
        <div className="toolbar">
          <button type="button" className="btn btn-secondary" onClick={() => load()} disabled={loading}>
            <Icon name="refresh" className="h-5 w-5" />
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </header>

      {fatal ? (
        <ErrorCard title="This page did not load" message={fatal} onRetry={() => load()} busy={loading} className="max-w-xl" />
      ) : (
        <>
          <div className="panel mb-4 grid grid-cols-4 divide-x divide-border overflow-hidden">
            <Stat label="Customers" value={loading ? '–' : customers.length} />
            <Stat label="Need a follow-up" value={loading ? '–' : staleCustomers.length} lamp={!loading ? (staleCustomers.length ? 'amber' : 'green') : undefined} onClick={() => changeTab('followups')} />
            <Stat label="Referral codes" value={loading ? '–' : referrals.length} onClick={() => changeTab('referrals')} />
            <Stat label="Open leads" value={loading ? '–' : openLeads} onClick={() => changeTab('leads')} />
          </div>

          <Segmented label="Choose what to work on" idPrefix="growth" options={TABS} value={tab} onChange={changeTab} />

          <div id="growth-panel" role="tabpanel" aria-labelledby={`growth-tab-${tab}`} className="mt-6">
            {views[tab]}
          </div>

          {activityLog.length > 0 && tab !== 'results' && (
            <section className="mt-10" aria-labelledby="activity-h">
              <h2 id="activity-h" className="section-title mb-2">Recently sent</h2>
              <ul className="ledger">
                {activityLog.slice(0, 5).map((a, i) => (
                  <li key={a.id || i}>
                    <div className="ledger-row !min-h-[3.25rem]">
                      <span className="lamp lamp-green" aria-hidden="true" />
                      <span className="ledger-main">
                        <span className="ledger-title block">{String(a.action || '').replace(/_/g, ' ').replace(/^./, (m: string) => m.toUpperCase())}: {a.target}</span>
                      </span>
                      <span className="shrink-0 text-[0.8125rem] text-text-secondary">{timeAgo(a.created_at)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {/* ── Sheets ── */}
      {report && (
        <LeadReport
          title={report.title}
          leads={reportLeads}
          scanning={!!report.scan && scanning === report.scan}
          scanHint={report.scan ? SCANS[report.scan].hint : ''}
          onClose={closeReport}
          onOutreach={outreach}
          sending={sending}
          aiMode={aiMode}
          onRefresh={refreshQuiet}
          notify={notify}
        />
      )}

      <Sheet open={showAddLead} onClose={closeAddLead} title="Add a lead">
        <form onSubmit={e => { e.preventDefault(); void addLead() }} className="space-y-4" noValidate>
          <div>
            <label htmlFor="lead-name" className="form-label">Name</label>
            <input id="lead-name" className="form-input" autoComplete="off" value={leadForm.name} onChange={e => setLeadForm(f => ({ ...f, name: e.target.value }))} placeholder="John Smith" aria-invalid={leadTried && !leadForm.name.trim()} />
            {leadTried && !leadForm.name.trim() && <p className="form-error">Enter a name.</p>}
          </div>
          <div>
            <label htmlFor="lead-phone" className="form-label">Phone (optional)</label>
            <input id="lead-phone" className="form-input" type="tel" autoComplete="off" value={leadForm.phone} onChange={e => setLeadForm(f => ({ ...f, phone: e.target.value }))} placeholder="(713) 555-0000" />
          </div>
          <div>
            <label htmlFor="lead-service" className="form-label">What they need (optional)</label>
            <input id="lead-service" className="form-input" value={leadForm.service} onChange={e => setLeadForm(f => ({ ...f, service: e.target.value }))} placeholder="Oil change, brakes…" />
          </div>
          <div>
            <label htmlFor="lead-source" className="form-label">How they found you</label>
            <select id="lead-source" className="form-select" value={leadForm.source} onChange={e => setLeadForm(f => ({ ...f, source: e.target.value }))}>
              {LEAD_SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="lead-notes" className="form-label">Notes (optional)</label>
            <textarea id="lead-notes" className="form-textarea" rows={2} value={leadForm.notes} onChange={e => setLeadForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <button type="button" className="btn btn-secondary" onClick={closeAddLead}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={leadSaving}>{leadSaving ? 'Saving…' : 'Save lead'}</button>
          </div>
        </form>
      </Sheet>

      <Sheet open={showAds} onClose={closeAds} title={`New ${adsPlatform === 'google' ? 'Google' : 'Facebook'} ads campaign`}>
        <form onSubmit={e => { e.preventDefault(); void saveAdCampaign() }} className="space-y-4" noValidate>
          <div role="group" aria-label="Where the ads run" className="grid grid-cols-2 gap-2">
            {(['google', 'facebook'] as const).map(p => (
              <button key={p} type="button" aria-pressed={adsPlatform === p} onClick={() => setAdsPlatform(p)} className={`btn ${adsPlatform === p ? 'border-blue bg-blue/10 text-blue' : 'btn-secondary'}`}>
                {adsPlatform === p && <Icon name="check" className="h-4 w-4" strokeWidth={2.4} />}
                {p === 'google' ? 'Google ads' : 'Facebook ads'}
              </button>
            ))}
          </div>
          <div>
            <label htmlFor="ads-name" className="form-label">Campaign name</label>
            <input id="ads-name" className="form-input" value={adsName} onChange={e => setAdsName(e.target.value)} placeholder="Spring brake special" aria-invalid={adsTried && !adsName.trim()} />
            {adsTried && !adsName.trim() && <p className="form-error">Give the campaign a name.</p>}
          </div>
          <div>
            <label htmlFor="ads-budget" className="form-label">Daily budget in dollars</label>
            <input id="ads-budget" className="form-input" type="number" inputMode="decimal" min="5" value={adsBudget} onChange={e => setAdsBudget(e.target.value)} />
          </div>
          <div>
            <label htmlFor="ads-keywords" className="form-label">Words people search for</label>
            <input id="ads-keywords" className="form-input" value={adsKeywords} onChange={e => setAdsKeywords(e.target.value)} aria-describedby="ads-kw-hint" />
            <p id="ads-kw-hint" className="form-hint">Separate them with commas.</p>
          </div>
          <p className="flex items-start gap-2 rounded-md bg-bg-hover px-3 py-2 text-[0.9375rem]"><Icon name="info" className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" />This saves a draft. It does not start any ads or spend money.</p>
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <button type="button" className="btn btn-secondary" onClick={closeAds}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={adsSaving}>{adsSaving ? 'Saving…' : 'Save draft'}</button>
          </div>
        </form>
      </Sheet>

      <Sheet open={showPost} onClose={closePost} title="Write a post">
        <div className="space-y-4">
          <div role="group" aria-label="Where this post is for">
            <p className="form-label">Where it is for</p>
            <div className="flex flex-wrap gap-2">
              {PLATFORMS.map(p => {
                const on = postPlatforms.includes(p.key)
                return (
                  <button key={p.key} type="button" aria-pressed={on} onClick={() => setPostPlatforms(prev => prev.includes(p.key) ? prev.filter(x => x !== p.key) : [...prev, p.key])} className={`btn ${on ? 'border-blue bg-blue/10 text-blue' : 'btn-secondary'}`}>
                    {on ? <Icon name="check" className="h-4 w-4" strokeWidth={2.4} /> : <Icon name="globe" className="h-4 w-4" />}
                    {p.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div>
            <label htmlFor="post-text" className="form-label">What is happening at your shop?</label>
            <textarea id="post-text" className="form-textarea" rows={5} value={postText} onChange={e => setPostText(e.target.value)} placeholder="We have two bays open this afternoon. Walk-ins welcome." />
            <p className="form-hint">This saves a draft only. Nothing is published until a connected app is authorized.</p>
          </div>
          <div>
            <input ref={fileInputRef} type="file" multiple accept="image/*,video/*" className="sr-only" tabIndex={-1} aria-label="Choose photos or videos" onChange={e => { if (e.target.files) setPostMedia(Array.from(e.target.files)) }} />
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}><Icon name="image" className="h-5 w-5" />Add photos</button>
              {postMedia.length > 0 && (
                <>
                  <span className="text-[0.9375rem] text-text-secondary">{postMedia.length} {postMedia.length === 1 ? 'file' : 'files'} chosen</span>
                  <button type="button" className="btn btn-ghost" onClick={() => { setPostMedia([]); if (fileInputRef.current) fileInputRef.current.value = '' }}>Clear</button>
                </>
              )}
            </div>
          </div>
          {postText.trim() && (
            <div className="rounded-lg border border-border bg-bg-base p-3" aria-label="Preview">
              <p className="mb-2 flex items-center gap-2 text-[0.8125rem] font-bold text-text-secondary"><Icon name="eye" className="h-4 w-4" />Preview</p>
              <div className="flex items-center gap-2">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-bg-hover font-bold" aria-hidden="true">{(shop.name || 'S').charAt(0).toUpperCase()}</span>
                <p className="min-w-0 truncate font-bold">{shop.name || 'Your shop'}</p>
              </div>
              <p className="mt-2 whitespace-pre-wrap break-words text-[0.9375rem]">{postText}</p>
              {postMedia.length > 0 && <p className="mt-2 text-[0.875rem] text-text-secondary">{postMedia.length} {postMedia.length === 1 ? 'photo' : 'photos'} attached</p>}
              <p className="mt-2 text-[0.8125rem] text-text-secondary">For: {postPlatforms.length ? postPlatforms.map(x => PLATFORMS.find(p => p.key === x)?.label || x).join(', ') : 'no place chosen yet'}</p>
            </div>
          )}
          <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
            <button type="button" className="btn btn-secondary" onClick={closePost}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={createSocialPost} disabled={posting}>{posting ? 'Saving…' : 'Save draft'}</button>
          </div>
        </div>
      </Sheet>

      <Sheet open={showLookup} onClose={closeLookup} title="Look up a person" wide>
        <form onSubmit={e => { e.preventDefault(); void lookUp() }} className="space-y-3">
          <p className="-mt-1 text-[0.9375rem] text-text-secondary">Type a name, business or Google reviewer. Alpha searches public pages for a phone number, email or social page.</p>
          <div>
            <label htmlFor="intel-q" className="form-label">Name or business</label>
            <input id="intel-q" className="form-input" value={intelQuery} onChange={e => setIntelQuery(e.target.value)} placeholder="Name, business or reviewer" autoComplete="off" />
          </div>
          <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={intelSearching}><Icon name="search" className="h-5 w-5" />{intelSearching ? 'Searching…' : 'Look up'}</button>
        </form>
        {intelSearching && <div className="skeleton mt-4 h-24" role="status" aria-label="Searching" />}
        {intelResults && (
          <div className="mt-5">
            <h3 className="section-title mb-2">Results for {intelQuery}</h3>
            {(intelResults.results || []).length === 0 ? (
              <EmptyBlock title="Nothing found">Try the full name, the business name or a nickname.</EmptyBlock>
            ) : (
              <ul className="space-y-2">
                {intelResults.results.map((r: Rec, i: number) => (
                  <li key={i} className="rounded-lg border border-border bg-bg-base p-3">
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="font-bold">{r.source || 'Web'}</span>
                      <span className={`tag text-[0.8125rem] ${r.confidence === 'high' ? 'tag-green' : 'tag-amber'}`}>{r.confidence === 'high' ? 'High confidence' : `${r.confidence ? String(r.confidence).charAt(0).toUpperCase() + String(r.confidence).slice(1) : 'Medium'} confidence`}</span>
                    </div>
                    {r.name && <p className="text-[0.9375rem]">Name: {r.name}</p>}
                    {r.phone && <p className="text-[0.9375rem]">Phone: <a href={`tel:${r.phone}`} className="font-bold text-blue underline-offset-2 hover:underline">{phonePretty(r.phone)}</a></p>}
                    {r.email && <p className="break-all text-[0.9375rem]">Email: <a href={`mailto:${r.email}`} className="font-bold text-blue underline-offset-2 hover:underline">{r.email}</a></p>}
                    {r.social && <p className="break-all text-[0.9375rem]">Social: {r.social}</p>}
                  </li>
                ))}
              </ul>
            )}
            {intelResults.summary && <p className="mt-3 rounded-md bg-bg-hover px-3 py-2 text-[0.9375rem]">{intelResults.summary}</p>}
          </div>
        )}
      </Sheet>

      <ScreenToast toast={toast} onClose={dismiss} />
    </div>
  )
}
