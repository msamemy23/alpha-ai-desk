'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { getShopId, supabase } from '@/lib/supabase'
import { ageLabel } from '@/lib/today'
import { buildVehicles, carName, matchesVehicle, sortVehicles } from '@/lib/list-logic'
import type { Row, Vehicle, VehicleSort } from '@/lib/list-logic'
import Icon from '@/components/Icon'
import { EmptyBlock, ErrorCard, RowsSkeleton, SearchField } from '@/components/ListKit'
import VehicleSheet from '@/components/vehicles/VehicleSheet'

export default function VehiclesPage() {
  const [customers, setCustomers] = useState<Row[]>([])
  const [jobs, setJobs] = useState<Row[]>([])
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<VehicleSort>('recent')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const shopId = await getShopId()
      if (!shopId) { setLoadError('We could not find your shop. Try refreshing, or sign out and back in.'); return }
      // Newest repair orders first, so if a shop has more than the limit it is the old ones that drop off.
      const [customersResult, jobsResult] = await Promise.all([
        supabase.from('customers').select('*').eq('shop_id', shopId).limit(5000),
        supabase.from('jobs').select('*').eq('shop_id', shopId).order('created_at', { ascending: false }).limit(5000),
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

  useEffect(() => { void load() }, [load])

  const vehicles = useMemo(() => buildVehicles(customers, jobs), [customers, jobs])
  const shown = useMemo(() => sortVehicles(vehicles.filter(v => matchesVehicle(v, search)), sort), [vehicles, search, sort])
  const open: Vehicle | null = useMemo(() => vehicles.find(v => v.key === openKey) || null, [vehicles, openKey])

  const hasData = customers.length > 0 || jobs.length > 0
  const firstLoad = loading && !hasData && !loadError
  const term = search.trim()
  const dash = <span className="text-text-secondary" aria-label="Not on file">—</span>
  const lastIn = (v: Vehicle) => (v.lastIn ? ageLabel(v.lastIn) : '')

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">Vehicles</h1>
          <p className="page-subtitle">Every car you have worked on, with its owner and repair history.</p>
        </div>
      </header>

      {loadError && <ErrorCard className="mb-5 max-w-xl" title="Vehicles could not load" message={hasData ? `${loadError} What you see may be out of date.` : loadError} onRetry={() => void load()} busy={loading} />}

      {firstLoad ? (
        <RowsSkeleton rows={6} label="Loading vehicles" />
      ) : loadError && !hasData ? null : vehicles.length === 0 ? (
        <EmptyBlock icon="vehicle" title="No vehicles yet" action={<Link href="/customers" className="btn btn-primary">Go to customers</Link>}>
          A car shows up here once a customer or a repair order has one on it. Add a vehicle when you add a customer.
        </EmptyBlock>
      ) : (
        <>
          <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center">
            <SearchField className="min-w-0 flex-1 sm:max-w-md" label="Search vehicles" placeholder="Search car, owner, plate or VIN" value={search} onChange={setSearch} />
            <div className="flex items-center gap-2 sm:ml-auto">
              <label htmlFor="veh-sort" className="text-[0.9375rem] text-text-secondary">Sort by</label>
              <select id="veh-sort" className="form-select !w-auto flex-1 sm:flex-none" value={sort} onChange={e => setSort(e.target.value as VehicleSort)}>
                <option value="recent">Last in the shop</option>
                <option value="car">Vehicle</option>
                <option value="owner">Owner</option>
              </select>
            </div>
          </div>

          {shown.length === 0 ? (
            <EmptyBlock icon="search" title={`No vehicles match “${term}”`} action={<button type="button" className="btn btn-secondary" onClick={() => setSearch('')}>Clear search</button>}>
              Try a plate, a last name or just the make.
            </EmptyBlock>
          ) : (
            <>
              <p className="mb-2 text-[0.9375rem] text-text-secondary" aria-live="polite">
                <span className="num font-bold text-text-primary">{shown.length}</span> {shown.length === 1 ? 'vehicle' : 'vehicles'}{term ? ' match your search' : ' on file'}
              </p>

              {/* Phones: one ledger row per car */}
              <ul className="ledger md:hidden">
                {shown.map(v => (
                  <li key={v.key}>
                    <button type="button" className="ledger-row !items-start py-3" onClick={() => setOpenKey(v.key)}>
                      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-text-primary/[0.06] text-text-secondary"><Icon name="vehicle" className="h-5 w-5" /></span>
                      <span className="ledger-main">
                        <span className="ledger-title block !whitespace-normal">{carName(v)}</span>
                        <span className="ledger-sub block !whitespace-normal">{v.owner || 'Owner not on file'}</span>
                        {(v.plate || v.vin) && (
                          <span className="mt-0.5 flex flex-wrap gap-x-3 text-[0.875rem] text-text-secondary">
                            {v.plate && <span>Plate <span className="font-bold text-text-primary">{v.plate}</span></span>}
                            {v.vin && <span className="num">VIN {v.vin}</span>}
                          </span>
                        )}
                        <span className="mt-0.5 block text-[0.875rem] text-text-secondary">{lastIn(v) ? `In the shop ${lastIn(v)}` : 'No repair orders yet'}</span>
                      </span>
                      {v.mileage ? (
                        <span className="ledger-amt shrink-0">{v.mileage.toLocaleString('en-US')}<span className="ml-1 text-[0.875rem] font-normal text-text-secondary">mi</span></span>
                      ) : null}
                    </button>
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
                      <th scope="col">Last in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map(v => (
                      <tr key={v.key}>
                        <td>
                          <button type="button" className="min-h-[32px] text-left font-bold hover:text-blue hover:underline" onClick={() => setOpenKey(v.key)}>{carName(v)}</button>
                        </td>
                        <td>{v.owner || dash}</td>
                        <td>{v.plate || dash}</td>
                        <td className="num whitespace-nowrap">{v.vin || dash}</td>
                        <td className="num whitespace-nowrap text-right">{v.mileage ? `${v.mileage.toLocaleString('en-US')} mi` : dash}</td>
                        <td className="whitespace-nowrap">{lastIn(v) || <span className="text-text-secondary">No repair orders</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </>
      )}

      <VehicleSheet vehicle={open} onClose={() => setOpenKey(null)} />
    </div>
  )
}
