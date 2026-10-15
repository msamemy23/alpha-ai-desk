'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import Sheet from '@/components/Sheet'
import { ErrorCard, FilterChips, SearchField } from '@/components/ListKit'
import { carLine, dueInfo, firstName, isDone, stageOf } from '@/components/jobs/types'
import { byUrgency } from '@/components/jobs/types'
import AssignSheet from '@/components/shopboard/AssignSheet'
import type { TechChoice } from '@/components/shopboard/AssignSheet'
import BoardCard from '@/components/shopboard/BoardCard'
import TechColumn from '@/components/shopboard/TechColumn'
import { BOARD_COLUMNS } from '@/components/shopboard/types'
import type { BoardJob } from '@/components/shopboard/types'
import { StatusLine } from '@/components/team/parts'
import { errText, useClock, useStaff } from '@/components/team/useTeam'
import { getShopId, supabase } from '@/lib/supabase'
import { groupByTech, isUnassigned, normName, techValue } from '@/lib/shopboard'
import { dayKey, dayRange, entriesFor, fmtDuration, fmtTimeOfDay, isTechnician, minutesOnDay, roleLabel, statusOf } from '@/lib/timeclock'
import type { ClockState, Person } from '@/lib/timeclock'

type View = 'active' | 'ready' | 'all'
type Note = { kind: 'success' | 'warn'; text: string; undo?: () => void } | null

/** Cars someone still has to work on. A finished car is waiting for its owner, not for a technician. */
const isWorkStage = (status: string) => ['new', 'approved', 'working', 'waiting'].includes(stageOf(status).key)

const UNASSIGNED_KEY = '__unassigned__'

/** The label used in messages: "Sam Ortiz's 2018 Honda Civic". */
function carLabel(j: BoardJob): string {
  const car = carLine(j)
  if (j.customer_name) return `${j.customer_name}'s ${car || 'car'}`
  return car || 'The car'
}

/** Shop board: every open car, sorted onto the technician who has it. Drag a car to give it to someone, or tap it. */
export default function ShopBoardPage() {
  const staff = useStaff()
  const [day, setDay] = useState('')
  const range = useMemo(() => (day ? dayRange(day, day) : null), [day])
  const clock = useClock(range)
  const now = clock.now
  const todayKey = now > 0 ? dayKey(new Date(now)) : ''
  // The date comes from the browser, so nothing that depends on it is drawn until the page has mounted.
  useEffect(() => { setDay(d => d || dayKey(new Date())) }, [])
  // Left open past midnight: move to the new day so "today" hours and "late" stay right.
  useEffect(() => { if (todayKey && day && todayKey !== day) setDay(todayKey) }, [todayKey, day])

  const [jobs, setJobs] = useState<BoardJob[]>([])
  const [jobsLoaded, setJobsLoaded] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [desktop, setDesktop] = useState(false)
  const [view, setView] = useState<View>('active')
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [sheetBusy, setSheetBusy] = useState(false)
  const [sheetError, setSheetError] = useState('')
  const [note, setNote] = useState<Note>(null)
  const [problem, setProblem] = useState('')
  const [dragId, setDragId] = useState<string | null>(null)
  const [overKey, setOverKey] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)

  const seq = useRef(0)
  /** Saves in flight. A refresh that lands while one is running would put the old name back for a moment, so it waits. */
  const writes = useRef(0)
  const saving = useRef(new Set<string>())

  const load = useCallback(async () => {
    const mine = ++seq.current
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('We could not find your shop. Refresh, or sign out and back in.')
      const { data, error } = await supabase
        .from('jobs')
        .select(BOARD_COLUMNS)
        .eq('shop_id', shopId)
        .not('status', 'in', '("Paid","Closed")')
        .order('created_at', { ascending: false })
        .limit(1000)
      if (error) throw error
      if (mine !== seq.current || writes.current > 0) return
      setJobs((data || []) as unknown as BoardJob[])
      setLoadError('')
    } catch (e) {
      if (mine !== seq.current) return
      setLoadError(errText(e, 'Check your connection and try again.'))
    } finally {
      if (mine === seq.current) setJobsLoaded(true)
    }
  }, [])

  useEffect(() => {
    void load()
    const poll = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 60_000)
    const back = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', back)
    window.addEventListener('focus', back)
    const channel = supabase.channel('shopboard_jobs').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => { void load() }).subscribe()
    return () => {
      clearInterval(poll)
      document.removeEventListener('visibilitychange', back)
      window.removeEventListener('focus', back)
      supabase.removeChannel(channel)
    }
  }, [load])

  // Dragging needs a mouse and room for the columns side by side. Everywhere else, tap a car and pick a name.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)')
    const apply = () => setDesktop(mq.matches)
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [])

  /* ---------- what is on the board ---------- */

  const ready = !!day && now > 0 && jobsLoaded
  const open = useMemo(() => jobs.filter(j => !isDone(j.status)), [jobs])
  const techPeople = useMemo(
    () => staff.people.filter(p => p.active && isTechnician(p.role)).sort((a, b) => a.name.localeCompare(b.name)),
    [staff.people],
  )
  const techNames = useMemo(() => techPeople.map(p => p.name), [techPeople])
  const clockOk = clock.ready
  const statusFor = useCallback((p: Person) => statusOf(clock.entries, p, now), [clock.entries, now])

  const counts = useMemo(() => ({
    active: open.filter(j => isWorkStage(j.status)).length,
    ready: open.filter(j => stageOf(j.status).key === 'ready').length,
    all: open.length,
  }), [open])

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase()
    return open
      .filter(j => (view === 'all' ? true : view === 'ready' ? stageOf(j.status).key === 'ready' : isWorkStage(j.status)))
      .filter(j => !q || [j.customer_name, j.ro_number, carLine(j), j.vehicle_plate, j.concern, j.tech].some(v => String(v || '').toLowerCase().includes(q)))
      .sort(byUrgency(todayKey))
  }, [open, view, search, todayKey])

  const grouped = useMemo(() => groupByTech(shown, techNames), [shown, techNames])
  const lateCount = useMemo(() => (todayKey ? open.filter(j => dueInfo(j, todayKey)?.tone === 'late').length : 0), [open, todayKey])

  /** Names that are clocked out right now, for the reminder after a car is given to one of them. */
  const outNames = useMemo(() => {
    const s = new Set<string>()
    if (clockOk) for (const p of techPeople) if (statusFor(p).state === 'out') s.add(normName(p.name))
    return s
  }, [techPeople, clockOk, statusFor])

  const inProgressFor = useCallback((name: string) => open.filter(j => stageOf(j.status).key === 'working' && normName(j.tech) === normName(name)).length, [open])

  /** What needs the owner's eye, from every open car, whatever the filter is showing. */
  const looks = useMemo(() => {
    if (!ready) return []
    const out: { key: string; text: string; href?: string; link?: string }[] = []
    const noTech = open.filter(j => isWorkStage(j.status) && isUnassigned(j.tech)).length
    if (noTech > 0) out.push({ key: 'notech', text: `${noTech} ${noTech === 1 ? 'car has' : 'cars have'} no technician yet.` })
    if (lateCount > 0) out.push({ key: 'late', text: `${lateCount} ${lateCount === 1 ? 'car is' : 'cars are'} late.` })
    if (clockOk) {
      for (const p of techPeople) {
        const s = statusFor(p)
        const working = inProgressFor(p.name)
        if (s.stale) out.push({ key: `stale-${p.id}`, text: `${p.name} is still clocked in from an earlier day.`, href: '/staff', link: 'Fix the time' })
        else if (s.state === 'out' && working > 0) out.push({ key: `out-${p.id}`, text: `${p.name} is clocked out but has ${working} ${working === 1 ? 'car' : 'cars'} in progress.` })
      }
    }
    return out
  }, [ready, open, lateCount, clockOk, techPeople, statusFor, inProgressFor])

  const techsIn = clockOk ? techPeople.filter(p => statusFor(p).state !== 'out').length : 0
  const subtitle = !ready || (staff.loading && staff.people.length === 0) ? 'Loading…'
    : loadError && jobs.length === 0 ? 'Could not load the board'
    : [
      clockOk && techPeople.length > 0 ? `${techsIn} of ${techPeople.length} ${techPeople.length === 1 ? 'technician' : 'technicians'} clocked in` : '',
      `${open.length} open ${open.length === 1 ? 'car' : 'cars'}`,
      lateCount > 0 ? `${lateCount} late` : '',
    ].filter(Boolean).join(' · ')

  /* ---------- giving a car to someone ---------- */

  /** Saves the technician on one car. Shows the change at once and puts it back if the save fails. Returns an error, or '' when saved. */
  const performAssign = useCallback(async (job: BoardJob, next: string): Promise<string> => {
    if (saving.current.has(job.id)) return 'The last change to this car is still saving. Try again in a moment.'
    const before = job.tech ?? ''
    saving.current.add(job.id)
    writes.current += 1
    setJobs(js => js.map(j => (j.id === job.id ? { ...j, tech: next } : j)))
    let err = ''
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('We could not find your shop. Refresh, or sign out and back in.')
      const { data, error } = await supabase
        .from('jobs')
        .update({ tech: next, updated_at: new Date().toISOString() })
        .eq('id', job.id)
        .eq('shop_id', shopId)
        .select('id')
      if (error) throw error
      if (!data || data.length === 0) err = 'That car could not be found. It may have been removed.'
    } catch (e) {
      err = errText(e, 'That did not save. Check your connection and try again.')
    }
    saving.current.delete(job.id)
    writes.current -= 1
    if (err) setJobs(js => js.map(j => (j.id === job.id ? { ...j, tech: before } : j)))
    void load()
    return err
  }, [load])

  const undoAssign = useCallback(async (job: BoardJob, back: string, was: string) => {
    setNote(null); setProblem('')
    const err = await performAssign({ ...job, tech: was }, back)
    if (err) { setProblem(err); return }
    setNote({ kind: 'success', text: `${carLabel(job)} is back with ${back || 'Unassigned'}.` })
  }, [performAssign])

  const assign = useCallback(async (job: BoardJob, name: string, from: 'sheet' | 'drag') => {
    const next = techValue(name)
    const was = isUnassigned(job.tech) ? '' : String(job.tech).trim()
    if (normName(next) === normName(was)) { if (from === 'sheet') setOpenId(null); return }
    setNote(null); setProblem(''); setSheetError('')
    if (from === 'sheet') setSheetBusy(true)
    const err = await performAssign(job, next)
    setSheetBusy(false)
    if (err) { if (from === 'sheet') setSheetError(err); else setProblem(err); return }
    if (from === 'sheet') setOpenId(null)
    const outNow = next !== '' && outNames.has(normName(next))
    setNote({
      kind: outNow ? 'warn' : 'success',
      text: next === ''
        ? `${carLabel(job)} is back in Unassigned.`
        : `${carLabel(job)} is now with ${next}.${outNow ? ` ${firstName(next)} is clocked out right now.` : ''}`,
      undo: () => void undoAssign(job, was, next),
    })
  }, [performAssign, outNames, undoAssign])

  /* ---------- clock buttons on a column ---------- */

  const clockPerson = useCallback(async (p: Person, action: 'clock_in' | 'clock_out' | 'start_break' | 'end_break') => {
    setBusyId(p.id); setProblem(''); setNote(null)
    const r = await clock.act({ action, staff_id: p.id })
    setBusyId(null)
    if (!r.ok) { setProblem(`${p.name}: ${r.error}`); return }
    const at = fmtTimeOfDay(String(r.entry?.clock_out || r.entry?.clock_in || new Date().toISOString()))
    const text = action === 'clock_in' ? `${p.name} clocked in at ${at}.`
      : action === 'clock_out' ? `${p.name} clocked out at ${at}.`
      : action === 'start_break' ? `${p.name} is on a break.`
      : `${p.name} is back from break.`
    setNote({ kind: 'success', text })
  }, [clock])

  /* ---------- dragging ---------- */

  const dropOn = (key: string, name: string) => ({
    over: overKey === key && !!dragId,
    onDragOver: (e: React.DragEvent) => {
      if (!dragId) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (overKey !== key) setOverKey(key)
    },
    onDragLeave: (e: React.DragEvent) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOverKey(k => (k === key ? null : k))
    },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      const id = e.dataTransfer.getData('text/plain') || dragId
      setOverKey(null); setDragId(null)
      const job = jobs.find(j => j.id === id)
      if (job) void assign(job, name, 'drag')
    },
  })

  const card = (j: BoardJob) => (
    <BoardCard
      key={j.id}
      job={j}
      todayKey={todayKey}
      draggable={desktop}
      dragging={dragId === j.id}
      onOpen={x => { setSheetError(''); setOpenId(x.id) }}
      onDragStart={x => setDragId(x.id)}
      onDragEnd={() => { setDragId(null); setOverKey(null) }}
    />
  )

  const openJob = jobs.find(j => j.id === openId) || null
  const choices: TechChoice[] = techPeople.map(p => ({ name: p.name, state: clockOk ? (statusFor(p).state as ClockState) : null }))

  const teamMissing = staff.error && staff.people.length === 0
  const loading = !ready || (staff.loading && staff.people.length === 0)
  const searching = search.trim() !== ''

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">Shop board</h1>
          <p className="page-subtitle num" aria-live="polite">{subtitle}</p>
        </div>
        <Link href="/jobs?new=1" className="btn btn-primary w-full no-underline sm:w-auto">
          <Icon name="plus" className="h-5 w-5" />Write up a car
        </Link>
      </header>

      {note && (
        <Notice kind={note.kind} className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="min-w-0 flex-1 basis-56 break-words">{note.text}</span>
            <span className="ml-auto flex shrink-0 gap-1">
              {note.undo && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { const u = note.undo; setNote(null); u?.() }}>Undo</button>}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNote(null)}>Dismiss</button>
            </span>
          </div>
        </Notice>
      )}
      {problem && (
        <Notice kind="error" className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="min-w-0 flex-1 basis-56 break-words">{problem}</span>
            <button type="button" className="btn btn-ghost btn-sm ml-auto shrink-0" onClick={() => setProblem('')}>Dismiss</button>
          </div>
        </Notice>
      )}

      {loadError && jobs.length === 0 && jobsLoaded ? (
        <ErrorCard title="The board did not load" message={loadError} onRetry={() => { setJobsLoaded(false); void load() }} />
      ) : loading ? (
        <div aria-busy="true" aria-label="Loading the board">
          <div className="skeleton mb-4 h-11 w-full sm:max-w-sm" />
          <div className="grid gap-3 md:grid-cols-2 lg:flex">
            {[0, 1, 2].map(i => <div key={i} className="skeleton h-72 lg:w-[16.5rem] lg:shrink-0" />)}
          </div>
        </div>
      ) : open.length === 0 ? (
        <div className="empty-state">
          <Icon name="board" className="mx-auto mb-3 h-8 w-8 text-text-muted" />
          <p className="font-bold text-text-primary">No cars in the shop right now</p>
          <p className="mx-auto mt-1 max-w-md">Write up a car and it shows here, ready to hand to a technician.</p>
          <Link href="/jobs?new=1" className="btn btn-primary mt-4 no-underline"><Icon name="plus" className="h-5 w-5" />Write up a car</Link>
        </div>
      ) : (
        <>
          {loadError && <p role="alert" className="mb-3 text-[0.9375rem] text-red">The board could not refresh. What you see may be out of date. <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>Try again</button></p>}
          {teamMissing && (
            <Notice kind="warn" className="mb-4">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0">The team list did not load, so technician columns are missing for now.</span>
                <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => void staff.reload()}>Try again</button>
              </div>
            </Notice>
          )}
          {!teamMissing && techPeople.length === 0 && (
            <Notice kind="info" className="mb-4">
              No technicians on your team yet. <Link href="/staff">Add them on the Team screen</Link> and each one gets a column here.
            </Notice>
          )}
          {clock.error && !clock.ready && techPeople.length > 0 && (
            <p role="alert" className="mb-3 text-[0.9375rem] text-red">The time clock did not load, so clock-in status is hidden. <button type="button" className="btn btn-ghost btn-sm" onClick={() => void clock.reload()}>Try again</button></p>
          )}

          {looks.length > 0 ? (
            <Notice kind="warn" className="mb-4">
              <p className="font-bold">Needs a look</p>
              <ul className="mt-0.5 space-y-0.5">
                {looks.map(l => (
                  <li key={l.key}>{l.text}{l.href && <> <Link href={l.href}>{l.link}</Link></>}</li>
                ))}
              </ul>
            </Notice>
          ) : (
            counts.active > 0 && (
              <p className="mb-4 flex items-center gap-2 text-[0.9375rem] text-text-secondary">
                <span className="lamp lamp-green" aria-hidden="true" />Every active car has a technician and nothing is late.
              </p>
            )
          )}

          <div className="mb-4 grid gap-3 sm:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] sm:items-center">
            <SearchField value={search} onChange={setSearch} label="Search cars" placeholder="Customer, car, plate, or repair order" />
            <FilterChips
              label="Which cars to show"
              scroll
              value={view}
              onChange={setView}
              options={[
                { key: 'active', label: 'Active work', count: counts.active },
                { key: 'ready', label: 'Ready for pickup', count: counts.ready },
                { key: 'all', label: 'All open', count: counts.all },
              ]}
            />
          </div>

          {searching && shown.length === 0 && (
            <p className="mb-3 text-[0.9375rem] text-text-secondary">
              No cars match “{search.trim()}”. <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSearch('')}>Clear search</button>
            </p>
          )}

          <div className="grid gap-3 md:grid-cols-2 lg:flex lg:items-start lg:overflow-x-auto lg:pb-3" role="region" aria-label="Technician columns" tabIndex={0}>
            <TechColumn
              name="Unassigned"
              sub="Nobody has these yet"
              avatar={false}
              count={grouped.unassigned.length}
              empty={searching ? 'No match.' : 'Every car has someone on it.'}
              {...(desktop ? dropOn(UNASSIGNED_KEY, '') : { over: false })}
            >
              {grouped.unassigned.map(card)}
            </TechColumn>

            {techPeople.map(p => {
              const list = grouped.byTech.get(p.name) || []
              const s = statusFor(p)
              const waiting = busyId === p.id
              const working = inProgressFor(p.name)
              const flag = !clockOk ? undefined
                : s.stale ? 'Still clocked in from an earlier day'
                : s.state === 'out' && working > 0 ? `Clocked out with ${working} ${working === 1 ? 'car' : 'cars'} in progress`
                : undefined
              return (
                <TechColumn
                  key={p.id}
                  name={p.name}
                  sub={roleLabel(p.role)}
                  count={list.length}
                  empty={searching ? 'No match.' : view === 'ready' ? 'Nothing ready for pickup.' : 'No cars right now.'}
                  flag={flag}
                  status={clockOk ? (
                    <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                      <StatusLine status={s} todayKey={todayKey} className="min-w-0" />
                      <span className="num shrink-0">{fmtDuration(minutesOnDay(entriesFor(clock.entries, p), todayKey, now))} today</span>
                    </span>
                  ) : clock.error ? undefined : <span className="skeleton block h-4 w-40" aria-label="Loading the clock" />}
                  actions={clockOk ? (
                    s.overlong ? (
                      <Link href="/staff" className="btn btn-secondary flex-1 no-underline" aria-label={`Fix the time for ${p.name}`}><Icon name="edit" className="h-5 w-5" />Fix time</Link>
                    ) : s.state === 'out' ? (
                      <button type="button" className="btn btn-secondary flex-1" disabled={waiting} onClick={() => void clockPerson(p, 'clock_in')} aria-label={`Clock in ${p.name}`}>
                        <Icon name="clock" className="h-5 w-5" />{waiting ? 'Saving…' : 'Clock in'}
                      </button>
                    ) : (
                      <>
                        {s.state === 'break' ? (
                          <button type="button" className="btn btn-secondary flex-1" disabled={waiting} onClick={() => void clockPerson(p, 'end_break')} aria-label={`End the break for ${p.name}`}>
                            <Icon name="play" className="h-5 w-5" />End break
                          </button>
                        ) : clock.breaks && (
                          <button type="button" className="btn btn-secondary flex-1" disabled={waiting} onClick={() => void clockPerson(p, 'start_break')} aria-label={`Start a break for ${p.name}`}>
                            <Icon name="pause" className="h-5 w-5" />Break
                          </button>
                        )}
                        <button type="button" className="btn btn-secondary flex-1" disabled={waiting} onClick={() => void clockPerson(p, 'clock_out')} aria-label={`Clock out ${p.name}`}>
                          {waiting ? 'Saving…' : 'Clock out'}
                        </button>
                      </>
                    )
                  ) : undefined}
                  {...(desktop ? dropOn(`tech:${p.id}`, p.name) : { over: false })}
                >
                  {list.map(card)}
                </TechColumn>
              )
            })}

            {grouped.others.map(o => {
              const gone = staff.people.some(p => !p.active && normName(p.name) === normName(o.name))
              return (
                <TechColumn
                  key={`other:${normName(o.name)}`}
                  name={o.name}
                  sub={teamMissing ? 'Team list did not load' : gone ? 'No longer on the team' : 'Not on your team list'}
                  count={o.jobs.length}
                  empty="No cars."
                  over={false}
                >
                  {o.jobs.map(card)}
                </TechColumn>
              )
            })}
          </div>
          {desktop && (
            <p className="mt-2 text-[0.8125rem] text-text-secondary">Drag a car onto a technician to give it to them, or click a car to choose.</p>
          )}
        </>
      )}

      <Sheet open={!!openJob} onClose={() => { if (!sheetBusy) setOpenId(null) }} title="Give this car to a technician">
        {openJob && (
          <AssignSheet
            job={openJob}
            techs={choices}
            todayKey={todayKey}
            busy={sheetBusy}
            error={sheetError}
            onAssign={name => void assign(openJob, name, 'sheet')}
          />
        )}
      </Sheet>
    </div>
  )
}
