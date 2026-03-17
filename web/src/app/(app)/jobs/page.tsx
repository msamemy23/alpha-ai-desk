'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase, formatCurrency } from '@/lib/supabase'

interface Job { id: string; customer_name: string; concern: string; status: string; tech: string; priority: string; vehicle_year: string; vehicle_color: string; vehicle_engine: string; vehicle_plate: string; vehicle_make: string; vehicle_model: string; priority: string; promise_date: string; created_at: string }
interface Customer { id: string; name: string; phone: string; vehicle_year: string; vehicle_make: string; vehicle_model: string }

const STATUSES = ['New','Waiting on Parts','Waiting on Customer','Approved','In Progress','Completed','Ready for Pickup','Paid','Closed']
const STATUS_COLOR: Record<string,string> = {
  'New':'tag-blue','In Progress':'tag-amber','Completed':'tag-green','Ready for Pickup':'tag-green',
  'Waiting on Parts':'tag-amber','Waiting on Customer':'tag-amber','Paid':'tag-gray','Closed':'tag-gray','Approved':'tag-green'
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [view, setView] = useState<'list'|'kanban'>('list')
  const [editing, setEditing] = useState<string | null | 'new'>(null)
  const [form, setForm] = useState<Partial<Job & {internal_notes: string; customer_notes: string; is_insurance: boolean}>>({})
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('active')

  const load = useCallback(async () => {
    const [{ data: j }, { data: c }] = await Promise.all([
      supabase.from('jobs').select('*').order('created_at', { ascending: false }),
      supabase.from('customers').select('id,name,phone,vehicle_year,vehicle_make,vehicle_model,vehicle_color,vehicle_engine,vehicle_plate').order('name')
    ])
    setJobs((j || []) as Job[]); setCustomers((c || []) as Customer[])
  }, [])

  useEffect(() => {
    load()
    const ch = supabase.channel('jobs_page').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, load).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  const save = async () => {
    const data = { ...form, updated_at: new Date().toISOString() }
    if (editing === 'new') await supabase.from('jobs').insert({ ...data, status: data.status || 'New', created_at: new Date().toISOString() })
    else if (editing) await supabase.from('jobs').update(data).eq('id', editing)
    setEditing(null); setForm({}); load()
  }

  const del = async () => {
    if (!editing || editing === 'new') return
    if (!confirm('Delete this job?')) return
    await supabase.from('jobs').delete().eq('id', editing)
    setEditing(null); setForm({}); load()
  }

  const openNew = () => { setForm({ status: 'New', priority: 'Normal' }); setEditing('new') }
  const openEdit = (j: Job) => { setForm(j as unknown as Record<string, unknown>); setEditing(j.id) }
  const selectCustomer = (id: string) => {
    const c = customers.find(c => c.id === id)
    if (c) setForm(f => ({ ...f, customer_id: c.id, customer_name: c.name, vehicle_year: c.vehicle_year||'', vehicle_make: c.vehicle_make||'', vehicle_model: c.vehicle_model||'', vehicle_color: c.vehicle_color||'', vehicle_engine: c.vehicle_engine||'', vehicle_plate: c.vehicle_plate||'' }))
    else setForm(f => ({ ...f, customer_id: id }))
  }

  const filtered = jobs.filter(j => {
    if (statusFilter === 'active') return !['Paid','Closed'].includes(j.status)
    if (statusFilter !== 'all') return j.status === statusFilter
    return true
  }).filter(j => !search || [j.customer_name, j.concern, j.status, j.vehicle_make, j.vehicle_model].some(v => (v||'').toLowerCase().includes(search.toLowerCase())))

  const fmt = (d: string) => d ? new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric'}) : ''

  return (
    <div className="p-4 sm:p-6 lg:p-8 animate-fade-in">
      {editing !== null ? (
        /* ─── Job Form ─── */
        <div>
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-bold">{editing === 'new' ? 'New Job' : 'Edit Job'}</h1>
            <div className="flex gap-2">
              <button className="btn btn-secondary" onClick={() => { setEditing(null); setForm({}) }}>← Back</button>
              <button className="btn btn-primary" onClick={save}>Save Job</button>
              {editing !== 'new' && <button className="btn btn-danger" onClick={del}>Delete</button>}
            </div>
          </div>
          <div className="max-w-3xl space-y-6">
            <div className="card space-y-4">
              <div className="text-xs font-bold uppercase tracking-wider text-text-secondary">Customer & Vehicle</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="form-label">Customer</label>
                  <select className="form-select" value={(form as Record<string,unknown>).customer_id as string || ''} onChange={e => selectCustomer(e.target.value)}>
                    <option value="">Select customer...</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Status</label>
                  <select className="form-select" value={form.status || 'New'} onChange={e => setForm(f=>({...f,status:e.target.value}))}>
                    {STATUSES.map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {['vehicle_year','vehicle_make','vehicle_model'].map(k => (
                  <div key={k}>
                    <label className="form-label">{k.split('_').slice(1).join(' ').replace(/^\w/,c=>c.toUpperCase())}</label>
                    <input className="form-input" value={(form as Record<string,string>)[k]||''} onChange={e => setForm(f => ({...f,[k]:e.target.value}))} />
                  </div>
                ))}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="form-label">VIN</label>
                  <input className="form-input" value={(form as Record<string,string>).vehicle_vin||''} onChange={e => setForm(f=>({...f,vehicle_vin:e.target.value}))} />
                </div>
                <div>
                  <label className="form-label">Mileage</label>
                  <input className="form-input" value={(form as Record<string,string>).vehicle_mileage||''} onChange={e => setForm(f=>({...f,vehicle_mileage:e.target.value}))} />
                </div>
              </div>
            </div>

            <div className="card space-y-4">
              <div className="text-xs font-bold uppercase tracking-wider text-text-secondary">Job Details</div>
              <div>
                <label className="form-label">Customer Concern</label>
                <textarea className="form-textarea" rows={3} value={(form as Record<string,string>).concern||''} onChange={e => setForm(f=>({...f,concern:e.target.value}))} placeholder="What does the customer complain about?" />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="form-label">Tech</label>
                  <select className="form-select" value={(form as Record<string,string>).tech||''} onChange={e => setForm(f=>({...f,tech:e.target.value}))}>
                    <option value="">Unassigned</option>
                    {['Paul','Devin','Luis','Louie'].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Priority</label>
                  <select className="form-select" value={(form as Record<string,string>).priority||'Normal'} onChange={e => setForm(f=>({...f,priority:e.target.value}))}>
                    {['Low','Normal','High','Rush'].map(p => <option key={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className="form-label">Promise Date</label>
                  <input className="form-input" type="date" value={(form as Record<string,string>).promise_date||''} onChange={e => setForm(f=>({...f,promise_date:e.target.value}))} />
                </div>
              </div>
              <div>
                <label className="form-label">Internal Notes</label>
                <textarea className="form-textarea" rows={2} value={(form as Record<string,string>).internal_notes||''} onChange={e => setForm(f=>({...f,internal_notes:e.target.value}))} />
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* ─── Job List / Kanban ─── */
        <div>
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-6">
            <h1 className="text-xl sm:text-2xl font-bold">Jobs</h1>
            <div className="flex flex-wrap gap-3 w-full sm:w-auto">
              <input className="form-input w-full sm:w-56" placeholder="Search..." value={search} onChange={e => setSearch(e.target.value)} />
              <select className="form-select w-full sm:w-40" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
                <option value="active">Active Jobs</option>
                <option value="all">All Jobs</option>
                {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <div className="flex gap-1 bg-bg-card border border-border rounded-lg p-1">
                <button onClick={()=>setView('list')} className={`btn btn-sm ${view==='list'?'btn-primary':'btn-secondary border-0'}`}>List</button>
                <button onClick={()=>setView('kanban')} className={`btn btn-sm ${view==='kanban'?'btn-primary':'btn-secondary border-0'}`}>Kanban</button>
              </div>
              <button className="btn btn-primary whitespace-nowrap" onClick={openNew}>+ New Job</button>
            </div>
          </div>

          {view === 'list' ? (
            <div className="card p-0 overflow-x-auto">
              <table className="data-table w-full min-w-[640px]">
                <thead><tr>
                  <th>Customer</th><th>Vehicle</th><th>Concern</th><th>Tech</th><th>Status</th><th>Due</th><th></th>
                </tr></thead>
                <tbody>
                  {filtered.length === 0 && <tr><td colSpan={6} className="text-center text-text-muted py-8">No jobs found</td></tr>}
                  {filtered.map(j => (
                    <tr key={j.id} onClick={() => openEdit(j)} className="cursor-pointer">
                      <td className="font-medium">{j.customer_name || 'Unknown'}</td>
                      <td className="text-text-secondary">{[j.vehicle_year,j.vehicle_make,j.vehicle_model].filter(Boolean).join(' ') || '—'}</td>
                      <td className="text-text-secondary max-w-xs truncate">{j.concern}</td>
                      <td className="text-text-secondary">{j.tech || '—'}</td>
                      <td><span className={`tag ${STATUS_COLOR[j.status]||'tag-gray'}`}>{j.status}</span></td>
                      <td className="text-text-secondary">{fmt(j.promise_date)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            /* Kanban */
            <div className="flex gap-4 overflow-x-auto pb-4">
              {['New','In Progress','Waiting on Parts','Ready for Pickup','Paid'].map(col => {
                const colJobs = filtered.filter(j => j.status === col)
                return (
                  <div key={col} className="min-w-[240px] flex-shrink-0">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-sm font-semibold">{col}</span>
                      <span className="text-xs text-text-muted bg-bg-card border border-border px-2 py-0.5 rounded-full">{colJobs.length}</span>
                    </div>
                    <div className="space-y-2">
                      {colJobs.map(j => (
                        <div key={j.id} onClick={() => openEdit(j)} className="card p-3 cursor-pointer hover:border-blue/50 transition-colors">
                          <div className="font-medium text-sm">{j.customer_name || 'Unknown'}</div>
                          <div className="text-xs text-text-muted mt-0.5">{[j.vehicle_year,j.vehicle_make,j.vehicle_model].filter(Boolean).join(' ')}</div>
                          <div className="text-xs text-text-secondary mt-1 line-clamp-2">{j.concern}</div>
                          <div className="flex items-center justify-between mt-2">
                            <span className="text-xs text-text-muted">{j.tech || 'Unassigned'}</span>
                            {j.promise_date && <span className="text-xs text-amber">{fmt(j.promise_date)}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
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

