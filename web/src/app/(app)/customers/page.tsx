'use client'
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { formatCurrency, getShopId, supabase } from '@/lib/supabase'
import { ageLabel, phonePretty } from '@/lib/today'
import { contactProblems, findDuplicates, isDirty, reasonOf } from '@/lib/list-logic'
import Icon from '@/components/Icon'
import Sheet from '@/components/Sheet'
import { EmptyBlock, ErrorCard, FilterChips, RowsSkeleton, SearchField } from '@/components/ListKit'
import FlashNotice from '@/components/forms/FlashNotice'
import type { Flash } from '@/components/forms/FlashNotice'
import SentimentMark from '@/components/customers/SentimentMark'
import CustomerForm from '@/components/customers/CustomerForm'
import CustomerDetail, { dialCustomer } from '@/components/customers/CustomerDetail'
import SendPanel from '@/components/customers/SendPanel'
import { SENTIMENTS, matchesSearch, sentimentOf, text, vehicleLabel } from '@/components/customers/types'
import type { Customer } from '@/components/customers/types'
import { docTotals } from '@/components/jobs/types'

type SheetState =
  | { mode: 'view'; id: string }
  | { mode: 'edit'; id: string }
  | { mode: 'new' }
  | { mode: 'send'; id: string; channel: 'sms' | 'email' }

type Filter = 'all' | 'owes' | 'happy' | 'neutral' | 'unhappy' | 'vip' | 'at-risk'
type Sort = 'name' | 'recent' | 'owes'

interface VisitInfo { jobs: number; last: string }

const OWED = ['Unpaid', 'Partial', 'Sent']

function Header({ onNew, subtitle, disabled = false }: { onNew: () => void; subtitle: string; disabled?: boolean }) {
  return (
    <header className="page-header">
      <div className="min-w-0">
        <h1 className="page-title">Customers</h1>
        <p className="page-subtitle num" aria-live="polite">{subtitle}</p>
      </div>
      <button type="button" className="btn btn-primary w-full sm:w-auto" onClick={onNew} disabled={disabled}>
        <Icon name="plus" className="h-5 w-5" />New customer
      </button>
    </header>
  )
}

export default function CustomersPage() {
  return (
    <Suspense fallback={<div className="page-container"><Header onNew={() => {}} subtitle="Loading…" disabled /><RowsSkeleton rows={8} label="Loading customers" /></div>}>
      <CustomersScreen />
    </Suspense>
  )
}

function CustomersScreen() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [visits, setVisits] = useState<Record<string, VisitInfo>>({})
  const [owed, setOwed] = useState<Record<string, number>>({})
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('name')
  const [sheet, setSheet] = useState<SheetState | null>(null)
  const [confirm, setConfirm] = useState<null | 'discard' | 'delete'>(null)
  const [form, setForm] = useState<Partial<Customer>>({})
  const [baseline, setBaseline] = useState<Partial<Customer>>({})
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [nameError, setNameError] = useState(false)
  const [tried, setTried] = useState(false)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<Flash | null>(null)
  const sheetBody = useRef<HTMLDivElement>(null)
  const afterDiscard = useRef<() => void>(() => {})

  const params = useSearchParams()
  const qParam = params.get('q')
  const customerParam = params.get('customer')
  const handledLink = useRef('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      let shopId: string | null = null
      try { shopId = await getShopId() } catch { shopId = null }
      if (!shopId) { setCustomers([]); setVisits({}); setOwed({}); setLoadError('We could not find your shop. Try refreshing, or sign out and back in.'); return }
      // Customers, jobs and paperwork are independent, so fetch them together.
      const [{ data, error }, { data: jobs }, { data: paper }] = await Promise.all([
        supabase.from('customers').select('*').eq('shop_id', shopId).order('name'),
        supabase.from('jobs').select('customer_id,created_at').eq('shop_id', shopId),
        supabase.from('documents').select('customer_id,created_at,type,status,parts,labors,shop_supplies,sublet,tax_rate,apply_tax,deposit,amount_paid').eq('shop_id', shopId).in('type', ['Invoice', 'Receipt']).order('created_at', { ascending: false }).limit(2000),
      ])
      if (error) {
        // Keep the current list on screen; a failed refresh must not look like "no customers".
        setLoadError('Your customers could not be loaded. Check your connection and try again.')
        return
      }
      setLoadError(null)
      setCustomers((data || []) as Customer[])
      const info: Record<string, VisitInfo> = {}
      const money: Record<string, number> = {}
      const touch = (id: unknown, when: unknown, isJob: boolean) => {
        if (!id) return
        const k = String(id)
        const row = (info[k] ||= { jobs: 0, last: '' })
        if (isJob) row.jobs += 1
        const w = String(when || '')
        if (w > row.last) row.last = w
      }
      ;(jobs || []).forEach((j: Record<string, unknown>) => touch(j.customer_id, j.created_at, true))
      ;(paper || []).forEach((d: Record<string, unknown>) => {
        const status = String(d.status || '')
        if (status === 'Draft' || status === 'Void') return
        touch(d.customer_id, d.created_at, false)
        if (d.type === 'Invoice' && OWED.includes(status) && d.customer_id) {
          const t = docTotals(d)
          const due = t.total - t.paid
          if (due > 0.005) money[String(d.customer_id)] = (money[String(d.customer_id)] || 0) + due
        }
      })
      setVisits(info)
      setOwed(money)
    } catch {
      setLoadError('Your customers could not be loaded. Check your connection and try again.')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    const ch = supabase.channel('customers_page').on('postgres_changes', { event: '*', schema: 'public', table: 'customers' }, () => { void load() }).subscribe()
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
      else setFlash({ kind: 'error', text: 'That customer was not found. They may have been deleted.' })
    } else if (qParam) {
      const exact = customers.filter(c => text(c.name).trim().toLowerCase() === qParam.trim().toLowerCase())
      if (exact.length === 1) setSheet({ mode: 'view', id: exact[0].id })
    }
  }, [loading, loadError, qParam, customerParam, customers])

  // A confirmation clears itself. Anything with a button (like an error to read) stays until dismissed.
  useEffect(() => {
    if (!flash || flash.kind === 'error' || flash.action) return
    const t = setTimeout(() => setFlash(null), 8000)
    return () => clearTimeout(t)
  }, [flash])

  const closeSheet = useCallback(() => {
    setSheet(null); setConfirm(null); setForm({}); setBaseline({}); setSaveError(''); setNameError(false); setTried(false)
  }, [])

  // Keep keyboard and screen reader focus inside the sheet when its content changes.
  const mode = sheet?.mode
  useEffect(() => {
    if (!mode) return
    // A new view starts at its top, not wherever the last one was scrolled to.
    sheetBody.current?.closest('[role="dialog"]')?.scrollTo({ top: 0 })
    if (mode === 'new') return
    sheetBody.current?.focus({ preventScroll: true })
  }, [mode, confirm])

  const current = sheet && 'id' in sheet ? customers.find(c => c.id === sheet.id) || null : null
  useEffect(() => {
    // The customer vanished (deleted elsewhere): close instead of showing an empty sheet.
    if (sheet && 'id' in sheet && !loading && !current) closeSheet()
  }, [sheet, current, loading, closeSheet])

  // The "enter a name" message goes away as soon as there is one.
  useEffect(() => { if (nameError && text(form.name).trim()) setNameError(false) }, [nameError, form.name])

  const inForm = sheet?.mode === 'new' || sheet?.mode === 'edit'
  const dirty = inForm && isDirty(form, baseline)

  /** Leaves the form. Asks first when there are typed changes that would be lost. */
  const leaveForm = useCallback((then: () => void) => {
    if (dirty) { afterDiscard.current = then; setConfirm('discard'); return }
    then()
  }, [dirty])

  const requestClose = () => {
    if (confirm) { setConfirm(null); return }
    if (inForm) leaveForm(closeSheet)
    else closeSheet()
  }

  const startForm = (initial: Partial<Customer>, next: SheetState) => {
    setForm(initial); setBaseline(initial)
    setSaveError(''); setNameError(false); setTried(false); setConfirm(null)
    setSheet(next)
  }
  const openNew = () => startForm({ preferred_contact: 'Call', sentiment: 'neutral' }, { mode: 'new' })
  const openEdit = (c: Customer) => startForm({ ...c }, { mode: 'edit', id: c.id })

  const save = async () => {
    if (saving) return
    setTried(true)
    if (!text(form.name).trim()) {
      setNameError(true); setSaveError('')
      requestAnimationFrame(() => document.getElementById('cf-name')?.focus())
      return
    }
    const problems = contactProblems(form.phone, form.email)
    if (problems.phone || problems.email) {
      setSaveError('')
      requestAnimationFrame(() => document.getElementById(problems.phone ? 'cf-phone' : 'cf-email')?.focus())
      return
    }
    setNameError(false); setSaveError(''); setSaving(true)
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('We could not find your shop. Try refreshing, or sign out and back in.')
      const safeFields = ['name', 'phone', 'email', 'address', 'notes', 'preferred_contact', 'vehicle_year', 'vehicle_make', 'vehicle_model', 'vehicle_vin', 'vehicle_plate', 'vehicle_mileage']
      const data: Record<string, unknown> = { shop_id: shopId, updated_at: new Date().toISOString() }
      for (const k of safeFields) { if ((form as Record<string, string>)[k] !== undefined) data[k] = (form as Record<string, string>)[k] }
      data.name = text(form.name).trim()
      const extended = ['sentiment', 'vehicle_color', 'vehicle_engine', 'last_contact', 'review_requested']
      for (const k of extended) { if ((form as Record<string, string>)[k] !== undefined) data[k] = (form as Record<string, string>)[k] }
      let newId: string | null = null
      if (sheet?.mode === 'new') {
        const { data: made, error } = await supabase.from('customers').insert({ ...data, created_at: new Date().toISOString() }).select('id').single()
        if (error) throw new Error(error.message)
        newId = made?.id ? String(made.id) : null
      } else if (sheet?.mode === 'edit') {
        const { error } = await supabase.from('customers').update(data).eq('id', sheet.id).eq('shop_id', shopId)
        if (error) throw new Error(error.message)
      }
      const editedId = sheet && 'id' in sheet ? sheet.id : newId
      await load()
      setFlash({ kind: 'success', text: sheet?.mode === 'new' ? `${data.name} was added.` : 'Changes saved.' })
      setForm({}); setBaseline({}); setTried(false)
      if (editedId) setSheet({ mode: 'view', id: editedId })
      else closeSheet()
    } catch (e) {
      setSaveError(`Not saved. ${reasonOf(e, 'Check your connection.')} Everything you typed is still here. Tap ${sheet?.mode === 'new' ? 'Add customer' : 'Save changes'} to try again.`)
    } finally { setSaving(false) }
  }

  const del = async () => {
    if (!sheet || sheet.mode !== 'edit' || busy) return
    const name = current?.name || 'The customer'
    setBusy(true); setSaveError('')
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('We could not find your shop. Try refreshing, or sign out and back in.')
      const { error } = await supabase.from('customers').delete().eq('id', sheet.id).eq('shop_id', shopId)
      if (error) throw new Error(error.message)
      closeSheet()
      setFlash({ kind: 'success', text: `${name} was deleted. Their estimates, invoices and repair orders are still on file.` })
      await load()
    } catch (e) {
      setSaveError(`Not deleted. ${reasonOf(e, 'Check your connection.')} Try again.`)
    } finally { setBusy(false) }
  }

  const sorted = useMemo(
    () => [...customers].sort((a, b) => {
      if (sort === 'recent') {
        const al = visits[a.id]?.last || '', bl = visits[b.id]?.last || ''
        if (al !== bl) return al ? (bl ? bl.localeCompare(al) : -1) : 1
      } else if (sort === 'owes') {
        const d = (owed[b.id] || 0) - (owed[a.id] || 0)
        if (d) return d
      }
      const an = text(a.name).trim(), bn = text(b.name).trim()
      if (!an !== !bn) return an ? -1 : 1
      return an.localeCompare(bn, undefined, { sensitivity: 'base' })
    }),
    [customers, sort, visits, owed],
  )

  const filtered = useMemo(
    () => sorted.filter(c => matchesSearch(c, search) && (filter === 'all' || (filter === 'owes' ? (owed[c.id] || 0) > 0.005 : sentimentOf(c).key === filter))),
    [sorted, search, filter, owed],
  )

  const counts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const c of customers) { const k = sentimentOf(c).key; m[k] = (m[k] || 0) + 1 }
    return m
  }, [customers])

  const owingCount = useMemo(() => customers.filter(c => (owed[c.id] || 0) > 0.005).length, [customers, owed])
  const owedTotal = useMemo(() => customers.reduce((s, c) => s + ((owed[c.id] || 0) > 0.005 ? owed[c.id] : 0), 0), [customers, owed])

  const duplicates = useMemo(
    () => (sheet?.mode === 'new' || sheet?.mode === 'edit' ? findDuplicates(customers, { id: sheet.mode === 'edit' ? sheet.id : undefined, name: form.name, phone: form.phone, email: form.email }) : []),
    [sheet, customers, form.name, form.phone, form.email],
  )

  const filtersOn = search.trim() !== '' || filter !== 'all'
  const clearFilters = () => { setSearch(''); setFilter('all') }
  const firstLoad = loading && customers.length === 0 && !loadError

  const subtitle = firstLoad ? 'Loading…'
    : loadError && customers.length === 0 ? 'Could not load customers'
    : customers.length === 0 ? 'Your customer book'
    : `${customers.length} ${customers.length === 1 ? 'customer' : 'customers'}${owingCount > 0 ? `, ${owingCount} ${owingCount === 1 ? 'owes' : 'owe'} you ${formatCurrency(owedTotal)}` : ''}`

  const sheetTitle =
    !sheet ? 'Customer'
    : confirm === 'delete' ? `Delete ${current?.name || 'this customer'}?`
    : confirm === 'discard' ? 'Discard your changes?'
    : sheet.mode === 'new' ? 'New customer'
    : sheet.mode === 'edit' ? 'Edit customer'
    : sheet.mode === 'send' ? `${sheet.channel === 'sms' ? 'Text' : 'Email'} ${current?.name || 'customer'}`
    : current?.name || 'Customer'

  const groupLetter = (c: Customer) => {
    const ch = text(c.name).trim().charAt(0).toUpperCase()
    return /[A-Z]/.test(ch) ? ch : '#'
  }
  const showLetters = sort === 'name' && filtered.length >= 8
  const GRID = 'md:grid-cols-[minmax(0,1.6fr)_9rem_minmax(0,1.4fr)_8rem_9rem]'

  return (
    <div className="page-container animate-fade-in">
      <Header onNew={openNew} subtitle={subtitle} disabled={firstLoad} />

      {flash && <FlashNotice flash={flash} onDismiss={() => setFlash(null)} />}

      {loadError && customers.length === 0 ? (
        <ErrorCard className="max-w-xl" title="Your customers did not load" message={loadError} onRetry={() => void load()} busy={loading} />
      ) : firstLoad ? (
        <RowsSkeleton rows={8} label="Loading customers" />
      ) : customers.length === 0 ? (
        <EmptyBlock icon="customers" title="No customers yet" action={<button type="button" className="btn btn-primary" onClick={openNew}><Icon name="plus" className="h-5 w-5" />Add your first customer</button>}>
          Add the people you fix cars for. Their phone, email and vehicle save here, so estimates, texts and the schedule fill themselves in.
        </EmptyBlock>
      ) : (
        <>
          {loadError && <ErrorCard className="mb-4" message={`${loadError} What you see may be out of date.`} onRetry={() => void load()} busy={loading} />}

          <div className="space-y-3">
            <SearchField label="Search customers by name, phone, vehicle or email" placeholder="Search name, phone, vehicle or email" value={search} onChange={setSearch} />
            <FilterChips<Filter>
              scroll
              label="Show customers"
              value={filter}
              onChange={setFilter}
              options={[
                { key: 'all', label: 'All', count: customers.length },
                { key: 'owes', label: 'Owes money', count: owingCount },
                ...SENTIMENTS.map(s => ({ key: s.key as Filter, label: s.label, count: counts[s.key] || 0 })),
              ]}
            />
          </div>

          <div className="mb-2 mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <div className="flex items-center gap-2">
              <label htmlFor="cust-sort" className="text-[0.9375rem] text-text-secondary">Sort by</label>
              <select id="cust-sort" className="form-select !w-auto" value={sort} onChange={e => setSort(e.target.value as Sort)}>
                <option value="name">Name</option>
                <option value="recent">Last visit</option>
                <option value="owes">Most owed</option>
              </select>
            </div>
            {filtersOn && (
              <p className="text-[0.9375rem] text-text-secondary" aria-live="polite">
                <span className="num font-bold text-text-primary">{filtered.length}</span> of <span className="num">{customers.length}</span> customers
                <button type="button" className="ml-3 inline-flex min-h-[44px] items-center font-bold text-blue underline-offset-4 hover:underline" onClick={clearFilters}>Show everyone</button>
              </p>
            )}
          </div>

          <div aria-live="polite">
            {filtered.length === 0 ? (
              <EmptyBlock
                icon="search"
                title={search.trim() ? `No customers match “${search.trim()}”` : filter === 'owes' ? 'Nobody owes you right now' : `No customers marked ${sentimentOf({ sentiment: filter }).label.toLowerCase()}`}
                action={<button type="button" className="btn btn-secondary" onClick={clearFilters}>Show all customers</button>}
              >
                {search.trim() ? 'Try fewer letters, or the last four digits of a phone number.' : filter === 'owes' ? 'Customers with an unpaid invoice show here.' : 'Change a customer’s mood from their Edit screen.'}
              </EmptyBlock>
            ) : (
              <>
                {/* Column names on wide screens. Rows below use the same grid. */}
                <div className={`hidden gap-4 border-t border-border px-3 pb-2 pt-3 pr-[3.5rem] text-[0.875rem] font-bold text-text-secondary md:grid ${GRID}`} aria-hidden="true">
                  <span>Name</span><span>Phone</span><span>Vehicle</span><span>Last visit</span><span className="text-right">Owes</span>
                </div>
                <ul className="ledger">
                  {filtered.map((c, i) => {
                    const v = visits[c.id]
                    const car = vehicleLabel(c)
                    const mood = sentimentOf(c)
                    const last = v?.last ? ageLabel(v.last) : ''
                    const due = owed[c.id] || 0
                    const startsGroup = showLetters && (i === 0 || groupLetter(filtered[i - 1]) !== groupLetter(c))
                    return (
                      <li key={c.id}>
                        {startsGroup && (
                          <div className="border-b border-border bg-bg-chrome/60 px-3 py-1.5 text-[0.875rem] font-bold text-text-secondary" aria-hidden="true">{groupLetter(c)}</div>
                        )}
                        <div className="flex items-center">
                          <button
                            type="button"
                            className={`ledger-row min-w-0 flex-1 md:grid md:gap-4 ${GRID}`}
                            onClick={() => setSheet({ mode: 'view', id: c.id })}
                            aria-label={`${c.name || 'Unnamed customer'}${mood.key !== 'neutral' ? `, ${mood.label}` : ''}${due > 0.005 ? `, owes ${formatCurrency(due)}` : ''}. Open details`}
                          >
                            <span className="ledger-main md:contents">
                              <span className="flex min-w-0 items-center gap-2">
                                <span className="ledger-title">{c.name || 'Unnamed customer'}</span>
                                {mood.key !== 'neutral' && <SentimentMark sentiment={c.sentiment} className="shrink-0" />}
                              </span>
                              <span className="ledger-sub block md:contents">
                                <span className="md:block md:truncate md:text-[0.9375rem] md:text-text-primary">{c.phone ? phonePretty(c.phone) : <span className="text-text-secondary">No phone</span>}</span>
                                {car && <span className="md:hidden"> · </span>}
                                <span className="md:block md:truncate md:text-[0.9375rem]">{car}</span>
                              </span>
                              <span className={`text-[0.875rem] text-text-secondary md:block md:text-[0.9375rem] ${last || (v && v.jobs > 0) ? 'block' : 'hidden'}`}>
                                {last && <><span className="md:hidden">Last visit </span>{last}</>}
                                {v && v.jobs > 0 && <span className="md:hidden">{last ? ' · ' : ''}{v.jobs} {v.jobs === 1 ? 'job' : 'jobs'}</span>}
                              </span>
                              {due > 0.005
                                ? <span className="num mt-0.5 flex items-center gap-1.5 whitespace-nowrap text-[0.9375rem] font-bold text-red md:mt-0 md:justify-end"><span className="lamp lamp-red" aria-hidden="true" />Owes {formatCurrency(due)}</span>
                                : <span className="hidden md:block" aria-hidden="true" />}
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

      <Sheet open={sheet !== null} onClose={requestClose} title={sheetTitle} wide dirty={dirty}>
        <div ref={sheetBody} tabIndex={-1} className="outline-none">
          {confirm === 'discard' && (
            <div>
              <p className="text-[0.9375rem]">You typed changes that are not saved yet. If you leave now they are lost.</p>
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" className="btn btn-secondary" onClick={() => setConfirm(null)}>Keep editing</button>
                <button type="button" className="btn btn-danger" onClick={() => { const go = afterDiscard.current; setConfirm(null); go() }}>Discard changes</button>
              </div>
            </div>
          )}
          {confirm === 'delete' && (
            <div>
              <p className="text-[0.9375rem]">
                This removes {current?.name || 'this customer'} from your customer book for good. Their estimates, invoices, repair orders and messages stay on file, but they are no longer linked to a customer.
              </p>
              {saveError && <p role="alert" className="form-error !text-[0.875rem]">{saveError}</p>}
              <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <button type="button" className="btn btn-secondary" onClick={() => { setConfirm(null); setSaveError('') }} disabled={busy}>Keep customer</button>
                <button type="button" className="btn btn-danger" onClick={() => void del()} disabled={busy}>{busy ? 'Deleting…' : 'Delete customer'}</button>
              </div>
            </div>
          )}
          {!confirm && sheet?.mode === 'view' && current && (
            <CustomerDetail
              customer={current}
              onEdit={() => openEdit(current)}
              onText={() => setSheet({ mode: 'send', id: current.id, channel: 'sms' })}
              onEmail={() => setSheet({ mode: 'send', id: current.id, channel: 'email' })}
            />
          )}
          {!confirm && (sheet?.mode === 'edit' || sheet?.mode === 'new') && (
            <CustomerForm
              form={form} setForm={setForm} isNew={sheet.mode === 'new'} saving={saving} error={saveError} nameError={nameError}
              tried={tried} duplicates={duplicates}
              onOpenExisting={id => leaveForm(() => { setForm({}); setBaseline({}); setSheet({ mode: 'view', id }) })}
              onSave={() => void save()}
              onCancel={() => leaveForm(() => { if (sheet.mode === 'edit') { setForm({}); setBaseline({}); setSaveError(''); setNameError(false); setSheet({ mode: 'view', id: sheet.id }) } else closeSheet() })}
              onDelete={sheet.mode === 'edit' ? () => { setSaveError(''); setConfirm('delete') } : undefined}
            />
          )}
          {!confirm && sheet?.mode === 'send' && current && (
            <SendPanel
              customer={current} channel={sheet.channel}
              onBack={() => setSheet({ mode: 'view', id: current.id })}
              onSent={msg => { setFlash({ kind: 'success', text: msg }); setSheet({ mode: 'view', id: current.id }) }}
            />
          )}
        </div>
      </Sheet>
    </div>
  )
}
