'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

interface CannedJob {
  id: string
  name: string
  category: string
  description: string
  labor_hours: number
  labor_rate: number
  parts: CannedPart[]
  total_price: number
  notes: string
  active: boolean
  created_at: string
}
interface CannedPart { name: string; part_number: string; cost: number; qty: number }

const CATEGORIES = ['All', 'Oil Change', 'Brakes', 'Tires', 'Engine', 'Suspension', 'Electrical', 'Transmission', 'A/C', 'Diagnostic', 'Maintenance', 'Other']

function fmtCur(n: number | null | undefined) {
  if (!n) return '$0'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function CannedJobsPage() {
  const [jobs, setJobs] = useState<CannedJob[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string|null|'new'>(null)
  const [form, setForm] = useState<Partial<CannedJob>>({})
  const [parts, setParts] = useState<CannedPart[]>([])
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('All')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await supabase.from('canned_jobs').select('*').order('category').order('name')
      setJobs((data || []) as CannedJob[])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const calcTotal = (laborHours: number, laborRate: number, jobParts: CannedPart[]) => {
    const labor = (laborHours || 0) * (laborRate || 0)
    const partsTotal = jobParts.reduce((s, p) => s + (p.cost || 0) * (p.qty || 1), 0)
    return labor + partsTotal
  }

  const save = async () => {
    if (!form.name) return alert('Job name is required')
    setSaving(true)
    try {
      const total = calcTotal(form.labor_hours || 0, form.labor_rate || 0, parts)
      const data = { ...form, parts, total_price: total, active: form.active !== false, updated_at: new Date().toISOString() }
      if (editing === 'new') {
        await supabase.from('canned_jobs').insert({ ...data, created_at: new Date().toISOString() })
      } else if (editing) {
        await supabase.from('canned_jobs').update(data).eq('id', editing)
      }
      setEditing(null); setForm({}); setParts([]); load()
    } finally { setSaving(false) }
  }

  const del = async () => {
    if (!editing || editing === 'new') return
    if (!confirm('Delete this canned job?')) return
    await supabase.from('canned_jobs').delete().eq('id', editing)
    setEditing(null); setForm({}); setParts([]); load()
  }

  const addPart = () => setParts(p => [...p, { name: '', part_number: '', cost: 0, qty: 1 }])
  const removePart = (i: number) => setParts(p => p.filter((_, idx) => idx !== i))
  const updatePart = (i: number, field: keyof CannedPart, value: string | number) => {
    setParts(p => p.map((part, idx) => idx === i ? { ...part, [field]: value } : part))
  }

  const openNew = () => { setForm({ active: true, labor_hours: 1, labor_rate: 125, category: 'Other' }); setParts([]); setEditing('new') }
  const openEdit = (j: CannedJob) => { setForm(j); setParts(Array.isArray(j.parts) ? j.parts : []); setEditing(j.id) }

  const filtered = jobs
    .filter(j => catFilter === 'All' || j.category === catFilter)
    .filter(j => !search || [j.name, j.category, j.description].some(v => (v||'').toLowerCase().includes(search.toLowerCase())))
    .filter(j => j.active !== false)

  const grouped: Record<string, CannedJob[]> = {}
  for (const j of filtered) {
    const cat = j.category || 'Other'
    if (!grouped[cat]) grouped[cat] = []
    grouped[cat].push(j)
  }

  const total = calcTotal(form.labor_hours || 0, form.labor_rate || 0, parts)

  if (editing !== null) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 animate-fade-in">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">{editing === 'new' ? 'New Canned Job' : 'Edit Canned Job'}</h1>
          <div className="flex gap-2">
            <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(null); setForm({}); setParts([]) }}>← Back</button>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Job'}</button>
            {editing !== 'new' && <button className="btn btn-danger btn-sm" onClick={del}>Delete</button>}
          </div>
        </div>
        <div className="max-w-2xl space-y-5">
          <div className="card space-y-4">
            <div className="text-xs font-bold uppercase tracking-wider text-text-secondary">Job Info</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="form-label">Job Name *</label>
                <input className="form-input" value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Full Synthetic Oil Change" />
              </div>
              <div>
                <label className="form-label">Category</label>
                <select className="form-select" value={form.category || 'Other'} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                  {CATEGORIES.filter(c => c !== 'All').map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="form-label">Description</label>
              <textarea className="form-input" rows={2} value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="What's included…" />
            </div>
          </div>

          <div className="card space-y-4">
            <div className="text-xs font-bold uppercase tracking-wider text-text-secondary">Labor</div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="form-label">Labor Hours</label>
                <input type="number" step="0.25" min="0" className="form-input" value={form.labor_hours || ''} onChange={e => setForm(f => ({ ...f, labor_hours: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div>
                <label className="form-label">Labor Rate ($/hr)</label>
                <input type="number" min="0" className="form-input" value={form.labor_rate || ''} onChange={e => setForm(f => ({ ...f, labor_rate: parseFloat(e.target.value) || 0 }))} />
              </div>
            </div>
          </div>

          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-wider text-text-secondary">Parts</div>
              <button className="btn btn-secondary btn-sm" onClick={addPart}>+ Add Part</button>
            </div>
            {parts.length === 0 ? (
              <div className="text-sm text-text-muted italic">No parts — click Add Part to include parts</div>
            ) : (
              <div className="space-y-2">
                {parts.map((p, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-center">
                    <input className="form-input col-span-4 text-sm" placeholder="Part name" value={p.name} onChange={e => updatePart(i, 'name', e.target.value)} />
                    <input className="form-input col-span-2 text-sm font-mono" placeholder="Part #" value={p.part_number} onChange={e => updatePart(i, 'part_number', e.target.value)} />
                    <input type="number" step="0.01" className="form-input col-span-2 text-sm" placeholder="Cost" value={p.cost || ''} onChange={e => updatePart(i, 'cost', parseFloat(e.target.value) || 0)} />
                    <input type="number" min="1" className="form-input col-span-2 text-sm" placeholder="Qty" value={p.qty || 1} onChange={e => updatePart(i, 'qty', parseInt(e.target.value) || 1)} />
                    <button className="col-span-2 text-xs text-red hover:underline" onClick={() => removePart(i)}>Remove</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card p-4 flex items-center justify-between">
            <div className="text-text-muted">Estimated Total</div>
            <div className="text-2xl font-extrabold text-green">{fmtCur(total)}</div>
          </div>

          <div className="card p-4">
            <label className="form-label">Notes / Warranty</label>
            <textarea className="form-input" rows={2} value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Warranty info, disclaimers…" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold">Canned Jobs</h1>
          <p className="text-sm text-text-muted mt-0.5">Pre-built service templates for faster estimates</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={openNew}>+ New Canned Job</button>
      </div>

      <div className="flex flex-wrap gap-2 mb-5">
        <input className="form-input flex-1 min-w-[180px] max-w-xs" placeholder="Search jobs…" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="form-select" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="card p-8 text-center text-text-muted">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="card p-12 text-center text-text-muted">
          <div className="text-5xl mb-4">🔧</div>
          <div className="text-xl font-bold mb-2">No canned jobs yet</div>
          <div className="text-sm mb-4">Create templates for your most common services to speed up estimates.</div>
          <button className="btn btn-primary" onClick={openNew}>Create First Canned Job</button>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).sort().map(([cat, catJobs]) => (
            <div key={cat}>
              <div className="text-xs font-bold uppercase tracking-wider text-text-muted mb-3">{cat}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {catJobs.map(j => (
                  <div key={j.id} className="card p-4 cursor-pointer hover:border-blue/40 transition-colors" onClick={() => openEdit(j)}>
                    <div className="flex items-start justify-between mb-2">
                      <div className="font-semibold text-sm leading-tight">{j.name}</div>
                      <div className="text-green font-bold text-sm ml-2 shrink-0">{fmtCur(j.total_price)}</div>
                    </div>
                    {j.description && <div className="text-xs text-text-muted mb-2 line-clamp-2">{j.description}</div>}
                    <div className="flex items-center gap-2 text-xs text-text-muted">
                      <span>⏱ {j.labor_hours}h labor</span>
                      {Array.isArray(j.parts) && j.parts.length > 0 && <span>· {j.parts.length} part{j.parts.length > 1 ? 's' : ''}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
