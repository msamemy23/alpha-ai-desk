'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { EmptyBlock, ErrorCard } from '@/components/ListKit'
import { byUrgency, dueInfo, stageOf } from '@/components/jobs/types'
import BoardCard from '@/components/shopboard/BoardCard'
import { BOARD_COLUMNS } from '@/components/shopboard/types'
import type { BoardJob } from '@/components/shopboard/types'
import { Avatar, StatusLine } from '@/components/team/parts'
import { errText, useClock, useStaff } from '@/components/team/useTeam'
import { readWithoutMissingColumns } from '@/lib/db-missing'
import { MY_GROUPS, carsWord, pickSaved, readSaved, splitMine, summaryLine, writeSaved } from '@/lib/my-cars'
import { getShopId, supabase } from '@/lib/supabase'
import { dayKey, dayRange, entriesFor, fmtDuration, fmtTimeOfDay, isTechnician, minutesOnDay, statusOf } from '@/lib/timeclock'
import type { Person } from '@/lib/timeclock'

type Note = { kind: 'success' | 'error'; text: string } | null
type ClockAction = 'clock_in' | 'clock_out' | 'start_break' | 'end_break'

/** How often the list refreshes on its own while the tab is showing. Changes from other phones arrive at once. */
const REFRESH_MS = 60_000

const stageKey = (status: string) => stageOf(status).key

/** The browser's storage, or nothing when the browser refuses it. */
function browserStore(): Storage | null {
  try { return window.localStorage } catch { return null }
}

/**
 * My cars: a technician's own list. Pick your name once on your phone and see only the cars with your name on them,
 * in the order to work them, with your clock on the same screen. It is a shortcut and not a lock: the Shop board
 * still shows every car to everyone signed in.
 */
export default function MyCarsPage() {
  const router = useRouter()
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
  const [note, setNote] = useState<Note>(null)
  const [busy, setBusy] = useState(false)
  /** undefined until the page has mounted and asked the browser; null means nobody is chosen on this phone. */
  const [savedId, setSavedId] = useState<string | null | undefined>(undefined)
  useEffect(() => { setSavedId(readSaved(browserStore())) }, [])

  const seq = useRef(0)
  const load = useCallback(async () => {
    const mine = ++seq.current
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('We could not find your shop. Refresh, or sign out and back in.')
      const { data, error } = await readWithoutMissingColumns(BOARD_COLUMNS, ['ro_number'], columns => supabase
        .from('jobs')
        .select(columns)
        .eq('shop_id', shopId)
        .not('status', 'in', '("Paid","Closed")')
        .order('created_at', { ascending: false })
        .limit(1000))
      if (error) throw error
      if (mine !== seq.current) return
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
    const back = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', back)
    window.addEventListener('focus', back)
    const channel = supabase.channel('my_cars_jobs').on('postgres_changes', { event: '*', schema: 'public', table: 'jobs' }, () => { void load() }).subscribe()
    const poll = setInterval(back, REFRESH_MS)
    return () => {
      clearInterval(poll)
      document.removeEventListener('visibilitychange', back)
      window.removeEventListener('focus', back)
      supabase.removeChannel(channel)
    }
  }, [load])

  const techPeople = useMemo(
    () => staff.people.filter(p => p.active && isTechnician(p.role)).sort((a, b) => a.name.localeCompare(b.name)),
    [staff.people],
  )
  const me: Person | null = useMemo(() => pickSaved(techPeople, savedId ?? null), [techPeople, savedId])

  const order = useMemo(() => byUrgency(todayKey), [todayKey])
  const mine = useMemo(() => splitMine(jobs, me?.name ?? '', stageKey, order), [jobs, me, order])
  const late = useMemo(() => {
    if (!todayKey) return 0
    return [...mine.groups.working, ...mine.groups.next, ...mine.groups.waiting].filter(j => dueInfo(j, todayKey)?.tone === 'late').length
  }, [mine, todayKey])

  const teamMissing = !!staff.error && staff.people.length === 0
  const ready = savedId !== undefined && jobsLoaded && !staff.loading && !!day && now > 0

  const choose = (p: Person) => {
    writeSaved(browserStore(), p.id)
    setSavedId(String(p.id))
    setNote(null)
  }
  const switchPerson = () => {
    writeSaved(browserStore(), null)
    setSavedId(null)
    setNote(null)
  }

  const clockOk = clock.ready
  const status = me && clockOk ? statusOf(clock.entries, me, now) : null

  const clockMe = async (action: ClockAction) => {
    if (!me) return
    setBusy(true); setNote(null)
    const r = await clock.act({ action, staff_id: me.id })
    setBusy(false)
    if (!r.ok) { setNote({ kind: 'error', text: r.error || 'That did not save. Try again.' }); return }
    const at = fmtTimeOfDay(String(r.entry?.clock_out || r.entry?.clock_in || new Date().toISOString()))
    setNote({
      kind: 'success',
      text: action === 'clock_in' ? `You clocked in at ${at}.`
        : action === 'clock_out' ? `You clocked out at ${at}.`
        : action === 'start_break' ? 'You are on a break.'
        : 'You are back from break.',
    })
  }

  const subtitle = !ready ? 'Loading…'
    : me ? `${me.name} · ${summaryLine(mine.active, late)}`
    : 'Pick your name to see your cars'

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">My cars</h1>
          <p className="page-subtitle" aria-live="polite">{subtitle}</p>
        </div>
        <div className="hidden gap-2 sm:flex">
          <Link href="/shopboard" className="btn btn-secondary no-underline"><Icon name="board" className="h-5 w-5" />Shop board</Link>
        </div>
      </header>

      {note && (
        <Notice kind={note.kind} className="mb-4">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="min-w-0 flex-1 basis-56 break-words">{note.text}</span>
            <button type="button" className="btn btn-ghost btn-sm ml-auto shrink-0" onClick={() => setNote(null)}>Dismiss</button>
          </div>
        </Notice>
      )}

      {teamMissing ? (
        <ErrorCard title="The team list did not load" message={staff.error} onRetry={() => void staff.reload()} />
      ) : loadError && jobs.length === 0 && jobsLoaded ? (
        <ErrorCard title="Your cars did not load" message={loadError} onRetry={() => { setJobsLoaded(false); void load() }} />
      ) : !ready ? (
        <div aria-busy="true" aria-label="Loading your cars" role="status" className="max-w-3xl space-y-3">
          <div className="skeleton h-28" />
          <div className="skeleton h-24" />
          <div className="skeleton h-24" />
        </div>
      ) : techPeople.length === 0 ? (
        <EmptyBlock
          icon="user"
          title="No technicians on your team yet"
          action={<Link href="/staff" className="btn btn-primary no-underline">Open Team</Link>}
        >
          Add each technician on the Team screen with the role Technician. They pick their name here and see their own cars.
        </EmptyBlock>
      ) : !me ? (
        <section aria-labelledby="who-h" className="max-w-3xl">
          <h2 id="who-h" className="section-title mb-1">Who are you?</h2>
          <p className="mb-3 text-text-secondary">Pick your name. This device remembers it, so next time your cars are the first thing you see.</p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {techPeople.map(p => {
              const theirs = splitMine(jobs, p.name, stageKey)
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => choose(p)}
                    className="flex min-h-[56px] w-full items-center gap-3 rounded-md border border-border bg-bg-card px-3 text-left hover:bg-bg-hover"
                  >
                    <Avatar name={p.name} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-bold">{p.name}</span>
                      <span className="block text-[0.8125rem] text-text-secondary">{carsWord(theirs.active)} to work on</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          <p className="mt-4 text-[0.875rem] text-text-secondary">This only picks which cars you see. Everyone signed in to the shop can still see every car on the Shop board.</p>
        </section>
      ) : (
        <div className="max-w-3xl">
          {loadError && (
            <p role="alert" className="mb-3 text-[0.9375rem] text-red">
              Your cars could not refresh. What you see may be out of date. <button type="button" className="btn btn-ghost btn-sm" onClick={() => void load()}>Try again</button>
            </p>
          )}

          <section aria-label="Your clock" className="card mb-6">
            <div className="flex items-center gap-3">
              <Avatar name={me.name} size={44} />
              <h2 className="min-w-0 flex-1 truncate text-[1.125rem] font-bold leading-tight">{me.name}</h2>
              <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={switchPerson}>Not you?</button>
            </div>
            <div className="mt-2.5 text-[0.9375rem] text-text-secondary">
              {status ? (
                <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                  <StatusLine status={status} todayKey={todayKey} className="min-w-0" />
                  <span className="num shrink-0">{fmtDuration(minutesOnDay(entriesFor(clock.entries, me), todayKey, now))} today</span>
                </span>
              ) : clock.error ? (
                <span role="alert" className="text-red">
                  The time clock did not load. <button type="button" className="btn btn-ghost btn-sm" onClick={() => void clock.reload()}>Try again</button>
                </span>
              ) : <span className="skeleton block h-4 w-40" aria-label="Loading the clock" />}
            </div>
            {status && (
              <div className="mt-3 flex gap-2">
                {status.overlong ? (
                  <Link href="/staff" className="btn btn-secondary flex-1 no-underline"><Icon name="edit" className="h-5 w-5" />Fix my time</Link>
                ) : status.state === 'out' ? (
                  <button type="button" className="btn btn-primary flex-1" disabled={busy} onClick={() => void clockMe('clock_in')}>
                    <Icon name="clock" className="h-5 w-5" />{busy ? 'Saving…' : 'Clock in'}
                  </button>
                ) : (
                  <>
                    {status.state === 'break' ? (
                      <button type="button" className="btn btn-primary flex-1" disabled={busy} onClick={() => void clockMe('end_break')}>
                        <Icon name="play" className="h-5 w-5" />End break
                      </button>
                    ) : clock.breaks && (
                      <button type="button" className="btn btn-secondary flex-1" disabled={busy} onClick={() => void clockMe('start_break')}>
                        <Icon name="pause" className="h-5 w-5" />Break
                      </button>
                    )}
                    <button type="button" className="btn btn-secondary flex-1" disabled={busy} onClick={() => void clockMe('clock_out')}>
                      {busy ? 'Saving…' : 'Clock out'}
                    </button>
                  </>
                )}
              </div>
            )}
          </section>

          {mine.total === 0 ? (
            <EmptyBlock
              icon="wrench"
              title="No cars on your list"
              action={<Link href="/shopboard" className="btn btn-secondary no-underline"><Icon name="board" className="h-5 w-5" />Open the Shop board</Link>}
            >
              When the front desk or the owner gives you a car on the Shop board, it shows up here.
            </EmptyBlock>
          ) : (
            <div className="space-y-6">
              {MY_GROUPS.map(g => {
                const list = mine.groups[g.key]
                if (list.length === 0) return null
                return (
                  <section key={g.key} aria-labelledby={`mine-${g.key}`}>
                    <div className="mb-2 flex items-baseline justify-between gap-3">
                      <h2 id={`mine-${g.key}`} className="section-title">{g.title}</h2>
                      <span className="num text-[0.9375rem] text-text-secondary">{carsWord(list.length)}</span>
                    </div>
                    <ul className="space-y-2.5">
                      {list.map(j => (
                        <li key={j.id}>
                          <BoardCard
                            job={j}
                            todayKey={todayKey}
                            draggable={false}
                            dragging={false}
                            onOpen={x => router.push(`/jobs?job=${encodeURIComponent(x.id)}`)}
                            onDragStart={() => {}}
                            onDragEnd={() => {}}
                          />
                        </li>
                      ))}
                    </ul>
                  </section>
                )
              })}
            </div>
          )}

          <p className="mt-8 text-[0.875rem] text-text-secondary">
            {mine.total > 0 && 'Tap a car to open it. '}This list only picks which cars you see; everyone signed in to the shop can still see every car on the <Link href="/shopboard">Shop board</Link>.
          </p>
        </div>
      )}
    </div>
  )
}
