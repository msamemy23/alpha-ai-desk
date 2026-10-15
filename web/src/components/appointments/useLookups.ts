'use client'
import { useCallback, useEffect, useState } from 'react'
import { getShopId, supabase } from '@/lib/supabase'
import type { ApptCustomer } from '@/components/schedule/types'
import { phoneTail } from './errors'

const PAGE = 1000
const MAX_PAGES = 10

interface CustomerRow extends ApptCustomer { sms_opted_out?: boolean | null }

/**
 * The customer list, who has replied STOP, quick service choices and the shop's own name and phone.
 * The customer list is read in pages so a shop with more than 1,000 customers can still find everyone.
 */
export function useLookups() {
  const [customers, setCustomers] = useState<ApptCustomer[]>([])
  const [customersError, setCustomersError] = useState('')
  const [stopped, setStopped] = useState<{ ids: Set<string>; phones: Set<string> }>({ ids: new Set(), phones: new Set() })
  const [serviceIdeas, setServiceIdeas] = useState<string[]>([])
  const [shop, setShop] = useState({ name: '', phone: '' })

  const loadCustomers = useCallback(async () => {
    try {
      const shopId = await getShopId()
      if (!shopId) { setCustomersError('We could not find your shop.'); return }
      const rows: CustomerRow[] = []
      for (let i = 0; i < MAX_PAGES; i++) {
        const { data, error } = await supabase.from('customers')
          .select('id,name,phone,vehicle_year,vehicle_make,vehicle_model,sms_opted_out')
          .eq('shop_id', shopId).order('name').order('id').range(i * PAGE, i * PAGE + PAGE - 1)
        if (error) throw error
        const page = (data || []) as CustomerRow[]
        rows.push(...page)
        if (page.length < PAGE) break
      }
      setCustomers(rows.map(c => ({ id: c.id, name: c.name, phone: c.phone, vehicle_year: c.vehicle_year, vehicle_make: c.vehicle_make, vehicle_model: c.vehicle_model })))
      const out = rows.filter(c => c.sms_opted_out === true)
      setStopped({ ids: new Set(out.map(c => String(c.id))), phones: new Set(out.map(c => phoneTail(c.phone)).filter(Boolean)) })
      setCustomersError('')
    } catch {
      setCustomersError('Your customer list did not load.')
    }
  }, [])

  useEffect(() => {
    void loadCustomers()
    getShopId().then(shopId => {
      if (!shopId) return
      supabase.from('canned_jobs').select('name').eq('shop_id', shopId).eq('active', true).order('name').limit(8).then(({ data }) => setServiceIdeas((data || []).map((r: { name: string }) => r.name)))
      supabase.from('settings').select('shop_name,shop_phone').eq('shop_id', shopId).maybeSingle().then(({ data }) => {
        if (data) setShop({ name: String(data.shop_name || ''), phone: String(data.shop_phone || '') })
      })
    }).catch(() => { /* the form still works without these */ })
  }, [loadCustomers])

  const isStopped = useCallback((a: { customer_id?: string | null; phone?: string | null }) => (
    (!!a.customer_id && stopped.ids.has(String(a.customer_id))) || (!!phoneTail(a.phone) && stopped.phones.has(phoneTail(a.phone)))
  ), [stopped])

  return { customers, customersError, reloadCustomers: loadCustomers, serviceIdeas, shop, isStopped }
}
