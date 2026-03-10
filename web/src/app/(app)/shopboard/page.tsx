'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const STATUS_COLORS: Record<string, string> = {
  'New': 'bg-blue/20 text-blue',
  'Waiting on Parts': 'bg-amber/20 text-amber',
  'In Progress': 'bg-purple/20 text-purple',
  'Waiting on Customer': 'bg-orange-400/20 text-orange-400',
  'Ready for Pickup': 'bg-green/20 text-green',
  'Paid': 'bg-gray-500/20 text-gray-400',
  'Closed': 'bg-gray-500/20 text-gray-400',
}

const TECHS = ['Paul', 'Devin', 'Luis', 'Louie', 'Unassigned']

export default function ShopBoardPage() {
  const [jobs, setJobs] = useState<any[]>([])
  const [filter, setFilter] = useState<'active' | 'all' | 'today'>('active')

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase.from('jobs').select('*').order('created_at', { ascending: false })
      setJobs(data || [])
    }
    load()
    const ch = supabase.channel('shopboard').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, load).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [])

  const today = new Date().toDateString()
  const filtered = jobs.filter(j => {
    if (filter === 'active') return !['Paid', 'Closed'].includes(j.status)
    if (filter === 'today') return new Date(j.created_at).toDateString() === today
    return true
  })

  return (
    <div className="p-6 flex flex-col" style={{ height: 'calc(100vh - 0px)' }}>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-text-primary">Shop Board</h1>
        <div className="flex gap-2">
          {(['active', 'all', 'today'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium capitalize transition-colors ${filter === f ? 'bg-blue text-white' : 'bg-bg-card text-text-muted hover:text-text-primary border border-border'}`}>
              {f === 'active' ? 'Active Jobs' : f === 'all' ? 'All Jobs' : 'Today Only'}
            </button>
          ))}
        </div>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-4 flex-1">
        {TECHS.map(tech => {
          const techJobs = filtered.filter(j => tech === 'Unassigned' ? !j.tech : j.tech === tech)
          return (
            <div key={tech} className="flex-shrink-0 w-64 flex flex-col">
              <div className="flex items-center justify-between px-3 py-2 bg-bg-card border border-border rounded-t-lg">
                <span className="font-semibold text-sm">{tech}</span>
                <span className="bg-bg-base text-text-muted text-xs font-bold px-2 py-0.5 rounded-full">{techJobs.length}</span>
              </div>
              <div className="flex-1 bg-bg-base/50 border border-t-0 border-border rounded-b-lg p-2 space-y-2 overflow-y-auto" style={{ minHeight: 200 }}>
                {techJobs.length === 0 ? (
                  <p className="text-center text-text-muted text-xs py-8">No jobs</p>
                ) : techJobs.map(j => (
                  <a key={j.id} href={`/jobs`}
                    className="block bg-bg-card border border-border rounded-lg p-3 hover:border-blue/50 transition-colors cursor-pointer">
                    <div className="font-medium text-sm truncate mb-1">{j.customer_name || 'Unknown'}</div>
                    <div className="text-xs text-text-muted mb-1">
                      {[j.vehicle_year, j.vehicle_make, j.vehicle_model].filter(Boolean).join(' ') || 'No vehicle'}
                    </div>
                    <div className="text-xs text-text-secondary line-clamp-2 mb-2">{j.concern || ''}</div>
                    <div className="flex items-center justify-between">
                      <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${STATUS_COLORS[j.status] || 'bg-gray-500/20 text-gray-400'}`}>
                        {j.status || 'New'}
                      </span>
                      {j.promise_date && (
                        <span className="text-xs text-text-muted">Due {new Date(j.promise_date).toLocaleDateString()}</span>
                      )}
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}