'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getShopId, supabase } from '@/lib/supabase'
import Icon from '@/components/Icon'
import Sheet from '@/components/Sheet'
import { EmptyBlock, ErrorCard, FilterChips, RowsSkeleton, SearchField, sentenceCase } from '@/components/ListKit'
import ConfirmSheet from '@/components/inventory/ConfirmSheet'
import FlashNotice from '@/components/inventory/FlashNotice'
import type { Flash } from '@/components/inventory/FlashNotice'
import JobForm from '@/components/canned-jobs/JobForm'
import InventoryPicker from '@/components/canned-jobs/InventoryPicker'
import type { StockPart } from '@/components/canned-jobs/InventoryPicker'
import { DEFAULT_CATEGORIES, emptyForm, hasErrors, money, newKey, toForm, toRow, toRows, validate } from '@/components/canned-jobs/types'
import type { CannedJob, JobErrors, JobForm as Form, PartRow } from '@/components/canned-jobs/types'
import { isDirty, mergeCategories, reasonOf, sameCategory } from '@/lib/list-logic'

type Panel = null | 'form' | 'pick' | 'delete' | 'discard'
type Status = 'all' | 'on' | 'hidden'

const NO_SHOP = 'We could not find your shop. Try refreshing, or sign out and back in.'
const noErrors = (): JobErrors => ({ rows: {} })

const hay = (j: CannedJob) => [j.name, j.category, j.description, ...(Array.isArray(j.parts) ? j.parts.flatMap(p => [p.name, p.part_number]) : [])].join(' ').toLowerCase()

export default function CannedJobsPage() {
  const [jobs, setJobs] = useState<CannedJob[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [shopRate, setShopRate] = useState<number | null>(null)
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState('All')
  const [status, setStatus] = useState<Status>('all')
  const [flash, setFlash] = useState<Flash | null>(null)

  const [panel, setPanel] = useState<Panel>(null)
  const [editing, setEditing] = useState<string | 'new' | null>(null)
  const [form, setForm] = useState<Form>(emptyForm(null))
  const [rows, setRows] = useState<PartRow[]>([])
  const [baseline, setBaseline] = useState<{ form: Form; rows: PartRow[] }>({ form: emptyForm(null), rows: [] })
  const [errors, setErrors] = useState<JobErrors>(noErrors())
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const afterDiscard = useRef<() => void>(() => {})

  const [stock, setStock] = useState<StockPart[] | null>(null)
  const [stockLoading, setStockLoading] = useState(false)
  const [stockError, setStockError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const shopId = await getShopId()
      if (!shopId) { setJobs([]); setLoadError(NO_SHOP); return }
      const [{ data, error }, settings] = await Promise.all([
        supabase.from('canned_jobs').select('*').eq('shop_id', shopId).order('category').order('name').limit(2000),
        supabase.from('settings').select('labor_rate').eq('shop_id', shopId).maybeSingle(),
      ])
      if (error) throw error
      setJobs((data || []) as CannedJob[])
      const r = Number(settings.data?.labor_rate)
      setShopRate(r > 0 ? r : null)
      setLoadError('')
    } catch {
      setLoadError('Your canned jobs could not be loaded. Check your connection and try again.')
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!flash || flash.kind === 'error') return
    const t = setTimeout(() => setFlash(null), flash.action ? 15000 : 7000)
    return () => clearTimeout(t)
  }, [flash])

  /* ---------- the form ---------- */
  const original = editing && editing !== 'new' ? jobs.find(j => j.id === editing) || null : null
  const dirty = editing !== null && isDirty({ form, rows }, baseline)
  const formCategories = useMemo(() => {
    const list = mergeCategories(DEFAULT_CATEGORIES, jobs.map(j => j.category))
    return list.some(c => sameCategory(c, form.category)) ? list : [...list, form.category]
  }, [jobs, form.category])

  const closeForm = useCallback(() => {
    setPanel(null); setEditing(null); setFormError(''); setErrors(noErrors()); setDeleteError('')
  }, [])
  const requestClose = () => {
    if (dirty) { afterDiscard.current = closeForm; setPanel('discard'); return }
    closeForm()
  }
  const open = (id: string | 'new', f: Form, r: PartRow[]) => {
    setForm(f); setRows(r); setBaseline({ form: f, rows: r }); setErrors(noErrors()); setFormError(''); setEditing(id); setPanel('form')
  }
  const openNew = () => open('new', emptyForm(shopRate), [])
  const openEdit = (j: CannedJob) => open(j.id, toForm(j), toRows(j.parts))
  const openCopy = () => {
    const f = { ...form, name: `${form.name.trim() || 'Canned job'} (copy)` }
    const r = rows.map(x => ({ ...x, key: newKey() }))
    open('new', f, r)
    setFlash(null)
  }

  /** A message goes away as soon as what is typed in that box is fine. */
  const shownErrors = useMemo<JobErrors>(() => {
    const live = validate(form, rows)
    const out: JobErrors = { rows: {} }
    if (errors.name && live.name) out.name = live.name
    if (errors.labor_hours && live.labor_hours) out.labor_hours = live.labor_hours
    if (errors.labor_rate && live.labor_rate) out.labor_rate = live.labor_rate
    for (const k of Object.keys(errors.rows)) if (live.rows[k]) out.rows[k] = live.rows[k]
    return out
  }, [errors, form, rows])

  const save = async () => {
    if (saving) return
    const found = validate(form, rows)
    setErrors(found)
    if (hasErrors(found)) {
      setFormError('')
      const firstRow = Object.keys(found.rows)[0]
      const target = found.name ? 'cj-name' : found.labor_hours ? 'cj-labor_hours' : found.labor_rate ? 'cj-labor_rate'
        : firstRow ? (found.rows[firstRow].name ? `cj-pname-${firstRow}` : found.rows[firstRow].cost ? `cj-pcost-${firstRow}` : `cj-pqty-${firstRow}`) : ''
      if (target) requestAnimationFrame(() => document.getElementById(target)?.focus())
      return
    }
    setSaving(true); setFormError('')
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error(NO_SHOP)
      const row = toRow(form, rows, shopRate)
      const now = new Date().toISOString()
      if (editing === 'new') {
        const r = await supabase.from('canned_jobs').insert({ ...row, shop_id: shopId, created_at: now, updated_at: now })
        if (r.error) throw new Error(r.error.message)
      } else if (editing) {
        const r = await supabase.from('canned_jobs').update({ ...row, updated_at: now }).eq('id', editing).eq('shop_id', shopId)
        if (r.error) throw new Error(r.error.message)
      }
      closeForm()
      setFlash({ kind: 'success', text: `${row.name} was ${editing === 'new' ? 'added' : 'saved'}.${row.active ? '' : ' It is hidden from estimates.'}` })
      await load()
    } catch (e) {
      setFormError(`This canned job was not saved. ${reasonOf(e, 'Check your connection.')} What you typed is still here. Tap Save canned job to try again.`)
    } finally { setSaving(false) }
  }

  const restore = async (job: CannedJob) => {
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error(NO_SHOP)
      const r = await supabase.from('canned_jobs').insert({ ...job, shop_id: shopId })
      if (r.error) throw new Error(r.error.message)
      setFlash({ kind: 'success', text: `${job.name} is back.` })
      await load()
    } catch (e) {
      setFlash({ kind: 'error', text: `${job.name} could not be restored. ${reasonOf(e, 'Check your connection.')} Add it again with New canned job.` })
    }
  }

  const del = async () => {
    if (!editing || editing === 'new' || busy) return
    const job = original
    setBusy(true); setDeleteError('')
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error(NO_SHOP)
      const r = await supabase.from('canned_jobs').delete().eq('id', editing).eq('shop_id', shopId)
      if (r.error) throw new Error(r.error.message)
      closeForm()
      setFlash({ kind: 'success', text: `${job?.name || 'The canned job'} was deleted.`, action: job ? { label: 'Undo', run: () => { void restore(job) } } : undefined })
      await load()
    } catch (e) {
      setDeleteError(`This canned job was not deleted. ${reasonOf(e, 'Check your connection.')} Try again.`)
    } finally { setBusy(false) }
  }

  /* ---------- adding a part from inventory ---------- */
  const loadStock = useCallback(async () => {
    setStockLoading(true); setStockError('')
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error(NO_SHOP)
      const { data, error } = await supabase.from('inventory').select('id,name,part_number,brand,category,retail_price,qty_on_hand').eq('shop_id', shopId).order('name').limit(3000)
      if (error) throw new Error(error.message)
      setStock((data || []) as StockPart[])
    } catch (e) {
      setStockError(`Your inventory could not be loaded. ${reasonOf(e, 'Check your connection.')}`)
    } finally { setStockLoading(false) }
  }, [])
  const openPicker = () => { setPanel('pick'); if (stock === null && !stockLoading) void loadStock() }
  const pickPart = (p: StockPart) => {
    const key = newKey()
    setRows(rs => [...rs, { key, name: p.name, part_number: p.part_number || '', cost: p.retail_price ? String(p.retail_price) : '', qty: '1' }])
    setPanel('form')
    requestAnimationFrame(() => document.getElementById(`cj-pcost-${key}`)?.scrollIntoView({ block: 'center' }))
  }

  // Each view in the sheet starts at its top.
  const dialogTop = useRef<HTMLDivElement>(null)
  useEffect(() => { dialogTop.current?.closest('[role="dialog"]')?.scrollTo({ top: 0 }) }, [panel])

  /* ---------- the list ---------- */
  const words = useMemo(() => search.trim().toLowerCase().split(/\s+/).filter(Boolean), [search])
  const categories = useMemo(() => mergeCategories([], jobs.map(j => j.category)).sort((a, b) => a.localeCompare(b)), [jobs])
  const hiddenCount = jobs.filter(j => j.active === false).length
  const filtered = useMemo(() => jobs.filter(j => {
    if (catFilter !== 'All' && !sameCategory(j.category || 'Other', catFilter)) return false
    if (status === 'on' && j.active === false) return false
    if (status === 'hidden' && j.active !== false) return false
    if (!words.length) return true
    const h = hay(j)
    return words.every(w => h.includes(w))
  }), [jobs, catFilter, status, words])

  const grouped = useMemo(() => {
    const g = new Map<string, { label: string; jobs: CannedJob[] }>()
    for (const j of filtered) {
      const label = (j.category || '').trim() || 'Other'
      const k = label.toLowerCase()
      const e = g.get(k) || { label, jobs: [] }
      e.jobs.push(j); g.set(k, e)
    }
    return [...g.values()].sort((a, b) => a.label.localeCompare(b.label)).map(e => ({ ...e, jobs: e.jobs.sort((a, b) => String(a.name).localeCompare(String(b.name))) }))
  }, [filtered])

  const firstLoad = loading && jobs.length === 0 && !loadError
  const filtering = catFilter !== 'All' || status !== 'all' || words.length > 0
  const clearFilters = () => { setSearch(''); setCatFilter('All'); setStatus('all') }
  const sheetTitle = panel === 'pick' ? 'Add a part from inventory' : editing === 'new' ? 'New canned job' : 'Edit canned job'

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">Canned jobs</h1>
          <p className="page-subtitle">Jobs you quote often, already priced. Add them to an estimate from the estimate screen.</p>
        </div>
        <button type="button" className="btn btn-primary w-full sm:w-auto" onClick={openNew} disabled={firstLoad}><Icon name="plus" className="h-5 w-5" />New canned job</button>
      </header>

      {loadError && <ErrorCard className="mb-5 max-w-xl" title="Canned jobs could not load" message={jobs.length > 0 ? `${loadError} What you see may be out of date.` : loadError} onRetry={() => void load()} busy={loading} />}
      {flash && <FlashNotice flash={flash} onDismiss={() => setFlash(null)} />}

      {(jobs.length > 0 || filtering) && (
        <div className="mb-3 space-y-3">
          <div className="flex flex-col gap-2 sm:flex-row">
            <SearchField className="sm:min-w-0 sm:max-w-md sm:flex-1" label="Search canned jobs by name, category, description or part" placeholder="Search canned jobs" value={search} onChange={setSearch} />
            <div>
              <label htmlFor="canned-cat" className="sr-only">Category</label>
              <select id="canned-cat" className="form-select sm:w-52" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
                <option value="All">All categories</option>
                {categories.map(c => <option key={c} value={c}>{sentenceCase(c)}</option>)}
              </select>
            </div>
          </div>
          {hiddenCount > 0 && (
            <FilterChips<Status>
              label="Show jobs"
              scroll
              value={status}
              onChange={setStatus}
              options={[
                { key: 'all', label: 'All', count: jobs.length },
                { key: 'on', label: 'On estimates', count: jobs.length - hiddenCount },
                { key: 'hidden', label: 'Hidden from estimates', count: hiddenCount },
              ]}
            />
          )}
        </div>
      )}

      {firstLoad ? (
        <RowsSkeleton rows={6} label="Loading canned jobs" />
      ) : loadError && jobs.length === 0 ? null : jobs.length === 0 ? (
        <EmptyBlock icon="bolt" title="No canned jobs yet" action={<button type="button" className="btn btn-primary" onClick={openNew}><Icon name="plus" className="h-5 w-5" />Create your first canned job</button>}>
          Save the jobs you quote again and again, like an oil change or front brakes. When you build an estimate, choose Add a canned job to drop one in with its labor and parts.
        </EmptyBlock>
      ) : filtered.length === 0 ? (
        <EmptyBlock icon="search" title={words.length ? `No canned jobs match “${search.trim()}”` : status === 'hidden' ? 'No hidden jobs' : 'No canned jobs match'} action={<button type="button" className="btn btn-secondary" onClick={clearFilters}>Show all canned jobs</button>}>
          {words.length ? 'Try a shorter search, a part name, or a different category.' : 'Try a different category.'}
        </EmptyBlock>
      ) : (
        <>
          <p className="mb-4 flex flex-wrap items-center gap-x-3 text-[0.9375rem] text-text-secondary" aria-live="polite">
            <span><span className="num font-bold text-text-primary">{filtered.length}</span> {filtered.length === 1 ? 'canned job' : 'canned jobs'}{filtering ? ` of ${jobs.length}` : ''}</span>
            {filtering && <button type="button" className="inline-flex min-h-[44px] items-center font-bold text-blue underline-offset-4 hover:underline" onClick={clearFilters}>Show all</button>}
          </p>
          <div className="space-y-8">
            {grouped.map(g => (
              <section key={g.label.toLowerCase()} aria-label={sentenceCase(g.label)}>
                <h2 className="section-title mb-2">{sentenceCase(g.label)} <span className="num ml-1 text-[0.9375rem] font-normal text-text-secondary">{g.jobs.length}</span></h2>
                <ul className="ledger">
                  {g.jobs.map(j => {
                    const partCount = Array.isArray(j.parts) ? j.parts.length : 0
                    const hidden = j.active === false
                    return (
                      <li key={j.id}>
                        <button type="button" className="ledger-row py-3" onClick={() => openEdit(j)}>
                          <span className="ledger-main">
                            <span className="ledger-title block !whitespace-normal">{j.name}</span>
                            {j.description && <span className="ledger-sub line-clamp-2 !whitespace-normal">{j.description}</span>}
                            <span className="ledger-sub block md:hidden !whitespace-normal">{j.labor_hours || 0} h labor{partCount > 0 ? ` · ${partCount} ${partCount === 1 ? 'part' : 'parts'}` : ''}</span>
                            {hidden && <span className="mt-0.5 flex items-center gap-1.5 text-[0.875rem] font-bold text-text-secondary"><span className="lamp lamp-off" aria-hidden="true" />Hidden from estimates</span>}
                          </span>
                          <span className="num hidden w-20 shrink-0 text-right text-text-secondary md:block">{j.labor_hours || 0} h</span>
                          <span className="num hidden w-24 shrink-0 text-right text-text-secondary md:block">{partCount > 0 ? `${partCount} ${partCount === 1 ? 'part' : 'parts'}` : 'No parts'}</span>
                          <span className="ledger-amt w-24 shrink-0">{money(j.total_price)}</span>
                          <Icon name="chevronRight" className="h-4 w-4 shrink-0 text-text-muted" />
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}

      <Sheet open={panel === 'form' || panel === 'pick'} onClose={() => { if (panel === 'pick') setPanel('form'); else requestClose() }} title={sheetTitle} wide>
        <div ref={dialogTop}>
          {panel === 'pick' ? (
            <InventoryPicker stock={stock} loading={stockLoading} error={stockError} onRetry={() => void loadStock()} onPick={pickPart} onBack={() => setPanel('form')} />
          ) : (
            <JobForm
              form={form} setForm={setForm} rows={rows} setRows={setRows}
              errors={shownErrors} categories={formCategories} shopRate={shopRate}
              saving={saving} error={formError} isNew={editing === 'new'}
              onSave={() => void save()}
              onCancel={requestClose}
              onDuplicate={editing && editing !== 'new' ? openCopy : undefined}
              onDelete={editing && editing !== 'new' ? () => { setDeleteError(''); setPanel('delete') } : undefined}
              onPick={openPicker}
            />
          )}
        </div>
      </Sheet>

      <ConfirmSheet
        open={panel === 'delete'}
        title="Delete this canned job?"
        confirmLabel="Delete canned job"
        busyLabel="Deleting…"
        cancelLabel="Keep canned job"
        busy={busy}
        error={deleteError}
        onConfirm={() => void del()}
        onCancel={() => { if (!busy) { setDeleteError(''); setPanel('form') } }}
      >
        <p>This removes {original?.name || 'this canned job'}, {original ? money(original.total_price) : ''}, from your list. Estimates that already used it keep their lines. Right after, you can tap Undo to put it back.</p>
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
