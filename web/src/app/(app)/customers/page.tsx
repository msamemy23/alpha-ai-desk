'use client'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { getShopId, supabase } from '@/lib/supabase'
import { ageLabel, phonePretty } from '@/lib/today'
import Icon from '@/components/Icon'
import Sheet from '@/components/Sheet'
import SentimentMark from '@/components/customers/SentimentMark'
import CustomerForm from '@/components/customers/CustomerForm'
import CustomerDetail, { dialCustomer } from '@/components/customers/CustomerDetail'
import SendPanel from '@/components/customers/SendPanel'
import { SENTIMENTS, matchesSearch, sentimentOf, text, vehicleLabel } from '@/components/customers/types'
import type { Customer } from '@/components/customers/types'

type SheetState =
  | { mode: 'view'; id: string }
  | { mode: 'edit'; id: string }
  | { mode: 'new' }
  | { mode: 'send'; id: string; channel: 'sms' | 'email' }

interface VisitInfo { jobs: number; last: string }

function ListSkeleton() {
  return (
    <div className="page-container" aria-busy="true" aria-label="Loading customers">
      <div className="skeleton h-9 w-48" />
      <div className="skeleton mt-3 h-4 w-40" />
      <div className="skeleton mt-6 h-11 w-full" />
      <div className="mt-4 space-y-2">{[0, 1, 2, 3, 4, 5, 6, 7].map(i => <div key={i} className="skeleton h-[4.25rem]" />)}</div>
    </div>
  )
}

export default function CustomersPage() {
  return (
    <Suspense fallback={<ListSkeleton />}>
      <CustomersScreen />
    </Suspense>
  )
}

function CustomersScreen() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [visits, setVisits] = useState<Record<string, VisitInfo>>({})
  const [search, setSearch] = useState('')
  const [sentimentFilter, setSentimentFilter] = useState('all')
  const [sheet, setSheet] = useState<SheetState | null>(null)
  const [form, setForm] = useState<Partial<Customer>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [nameError, setNameError] = useState(false)
  const [notice, setNotice] = useState('')
  const sheetBody = useRef<HTMLDivElement>(null)

  const params = useSearchParams()
  const qParam = params.get('q')
  const customerParam = params.get('customer')
  const handledLink = useRef('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      let shopId: string | null = null
      try { shopId = await getShopId() } catch { shopId = null }
      if (!shopId) { setCustomers([]); setVisits({}); setLoadError('We could not find your shop. Try refreshing, or sign out and back in.'); return }
      // Customers, jobs and paid paperwork are independent, so fetch them together.
      const [{ data, error }, { data: jobs }, { data: paid }] = await Promise.all([
        supabase.from('customers').select('*').eq('shop_id', shopId).order('name'),
        supabase.from('jobs').select('customer_id,created_at').eq('shop_id', shopId),
        supabase.from('documents').select('customer_id,created_at').eq('shop_id', shopId).in('type', ['Invoice', 'Receipt']).order('created_at', { ascending: false }).limit(2000),
      ])
      if (error) {
        // Keep the current list on screen; a failed refresh must not look like "no customers".
        setLoadError('Your customers could not be loaded. Check your connection and try again.')
        return
      }
      setLoadError(null)
      setCustomers((data || []) as Customer[])
      const info: Record<string, VisitInfo> = {}
      const touch = (id: unknown, when: unknown, isJob: boolean) => {
        if (!id) return
        const k = String(id)
        const row = (info[k] ||= { jobs: 0, last: '' })
        if (isJob) row.jobs += 1
        const w = String(when || '')
        if (w > row.last) row.last = w
      }
      ;(jobs || []).forEach((j: Record<string, unknown>) => touch(j.customer_id, j.created_at, true))
      ;(paid || []).forEach((d: Record<string, unknown>) => touch(d.customer_id, d.created_at, false))
      setVisits(info)
    } catch {
      setLoadError('Your customers could not be loaded. Check your connection and try again.')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    const ch = supabase.channel('customers_page').on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, load).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  // Links from global search (/customers?q=Name) prefill the box. ?customer=<id> opens that person.
  useEffect(() => { if (qParam !== null) setSearch(qParam) }, [qParam])
  useEffect(() => {
    if (loading || loadError) return
    const key = `${qParam ?? ''}|${customerParam ?? ''}`
    if (key === '|' || handledLink.current === key) return
    handledLink.current = key
    if (customerParam) {
      const hit = customers.find(c => c.id === customerParam)
      if (hit) setSheet({ mode: 'view', id: hit.id })
    } else if (qParam) {
      const exact = customers.filter(c => text(c.name).trim().toLowerCase() === qParam.trim().toLowerCase())
      if (exact.length === 1) setSheet({ mode: 'view', id: exact[0].id })
    }
  }, [loading, loadError, qParam, customerParam, customers])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(() => setNotice(''), 6000)
    return () => clearTimeout(t)
  }, [notice])

  const closeSheet = useCallback(() => { setSheet(null); setForm({}); setSaveError(''); setNameError(false) }, [])

  // Keep keyboard and screen reader focus inside the sheet when its content changes.
  const mode = sheet?.mode
  useEffect(() => {
    if (!mode || mode === 'new') return
    sheetBody.current?.focus({ preventScroll: true })
  }, [mode])

  const current = sheet && 'id' in sheet ? customers.find(c => c.id === sheet.id) || null : null
  useEffect(() => {
    // The customer vanished (deleted elsewhere): close instead of showing an empty sheet.
    if (sheet && 'id' in sheet && !loading && !current) closeSheet()
  }, [sheet, current, loading, closeSheet])

  // The "enter a name" message goes away as soon as there is one.
  useEffect(() => { if (nameError && text(form.name).trim()) setNameError(false) }, [nameError, form.name])

  const openNew = () => {
    setForm({ preferred_contact: 'Call', sentiment: 'neutral' })
    setSaveError(''); setNameError(false)
    setSheet({ mode: 'new' })
  }
  const openEdit = (c: Customer) => {
    setForm({ ...c })
    setSaveError(''); setNameError(false)
    setSheet({ mode: 'edit', id: c.id })
  }

  const save = async () => {
    if (!text(form.name).trim()) {
      setNameError(true); setSaveError('')
      requestAnimationFrame(() => document.getElementById('cf-name')?.focus())
      return
    }
    setNameError(false); setSaveError(''); setSaving(true)
    try {
      const shopId = await getShopId()
      if (!shopId) { setSaveError('No shop is associated with the signed-in user'); return }
      const safeFields = ['name', 'phone', 'email', 'address', 'notes', 'preferred_contact', 'vehicle_year', 'vehicle_make', 'vehicle_model', 'vehicle_vin', 'vehicle_plate', 'vehicle_mileage']
      const data: Record<string, unknown> = { shop_id: shopId, updated_at: new Date().toISOString() }
      for (const k of safeFields) { if ((form as Record<string, string>)[k] !== undefined) data[k] = (form as Record<string, string>)[k] }
      const extended = ['sentiment', 'vehicle_color', 'vehicle_engine', 'last_contact', 'review_requested']
      for (const k of extended) { if ((form as Record<string, string>)[k] !== undefined) data[k] = (form as Record<string, string>)[k] }
      if (sheet?.mode === 'new') {
        const { error } = await supabase.from('customers').insert({ ...data, created_at: new Date().toISOString() })
        if (error) { setSaveError('Save failed: ' + error.message); return }
      } else if (sheet?.mode === 'edit') {
        const { error } = await supabase.from('customers').update(data).eq('id', sheet.id).eq('shop_id', shopId)
        if (error) { setSaveError('Save failed: ' + error.message); return }
      }
      const wasNew = sheet?.mode === 'new'
      const editedId = sheet && 'id' in sheet ? sheet.id : null
      await load()
      setNotice(wasNew ? 'Customer added.' : 'Changes saved.')
      if (wasNew || !editedId) closeSheet()
      else { setForm({}); setSheet({ mode: 'view', id: editedId }) }
    } finally { setSaving(false) }
  }

  const del = async () => {
    if (!sheet || sheet.mode !== 'edit') return
    if (!confirm('Delete this customer?')) return
    setSaveError('')
    const shopId = await getShopId()
    if (!shopId) { setSaveError('No shop is associated with the signed-in user'); return }
    const { error } = await supabase.from('customers').delete().eq('id', sheet.id).eq('shop_id', shopId)
    if (error) { setSaveError('Delete failed: ' + error.message); return }
    closeSheet()
    setNotice('Customer deleted.')
    await load()
  }

  const sorted = useMemo(
    () => [...customers].sort((a, b) => {
      const an = text(a.name).trim(), bn = text(b.name).trim()
      if (!an !== !bn) return an ? -1 : 1
      return an.localeCompare(bn, undefined, { sensitivity: 'base' })
    }),
    [customers],
  )

  const filtered = useMemo(
    () => sorted.filter(c => matchesSearch(c, search) && (sentimentFilter === 'all' || (c.sentiment || 'neutral') === sentimentFilter)),
    [sorted, search, sentimentFilter],
  )

  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const c of customers) { const k = sentimentOf(c).key; m[k] = (m[k] || 0) + 1 }
    return m
  }, [customers])

  const filtersOn = search.trim() !== '' || sentimentFilter !== 'all'
  const clearFilters = () => { setSearch(''); setSentimentFilter('all') }

  // ---------- Loading and error ----------
  if (loading && customers.length === 0 && !loadError) return <ListSkeleton />

  const sheetTitle =
    !sheet ? 'Customer'
    : sheet.mode === 'new' ? 'New customer'
    : sheet.mode === 'edit' ? 'Edit customer'
    : sheet.mode === 'send' ? `${sheet.channel === 'sms' ? 'Text' : 'Email'} ${current?.name || 'customer'}`
    : current?.name || 'Customer'

  const groupLetter = (c: Customer) => {
    const ch = text(c.name).trim().charAt(0).toUpperCase()
    return /[A-Z]/.test(ch) ? ch : '#'
  }
  const showLetters = filtered.length >= 8

  return (
    <div className="page-container animate-fade-in">
      <header className="mb-5 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="page-title">Customers</h1>
          <p className="page-subtitle">
            {customers.length === 0 ? 'Your customer book' : `${customers.length} ${customers.length === 1 ? 'customer' : 'customers'} in your book`}
          </p>
        </div>
        <button type="button" className="btn btn-primary shrink-0" onClick={openNew}>
          <Icon name="plus" className="h-5 w-5" />New customer
        </button>
      </header>

      {notice && (
        <div role="status" className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-green/40 bg-green/[0.1] px-4 py-3">
          <span className="flex items-center gap-2 font-bold text-green"><Icon name="check" className="h-5 w-5" />{notice}</span>
          <button type="button" className="btn-icon -mr-2 h-9 w-9 sm:h-9 sm:w-9" onClick={() => setNotice('')} aria-label="Dismiss message"><Icon name="close" className="h-4 w-4" /></button>
        </div>
      )}

      {loadError && customers.length === 0 ? (
        <div role="alert" className="card max-w-xl">
          <h2 className="section-title">Your customers did not load</h2>
          <p className="mt-1 text-text-secondary">{loadError}</p>
          <button className="btn btn-primary mt-4" onClick={() => load()}>Try again</button>
        </div>
      ) : customers.length === 0 ? (
        <div className="empty-state">
          <p className="font-bold text-text-primary">No customers yet</p>
          <p className="mx-auto mt-1 max-w-md">Add the people you fix cars for. Their phone, email and vehicle save here, so estimates, texts and the schedule fill themselves in.</p>
          <button className="btn btn-primary mt-4" onClick={openNew}><Icon name="plus" className="h-5 w-5" />Add your first customer</button>
        </div>
      ) : (
        <>
          {loadError && (
            <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red/40 bg-red/[0.08] px-4 py-3">
              <span className="text-red">{loadError}</span>
              <button className="btn btn-secondary btn-sm" onClick={() => load()}>Try again</button>
            </div>
          )}

          <div className="space-y-3">
            <label className="relative block">
              <span className="sr-only">Search customers by name, phone, vehicle or email</span>
              <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted" />
              <input
                type="search" inputMode="search" autoComplete="off"
                className="form-input pl-10" placeholder="Search name, phone, vehicle or email"
                value={search} onChange={e => setSearch(e.target.value)}
              />
            </label>

            <div role="group" aria-label="Filter by how the customer feels" className="flex flex-wrap gap-2">
              {[{ key: 'all', label: 'All', icon: '', count: customers.length }, ...SENTIMENTS.map(s => ({ key: s.key as string, label: s.label, icon: s.icon, count: counts[s.key] || 0 }))].map(f => {
                const on = sentimentFilter === f.key
                return (
                  <button
                    key={f.key} type="button" aria-pressed={on} onClick={() => setSentimentFilter(f.key)}
                    className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-full border px-3.5 text-[0.9375rem] font-bold transition-colors sm:min-h-[40px] ${on ? 'border-blue bg-blue/10 text-blue' : 'border-line bg-bg-card text-text-primary hover:bg-bg-hover'}`}
                  >
                    {f.icon && <Icon name={f.icon} className="h-4 w-4" strokeWidth={2.2} />}
                    {f.label}
                    <span className="num font-normal opacity-80">{f.count}</span>
                  </button>
                )
              })}
            </div>
          </div>

          <div className="mt-5" aria-live="polite">
            {filtered.length === 0 ? (
              <div className="empty-state">
                <p className="font-bold text-text-primary">
                  {search.trim() ? <>No customers match &ldquo;{search.trim()}&rdquo;</> : 'No customers with that mood'}
                </p>
                <p className="mt-1">Try fewer letters, or the last four digits of a phone number.</p>
                {filtersOn && <button className="btn btn-secondary mt-4" onClick={clearFilters}>Show all customers</button>}
              </div>
            ) : (
              <>
                {filtersOn && <p className="mb-2 text-[0.9375rem] text-text-secondary">{filtered.length} of {customers.length} customers</p>}
                {/* Column names on wide screens. Rows below use the same grid. */}
                <div className="hidden grid-cols-[minmax(0,1.6fr)_9rem_minmax(0,1.4fr)_8.5rem] gap-4 border-t border-border px-3 pb-2 pt-3 pr-[3.5rem] text-[0.8125rem] font-bold text-text-secondary md:grid" aria-hidden="true">
                  <span>Name</span><span>Phone</span><span>Vehicle</span><span>Last visit</span>
                </div>
                <ul className="ledger">
                  {filtered.map((c, i) => {
                    const v = visits[c.id]
                    const car = vehicleLabel(c)
                    const mood = sentimentOf(c)
                    const last = v?.last ? ageLabel(v.last) : ''
                    const startsGroup = showLetters && (i === 0 || groupLetter(filtered[i - 1]) !== groupLetter(c))
                    return (
                      <li key={c.id}>
                        {startsGroup && (
                          <div className="border-b border-border bg-bg-chrome/60 px-3 py-1.5 text-[0.8125rem] font-bold text-text-secondary" aria-hidden="true">{groupLetter(c)}</div>
                        )}
                        <div className="flex items-center">
                          <button
                            type="button"
                            className="ledger-row min-w-0 flex-1 md:grid md:grid-cols-[minmax(0,1.6fr)_9rem_minmax(0,1.4fr)_8.5rem] md:gap-4"
                            onClick={() => setSheet({ mode: 'view', id: c.id })}
                            aria-label={`${c.name || 'Unnamed customer'}${mood.key !== 'neutral' ? `, ${mood.label}` : ''}. Open details`}
                          >
                            <span className="ledger-main md:contents">
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="ledger-title">{c.name || 'Unnamed customer'}</span>
                                {mood.key !== 'neutral' && <SentimentMark sentiment={c.sentiment} className="shrink-0" />}
                              </span>
                              <span className="ledger-sub block md:contents">
                                <span className="md:block md:truncate md:text-[0.9375rem] md:text-text-primary">{c.phone ? phonePretty(c.phone) : <span className="text-text-muted">No phone</span>}</span>
                                {car && <span className="md:hidden"> · </span>}
                                <span className="md:block md:truncate md:text-[0.9375rem]">{car}</span>
                              </span>
                              <span className={`text-[0.8125rem] text-text-secondary md:block md:text-[0.9375rem] ${last || (v && v.jobs > 0) ? 'block' : 'hidden'}`}>
                                {last && <><span className="md:hidden">Last visit </span>{last}</>}
                                {v && v.jobs > 0 && <span className="md:hidden">{last ? ' · ' : ''}{v.jobs} {v.jobs === 1 ? 'job' : 'jobs'}</span>}
                              </span>
                            </span>
                          </button>
                          {c.phone ? (
                            <button type="button" className="btn-icon mr-1 shrink-0 text-blue hover:text-blue" onClick={() => dialCustomer(c)} aria-label={`Call ${c.name || 'customer'}`} title="Call">
                              <Icon name="phone" className="h-5 w-5" />
                            </button>
                          ) : <span className="mr-1 h-11 w-11 shrink-0 sm:h-10 sm:w-10" aria-hidden="true" />}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              </>
            )}
          </div>
        </>
      )}

      <Sheet open={sheet !== null} onClose={closeSheet} title={sheetTitle} wide>
        <div ref={sheetBody} tabIndex={-1} className="outline-none">
          {sheet?.mode === 'view' && current && (
            <CustomerDetail
              customer={current}
              onEdit={() => openEdit(current)}
              onText={() => setSheet({ mode: 'send', id: current.id, channel: 'sms' })}
              onEmail={() => setSheet({ mode: 'send', id: current.id, channel: 'email' })}
            />
          )}
          {(sheet?.mode === 'edit' || sheet?.mode === 'new') && (
            <CustomerForm
              form={form} setForm={setForm} isNew={sheet.mode === 'new'} saving={saving} error={saveError} nameError={nameError}
              onSave={save}
              onCancel={() => (sheet.mode === 'edit' ? (setForm({}), setSaveError(''), setNameError(false), setSheet({ mode: 'view', id: sheet.id })) : closeSheet())}
              onDelete={sheet.mode === 'edit' ? del : undefined}
            />
          )}
          {sheet?.mode === 'send' && current && (
            <SendPanel
              customer={current} channel={sheet.channel}
              onBack={() => setSheet({ mode: 'view', id: current.id })}
              onSent={message => { setNotice(message); setSheet({ mode: 'view', id: current.id }) }}
            />
          )}
        </div>
      </Sheet>
    </div>
  )
}
