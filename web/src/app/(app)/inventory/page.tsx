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
import PartFormFields from '@/components/inventory/PartFormFields'
import { PartList, PartTable } from '@/components/inventory/PartRows'
import { CATEGORIES, emptyForm, toForm, toRow, validate } from '@/components/inventory/types'
import type { Part, PartErrors, PartForm } from '@/components/inventory/types'

type Tab = 'all' | 'low' | 'on-order'
type Panel = null | 'form' | 'delete' | 'discard'

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
  const openNew = () => { const f = emptyForm(); setForm(f); setBaseline(f); setErrors({}); setFormError(''); setEditing('new'); setPanel('form') }
  const openEdit = (p: Part) => { const f = toForm(p); setForm(f); setBaseline(f); setErrors({}); setFormError(''); setEditing(p.id); setPanel('form') }

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
    const first = (['name', 'cost', 'retail_price', 'qty_on_hand', 'qty_reorder', 'qty_on_order'] as const).find(k => found[k])
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
      if (editing === 'new') {
        const r = await supabase.from('inventory').insert({ ...row, shop_id: shopId, created_at: now, updated_at: now })
        if (r.error) throw new Error(r.error.message)
      } else if (editing) {
        const r = await supabase.from('inventory').update({ ...row, updated_at: now }).eq('id', editing).eq('shop_id', shopId)
        if (r.error) throw new Error(r.error.message)
      }
      closeForm()
      setFlash({ kind: 'success', text: `${row.name} was ${editing === 'new' ? 'added to inventory' : 'saved'}.` })
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
      const shopId = await getShopId()
      if (!shopId) throw new Error(NO_SHOP)
      for (;;) {
        const n = wantedCount.current.get(id)
        if (n === undefined) break
        const r = await supabase.from('inventory').update({ qty_on_hand: n, updated_at: new Date().toISOString() }).eq('id', id).eq('shop_id', shopId)
        if (r.error) throw new Error(r.error.message)
        savedCount.current.set(id, n)
        if (wantedCount.current.get(id) === n) break
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
      const hay = [p.name, p.part_number, p.supplier_part_number, p.brand, p.category, p.supplier, p.location, p.description].map(v => String(v || '').toLowerCase()).join(' ')
      return words.every(w => hay.includes(w))
    })
    return sortInventory(keep, sort)
  }, [parts, tab, catFilter, sort, words])

  const totalValue = parts.reduce((sum, p) => sum + (p.qty_on_hand || 0) * (p.cost || 0), 0)
  const outCount = parts.filter(p => stockState(p.qty_on_hand, p.qty_reorder) === 'out').length
  const lowCount = parts.filter(p => stockState(p.qty_on_hand, p.qty_reorder) === 'low').length
  const attention = outCount + lowCount
  const onOrderCount = parts.filter(p => (p.qty_on_order || 0) > 0).length
  const duplicate = useMemo(() => {
    const pn = normPart(form.part_number)
    return pn.length >= 3 ? parts.find(p => p.id !== editing && normPart(p.part_number) === pn) || null : null
  }, [parts, form.part_number, editing])

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
        <button type="button" className="btn btn-primary w-full sm:w-auto" onClick={openNew} disabled={firstLoad}><Icon name="plus" className="h-5 w-5" />Add part</button>
      </header>

      {loadError && <ErrorCard className="mb-5 max-w-xl" title="Inventory could not load" message={parts.length > 0 ? `${loadError} What you see may be out of date.` : loadError} onRetry={() => void load()} busy={loading} />}
      {flash && <FlashNotice flash={flash} onDismiss={() => setFlash(null)} />}

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
          <SearchField className="col-span-2 sm:min-w-0 sm:flex-1 sm:max-w-md" label="Search name, part number, brand, supplier or shelf" placeholder="Search parts" value={search} onChange={setSearch} />
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
        />
      </Sheet>

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
