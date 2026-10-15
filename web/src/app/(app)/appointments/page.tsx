'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getShopId, supabase } from '@/lib/supabase'
import Sheet from '@/components/Sheet'
import Icon from '@/components/Icon'
import Segmented from '@/components/inbox/Segmented'
import Timeline from '@/components/schedule/Timeline'
import type { TimelineColumn } from '@/components/schedule/Timeline'
import ApptForm from '@/components/schedule/ApptForm'
import ApptDetail from '@/components/schedule/ApptDetail'
import ApptRows from '@/components/schedule/ApptRows'
import {
  addDays, byTime, dayLong, dayShort, fromMin, hhmm, isClosed, parseYmd, startOfWeek, weekRange, ymd,
} from '@/components/schedule/types'
import type { Appointment, ApptCustomer } from '@/components/schedule/types'

type View = 'day' | 'week' | 'list'
const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)

export default function SchedulePage() {
  // Date-dependent screens wait until the browser knows today's date, so the server and browser never disagree.
  const [today, setToday] = useState<Date | null>(null)
  const [desktop, setDesktop] = useState(false)
  const [view, setView] = useState<View>('day')
  const [picked, setPicked] = useState<Date | null>(null)

  const [appts, setAppts] = useState<Appointment[]>([])
  const [customers, setCustomers] = useState<ApptCustomer[]>([])
  const [techs, setTechs] = useState<string[]>(['Unassigned'])
  const [serviceIdeas, setServiceIdeas] = useState<string[]>([])
  const [shop, setShop] = useState({ name: '', phone: '' })
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState('')

  const [sheet, setSheet] = useState<null | 'form' | 'detail' | 'delete'>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<Appointment>>({})
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [textSent, setTextSent] = useState('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    const t = new Date()
    setToday(new Date(t.getFullYear(), t.getMonth(), t.getDate()))
    setPicked(new Date(t.getFullYear(), t.getMonth(), t.getDate()))
    const mq = window.matchMedia('(min-width: 1024px)')
    const apply = () => { setDesktop(mq.matches); if (mq.matches) setView(v => (v === 'day' ? 'week' : v)) }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  const load = useCallback(async () => {
    try {
      const shopId = await getShopId()
      if (!shopId) { setAppts([]); setLoadError('We could not find your shop. Refresh, or sign out and back in.'); return }
      const since = new Date(); since.setDate(since.getDate() - 120)
      const { data, error } = await supabase.from('appointments').select('*').eq('shop_id', shopId).gte('date', ymd(since)).order('date').order('time')
      if (error) throw error
      setAppts(((data || []) as Appointment[]).map(a => ({ ...a, time: hhmm(a.time) })))
      setLoadError('')
    } catch (e) {
      setLoadError(`The schedule did not load. ${errText(e, 'Check your connection and try again.')}`)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    fetch('/api/staff?role=technician').then(r => r.json()).then(d => {
      if (d?.ok && Array.isArray(d.staff)) setTechs(['Unassigned', ...d.staff.map((s: { name: string }) => s.name).filter(Boolean)])
    }).catch(() => { /* typing a tech name still works */ })
    getShopId().then(shopId => {
      if (!shopId) return
      supabase.from('customers').select('id,name,phone,vehicle_year,vehicle_make,vehicle_model').eq('shop_id', shopId).order('name').then(({ data }) => setCustomers((data || []) as ApptCustomer[]))
      supabase.from('canned_jobs').select('name').eq('shop_id', shopId).eq('active', true).order('name').limit(8).then(({ data }) => setServiceIdeas((data || []).map((r: { name: string }) => r.name)))
      supabase.from('settings').select('shop_name,shop_phone').eq('shop_id', shopId).maybeSingle().then(({ data }) => {
        if (data) setShop({ name: String(data.shop_name || ''), phone: String(data.shop_phone || '') })
      })
    }).catch(() => { /* the form still works without the customer list */ })
    const ch = supabase.channel('appts').on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => { void load() }).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  /* ---------- opening the booking form ---------- */
  const openNew = useCallback((date?: string, time?: string, tech?: string, customerId?: string) => {
    const base: Partial<Appointment> = { status: 'Scheduled', duration: 60, date: date || ymd(picked || new Date()), time: time || '09:00', tech: tech || 'Unassigned' }
    const c = customerId ? customers.find(x => x.id === customerId) : undefined
    if (c) Object.assign(base, { customer_id: c.id, customer_name: c.name, phone: c.phone || '', vehicle: [c.vehicle_year, c.vehicle_make, c.vehicle_model].filter(Boolean).join(' ') })
    setForm(base); setFormError(''); setOpenId(null); setSheet('form')
  }, [picked, customers])

  // Links from other screens: /appointments?new=1 and ?new=1&customer=<id>.
  const [linkDone, setLinkDone] = useState(false)
  useEffect(() => {
    if (linkDone || !today || loading) return
    const p = new URLSearchParams(window.location.search)
    if (p.get('new')) {
      const wanted = p.get('customer') || undefined
      if (wanted && customers.length === 0) return // wait for the customer list
      setLinkDone(true)
      openNew(undefined, undefined, undefined, wanted)
      window.history.replaceState(null, '', window.location.pathname)
    } else setLinkDone(true)
  }, [linkDone, today, loading, customers, openNew])

  const openAppt = (a: Appointment) => { setOpenId(a.id); setDetailError(''); setTextSent(''); setSheet('detail') }
  const closeSheet = () => { setSheet(null); setFormError(''); setDetailError('') }
  const current = appts.find(a => a.id === openId) || null

  /* ---------- saving ---------- */
  const save = async () => {
    if (!form.customer_name?.trim()) { setFormError('Add the customer’s name.'); return }
    if (!form.date) { setFormError('Choose a date.'); return }
    if (!form.time) { setFormError('Choose a start time.'); return }
    setSaving(true); setFormError('')
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('No shop is associated with the signed-in user')
      const data = { ...form, shop_id: shopId, updated_at: new Date().toISOString() }
      if (!openId) {
        const r = await supabase.from('appointments').insert({ ...data, status: data.status || 'Scheduled', created_at: new Date().toISOString() })
        if (r.error) throw new Error(r.error.message)
      } else {
        const r = await supabase.from('appointments').update(data).eq('id', openId).eq('shop_id', shopId)
        if (r.error) throw new Error(r.error.message)
      }
      const when = form.date ? parseYmd(form.date) : null
      if (when) setPicked(when)
      setSheet(null)
      setNotice(`${openId ? 'Saved' : 'Booked'}: ${form.customer_name} on ${when ? dayShort(when) : form.date}.`)
      await load()
    } catch (e) {
      setFormError(`Not saved. ${errText(e, 'Check your connection and try again.')}`)
    } finally { setSaving(false) }
  }

  const setStatus = async (status: string) => {
    if (!current) return
    setBusy(true); setDetailError('')
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('No shop is associated with the signed-in user')
      const r = await supabase.from('appointments').update({ status, updated_at: new Date().toISOString() }).eq('id', current.id).eq('shop_id', shopId)
      if (r.error) throw new Error(r.error.message)
      await load()
      if (status === 'Cancelled' || status === 'No Show') { setSheet(null); setNotice(`${current.customer_name} marked ${status === 'No Show' ? 'as a no show' : 'cancelled'}.`) }
    } catch (e) { setDetailError(`Status not changed. ${errText(e, 'Try again.')}`) }
    finally { setBusy(false) }
  }

  const sendText = async (body: string) => {
    if (!current) return
    setBusy(true); setDetailError(''); setTextSent('')
    try {
      const res = await fetch('/api/send-message', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: current.phone, body, channel: 'sms', ...(current.customer_id ? { customerId: current.customer_id } : {}) }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.error) throw new Error(d.error || 'The text did not send. Check your connection and try again.')
      setTextSent(`Text sent to ${current.customer_name}.`)
    } catch (e) { setDetailError(errText(e, 'The text did not send.')) }
    finally { setBusy(false) }
  }

  const del = async () => {
    if (!openId) return
    setBusy(true); setFormError('')
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('No shop is associated with the signed-in user')
      const r = await supabase.from('appointments').delete().eq('id', openId).eq('shop_id', shopId)
      if (r.error) throw new Error(r.error.message)
      setSheet(null); setOpenId(null)
      setNotice('Appointment deleted.')
      await load()
    } catch (e) { setFormError(`Not deleted. ${errText(e, 'Try again.')}`) }
    finally { setBusy(false) }
  }

  /* ---------- what to show ---------- */
  const todayKey = today ? ymd(today) : ''
  const pickedKey = picked ? ymd(picked) : ''
  const monday = picked ? startOfWeek(picked) : null
  const weekDays = monday ? Array.from({ length: 7 }, (_, i) => addDays(monday, i)) : []
  const byDate = useMemo(() => {
    const m = new Map<string, Appointment[]>()
    for (const a of appts) m.set(a.date, [...(m.get(a.date) || []), a])
    for (const [k, v] of m) m.set(k, v.sort(byTime))
    return m
  }, [appts])
  const dayItems = useMemo(() => byDate.get(pickedKey) || [], [byDate, pickedKey])
  const todayOpen = (byDate.get(todayKey) || []).filter(a => !isClosed(a.status)).length

  const step = (dir: number) => { if (!picked) return; setPicked(addDays(picked, view === 'week' ? dir * 7 : dir)) }

  const weekColumns: TimelineColumn[] = weekDays.map(d => ({
    key: ymd(d), date: ymd(d), label: d.toLocaleDateString('en-US', { weekday: 'short' }), sub: String(d.getDate()), isToday: ymd(d) === todayKey,
    items: byDate.get(ymd(d)) || [],
  }))
  const boardTechs = useMemo(() => {
    const names = new Set(techs.filter(t => t !== 'Unassigned'))
    dayItems.forEach(a => { if (a.tech && a.tech !== 'Unassigned') names.add(a.tech) })
    return [...names]
  }, [techs, dayItems])
  const unassignedItems = dayItems.filter(a => !a.tech || a.tech === 'Unassigned')
  const dayColumns: TimelineColumn[] = [
    ...boardTechs.map(t => ({ key: t, date: pickedKey, tech: t, label: t, sub: `${dayItems.filter(a => a.tech === t && !isClosed(a.status)).length} booked`, isToday: false, items: dayItems.filter(a => a.tech === t) })),
    ...(unassignedItems.length > 0 || boardTechs.length === 0 ? [{ key: 'Unassigned', date: pickedKey, tech: 'Unassigned', label: 'Unassigned', sub: `${unassignedItems.filter(a => !isClosed(a.status)).length} booked`, isToday: false, items: unassignedItems }] : []),
  ]

  const upcoming = useMemo(() => {
    const q = search.trim().toLowerCase()
    return appts
      .filter(a => a.date >= todayKey || !isClosed(a.status) && a.date >= todayKey)
      .filter(a => !q || [a.customer_name, a.service, a.vehicle, a.tech, a.phone].some(v => String(v || '').toLowerCase().includes(q)))
      .sort(byTime)
  }, [appts, todayKey, search])
  const past = useMemo(() => appts.filter(a => a.date < todayKey).sort((a, b) => byTime(b, a)).slice(0, 30), [appts, todayKey])
  const [showPast, setShowPast] = useState(false)

  const ready = !!today && !!picked
  // A failed load is not an empty schedule; never tell the owner nothing is booked when we could not look.
  const failedEmpty = !!loadError && appts.length === 0
  const subtitle = !ready || loading ? 'Loading…' : failedEmpty ? 'Could not load the schedule' : todayOpen === 0 ? 'Nothing left on the schedule today' : `${todayOpen} ${todayOpen === 1 ? 'appointment' : 'appointments'} left today`
  const dateHeading = view === 'week' && monday ? weekRange(monday) : picked ? dayLong(picked) : ''
  // Phones get a shorter day so it never gets cut off.
  const dateHeadingShort = view === 'week' && monday ? weekRange(monday) : picked ? dayShort(picked) : ''

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">Schedule</h1>
          <p className="page-subtitle num" aria-live="polite">{subtitle}</p>
        </div>
        <button type="button" className="btn btn-primary w-full sm:w-auto" onClick={() => openNew()} disabled={!ready}>
          <Icon name="plus" className="h-5 w-5" />New appointment
        </button>
      </header>

      {notice && (
        <div role="status" className="mb-4 flex items-center justify-between gap-3 rounded-md border border-green/40 bg-bg-card px-4 py-2.5 text-[0.9375rem]">
          <span className="flex min-w-0 items-center gap-2"><Icon name="check" className="h-5 w-5 shrink-0 text-green" /><span className="min-w-0 break-words">{notice}</span></span>
          <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => setNotice('')}>Dismiss</button>
        </div>
      )}

      {loadError && (
        <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-md border border-red/50 bg-red/[0.08] px-4 py-3 text-[0.9375rem]">
          <p className="text-red">{loadError}{appts.length > 0 ? ' What you see may be out of date.' : ''}</p>
          <button type="button" className="btn btn-secondary btn-sm shrink-0" onClick={() => { setLoadError(''); setLoading(true); void load() }}>Try again</button>
        </div>
      )}

      {!ready || (loading && appts.length === 0 && !loadError) ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading the schedule">
          <div className="skeleton h-12" />
          {[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-[4.25rem]" />)}
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setPicked(today)} disabled={pickedKey === todayKey && view !== 'week'}>Today</button>
            {view !== 'list' && (
              <>
                <button type="button" className="btn-icon" onClick={() => step(-1)} aria-label={view === 'week' ? 'Previous week' : 'Previous day'}><Icon name="chevronLeft" className="h-6 w-6" /></button>
                <button type="button" className="btn-icon" onClick={() => step(1)} aria-label={view === 'week' ? 'Next week' : 'Next day'}><Icon name="chevronRight" className="h-6 w-6" /></button>
                <h2 className="display min-w-0 flex-1 truncate text-[1.125rem] font-bold sm:text-[1.25rem]" aria-live="polite"><span className="sm:hidden">{dateHeadingShort}</span><span className="hidden sm:inline">{dateHeading}</span></h2>
              </>
            )}
            <Segmented
              className={view === 'list' ? 'ml-auto' : 'w-full sm:ml-auto sm:w-auto'}
              label="Schedule view"
              value={view}
              onChange={setView}
              options={[
                { value: 'day', label: 'Day' },
                ...(desktop ? [{ value: 'week' as View, label: 'Week' }] : []),
                { value: 'list', label: 'List' },
              ]}
            />
          </div>

          {view !== 'list' && !desktop && (
            <div className="mb-4 grid grid-cols-7 gap-1" role="group" aria-label="Days this week">
              {weekDays.map(d => {
                const k = ymd(d); const n = (byDate.get(k) || []).filter(a => !isClosed(a.status)).length
                const on = k === pickedKey
                return (
                  <button key={k} type="button" aria-pressed={on} aria-label={`${dayShort(d)}, ${n} ${n === 1 ? 'appointment' : 'appointments'}`} onClick={() => setPicked(d)}
                    className={`flex min-h-[64px] flex-col items-center justify-center rounded-md border px-0.5 py-1.5 ${on ? 'border-blue bg-blue/10 text-blue' : 'border-border bg-bg-card hover:bg-bg-hover'}`}>
                    <span className="text-[0.75rem] font-bold">{d.toLocaleDateString('en-US', { weekday: 'short' })}</span>
                    <span className={`display num text-[1.125rem] font-bold leading-tight ${k === todayKey && !on ? 'text-blue' : ''}`}>{d.getDate()}</span>
                    <span className="num h-4 text-[0.75rem] text-text-secondary">{n > 0 ? <><span className="lamp lamp-blue mr-1 !h-2 !w-2 align-middle" aria-hidden="true" />{n}</> : ''}</span>
                  </button>
                )
              })}
            </div>
          )}

          {view === 'week' && desktop && (
            <Timeline columns={weekColumns} onOpen={openAppt} onSlot={(date, mins) => openNew(date, fromMin(mins))} />
          )}

          {view === 'day' && desktop && (
            dayItems.length === 0 ? (
              <>
                {!failedEmpty && <EmptyDay label={dayLong(picked!)} onNew={() => openNew(pickedKey)} />}
                <div className="mt-4"><Timeline columns={dayColumns} onOpen={openAppt} onSlot={(date, mins, tech) => openNew(date, fromMin(mins), tech)} /></div>
              </>
            ) : (
              <Timeline columns={dayColumns} onOpen={openAppt} onSlot={(date, mins, tech) => openNew(date, fromMin(mins), tech)} />
            )
          )}

          {view === 'day' && !desktop && (
            dayItems.length === 0
              ? (failedEmpty ? null : <EmptyDay label={dayLong(picked!)} onNew={() => openNew(pickedKey)} />)
              : <ApptRows items={dayItems} onOpen={openAppt} />
          )}

          {view === 'list' && (
            <div>
              <div className="relative mb-4 max-w-xl">
                <label htmlFor="sched-search" className="sr-only">Search appointments</label>
                <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted" />
                <input id="sched-search" type="search" className="form-input pl-10" placeholder="Search by name, service, vehicle or tech" value={search} onChange={e => setSearch(e.target.value)} />
              </div>
              {upcoming.length === 0 ? (failedEmpty ? null : (
                <div className="empty-state">
                  <p className="font-bold text-text-primary">{search.trim() ? `No appointments match “${search.trim()}”` : 'Nothing is booked yet'}</p>
                  <p className="mx-auto mt-1 max-w-md">{search.trim() ? 'Check the spelling, or search by customer, service, vehicle or tech.' : 'Book a customer in and they show up here, on the grid, and on Today.'}</p>
                  <div className="mt-4 flex justify-center gap-2">
                    {search.trim() && <button type="button" className="btn btn-secondary" onClick={() => setSearch('')}>Clear search</button>}
                    <button type="button" className="btn btn-primary" onClick={() => openNew()}><Icon name="plus" className="h-5 w-5" />New appointment</button>
                  </div>
                </div>
              )) : (
                <div className="space-y-5">
                  {[...new Set(upcoming.map(a => a.date))].map(date => (
                    <section key={date} aria-label={dayLong(parseYmd(date))}>
                      <h3 className="section-title mb-1.5">{date === todayKey ? 'Today' : dayLong(parseYmd(date))}</h3>
                      <ApptRows items={upcoming.filter(a => a.date === date)} onOpen={openAppt} />
                    </section>
                  ))}
                </div>
              )}
              {past.length > 0 && (
                <div className="mt-6">
                  <button type="button" className="btn btn-ghost" aria-expanded={showPast} onClick={() => setShowPast(s => !s)}>
                    {showPast ? 'Hide' : 'Show'} past appointments
                    <Icon name="chevronDown" className={`h-4 w-4 transition-transform ${showPast ? 'rotate-180' : ''}`} />
                  </button>
                  {showPast && <div className="mt-2"><ApptRows items={past} onOpen={openAppt} showDate={a => dayShort(parseYmd(a.date))} /></div>}
                </div>
              )}
            </div>
          )}
        </>
      )}

      <Sheet open={sheet === 'form'} onClose={closeSheet} title={openId ? 'Edit appointment' : 'New appointment'} wide>
        <ApptForm
          key={`${openId || 'new'}-${sheet === 'form' ? 'open' : 'closed'}`}
          form={form}
          setForm={setForm}
          isNew={!openId}
          customers={customers}
          techs={techs}
          serviceIdeas={serviceIdeas}
          appts={appts}
          saving={saving || busy}
          error={formError}
          onSave={save}
          onCancel={closeSheet}
          onDelete={openId ? () => { setFormError(''); setSheet('delete') } : undefined}
        />
      </Sheet>

      <Sheet open={sheet === 'detail'} onClose={closeSheet} title={current ? current.customer_name : 'Appointment'}>
        {current && (
          <ApptDetail
            key={current.id}
            appt={current}
            shopName={shop.name}
            shopPhone={shop.phone}
            busy={busy}
            error={detailError}
            textSent={textSent}
            onStatus={setStatus}
            onEdit={() => { setForm({ ...current }); setFormError(''); setSheet('form') }}
            onCall={() => window.dispatchEvent(new CustomEvent('phone:call', { detail: { number: current.phone, name: current.customer_name } }))}
            onSendText={sendText}
            onClose={closeSheet}
          />
        )}
      </Sheet>

      <Sheet open={sheet === 'delete'} onClose={() => setSheet('form')} title="Delete this appointment?">
        <p className="text-[0.9375rem]">{current ? `${current.customer_name}, ${dayShort(parseYmd(current.date))}` : 'This appointment'} will be removed for good. If the customer just cannot come, mark it cancelled instead so you keep the record.</p>
        {formError && <p role="alert" className="form-error">{formError}</p>}
        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={() => setSheet('form')} disabled={busy}>Keep it</button>
          <button type="button" className="btn btn-danger" onClick={del} disabled={busy}>{busy ? 'Deleting…' : 'Delete appointment'}</button>
        </div>
      </Sheet>
    </div>
  )
}

function EmptyDay({ label, onNew }: { label: string; onNew: () => void }) {
  return (
    <div className="empty-state">
      <p className="font-bold text-text-primary">Nothing booked for {label}</p>
      <p className="mx-auto mt-1 max-w-md">Book a customer in for this day. They will show up here and on Today.</p>
      <button type="button" className="btn btn-primary mt-4" onClick={onNew}><Icon name="plus" className="h-5 w-5" />New appointment</button>
    </div>
  )
}
