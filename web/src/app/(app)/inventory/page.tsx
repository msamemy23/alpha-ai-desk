'use client'
import { useEffect, useState, useCallback } from 'react'
import { supabase } from '@/lib/supabase'

interface Part {
  id: string
  part_number: string
  name: string
  category: string
  brand: string
  description: string
  cost: number
  retail_price: number
  qty_on_hand: number
  qty_reorder: number
  qty_on_order: number
  location: string
  supplier: string
  supplier_part_number: string
  notes: string
  last_ordered: string
  created_at: string
}

const CATEGORIES = ['All', 'Filters', 'Brakes', 'Suspension', 'Engine', 'Electrical', 'Belts & Hoses', 'Fluids & Chemicals', 'Tires', 'Exhaust', 'Cooling', 'Transmission', 'Other']

function fmt$(n: number | null | undefined) {
  if (n == null) return '—'
  return '$' + Number(n).toFixed(2)
}

export default function InventoryPage() {
  const [parts, setParts] = useState<Part[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string|null|'new'>(null)
  const [form, setForm] = useState<Partial<Part>>({})
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('All')
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<'all'|'low'|'on-order'>('all')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data } = await supabase.from('inventory').select('*').order('name')
      setParts((data || []) as Part[])
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    const ch = supabase.channel('inventory_ch').on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, load).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  const save = async () => {
    if (!form.name) return alert('Part name is required')
    setSaving(true)
    try {
      const data = { ...form, updated_at: new Date().toISOString() }
      if (editing === 'new') {
        await supabase.from('inventory').insert({ ...data, qty_on_hand: data.qty_on_hand ?? 0, qty_reorder: data.qty_reorder ?? 0, qty_on_order: data.qty_on_order ?? 0, created_at: new Date().toISOString() })
      } else if (editing) {
        await supabase.from('inventory').update(data).eq('id', editing)
      }
      setEditing(null); setForm({}); load()
    } finally { setSaving(false) }
  }

  const del = async () => {
    if (!editing || editing === 'new') return
    if (!confirm('Delete this part?')) return
    await supabase.from('inventory').delete().eq('id', editing)
    setEditing(null); setForm({}); load()
  }

  const adjustQty = async (id: string, delta: number) => {
    const part = parts.find(p => p.id === id)
    if (!part) return
    const newQty = Math.max(0, (part.qty_on_hand || 0) + delta)
    await supabase.from('inventory').update({ qty_on_hand: newQty, updated_at: new Date().toISOString() }).eq('id', id)
    load()
  }

  const filtered = parts.filter(p => {
    if (tab === 'low') return (p.qty_on_hand || 0) <= (p.qty_reorder || 0)
    if (tab === 'on-order') return (p.qty_on_order || 0) > 0
    return true
  }).filter(p => catFilter === 'All' || p.category === catFilter)
    .filter(p => !search || [p.name, p.part_number, p.brand, p.category, p.supplier].some(v => (v||'').toLowerCase().includes(search.toLowerCase())))

  const totalValue = parts.reduce((sum, p) => sum + (p.qty_on_hand || 0) * (p.cost || 0), 0)
  const lowStockCount = parts.filter(p => (p.qty_on_hand || 0) <= (p.qty_reorder || 0) && (p.qty_reorder || 0) > 0).length
  const onOrderCount = parts.filter(p => (p.qty_on_order || 0) > 0).length

  if (editing !== null) {
    return (
      <div className="p-4 sm:p-6 lg:p-8 animate-fade-in">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">{editing === 'new' ? 'Add Part' : 'Edit Part'}</h1>
          <div className="flex gap-2">
            <button className="btn btn-secondary btn-sm" onClick={() => { setEditing(null); setForm({}) }}>← Back</button>
            <button className="btn btn-primary btn-sm" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Part'}</button>
            {editing !== 'new' && <button className="btn btn-danger btn-sm" onClick={del}>Delete</button>}
          </div>
        </div>
        <div className="max-w-2xl space-y-5">
          <div className="card space-y-4">
            <div className="text-xs font-bold uppercase tracking-wider text-text-secondary">Part Info</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label className="form-label">Part Name *</label>
                <input className="form-input" value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Oil Filter" />
              </div>
              <div>
                <label className="form-label">Part Number</label>
                <input className="form-input" value={form.part_number || ''} onChange={e => setForm(f => ({ ...f, part_number: e.target.value }))} placeholder="e.g. MO-301" />
              </div>
              <div>
                <label className="form-label">Brand</label>
                <input className="form-input" value={form.brand || ''} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} placeholder="Motorcraft, OEM…" />
              </div>
              <div>
                <label className="form-label">Category</label>
                <select className="form-select" value={form.category || ''} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                  <option value="">Select category</option>
                  {CATEGORIES.filter(c => c !== 'All').map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Storage Location</label>
                <input className="form-input" value={form.location || ''} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="Shelf A3, Bin 12…" />
              </div>
            </div>
            <div>
              <label className="form-label">Description</label>
              <textarea className="form-input" rows={2} value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
            </div>
          </div>
          <div className="card space-y-4">
            <div className="text-xs font-bold uppercase tracking-wider text-text-secondary">Pricing</div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="form-label">Cost (your price)</label>
                <input type="number" step="0.01" className="form-input" value={form.cost || ''} onChange={e => setForm(f => ({ ...f, cost: parseFloat(e.target.value) || 0 }))} placeholder="0.00" />
              </div>
              <div>
                <label className="form-label">Retail Price</label>
                <input type="number" step="0.01" className="form-input" value={form.retail_price || ''} onChange={e => setForm(f => ({ ...f, retail_price: parseFloat(e.target.value) || 0 }))} placeholder="0.00" />
              </div>
            </div>
          </div>
          <div className="card space-y-4">
            <div className="text-xs font-bold uppercase tracking-wider text-text-secondary">Stock Levels</div>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="form-label">On Hand</label>
                <input type="number" className="form-input" value={form.qty_on_hand ?? 0} onChange={e => setForm(f => ({ ...f, qty_on_hand: parseInt(e.target.value) || 0 }))} />
              </div>
              <div>
                <label className="form-label">Reorder At</label>
                <input type="number" className="form-input" value={form.qty_reorder ?? 0} onChange={e => setForm(f => ({ ...f, qty_reorder: parseInt(e.target.value) || 0 }))} />
              </div>
              <div>
                <label className="form-label">On Order</label>
                <input type="number" className="form-input" value={form.qty_on_order ?? 0} onChange={e => setForm(f => ({ ...f, qty_on_order: parseInt(e.target.value) || 0 }))} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="form-label">Supplier</label>
                <input className="form-input" value={form.supplier || ''} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} placeholder="AutoZone, NAPA, OReilly…" />
              </div>
              <div>
                <label className="form-label">Supplier Part #</label>
                <input className="form-input" value={form.supplier_part_number || ''} onChange={e => setForm(f => ({ ...f, supplier_part_number: e.target.value }))} />
              </div>
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
          <h1 className="text-2xl font-bold">Inventory</h1>
          <p className="text-sm text-text-muted mt-0.5">{parts.length} parts · ${totalValue.toFixed(0)} total value</p>
        </div>
        <button className="btn btn-primary btn-sm" onClick={() => { setForm({ qty_on_hand: 0, qty_reorder: 0, qty_on_order: 0 }); setEditing('new') }}>+ Add Part</button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="card p-3 text-center">
          <div className="text-2xl font-extrabold text-text-primary">{parts.length}</div>
          <div className="text-xs text-text-muted mt-0.5">Total Parts</div>
        </div>
        <div className="card p-3 text-center">
          <div className="text-2xl font-extrabold text-green">${totalValue.toLocaleString('en-US', { maximumFractionDigits: 0 })}</div>
          <div className="text-xs text-text-muted mt-0.5">Inventory Value</div>
        </div>
        <div className={`card p-3 text-center cursor-pointer ${tab === 'low' ? 'border-red/50' : ''}`} onClick={() => setTab(tab === 'low' ? 'all' : 'low')}>
          <div className={`text-2xl font-extrabold ${lowStockCount > 0 ? 'text-red' : 'text-text-primary'}`}>{lowStockCount}</div>
          <div className="text-xs text-text-muted mt-0.5">Low Stock</div>
        </div>
        <div className={`card p-3 text-center cursor-pointer ${tab === 'on-order' ? 'border-blue/50' : ''}`} onClick={() => setTab(tab === 'on-order' ? 'all' : 'on-order')}>
          <div className="text-2xl font-extrabold text-blue">{onOrderCount}</div>
          <div className="text-xs text-text-muted mt-0.5">On Order</div>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <input className="form-input flex-1 min-w-[180px] max-w-xs" placeholder="Search parts…" value={search} onChange={e => setSearch(e.target.value)} />
        <select className="form-select" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <div className="flex bg-bg-card border border-border rounded-lg overflow-hidden">
          {(['all','low','on-order'] as const).map(t => (
            <button key={t} className={`px-3 py-1.5 text-sm capitalize ${tab === t ? 'bg-blue text-white' : 'text-text-muted hover:text-text-primary'}`} onClick={() => setTab(t)}>
              {t === 'low' ? 'Low Stock' : t === 'on-order' ? 'On Order' : 'All'}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="card p-8 text-center text-text-muted">Loading inventory…</div>
      ) : (
        <div className="card overflow-hidden">
          <table className="data-table">
            <thead>
              <tr>
                <th>Part</th><th>Part #</th><th>Category</th><th>Cost</th><th>Retail</th><th>On Hand</th><th>On Order</th><th>Location</th><th>Adjust</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => {
                const isLow = (p.qty_on_hand || 0) <= (p.qty_reorder || 0) && (p.qty_reorder || 0) > 0
                return (
                  <tr key={p.id} className={isLow ? 'bg-red/5' : ''}>
                    <td>
                      <div className="font-medium cursor-pointer hover:text-blue" onClick={() => { setForm(p); setEditing(p.id) }}>{p.name}</div>
                      {p.brand && <div className="text-xs text-text-muted">{p.brand}</div>}
                    </td>
                    <td className="text-sm font-mono text-text-muted">{p.part_number || '—'}</td>
                    <td><span className="tag tag-gray text-xs">{p.category || '—'}</span></td>
                    <td className="text-sm">{fmt$(p.cost)}</td>
                    <td className="text-sm">{fmt$(p.retail_price)}</td>
                    <td>
                      <span className={`font-bold text-sm ${isLow ? 'text-red' : 'text-text-primary'}`}>{p.qty_on_hand || 0}</span>
                      {isLow && <span className="ml-1 text-xs text-red">⚠ Low</span>}
                    </td>
                    <td className="text-sm text-text-muted">{p.qty_on_order || 0}</td>
                    <td className="text-xs text-text-muted">{p.location || '—'}</td>
                    <td>
                      <div className="flex items-center gap-1">
                        <button className="w-6 h-6 rounded bg-bg-hover hover:bg-red/20 text-text-muted hover:text-red text-xs font-bold transition-colors" onClick={() => adjustQty(p.id, -1)}>−</button>
                        <button className="w-6 h-6 rounded bg-bg-hover hover:bg-green/20 text-text-muted hover:text-green text-xs font-bold transition-colors" onClick={() => adjustQty(p.id, 1)}>+</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="text-center py-12 text-text-muted">
                  <div className="text-4xl mb-3">📦</div>
                  <div className="text-lg font-semibold mb-1">{parts.length === 0 ? 'No parts in inventory' : 'No parts match your filter'}</div>
                  {parts.length === 0 && <button className="btn btn-primary btn-sm mt-2" onClick={() => { setForm({ qty_on_hand: 0, qty_reorder: 0, qty_on_order: 0 }); setEditing('new') }}>Add First Part</button>}
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
