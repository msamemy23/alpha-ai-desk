'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import { EmptyBlock, ErrorCard, FilterChips, SearchField } from '@/components/ListKit'
import Notice from '@/components/Notice'
import Sheet from '@/components/Sheet'
import DviRows, { listState } from '@/components/dvi/DviRows'
import FollowUpSheet from '@/components/dvi/FollowUpSheet'
import Editor from '@/components/dvi/Editor'
import StartSheet from '@/components/dvi/StartSheet'
import TemplateManager from '@/components/dvi/TemplateManager'
import type { StartCustomer, StartValues } from '@/components/dvi/StartSheet'
import { loadInspection, useDviList } from '@/components/dvi/useDvi'
import { useTemplates } from '@/components/dvi/useTemplates'
import { START_JOB_COLUMNS, rowFrom } from '@/components/dvi/types'
import type { DviListRow, DviRow, StartJob } from '@/components/dvi/types'
import { localKey } from '@/components/jobs/types'
import { counts, makeSections, overallOf, sectionsFromTemplate } from '@/lib/dvi'
import { followUpState } from '@/lib/dvi-followup'
import { getShopId, supabase } from '@/lib/supabase'
import { useShopLogo } from '@/lib/shop-logo'

type Filter = 'all' | 'todo' | 'waiting' | 'answered' | 'follow'

const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)

export default function InspectionsPage() {
  const [todayKey, setTodayKey] = useState('')
  const [open, setOpen] = useState<DviRow | null>(null)
  const [loadingOpen, setLoadingOpen] = useState<string | null>(null)
  const [openError, setOpenError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')
  const [sheet, setSheet] = useState(false)
  const [manage, setManage] = useState(false)
  const [following, setFollowing] = useState<DviListRow | null>(null)
  const manageBack = useRef(false)
  const [presetJob, setPresetJob] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState('')
  const [notice, setNotice] = useState('')

  const [jobs, setJobs] = useState<StartJob[]>([])
  const [customers, setCustomers] = useState<StartCustomer[]>([])
  const [techs, setTechs] = useState<string[]>([])
  const [shop, setShop] = useState({ name: '', phone: '', address: '' })
  const { logo } = useShopLogo()

  const { rows, loading, error, migrated, followups, reload } = useDviList(!open)
  const templates = useTemplates()
  const shopTemplates = useMemo(() => templates.list.filter(t => !t.archived), [templates.list])

  /* ---------- the people, cars and shop details the checklist needs ---------- */
  useEffect(() => {
    setTodayKey(localKey())
    fetch('/api/staff?role=technician').then(r => r.json()).then(d => {
      if (d?.ok && Array.isArray(d.staff)) setTechs(d.staff.map((s: { name: string }) => s.name).filter(Boolean))
    }).catch(() => { /* the technician can still be left blank */ })
    getShopId().then(shopId => {
      if (!shopId) return
      supabase.from('jobs').select(START_JOB_COLUMNS).eq('shop_id', shopId).not('status', 'in', '("Paid","Closed")').order('created_at', { ascending: false }).limit(300)
        .then(({ data }) => setJobs(((data || []) as unknown as Record<string, unknown>[]).map(r => ({
          id: String(r.id), ro_number: typeof r.ro_number === 'string' ? r.ro_number : null, customer_id: typeof r.customer_id === 'string' ? r.customer_id : null,
          customer_name: String(r.customer_name || ''), tech: String(r.tech || ''), vehicle_year: String(r.vehicle_year || ''), vehicle_make: String(r.vehicle_make || ''),
          vehicle_model: String(r.vehicle_model || ''), status: String(r.status || ''),
        }))))
      supabase.from('customers').select('id,name,phone,email,vehicle_year,vehicle_make,vehicle_model').eq('shop_id', shopId).order('name').limit(1500)
        .then(({ data }) => setCustomers(((data || []) as unknown as Record<string, unknown>[]).map(r => ({
          id: String(r.id), name: String(r.name || ''), phone: String(r.phone || ''), email: String(r.email || ''), vehicle_year: String(r.vehicle_year || ''),
          vehicle_make: String(r.vehicle_make || ''), vehicle_model: String(r.vehicle_model || ''),
        }))))
      supabase.from('settings').select('shop_name,shop_phone,shop_address').eq('shop_id', shopId).maybeSingle()
        .then(({ data }) => { if (data) setShop({ name: String(data.shop_name || ''), phone: String(data.shop_phone || ''), address: String(data.shop_address || '') }) })
    }).catch(() => { /* starting by hand still works */ })
  }, [])

  /* ---------- opening and closing (the phone's Back button closes an open inspection) ---------- */
  const show = useCallback((row: DviRow, push: boolean) => {
    setOpen(row)
    setOpenError('')
    if (push) window.history.pushState({ dvi: row.id }, '', `/dvi?id=${encodeURIComponent(row.id)}`)
  }, [])

  const openById = useCallback(async (id: string, push = true) => {
    setLoadingOpen(id); setOpenError('')
    const r = await loadInspection(id)
    setLoadingOpen(null)
    if (r.row) show(r.row, push)
    else {
      setOpenError(r.error || 'The inspection did not load. Try again.')
      if (r.notFound) window.history.replaceState(null, '', '/dvi')
    }
  }, [show])

  const close = useCallback(() => {
    setOpen(null)
    if (window.history.state && window.history.state.dvi) window.history.back()
    else window.history.replaceState(null, '', '/dvi')
    window.scrollTo({ top: 0 })
  }, [])

  useEffect(() => {
    const pop = () => {
      const id = new URLSearchParams(window.location.search).get('id')
      if (!id) setOpen(null)
    }
    window.addEventListener('popstate', pop)
    return () => window.removeEventListener('popstate', pop)
  }, [])

  // Links from other screens: /dvi?id=<id> opens one, /dvi?new=1&job=<id> starts one for that car.
  const linkDone = useRef(false)
  useEffect(() => {
    if (linkDone.current || loading) return
    linkDone.current = true
    const p = new URLSearchParams(window.location.search)
    const id = p.get('id')
    if (id) { void openById(id, false); return }
    if (p.get('new')) { setPresetJob(p.get('job')); setStartError(''); setSheet(true) }
  }, [loading, openById])

  /* ---------- starting ---------- */
  const start = async (v: StartValues) => {
    setStarting(true); setStartError('')
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('We could not find your shop. Refresh, or sign out and back in.')
      const own = shopTemplates.find(t => t.key === v.template)
      const sections = own ? sectionsFromTemplate(own) : makeSections(v.template)
      const now = new Date().toISOString()
      const payload: Record<string, unknown> = {
        shop_id: shopId, job_id: v.job_id, customer_name: v.customer_name, vehicle: v.vehicle, tech: v.tech, sections,
        overall_status: overallOf(sections), tech_notes: '', sent_to_customer: false, customer_approved: false, created_at: now, updated_at: now,
        ...(migrated ? { customer_id: v.customer_id, summary: counts(sections) } : {}),
      }
      const { data, error: err } = await supabase.from('dvi').insert(payload).select('*').single()
      if (err || !data) throw new Error('The inspection could not be started. Check your connection and try again.')
      setSheet(false)
      show(rowFrom(data as Record<string, unknown>), true)
    } catch (e) {
      setStartError(errText(e, 'The inspection could not be started.'))
    } finally { setStarting(false) }
  }

  const openStart = () => { setPresetJob(null); setStartError(''); setSheet(true) }
  const closeManage = () => { setManage(false); if (manageBack.current) { manageBack.current = false; setSheet(true) } }

  /* ---------- what to show ---------- */
  const term = search.trim().toLowerCase()
  const searched = useMemo(() => (!term ? rows : rows.filter(r => [r.customer_name, r.vehicle, r.tech].some(v => v.toLowerCase().includes(term)))), [rows, term])
  const group = (r: DviListRow): Filter => { const s = listState(r); return s === 'answered' ? 'answered' : s === 'sent' ? 'waiting' : 'todo' }
  const needsFollow = (r: DviListRow) => followUpState(r)?.due === true
  const countOf = (f: Filter) => (f === 'all' ? searched.length : f === 'follow' ? searched.filter(needsFollow).length : searched.filter(r => group(r) === f).length)
  const shown = filter === 'all' ? searched : filter === 'follow' ? searched.filter(needsFollow) : searched.filter(r => group(r) === filter)
  const waiting = rows.filter(r => group(r) === 'waiting').length
  const answered = rows.filter(r => group(r) === 'answered').length

  if (open) {
    return (
      <div className="page-container animate-fade-in">
        <Editor
          key={open.id}
          initial={open}
          migrated={migrated}
          techs={techs}
          jobs={jobs}
          customers={customers}
          shop={shop}
          logo={logo}
          todayKey={todayKey}
          onBack={close}
          onDeleted={() => { setNotice('The inspection was deleted.'); close() }}
        />
      </div>
    )
  }

  const subtitle = loading ? 'Loading…' : error && rows.length === 0 ? 'Could not load inspections'
    : rows.length === 0 ? 'None yet'
    : `${rows.length} ${rows.length === 1 ? 'inspection' : 'inspections'}${answered > 0 ? `, ${answered} answered` : waiting > 0 ? `, ${waiting} waiting on customers` : ''}`

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">Inspections</h1>
          <p className="page-subtitle num" aria-live="polite">{subtitle}</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <button type="button" className="btn btn-secondary w-full sm:w-auto" onClick={() => { manageBack.current = false; setManage(true) }}>
            <Icon name="list" className="h-5 w-5" />Your checklists
          </button>
          <button type="button" className="btn btn-primary w-full sm:w-auto" onClick={openStart}>
            <Icon name="plus" className="h-5 w-5" />New inspection
          </button>
        </div>
      </header>

      {notice && (
        <Notice kind="success" className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="min-w-0 flex-1 basis-56">{notice}</span>
            <button type="button" className="btn btn-ghost btn-sm ml-auto shrink-0" onClick={() => setNotice('')}>Dismiss</button>
          </div>
        </Notice>
      )}

      {openError && <ErrorCard className="mb-4" title="That inspection did not open" message={openError} onRetry={loadingOpen || /could not be found/.test(openError) ? undefined : () => { linkDone.current = true; const id = new URLSearchParams(window.location.search).get('id'); if (id) void openById(id, false); else setOpenError('') }} />}

      {loading ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading inspections">
          <div className="skeleton h-12" />
          {[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-[5rem]" />)}
        </div>
      ) : error && rows.length === 0 ? (
        <ErrorCard title="Inspections did not load" message={error} onRetry={() => void reload()} />
      ) : rows.length === 0 ? (
        <EmptyBlock
          icon="inspect"
          title="No inspections yet"
          action={<button type="button" className="btn btn-primary" onClick={openStart}><Icon name="plus" className="h-5 w-5" />Start the first inspection</button>}
        >
          Walk around a car with your phone, rate each part good, watch or needs work, and add photos. Text it to the customer and they approve the repairs from their phone.
        </EmptyBlock>
      ) : (
        <>
          {error && <ErrorCard className="mb-4" title="The list may be out of date" message={error} onRetry={() => void reload()} />}
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
            <SearchField className="min-w-0 flex-1 sm:max-w-md" label="Search inspections" placeholder="Search customer, car or technician" value={search} onChange={setSearch} />
          </div>
          <div className="mb-4">
            <FilterChips
              scroll
              label="Show inspections"
              value={filter}
              onChange={setFilter}
              options={[
                { key: 'all', label: 'All', count: countOf('all') },
                { key: 'todo', label: 'Not sent', count: countOf('todo') },
                { key: 'waiting', label: 'Waiting on customer', count: countOf('waiting') },
                { key: 'answered', label: 'Answered', count: countOf('answered') },
                { key: 'follow', label: 'Follow up', count: countOf('follow') },
              ]}
            />
          </div>
          {shown.length === 0 ? (
            <EmptyBlock icon="inspect" title={term ? `Nothing matches “${search.trim()}”` : 'Nothing here'}>
              {term ? 'Check the spelling, or search by the car or the technician.' : filter === 'waiting' ? 'Nothing is out with a customer right now.' : filter === 'answered' ? 'No customer has answered yet.' : filter === 'follow' ? 'No work is waiting on a customer. Declined work and inspections nobody answered show here.' : 'Everything has been sent.'}
            </EmptyBlock>
          ) : (
            <DviRows rows={shown} todayKey={todayKey} onOpen={r => void openById(r.id)} onFollow={r => setFollowing(r)} />
          )}
          {loadingOpen && <p role="status" className="mt-3 text-[0.9375rem] text-text-secondary">Opening…</p>}
        </>
      )}

      <Sheet open={sheet} onClose={() => { if (!starting) setSheet(false) }} title="New inspection">
        <StartSheet key={String(sheet) + (presetJob || '') + shopTemplates.length} jobs={jobs} customers={customers} techs={techs} presetJobId={presetJob} shopTemplates={shopTemplates} onManage={() => { manageBack.current = true; setSheet(false); setManage(true) }} busy={starting} error={startError} onStart={v => void start(v)} />
      </Sheet>

      <Sheet open={following !== null} onClose={() => setFollowing(null)} title="Follow up with the customer">
        {following && (
          <FollowUpSheet
            key={following.id}
            row={following}
            customers={customers}
            shop={shop}
            canRemember={followups}
            onClose={() => setFollowing(null)}
            onSent={remembered => {
              setFollowing(null)
              setNotice(remembered || !followups ? `Follow-up texted to ${following.customer_name || 'the customer'}.${followups ? '' : ' It is not remembered until the database update is applied, so it will keep showing here.'}` : `Follow-up texted to ${following.customer_name || 'the customer'}, but it could not be marked as followed up. Do not text again.`)
              void reload()
            }}
          />
        )}
      </Sheet>

      <Sheet open={manage} onClose={closeManage} title="Your checklists" wide>
        <TemplateManager api={templates} canEdit onClose={closeManage} />
      </Sheet>
    </div>
  )
}
