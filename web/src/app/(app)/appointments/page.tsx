'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

interface Appointment {
  id: string
  customer_id: string | null
  customer_name: string
  phone: string
  vehicle: string
  service: string
  tech: string
  date: string
  time: string
  duration: number
  status: string
  notes: string
  created_at: string
}
interface Customer { id: string; name: string; phone: string; vehicle_year: string; vehicle_make: string; vehicle_model: string }

const TIMES = ['07:00','07:30','08:00','08:30','09:00','09:30','10:00','10:30','11:00','11:30','12:00','12:30','13:00','13:30','14:00','14:30','15:00','15:30','16:00','16:30','17:00','17:30','18:00']
const STATUS_COLOR: Record<string,string> = { Scheduled:'tag-blue', Confirmed:'tag-green', 'In Progress':'tag-amber', Completed:'tag-green', Cancelled:'tag-red', 'No Show':'tag-red' }
const STATUSES = ['Scheduled','Confirmed','In Progress','Completed','Cancelled','No Show']

function getWeekDays(base: Date) {
  const monday = new Date(base)
  monday.setDate(base.getDate() - ((base.getDay() + 6) % 7))
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })
}

function fmt(d: Date) { return d.toISOString().slice(0, 10) }
function fmtDisplay(d: Date) { return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) }
function fmtTime(t: string) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const ap = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${ap}`
}

export default function AppointmentsPage() {
  const [appts, setAppts] = useState<Appointment[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [techs, setTechs] = useState<string[]>(['Unassigned'])
  const [weekBase, setWeekBase] = useState(new Date())
  const [view, setView] = useState<'week'|'list'>('week')
  const [editing, setEditing] = useState<string|null|'new'>(null)
  const [form, setForm] = useState<Partial<Appointment>>({})
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const weekDays = getWeekDays(weekBase)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await supabase.from('appointments').select('*').order('date').order('time')
      setAppts((data || []) as Appointment[])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    fetch('/api/staff?role=technician').then(r => r.json()).then(d => {
      if (d.ok && d.staff) setTechs(['Unassigned', ...d.staff.map((s: {name: string}) => s.name)])
    }).catch(() => {})
    supabase.from('customers').select('id,name,phone,vehicle_year,vehicle_make,vehicle_model').order('name').then(({ data }) => setCustomers((data||[]) as Customer[]))
    const ch = supabase.channel('appts').on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, load).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  const save = async () => {
    if (!form.customer_name || !form.date || !form.time) return alert('Name, date and time are required')
    setSaving(true)
    try {
      const data = { ...form, updated_at: new Date().toISOString() }
      if (editing === 'new') {
        await supabase.from('appointments').insert({ ...data, status: data.status || 'Scheduled', created_at: new Date().toISOString() })
      } else if (editing) {
        await supabase.from('appointments').update(data).eq('id', editing)
      }
      setEditing(null); setForm({}); load()
    } finally { setSaving(false) }
  }

  const del = async () => {
    if (!editing || editing === 'new') return
    if (!confirm('Delete this appointment?')) return
    await supabase.from('appointments').delete().eq('id', editing)
    setEditing(null); setForm({}); load()
  }

  const openNew = (date?: string, time?: string) => {
    setForm({ status: 'Scheduled', duration: 60, date: date || fmt(new Date()), time: time || '09:00', tech: 'Unassigned' })
    setEditing('new')
  }

  const selectCustomer = (id: string) => {
    const c = customers.find(c => c.id === id)
    if (c) {
      const v = [c.vehicle_year, c.vehicle_make, c.vehicle_model].filter(Boolean).join(' ')
      setForm(f => ({ ...f, customer_id: c.id, customer_name: c.name, phone: c.phone || '', vehicle: v }))
    }
  }

  const todayAppts = appts.filter(a => a.date === fmt(new Date()) && !['Cancelled','Completed'].includes(a.status))
  const weekAppts = (day: Date) => appts.filter(a => a.date === fmt(day))

  if (editing !== null) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 animate-fade-in">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">{editing === 'new' ? 'New Appointment' : 'Edit Appointment'}</h1>
          <div className="flex gap-2">
            <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(null); setForm({}) }}>← Back</button>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            {editing !== 'new' && <button className="btn btn-danger btn-sm" onClick={del}>Delete</button>}
          </div>
        </div>
        <div className="max-w-2xl space-y-5">
          <div className="card space-y-4">
            <div className="text-xs font-bold uppercase tracking-wider text-text-secondary">Customer</div>
            <div>
              <label className="form-label">Existing Customer</label>
              <select className="form-select" value={form.customer_id || ''} onChange={e => selectCustomer(e.target.value)}>
                <option value="">— Walk-in / New Customer —</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="form-label">Name *</label>
                <input className="form-input" value={form.customer_name || ''} onChange={e => setForm(f => ({ ...f, customer_name: e.target.value }))} placeholder="Customer name" />
              </div>
              <div>
                <label className="form-label">Phone</label>
                <input className="form-input" value={form.phone || ''} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} placeholder="(713) 000-0000" />
              </div>
            </div>
            <div>
              <label className="form-label">Vehicle</label>
              <input className="form-input" value={form.vehicle || ''} onChange={e => setForm(f => ({ ...f, vehicle: e.target.value }))} placeholder="2018 Toyota Camry" />
            </div>
          </div>
          <div className="card space-y-4">
            <div className="text-xs font-bold uppercase tracking-wider text-text-secondary">Appointment Details</div>
            <div>
              <label className="form-label">Service</label>
              <input className="form-input" value={form.service || ''} onChange={e => setForm(f => ({ ...f, service: e.target.value }))} placeholder="Oil change, brakes, diagnosis…" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div>
                <label className="form-label">Date *</label>
                <input type="date" className="form-input" value={form.date || ''} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Time *</label>
                <select className="form-select" value={form.time || ''} onChange={e => setForm(f => ({ ...f, time: e.target.value }))}>
                  <option value="">Select time</option>
                  {TIMES.map(t => <option key={t} value={t}>{fmtTime(t)}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Duration</label>
                <select className="form-select" value={form.duration || 60} onChange={e => setForm(f => ({ ...f, duration: Number(e.target.value) }))}>
                  <option value={30}>30 min</option>
                  <option value={60}>1 hour</option>
                  <option value={90}>1.5 hrs</option>
                  <option value={120}>2 hours</option>
                  <option value={180}>3 hours</option>
                  <option value={240}>4 hours</option>
                  <option value={480}>All day</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="form-label">Technician</label>
                <select className="form-select" value={form.tech || 'Unassigned'} onChange={e => setForm(f => ({ ...f, tech: e.target.value }))}>
                  {techs.map(t => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Status</label>
                <select className="form-select" value={form.status || 'Scheduled'} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                  {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="form-label">Notes</label>
              <textarea className="form-input" rows={3} value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Customer concerns, special instructions…" />
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Appointments</h1>
          <p className="text-sm text-text-muted mt-0.5">{todayAppts.length} scheduled today</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex bg-bg-card border border-border rounded-lg overflow-hidden">
            <button className={`px-3 py-1.5 text-sm ${view === 'week' ? 'bg-blue text-white' : 'text-text-muted hover:text-text-primary'}`} onClick={() => setView('week')}>Week</button>
            <button className={`px-3 py-1.5 text-sm ${view === 'list' ? 'bg-blue text-white' : 'text-text-muted hover:text-text-primary'}`} onClick={() => setView('list')}>List</button>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => openNew()}>+ New Appointment</button>
        </div>
      </div>

      {view === 'week' ? (
        <>
          <div className="flex items-center gap-3 mb-4">
            <button className="btn btn-secondary btn-sm" onClick={() => { const d = new Date(weekBase); d.setDate(d.getDate() - 7); setWeekBase(d) }}>← Prev</button>
            <button className="btn btn-secondary btn-sm" onClick={() => setWeekBase(new Date())}>Today</button>
            <button className="btn btn-secondary btn-sm" onClick={() => { const d = new Date(weekBase); d.setDate(d.getDate() + 7); setWeekBase(d) }}>Next →</button>
            <span className="text-sm text-text-muted">{fmtDisplay(weekDays[0])} – {fmtDisplay(weekDays[6])}</span>
          </div>
          <div className="overflow-x-auto">
            <div className="grid grid-cols-7 gap-1 min-w-[700px]">
              {weekDays.map(day => {
                const isToday = fmt(day) === fmt(new Date())
                const dayAppts = weekAppts(day)
                return (
                  <div key={fmt(day)} className={`card p-2 min-h-[200px] ${isToday ? 'border-blue/50' : ''}`}>
                    <div className={`text-xs font-bold mb-2 ${isToday ? 'text-blue' : 'text-text-muted'}`}>
                      {day.toLocaleDateString('en-US', { weekday: 'short' })}
                      <br />
                      <span className={`text-lg font-extrabold ${isToday ? 'text-blue' : 'text-text-primary'}`}>{day.getDate()}</span>
                    </div>
                    <div className="space-y-1">
                      {dayAppts.map(a => (
                        <button key={a.id} className={`w-full text-left px-1.5 py-1 rounded text-[11px] leading-tight cursor-pointer hover:opacity-80 transition-opacity ${a.status === 'Cancelled' ? 'bg-red/20 text-red' : a.status === 'Completed' ? 'bg-green/20 text-green' : a.status === 'Confirmed' ? 'bg-green/30 text-green' : 'bg-blue/20 text-blue'}`} onClick={() => { setForm(a); setEditing(a.id) }}>
                          <div className="font-semibold">{fmtTime(a.time)}</div>
                          <div className="truncate">{a.customer_name}</div>
                          <div className="truncate opacity-75">{a.service}</div>
                        </button>
                      ))}
                    </div>
                    <button className="w-full mt-1 text-xs text-text-muted hover:text-blue py-0.5 rounded hover:bg-blue/10 transition-colors" onClick={() => openNew(fmt(day))}>+ add</button>
                  </div>
                )
              })}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="mb-4">
            <input className="form-input max-w-sm" placeholder="Search appointments…" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          {loading ? (
            <div className="card p-8 text-center text-text-muted">Loading…</div>
          ) : (
            <div className="card overflow-hidden">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Date & Time</th><th>Customer</th><th>Vehicle</th><th>Service</th><th>Tech</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {appts.filter(a => !search || [a.customer_name, a.service, a.vehicle].some(v => (v||'').toLowerCase().includes(search.toLowerCase()))).map(a => (
                    <tr key={a.id} className="cursor-pointer" onClick={() => { setForm(a); setEditing(a.id) }}>
                      <td className="whitespace-nowrap">
                        <div className="font-medium">{a.date ? new Date(a.date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}</div>
                        <div className="text-xs text-text-muted">{fmtTime(a.time)}</div>
                      </td>
                      <td><div className="font-medium">{a.customer_name}</div><div className="text-xs text-text-muted">{a.phone}</div></td>
                      <td className="text-sm text-text-muted">{a.vehicle || '—'}</td>
                      <td className="text-sm">{a.service || '—'}</td>
                      <td className="text-sm text-text-muted">{a.tech || '—'}</td>
                      <td><span className={`tag ${STATUS_COLOR[a.status] || 'tag-gray'}`}>{a.status}</span></td>
                    </tr>
                  ))}
                  {appts.length === 0 && (
                    <tr><td colSpan={6} className="text-center py-12 text-text-muted">
                      <div className="text-4xl mb-3">📅</div>
                      <div className="text-lg font-semibold mb-1">No appointments yet</div>
                      <button className="btn btn-primary btn-sm mt-2" onClick={() => openNew()}>Schedule First Appointment</button>
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
