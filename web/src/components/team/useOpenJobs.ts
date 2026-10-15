'use client'
import { useCallback, useEffect, useState } from 'react'
import { getShopId, supabase } from '@/lib/supabase'
import { readWithoutMissingColumns } from '@/lib/db-missing'

export interface OpenJob { id: string; ro: string; customer: string; car: string; tech: string; status: string }

/** Repair orders that are not paid or closed, newest first, for picking what someone is working on. Loads only when asked. */
export function useOpenJobs(enabled: boolean) {
  const [jobs, setJobs] = useState<OpenJob[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    if (!enabled) return
    setError('')
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('Not signed in.')
      const { data, error: err } = await readWithoutMissingColumns('id,ro_number,customer_name,vehicle_year,vehicle_make,vehicle_model,tech,status', ['ro_number'], columns => supabase
        .from('jobs')
        .select(columns)
        .eq('shop_id', shopId)
        .not('status', 'in', '("Paid","Closed")')
        .order('created_at', { ascending: false })
        .limit(80))
      if (err) throw err
      setJobs(((data || []) as unknown as Array<Record<string, unknown>>).map(j => ({
        id: String(j.id), ro: String(j.ro_number ?? '').trim(), customer: String(j.customer_name ?? '').trim(),
        car: [j.vehicle_year, j.vehicle_make, j.vehicle_model].map(v => String(v ?? '').trim()).filter(Boolean).join(' '),
        tech: String(j.tech ?? '').trim(), status: String(j.status ?? ''),
      })))
    } catch {
      setError('The repair orders did not load. Check your connection and try again.')
    } finally {
      setLoaded(true)
    }
  }, [enabled])

  useEffect(() => { void load() }, [load])
  return { jobs, loading: enabled && !loaded, error, reload: load }
}

export const jobTitle = (j: Pick<OpenJob, 'ro' | 'car' | 'customer'>): string =>
  [j.ro ? `RO ${j.ro.replace(/^RO[-\s]*/i, '')}` : '', j.car || j.customer].filter(Boolean).join(', ') || 'Repair order'
