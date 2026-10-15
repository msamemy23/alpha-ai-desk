'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import Sheet from '@/components/Sheet'
import Segmented from '@/components/inbox/Segmented'
import { ErrorCard } from '@/components/ListKit'
import Efficiency from '@/components/team/Efficiency'
import PayrollSheet from '@/components/team/PayrollSheet'
import PeopleView from '@/components/team/PeopleView'
import PersonForm from '@/components/team/PersonForm'
import PersonSheet from '@/components/team/PersonSheet'
import type { ClockAction, PersonApi } from '@/components/team/PersonSheet'
import RulesForm from '@/components/team/RulesForm'
import Timesheets from '@/components/team/Timesheets'
import TodayView from '@/components/team/TodayView'
import { readDeviceFix } from '@/components/team/geoClient'
import { postJson, usePay, usePins, useRules, useClock, useStaff } from '@/components/team/useTeam'
import type { ApiResult } from '@/components/team/useTeam'
import { addDaysKey, dayKey, dayRange, fmtDuration, fmtTimeOfDay, statusOf, undoableEntry, entriesFor } from '@/lib/timeclock'
import type { Person } from '@/lib/timeclock'
import { periodLabel, periodStartFor } from '@/lib/timerules'

type Tab = 'today' | 'timesheets' | 'efficiency' | 'people'
type Sheeted = null | { kind: 'person'; id: number; day: string | null } | { kind: 'add' } | { kind: 'rules' } | { kind: 'payroll' }
interface Notice { text: string; action?: { label: string; run: () => void } }

const failText = (r: ApiResult, fallback: string): string => (r.ok ? '' : r.error || fallback)

/** Team: who is clocked in, the pay period's hours, efficiency, and who is on the team. (The route stays /staff so old links keep working.) */
export default function TeamPage() {
  const staff = useStaff()
  const rulesApi = useRules()
  const rules = rulesApi.rules
  const canManage = rulesApi.canManage
  const canSeeMoney = rulesApi.role === 'owner' || rulesApi.role === 'admin'
  const pins = usePins(canManage)
  const pay = usePay(canSeeMoney)

  const [tab, setTab] = useState<Tab>('today')
  const [periodStart, setPeriodStart] = useState('')
  const period = useMemo(() => ({ start: periodStart, days: rules.periodDays as number }), [periodStart, rules.periodDays])
  const range = useMemo(() => (periodStart ? dayRange(periodStart, addDaysKey(periodStart, rules.periodDays - 1)) : null), [periodStart, rules.periodDays])
  const clock = useClock(range)
  const [sheet, setSheet] = useState<Sheeted>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const [problem, setProblem] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [addBusy, setAddBusy] = useState(false)
  const [addError, setAddError] = useState('')
  const [rulesBusy, setRulesBusy] = useState(false)
  const [rulesError, setRulesError] = useState('')
  const [rulesDirty, setRulesDirty] = useState(false)

  // The date comes from the browser, so nothing that depends on it is drawn until the page has mounted and the rules are known.
  const now = clock.now
  const ready = !!periodStart && now > 0 && !rulesApi.loading
  const todayKey = ready ? dayKey(new Date(now)) : ''
  const thisPeriod = ready ? periodStartFor(todayKey, rules) : ''
  const rulesKey = `${rules.weekStart}|${rules.periodDays}|${rules.periodAnchor}`
  useEffect(() => {
    if (rulesApi.loading) return
    setPeriodStart(periodStartFor(dayKey(new Date()), rules))
    // Whenever the pay week or period changes, go back to the current pay period.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rulesApi.loading, rulesKey])

  const people = staff.people
  const active = people.filter(p => p.active)
  const inCount = ready ? active.filter(p => statusOf(clock.entries, p, now).state !== 'out').length : 0
  const breakCount = ready ? active.filter(p => statusOf(clock.entries, p, now).state === 'break').length : 0

  const goTab = (t: Tab) => {
    setTab(t)
    setNotice(null); setProblem('')
    // Today always means the current pay period's data. The other tabs keep whichever period was last looked at.
    if (t === 'today' && thisPeriod) setPeriodStart(thisPeriod)
  }

  const clockBody = useCallback(async (p: Person, action: ClockAction): Promise<Record<string, unknown>> => {
    const body: Record<string, unknown> = { action, staff_id: p.id }
    // The location check asks this device where it is, once, only when the shop has turned the check on.
    if (action === 'clock_in' && rules.locationMode !== 'off') {
      const g = await readDeviceFix()
      if (g.fix) body.geo = g.fix
    }
    return body
  }, [rules.locationMode])

  const undoFor = useCallback(async (p: Person) => {
    setBusyId(p.id); setProblem('')
    const r = await clock.act({ action: 'undo_clock_out', staff_id: p.id })
    setBusyId(null)
    if (!r.ok) { setProblem(`${p.name}: ${r.error}`); return }
    setNotice({ text: `${p.name}'s clock-out was taken back. They are clocked in again.` })
  }, [clock])

  const clockPerson = useCallback(async (p: Person, action: ClockAction) => {
    setBusyId(p.id); setProblem(''); setNotice(null)
    const r = await clock.act(await clockBody(p, action))
    setBusyId(null)
    if (!r.ok) { setProblem(`${p.name}: ${r.error}`); return }
    const at = fmtTimeOfDay(String(r.entry?.clock_out || r.entry?.clock_in || new Date().toISOString()))
    if (action === 'clock_in') setNotice({ text: `${p.name} clocked in at ${at}.` })
    else if (action === 'clock_out') {
      setNotice({
        text: `${p.name} clocked out at ${at}${typeof r.hours_worked === 'number' ? `. That shift was ${fmtDuration(r.hours_worked * 60)}` : ''}.`,
        action: { label: 'Undo', run: () => void undoFor(p) },
      })
    } else if (action === 'start_break') setNotice({ text: `${p.name} is on a break.` })
    else setNotice({ text: `${p.name} is back from break.` })
  }, [clock, clockBody, undoFor])

  const apiFor = (p: Person): PersonApi => ({
    clock: async a => failText(await clock.act(await clockBody(p, a)), 'That did not save.'),
    startJob: async jobId => failText(await clock.act({ action: 'start_job', staff_id: p.id, job_id: jobId }), 'That did not save.'),
    stopJob: async () => failText(await clock.act({ action: 'stop_job', staff_id: p.id }), 'That did not save.'),
    approve: async note => {
      if (!range) return 'The pay period is not ready yet.'
      return failText(await clock.act({ action: 'approve', staff_id: p.id, period_start: period.start, period_days: period.days, window_from: range.from, window_to: range.to, note }), 'That did not save.')
    },
    unapprove: async () => failText(await clock.act({ action: 'unapprove', staff_id: p.id, period_start: period.start }), 'That did not save.'),
    saveEntry: async e => failText(await clock.act(e.id
      ? { action: 'update_entry', id: e.id, clock_in: e.clock_in, clock_out: e.clock_out, reason: e.reason }
      : { action: 'add_entry', staff_id: p.id, clock_in: e.clock_in, clock_out: e.clock_out, reason: e.reason }), 'That did not save.'),
    deleteEntry: async (id, reason) => failText(await clock.act({ action: 'delete_entry', id, reason }), 'That did not delete.'),
    restoreEntry: async changeId => failText(await clock.act({ action: 'restore_entry', change_id: changeId }), 'That could not be put back.'),
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
      if (!on) { setSheet(null); setNotice({ text: `${p.name} is off the team. Their past hours are kept.` }) }
      return ''
    },
    setPin: async pin => {
      const r = await postJson('/api/staff/pin', { staff_id: p.id, pin })
      if (r.ok) await pins.reload()
      return failText(r, 'The PIN did not save.')
    },
    clearPin: async () => {
      const r = await postJson('/api/staff/pin', { staff_id: p.id, clear: true })
      if (r.ok) await pins.reload()
      return failText(r, 'The PIN was not removed.')
    },
    savePay: async v => {
      const body: Record<string, unknown> = { staff_id: p.id, method: v.method }
      if (v.method === 'hourly') body.hourly = v.value
      else if (v.method === 'flat') body.flat = v.value
      else body.commission_pct = v.value
      const r = await postJson('/api/staff/pay', body)
      if (r.ok) await pay.reload()
      return failText(r, 'The pay rate did not save.')
    },
  })

  const addPerson = async (v: { name: string; role: string }) => {
    setAddBusy(true); setAddError('')
    const r = await postJson('/api/staff', { action: 'add', ...v })
    setAddBusy(false)
    if (!r.ok) { setAddError(r.error || 'That did not save.'); return }
    await staff.reload()
    setSheet(null)
    setNotice({ text: `${v.name} is on the team.` })
  }

  const saveRules = async (next: typeof rules) => {
    setRulesBusy(true); setRulesError('')
    const r = await rulesApi.save(next)
    setRulesBusy(false)
    if (!r.ok) { setRulesError(r.error || 'The pay rules did not save.'); return }
    setRulesDirty(false)
    setSheet(null)
    setNotice({ text: 'Pay rules saved. Hours are now counted this way.' })
  }

  const closeRules = () => {
    if (rulesDirty && !window.confirm('Close without saving your changes to the pay rules?')) return
    setRulesDirty(false); setRulesError(''); setSheet(null)
  }

  const shiftPeriod = (delta: -1 | 0 | 1) => setPeriodStart(s => (delta === 0 ? thisPeriod : addDaysKey(s, delta * rules.periodDays)))

  const openPerson = people.find(p => sheet?.kind === 'person' && p.id === sheet.id) || null
  const stale = ready ? active.filter(p => statusOf(clock.entries, p, now).stale) : []
  const undoable = ready ? active.filter(p => !!undoableEntry(entriesFor(clock.entries, p), now) && statusOf(clock.entries, p, now).state === 'out') : []

  const subtitle = !ready || (staff.loading && people.length === 0) ? 'Loading…'
    : staff.error && people.length === 0 ? 'Could not load the team'
    : active.length === 0 ? 'No one on the team yet'
    : clock.error && !clock.ready ? `${active.length} on the team`
    : inCount === 0 ? `No one is clocked in · ${active.length} on the team`
    : `${inCount} of ${active.length} clocked in${breakCount > 0 ? `, ${breakCount} on break` : ''}`

  const clockBlocked = !!clock.error && !clock.ready
  const loadingAll = !ready || (staff.loading && people.length === 0) || (clock.loading && !clock.ready && !clock.error)

  const tabs: { value: Tab; label: string }[] = [{ value: 'today', label: 'Today' }, { value: 'timesheets', label: 'Timesheets' }]
  if (canManage) tabs.push({ value: 'efficiency', label: 'Efficiency' })
  tabs.push({ value: 'people', label: 'People' })

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">Team</h1>
          <p className="page-subtitle num" aria-live="polite">{subtitle}</p>
        </div>
        {canManage && (
          <button type="button" className={`btn w-full sm:w-auto ${tab === 'people' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => { setAddError(''); setSheet({ kind: 'add' }) }} disabled={!ready}>
            <Icon name="plus" className="h-5 w-5" />Add person
          </button>
        )}
      </header>

      {notice && (
        <div role="status" className="mb-4 flex items-center justify-between gap-3 rounded-md border border-green/40 bg-bg-card px-4 py-2.5 text-[0.9375rem]">
          <span className="flex min-w-0 items-center gap-2"><Icon name="check" className="h-5 w-5 shrink-0 text-green" /><span className="min-w-0 break-words">{notice.text}</span></span>
          <span className="flex shrink-0 gap-1">
            {notice.action && <button type="button" className="btn btn-secondary btn-sm" onClick={() => { const run = notice.action?.run; setNotice(null); run?.() }}><Icon name="undo" className="h-4 w-4" />{notice.action.label}</button>}
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNotice(null)}>Dismiss</button>
          </span>
        </div>
      )}
      {problem && (
        <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-md border border-red/50 bg-red/[0.08] px-4 py-3 text-[0.9375rem]">
          <p className="min-w-0 break-words text-red">{problem}</p>
          <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => setProblem('')}>Dismiss</button>
        </div>
      )}
      {rulesApi.error && (
        <div role="alert" className="mb-4 flex items-start justify-between gap-3 rounded-md border border-amber/50 bg-amber/[0.10] px-4 py-3 text-[0.9375rem]">
          <p className="min-w-0">The pay rules did not load, so hours are counted with the standard Monday week and overtime over 40 hours. Some options stay hidden until they load.</p>
          <button type="button" className="btn btn-secondary btn-sm shrink-0" onClick={() => void rulesApi.reload()}>Try again</button>
        </div>
      )}

      <Segmented className="mb-4 sm:max-w-xl" label="Team views" value={tab} onChange={goTab} options={tabs} />

      {staff.error && people.length === 0 ? (
        <ErrorCard title="The team did not load" message={staff.error} onRetry={() => void staff.reload()} />
      ) : loadingAll && tab !== 'people' ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading the team">
          {[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-[4.25rem]" />)}
        </div>
      ) : tab === 'people' ? (
        staff.loading && people.length === 0
          ? <div className="space-y-2" aria-busy="true" aria-label="Loading the team">{[0, 1, 2].map(i => <div key={i} className="skeleton h-[4.25rem]" />)}</div>
          : <PeopleView people={people} pinIds={canManage && pins.available && pins.loaded ? pins.ids : null} requirePin={rules.requirePin} onOpen={p => setSheet({ kind: 'person', id: p.id, day: null })} onAdd={() => { setAddError(''); setSheet({ kind: 'add' }) }} />
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
          {tab === 'today' && undoable.length > 0 && !notice && (
            <div role="status" className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-bg-card px-3 py-2.5 text-[0.9375rem]">
              <p className="min-w-0">{undoable.map(p => p.name).join(' and ')} just clocked out. Wrong button?</p>
              <span className="flex flex-wrap gap-2">
                {undoable.slice(0, 3).map(p => <button key={p.id} type="button" className="btn btn-secondary btn-sm" disabled={busyId === p.id} onClick={() => void undoFor(p)}><Icon name="undo" className="h-4 w-4" />Undo for {p.name.split(' ')[0]}</button>)}
              </span>
            </div>
          )}
          {tab === 'today' ? (
            <TodayView
              people={people}
              entries={clock.entries}
              segments={clock.segments}
              nowMs={now}
              breaks={clock.breaks}
              busyId={busyId}
              onClock={(p, a) => void clockPerson(p, a)}
              onOpen={p => setSheet({ kind: 'person', id: p.id, day: null })}
              onAdd={() => { setAddError(''); setSheet({ kind: 'add' }) }}
            />
          ) : tab === 'timesheets' ? (
            <Timesheets
              people={people}
              entries={clock.entries}
              period={period}
              rules={rules}
              todayKey={todayKey}
              nowMs={now}
              isCurrentPeriod={period.start === thisPeriod}
              approvals={clock.approvals}
              approvalsOn={clock.approvalsOn}
              canChangeRules={rulesApi.canChange}
              onPeriod={shiftPeriod}
              onOpen={(p, day) => setSheet({ kind: 'person', id: p.id, day })}
              onPayroll={() => setSheet({ kind: 'payroll' })}
              onRules={() => { setRulesError(''); setSheet({ kind: 'rules' }) }}
            />
          ) : (
            <>
              <div className="mb-4 flex items-center gap-2">
                <button type="button" className="btn btn-secondary !px-3" onClick={() => shiftPeriod(-1)} aria-label="Previous pay period"><Icon name="chevronLeft" className="h-5 w-5" /></button>
                <p className="num min-w-0 flex-1 text-center text-[1rem] font-bold" aria-live="polite">{periodLabel(period.start, period.days)}</p>
                <button type="button" className="btn btn-secondary !px-3" onClick={() => shiftPeriod(1)} aria-label="Next pay period" disabled={period.start === thisPeriod}><Icon name="chevronRight" className="h-5 w-5" /></button>
              </div>
              <Efficiency
                people={people}
                entries={clock.entries}
                segmentsInPeriod={clock.segments}
                period={period}
                rules={rules}
                nowMs={now}
                canSeeMoney={canSeeMoney && pay.allowed}
                rates={pay.rates}
                range={range ? { from: period.start, to: addDaysKey(period.start, period.days - 1), fromIso: range.from, toIso: range.to } : null}
                onOpenPerson={p => setSheet({ kind: 'person', id: p.id, day: null })}
              />
            </>
          )}
        </>
      )}

      <Sheet open={sheet?.kind === 'person' && !!openPerson} onClose={() => setSheet(null)} title={openPerson?.name || 'Team member'} wide>
        {openPerson && sheet?.kind === 'person' && (
          <PersonSheet
            key={openPerson.id}
            person={openPerson}
            entries={clock.entries}
            period={period}
            rules={rules}
            nowMs={now}
            breaks={clock.breaks}
            focusDay={sheet.day}
            segments={clock.segments}
            jobTimeOn={clock.jobTimeOn}
            approvals={clock.approvals}
            approvalsOn={clock.approvalsOn}
            canManage={canManage}
            canSeePay={canSeeMoney && pay.allowed}
            hasPin={canManage && pins.available && pins.loaded ? pins.ids.has(openPerson.id) : null}
            pinsOn={pins.available}
            pay={pay.rates.get(openPerson.id)}
            payOn={pay.available}
            api={apiFor(openPerson)}
          />
        )}
      </Sheet>

      <Sheet open={sheet?.kind === 'add'} onClose={() => setSheet(null)} title="Add a person">
        <PersonForm key={sheet?.kind === 'add' ? 'open' : 'closed'} person={null} busy={addBusy} error={addError} onSave={v => void addPerson(v)} onCancel={() => setSheet(null)} />
      </Sheet>

      <Sheet open={sheet?.kind === 'rules'} onClose={closeRules} title="Pay rules" wide dirty={rulesDirty}>
        {sheet?.kind === 'rules' && (
          <RulesForm rules={rules} canChange={rulesApi.canChange} busy={rulesBusy} error={rulesError} todayKey={todayKey} onSave={r => void saveRules(r)} onCancel={closeRules} onDirty={() => setRulesDirty(true)} />
        )}
      </Sheet>

      <Sheet open={sheet?.kind === 'payroll'} onClose={() => setSheet(null)} title="Payroll file">
        {sheet?.kind === 'payroll' && (
          <PayrollSheet
            people={people}
            entries={clock.entries}
            period={period}
            rules={rules}
            approvals={clock.approvals}
            approvalsOn={clock.approvalsOn}
            nowMs={now}
            onDone={text => { setSheet(null); setNotice({ text }) }}
            onClose={() => setSheet(null)}
          />
        )}
      </Sheet>
    </div>
  )
}
