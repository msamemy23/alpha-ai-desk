'use client'
import { useEffect, useState } from 'react'
import { digestFromRaw, normalizeSections, digestOf } from '@/lib/dvi'
import type { DigestItem } from '@/lib/dvi'
import { missingSchema } from '@/lib/schema-missing'
import { getShopId, supabase } from '@/lib/supabase'

export interface OpenWork { name: string; why: 'declined' | 'unanswered'; at: string }

/**
 * Work from this customer's recent inspections that is still open: lines they said no to, or an inspection they never answered.
 * Offered as one-tap suggestions when a booking is made. Asked for quietly; if it cannot be loaded the form is just without it.
 */
export function useDeclined(customerId: string | null | undefined, customerName: string | undefined): OpenWork[] {
  const [items, setItems] = useState<OpenWork[]>([])
  const key = `${customerId || ''}|${(customerName || '').trim().toLowerCase()}`
  useEffect(() => {
    let live = true
    setItems([])
    if (!customerId && !(customerName || '').trim()) return
    const t = setTimeout(async () => {
      try {
        const shopId = await getShopId()
        if (!shopId) return
        const ask = async (cols: string, byId: boolean) => {
          let q = supabase.from('dvi').select(cols).eq('shop_id', shopId).order('created_at', { ascending: false }).limit(4)
          q = byId && customerId ? q.eq('customer_id', customerId) : q.eq('customer_name', (customerName || '').trim())
          return q
        }
        let res = await ask('id,created_at,customer_decisions,sent_to_customer,digest', !!customerId)
        if (res.error && missingSchema(res.error)) res = await ask('id,created_at,customer_decisions,sent_to_customer', false)
        if (res.error || !res.data) return
        const rows = res.data as unknown as Record<string, unknown>[]
        const out: OpenWork[] = []
        let fullLoads = 0
        for (const r of rows) {
          const decisions = r.customer_decisions && typeof r.customer_decisions === 'object' && !Array.isArray(r.customer_decisions) ? (r.customer_decisions as Record<string, string>) : {}
          const answered = Object.keys(decisions).length > 0
          if (!answered && r.sent_to_customer !== true) continue
          if (answered && !Object.values(decisions).includes('declined')) continue
          let digest: DigestItem[] = digestFromRaw(r.digest)
          if (digest.length === 0 && fullLoads < 2) {
            fullLoads += 1
            const full = await supabase.from('dvi').select('sections').eq('shop_id', shopId).eq('id', String(r.id)).maybeSingle()
            if (!full.error && full.data) digest = digestOf(normalizeSections((full.data as Record<string, unknown>).sections))
          }
          const at = String(r.created_at || '').slice(0, 10)
          for (const d of digest) {
            if (d.r === 'g') continue
            if (answered ? decisions[d.i || ''] === 'declined' : true) {
              if (!out.some(o => o.name.toLowerCase() === d.n.toLowerCase())) out.push({ name: d.n, why: answered ? 'declined' : 'unanswered', at })
            }
          }
          if (out.length >= 6) break
        }
        if (live) setItems(out.slice(0, 6))
      } catch { /* suggestions are a bonus */ }
    }, 400)
    return () => { live = false; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return items
}
