'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getShopId, getShopProfile, supabase } from '@/lib/supabase'
import { cityFromProfile, isQuiet, lastVisitOf, lastVisits } from '@/lib/growth-text'
import type { Rec, ShopInfo } from './helpers'

type Failed = Record<'customers' | 'referrals' | 'leads' | 'campaigns' | 'activity' | 'posts' | 'outreach' | 'visits', boolean>
const NONE_FAILED: Failed = { customers: false, referrals: false, leads: false, campaigns: false, activity: false, posts: false, outreach: false, visits: false }

/** Everything the Get more customers screen reads, with a failed table kept apart from an empty one. */
export function useGrowthData() {
  const [customers, setCustomers] = useState<Rec[]>([])
  const [referrals, setReferrals] = useState<Rec[]>([])
  const [leads, setLeads] = useState<Rec[]>([])
  const [campaigns, setCampaigns] = useState<Rec[]>([])
  const [activityLog, setActivityLog] = useState<Rec[]>([])
  const [postHistory, setPostHistory] = useState<Rec[]>([])
  const [outreachHistory, setOutreachHistory] = useState<Rec[]>([])
  const [docs, setDocs] = useState<Rec[]>([])
  const [loading, setLoading] = useState(true)
  const [fatal, setFatal] = useState<string | null>(null)
  const [failed, setFailed] = useState<Failed>(NONE_FAILED)
  const [shop, setShop] = useState<ShopInfo>({ name: '', phone: '', reviewUrl: '', state: 'loading' })
  const [city, setCity] = useState<{ search: string; label: string } | null>(null)
  const [cityState, setCityState] = useState<'loading' | 'ready'>('loading')

  const [callHistory, setCallHistory] = useState<Rec[]>([])
  const [callState, setCallState] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle')

  const load = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoading(true)
    try {
      const shopId = await getShopId()
      if (!shopId) { setFatal('We could not find your shop. Refresh, or sign out and back in.'); return }
      const [c, r, l, camp, acts, posts, oh, d] = await Promise.all([
        supabase.from('customers').select('*').eq('shop_id', shopId).order('created_at', { ascending: false }),
        supabase.from('referrals').select('*').eq('shop_id', shopId).order('created_at', { ascending: false }),
        supabase.from('leads').select('*').eq('shop_id', shopId).order('created_at', { ascending: false }),
        supabase.from('growth_campaigns').select('*').eq('shop_id', shopId).order('created_at', { ascending: false }),
        supabase.from('growth_activity').select('*').eq('shop_id', shopId).order('created_at', { ascending: false }).limit(50),
        supabase.from('social_posts').select('*').eq('shop_id', shopId).order('created_at', { ascending: false }).limit(20),
        supabase.from('outreach_history').select('*').eq('shop_id', shopId).order('created_at', { ascending: false }).limit(50),
        // Real visits are invoices and receipts. The customer card alone cannot say when someone last came in.
        supabase.from('documents').select('customer_id,customer_name,created_at,doc_date').eq('shop_id', shopId).in('type', ['Invoice', 'Receipt']).neq('status', 'Void').order('created_at', { ascending: false }).limit(3000),
      ])
      // Keep what we already had for anything that failed, and say so instead of showing an empty list.
      if (!c.error) setCustomers(c.data || [])
      if (!r.error) setReferrals(r.data || [])
      if (!l.error) setLeads(l.data || [])
      if (!camp.error) setCampaigns(camp.data || [])
      if (!acts.error) setActivityLog(acts.data || [])
      if (!posts.error) setPostHistory(posts.data || [])
      if (!oh.error) setOutreachHistory(oh.data || [])
      if (!d.error) setDocs(d.data || [])
      setFailed({ customers: !!c.error, referrals: !!r.error, leads: !!l.error, campaigns: !!camp.error, activity: !!acts.error, posts: !!posts.error, outreach: !!oh.error, visits: !!d.error })
      setFatal(null)
    } catch {
      setFatal('Your customers and leads could not load. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const loadShop = useCallback(async () => {
    setShop(s => ({ ...s, state: 'loading' }))
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('No shop')
      const { data, error } = await supabase.from('settings').select('shop_name,shop_phone,google_review_url').eq('shop_id', shopId).limit(1).maybeSingle()
      if (error) throw error
      setShop({ name: String(data?.shop_name || '').trim(), phone: String(data?.shop_phone || '').trim(), reviewUrl: String(data?.google_review_url || '').trim(), state: 'ready' })
    } catch {
      setShop(s => ({ ...s, state: 'error' }))
    }
  }, [])
  useEffect(() => { void loadShop() }, [loadShop])

  useEffect(() => {
    let cancelled = false
    getShopProfile()
      .then(p => { if (!cancelled) setCity(cityFromProfile(p?.city_state_zip)) })
      .catch(() => {})
      .finally(() => { if (!cancelled) setCityState('ready') })
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

  const visits = useMemo(() => lastVisits(docs), [docs])
  const quiet = useMemo(() => {
    const now = Date.now()
    return customers
      .filter(c => isQuiet(c, visits, now))
      .sort((a, b) => (lastVisitOf(b, visits) ?? 0) - (lastVisitOf(a, visits) ?? 0))
  }, [customers, visits])

  return {
    customers, referrals, leads, campaigns, activityLog, postHistory, outreachHistory, loading, fatal, failed, load,
    shop, loadShop, city, cityState, callHistory, callState, loadCalls, visits, quiet,
  }
}
