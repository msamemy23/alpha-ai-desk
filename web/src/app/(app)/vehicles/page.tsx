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
    const veh = c.vehicles?.[0] || {}
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
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Vehicles Registry</h1>
          <p className="text-text-muted text-sm mt-0.5">{all.length} vehicle{all.length !== 1 ? 's' : ''} on file</p>
        </div>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search vehicles..." className="input w-64" />
      </div>
      <div className="card overflow-x-auto">
        {all.length === 0 ? (
          <div className="text-center py-16 text-text-muted">
            <div className="text-4xl mb-3">🚗</div>
            <h3 className="font-semibold text-text-primary mb-1">{search ? 'No results' : 'No vehicles yet'}</h3>
            <p className="text-sm">{search ? 'Try a different search' : 'Vehicles appear here when you add customers or jobs with vehicle info'}</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {['Year','Make','Model','VIN','Plate','Mileage','Owner'].map(h => (
                  <th key={h} className="text-left py-3 px-4 text-text-muted font-medium text-xs uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {all.map((v, i) => (
                <tr key={i} className="border-b border-border hover:bg-bg-card/50 transition-colors">
                  <td className="py-3 px-4 font-medium">{v.year || '—'}</td>
                  <td className="py-3 px-4">{v.make || '—'}</td>
                  <td className="py-3 px-4">{v.model || '—'}</td>
                  <td className="py-3 px-4 text-xs text-text-muted font-mono">{v.vin || '—'}</td>
                  <td className="py-3 px-4">{v.plate || '—'}</td>
                  <td className="py-3 px-4">{v.mileage ? Number(v.mileage).toLocaleString() : '—'}</td>
                  <td className="py-3 px-4 text-blue font-medium">{v.owner || 'Unknown'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}