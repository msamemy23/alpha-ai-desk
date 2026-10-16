'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getShopId, supabase } from '@/lib/supabase'
import { isDirty, mergeCategories, normPart, sameCategory, sortInventory, stockState, reasonOf } from '@/lib/list-logic'
import type { InvSort } from '@/lib/list-logic'
import Icon from '@/components/Icon'
import Sheet from '@/components/Sheet'
import { EmptyBlock, ErrorCard, RowsSkeleton, SearchField, sentenceCase } from '@/components/ListKit'
import ConfirmSheet from '@/components/forms/ConfirmSheet'
import FlashNotice from '@/components/forms/FlashNotice'
import type { Flash } from '@/components/forms/FlashNotice'
import HistorySheet from '@/components/inventory/HistorySheet'
import OrderSheets from '@/components/inventory/OrderSheets'
import type { OrderCommand } from '@/components/inventory/OrderSheets'
import OrdersPanel from '@/components/inventory/OrdersPanel'
import PricingPanel from '@/components/inventory/PricingPanel'
import PartFormFields from '@/components/inventory/PartFormFields'
import ReorderPanel, { buildSuggestions } from '@/components/inventory/ReorderPanel'
import ReturnsPanel from '@/components/inventory/ReturnsPanel'
import SectionTabs from '@/components/inventory/SectionTabs'
import VendorsPanel from '@/components/inventory/VendorsPanel'
import { useStock } from '@/components/inventory/useStock'
import { PartList, PartTable } from '@/components/inventory/PartRows'
import { CATEGORIES, emptyForm, extrasChanged, toExtras, toForm, toRow, validate } from '@/components/inventory/types'
import type { Part, PartErrors, PartForm } from '@/components/inventory/types'
import { postJson } from '@/lib/client-api'
import { findByCode, normalizeCode } from '@/lib/inventory-logic'
import type { PartExtra, StockPart } from '@/lib/inventory-logic'

type Tab = 'all' | 'low' | 'on-order'
type Panel = null | 'form' | 'delete' | 'discard' | 'history'
type View = 'parts' | 'reorder' | 'orders' | 'vendors' | 'returns' | 'pricing'
const COUNT_FIELDS = ['qty_on_hand', 'qty_on_order', 'qty_reorder'] as const

const NO_SHOP = 'We could not find your shop. Try refreshing, or sign out and back in.'

export default function InventoryPage() {
  const [parts, setParts] = useState<Part[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('All')
  const [tab, setTab] = useState<Tab>('all')
  const [sort, setSort] = useState<InvSort>('name')
  const [flash, setFlash] = useState<Flash | null>(null)
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({})

  const [panel, setPanel] = useState<Panel>(null)
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [form, setForm] = useState<PartForm>(emptyForm())
  const [baseline, setBaseline] = useState<PartForm>(emptyForm())
  const [errors, setErrors] = useState<PartErrors>({})
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const afterDiscard = useRef<() => void>(() => {})

  // Vendors, orders, returns and the reorder list come from /api/inventory. The parts themselves are loaded below.
  const stock = useStock()
  const ready = stock.state.status === 'ready' ? stock.state.data : null
  // Barcode, order-up-to, case size, core charge and preferred vendor live beside the part, so a database without them still saves parts.
  const extraById = useMemo(() => new Map<string, PartExtra>((ready?.extras.value || []).map(x => [x.part_id, x])), [ready])
  const extrasShownFor = useRef<string | null>(null)
  const extrasStatus: 'loading' | 'ready' | 'unavailable' = ready ? (ready.extras.state === 'ok' ? 'ready' : 'unavailable') : stock.state.status === 'error' ? 'unavailable' : 'loading'
  const [view, setView] = useState<View>('parts')
  const [orderCmd, setOrderCmd] = useState<OrderCommand | null>(null)
  const [vendorFocus, setVendorFocus] = useState<string | null>(null)
  const [countReason, setCountReason] = useState('count')

  // Count changes are saved in the background. These keep rapid taps in order and know what to go back to if a save fails.
  const partsRef = useRef<Part[]>([])
  useEffect(() => { partsRef.current = parts }, [parts])
  const savedCount = useRef(new Map<string, number>())
  const wantedCount = useRef(new Map<string, number>())
  const inflight = useRef(new Set<string>())

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const shopId = await getShopId()
      if (!shopId) { setParts([]); setLoadError(NO_SHOP); return }
      const { data, error } = await supabase.from('inventory').select('*').eq('shop_id', shopId).order('name').limit(5000)
      if (error) throw error
      setParts((data || []) as Part[])
      setLoadError('')
    } catch {
      setLoadError('Your inventory could not be loaded. Check your connection and try again.')
    } finally { setLoading(false) }
  }, [])
  useEffect(() => {
    void load()
    const ch = supabase.channel('inventory_ch').on('postgres_changes', { event: '*', schema: 'public', table: 'inventory' }, () => { if (inflight.current.size === 0) void load() }).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  // A confirmation clears itself. An error, or a message with Undo, waits to be read.
  useEffect(() => {
    if (!flash || flash.kind === 'error') return
    const t = setTimeout(() => setFlash(null), flash.action ? 15000 : 7000)
    return () => clearTimeout(t)
  }, [flash])

  /* ---------- the form ---------- */
  const original = editing && editing !== 'new' ? parts.find(p => p.id === editing) || null : null
  const dirty = editing !== null && isDirty(form, baseline)

  const closeForm = useCallback(() => {
    setPanel(null); setEditing(null); setFormError(''); setErrors({}); setDeleteError('')
  }, [])
  const requestClose = () => {
    if (dirty) { afterDiscard.current = closeForm; setPanel('discard'); return }
    closeForm()
  }
  const openNew = () => { const f = emptyForm(); setForm(f); setBaseline(f); setErrors({}); setFormError(''); setCountReason('count'); setEditing('new'); setPanel('form') }
  const openEdit = (p: Part) => {
    const f = toForm(p, extraById.get(p.id))
    extrasShownFor.current = ready ? p.id : null
    setForm(f); setBaseline(f); setErrors({}); setFormError(''); setCountReason('count'); setEditing(p.id); setPanel('form')
  }

  // A part opened before the barcode and ordering details arrived gets them as soon as they do, as long as nothing was typed in those boxes.
  useEffect(() => {
    if (!ready || !editing || editing === 'new' || extrasShownFor.current === editing) return
    const part = parts.find(p => p.id === editing)
    if (!part) return
    extrasShownFor.current = editing
    const fresh = toForm(part, extraById.get(editing))
    const pick = (f: PartForm): PartForm => ({ ...f, barcode: fresh.barcode, max_qty: fresh.max_qty, order_multiple: fresh.order_multiple, core_charge: fresh.core_charge, preferred_vendor_id: fresh.preferred_vendor_id })
    setForm(pick); setBaseline(pick)
  }, [ready, editing, parts, extraById])

  /** A box's message goes away as soon as what is typed in it is fine. */
  const shownErrors = useMemo<PartErrors>(() => {
    const live = validate(form)
    const out: PartErrors = {}
    for (const k of Object.keys(errors) as (keyof PartErrors)[]) if (live[k]) out[k] = live[k]
    return out
  }, [errors, form])

  const save = async () => {
    if (saving) return
    const found = validate(form)
    setErrors(found)
    const first = (['name', 'cost', 'retail_price', 'qty_on_hand', 'qty_reorder', 'qty_on_order', 'barcode', 'max_qty', 'order_multiple', 'core_charge'] as const).find(k => found[k])
    if (first) {
      setFormError('')
      requestAnimationFrame(() => document.getElementById(first === 'name' ? 'inv-name' : `inv-${first}`)?.focus())
      return
    }
    setSaving(true); setFormError('')
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error(NO_SHOP)
      const row = toRow(form)
      const now = new Date().toISOString()
      let savedId: string | null = editing && editing !== 'new' ? editing : null
      if (editing === 'new') {
        const r = await supabase.from('inventory').insert({ ...row, shop_id: shopId, created_at: now, updated_at: now }).select('id').maybeSingle()
        if (r.error) throw new Error(r.error.message)
        savedId = r.data?.id ? String(r.data.id) : null
        // From here on this is a saved part: a second tap on Save changes it instead of adding it again.
        if (savedId) {
          const saved: PartForm = { ...form, barcode: '', max_qty: '', order_multiple: '', core_charge: '', preferred_vendor_id: '' }
          extrasShownFor.current = savedId
          setEditing(savedId); setBaseline(saved)
        }
      } else if (editing) {
        // The counts go through the server so the change is written to the part's history with who made it and why. Everything else
        // is saved as before.
        const saved = original
        const changed = saved ? COUNT_FIELDS.filter(k => (row[k] ?? 0) !== (saved[k] ?? 0)) : []
        const { qty_on_hand: _h, qty_on_order: _o, qty_reorder: _r, ...details } = row
        void _h; void _o; void _r
        const r = await supabase.from('inventory').update({ ...(saved ? details : row), updated_at: now }).eq('id', editing).eq('shop_id', shopId)
        if (r.error) throw new Error(r.error.message)
        for (const k of changed) {
          const a = await postJson('/api/inventory', { action: 'adjust', adjust: { part_id: editing, field: k, set: row[k], reason: k === 'qty_on_hand' ? countReason : k === 'qty_on_order' ? 'correction' : '' } })
          if (!a.ok) {
            void load()
            throw new Error(`Everything except the ${k === 'qty_on_hand' ? 'on hand' : k === 'qty_on_order' ? 'on order' : 'reorder'} number was saved. ${a.message}`)
          }
        }
      }
      // Barcode and ordering details are saved on the server; only when one of those boxes was changed, so an old database is never asked.
      const wasNew = editing === 'new'
      const base = wasNew ? emptyForm() : baseline
      if (extrasStatus === 'ready' && extrasChanged(form, base)) {
        if (!savedId) {
          void load()
          closeForm()
          setFlash({ kind: 'error', text: `${row.name} was added, but its barcode and ordering details were not saved. Open the part and add them again.` })
          return
        }
        const a = await postJson('/api/inventory', { action: 'extras-save', extras: toExtras(form, savedId) })
        if (!a.ok) {
          void load(); void stock.reload()
          if (a.fields.barcode) requestAnimationFrame(() => document.getElementById('inv-barcode')?.focus())
          throw new Error(`Everything except the barcode and ordering details was saved. ${a.message}`)
        }
        void stock.reload()
      }
      closeForm()
      setFlash({ kind: 'success', text: `${row.name} was ${wasNew ? 'added to inventory' : 'saved'}.` })
      await load()
    } catch (e) {
      setFormError(`This part was not saved. ${reasonOf(e, 'Check your connection.')} What you typed is still here. Tap Save part to try again.`)
    } finally { setSaving(false) }
  }

  const restore = async (part: Part) => {
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error(NO_SHOP)
      const r = await supabase.from('inventory').insert({ ...part, shop_id: shopId })
      if (r.error) throw new Error(r.error.message)
      setFlash({ kind: 'success', text: `${part.name} is back in inventory.` })
      await load()
    } catch (e) {
      setFlash({ kind: 'error', text: `${part.name} could not be restored. ${reasonOf(e, 'Check your connection.')} Add it again with Add part.` })
    }
  }

  const del = async () => {
    if (!editing || editing === 'new' || busy) return
    const part = original
    setBusy(true); setDeleteError('')
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error(NO_SHOP)
      const r = await supabase.from('inventory').delete().eq('id', editing).eq('shop_id', shopId)
      if (r.error) throw new Error(r.error.message)
      closeForm()
      setFlash({ kind: 'success', text: `${part?.name || 'The part'} was deleted.`, action: part ? { label: 'Undo', run: () => { void restore(part) } } : undefined })
      await load()
    } catch (e) {
      setDeleteError(`This part was not deleted. ${reasonOf(e, 'Check your connection.')} Try again.`)
    } finally { setBusy(false) }
  }

  /* ---------- the + and - buttons ---------- */
  const flush = async (id: string) => {
    inflight.current.add(id)
    try {
      for (;;) {
        const n = wantedCount.current.get(id)
        if (n === undefined) break
        const base = savedCount.current.get(id) ?? n
        const delta = n - base
        if (delta === 0) break
        // One step on the server: it changes the count by the amount tapped and writes who did it, so two people tapping at once add up.
        const r = await postJson<{ old: number | null; new: number }>('/api/inventory', { action: 'adjust', adjust: { part_id: id, field: 'qty_on_hand', delta } })
        if (!r.ok) throw new Error(r.message)
        savedCount.current.set(id, r.data.new)
        if (wantedCount.current.get(id) === n) {
          if (r.data.new !== n) setParts(ps => ps.map(x => (x.id === id ? { ...x, qty_on_hand: r.data.new } : x)))
          break
        }
      }
      wantedCount.current.delete(id); savedCount.current.delete(id)
    } catch (e) {
      const back = savedCount.current.get(id)
      wantedCount.current.delete(id); savedCount.current.delete(id)
      if (back !== undefined) setParts(ps => ps.map(x => (x.id === id ? { ...x, qty_on_hand: back } : x)))
      setRowErrors(r => ({ ...r, [id]: `The new count was not saved, so it is back to ${back ?? 'what it was'}. ${reasonOf(e, 'Check your connection.')} Tap + or − to try again.` }))
    } finally { inflight.current.delete(id) }
  }

  const adjust = (id: string, delta: number) => {
    const p = partsRef.current.find(x => x.id === id)
    if (!p) return
    const base = wantedCount.current.get(id) ?? (p.qty_on_hand || 0)
    const next = Math.max(0, base + delta)
    if (next === base) return
    if (!savedCount.current.has(id)) savedCount.current.set(id, p.qty_on_hand || 0)
    wantedCount.current.set(id, next)
    setRowErrors(e => { if (!(id in e)) return e; const rest = { ...e }; delete rest[id]; return rest })
    setParts(ps => ps.map(x => (x.id === id ? { ...x, qty_on_hand: next } : x)))
    if (!inflight.current.has(id)) void flush(id)
  }

  /* ---------- what to show ---------- */
  const categories = useMemo(() => mergeCategories(CATEGORIES, parts.map(p => p.category)), [parts])
  const formCategories = useMemo(() => mergeCategories(CATEGORIES, [form.category]), [form.category])

  const words = useMemo(() => search.trim().toLowerCase().split(/\s+/).filter(Boolean), [search])
  const filtered = useMemo(() => {
    const keep = parts.filter(p => {
      if (tab === 'low' && stockState(p.qty_on_hand, p.qty_reorder) === 'ok') return false
      if (tab === 'on-order' && !((p.qty_on_order || 0) > 0)) return false
      if (catFilter !== 'All' && !sameCategory(p.category, catFilter)) return false
      if (!words.length) return true
      const hay = [p.name, p.part_number, p.supplier_part_number, p.brand, p.category, p.supplier, p.location, p.description, extraById.get(p.id)?.barcode].map(v => String(v || '').toLowerCase()).join(' ')
      return words.every(w => hay.includes(w))
    })
    return sortInventory(keep, sort)
  }, [parts, tab, catFilter, sort, words, extraById])

  const totalValue = parts.reduce((sum, p) => sum + (p.qty_on_hand || 0) * (p.cost || 0), 0)
  const outCount = parts.filter(p => stockState(p.qty_on_hand, p.qty_reorder) === 'out').length
  const lowCount = parts.filter(p => stockState(p.qty_on_hand, p.qty_reorder) === 'low').length
  const attention = outCount + lowCount
  const onOrderCount = parts.filter(p => (p.qty_on_order || 0) > 0).length
  const duplicate = useMemo(() => {
    const pn = normPart(form.part_number)
    return pn.length >= 3 ? parts.find(p => p.id !== editing && normPart(p.part_number) === pn) || null : null
  }, [parts, form.part_number, editing])

  const suggestions = useMemo(() => buildSuggestions(ready, parts as StockPart[]), [ready, parts])
  const sectionCounts = useMemo(() => (ready ? {
    orders: ready.orders.value.filter(o => o.status === 'sent' || o.status === 'partial').length,
    vendors: ready.vendors.value.filter(v => v.active).length,
    returns: ready.returns.value.filter(r => r.status === 'open' || r.status === 'shipped').length,
  } : null), [ready])
  const openVendor = (id: string) => { setOrderCmd(null); setVendorFocus(id); setView('vendors') }

  // A scanner types the numbers and presses Enter. When that matches exactly one part by barcode or part number, open it.
  const openScanned = () => {
    const hits = findByCode(parts as StockPart[], extraById, search).filter(h => h.why !== 'starts with')
    if (hits.length === 1) { const p = parts.find(x => x.id === hits[0].part.id); if (p) openEdit(p) }
  }
  const formVendors = useMemo(() => (ready?.vendors.value || []).filter(v => v.active || v.id === form.preferred_vendor_id), [ready, form.preferred_vendor_id])
  const barcodeOwner = useMemo(() => {
    const code = normalizeCode(form.barcode)
    return code ? parts.find(p => p.id !== editing && normalizeCode(extraById.get(p.id)?.barcode) === code) || null : null
  }, [parts, form.barcode, editing, extraById])

  const firstLoad = loading && parts.length === 0 && !loadError
  const filtering = tab !== 'all' || catFilter !== 'All' || words.length > 0
  const clearFilters = () => { setTab('all'); setCatFilter('All'); setSearch('') }

  const cellBase = 'flex min-h-[5.25rem] w-full flex-col items-start justify-center gap-0.5 px-4 py-3 text-left'
  const cellBtn = `${cellBase} hover:bg-bg-hover`
  const selected = 'ring-2 ring-inset ring-blue'
  const hint = 'text-[0.875rem] leading-tight text-text-secondary'
  const label = 'flex items-center gap-2 text-[0.875rem] font-bold text-text-secondary'
  const bigNum = 'display num text-[1.75rem] font-bold leading-none'

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">Inventory</h1>
          <p className="page-subtitle">What is on your shelves and what to reorder.</p>
        </div>
        {view === 'parts' && <button type="button" className="btn btn-primary w-full sm:w-auto" onClick={openNew} disabled={firstLoad}><Icon name="plus" className="h-5 w-5" />Add part</button>}
      </header>

      {loadError && <ErrorCard className="mb-5 max-w-xl" title="Inventory could not load" message={parts.length > 0 ? `${loadError} What you see may be out of date.` : loadError} onRetry={() => void load()} busy={loading} />}
      {flash && <FlashNotice flash={flash} onDismiss={() => setFlash(null)} />}

      <SectionTabs
        label="Inventory sections" value={view} onChange={setView}
        tabs={[
          { value: 'parts', label: 'Parts', count: parts.length || undefined },
          { value: 'reorder', label: 'Reorder', count: ready ? suggestions.length : undefined },
          { value: 'orders', label: 'Orders', count: sectionCounts?.orders },
          { value: 'vendors', label: 'Vendors', count: sectionCounts?.vendors },
          { value: 'returns', label: 'Returns', count: sectionCounts?.returns },
          { value: 'pricing', label: 'Pricing' },
        ]}
      />

      {view !== 'parts' && (
        stock.state.status === 'loading' ? (
          <RowsSkeleton rows={5} label="Loading" />
        ) : stock.state.status === 'error' ? (
          <ErrorCard className="max-w-xl" title="This section could not load" message={stock.state.message} onRetry={() => void stock.reload()} />
        ) : ready && (
          view === 'reorder' ? <ReorderPanel stock={ready} suggestions={suggestions} onCommand={setOrderCmd} reload={() => void stock.reload()} />
          : view === 'orders' ? <OrdersPanel stock={ready} onCommand={setOrderCmd} reload={() => void stock.reload()} />
          : view === 'vendors' ? <VendorsPanel stock={ready} parts={parts as StockPart[]} act={stock.act} flash={setFlash} reload={() => void stock.reload()} focusId={vendorFocus} onFocused={() => setVendorFocus(null)} />
          : view === 'pricing' ? <PricingPanel stock={ready} parts={parts as StockPart[]} categories={categories} act={stock.act} flash={setFlash} reload={() => void stock.reload()} onChanged={() => void load()} />
          : <ReturnsPanel stock={ready} parts={parts as StockPart[]} act={stock.act} flash={setFlash} reload={() => void stock.reload()} />
        )
      )}

      {ready && orderCmd && (
        <OrderSheets key={orderCmd.nonce} command={orderCmd} stock={ready} parts={parts as StockPart[]} act={stock.act} flash={setFlash} onClose={() => setOrderCmd(null)} onOpenVendor={openVendor} />
      )}

      {view === 'parts' && (<>
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
          <button type="button" aria-pressed={tab === 'low'} className={`${cellBase} border-r border-border ${attention > 0 ? 'bg-amber/[0.14] hover:bg-amber/[0.2]' : 'hover:bg-bg-hover'} ${tab === 'low' ? selected : ''}`} onClick={() => setTab(tab === 'low' ? 'all' : 'low')}>
            <span className={`${label} ${attention > 0 ? '!text-amber' : ''}`}><span className={`lamp ${outCount > 0 ? 'lamp-red' : attention > 0 ? 'lamp-amber' : 'lamp-green'}`} aria-hidden="true" />Low or out</span>
            <span className={bigNum}>{attention}</span>
            <span className={hint}>{attention > 0 ? `${outCount} out, ${lowCount} low` : 'nothing to reorder'}</span>
          </button>
          <button type="button" aria-pressed={tab === 'on-order'} className={`${cellBtn} ${tab === 'on-order' ? selected : ''}`} onClick={() => setTab(tab === 'on-order' ? 'all' : 'on-order')}>
            <span className={label}><span className={`lamp ${onOrderCount > 0 ? 'lamp-blue' : 'lamp-off'}`} aria-hidden="true" />On order</span>
            <span className={bigNum}>{onOrderCount}</span>
            <span className={hint}>on the way</span>
          </button>
        </div>
      ))}

      {(parts.length > 0 || filtering) && (
        <div className="mb-3 grid grid-cols-2 gap-2 sm:flex sm:flex-row">
          <SearchField className="col-span-2 sm:min-w-0 sm:flex-1 sm:max-w-md" label="Search name, part number, barcode, brand, supplier or shelf" placeholder="Search or scan a barcode" value={search} onChange={setSearch} onEnter={openScanned} />
          <div>
            <label htmlFor="inv-cat" className="sr-only">Category</label>
            <select id="inv-cat" className="form-select sm:w-52" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
              <option value="All">All categories</option>
              {categories.map(c => <option key={c} value={c}>{sentenceCase(c)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="inv-sort" className="sr-only">Sort parts by</label>
            <select id="inv-sort" className="form-select sm:w-52" value={sort} onChange={e => setSort(e.target.value as InvSort)}>
              <option value="name">Sort: name</option>
              <option value="stock">Sort: lowest stock first</option>
              <option value="value">Sort: most stock value</option>
              <option value="margin">Sort: lowest margin</option>
            </select>
          </div>
        </div>
      )}

      {firstLoad ? (
        <RowsSkeleton rows={6} label="Loading inventory" />
      ) : loadError && parts.length === 0 ? null : parts.length === 0 ? (
        <EmptyBlock icon="box" title="No parts in inventory yet" action={<button type="button" className="btn btn-primary" onClick={openNew}><Icon name="plus" className="h-5 w-5" />Add your first part</button>}>
          Keep track of what you stock, what it costs and when to reorder. A part is flagged as low stock once it drops to your reorder level.
        </EmptyBlock>
      ) : filtered.length === 0 ? (
        <EmptyBlock icon="search" title={words.length ? `No parts match “${search.trim()}”` : 'No parts match'} action={<button type="button" className="btn btn-secondary" onClick={clearFilters}>Show all parts</button>}>
          {words.length ? 'Try a shorter search, a part number, or a different category.' : tab === 'low' ? 'Nothing is at or below its reorder level with these filters.' : tab === 'on-order' ? 'Nothing is on order with these filters.' : 'Try a different category.'}
        </EmptyBlock>
      ) : (
        <>
          <p className="mb-2 flex flex-wrap items-center gap-x-3 text-[0.9375rem] text-text-secondary" aria-live="polite">
            <span><span className="num font-bold text-text-primary">{filtered.length}</span> {filtered.length === 1 ? 'part' : 'parts'}{tab === 'low' ? ' low or out of stock' : tab === 'on-order' ? ' on order' : ''}</span>
            {filtering && <button type="button" className="inline-flex min-h-[44px] items-center font-bold text-blue underline-offset-4 hover:underline" onClick={clearFilters}>Show all parts</button>}
          </p>
          <PartList parts={filtered} errors={rowErrors} onOpen={openEdit} onAdjust={adjust} />
          <PartTable parts={filtered} errors={rowErrors} onOpen={openEdit} onAdjust={adjust} />
        </>
      )}

      </>)}

      <Sheet open={panel === 'form'} onClose={requestClose} title={editing === 'new' ? 'Add part' : 'Edit part'} wide dirty={dirty}>
        <PartFormFields
          form={form}
          setForm={setForm}
          errors={shownErrors}
          original={original}
          categories={formCategories}
          duplicate={duplicate}
          saving={saving}
          error={formError}
          onSave={() => void save()}
          onCancel={requestClose}
          onDelete={editing && editing !== 'new' ? () => { setDeleteError(''); setPanel('delete') } : undefined}
          countReason={countReason}
          onCountReason={setCountReason}
          onHistory={editing && editing !== 'new' ? () => setPanel('history') : undefined}
          extrasStatus={extrasStatus}
          vendors={formVendors}
          barcodeOwner={barcodeOwner}
        />
      </Sheet>

      {panel === 'history' && original && <HistorySheet partId={original.id} partName={original.name} onClose={() => setPanel('form')} />}

      <ConfirmSheet
        open={panel === 'delete'}
        title="Delete this part?"
        confirmLabel="Delete part"
        busyLabel="Deleting…"
        cancelLabel="Keep part"
        busy={busy}
        error={deleteError}
        onConfirm={() => void del()}
        onCancel={() => setPanel('form')}
      >
        <p>
          This removes {original?.name || 'the part'}{original?.part_number ? ` (${original.part_number})` : ''} and its stock count from inventory.
          {original && (original.qty_on_hand || 0) > 0 ? ` You have ${original.qty_on_hand} on hand.` : ''} Right after, you can tap Undo to put it back.
        </p>
      </ConfirmSheet>

      <ConfirmSheet
        open={panel === 'discard'}
        title="Discard your changes?"
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onConfirm={() => { const go = afterDiscard.current; go() }}
        onCancel={() => setPanel('form')}
      >
        <p>You typed changes that are not saved yet. If you leave now they are lost.</p>
      </ConfirmSheet>
    </div>
  )
}
