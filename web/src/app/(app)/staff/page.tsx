'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import Sheet from '@/components/Sheet'
import Segmented from '@/components/inbox/Segmented'
import { ErrorCard } from '@/components/ListKit'
import PeopleView from '@/components/team/PeopleView'
import PersonForm from '@/components/team/PersonForm'
import PersonSheet from '@/components/team/PersonSheet'
import type { ClockAction, PersonApi } from '@/components/team/PersonSheet'
import Timesheets from '@/components/team/Timesheets'
import TodayView from '@/components/team/TodayView'
import { postJson, useClock, useStaff } from '@/components/team/useTeam'
import {
  addDaysKey, dayKey, dayLabel, dayRange, entryDay, fmtDuration, fmtTimeOfDay, statusOf, timesheetCsv, weekKeys, weekStartKey,
} from '@/lib/timeclock'
import type { Person } from '@/lib/timeclock'

type Tab = 'today' | 'timesheets' | 'people'
type Sheeted = null | { kind: 'person'; id: number; day: string | null } | { kind: 'add' }

/** Team: who is clocked in, the week's hours, and who is on the team. (The route stays /staff so old links keep working.) */
export default function TeamPage() {
  const staff = useStaff()
  const [tab, setTab] = useState<Tab>('today')
  const [weekStart, setWeekStart] = useState('')
  const range = useMemo(() => (weekStart ? dayRange(weekStart, addDaysKey(weekStart, 6)) : null), [weekStart])
  const clock = useClock(range)
  const [sheet, setSheet] = useState<Sheeted>(null)
  const [notice, setNotice] = useState('')
  const [problem, setProblem] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [addBusy, setAddBusy] = useState(false)
  const [addError, setAddError] = useState('')

  // The date comes from the browser, so nothing that depends on it is drawn until the page has mounted.
  const now = clock.now
  const ready = !!weekStart && now > 0
  const todayKey = ready ? dayKey(new Date(now)) : ''
  const thisWeek = ready ? weekStartKey(new Date(now)) : ''
  useEffect(() => { setWeekStart(weekStartKey()) }, [])

  const people = staff.people
  const active = people.filter(p => p.active)
  const inCount = ready ? active.filter(p => statusOf(clock.entries, p, now).state !== 'out').length : 0
  const breakCount = ready ? active.filter(p => statusOf(clock.entries, p, now).state === 'break').length : 0

  const goTab = (t: Tab) => {
    setTab(t)
    setNotice(''); setProblem('')
    // Today always means this week's data. Timesheets keeps whichever week was last looked at.
    if (t === 'today' && thisWeek) setWeekStart(thisWeek)
  }

  const clockPerson = useCallback(async (p: Person, action: ClockAction) => {
    setBusyId(p.id); setProblem(''); setNotice('')
    const r = await clock.act({ action, staff_id: p.id })
    setBusyId(null)
    if (!r.ok) { setProblem(`${p.name}: ${r.error}`); return }
    const at = fmtTimeOfDay(String(r.entry?.clock_out || r.entry?.clock_in || new Date().toISOString()))
    if (action === 'clock_in') setNotice(`${p.name} clocked in at ${at}.`)
    else if (action === 'clock_out') setNotice(`${p.name} clocked out at ${at}${typeof r.hours_worked === 'number' ? `. That shift was ${fmtDuration(r.hours_worked * 60)}` : ''}.`)
    else if (action === 'start_break') setNotice(`${p.name} is on a break.`)
    else setNotice(`${p.name} is back from break.`)
  }, [clock])

  const apiFor = (p: Person): PersonApi => ({
    clock: async a => { const r = await clock.act({ action: a, staff_id: p.id }); return r.ok ? '' : r.error || 'That did not save.' },
    saveEntry: async e => {
      const r = await clock.act(e.id
        ? { action: 'update_entry', id: e.id, clock_in: e.clock_in, clock_out: e.clock_out, reason: e.reason }
        : { action: 'add_entry', staff_id: p.id, clock_in: e.clock_in, clock_out: e.clock_out, reason: e.reason })
      return r.ok ? '' : r.error || 'That did not save.'
    },
    deleteEntry: async id => { const r = await clock.act({ action: 'delete_entry', id }); return r.ok ? '' : r.error || 'That did not delete.' },
    savePerson: async v => {
      const r = await postJson('/api/staff', { action: 'update', id: p.id, ...v })
      if (!r.ok) return r.error || 'That did not save.'
      await Promise.all([staff.reload(), clock.reload()])
      if (r.warning) setProblem(r.warning)
      return ''
    },
    setActive: async on => {
      const r = await postJson('/api/staff', { action: 'update', id: p.id, active: on })
      if (!r.ok) return r.error || 'That did not save.'
      await staff.reload()
      if (!on) { setSheet(null); setNotice(`${p.name} is off the team. Their past hours are kept.`) }
      return ''
    },
  })

  const addPerson = async (v: { name: string; role: string }) => {
    setAddBusy(true); setAddError('')
    const r = await postJson('/api/staff', { action: 'add', ...v })
    setAddBusy(false)
    if (!r.ok) { setAddError(r.error || 'That did not save.'); return }
    await staff.reload()
    setSheet(null)
    setNotice(`${v.name} is on the team.`)
  }

  const download = () => {
    const keys = weekKeys(weekStart)
    const csv = timesheetCsv(people, clock.entries.filter(e => keys.includes(entryDay(e))), now)
    // The byte-order mark makes Excel read names with accents correctly.
    const url = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `timesheets-${weekStart}-to-${addDaysKey(weekStart, 6)}.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    setNotice(`Timesheet file for ${dayLabel(weekStart)} to ${dayLabel(addDaysKey(weekStart, 6))} downloaded.`)
  }

  const shiftWeek = (delta: -1 | 0 | 1) => setWeekStart(w => (delta === 0 ? thisWeek : addDaysKey(w, delta * 7)))

  const openPerson = people.find(p => sheet?.kind === 'person' && p.id === sheet.id) || null
  const stale = ready ? active.filter(p => statusOf(clock.entries, p, now).stale) : []

  const subtitle = !ready || (staff.loading && people.length === 0) ? 'Loading…'
    : staff.error && people.length === 0 ? 'Could not load the team'
    : active.length === 0 ? 'No one on the team yet'
    : clock.error && !clock.ready ? `${active.length} on the team`
    : inCount === 0 ? `No one is clocked in · ${active.length} on the team`
    : `${inCount} of ${active.length} clocked in${breakCount > 0 ? `, ${breakCount} on break` : ''}`

  const clockBlocked = !!clock.error && !clock.ready
  const loadingAll = !ready || (staff.loading && people.length === 0) || (clock.loading && !clock.ready && !clock.error)

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">Team</h1>
          <p className="page-subtitle num" aria-live="polite">{subtitle}</p>
        </div>
        <button type="button" className={`btn w-full sm:w-auto ${tab === 'people' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setAddError(''); setSheet({ kind: 'add' }) }} disabled={!ready}>
          <Icon name="plus" className="h-5 w-5" />Add person
        </button>
      </header>

      {notice && (
        <div role="status" className="mb-4 flex items-center justify-between gap-3 rounded-md border border-green/40 bg-bg-card px-4 py-2.5 text-[0.9375rem]">
          <span className="flex min-w-0 items-center gap-2"><Icon name="check" className="h-5 w-5 shrink-0 text-green" /><span className="min-w-0 break-words">{notice}</span></span>
          <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => setNotice('')}>Dismiss</button>
        </div>
      )}
      {problem && (
        <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-md border border-red/50 bg-red/[0.08] px-4 py-3 text-[0.9375rem]">
          <p className="min-w-0 break-words text-red">{problem}</p>
          <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => setProblem('')}>Dismiss</button>
        </div>
      )}

      <Segmented
        className="mb-4 sm:max-w-md"
        label="Team views"
        value={tab}
        onChange={goTab}
        options={[{ value: 'today', label: 'Today' }, { value: 'timesheets', label: 'Timesheets' }, { value: 'people', label: 'People' }]}
      />

      {staff.error && people.length === 0 ? (
        <ErrorCard title="The team did not load" message={staff.error} onRetry={() => void staff.reload()} />
      ) : loadingAll && tab !== 'people' ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading the team">
          {[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-[4.25rem]" />)}
        </div>
      ) : tab === 'people' ? (
        staff.loading && people.length === 0
          ? <div className="space-y-2" aria-busy="true" aria-label="Loading the team">{[0, 1, 2].map(i => <div key={i} className="skeleton h-[4.25rem]" />)}</div>
          : <PeopleView people={people} onOpen={p => setSheet({ kind: 'person', id: p.id, day: null })} onAdd={() => { setAddError(''); setSheet({ kind: 'add' }) }} />
      ) : clockBlocked ? (
        <ErrorCard title="The time clock did not load" message={clock.error} onRetry={() => void clock.reload()} />
      ) : (
        <>
          {clock.error && <p role="alert" className="mb-3 text-[0.9375rem] text-red">The time clock could not refresh. What you see may be out of date. <button type="button" className="btn btn-ghost btn-sm" onClick={() => void clock.reload()}>Try again</button></p>}
          {tab === 'today' && stale.length > 0 && (
            <div role="status" className="mb-4 flex items-start gap-2.5 rounded-md border border-amber/50 bg-amber/[0.10] px-3 py-2.5 text-[0.9375rem]">
              <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-amber" />
              <p className="min-w-0">
                {stale.map(p => p.name).join(' and ')} {stale.length === 1 ? 'is' : 'are'} still clocked in from an earlier day. Open {stale.length === 1 ? 'the person' : 'each person'} and use Fix to set the real clock-out time.
              </p>
            </div>
          )}
          {tab === 'today' ? (
            <TodayView
              people={people}
              entries={clock.entries}
              nowMs={now}
              breaks={clock.breaks}
              busyId={busyId}
              onClock={(p, a) => void clockPerson(p, a)}
              onOpen={p => setSheet({ kind: 'person', id: p.id, day: null })}
              onAdd={() => { setAddError(''); setSheet({ kind: 'add' }) }}
            />
          ) : (
            <Timesheets
              people={people}
              entries={clock.entries}
              weekStart={weekStart}
              todayKey={todayKey}
              nowMs={now}
              isCurrentWeek={weekStart === thisWeek}
              onWeek={shiftWeek}
              onOpen={(p, day) => setSheet({ kind: 'person', id: p.id, day })}
              onDownload={download}
            />
          )}
        </>
      )}

      <Sheet open={sheet?.kind === 'person' && !!openPerson} onClose={() => setSheet(null)} title={openPerson?.name || 'Team member'} wide>
        {openPerson && sheet?.kind === 'person' && (
          <PersonSheet
            key={openPerson.id}
            person={openPerson}
            entries={clock.entries}
            weekStart={weekStart}
            nowMs={now}
            breaks={clock.breaks}
            focusDay={sheet.day}
            api={apiFor(openPerson)}
          />
        )}
      </Sheet>

      <Sheet open={sheet?.kind === 'add'} onClose={() => setSheet(null)} title="Add a person">
        <PersonForm key={sheet?.kind === 'add' ? 'open' : 'closed'} person={null} busy={addBusy} error={addError} onSave={v => void addPerson(v)} onCancel={() => setSheet(null)} />
      </Sheet>
    </div>
  )
}
