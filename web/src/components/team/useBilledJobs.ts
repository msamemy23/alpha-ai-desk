'use client'
import { useCallback, useEffect, useState } from 'react'
import { getShopId, supabase } from '@/lib/supabase'
import { billedFromRow } from '@/lib/productivity'
import type { ProdJobRow } from '@/lib/productivity'
import { billedDocFor, normalizeSegment } from '@/lib/jobtime'
import type { BilledDoc, JobSegment } from '@/lib/jobtime'

const DOC_COLUMNS = 'id,job_id,type,status,doc_date,created_at,parts,labors,shop_supplies,sublet,tax_rate,apply_tax,deposit,amount_paid'
type Row = Record<string, unknown>
const chunks = <T,>(list: T[], n: number): T[][] => Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n))

export interface BilledData { jobs: ProdJobRow[]; docs: BilledDoc[]; segments: JobSegment[] }

/**
 * The repair orders billed in a pay period, their invoices and every minute ever logged on them. Everything is read with the
 * signed-in person's own access. A job counts as billed in the period when its invoice (or receipt) is dated inside it.
 */
export function useBilledJobs(range: { from: string; to: string; fromIso: string; toIso: string } | null, enabled: boolean) {
  const from = range?.from || ''
  const to = range?.to || ''
  const fromIso = range?.fromIso || ''
  const toIso = range?.toIso || ''
  const key = `${from}|${to}`
  const [data, setData] = useState<BilledData | null>(null)
  const [loadedKey, setLoadedKey] = useState('')
  const [error, setError] = useState('')
  const [capped, setCapped] = useState(false)

  const load = useCallback(async () => {
    if (!enabled || !from || !to) return
    setError('')
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('Not signed in.')
      // 1. Invoices and receipts that could fall in the period.
      const first = await supabase.from('documents').select(DOC_COLUMNS).eq('shop_id', shopId).in('type', ['Invoice', 'Receipt']).not('job_id', 'is', null)
        .or(`doc_date.gte.${from},created_at.gte.${from}T00:00:00`).order('created_at', { ascending: false }).limit(1500)
      if (first.error) throw first.error
      setCapped((first.data || []).length >= 1500)
      const candidateIds = [...new Set((first.data || []).map(r => String(r.job_id)))]
      // 2. Every document on those jobs, so the best one (invoice before receipt before estimate) is the one used.
      const all: Row[] = []
      for (const part of chunks(candidateIds, 80)) {
        const r = await supabase.from('documents').select(DOC_COLUMNS).eq('shop_id', shopId).in('job_id', part).limit(1000)
        if (r.error) throw r.error
        all.push(...((r.data || []) as Row[]))
      }
      const docs: BilledDoc[] = []
      for (const row of all) {
        const d = billedFromRow(row)
        if (d) docs.push(d)
      }
      // 3. Only jobs billed inside the period need their job rows and time.
      const byJob = new Map<string, BilledDoc[]>()
      for (const d of docs) byJob.set(d.jobId, [...(byJob.get(d.jobId) || []), d])
      const inPeriod = [...byJob.entries()].filter(([, list]) => {
        const b = billedDocFor(list)
        return !!b && b.basis !== 'estimate' && b.doc.date >= from && b.doc.date <= to
      }).map(([id]) => id)
      const jobs: ProdJobRow[] = []
      for (const part of chunks(inPeriod, 80)) {
        const r = await supabase.from('jobs').select('id,ro_number,status,tech,customer_name,vehicle_year,vehicle_make,vehicle_model').eq('shop_id', shopId).in('id', part).limit(200)
        if (r.error) throw r.error
        for (const j of r.data || []) {
          jobs.push({
            id: String(j.id), ro: String(j.ro_number ?? '').trim(), status: String(j.status ?? ''), tech: String(j.tech ?? '').trim(), customer: String(j.customer_name ?? '').trim(),
            car: [j.vehicle_year, j.vehicle_make, j.vehicle_model].map(v => String(v ?? '').trim()).filter(Boolean).join(' '),
          })
        }
      }
      // 4. All time ever logged on those jobs, through our own server.
      let segments: JobSegment[] = []
      if (inPeriod.length) {
        const res = await fetch(`/api/timeclock?from=${encodeURIComponent(fromIso)}&to=${encodeURIComponent(toIso)}&include=jobtime&jobs=${encodeURIComponent(inPeriod.slice(0, 300).join(','))}`, { cache: 'no-store' })
        const d = await res.json().catch(() => ({}))
        if (!res.ok || d.ok === false) throw new Error(d.error || 'Time on repair orders did not load.')
        segments = ((d.jobTimeForJobs || []) as Row[]).map(normalizeSegment)
      }
      setData({ jobs, docs: docs.filter(d => inPeriod.includes(d.jobId)), segments })
    } catch {
      setError('The sales and time for this pay period did not load. Check your connection and try again.')
    } finally {
      setLoadedKey(key)
    }
  }, [enabled, from, to, fromIso, toIso, key])

  useEffect(() => { void load() }, [load])
  return { data: loadedKey === key ? data : null, loading: enabled && loadedKey !== key, error, capped, reload: load }
}
