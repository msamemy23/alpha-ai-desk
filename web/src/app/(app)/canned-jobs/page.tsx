'use client'
import { useEffect, useState, useCallback, useMemo } from 'react'
import { getShopId, supabase } from '@/lib/supabase'
import Icon from '@/components/Icon'
import Sheet from '@/components/Sheet'
import { EmptyBlock, ErrorCard, RowsSkeleton, SearchField, sentenceCase } from '@/components/ListKit'

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

const CATEGORIES = ['All', 'Oil Change', 'Brakes', 'Tires', 'Engine', 'Suspension', 'Electrical', 'Transmission', 'A/C', 'Diagnostic', 'Maintenance', 'Other', 'Warranty']

function fmtCur(n: number | null | undefined) {
  return '$' + Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function FormSection({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="display text-[1.0625rem] font-bold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
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
  const [loadError, setLoadError] = useState('')
  const [formError, setFormError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const shopId = await getShopId()
      if (!shopId) { setJobs([]); setLoadError('We could not find your shop. Try refreshing, or sign out and back in.'); return }
      const { data, error } = await supabase.from('canned_jobs').select('*').eq('shop_id', shopId).order('category').order('name')
      if (error) throw error
      setJobs((data || []) as CannedJob[])
      setLoadError('')
    } catch {
      setLoadError('Your canned jobs could not be loaded. Check your connection and try again.')
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const calcTotal = (laborHours: number, laborRate: number, jobParts: CannedPart[]) => {
    const labor = (laborHours || 0) * (laborRate || 0)
    const partsTotal = jobParts.reduce((s, p) => s + (p.cost || 0) * (p.qty || 1), 0)
    return labor + partsTotal
  }

  const closeForm = useCallback(() => { setEditing(null); setForm({}); setParts([]); setFormError('') }, [])

  const save = async () => {
    if (!form.name || !form.name.trim()) {
      setFormError('Give the job a name so you can find it later.')
      document.getElementById('canned-name')?.focus()
      return
    }
    setSaving(true)
    setFormError('')
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('We could not find your shop. Try refreshing, or sign out and back in.')
      const total = calcTotal(form.labor_hours || 0, form.labor_rate || 0, parts)
      const data = { ...form, shop_id: shopId, parts, total_price: total, active: form.active !== false, updated_at: new Date().toISOString() }
      if (editing === 'new') {
        const { error } = await supabase.from('canned_jobs').insert({ ...data, created_at: new Date().toISOString() })
        if (error) throw error
      } else if (editing) {
        const { error } = await supabase.from('canned_jobs').update(data).eq('id', editing).eq('shop_id', shopId)
        if (error) throw error
      }
      closeForm()
      await load()
    } catch (error) {
      setFormError('This canned job was not saved. ' + (error instanceof Error ? error.message : 'Check your connection and try again.'))
    } finally { setSaving(false) }
  }

  const del = async () => {
    if (!editing || editing === 'new') return
    if (!confirm('Delete this canned job?')) return
    setFormError('')
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('We could not find your shop. Try refreshing, or sign out and back in.')
      const { error } = await supabase.from('canned_jobs').delete().eq('id', editing).eq('shop_id', shopId)
      if (error) throw error
      closeForm()
      await load()
    } catch (error) {
      setFormError('This canned job was not deleted. ' + (error instanceof Error ? error.message : 'Check your connection and try again.'))
    }
  }

  const addPart = () => setParts(p => [...p, { name: '', part_number: '', cost: 0, qty: 1 }])
  const removePart = (i: number) => setParts(p => p.filter((_, idx) => idx !== i))
  const updatePart = (i: number, field: keyof CannedPart, value: string | number) => {
    setParts(p => p.map((part, idx) => idx === i ? { ...part, [field]: value } : part))
  }

  const openNew = () => { setFormError(''); setForm({ active: true, labor_hours: 1, labor_rate: 125, category: 'Other' }); setParts([]); setEditing('new') }
  const openEdit = (j: CannedJob) => { setFormError(''); setForm(j); setParts(Array.isArray(j.parts) ? j.parts : []); setEditing(j.id) }

  const filtered = useMemo(() => jobs
    .filter(j => catFilter === 'All' || j.category === catFilter)
    .filter(j => !search || [j.name, j.category, j.description].some(v => (v||'').toLowerCase().includes(search.toLowerCase())))
    .filter(j => j.active !== false), [jobs, catFilter, search])

  const grouped = useMemo(() => {
    const g: Record<string, CannedJob[]> = {}
    for (const j of filtered) {
      const cat = j.category || 'Other'
      if (!g[cat]) g[cat] = []
      g[cat].push(j)
    }
    return Object.entries(g).sort()
  }, [filtered])

  const laborTotal = (form.labor_hours || 0) * (form.labor_rate || 0)
  const partsTotal = parts.reduce((s, p) => s + (p.cost || 0) * (p.qty || 1), 0)
  const total = calcTotal(form.labor_hours || 0, form.labor_rate || 0, parts)

  const hasJobs = jobs.some(j => j.active !== false)
  const firstLoad = loading && jobs.length === 0 && !loadError
  const filtering = !!search || catFilter !== 'All'

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div>
          <h1 className="page-title">Canned jobs</h1>
          <p className="page-subtitle">Jobs you quote often, already priced.</p>
        </div>
        <div className="toolbar">
          <button className="btn btn-primary" onClick={openNew}><Icon name="plus" className="h-5 w-5" />New canned job</button>
        </div>
      </header>

      {loadError && <ErrorCard className="mb-5 max-w-xl" title="Canned jobs could not load" message={loadError} onRetry={load} busy={loading} />}

      {(hasJobs || filtering) && (
        <div className="mb-5 flex flex-col gap-2 sm:flex-row">
          <SearchField className="sm:w-80" label="Search canned jobs" placeholder="Search canned jobs" value={search} onChange={setSearch} />
          <div>
            <label htmlFor="canned-cat" className="sr-only">Category</label>
            <select id="canned-cat" className="form-select sm:w-52" value={catFilter} onChange={e => setCatFilter(e.target.value)}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c === 'All' ? 'All categories' : sentenceCase(c)}</option>)}
            </select>
          </div>
        </div>
      )}

      {firstLoad ? (
        <RowsSkeleton rows={6} label="Loading canned jobs" />
      ) : loadError && jobs.length === 0 ? null : filtered.length === 0 ? (
        filtering ? (
          <EmptyBlock icon="search" title="No canned jobs match" action={<button className="btn btn-secondary" onClick={() => { setSearch(''); setCatFilter('All') }}>Clear search and category</button>}>
            Try a shorter search or a different category.
          </EmptyBlock>
        ) : (
          <EmptyBlock icon="bolt" title="No canned jobs yet" action={<button className="btn btn-primary" onClick={openNew}><Icon name="plus" className="h-5 w-5" />Create your first canned job</button>}>
            Save the jobs you quote again and again, like an oil change or front brakes, and add them to an estimate in one tap.
          </EmptyBlock>
        )
      ) : (
        <div className="space-y-8">
          {grouped.map(([cat, catJobs]) => (
            <section key={cat} aria-labelledby={`cat-${cat}`}>
              <h2 id={`cat-${cat}`} className="section-title mb-2">{sentenceCase(cat)} <span className="num ml-1 text-[0.9375rem] font-normal text-text-secondary">{catJobs.length}</span></h2>
              <ul className="ledger">
                {catJobs.map(j => {
                  const partCount = Array.isArray(j.parts) ? j.parts.length : 0
                  return (
                    <li key={j.id}>
                      <button type="button" className="ledger-row py-3" onClick={() => openEdit(j)}>
                        <span className="ledger-main">
                          <span className="ledger-title block !whitespace-normal">{j.name}</span>
                          {j.description && <span className="ledger-sub block">{j.description}</span>}
                          <span className="ledger-sub block md:hidden">{j.labor_hours || 0} h labor{partCount > 0 ? ` · ${partCount} ${partCount === 1 ? 'part' : 'parts'}` : ''}</span>
                        </span>
                        <span className="num hidden w-20 shrink-0 text-right text-text-secondary md:block">{j.labor_hours || 0} h</span>
                        <span className="num hidden w-20 shrink-0 text-right text-text-secondary md:block">{partCount > 0 ? `${partCount} ${partCount === 1 ? 'part' : 'parts'}` : 'No parts'}</span>
                        <span className="ledger-amt w-24 shrink-0">{fmtCur(j.total_price)}</span>
                        <Icon name="chevronRight" className="h-4 w-4 shrink-0 text-text-muted" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}

      <Sheet open={editing !== null} onClose={closeForm} title={editing === 'new' ? 'New canned job' : 'Edit canned job'} wide>
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
                <label className="form-label" htmlFor="canned-name">Job name (required)</label>
                <input id="canned-name" className="form-input" aria-invalid={!!formError && !form.name} value={form.name || ''} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="Full synthetic oil change" />
              </div>
              <div>
                <label className="form-label" htmlFor="canned-category">Category</label>
                <select id="canned-category" className="form-select" value={form.category || 'Other'} onChange={e => setForm(f => ({ ...f, category: e.target.value }))}>
                  {CATEGORIES.filter(c => c !== 'All').map(c => <option key={c} value={c}>{sentenceCase(c)}</option>)}
                </select>
              </div>
            </div>
            <div className="mt-4">
              <label className="form-label" htmlFor="canned-desc">What is included</label>
              <textarea id="canned-desc" className="form-textarea" rows={2} value={form.description || ''} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Up to 5 quarts, new filter, fluid top-off" />
            </div>
          </section>

          <FormSection title="Labor">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="form-label" htmlFor="canned-hours">Labor hours</label>
                <input id="canned-hours" type="number" inputMode="decimal" step="0.25" min="0" className="form-input num" value={form.labor_hours || ''} onChange={e => setForm(f => ({ ...f, labor_hours: parseFloat(e.target.value) || 0 }))} />
              </div>
              <div>
                <label className="form-label" htmlFor="canned-rate">Labor rate ($ per hour)</label>
                <input id="canned-rate" type="number" inputMode="decimal" min="0" className="form-input num" value={form.labor_rate || ''} onChange={e => setForm(f => ({ ...f, labor_rate: parseFloat(e.target.value) || 0 }))} />
              </div>
            </div>
          </FormSection>

          <FormSection title="Parts" action={<button type="button" className="btn btn-secondary btn-sm" onClick={addPart}><Icon name="plus" className="h-4 w-4" />Add part</button>}>
            {parts.length === 0 ? (
              <p className="text-text-secondary">No parts on this job. Tap Add part to include one.</p>
            ) : (
              <ul className="space-y-3">
                {parts.map((p, i) => (
                  <li key={i} className="rounded-md border border-border bg-bg-base p-3">
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,2fr)]">
                      <div>
                        <label className="form-label" htmlFor={`part-name-${i}`}>Part name</label>
                        <input id={`part-name-${i}`} className="form-input" value={p.name} onChange={e => updatePart(i, 'name', e.target.value)} />
                      </div>
                      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_4.5rem] gap-2">
                        <div>
                          <label className="form-label" htmlFor={`part-num-${i}`}>Part number</label>
                          <input id={`part-num-${i}`} className="form-input" value={p.part_number} onChange={e => updatePart(i, 'part_number', e.target.value)} />
                        </div>
                        <div>
                          <label className="form-label" htmlFor={`part-cost-${i}`}>Cost</label>
                          <input id={`part-cost-${i}`} type="number" inputMode="decimal" step="0.01" className="form-input num" value={p.cost || ''} onChange={e => updatePart(i, 'cost', parseFloat(e.target.value) || 0)} />
                        </div>
                        <div>
                          <label className="form-label" htmlFor={`part-qty-${i}`}>Qty</label>
                          <input id={`part-qty-${i}`} type="number" inputMode="numeric" min="1" className="form-input num" value={p.qty || 1} onChange={e => updatePart(i, 'qty', parseInt(e.target.value) || 1)} />
                        </div>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <span className="num text-[0.9375rem] text-text-secondary">Line total <span className="font-bold text-text-primary">{fmtCur((p.cost || 0) * (p.qty || 1))}</span></span>
                      <button type="button" className="btn btn-ghost btn-sm text-red" onClick={() => removePart(i)} aria-label={`Remove part ${p.name || i + 1}`}><Icon name="trash" className="h-4 w-4" />Remove</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </FormSection>

          <section className="rounded-md border border-border bg-text-primary/[0.04] p-4">
            <dl className="space-y-1 text-[0.9375rem]">
              <div className="flex justify-between gap-3"><dt className="text-text-secondary">Labor</dt><dd className="num">{fmtCur(laborTotal)}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-text-secondary">Parts</dt><dd className="num">{fmtCur(partsTotal)}</dd></div>
              <div className="flex items-baseline justify-between gap-3 border-t border-border pt-2">
                <dt className="font-bold">Estimated total</dt>
                <dd className="display num text-[1.5rem] font-bold" aria-live="polite">{fmtCur(total)}</dd>
              </div>
            </dl>
          </section>

          <section>
            <label className="form-label" htmlFor="canned-notes">Notes and warranty</label>
            <textarea id="canned-notes" className="form-textarea" rows={2} value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Warranty terms, what is not covered" />
          </section>

          <div className="sticky bottom-[calc(-1.25rem-env(safe-area-inset-bottom))] z-10 -mx-5 flex flex-wrap items-center gap-2 border-t border-border bg-bg-card px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:-bottom-6 sm:-mx-6 sm:px-6 sm:pb-3">
            <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save canned job'}</button>
            <button type="button" className="btn btn-secondary" onClick={closeForm}>Cancel</button>
            {editing !== 'new' && <button type="button" className="btn btn-danger ml-auto" onClick={del}><Icon name="trash" className="h-4 w-4" />Delete</button>}
          </div>
        </div>
      </Sheet>
    </div>
  )
}
