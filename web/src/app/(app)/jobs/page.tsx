'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase, formatCurrency } from '@/lib/supabase'

interface Job {
  id: string; ro_number: string; customer_name: string; concern: string; status: string; tech: string
  priority: string; vehicle_year: string; vehicle_color: string; vehicle_engine: string; vehicle_plate: string
  vehicle_make: string; vehicle_model: string; vehicle_vin: string; vehicle_mileage: string
  promise_date: string; created_at: string; internal_notes: string; customer_notes: string
}
interface Customer { id: string; name: string; phone: string; vehicle_year: string; vehicle_make: string; vehicle_model: string; vehicle_color: string; vehicle_engine: string; vehicle_plate: string }

const STATUSES = ['New','Waiting on Parts','Waiting on Customer','Approved','In Progress','Completed','Ready for Pickup','Paid','Closed']
const STATUS_COLOR: Record<string,string> = {
  'New':'tag-blue','In Progress':'tag-amber','Completed':'tag-green','Ready for Pickup':'tag-green',
  'Waiting on Parts':'tag-amber','Waiting on Customer':'tag-amber','Paid':'tag-gray','Closed':'tag-gray','Approved':'tag-green'
}

function toTitleCase(str: string) {
  return str.replace(/\b\w/g, c => c.toUpperCase())
}

async function generateRoNumber(): Promise<string> {
  const year = new Date().getFullYear()
  const { count } = await supabase.from('jobs').select('*', { count: 'exact', head: true })
  const seq = ((count || 0) + 1).toString().padStart(4, '0')
  return `RO-${year}-${seq}`
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<'list'|'kanban'>('list')
  const [editing, setEditing] = useState<string | null | 'new'>(null)
  const [form, setForm] = useState<Partial<Job>>({})
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')
  const [technicians, setTechnicians] = useState<string[]>(['Unassigned'])
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [{ data: j }, { data: c }] = await Promise.all([
        supabase.from('jobs').select('*').order('created_at', { ascending: false }),
        supabase.from('customers').select('id,name,phone,vehicle_year,vehicle_make,vehicle_model,vehicle_color,vehicle_engine,vehicle_plate').order('name')
      ])
      setJobs((j || []) as Job[])
      setCustomers((c || []) as Customer[])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    fetch('/api/staff?role=technician').then(r => r.json()).then(d => {
      if (d.ok && d.staff) setTechnicians(['Unassigned', ...d.staff.map((s: {name: string}) => s.name)])
    }).catch(() => {})
    const ch = supabase.channel('jobs_page').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, load).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  const save = async () => {
    setSaving(true)
    try {
      const data = { ...form, updated_at: new Date().toISOString() }
      if (editing === 'new') {
        const ro_number = await generateRoNumber()
        await supabase.from('jobs').insert({ ...data, ro_number, status: data.status || 'New', created_at: new Date().toISOString() })
      } else if (editing) {
        await supabase.from('jobs').update(data).eq('id', editing)
      }
      setEditing(null); setForm({}); load()
    } finally { setSaving(false) }
  }

  const del = async () => {
    if (!editing || editing === 'new') return
    if (!confirm('Delete this job?')) return
    await supabase.from('jobs').delete().eq('id', editing)
    setEditing(null); setForm({}); load()
  }

  const openNew = () => { setForm({ status: 'New', priority: 'Normal' }); setEditing('new') }
  const openEdit = (j: Job) => { setForm(j as unknown as Partial<Job>); setEditing(j.id) }

  const selectCustomer = (id: string) => {
    const c = customers.find(c => c.id === id)
    if (c) setForm(f => ({ ...f, customer_id: c.id, customer_name: c.name, vehicle_year: c.vehicle_year||'', vehicle_make: c.vehicle_make||'', vehicle_model: c.vehicle_model||'', vehicle_color: c.vehicle_color||'', vehicle_engine: c.vehicle_engine||'', vehicle_plate: c.vehicle_plate||'' }))
    else setForm(f => ({ ...f, customer_id: id }))
  }

  const filtered = jobs.filter(j => {
    if (statusFilter === 'active') return !['Paid','Closed'].includes(j.status)
    if (statusFilter !== 'all') return j.status === statusFilter
    return true
  }).filter(j => !search || [j.customer_name, j.concern, j.status, j.vehicle_make, j.vehicle_model, j.ro_number].some(v => (v||'').toLowerCase().includes(search.toLowerCase())))

  const fmt = (d: string) => d ? new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : ''

  if (loading && jobs.length === 0) {
    return (
      <div className="p-4 sm:p-6 lg:p-8">
        <div className="flex items-center justify-between mb-6">
          <div className="h-8 w-24 bg-bg-card rounded animate-pulse" />
          <div className="h-9 w-28 bg-bg-card rounded animate-pulse" />
        </div>
        <div className="card overflow-hidden">
          {[1,2,3,4,5].map(i => (
            <div key={i} className="flex gap-4 p-4 border-b border-border last:border-0 animate-pulse">
              <div className="h-4 w-24 bg-bg-hover rounded" />
              <div className="h-4 w-32 bg-bg-hover rounded" />
              <div className="h-4 w-40 bg-bg-hover rounded" />
              <div className="h-4 w-48 bg-bg-hover rounded flex-1" />
              <div className="h-5 w-20 bg-bg-hover rounded-full" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 animate-fade-in">
      {editing !== null ? (
        <div>
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold">{editing === 'new' ? 'New Job' : 'Edit Job'}</h1>
              {editing !== 'new' && form.ro_number && <div className="text-sm text-text-muted font-mono mt-0.5">{form.ro_number}</div>}
            </div>
            <div className="flex gap-2">
              <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(null); setForm({}) }}>← Back</button>
              <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Job'}</button>
              {editing !== 'new' && <button className="btn btn-danger btn-sm" onClick={del}>Delete</button>}
            </div>
          </div>
          <div className="max-w-3xl space-y-6">
            <div className="card space-y-4">
              <div className="text-xs font-bold uppercase tracking-wider text-text-secondary">Customer & Vehicle</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="form-label">Customer</label>
                  <select className="form-select" value={(form as Record<string,string>).customer_id || ''} onChange={e => selectCustomer(e.target.value)}>
                    <option value="">Select customer...</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Customer Name</label>
                  <input className="form-input" value={form.customer_name||''} onChange={e => setForm(f=>({...f,customer_name:toTitleCase(e.target.value)}))} placeholder="Customer name" />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {(['vehicle_year','vehicle_make','vehicle_model'] as const).map(k => (
                  <div key={k}>
                    <label className="form-label">{k.split('_').slice(1).join(' ').replace(/^\w/,c=>c.toUpperCase())}</label>
                    <input className="form-input" value={(form as Record<string,string>)[k]||''} onChange={e => setForm(f=>({...f,[k]:e.target.value}))} />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="form-label">VIN</label>
                  <input className="form-input font-mono text-sm" value={form.vehicle_vin||''} onChange={e=>setForm(f=>({...f,vehicle_vin:e.target.value.toUpperCase()}))} placeholder="17-digit VIN" />
                </div>
                <div>
                  <label className="form-label">Mileage In</label>
                  <input className="form-input" value={form.vehicle_mileage||''} onChange={e=>setForm(f=>({...f,vehicle_mileage:e.target.value}))} placeholder="e.g. 87,432" />
                </div>
              </div>
            </div>
            <div className="card space-y-4">
              <div className="text-xs font-bold uppercase tracking-wider text-text-secondary">Job Details</div>
              <div>
                <label className="form-label">Customer Concern</label>
                <textarea className="form-input" rows={3} value={form.concern||''} onChange={e=>setForm(f=>({...f,concern:e.target.value}))} placeholder="What does the customer say is wrong?" />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div>
                  <label className="form-label">Status</label>
                  <select className="form-select" value={form.status||'New'} onChange={e=>setForm(f=>({...f,status:e.target.value}))}>
                    {STATUSES.map(s=><option key={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Tech</label>
                  <select className="form-select" value={form.tech||''} onChange={e=>setForm(f=>({...f,tech:e.target.value}))}>
                    {technicians.map(t=><option key={t} value={t==='Unassigned'?'':t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Priority</label>
                  <select className="form-select" value={form.priority||'Normal'} onChange={e=>setForm(f=>({...f,priority:e.target.value}))}>
                    {['Low','Normal','High','Rush'].map(p=><option key={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Promise Date</label>
                  <input className="form-input" type="date" value={form.promise_date||''} onChange={e=>setForm(f=>({...f,promise_date:e.target.value}))} />
                </div>
              </div>
              <div>
                <label className="form-label">Internal Notes</label>
                <textarea className="form-input" rows={2} value={form.internal_notes||''} onChange={e=>setForm(f=>({...f,internal_notes:e.target.value}))} placeholder="Notes for technicians only" />
              </div>
              <div>
                <label className="form-label">Customer Notes</label>
                <textarea className="form-input" rows={2} value={form.customer_notes||''} onChange={e=>setForm(f=>({...f,customer_notes:e.target.value}))} placeholder="Notes printed on customer paperwork" />
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
            <h1 className="text-xl sm:text-2xl font-bold">Jobs</h1>
            <div className="flex flex-wrap gap-2 w-full sm:w-auto">
              <input className="form-input w-full sm:w-56" placeholder="Search jobs, RO#..." value={search} onChange={e=>setSearch(e.target.value)} />
              <select className="form-select" value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>
                <option value="active">Active Jobs</option>
                <option value="all">All Jobs</option>
                {STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
              </select>
              <div className="flex gap-1 bg-bg-card border border-border rounded-lg p-1">
                <button onClick={()=>setView('list')} className={`btn btn-sm ${view==='list'?'btn-primary':'btn-secondary border-0'}`}>List</button>
                <button onClick={()=>setView('kanban')} className={`btn btn-sm ${view==='kanban'?'btn-primary':'btn-secondary border-0'}`}>Board</button>
              </div>
              <button className="btn btn-primary whitespace-nowrap" onClick={openNew}>+ New Job</button>
            </div>
          </div>

          {view === 'list' ? (
            <div className="card overflow-x-auto">
              <table className="data-table w-full min-w-[700px]">
                <thead>
                  <tr><th>RO #</th><th>Customer</th><th>Vehicle</th><th>Concern</th><th>Tech</th><th>Status</th><th>Due</th></tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && !loading ? (
                    <tr>
                      <td colSpan={7} className="text-center py-16 text-text-muted">
                        <div className="text-5xl mb-3">🔧</div>
                        <div className="text-lg font-semibold mb-2">{jobs.length === 0 ? 'No jobs yet' : 'No jobs match your filter'}</div>
                        {jobs.length === 0 && <button className="btn btn-primary mt-1" onClick={openNew}>+ Create First Job</button>}
                      </td>
                    </tr>
                  ) : filtered.map(j => (
                    <tr key={j.id} onClick={()=>openEdit(j)} className="cursor-pointer">
                      <td className="font-mono text-xs text-text-muted whitespace-nowrap">{j.ro_number||'—'}</td>
                      <td className="font-medium">{j.customer_name||'Unknown'}</td>
                      <td className="text-text-muted text-sm">{[j.vehicle_year,j.vehicle_make,j.vehicle_model].filter(Boolean).join(' ')||'—'}</td>
                      <td className="text-text-muted max-w-xs truncate text-sm">{j.concern||'—'}</td>
                      <td className="text-text-muted text-sm">{j.tech||'—'}</td>
                      <td><span className={`tag ${STATUS_COLOR[j.status]||'tag-gray'}`}>{j.status}</span></td>
                      <td className={`text-sm ${j.promise_date&&new Date(j.promise_date)<new Date()&&!['Paid','Closed','Completed'].includes(j.status)?'text-red font-semibold':'text-text-muted'}`}>{fmt(j.promise_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex gap-4 overflow-x-auto pb-4">
              {['New','Approved','In Progress','Waiting on Parts','Ready for Pickup','Paid'].map(col => {
                const colJobs = filtered.filter(j=>j.status===col)
                return (
                  <div key={col} className="min-w-[240px] flex-shrink-0">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-semibold">{col}</span>
                      <span className="text-xs text-text-muted bg-bg-card border border-border px-2 py-0.5 rounded-full">{colJobs.length}</span>
                    </div>
                    {colJobs.length===0 ? (
                      <div className="card p-4 border-dashed text-center text-xs text-text-muted">No jobs</div>
                    ) : (
                      <div className="space-y-2">
                        {colJobs.map(j=>(
                          <div key={j.id} onClick={()=>openEdit(j)} className="card p-3 cursor-pointer hover:border-blue/50 transition-colors">
                            <div className="flex items-start justify-between mb-1">
                              <div className="font-medium text-sm">{j.customer_name||'Unknown'}</div>
                              {j.ro_number&&<span className="text-[10px] font-mono text-text-muted">{j.ro_number}</span>}
                            </div>
                            <div className="text-xs text-text-muted">{[j.vehicle_year,j.vehicle_make,j.vehicle_model].filter(Boolean).join(' ')}</div>
                            <div className="text-xs text-text-secondary mt-1 line-clamp-2">{j.concern}</div>
                            <div className="flex items-center justify-between mt-2">
                              <span className="text-xs text-text-muted">{j.tech||'Unassigned'}</span>
                              {j.promise_date&&<span className={`text-xs ${new Date(j.promise_date)<new Date()?'text-red':'text-amber'}`}>{fmt(j.promise_date)}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
