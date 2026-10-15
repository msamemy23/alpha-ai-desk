'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { getShopId, supabase } from '@/lib/supabase'
import Icon from '@/components/Icon'
import { EmptyBlock, ErrorCard, RowsSkeleton, SearchField } from '@/components/ListKit'

type Row = Record<string, unknown>

interface Vehicle {
  key: string
  year: string
  make: string
  model: string
  vin: string
  plate: string
  mileage: number | null
  owner: string
}

const text = (v: unknown) => String(v ?? '').trim()

// Mileage is saved as a number on customers but sometimes as text like "84,200" on jobs.
const miles = (v: unknown): number | null => {
  const n = parseInt(String(v ?? '').replace(/[^\d]/g, ''), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

const carName = (v: Vehicle) => [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Unknown vehicle'

export default function VehiclesPage() {
  const [customers, setCustomers] = useState<Row[]>([])
  const [jobs, setJobs] = useState<Row[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const shopId = await getShopId()
      if (!shopId) { setLoadError('We could not find your shop. Try refreshing, or sign out and back in.'); return }
      const [customersResult, jobsResult] = await Promise.all([
        supabase.from('customers').select('*').eq('shop_id', shopId),
        supabase.from('jobs').select('*').eq('shop_id', shopId),
      ])
      if (customersResult.error || jobsResult.error) {
        // Keep whatever is already on screen so a failed refresh never looks like "no vehicles".
        setLoadError('Your vehicles could not be loaded. Check your connection and try again.')
        return
      }
      setLoadError(null)
      setCustomers((customersResult.data || []) as Row[])
      setJobs((jobsResult.data || []) as Row[])
    } catch {
      setLoadError('Your vehicles could not be loaded. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const vehicles = useMemo(() => {
    const map: Record<string, Vehicle> = {}
    customers.forEach(c => {
      // Customers keep their car in flat columns.
      if (!text(c.vehicle_make) && !text(c.vehicle_model)) return
      const key = `${text(c.vehicle_vin)}_${text(c.vehicle_year)}_${text(c.vehicle_make)}_${text(c.vehicle_model)}`
      map[key] = {
        key, year: text(c.vehicle_year), make: text(c.vehicle_make), model: text(c.vehicle_model), vin: text(c.vehicle_vin),
        plate: text(c.vehicle_plate), mileage: miles(c.vehicle_mileage), owner: text(c.name),
      }
    })
    jobs.forEach(j => {
      if (!text(j.vehicle_make) && !text(j.vehicle_model)) return
      const key = `${text(j.vehicle_vin)}_${text(j.vehicle_year)}_${text(j.vehicle_make)}_${text(j.vehicle_model)}`
      const jobMiles = miles(j.vehicle_mileage)
      if (!map[key]) {
        map[key] = {
          key, year: text(j.vehicle_year), make: text(j.vehicle_make), model: text(j.vehicle_model), vin: text(j.vehicle_vin),
          plate: text(j.vehicle_plate), mileage: jobMiles, owner: text(j.customer_name),
        }
      } else if (jobMiles && jobMiles > (map[key].mileage || 0)) {
        map[key].mileage = jobMiles
      }
    })
    return Object.values(map)
  }, [customers, jobs])

  const q = search.trim().toLowerCase()
  const shown = useMemo(() => (
    !q ? vehicles : vehicles.filter(v => [v.year, v.make, v.model, v.vin, v.plate, v.owner].some(f => f.toLowerCase().includes(q)))
  ), [vehicles, q])

  const hasData = customers.length > 0 || jobs.length > 0
  const firstLoad = loading && !hasData && !loadError
  const dash = <span className="text-text-muted" aria-label="Not on file">—</span>

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div>
          <h1 className="page-title">Vehicles</h1>
          <p className="page-subtitle">Every car you have worked on, with its owner, plate and mileage.</p>
        </div>
        <SearchField className="w-full sm:w-80" label="Search vehicles" placeholder="Search by car, owner, plate or VIN" value={search} onChange={setSearch} />
      </header>

      {loadError && <ErrorCard className="mb-5 max-w-xl" title="Vehicles could not load" message={loadError} onRetry={load} busy={loading} />}

      {firstLoad ? (
        <RowsSkeleton rows={6} label="Loading vehicles" />
      ) : loadError && !hasData ? null : vehicles.length === 0 ? (
        <EmptyBlock icon="vehicle" title="No vehicles yet" action={<Link href="/customers" className="btn btn-primary">Go to customers</Link>}>
          A car shows up here once a customer or a repair order has one on it.
        </EmptyBlock>
      ) : shown.length === 0 ? (
        <EmptyBlock icon="search" title={`No vehicles match “${search.trim()}”`} action={<button className="btn btn-secondary" onClick={() => setSearch('')}>Clear search</button>}>
          Try a plate, a last name or just the make.
        </EmptyBlock>
      ) : (
        <>
          <p className="mb-2 text-[0.9375rem] text-text-secondary" aria-live="polite">
            <span className="num font-bold text-text-primary">{shown.length}</span> {shown.length === 1 ? 'vehicle' : 'vehicles'}{q ? ' match your search' : ' on file'}
          </p>

          {/* Phones: one ledger row per car */}
          <ul className="ledger md:hidden">
            {shown.map(v => (
              <li key={v.key}>
                <div className="ledger-row items-start py-3">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-text-primary/[0.06] text-text-secondary"><Icon name="vehicle" className="h-5 w-5" /></span>
                  <div className="ledger-main">
                    <p className="ledger-title !whitespace-normal">{carName(v)}</p>
                    <p className="ledger-sub !whitespace-normal">{v.owner || 'Owner not on file'}</p>
                    {(v.plate || v.vin) && (
                      <p className="mt-0.5 flex flex-wrap gap-x-3 text-[0.875rem] text-text-secondary">
                        {v.plate && <span>Plate <span className="font-bold text-text-primary">{v.plate}</span></span>}
                        {v.vin && <span className="num">VIN {v.vin}</span>}
                      </p>
                    )}
                  </div>
                  {v.mileage ? (
                    <p className="ledger-amt shrink-0">{v.mileage.toLocaleString('en-US')}<span className="ml-1 text-[0.8125rem] font-normal text-text-secondary">mi</span></p>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>

          {/* Wider screens: a real table, it reads like a ledger */}
          <div className="panel hidden overflow-x-auto md:block">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Vehicle</th>
                  <th scope="col">Owner</th>
                  <th scope="col">Plate</th>
                  <th scope="col">VIN</th>
                  <th scope="col" className="text-right">Mileage</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(v => (
                  <tr key={v.key}>
                    <td className="font-bold">{carName(v)}</td>
                    <td>{v.owner || dash}</td>
                    <td>{v.plate || dash}</td>
                    <td className="num whitespace-nowrap">{v.vin || dash}</td>
                    <td className="num text-right">{v.mileage ? `${v.mileage.toLocaleString('en-US')} mi` : dash}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
