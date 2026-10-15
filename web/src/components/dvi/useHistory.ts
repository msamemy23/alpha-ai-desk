'use client'
import { useEffect, useState } from 'react'
import { getShopId, supabase } from '@/lib/supabase'
import { digestFromRaw, normalizeSections } from '@/lib/dvi'
import { earlierVisits, milesOf, personKey, sameVehicle, vehicleKey, visitFromSections } from '@/lib/dvi-history'
import type { Visit } from '@/lib/dvi-history'
import { missingSchema } from '@/lib/schema-missing'

export interface HistorySubject {
  id: string
  jobId: string | null
  customerId: string | null
  customerName: string
  vehicle: string
  createdAt: string
}

export type HistoryState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; priors: Visit[]; miles: number | null; more: number }

// The columns of a light first look. customer_id comes from migration 036; until it is applied the older set is asked for.
const CAND_NEW = 'id,job_id,customer_id,customer_name,vehicle,tech,created_at'
const CAND_OLD = 'id,job_id,customer_name,vehicle,tech,created_at'
const SHOWN = 6

type Cand = { id: string; job_id: string | null; customer_id: string | null; customer_name: string; vehicle: string; tech: string; created_at: string }

const s = (v: unknown) => (typeof v === 'string' ? v : '')

async function fetchHistory(me: HistorySubject): Promise<{ priors: Visit[]; miles: number | null; more: number }> {
  const shopId = await getShopId()
  if (!shopId) throw new Error('no shop')
  const ask = (cols: string) => supabase.from('dvi').select(cols).eq('shop_id', shopId).neq('id', me.id).order('created_at', { ascending: false }).limit(250)
  let res = await ask(CAND_NEW)
  if (res.error && missingSchema(res.error)) res = await ask(CAND_OLD)
  if (res.error) throw res.error
  const who = personKey(me.customerName)
  const cands: Cand[] = ((res.data || []) as unknown as Record<string, unknown>[])
    .map(r => ({ id: String(r.id), job_id: s(r.job_id) || null, customer_id: s(r.customer_id) || null, customer_name: s(r.customer_name), vehicle: s(r.vehicle), tech: s(r.tech), created_at: s(r.created_at) }))
    .filter(r => (me.customerId && r.customer_id ? me.customerId === r.customer_id : who !== '' && personKey(r.customer_name) === who))
    .filter(r => vehicleKey(r.vehicle) !== '' || vehicleKey(me.vehicle) === '')
    .slice(0, 40)

  // The job on each inspection knows the VIN and the odometer.
  const jobIds = Array.from(new Set([me.jobId, ...cands.map(c => c.job_id)].filter((x): x is string => Boolean(x)))).slice(0, 60)
  const jobInfo = new Map<string, { vin: string; miles: number | null }>()
  if (jobIds.length > 0) {
    const { data, error } = await supabase.from('jobs').select('id,vehicle_vin,vehicle_mileage').eq('shop_id', shopId).in('id', jobIds)
    if (!error && data) for (const j of data as unknown as Record<string, unknown>[]) jobInfo.set(String(j.id), { vin: s(j.vehicle_vin), miles: milesOf(j.vehicle_mileage) })
  }
  const mine = me.jobId ? jobInfo.get(me.jobId) : undefined
  const meRef = { customerId: me.customerId, customerName: me.customerName, vehicle: me.vehicle, vin: mine?.vin }
  const same = earlierVisits({ id: me.id, at: me.createdAt }, cands.map(c => ({ ...c, at: c.created_at })))
    .filter(c => sameVehicle(meRef, { customerId: c.customer_id, customerName: c.customer_name, vehicle: c.vehicle, vin: c.job_id ? jobInfo.get(c.job_id)?.vin : undefined }))
  const keep = same.slice(0, SHOWN)
  if (keep.length === 0) return { priors: [], miles: mine?.miles ?? null, more: 0 }

  // The short copy beside each row (migration 049). Older rows, or a shop without the column, fall back to the whole checklist for the newest one.
  const ids = keep.map(k => k.id)
  const tiers = ['id,digest,customer_decisions', 'id,customer_decisions', 'id']
  let rows: Record<string, unknown>[] = []
  for (const cols of tiers) {
    const { data, error } = await supabase.from('dvi').select(cols).eq('shop_id', shopId).in('id', ids)
    if (!error) { rows = (data || []) as unknown as Record<string, unknown>[]; break }
    if (!missingSchema(error)) throw error
  }
  const extra = new Map(rows.map(r => [String(r.id), r]))
  const decisionsOf = (r: Record<string, unknown> | undefined) => (r && r.customer_decisions && typeof r.customer_decisions === 'object' && !Array.isArray(r.customer_decisions) ? (r.customer_decisions as Record<string, string>) : {})

  const priors: Visit[] = []
  let needFull = true
  for (const k of keep) {
    const r = extra.get(k.id)
    const items = digestFromRaw(r?.digest)
    if (items.length > 0) {
      priors.push({ id: k.id, at: k.created_at, tech: k.tech, items, miles: milesOf(k.job_id ? jobInfo.get(k.job_id)?.miles : null), decisions: decisionsOf(r) })
      needFull = false
      continue
    }
    if (needFull) {
      const { data, error } = await supabase.from('dvi').select('id,sections').eq('shop_id', shopId).eq('id', k.id).maybeSingle()
      if (!error && data) {
        const v = visitFromSections({ id: k.id, at: k.created_at, tech: k.tech, sections: normalizeSections((data as Record<string, unknown>).sections), miles: k.job_id ? jobInfo.get(k.job_id)?.miles ?? null : null, decisions: decisionsOf(r) })
        if (v.items.length > 0) { priors.push(v); needFull = false }
      }
    }
  }
  return { priors, miles: mine?.miles ?? null, more: Math.max(0, same.length - keep.length) }
}

/** The earlier inspections of this same vehicle, newest first. Re-asked a moment after the customer or car is changed. */
export function useHistory(me: HistorySubject): HistoryState {
  const [state, setState] = useState<HistoryState>({ status: 'loading' })
  const key = [me.id, me.jobId, me.customerId, personKey(me.customerName), vehicleKey(me.vehicle)].join('|')
  useEffect(() => {
    let live = true
    const t = setTimeout(() => {
      fetchHistory(me).then(r => { if (live) setState({ status: 'ready', ...r }) }).catch(() => { if (live) setState({ status: 'error' }) })
    }, 700)
    return () => { live = false; clearTimeout(t) }
    // `me` is read through `key`: the effect only reruns when the car, the person or the job really changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return state
}
