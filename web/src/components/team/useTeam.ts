'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { normalizeEntry } from '@/lib/timeclock'
import type { ClockEntry, Person } from '@/lib/timeclock'
import { normalizeApproval } from '@/lib/payroll'
import type { Approval } from '@/lib/payroll'
import { normalizeSegment } from '@/lib/jobtime'
import { normalizePay } from '@/lib/jobtime'
import type { JobSegment, PayRate } from '@/lib/jobtime'
import { DEFAULT_RULES, normalizeRules } from '@/lib/timerules'
import type { TimeRules } from '@/lib/timerules'

export const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)

export interface ApiResult {
  ok: boolean
  error?: string
  warning?: string
  entry?: Record<string, unknown>
  staff?: Record<string, unknown>
  hours_worked?: number
  /** A short machine word for the kind of refusal, such as "locked" or "location". */
  code?: string
  minutes_total?: number
  restorable?: boolean
  rules?: Record<string, unknown>
}

/** POST JSON and always come back with a readable error, never a thrown one. */
export async function postJson(path: string, body: Record<string, unknown>): Promise<ApiResult> {
  let res: Response
  try {
    res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  } catch {
    return { ok: false, error: 'No connection. Check your internet and try again.' }
  }
  const data = (await res.json().catch(() => ({}))) as ApiResult
  if (!res.ok || data.ok === false) {
    const fallback = res.status === 401 ? 'You were signed out. Refresh the page and sign in again.' : 'That did not save. Try again.'
    return { ...data, ok: false, error: data.error || fallback }
  }
  return { ...data, ok: true }
}

export function normalizePerson(raw: Record<string, unknown>): Person {
  return { id: Number(raw.id), name: String(raw.name ?? ''), role: String(raw.role ?? 'employee'), active: raw.active !== false }
}

/** Everyone on the team, former members included. The screens decide who to show. */
export function useStaff() {
  const [people, setPeople] = useState<Person[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/staff?include_inactive=1', { cache: 'no-store' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.ok === false) throw new Error(d.error || 'The team list did not load.')
      setPeople(((d.staff || []) as Record<string, unknown>[]).map(normalizePerson))
      setError('')
    } catch (e) {
      setError(errText(e, 'The team list did not load. Check your connection and try again.'))
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => { void load() }, [load])
  return { people, loading: !loaded, error, reload: load }
}

/** The shop's pay week, overtime and clock-in rules, and what the signed-in person may do with them. */
export function useRules() {
  const [rules, setRules] = useState<TimeRules>(DEFAULT_RULES)
  const [available, setAvailable] = useState(true)
  const [role, setRole] = useState('')
  const [canChange, setCanChange] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/timeclock/rules', { cache: 'no-store' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.ok === false) throw new Error(d.error || 'The pay rules did not load.')
      setRules(normalizeRules(d.rules))
      setAvailable(d.available !== false)
      setCanChange(d.canChange === true)
      setRole(String(d.role || ''))
      setError('')
    } catch (e) {
      setError(errText(e, 'The pay rules did not load. Check your connection and try again.'))
    } finally {
      setLoaded(true)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const save = useCallback(async (next: TimeRules) => {
    const r = await postJson('/api/timeclock/rules', next as unknown as Record<string, unknown>)
    if (r.ok) await load()
    return r
  }, [load])

  const canManage = role === 'owner' || role === 'admin' || role === 'manager'
  return { rules, available, role, canChange, canManage, loading: !loaded, error, reload: load, save }
}

/** Which people have a PIN for the shop tablet. Only managers can ask; the PINs themselves never leave the server. */
export function usePins(enabled: boolean) {
  const [ids, setIds] = useState<Set<number>>(new Set())
  const [available, setAvailable] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const load = useCallback(async () => {
    if (!enabled) return
    try {
      const res = await fetch('/api/staff/pin', { cache: 'no-store' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.ok === false) throw new Error('PIN status did not load.')
      setIds(new Set(((d.pins || []) as { staff_id: number }[]).map(p => Number(p.staff_id))))
      setAvailable(d.available !== false)
    } catch {
      // Not knowing is shown as "unknown" by the caller, never as "no PIN".
      setAvailable(false)
    } finally {
      setLoaded(true)
    }
  }, [enabled])
  useEffect(() => { void load() }, [load])
  return { ids, available, loaded, reload: load }
}

/** Pay rates, for owners and admins only. Other roles get an empty answer with allowed set to false. */
export function usePay(enabled: boolean) {
  const [rates, setRates] = useState<Map<number, PayRate>>(new Map())
  const [available, setAvailable] = useState(true)
  const [allowed, setAllowed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const load = useCallback(async () => {
    if (!enabled) return
    try {
      const res = await fetch('/api/staff/pay', { cache: 'no-store' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.ok === false) throw new Error('Pay did not load.')
      const m = new Map<number, PayRate>()
      for (const r of (d.rates || []) as Record<string, unknown>[]) m.set(Number(r.staff_id), normalizePay(r))
      setRates(m)
      setAllowed(d.allowed === true)
      setAvailable(d.available !== false)
    } catch {
      setAllowed(false)
    } finally {
      setLoaded(true)
    }
  }, [enabled])
  useEffect(() => { void load() }, [load])
  return { rates, allowed, available, loaded, reload: load }
}

/**
 * Punches for one stretch of time, kept fresh: it reloads every 30 seconds while the tab is showing, when the
 * person comes back to the tab, and when another device changes the clock. `now` is the server's clock, so a
 * tablet with the wrong time still shows the right "clocked in since".
 */
export function useClock(range: { from: string; to: string } | null) {
  const from = range?.from || ''
  const to = range?.to || ''
  const key = `${from}|${to}`
  const [entries, setEntries] = useState<ClockEntry[]>([])
  const [loadedKey, setLoadedKey] = useState('')
  const [okKey, setOkKey] = useState('')
  const [breaks, setBreaks] = useState(false)
  const [segments, setSegments] = useState<JobSegment[]>([])
  const [jobTimeOn, setJobTimeOn] = useState(true)
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [approvalsOn, setApprovalsOn] = useState(true)
  const [error, setError] = useState('')
  const [offset, setOffset] = useState(0)
  const [tick, setTick] = useState(0)
  const seq = useRef(0)

  const load = useCallback(async () => {
    if (!from || !to) return
    const mine = ++seq.current
    try {
      const res = await fetch(`/api/timeclock?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&include=jobtime,approvals`, { cache: 'no-store' })
      const d = await res.json().catch(() => ({}))
      if (mine !== seq.current) return // a newer request is already on its way
      if (!res.ok || d.ok === false) throw new Error(d.error || 'The time clock did not load.')
      setEntries(((d.entries || []) as Record<string, unknown>[]).map(normalizeEntry))
      setBreaks(d.breaks === true)
      setJobTimeOn(!d.jobTime || d.jobTime.available !== false)
      setSegments(((d.jobTime?.segments || []) as Record<string, unknown>[]).map(normalizeSegment))
      setApprovalsOn(!d.approvals || d.approvals.available !== false)
      setApprovals(((d.approvals?.rows || []) as Record<string, unknown>[]).map(normalizeApproval))
      const server = Date.parse(String(d.now))
      if (!isNaN(server)) setOffset(server - Date.now())
      setError('')
      setOkKey(key)
    } catch (e) {
      if (mine !== seq.current) return
      setError(errText(e, 'The time clock did not load. Check your connection and try again.'))
    } finally {
      if (mine === seq.current) setLoadedKey(key)
    }
  }, [from, to, key])

  useEffect(() => {
    void load()
    const poll = setInterval(() => { if (document.visibilityState === 'visible') void load() }, 30_000)
    const back = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', back)
    window.addEventListener('focus', back)
    // Best effort: other devices' changes arrive at once. If this is not allowed, the 30 second refresh still covers it.
    const channel = supabase.channel(`timeclock_${key}`).on('postgres_changes', { event: '*', schema: 'public', table: 'timeclock' }, () => { void load() }).subscribe()
    return () => {
      clearInterval(poll)
      document.removeEventListener('visibilitychange', back)
      window.removeEventListener('focus', back)
      supabase.removeChannel(channel)
    }
  }, [load, key])

  useEffect(() => {
    setTick(Date.now())
    const t = setInterval(() => setTick(Date.now()), 30_000)
    return () => clearInterval(t)
  }, [])

  const act = useCallback(async (body: Record<string, unknown>) => {
    const r = await postJson('/api/timeclock', body)
    if (r.ok) await load()
    return r
  }, [load])

  return {
    entries,
    breaks,
    /** Time on repair orders for this range. Not available until the database update is applied. */
    segments,
    jobTimeOn,
    approvals,
    approvalsOn,
    error,
    loading: loadedKey !== key,
    /** True once this range has loaded at least once, so a later failed refresh can show old data with a warning. */
    ready: okKey === key,
    /** The server's idea of "now" in milliseconds, or 0 before the page has mounted. */
    now: tick ? tick + offset : 0,
    reload: load,
    act,
  }
}
