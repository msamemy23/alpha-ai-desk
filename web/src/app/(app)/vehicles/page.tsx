'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function VehiclesPage() {
  const [customers, setCustomers] = useState<any[]>([])
  const [jobs, setJobs] = useState<any[]>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    supabase.from('customers').select('*').then(({ data }) => setCustomers(data || []))
    supabase.from('jobs').select('*').then(({ data }) => setJobs(data || []))
  }, [])

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
          <p className="text-text-muted text-sm mt-0.5">{all.length} vehicle{all.length !== 1 ? 's' : ''} on file</p>
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search vehicles..." className="form-input w-full sm:w-64" />
      </div>

      {all.length === 0 ? (
        <div className="text-center py-16">
          <div className="text-4xl mb-3">\uD83D\uDE97</div>
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
