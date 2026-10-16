'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { flowFrom } from '@/lib/jobflow'
import type { JobFlow } from '@/lib/jobflow'

/**
 * The board extras for every car (parts, labels, hours, promised time), kept beside the repair orders and refreshed with them.
 * `available` is false when the database update that holds them is not in place: the board then shows what it always showed.
 */
export function useJobFlows(everyMs = 60_000) {
  const [flows, setFlows] = useState<Map<string, JobFlow>>(() => new Map())
  const [available, setAvailable] = useState<boolean | null>(null)
  const [error, setError] = useState('')
  const seq = useRef(0)
  /** Saves in flight: a refresh that lands during one would flash the old values. */
  const busy = useRef(0)

  const reload = useCallback(async () => {
    const mine = ++seq.current
    try {
      const res = await fetch('/api/jobflow', { cache: 'no-store' })
      const d = await res.json().catch(() => ({})) as Record<string, unknown>
      if (mine !== seq.current || busy.current > 0) return
      if (!res.ok || d.ok !== true) { setError(typeof d.error === 'string' ? d.error : 'The parts, labels and hours did not load.'); return }
      setAvailable(d.available !== false)
      const rows = Array.isArray(d.flows) ? d.flows as Record<string, unknown>[] : []
      setFlows(new Map(rows.map(r => { const f = flowFrom(r); return [f.job_id, f] as const })))
      setError('')
    } catch {
      if (mine === seq.current) setError('The parts, labels and hours did not load. Check your connection.')
    }
  }, [])

  useEffect(() => {
    void reload()
    const back = () => { if (document.visibilityState === 'visible') void reload() }
    document.addEventListener('visibilitychange', back)
    window.addEventListener('focus', back)
    const poll = setInterval(back, everyMs)
    return () => {
      document.removeEventListener('visibilitychange', back)
      window.removeEventListener('focus', back)
      clearInterval(poll)
    }
  }, [reload, everyMs])

  /** Put one saved copy in place right away. */
  const put = useCallback((f: JobFlow) => setFlows(m => { const n = new Map(m); n.set(f.job_id, f); return n }), [])
  const hold = useCallback((on: boolean) => { busy.current += on ? 1 : -1 }, [])

  return { flows, available, error, reload, put, hold }
}
