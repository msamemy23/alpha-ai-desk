'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { getShopId, supabase } from '@/lib/supabase'
import Icon from '@/components/Icon'
import Sheet from '@/components/Sheet'
import { EmptyBlock, ErrorCard, RowsSkeleton, SearchField, sentenceCase } from '@/components/ListKit'

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

// These are the saved values, so they stay as they are. Display goes through sentenceCase().
const CATEGORIES = ['All', 'Filters', 'Brakes', 'Suspension', 'Engine', 'Electrical', 'Belts & Hoses', 'Fluids & Chemicals', 'Tires', 'Exhaust', 'Cooling', 'Transmission', 'Other']

type Tab = 'all' | 'low' | 'on-order'

function fmt$(n: number | null | undefined) {
  if (n == null) return '—'
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const onHand = (p: Part) => p.qty_on_hand || 0
const isLowStock = (p: Part) => (p.qty_reorder || 0) > 0 && onHand(p) <= (p.qty_reorder || 0)
const isOutOfStock = (p: Part) => isLowStock(p) && onHand(p) === 0

/** Amber lamp and "Low stock", or red lamp and "Out of stock". Nothing for parts that are fine. */
function StockStatus({ part }: { part: Part }) {
  if (!isLowStock(part)) return null
  const out = isOutOfStock(part)
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap font-bold ${out ? 'text-red' : 'text-amber'}`}>
      <span className={`lamp ${out ? 'lamp-red' : 'lamp-amber'}`} aria-hidden="true" />
      {out ? 'Out of stock' : 'Low stock'}
    </span>
  )
}

function Stepper({ part, busy, onAdjust, compact = false }: { part: Part; busy: boolean; onAdjust: (id: string, delta: number) => void; compact?: boolean }) {
  const btn = 'inline-grid h-11 w-11 shrink-0 place-items-center rounded-md border border-[rgb(var(--c-line))] bg-bg-card text-text-primary hover:bg-bg-hover disabled:opacity-50 sm:h-10 sm:w-10'
  return (
    <div className="flex items-center gap-1" role="group" aria-label={`Quantity on hand for ${part.name}`}>
      <button type="button" className={btn} disabled={busy || onHand(part) <= 0} onClick={() => onAdjust(part.id, -1)} aria-label={`Take one ${part.name} out of stock`}>
        <Icon name="stepMinus" className="h-5 w-5" strokeWidth={2.2} />
      </button>
      <div className={`${compact ? 'w-9' : 'w-14'} text-center leading-tight`} aria-live="polite">
        <span className="display num block text-[1.25rem] font-bold">{onHand(part)}</span>
        {!compact && <span className="block text-[0.8125rem] text-text-secondary">on hand</span>}
      </div>
      <button type="button" className={btn} disabled={busy} onClick={() => onAdjust(part.id, 1)} aria-label={`Add one ${part.name} to stock`}>
        <Icon name="plus" className="h-5 w-5" strokeWidth={2.2} />
      </button>
    </div>
  )
}

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-4">
      <h3 className="display mb-3 text-[1.0625rem] font-bold">{title}</h3>
      {children}
    </section>
  )
}

export default function InventoryPage() {
  const [parts, setParts] = useState<Part[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string|null|'new'>(null)
  const [form, setForm] = useState<Partial<Part>>({})
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('All')
  const [saving, setSaving] = useState(false)
  const [tab, setTab] = useState<Tab>('all')
  const [loadError, setLoadError] = useState('')
  const [formError, setFormError] = useState('')
  const [notice, setNotice] = useState('')
  const [adjustingId, setAdjustingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const shopId = await getShopId()
      if (!shopId) { setParts([]); setLoadError('We could not find your shop. Try refreshing, or sign out and back in.'); return }
      const { data, error } = await supabase.from('inventory').select('*').eq('shop_id', shopId).order('name')
      if (error) throw error
      setParts((data || []) as Part[])
      setLoadError('')
    } catch {
      setLoadError('Your inventory could not be loaded. Check your connection and try again.')
    } finally { setLoading(false) }
  }, [])
  useEffect(() => {
    load()
    const ch = supabase.channel('inventory_ch').on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, load).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  const closeForm = useCallback(() => { setEditing(null); setForm({}); setFormError('') }, [])
  const openNew = () => { setFormError(''); setForm({ qty_on_hand: 0, qty_reorder: 0, qty_on_order: 0 }); setEditing('new') }
  const openEdit = (p: Part) => { setFormError(''); setForm(p); setEditing(p.id) }

  const save = async () => {
    if (!form.name || !form.name.trim()) {
      setFormError('Give the part a name so you can find it later.')
      document.getElementById('inv-name')?.focus()
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('We could not find your shop. Try refreshing, or sign out and back in.')
      const data = { ...form, shop_id: shopId, updated_at: new Date().toISOString() }
      if (editing === 'new') {
        const result = await supabase.from('inventory').insert({
          ...data,
          qty_on_hand: data.qty_on_hand ?? 0,
          qty_reorder: data.qty_reorder ?? 0,
          qty_on_order: data.qty_on_order ?? 0,
          created_at: new Date().toISOString(),
        })
        if (result.error) throw new Error(result.error.message)
      } else if (editing) {
        const result = await supabase.from('inventory').update(data).eq('id', editing).eq('shop_id', shopId)
        if (result.error) throw new Error(result.error.message)
      }
      closeForm()
      await load()
    } catch (error) {
      setFormError('This part was not saved. ' + (error instanceof Error ? error.message : 'Check your connection and try again.'))
    } finally { setSaving(false) }
  }

  const del = async () => {
    if (!editing || editing === 'new') return
    if (!confirm('Delete this part?')) return
    setFormError('')
    const shopId = await getShopId()
    if (!shopId) { setFormError('We could not find your shop. Try refreshing, or sign out and back in.'); return }
    const { error } = await supabase.from('inventory').delete().eq('id', editing).eq('shop_id', shopId)
    if (error) {
      setFormError('This part was not deleted. ' + error.message)
      return
    }
    closeForm()
    await load()
  }

  const adjustQty = async (id: string, delta: number) => {
    const part = parts.find(p => p.id === id)
    if (!part) return
    const newQty = Math.max(0, (part.qty_on_hand || 0) + delta)
    setNotice('')
    setAdjustingId(id)
    try {
      const shopId = await getShopId()
      if (!shopId) { setNotice('We could not find your shop. Try refreshing, or sign out and back in.'); return }
      const { error } = await supabase.from('inventory').update({ qty_on_hand: newQty, updated_at: new Date().toISOString() }).eq('id', id).eq('shop_id', shopId)
      if (error) {
        setNotice(`The count for ${part.name} was not changed. ${error.message}`)
        return
      }
      await load()
    } finally { setAdjustingId(null) }
  }

  const q = search.trim().toLowerCase()
  const filtered = useMemo(() => parts.filter(p => {
    if (tab === 'low') return isLowStock(p)
    if (tab === 'on-order') return (p.qty_on_order || 0) > 0
    return true
  }).filter(p => catFilter === 'All' || p.category === catFilter)
    .filter(p => !q || [p.name, p.part_number, p.brand, p.category, p.supplier].some(v => (v || '').toLowerCase().includes(q))), [parts, tab, catFilter, q])

  const totalValue = parts.reduce((sum, p) => sum + (p.qty_on_hand || 0) * (p.cost || 0), 0)
  const lowStockCount = parts.filter(isLowStock).length
  const onOrderCount = parts.filter(p => (p.qty_on_order || 0) > 0).length

  const firstLoad = loading && parts.length === 0 && !loadError
  const filtering = tab !== 'all' || catFilter !== 'All' || !!q
  const clearFilters = () => { setTab('all'); setCatFilter('All'); setSearch('') }

  const cellBase = 'flex min-h-[5.25rem] w-full flex-col items-start justify-center gap-0.5 px-4 py-3 text-left'
  const cellBtn = `${cellBase} hover:bg-bg-hover`
  const selected = 'ring-2 ring-inset ring-blue'
  const hint = 'text-[0.8125rem] leading-tight text-text-secondary'
  const label = 'flex items-center gap-2 text-[0.875rem] font-bold text-text-secondary'
  const bigNum = 'display num text-[1.75rem] font-bold leading-none'

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div>
          <h1 className="page-title">Inventory</h1>
          <p className="page-subtitle">What is on your shelves and what to reorder.</p>
        </div>
        <div className="toolbar">
          <button className="btn btn-primary" onClick={openNew}><Icon name="plus" className="h-5 w-5" />Add part</button>
        </div>
      </header>

      {loadError && <ErrorCard className="mb-5 max-w-xl" title="Inventory could not load" message={loadError} onRetry={load} busy={loading} />}
      {notice && (
        <div role="alert" className="mb-4 flex items-start gap-2 rounded-md border border-red/60 bg-red/[0.08] p-3">
          <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-red" />
          <p className="flex-1">{notice}</p>
          <button className="btn-icon -m-2" onClick={() => setNotice('')} aria-label="Dismiss message"><Icon name="close" className="h-5 w-5" /></button>
        </div>
      )}

      {!(loadError && parts.length === 0) && (firstLoad ? (
        <div className="skeleton mb-5 h-[11rem] sm:h-[5.25rem]" aria-hidden="true" />
      ) : parts.length > 0 && (
        <div className="panel mb-5 grid grid-cols-2 overflow-hidden sm:grid-cols-4" role="group" aria-label="Inventory summary">
          <button type="button" aria-pressed={tab === 'all'} className={`${cellBtn} border-b border-r border-border sm:border-b-0 ${tab === 'all' ? selected : ''}`} onClick={() => setTab('all')}>
            <span className={label}>All parts</span>
            <span className={bigNum}>{parts.length}</span>
            <span className={hint}>in the shop</span>
          </button>
          <div className={`${cellBase} border-b border-border sm:border-b-0 sm:border-r`}>
            <span className={label}>Stock value</span>
            <span className={bigNum}>{'$' + Math.round(totalValue).toLocaleString('en-US')}</span>
            <span className={hint}>at your cost</span>
          </div>
          <button type="button" aria-pressed={tab === 'low'} className={`${cellBase} border-r border-border ${lowStockCount > 0 ? 'bg-amber/[0.14] hover:bg-amber/[0.2]' : 'hover:bg-bg-hover'} ${tab === 'low' ? selected : ''}`} onClick={() => setTab(tab === 'low' ? 'all' : 'low')}>
            <span className={`${label} ${lowStockCount > 0 ? '!text-amber' : ''}`}><span className={`lamp ${lowStockCount > 0 ? 'lamp-amber' : 'lamp-green'}`} aria-hidden="true" />Low stock</span>
            <span className={bigNum}>{lowStockCount}</span>
            <span className={hint}>{lowStockCount > 0 ? 'at or below reorder level' : 'nothing to reorder'}</span>
          </button>
          <button type="button" aria-pressed={tab === 'on-order'} className={`${cellBtn} ${tab === 'on-order' ? selected : ''}`} onClick={() => setTab(tab === 'on-order' ? 'all' : 'on-order')}>
            <span className={label}><span className={`lamp ${onOrderCount > 0 ? 'lamp-blue' : 'lamp-off'}`} aria-hidden="true" />On order</span>
            <span className={bigNum}>{onOrderCount}</span>
            <span className={hint}>on the way</span>
          </button>
        </div>
      ))}

      {(parts.length > 0 || filtering) && (
        <div className="mb-3 flex flex-col gap-2 sm:flex-row">
          <SearchField className="sm:w-80" label="Search parts" placeholder="Search by name, part number or brand" value={search} onChange={setSearch} />
          <div>
            <label htmlFor="inv-cat" className="sr-only">Category</label>
            <select id="inv-cat" className="form-select sm:w-52" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c === 'All' ? 'All categories' : sentenceCase(c)}</option>)}
            </select>
          </div>
        </div>
      )}

      {firstLoad ? (
        <RowsSkeleton rows={6} label="Loading inventory" />
      ) : loadError && parts.length === 0 ? null : parts.length === 0 ? (
        <EmptyBlock icon="box" title="No parts in inventory yet" action={<button className="btn btn-primary" onClick={openNew}><Icon name="plus" className="h-5 w-5" />Add your first part</button>}>
          Keep track of what you stock, what it costs and when to reorder. Alpha flags a part as low stock once it drops to your reorder level.
        </EmptyBlock>
      ) : filtered.length === 0 ? (
        <EmptyBlock icon="search" title="No parts match" action={<button className="btn btn-secondary" onClick={clearFilters}>Show all parts</button>}>
          {tab === 'low' ? 'Nothing is at or below its reorder level with these filters.' : tab === 'on-order' ? 'Nothing is on order with these filters.' : 'Try a shorter search or a different category.'}
        </EmptyBlock>
      ) : (
        <>
          <p className="mb-2 flex flex-wrap items-center gap-x-3 text-[0.9375rem] text-text-secondary" aria-live="polite">
            <span><span className="num font-bold text-text-primary">{filtered.length}</span> {filtered.length === 1 ? 'part' : 'parts'}{tab === 'low' ? ' at or below reorder level' : tab === 'on-order' ? ' on order' : ''}</span>
            {filtering && <button className="font-bold text-blue underline-offset-4 hover:underline" onClick={clearFilters}>Show all parts</button>}
          </p>

          {/* Phones: a ledger row per part */}
          <ul className="ledger xl:hidden">
            {filtered.map(p => (
              <li key={p.id} className="flex items-center pr-2">
                <button type="button" className="ledger-row min-w-0 flex-1 !w-auto items-start py-3" onClick={() => openEdit(p)}>
                  <span className="ledger-main">
                    <span className="ledger-title block !whitespace-normal">{p.name}</span>
                    <span className="ledger-sub block">{[p.brand, p.part_number].filter(Boolean).join(' · ') || 'No part number'}</span>
                    <span className="ledger-sub num block">Retail {fmt$(p.retail_price)} · cost {fmt$(p.cost)}</span>
                    {(isLowStock(p) || (p.qty_on_order || 0) > 0) && (
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.875rem]">
                        <StockStatus part={p} />
                        {isLowStock(p) && <span className="text-text-secondary">reorder at {p.qty_reorder}</span>}
                        {(p.qty_on_order || 0) > 0 && <span className="inline-flex items-center gap-1.5 font-bold text-text-primary"><span className="lamp lamp-blue" aria-hidden="true" /><span className="num">{p.qty_on_order}</span> on order</span>}
                      </span>
                    )}
                    {p.location && <span className="ledger-sub block">{p.location}</span>}
                  </span>
                </button>
                <Stepper part={p} busy={adjustingId === p.id} onAdjust={adjustQty} />
              </li>
            ))}
          </ul>

          {/* Wider screens: a real table, it reads like a ledger */}
          <div className="panel hidden overflow-x-auto xl:block">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Part</th>
                  <th scope="col">Category</th>
                  <th scope="col" className="text-right">Cost</th>
                  <th scope="col" className="text-right">Retail</th>
                  <th scope="col">On hand</th>
                  <th scope="col" className="text-right">On order</th>
                  <th scope="col">Location</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(p => (
                  <tr key={p.id} className={isLowStock(p) ? 'bg-amber/[0.08]' : ''}>
                    <td>
                      <button type="button" className="min-h-[28px] text-left font-bold hover:text-blue hover:underline" onClick={() => openEdit(p)}>{p.name}</button>
                      <div className="num text-[0.875rem] text-text-secondary">{[p.brand, p.part_number].filter(Boolean).join(' · ') || 'No part number'}</div>
                    </td>
                    <td>{p.category ? <span className="tag tag-gray whitespace-nowrap !text-[0.8125rem]">{sentenceCase(p.category)}</span> : <span className="text-text-muted">—</span>}</td>
                    <td className="num whitespace-nowrap text-right">{fmt$(p.cost)}</td>
                    <td className="num whitespace-nowrap text-right">{fmt$(p.retail_price)}</td>
                    <td>
                      <div className="flex items-center gap-3">
                        <Stepper part={p} compact busy={adjustingId === p.id} onAdjust={adjustQty} />
                        <StockStatus part={p} />
                      </div>
                    </td>
                    <td className="num text-right">{(p.qty_on_order || 0) > 0 ? p.qty_on_order : <span className="text-text-muted">—</span>}</td>
                    <td className="whitespace-nowrap">{p.location || <span className="text-text-muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <Sheet open={editing !== null} onClose={closeForm} title={editing === 'new' ? 'Add part' : 'Edit part'} wide>
        <div className="space-y-5">
          {formError && (
            <div role="alert" className="flex items-start gap-2 rounded-md border border-red/60 bg-red/[0.08] p-3 text-text-primary">
              <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-red" />
              <p>{formError}</p>
            </div>
          )}

          <section>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="form-label" htmlFor="inv-name">Part name (required)</label>
                <input id="inv-name" className="form-input" aria-invalid={!!formError && !form.name} value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Oil filter" />
              </div>
              <div>
                <label className="form-label" htmlFor="inv-pn">Part number</label>
                <input id="inv-pn" className="form-input" value={form.part_number || ''} onChange={e => setForm(f => ({ ...f, part_number: e.target.value }))} placeholder="MO-301" />
              </div>
              <div>
                <label className="form-label" htmlFor="inv-brand">Brand</label>
                <input id="inv-brand" className="form-input" value={form.brand || ''} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} placeholder="Motorcraft, OEM" />
              </div>
              <div>
                <label className="form-label" htmlFor="inv-category">Category</label>
                <select id="inv-category" className="form-select" value={form.category || ''} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                  <option value="">Choose a category</option>
                  {CATEGORIES.filter(c => c !== 'All').map(c => <option key={c} value={c}>{sentenceCase(c)}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label" htmlFor="inv-loc">Storage location</label>
                <input id="inv-loc" className="form-input" value={form.location || ''} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} placeholder="Shelf A3, bin 12" />
              </div>
              <div className="sm:col-span-2">
                <label className="form-label" htmlFor="inv-desc">Description</label>
                <textarea id="inv-desc" className="form-textarea" rows={2} value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
              </div>
            </div>
          </section>

          <FormSection title="Pricing">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="form-label" htmlFor="inv-cost">Cost (what you pay)</label>
                <input id="inv-cost" type="number" inputMode="decimal" step="0.01" className="form-input num" value={form.cost || ''} onChange={e => setForm(f => ({ ...f, cost: parseFloat(e.target.value) || 0 }))} placeholder="0.00" />
              </div>
              <div>
                <label className="form-label" htmlFor="inv-retail">Retail price</label>
                <input id="inv-retail" type="number" inputMode="decimal" step="0.01" className="form-input num" value={form.retail_price || ''} onChange={e => setForm(f => ({ ...f, retail_price: parseFloat(e.target.value) || 0 }))} placeholder="0.00" />
              </div>
            </div>
          </FormSection>

          <FormSection title="Stock">
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="form-label" htmlFor="inv-onhand">On hand</label>
                <input id="inv-onhand" type="number" inputMode="numeric" className="form-input num" value={form.qty_on_hand ?? 0} onChange={e => setForm(f => ({ ...f, qty_on_hand: parseInt(e.target.value) || 0 }))} />
              </div>
              <div>
                <label className="form-label" htmlFor="inv-reorder">Reorder at</label>
                <input id="inv-reorder" type="number" inputMode="numeric" className="form-input num" value={form.qty_reorder ?? 0} onChange={e => setForm(f => ({ ...f, qty_reorder: parseInt(e.target.value) || 0 }))} />
              </div>
              <div>
                <label className="form-label" htmlFor="inv-onorder">On order</label>
                <input id="inv-onorder" type="number" inputMode="numeric" className="form-input num" value={form.qty_on_order ?? 0} onChange={e => setForm(f => ({ ...f, qty_on_order: parseInt(e.target.value) || 0 }))} />
              </div>
            </div>
            <p className="form-hint">The part shows as low stock when the amount on hand drops to the reorder number or below. Leave it at 0 to skip the warning.</p>
          </FormSection>

          <FormSection title="Supplier">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="form-label" htmlFor="inv-supplier">Supplier</label>
                <input id="inv-supplier" className="form-input" value={form.supplier || ''} onChange={e => setForm(f => ({ ...f, supplier: e.target.value }))} placeholder="AutoZone, NAPA, O'Reilly" />
              </div>
              <div>
                <label className="form-label" htmlFor="inv-spn">Supplier part number</label>
                <input id="inv-spn" className="form-input" value={form.supplier_part_number || ''} onChange={e => setForm(f => ({ ...f, supplier_part_number: e.target.value }))} />
              </div>
            </div>
          </FormSection>

          <div className="sticky bottom-[calc(-1.25rem-env(safe-area-inset-bottom))] z-10 -mx-5 flex flex-wrap items-center gap-2 border-t border-border bg-bg-card px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:-bottom-6 sm:-mx-6 sm:px-6 sm:pb-3">
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save part'}</button>
            <button type="button" className="btn btn-secondary" onClick={closeForm}>Cancel</button>
            {editing !== 'new' && <button type="button" className="btn btn-danger ml-auto" onClick={del}><Icon name="trash" className="h-4 w-4" />Delete</button>}
          </div>
        </div>
      </Sheet>
    </div>
  )
}
