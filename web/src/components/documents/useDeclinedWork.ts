'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { addDaysIso } from '@/lib/doc-approval'
import { SNOOZE_DAYS } from '@/lib/doc-screen'
import { getDeclinedWork, updateDeclinedWork } from './api'
import type { DeclinedWork } from './api'

/**
 * The jobs customers said no to, kept for later. Loads once when enabled, and keeps the three answers the sheet gives:
 * put it off for 30 days, dismiss it, or mark it handled once a new estimate for it has been saved. Nothing here sends a
 * message to a customer. A list that failed to load says so; it never looks like an empty one.
 */
export function useDeclinedWork(enabled: boolean, today: () => string) {
  const [work, setWork] = useState<DeclinedWork[] | null>(null)
  const [available, setAvailable] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const alive = useRef(true)

  const load = useCallback(async () => {
    const r = await getDeclinedWork()
    if (!alive.current) return
    if (!r.ok) { setError(r.error || 'Declined work did not load. Try again.'); return }
    setError('')
    setAvailable(r.data.available !== false)
    setWork(Array.isArray(r.data.work) ? r.data.work : [])
  }, [])

  useEffect(() => {
    alive.current = true
    if (enabled) void load()
    return () => { alive.current = false }
  }, [enabled, load])

  const change = useCallback(async (w: DeclinedWork, body: { status: string; remindAfter?: string; note?: string }, done: (rows: DeclinedWork[]) => DeclinedWork[]) => {
    setBusyId(w.id); setError('')
    const r = await updateDeclinedWork({ id: w.id, ...body })
    if (!alive.current) return
    setBusyId(null)
    if (!r.ok) { setError(`That was not saved. ${r.error}`); return }
    setWork(rows => (rows ? done(rows) : rows))
  }, [])

  const snooze = useCallback((w: DeclinedWork) => {
    const remindAfter = addDaysIso(today(), SNOOZE_DAYS)
    return change(w, { status: 'reminded', remindAfter }, rows => rows.map(x => (x.id === w.id ? { ...x, status: 'reminded', remind_after: remindAfter } : x)))
  }, [change, today])

  const dismiss = useCallback((w: DeclinedWork) => change(w, { status: 'dismissed' }, rows => rows.filter(x => x.id !== w.id)), [change])

  /** A new estimate for this job was saved. It leaves the list, with a note of which estimate. */
  const handled = useCallback(async (id: string, note: string) => {
    const r = await updateDeclinedWork({ id, status: 'booked', note })
    if (!alive.current) return
    if (r.ok) setWork(rows => (rows ? rows.filter(x => x.id !== id) : rows))
  }, [])

  const count = available && work ? work.length : null
  return { work, available, error, busyId, count, load, snooze, dismiss, handled }
}
