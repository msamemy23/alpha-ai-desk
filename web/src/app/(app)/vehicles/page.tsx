'use client'
import { useCallback, useEffect, useState } from 'react'
import { getShopId, supabase } from '@/lib/supabase'

export default function VehiclesPage() {
  const [customers, setCustomers] = useState<any[]>([])
  const [jobs, setJobs] = useState<any[]>([])
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
      setCustomers(customersResult.data || [])
      setJobs(jobsResult.data || [])
    } catch {
      setLoadError('Your vehicles could not be loaded. Check your connection and try again.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const vehicleMap: Record<string, any> = {}
  customers.forEach(c => {
    // FIX: Use flat columns instead of c.vehicles?.[0]
    const veh = { year: c.vehicle_year, make: c.vehicle_make, model: c.vehicle_model, vin: c.vehicle_vin, plate: c.vehicle_plate, mileage: c.vehicle_mileage }
    if (!veh.make && !veh.model) return
    const key = `${veh.vin || ''}_${veh.year || ''}_${veh.make || ''}_${veh.model || ''}`
    vehicleMap[key] = { year: veh.year, make: veh.make, model: veh.model, vin: veh.vin, plate: veh.plate, mileage: veh.mileage, owner: c.name, ownerId: c.id }
  })
  jobs.forEach(j => {
    if (!j.vehicle_make && !j.vehicle_model) return
    const key = `${j.vehicle_vin || ''}_${j.vehicle_year || ''}_${j.vehicle_make || ''}_${j.vehicle_model || ''}`
    if (!vehicleMap[key]) {
      vehicleMap[key] = { year: j.vehicle_year, make: j.vehicle_make, model: j.vehicle_model, vin: j.vehicle_vin, plate: j.vehicle_plate, mileage: j.vehicle_mileage, owner: j.customer_name }
    } else if (Number(j.vehicle_mileage) > Number(vehicleMap[key].mileage || 0)) {
      vehicleMap[key].mileage = j.vehicle_mileage
    }
  })

  const all = Object.values(vehicleMap).filter(v => {
    if (!search) return true
    const q = search.toLowerCase()
    return [v.year, v.make, v.model, v.vin, v.plate, v.owner].some((f: any) => String(f || '').toLowerCase().includes(q))
  })

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-text-primary">Vehicles Registry</h1>
          <p className="text-text-muted text-sm mt-0.5">{loading && customers.length === 0 && jobs.length === 0 ? 'Loading vehicles…' : `${all.length} vehicle${all.length !== 1 ? 's' : ''} on file`}</p>
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search vehicles..." className="form-input w-full sm:w-64" />
      </div>

      {loading && customers.length === 0 && jobs.length === 0 ? (
        <div className="space-y-2" aria-hidden="true">
          {[1,2,3,4,5].map(i => <div key={i} className="h-12 rounded-lg bg-bg-hover animate-pulse" />)}
        </div>
      ) : loadError ? (
        <div className="text-center py-16" role="alert">
          <h3 className="font-semibold text-text-primary">{loadError}</h3>
          <button className="btn btn-secondary mt-4" onClick={() => load()}>Try again</button>
        </div>
      ) : all.length === 0 ? (
        <div className="text-center py-16">
          <svg className="mx-auto mb-3 text-text-muted" width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 17h14M3 13l2-6a2 2 0 0 1 1.9-1.4h10.2A2 2 0 0 1 19 7l2 6v4a1 1 0 0 1-1 1h-1.5a1 1 0 0 1-1-1v-1h-11v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-4Z"/><circle cx="7.5" cy="14" r="1"/><circle cx="16.5" cy="14" r="1"/></svg>
          <h3 className="font-semibold text-text-primary">{search ? 'No results' : 'No vehicles yet'}</h3>
          <p className="text-text-muted text-sm mt-1">{search ? 'Try a different search' : 'Vehicles appear here when you add customers or jobs with vehicle info'}</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {['Year','Make','Model','VIN','Plate','Mileage','Owner'].map(h => (
                  <th key={h} className="text-left py-3 px-3 text-text-muted font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {all.map((v, i) => (
                <tr key={i} className="border-b border-border hover:bg-surface-hover">
                  <td className="py-3 px-3">{v.year || '\u2014'}</td>
                  <td className="py-3 px-3">{v.make || '\u2014'}</td>
                  <td className="py-3 px-3">{v.model || '\u2014'}</td>
                  <td className="py-3 px-3 font-mono text-xs">{v.vin || '\u2014'}</td>
                  <td className="py-3 px-3">{v.plate || '\u2014'}</td>
                  <td className="py-3 px-3">{v.mileage ? Number(v.mileage).toLocaleString() : '\u2014'}</td>
                  <td className="py-3 px-3">{v.owner || 'Unknown'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
