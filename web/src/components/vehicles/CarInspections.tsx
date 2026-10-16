'use client'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import { getShopId, supabase } from '@/lib/supabase'
import { missingSchema } from '@/lib/schema-missing'
import Icon from '@/components/Icon'
import { fmtDay } from '@/components/customers/types'
import { inspectionsOfCar, tallyLamp, tallyOf, tallyWords } from '@/lib/vehicles/inspections'
import type { CarInspection, InspectionRow } from '@/lib/vehicles/inspections'
import type { Vehicle } from '@/lib/list-logic'

// A light first look at the newest inspections. customer_id comes from migration 036; until it is applied the older set is asked for.
const CAND_NEW = 'id,job_id,customer_id,customer_name,vehicle,tech,created_at'
const CAND_OLD = 'id,job_id,customer_name,vehicle,tech,created_at'
const LOOKED_AT = 400
const SHOWN = 5

type State = { status: 'loading' } | { status: 'error' } | { status: 'ready'; list: CarInspection[]; total: number }

const s = (v: unknown) => (typeof v === 'string' ? v : '')

/** Every inspection done on one car, newest first, with what was found. Each one opens in the inspection screen. */
export default function CarInspections({ vehicle }: { vehicle: Vehicle }) {
  const [state, setState] = useState<State>({ status: 'loading' })
  const [all, setAll] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const { key } = vehicle

  const jobIds = vehicle.jobs.map(j => j.id)
  const jobKey = jobIds.join(',')

  const load = useCallback(async (live: () => boolean) => {
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('no shop')
      const ask = (cols: string) => supabase.from('dvi').select(cols).eq('shop_id', shopId).order('created_at', { ascending: false }).limit(LOOKED_AT)
      let res = await ask(CAND_NEW)
      if (res.error && missingSchema(res.error)) res = await ask(CAND_OLD)
      if (res.error) throw res.error
      const rows: InspectionRow[] = ((res.data || []) as unknown as Record<string, unknown>[]).map(r => ({
        id: String(r.id), job_id: s(r.job_id) || null, customer_id: s(r.customer_id) || null,
        customer_name: s(r.customer_name), vehicle: s(r.vehicle), tech: s(r.tech), created_at: s(r.created_at),
      }))

      // Only rows that might be this car need their repair order's VIN: the ones with a repair order that is not already this car's.
      const own = new Set(jobKey ? jobKey.split(',') : [])
      const askJobs = Array.from(new Set(rows.map(r => r.job_id).filter((x): x is string => Boolean(x) && !own.has(x as string)))).slice(0, 80)
      const vins = new Map<string, string>()
      if (askJobs.length > 0 && vehicle.vin) {
        const { data, error } = await supabase.from('jobs').select('id,vehicle_vin').eq('shop_id', shopId).in('id', askJobs)
        if (!error && data) for (const j of data as unknown as Record<string, unknown>[]) vins.set(String(j.id), s(j.vehicle_vin))
      }

      const mine = inspectionsOfCar(
        { ownerId: vehicle.ownerId, owner: vehicle.owner, vin: vehicle.vin, year: vehicle.year, make: vehicle.make, model: vehicle.model, jobIds: jobKey ? jobKey.split(',') : [] },
        rows,
        id => vins.get(id) || '',
      )

      // The short summary beside each shown inspection (migration 049). A shop without it just sees no counts.
      const shown = mine.slice(0, 12)
      const summaries = new Map<string, unknown>()
      if (shown.length > 0) {
        const { data, error } = await supabase.from('dvi').select('id,digest').eq('shop_id', shopId).in('id', shown.map(r => r.id))
        if (!error && data) for (const r of data as unknown as Record<string, unknown>[]) summaries.set(String(r.id), r.digest)
        else if (error && !missingSchema(error)) throw error
      }
      if (!live()) return
      setState({ status: 'ready', total: mine.length, list: shown.map(r => ({ id: r.id, at: r.created_at, tech: r.tech, tally: tallyOf(summaries.get(r.id)) })) })
    } catch {
      if (live()) setState({ status: 'error' })
    }
    // `vehicle` is read through key and jobKey: the sheet asks again only when the car really changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, jobKey])

  useEffect(() => {
    let alive = true
    setState({ status: 'loading' }); setAll(false)
    void load(() => alive)
    return () => { alive = false }
  }, [load, attempt])

  const newestJob = vehicle.jobs[0]?.id
  const startHref = newestJob ? `/dvi?new=1&job=${encodeURIComponent(newestJob)}` : ''

  return (
    <section aria-labelledby="vs-insp">
      <h3 id="vs-insp" className="section-title mb-2">Inspections{state.status === 'ready' && state.total > 0 ? <span className="num ml-2 font-normal text-text-secondary">{state.total}</span> : null}</h3>
      {state.status === 'loading' && <p role="status" className="rounded-lg border border-border p-4 text-[0.9375rem] text-text-secondary">Loading inspections…</p>}
      {state.status === 'error' && (
        <div role="alert" className="rounded-lg border border-border p-4 text-[0.9375rem]">
          <p className="text-text-primary">The inspections for this car could not be loaded.</p>
          <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => setAttempt(n => n + 1)}>Try again</button>
        </div>
      )}
      {state.status === 'ready' && state.list.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-4 text-[0.9375rem] text-text-secondary">
          <p>No inspections for this car yet.</p>
          {startHref && <Link href={startHref} className="btn btn-secondary btn-sm mt-3 no-underline"><Icon name="inspect" className="h-5 w-5" />Start an inspection</Link>}
        </div>
      )}
      {state.status === 'ready' && state.list.length > 0 && (
        <>
          <ul className="ledger">
            {(all ? state.list : state.list.slice(0, SHOWN)).map(i => {
              const words = tallyWords(i.tally)
              return (
                <li key={i.id}>
                  <Link href={`/dvi?id=${encodeURIComponent(i.id)}`} className="ledger-row !items-start no-underline">
                    <Icon name="inspect" className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" />
                    <span className="ledger-main">
                      <span className="ledger-title block !whitespace-normal">{i.tech ? `Inspected by ${i.tech}` : 'Inspection'}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[0.9375rem] text-text-secondary">
                        <span className={`lamp lamp-${tallyLamp(i.tally)}`} aria-hidden="true" />{words || 'No summary saved'}
                      </span>
                    </span>
                    <span className="shrink-0 text-[0.875rem] text-text-secondary">{fmtDay(i.at)}</span>
                  </Link>
                </li>
              )
            })}
          </ul>
          {state.list.length > SHOWN && !all && (
            <button type="button" className="btn btn-secondary btn-sm mt-2 w-full" onClick={() => setAll(true)}>Show {state.list.length - SHOWN} more</button>
          )}
          {state.total > state.list.length && all && (
            <p className="mt-2 text-[0.875rem] text-text-secondary">Showing the newest {state.list.length} of {state.total}. Older ones open from the Inspections screen.</p>
          )}
        </>
      )}
    </section>
  )
}
