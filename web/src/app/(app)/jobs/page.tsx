'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getShopId, supabase } from '@/lib/supabase'
import Sheet from '@/components/Sheet'
import Icon from '@/components/Icon'
import Segmented from '@/components/inbox/Segmented'
import { FilterChips, SearchField } from '@/components/ListKit'
import { JobRows, JobTag } from '@/components/jobs/JobCards'
import JobDetail from '@/components/jobs/JobDetail'
import JobForm from '@/components/jobs/JobForm'
import {
  OPEN_STAGES, STAGES, byUrgency, carLine, docTotals, firstName, isDone, localKey, nextRoNumber, stageOf, statusWord,
} from '@/components/jobs/types'
import type { Job, JobCustomer, JobDoc, JobInspection, StageKey } from '@/components/jobs/types'

type View = 'board' | 'list'
type Filter = 'open' | StageKey
interface Notice { text: string; action?: { label: string; run: () => void } }

const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)

/** The columns a person can edit. Everything else on the row (insurance fields and so on) is left as it was. */
const EDITABLE = [
  'customer_id', 'customer_name', 'concern', 'status', 'tech', 'priority',
  'vehicle_year', 'vehicle_make', 'vehicle_model', 'vehicle_color', 'vehicle_engine', 'vehicle_plate', 'vehicle_vin', 'vehicle_mileage',
  'promise_date', 'internal_notes', 'customer_notes',
] as const

export default function JobsPage() {
  // Anything that depends on today's date waits for the browser, so the server and browser never disagree.
  const [todayKey, setTodayKey] = useState('')
  const [desktop, setDesktop] = useState(false)
  const [view, setView] = useState<View>('list')
  const [filter, setFilter] = useState<Filter>('open')
  const [search, setSearch] = useState('')

  const [jobs, setJobs] = useState<Job[]>([])
  const [docs, setDocs] = useState<JobDoc[]>([])
  const [inspections, setInspections] = useState<JobInspection[]>([])
  const [customers, setCustomers] = useState<JobCustomer[]>([])
  const [techs, setTechs] = useState<string[]>(['Unassigned'])
  const [shop, setShop] = useState({ name: '', phone: '' })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [moveError, setMoveError] = useState('')

  const [sheet, setSheet] = useState<null | 'form' | 'detail' | 'delete'>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [textFirst, setTextFirst] = useState(false)
  const [form, setForm] = useState<Partial<Job>>({})
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [textSent, setTextSent] = useState('')
  const [detailNote, setDetailNote] = useState('')
  const [dragging, setDragging] = useState<string | null>(null)
  const [overStage, setOverStage] = useState<StageKey | null>(null)

  // Once the owner picks Board or List, the screen size no longer chooses for them.
  const viewTouched = useRef(false)
  useEffect(() => {
    setTodayKey(localKey())
    const mq = window.matchMedia('(min-width: 1024px)')
    const apply = () => { setDesktop(mq.matches); if (mq.matches) setView(v => (v === 'list' && !viewTouched.current ? 'board' : v)) }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  const load = useCallback(async () => {
    try {
      const shopId = await getShopId()
      if (!shopId) { setJobs([]); setLoadError('We could not find your shop. Refresh, or sign out and back in.'); return }
      const [j, d, v] = await Promise.all([
        supabase.from('jobs').select('*').eq('shop_id', shopId).order('created_at', { ascending: false }).limit(2000),
        supabase.from('documents').select('id,job_id,type,doc_number,status,parts,labors,shop_supplies,sublet,tax_rate,apply_tax,deposit,amount_paid').eq('shop_id', shopId).not('job_id', 'is', null).order('created_at', { ascending: false }).limit(1000),
        supabase.from('dvi').select('id,job_id,overall_status,sent_to_customer,customer_approved,created_at').eq('shop_id', shopId).not('job_id', 'is', null).order('created_at', { ascending: false }).limit(1000),
      ])
      if (j.error) throw j.error
      setJobs((j.data || []) as Job[])
      // Paperwork is a bonus on this screen: if it fails to load the jobs still show.
      setDocs(((d.data || []) as Record<string, unknown>[]).map(r => ({
        id: String(r.id), job_id: String(r.job_id), type: String(r.type || ''), doc_number: String(r.doc_number || ''), status: String(r.status || ''), ...docTotals(r),
      })))
      // Inspections are a bonus on this screen too.
      setInspections(((v.data || []) as Record<string, unknown>[]).map(r => ({
        id: String(r.id), job_id: String(r.job_id), overall_status: String(r.overall_status || ''), sent_to_customer: r.sent_to_customer === true,
        customer_approved: r.customer_approved === true, created_at: String(r.created_at || ''),
      })))
      setLoadError('')
    } catch (e) {
      setLoadError(`Jobs did not load. ${errText(e, 'Check your connection and try again.')}`)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    fetch('/api/staff?role=technician').then(r => r.json()).then(d => {
      if (d?.ok && Array.isArray(d.staff)) setTechs(['Unassigned', ...d.staff.map((s: { name: string }) => s.name).filter(Boolean)])
    }).catch(() => { /* typing a tech name still works */ })
    getShopId().then(shopId => {
      if (!shopId) return
      supabase.from('customers').select('id,name,phone,vehicle_year,vehicle_make,vehicle_model,vehicle_color,vehicle_engine,vehicle_plate').eq('shop_id', shopId).order('name').then(({ data }) => setCustomers((data || []) as JobCustomer[]))
      supabase.from('settings').select('shop_name,shop_phone').eq('shop_id', shopId).maybeSingle().then(({ data }) => {
        if (data) setShop({ name: String(data.shop_name || ''), phone: String(data.shop_phone || '') })
      })
    }).catch(() => { /* the form still works without the customer list */ })
    const ch = supabase.channel('jobs_page').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => { void load() }).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  /* ---------- opening things ---------- */
  const openNew = useCallback((customerId?: string) => {
    const base: Partial<Job> = { status: 'New', priority: 'Normal', tech: '', promise_date: null }
    const c = customerId ? customers.find(x => x.id === customerId) : undefined
    if (c) Object.assign(base, {
      customer_id: c.id, customer_name: c.name, vehicle_year: c.vehicle_year || '', vehicle_make: c.vehicle_make || '', vehicle_model: c.vehicle_model || '',
      vehicle_color: c.vehicle_color || '', vehicle_engine: c.vehicle_engine || '', vehicle_plate: c.vehicle_plate || '',
    })
    setForm(base); setFormError(''); setOpenId(null); setSheet('form')
  }, [customers])

  const openJob = useCallback((j: Job, texting = false) => { setOpenId(j.id); setTextFirst(texting); setDetailError(''); setTextSent(''); setDetailNote(''); setSheet('detail') }, [])
  const closeSheet = () => { setSheet(null); setFormError(''); setDetailError('') }
  const current = jobs.find(j => j.id === openId) || null
  const currentDocs = docs.filter(d => d.job_id === openId)
  const currentPhone = current?.customer_id ? customers.find(c => c.id === current.customer_id)?.phone || '' : ''

  // Links from other screens: /jobs?new=1&customer=<id> and /jobs?job=<id>.
  const [linkDone, setLinkDone] = useState(false)
  useEffect(() => {
    if (linkDone || !todayKey || loading) return
    const p = new URLSearchParams(window.location.search)
    if (p.get('new')) {
      const wanted = p.get('customer') || undefined
      if (wanted && customers.length === 0) return // wait for the customer list
      setLinkDone(true); openNew(wanted)
      window.history.replaceState(null, '', window.location.pathname)
    } else if (p.get('job')) {
      setLinkDone(true)
      const hit = jobs.find(j => j.id === p.get('job'))
      if (hit) openJob(hit); else setNotice({ text: 'That job was not found. It may have been deleted.' })
      window.history.replaceState(null, '', window.location.pathname)
    } else setLinkDone(true)
  }, [linkDone, todayKey, loading, customers, jobs, openNew, openJob])

  /* ---------- changing things ---------- */
  const save = async () => {
    if (!form.customer_name?.trim()) { setFormError('Add the customer’s name.'); return }
    setSaving(true); setFormError('')
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('No shop is associated with the signed-in user')
      const row: Record<string, unknown> = {}
      for (const k of EDITABLE) row[k] = (form as Record<string, unknown>)[k] ?? (k === 'promise_date' || k === 'customer_id' ? null : '')
      row.customer_id = row.customer_id || null
      row.promise_date = row.promise_date || null
      row.customer_name = String(row.customer_name).trim()
      row.status = row.status || 'New'
      const now = new Date().toISOString()
      if (!openId) {
        const r = await supabase.from('jobs').insert({ ...row, ro_number: nextRoNumber(jobs), shop_id: shopId, created_at: now, updated_at: now })
        if (r.error) throw new Error(r.error.message)
      } else {
        const r = await supabase.from('jobs').update({ ...row, updated_at: now }).eq('id', openId).eq('shop_id', shopId)
        if (r.error) throw new Error(r.error.message)
      }
      setSheet(null)
      setNotice({ text: `${openId ? 'Saved' : 'Job created'}: ${row.customer_name}.` })
      await load()
    } catch (e) {
      setFormError(`Not saved. ${errText(e, 'Check your connection and try again.')}`)
    } finally { setSaving(false) }
  }

  /** Moves a job at once on screen, then saves. If saving fails the job goes back where it was and says so. */
  const moveJob = useCallback(async (j: Job, status: string, fromSheet = false) => {
    if (j.status === status) return
    const before = j.status
    setMoveError(''); setDetailError(''); setBusy(true)
    setJobs(js => js.map(x => (x.id === j.id ? { ...x, status } : x)))
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('No shop is associated with the signed-in user')
      const r = await supabase.from('jobs').update({ status, updated_at: new Date().toISOString() }).eq('id', j.id).eq('shop_id', shopId)
      if (r.error) throw new Error(r.error.message)
      const phone = j.customer_id ? customers.find(c => c.id === j.customer_id)?.phone : ''
      const ready = status === 'Ready for Pickup' || status === 'Completed'
      const text = `${j.customer_name || 'Job'} is now ${statusWord(status).toLowerCase()}.`
      // A notice behind an open sheet cannot be seen, so a change made in the sheet is announced inside it.
      if (fromSheet) setDetailNote(text)
      else setNotice({ text, action: ready && phone ? { label: `Text ${firstName(j.customer_name) || 'the customer'}`, run: () => openJob({ ...j, status }, true) } : undefined })
    } catch (e) {
      setJobs(js => js.map(x => (x.id === j.id ? { ...x, status: before } : x)))
      const msg = `${j.customer_name || 'The job'} was not moved. ${errText(e, 'Check your connection and try again.')}`
      setMoveError(msg); setDetailError(msg)
    } finally { setBusy(false) }
  }, [customers, openJob])

  const sendText = async (body: string) => {
    if (!current || !currentPhone) return
    setBusy(true); setDetailError(''); setTextSent('')
    try {
      const res = await fetch('/api/send-message', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: currentPhone, body, channel: 'sms', jobId: current.id, ...(current.customer_id ? { customerId: current.customer_id } : {}) }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.error) throw new Error(d.error || 'The text did not send. Check your connection and try again.')
      setTextSent(`Text sent to ${current.customer_name}.`)
    } catch (e) { setDetailError(errText(e, 'The text did not send.')) }
    finally { setBusy(false) }
  }

  const del = async () => {
    if (!openId) return
    setBusy(true)
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('No shop is associated with the signed-in user')
      const r = await supabase.from('jobs').delete().eq('id', openId).eq('shop_id', shopId)
      if (r.error) throw new Error(r.error.message)
      const name = current?.customer_name || 'The job'
      setSheet(null); setOpenId(null)
      setNotice({ text: `${name}’s job was deleted.` })
      await load()
    } catch (e) { setDetailError(`Not deleted. ${errText(e, 'Try again.')}`) }
    finally { setBusy(false) }
  }

  /* ---------- what to show ---------- */
  const term = search.trim().toLowerCase()
  const matching = useMemo(() => {
    if (!term) return jobs
    return jobs.filter(j => [j.customer_name, j.concern, j.ro_number, carLine(j), j.vehicle_vin, j.vehicle_plate, j.tech, j.status, statusWord(j.status)]
      .some(v => String(v || '').toLowerCase().includes(term)))
  }, [jobs, term])

  const sorted = useMemo(() => [...matching].sort(byUrgency(todayKey || '0000-00-00')), [matching, todayKey])
  const countFor = (k: StageKey) => matching.filter(j => stageOf(j.status).key === k).length
  const openCount = matching.filter(j => !isDone(j.status)).length
  const shown = sorted.filter(j => (filter === 'open' ? !isDone(j.status) : stageOf(j.status).key === filter))
  const lateCount = jobs.filter(j => !isDone(j.status) && stageOf(j.status).key !== 'ready' && j.promise_date && j.promise_date.slice(0, 10) < todayKey).length
  const allOpen = jobs.filter(j => !isDone(j.status)).length

  const ready = todayKey !== ''
  const subtitle = !ready || loading ? 'Loading…' : loadError && jobs.length === 0 ? 'Could not load jobs'
    : jobs.length === 0 ? 'No jobs yet'
    : `${allOpen} open${lateCount > 0 ? `, ${lateCount} late` : ''}`

  const columns = filter === 'open' ? OPEN_STAGES : STAGES.filter(s => s.key === filter)
  const drop = (stageKey: StageKey) => {
    const id = dragging
    setDragging(null); setOverStage(null)
    const j = jobs.find(x => x.id === id)
    const stage = STAGES.find(s => s.key === stageKey)
    if (!j || !stage || stageOf(j.status).key === stage.key) return
    void moveJob(j, stage.dropTo)
  }

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">Jobs</h1>
          <p className="page-subtitle num" aria-live="polite">{subtitle}</p>
        </div>
        <button type="button" className="btn btn-primary w-full sm:w-auto" onClick={() => openNew()} disabled={!ready}>
          <Icon name="plus" className="h-5 w-5" />New job
        </button>
      </header>

      {notice && (
        <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border border-green/40 bg-bg-card px-4 py-2.5 text-[0.9375rem]">
          <span className="flex min-w-0 items-center gap-2"><Icon name="check" className="h-5 w-5 shrink-0 text-green" /><span className="min-w-0 break-words">{notice.text}</span></span>
          <span className="flex shrink-0 items-center gap-1">
            {notice.action && <button type="button" className="btn btn-secondary btn-sm" onClick={() => { const a = notice.action; setNotice(null); a?.run() }}><Icon name="send" className="h-4 w-4" />{notice.action.label}</button>}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNotice(null)}>Dismiss</button>
          </span>
        </div>
      )}

      {moveError && sheet !== 'detail' && (
        <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-md border border-red/50 bg-red/[0.08] px-4 py-3 text-[0.9375rem]">
          <p className="text-red">{moveError}</p>
          <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => setMoveError('')}>Dismiss</button>
        </div>
      )}

      {loadError && (
        <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-md border border-red/50 bg-red/[0.08] px-4 py-3 text-[0.9375rem]">
          <p className="text-red">{loadError}{jobs.length > 0 ? ' What you see may be out of date.' : ''}</p>
          <button type="button" className="btn btn-secondary btn-sm shrink-0" onClick={() => { setLoadError(''); setLoading(true); void load() }}>Try again</button>
        </div>
      )}

      {!ready || (loading && jobs.length === 0 && !loadError) ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading jobs">
          <div className="skeleton h-12" />
          {[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-[4.25rem]" />)}
        </div>
      ) : jobs.length === 0 ? (
        loadError ? null : (
          <div className="empty-state">
            <p className="font-bold text-text-primary">No jobs yet</p>
            <p className="mx-auto mt-1 max-w-md">Write up a job when a car comes in. It moves across the board as the work gets done, and you can text the customer from it.</p>
            <button type="button" className="btn btn-primary mt-4" onClick={() => openNew()}><Icon name="plus" className="h-5 w-5" />Create the first job</button>
          </div>
        )
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <SearchField className="min-w-0 flex-1 sm:max-w-md" label="Search jobs" placeholder="Search name, car, RO number or concern" value={search} onChange={setSearch} />
            <Segmented
              className="w-full sm:ml-auto sm:w-64"
              label="Jobs view"
              value={view}
              onChange={v => { viewTouched.current = true; setView(v) }}
              options={[{ value: 'board', label: 'Board' }, { value: 'list', label: 'List' }]}
            />
          </div>
          <div className="mb-4">
            <FilterChips
              scroll
              label="Show jobs"
              value={filter}
              onChange={setFilter}
              options={[
                { key: 'open', label: 'All open', count: openCount },
                ...OPEN_STAGES.map(s => ({ key: s.key, label: s.label, count: countFor(s.key) })),
                { key: 'done', label: 'Paid and closed', count: countFor('done') },
              ]}
            />
          </div>

          {view === 'list' ? (
            shown.length === 0 ? (
              <div className="empty-state">
                <p className="font-bold text-text-primary">{term ? `No jobs match “${search.trim()}”` : 'Nothing in this list'}</p>
                <p className="mx-auto mt-1 max-w-md">{term ? 'Check the spelling, or search by customer, car, RO number or concern.' : 'Jobs show here as soon as one moves into this step.'}</p>
                {term && <button type="button" className="btn btn-secondary mt-4" onClick={() => setSearch('')}>Clear search</button>}
              </div>
            ) : <JobRows jobs={shown} todayKey={todayKey} onOpen={j => openJob(j)} />
          ) : (
            <div className="-mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4 sm:mx-0 sm:px-0" role="region" aria-label="Job board" tabIndex={0}>
              {columns.map(s => {
                const items = sorted.filter(j => stageOf(j.status).key === s.key)
                return (
                  <section
                    key={s.key}
                    aria-label={`${s.label}, ${items.length}`}
                    className={`min-w-[17.5rem] shrink-0 snap-start rounded-lg border p-2.5 transition-colors sm:min-w-[15rem] sm:flex-1 ${overStage === s.key ? 'border-blue bg-blue/[0.06]' : 'border-border bg-bg-chrome/50'}`}
                    style={columns.length === 1 ? { maxWidth: '28rem' } : undefined}
                    onDragOver={e => { if (dragging) { e.preventDefault(); setOverStage(s.key) } }}
                    onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOverStage(o => (o === s.key ? null : o)) }}
                    onDrop={e => { e.preventDefault(); drop(s.key) }}
                  >
                    <h2 className="mb-2.5 flex items-center gap-2 px-1 text-[0.9375rem] font-bold">
                      <span className={`lamp lamp-${s.lamp}`} aria-hidden="true" />
                      <span className="min-w-0 flex-1 truncate">{s.label}</span>
                      <span className="num text-text-secondary">{items.length}</span>
                    </h2>
                    {items.length === 0 ? (
                      <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-[0.875rem] text-text-secondary">{overStage === s.key ? 'Drop here' : s.empty}</p>
                    ) : (
                      <div className="space-y-2.5">
                        {items.map(j => (
                          <JobTag
                            key={j.id}
                            job={j}
                            docs={docs.filter(d => d.job_id === j.id)}
                            todayKey={todayKey}
                            draggable={desktop}
                            onOpen={x => openJob(x)}
                            onStep={(x, to) => void moveJob(x, to)}
                            onDragStart={x => setDragging(x.id)}
                            onDragEnd={() => { setDragging(null); setOverStage(null) }}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                )
              })}
            </div>
          )}
          {view === 'board' && desktop && <p className="mt-1 text-[0.875rem] text-text-secondary">Drag a job to another column to change its status.</p>}
        </>
      )}

      <Sheet open={sheet === 'form'} onClose={closeSheet} title={openId ? 'Edit job' : 'New job'} wide>
        <JobForm
          key={`${openId || 'new'}-${sheet === 'form' ? 'open' : 'closed'}`}
          form={form}
          setForm={setForm}
          isNew={!openId}
          customers={customers}
          techs={techs}
          saving={saving}
          error={formError}
          onSave={save}
          onCancel={closeSheet}
        />
      </Sheet>

      <Sheet open={sheet === 'detail' && !!current} onClose={closeSheet} title={current?.customer_name || 'Job'}>
        {current && (
          <JobDetail
            key={`${current.id}-${textFirst ? 'text' : 'view'}`}
            job={current}
            docs={currentDocs}
            inspections={inspections.filter(i => i.job_id === openId)}
            phone={currentPhone}
            shopName={shop.name}
            shopPhone={shop.phone}
            todayKey={todayKey}
            busy={busy}
            error={detailError}
            textSent={textSent}
            note={detailNote}
            startTexting={textFirst}
            onStatus={s => void moveJob(current, s, true)}
            onEdit={() => { setForm({ ...current, promise_date: current.promise_date ? current.promise_date.slice(0, 10) : null }); setFormError(''); setSheet('form') }}
            onCall={() => window.dispatchEvent(new CustomEvent('phone:call', { detail: { number: currentPhone, name: current.customer_name } }))}
            onSendText={sendText}
            onDelete={() => { setDetailError(''); setSheet('delete') }}
          />
        )}
      </Sheet>

      <Sheet open={sheet === 'delete' && !!current} onClose={() => setSheet('detail')} title="Delete this job?">
        <p className="text-[0.9375rem]">
          This removes {current?.customer_name ? `${current.customer_name}’s` : 'the'} job{current?.ro_number ? ` (${current.ro_number})` : ''} from the board for good.
          Estimates and invoices written for it stay, and they are not changed.
        </p>
        {detailError && <p role="alert" className="form-error">{detailError}</p>}
        <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={() => setSheet('detail')} disabled={busy}>Keep job</button>
          <button type="button" className="btn btn-danger" onClick={del} disabled={busy}>{busy ? 'Deleting…' : 'Delete job'}</button>
        </div>
      </Sheet>
    </div>
  )
}
