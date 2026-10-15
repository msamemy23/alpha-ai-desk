'use client'
import { useCallback, useEffect, useState } from 'react'
import { getShopId, getShopProfile, supabase } from '@/lib/supabase'
import { cityFromProfile } from '@/lib/growth-text'
import { load } from './api'
import type { CustomAutomation, ShopFacts, SystemAutomation } from './types'

/** The two lists on the Automations screen, kept apart so one failing never hides the other. */
export function useAutomations() {
  const [system, setSystem] = useState<SystemAutomation[]>([])
  const [custom, setCustom] = useState<CustomAutomation[]>([])
  const [loading, setLoading] = useState(true)
  const [sysError, setSysError] = useState('')
  const [custError, setCustError] = useState('')
  const [shop, setShop] = useState<ShopFacts>({ name: '', phone: '', reviewUrl: '', timezone: '', state: 'loading' })
  const [city, setCity] = useState<{ search: string; label: string } | null>(null)

  const loadAll = useCallback(async () => {
    const [sys, cust] = await Promise.all([
      load('/api/system-automations', d => (Array.isArray(d.automations) ? d.automations : []) as SystemAutomation[]),
      load('/api/automations', d => (Array.isArray(d.data) ? d.data : []) as CustomAutomation[]),
    ])
    // A list that failed keeps what was on screen before, and says so.
    if (sys.ok) setSystem(sys.value)
    if (cust.ok) setCustom(cust.value)
    setSysError(sys.ok ? '' : sys.error)
    setCustError(cust.ok ? '' : cust.error)
    setLoading(false)
  }, [])

  const reload = useCallback(() => { setLoading(true); void loadAll() }, [loadAll])
  useEffect(() => { void loadAll() }, [loadAll])

  const loadShop = useCallback(async () => {
    setShop(s => ({ ...s, state: 'loading' }))
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('No shop')
      const { data, error } = await supabase.from('settings').select('shop_name,shop_phone,google_review_url,timezone').eq('shop_id', shopId).limit(1).maybeSingle()
      if (error) throw error
      setShop({
        name: String(data?.shop_name || '').trim(),
        phone: String(data?.shop_phone || '').trim(),
        reviewUrl: String(data?.google_review_url || '').trim(),
        timezone: String(data?.timezone || '').trim() || 'America/Chicago',
        state: 'ready',
      })
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
    return () => { cancelled = true }
  }, [])

  return { system, custom, loading, sysError, custError, shop, loadShop, city, reload, loadAll, setSystem, setCustom }
}
