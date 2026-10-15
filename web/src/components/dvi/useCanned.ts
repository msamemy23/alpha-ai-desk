'use client'
import { useEffect, useState } from 'react'
import { getShopId, supabase } from '@/lib/supabase'
import type { CannedLike } from '@/lib/dvi-canned'

/** The shop's canned jobs, for pricing a finding. If they cannot be loaded the price box simply works by hand. */
export function useCanned(): { jobs: CannedLike[]; loaded: boolean } {
  const [jobs, setJobs] = useState<CannedLike[]>([])
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let live = true
    getShopId().then(async shopId => {
      if (!shopId) return
      const { data, error } = await supabase.from('canned_jobs').select('id,name,category,description,labor_hours,labor_rate,parts,total_price,active').eq('shop_id', shopId).order('name').limit(500)
      if (live && !error && data) setJobs((data as unknown as CannedLike[]).map(j => ({ ...j, id: String(j.id) })))
    }).catch(() => undefined).finally(() => { if (live) setLoaded(true) })
    return () => { live = false }
  }, [])
  return { jobs, loaded }
}
