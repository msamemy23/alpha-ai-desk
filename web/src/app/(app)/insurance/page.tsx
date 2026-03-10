'use client'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

const STATUS_COLORS: Record<string, string> = {
  'New': 'bg-blue/20 text-blue border-blue/20',
  'In Progress': 'bg-purple/20 text-purple border-purple/20',
  'Waiting on Customer': 'bg-amber/20 text-amber border-amber/20',
  'Ready for Pickup': 'bg-green/20 text-green border-green/20',
  'Paid': 'bg-gray-500/20 text-gray-400 border-gray-500/20',
}

const fmt = (n: any) => n ? '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2 }) : 'N/A'

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'open', label: 'Open Only' },
  { key: 'supplement', label: 'Supplement Pending' },
  { key: 'deductible', label: 'Deductible Outstanding' },
]

export default function InsurancePage() {
  const [jobs, setJobs] = useState<any[]>([])
  const [filter, setFilter] = useState('all')

  useEffect(() => {
    supabase.from('jobs').select('*').eq('is_insurance', true).order('created_at', { ascending: false })
      .then(({ data }) => setJobs(data || []))
  }, [])

  const filtered = jobs.filter(j => {
    if (filter === 'open') return !['Paid', 'Closed'].includes(j.status)
    if (filter === 'supplement') return j.supplement_status && j.supplement_status !== 'None'
    if (filter === 'deductible') return j.deductible && Number(j.deductible) > 0
    return true
  })

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Insurance Jobs</h1>
          <p className="text-text-muted text-sm mt-0.5">{filtered.length} job{filtered.length !== 1 ? 's' : ''}</p>
        </div>
      </div>
      <div className="flex gap-2 mb-6 flex-wrap">
        {FILTERS.map(f => (
          <button key={f.key} onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${filter === f.key ? 'bg-blue text-white' : 'bg-bg-card text-text-muted hover:text-text-primary border border-border'}`}>
            {f.label}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <div className="text-center py-20 text-text-muted">
          <div className="text-4xl mb-3">🛡️</div>
          <h3 className="font-semibold text-text-primary mb-1">No insurance jobs</h3>
          <p className="text-sm">Mark a job as an insurance job to track it here</p>
        </div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))' }}>
          {filtered.map(j => (
            <a key={j.id} href="/jobs" className="card hover:border-blue/40 transition-colors cursor-pointer block">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-semibold">{j.customer_name || 'Unknown'}</div>
                  <div className="text-sm text-text-muted">{[j.vehicle_year, j.vehicle_make, j.vehicle_model].filter(Boolean).join(' ') || 'No vehicle'}</div>
                </div>
                <span className={`text-xs px-2 py-1 rounded-md font-medium border ${STATUS_COLORS[j.status] || 'bg-gray-500/20 text-gray-400 border-gray-500/20'}`}>
                  {j.status || 'New'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                {[
                  { label: 'Insurance', value: j.insurance_company },
                  { label: 'Claim #', value: j.claim_number },
                  { label: 'Adjuster', value: j.adjuster },
                  { label: 'Approved', value: fmt(j.approved_amount) },
                  { label: 'Deductible', value: fmt(j.deductible) },
                  { label: 'Supplement', value: j.supplement_status || 'None' },
                ].map(field => (
                  <div key={field.label}>
                    <div className="text-xs text-text-muted uppercase tracking-wide mb-0.5">{field.label}</div>
                    <div className="font-medium">{field.value || 'N/A'}</div>
                  </div>
                ))}
              </div>
              {j.inspection_notes && (
                <div className="mt-3 pt-3 border-t border-border text-xs text-text-muted">{j.inspection_notes}</div>
              )}
            </a>
          ))}
        </div>
      )}
    </div>
  )
}