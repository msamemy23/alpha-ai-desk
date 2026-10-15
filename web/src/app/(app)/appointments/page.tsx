'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getShopId, supabase } from '@/lib/supabase'
import Sheet from '@/components/Sheet'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import Segmented from '@/components/inbox/Segmented'
import Timeline from '@/components/schedule/Timeline'
import type { TimelineColumn } from '@/components/schedule/Timeline'
import ApptForm from '@/components/schedule/ApptForm'
import ApptDetail from '@/components/schedule/ApptDetail'
import ApptRows from '@/components/schedule/ApptRows'
import CapacityBar from '@/components/schedule/CapacityBar'
import LateStrip from '@/components/schedule/LateStrip'
import MonthGrid from '@/components/schedule/MonthGrid'
import RemindersSheet from '@/components/schedule/RemindersSheet'
import RequestsPanel from '@/components/schedule/RequestsPanel'
import SettingsSheet from '@/components/schedule/SettingsSheet'
import type { TextStart } from '@/components/schedule/ApptDetail'
import { useScheduleSettings } from '@/components/schedule/useScheduleSettings'
import { addDaysYmd, isOverdueArrival, missRate, nowIn } from '@/lib/schedule-capacity'
import { alternativeTimes } from '@/lib/schedule-texts'
import { missingSchema } from '@/lib/schema-missing'
import {
  addDays, byTime, dayLong, dayShort, fromMin, hhmm, isClosed, parseYmd, startOfWeek, weekRange, ymd,
} from '@/components/schedule/types'
import type { Appointment } from '@/components/schedule/types'
import { phoneTail, plainError, textProblem } from '@/components/appointments/errors'
import { useLookups } from '@/components/appointments/useLookups'

type View = 'day' | 'week' | 'month' | 'list'
const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k-${Date.now()}-${Math.random().toString(36).slice(2)}`)

export default function SchedulePage() {
  // Date-dependent screens wait until the browser knows today's date, so the server and browser never disagree.
  const [today, setToday] = useState<Date | null>(null)
  const [desktop, setDesktop] = useState(false)
  const [view, setView] = useState<View>('day')
  const [picked, setPicked] = useState<Date | null>(null)

  const [appts, setAppts] = useState<Appointment[]>([])
  const { customers, customersError, reloadCustomers, serviceIdeas, canned, shop, isStopped } = useLookups()
  const sched = useScheduleSettings()
  const cap = sched.settings.capacity
  const [clock, setClock] = useState(0)
  // Does this database have the drop-off or wait and bay columns yet (migration 050)? null until the first look.
  const [hasKind, setHasKind] = useState<boolean | null>(null)
  const [techs, setTechs] = useState<string[]>(['Unassigned'])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [notice, setNotice] = useState('')

  const [sheet, setSheet] = useState<null | 'form' | 'detail' | 'delete' | 'settings' | 'reminders'>(null)
  const [textStart, setTextStart] = useState<TextStart | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [month, setMonth] = useState<Date | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [form, setForm] = useState<Partial<Appointment>>({})
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [busy, setBusy] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [textSent, setTextSent] = useState('')
  const [search, setSearch] = useState('')
  // A second tap or Enter before the screen has redrawn must not save, change or send twice.
  const working = useRef(false)
  const attempt = useRef<{ sig: string; key: string } | null>(null)
  const lastSent = useRef<{ sig: string; at: number } | null>(null)

  useEffect(() => {
    const t = new Date()
    setToday(new Date(t.getFullYear(), t.getMonth(), t.getDate()))
    setPicked(new Date(t.getFullYear(), t.getMonth(), t.getDate()))
    setMonth(new Date(t.getFullYear(), t.getMonth(), 1))
    const mq = window.matchMedia('(min-width: 1024px)')
    const apply = () => { setDesktop(mq.matches); if (mq.matches) setView(v => (v === 'day' ? 'week' : v)) }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  // The late-arrival flag and the "that time has passed" warning follow the clock.
  useEffect(() => {
    const id = window.setInterval(() => setClock(c => c + 1), 60_000)
    return () => window.clearInterval(id)
  }, [])

  // A schedule left open on a shop screen overnight moves to the new day by itself.
  useEffect(() => {
    if (!today) return
    const next = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
    const id = window.setTimeout(() => {
      const t = new Date()
      const fresh = new Date(t.getFullYear(), t.getMonth(), t.getDate())
      setPicked(p => (p && ymd(p) === ymd(today) ? fresh : p))
      setToday(fresh)
    }, Math.max(1000, next.getTime() - Date.now() + 500))
    return () => window.clearTimeout(id)
  }, [today])

  const load = useCallback(async () => {
    try {
      const shopId = await getShopId()
      if (!shopId) { setAppts([]); setLoadError('We could not find your shop. Refresh, or sign out and back in.'); return }
      const since = new Date(); since.setDate(since.getDate() - 120)
      const { data, error } = await supabase.from('appointments').select('*').eq('shop_id', shopId).gte('date', ymd(since)).order('date').order('time')
      if (error) throw error
      const rows = (data || []) as Appointment[]
      setAppts(rows.map(a => ({ ...a, time: hhmm(a.time) })))
      if (rows.length > 0) setHasKind('kind' in rows[0])
      else {
        const probe = await supabase.from('appointments').select('kind').eq('shop_id', shopId).limit(1)
        setHasKind(!probe.error)
      }
      setLoadError('')
    } catch (e) {
      setLoadError(`The schedule did not load. ${plainError(e, 'Check your connection and try again.')}`)
    } finally { setLoading(false) }
  }, [])

  useEffect(() => {
    load()
    fetch('/api/staff?role=technician').then(r => r.json()).then(d => {
      if (d?.ok && Array.isArray(d.staff)) setTechs(['Unassigned', ...d.staff.map((s: { name: string }) => s.name).filter(Boolean)])
    }).catch(() => { /* typing a tech name still works */ })
    const ch = supabase.channel('appts').on('postgres_changes', { event: '*', schema: 'public', table: 'appointments' }, () => { void load() }).subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [load])

  /* ---------- opening the booking form ---------- */
  const openNew = useCallback((date?: string, time?: string, tech?: string, customerId?: string) => {
    const base: Partial<Appointment> = { status: 'Scheduled', duration: 60, date: date || ymd(picked || new Date()), time: time || '09:00', tech: tech || 'Unassigned', ...(hasKind ? { kind: null, bay: null } : {}) }
    const c = customerId ? customers.find(x => x.id === customerId) : undefined
    if (c) Object.assign(base, { customer_id: c.id, customer_name: c.name, phone: c.phone || '', vehicle: [c.vehicle_year, c.vehicle_make, c.vehicle_model].filter(Boolean).join(' ') })
    setForm(base); setFormError(''); setOpenId(null); setSheet('form')
  }, [picked, customers, hasKind])

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

  const openAppt = (a: Appointment) => { setOpenId(a.id); setDetailError(''); setTextSent(''); setTextStart(null); setSheet('detail') }
  const closeSheet = () => { setSheet(null); setFormError(''); setDetailError(''); setTextStart(null) }
  const current = appts.find(a => a.id === openId) || null

  /* ---------- saving ---------- */
  const save = async () => {
    if (!form.customer_name?.trim()) { setFormError('Add the customer’s name.'); return }
    if (!form.date) { setFormError('Choose a date.'); return }
    if (!form.time) { setFormError('Choose a start time.'); return }
    if (working.current) return
    working.current = true
    setSaving(true); setFormError('')
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('No shop is associated with the signed-in user')
      const data: Record<string, unknown> = { ...form, shop_id: shopId, updated_at: new Date().toISOString() }
      // A new day needs a new reminder, so the one already sent for the old day is cleared.
      if (openId && current && current.date !== form.date) data.reminder_sent_at = null
      // Until the database has the drop-off and bay columns, they are left out so saving still works.
      const withoutExtras = (d: Record<string, unknown>) => { const { kind: _k, bay: _b, source: _s, ...rest } = d; void _k; void _b; void _s; return rest }
      const write = (d: Record<string, unknown>) => (!openId
        ? supabase.from('appointments').insert({ ...d, status: d.status || 'Scheduled', created_at: new Date().toISOString() })
        : supabase.from('appointments').update(d).eq('id', openId).eq('shop_id', shopId))
      let r = await write(hasKind === false ? withoutExtras(data) : data)
      if (r.error && hasKind !== false && missingSchema(r.error)) { setHasKind(false); r = await write(withoutExtras(data)) }
      if (r.error) throw new Error(r.error.message)
      const when = form.date ? parseYmd(form.date) : null
      if (when) setPicked(when)
      setSheet(null)
      setNotice(`${openId ? 'Saved' : 'Booked'}: ${form.customer_name} on ${when ? dayShort(when) : form.date}.`)
      await load()
    } catch (e) {
      setFormError(`Not saved. ${plainError(e, 'Check your connection and try again.')}`)
    } finally { working.current = false; setSaving(false) }
  }

  const setStatus = async (status: string) => {
    if (!current || working.current) return
    working.current = true
    setBusy(true); setDetailError('')
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('No shop is associated with the signed-in user')
      const r = await supabase.from('appointments').update({ status, updated_at: new Date().toISOString() }).eq('id', current.id).eq('shop_id', shopId)
      if (r.error) throw new Error(r.error.message)
      await load()
      if (status === 'Cancelled' || status === 'No Show') { setSheet(null); setNotice(`${current.customer_name} marked ${status === 'No Show' ? 'as a no show' : 'cancelled'}.`) }
    } catch (e) { setDetailError(`Status not changed. ${plainError(e, 'Try again.')}`) }
    finally { working.current = false; setBusy(false) }
  }

  /* ---------- requests, late cars and no-shows ---------- */
  const [actionError, setActionError] = useState('')
  const nowShop = useMemo(() => nowIn(sched.settings.timezone), [sched.settings.timezone, clock]) // eslint-disable-line react-hooks/exhaustive-deps
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const bookUrl = sched.settings.online.enabled && sched.settings.online.slug ? `${origin}/book/${sched.settings.online.slug}` : null

  /** Changes one booking's status. `only` makes it conditional, so an answer someone else already gave is never overwritten. */
  const changeStatus = async (a: Appointment, status: string, only?: string): Promise<boolean> => {
    if (working.current) return false
    working.current = true
    setBusyId(a.id); setActionError('')
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('No shop is associated with the signed-in user')
      let q = supabase.from('appointments').update({ status, updated_at: new Date().toISOString() }).eq('id', a.id).eq('shop_id', shopId)
      if (only) q = q.eq('status', only)
      const { data, error } = await q.select('id')
      if (error) throw new Error(error.message)
      await load()
      if (!data || data.length === 0) { setNotice(`${a.customer_name} was already answered by someone else.`); return false }
      return true
    } catch (e) {
      setActionError(`Not changed. ${plainError(e, 'Check your connection and try again.')}`)
      return false
    } finally { working.current = false; setBusyId(null) }
  }

  const askToText = (a: Appointment, start: TextStart) => { setOpenId(a.id); setDetailError(''); setTextSent(''); setTextStart(start); setSheet('detail') }

  const acceptRequest = async (a: Appointment) => {
    if (await changeStatus(a, 'Scheduled', 'Requested')) { setNotice(`${a.customer_name} is booked. Text them to confirm.`); if (a.phone) askToText(a, 'accept') }
  }
  const declineRequest = async (a: Appointment) => {
    if (await changeStatus(a, 'Declined', 'Requested')) { setNotice(`Request from ${a.customer_name} declined. They have not been told yet.`); if (a.phone) askToText(a, 'decline') }
  }
  const markNoShow = async (a: Appointment) => {
    if (await changeStatus(a, 'No Show')) { setNotice(`${a.customer_name} marked as a no show.`); if (a.phone) askToText(a, 'noshow') }
  }

  const requests = useMemo(() => appts.filter(a => a.status === 'Requested').sort(byTime).slice(0, 20), [appts])
  const late = useMemo(
    () => appts.filter(a => a.date >= addDaysYmd(nowShop.ymd, -3) && isOverdueArrival(a, nowShop, cap.noShowGraceMinutes)).sort(byTime),
    [appts, nowShop, cap.noShowGraceMinutes],
  )
  const alternatives = useMemo(() => {
    if (!current) return []
    return alternativeTimes(cap, appts.filter(x => x.id !== current.id), { date: current.date, minutes: Number(current.duration) || 60, kind: current.kind || 'dropoff', now: nowShop, leadMinutes: 60, step: sched.settings.online.stepMinutes }).map(x => x.words)
  }, [current, appts, cap, nowShop, sched.settings.online.stepMinutes])
  const missed = useMemo(() => (current && phoneTail(current.phone) ? missRate(appts.filter(x => x.id !== current.id && phoneTail(x.phone) === phoneTail(current.phone))) : undefined), [current, appts])

  const sendText = async (raw: string) => {
    if (!current || working.current) return
    const body = raw.trim()
    if (!body) return
    setDetailError(''); setTextSent('')
    if (isStopped(current)) { setDetailError(textProblem(409, 'This destination has opted out of SMS')); return }
    const sig = `${current.id}|${current.phone}|${body}`
    if (lastSent.current && lastSent.current.sig === sig && Date.now() - lastSent.current.at < 10 * 60_000) {
      setDetailError(`This exact text already went to ${current.customer_name}. Change the words if you want to send another.`)
      return
    }
    working.current = true
    setBusy(true)
    // The same words to the same number reuse one key, so a retry after a dropped connection cannot send two.
    const key = attempt.current && attempt.current.sig === sig ? attempt.current.key : newKey()
    attempt.current = { sig, key }
    try {
      const res = await fetch('/api/send-message', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify({ to: current.phone, body, channel: 'sms', ...(current.customer_id ? { customerId: current.customer_id } : {}) }),
      })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.error || d.ok === false) { setDetailError(textProblem(res.status, typeof d.error === 'string' ? d.error : '')); return }
      attempt.current = null
      lastSent.current = { sig, at: Date.now() }
      setTextSent(`Text sent to ${current.customer_name}.`)
    } catch { setDetailError(textProblem(0, '')) }
    finally { working.current = false; setBusy(false) }
  }

  const del = async () => {
    if (!openId || working.current) return
    working.current = true
    setBusy(true); setFormError('')
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('No shop is associated with the signed-in user')
      const r = await supabase.from('appointments').delete().eq('id', openId).eq('shop_id', shopId)
      if (r.error) throw new Error(r.error.message)
      setSheet(null); setOpenId(null)
      setNotice('Appointment deleted.')
      await load()
    } catch (e) { setFormError(`Not deleted. ${plainError(e, 'Try again.')}`) }
    finally { working.current = false; setBusy(false) }
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
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <button type="button" className="btn btn-primary min-w-0 flex-1 sm:flex-none" onClick={() => openNew()} disabled={!ready}>
            <Icon name="plus" className="h-5 w-5" />New appointment
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => { setActionError(''); setSheet('reminders') }} disabled={!ready || loading}>
            <Icon name="bell" className="h-5 w-5" />Reminders
          </button>
          <button type="button" className="btn btn-secondary btn-icon" onClick={() => { setActionError(''); setSheet('settings') }} aria-label="Scheduling settings">
            <Icon name="settings" className="h-5 w-5" />
          </button>
        </div>
      </header>

      {notice && (
        <div role="status" className="mb-4 flex items-center justify-between gap-3 rounded-md border border-green/40 bg-bg-card px-4 py-2.5 text-[0.9375rem]">
          <span className="flex min-w-0 items-center gap-2"><Icon name="check" className="h-5 w-5 shrink-0 text-green" /><span className="min-w-0 break-words">{notice}</span></span>
          <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => setNotice('')}>Dismiss</button>
        </div>
      )}

      {actionError && (
        <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-md border border-red/50 bg-red/[0.08] px-4 py-3 text-[0.9375rem]">
          <p className="min-w-0 break-words text-red">{actionError}</p>
          <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => setActionError('')}>Dismiss</button>
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
          <RequestsPanel
            requests={requests}
            all={appts}
            cap={cap}
            now={nowShop}
            busyId={busyId}
            onAccept={a => void acceptRequest(a)}
            onDecline={a => void declineRequest(a)}
            onSuggest={a => askToText(a, 'suggest')}
            onOpen={openAppt}
          />
          <LateStrip
            items={late}
            todayKey={nowShop.ymd}
            graceMinutes={cap.noShowGraceMinutes}
            busyId={busyId}
            onText={a => askToText(a, 'late')}
            onNoShow={a => void markNoShow(a)}
            onOpen={openAppt}
          />
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => { setPicked(today); if (view === 'month' && today) setMonth(new Date(today.getFullYear(), today.getMonth(), 1)) }} disabled={pickedKey === todayKey && view !== 'week' && view !== 'month'}>Today</button>
            {view !== 'list' && view !== 'month' && (
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
              onChange={v => { setView(v); if (v === 'month' && picked) setMonth(new Date(picked.getFullYear(), picked.getMonth(), 1)) }}
              options={[
                { value: 'day', label: 'Day' },
                ...(desktop ? [{ value: 'week' as View, label: 'Week' }] : []),
                { value: 'month', label: 'Month' },
                { value: 'list', label: 'List' },
              ]}
            />
          </div>

          {view === 'month' && month && (
            <MonthGrid
              month={month}
              todayKey={todayKey}
              pickedKey={pickedKey}
              cap={cap}
              appts={appts}
              onPick={d => { setPicked(d); setView('day') }}
              onMonth={dir => setMonth(m => (m ? new Date(m.getFullYear(), m.getMonth() + dir, 1) : m))}
            />
          )}

          {view === 'day' && !failedEmpty && <CapacityBar cap={cap} appts={appts} ymd={pickedKey} onSettings={sched.settings.canChange && sched.settings.migrated ? () => setSheet('settings') : undefined} />}

          {view !== 'list' && view !== 'month' && !desktop && (
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
        {customersError && (
          <Notice kind="warn" className="mb-4">
            <p className="font-bold">{customersError}</p>
            <p className="mt-0.5">Searching will not find anyone. You can still type a name to book a walk-in.</p>
            <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => void reloadCustomers()}>Try again</button>
          </Notice>
        )}
        <ApptForm
          key={`${openId || 'new'}-${sheet === 'form' ? 'open' : 'closed'}`}
          form={form}
          setForm={setForm}
          isNew={!openId}
          customers={customers}
          techs={techs}
          serviceIdeas={serviceIdeas}
          canned={canned}
          cap={cap}
          now={nowShop}
          hasKind={hasKind === true}
          appts={appts}
          saving={saving || busy}
          error={formError}
          onSave={save}
          onCancel={closeSheet}
          onDelete={openId ? () => { setFormError(''); setSheet('delete') } : undefined}
        />
      </Sheet>

      <Sheet open={sheet === 'detail'} onClose={closeSheet} title={current ? current.customer_name : 'Appointment'}>
        {current && isStopped(current) && (
          <Notice kind="warn" className="mb-3">
            <p className="font-bold">{current.customer_name} replied STOP.</p>
            <p className="mt-0.5">Alpha cannot text them, and reminders skip them. Call them to confirm the visit.</p>
          </Notice>
        )}
        {current && (
          <ApptDetail
            key={`${current.id}-${textStart || 'none'}`}
            appt={current}
            shopName={shop.name}
            shopPhone={shop.phone}
            todayYmd={nowShop.ymd}
            bookUrl={bookUrl}
            alternatives={alternatives}
            startWith={textStart}
            missed={missed}
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

      <Sheet open={sheet === 'settings'} onClose={closeSheet} title="Scheduling settings" wide>
        {sheet === 'settings' && (
          !sched.loaded ? (
            <div className="space-y-2" aria-busy="true" aria-label="Loading the settings"><div className="skeleton h-10" /><div className="skeleton h-40" /></div>
          ) : sched.error ? (
            <div>
              <Notice kind="error">{sched.error}</Notice>
              <button type="button" className="btn btn-secondary mt-4" onClick={() => void sched.reload()}>Try again</button>
            </div>
          ) : (
            <SettingsSheet settings={sched.settings} save={sched.save} onSaved={m => { setNotice(m); setSheet(null) }} onClose={closeSheet} />
          )
        )}
      </Sheet>

      <Sheet open={sheet === 'reminders'} onClose={closeSheet} title="Send reminders" wide>
        {sheet === 'reminders' && (
          <RemindersSheet appts={appts} cap={cap} timezone={sched.settings.timezone} shop={shop} isStopped={isStopped} onDone={() => { void load() }} onClose={closeSheet} />
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
