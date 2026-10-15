'use client'
import { useEffect, useRef, useState } from 'react'
import { addDays } from '@/lib/reports'
import type { Range } from '@/lib/reports'
import { normalizeEntry } from '@/lib/timeclock'
import type { ClockEntry } from '@/lib/timeclock'
import { chunks } from './useClocked'

const startOf = (k: string) => new Date(`${k}T00:00:00`).toISOString()

/** The punches in a range, read from the time clock (read only). `now` is the server's clock, so open shifts are counted to the right moment. */
export function useClockEntries(range: Range, enabled: boolean) {
  const [state, setState] = useState<{ key: string; entries: ClockEntry[]; now: number; error: string }>({ key: '', entries: [], now: 0, error: '' })
  const seq = useRef(0)
  const key = `${range.from}|${range.to}`
  const [tries, setTries] = useState(0)

  useEffect(() => {
    if (!enabled) return
    const mine = ++seq.current
    ;(async () => {
      try {
        const seen = new Map<number, ClockEntry>()
        let server = Date.now()
        for (const c of chunks(range)) {
          const res = await fetch(`/api/timeclock?from=${encodeURIComponent(startOf(c.from))}&to=${encodeURIComponent(startOf(addDays(c.to, 1)))}`, { cache: 'no-store' })
          const d = await res.json().catch(() => ({}))
          if (!res.ok || d.ok === false) throw new Error(d.error || 'The time clock did not load.')
          const t = Date.parse(String(d.now)); if (!isNaN(t)) server = t
          for (const raw of (d.entries || []) as Record<string, unknown>[]) { const e = normalizeEntry(raw); seen.set(e.id, e) }
        }
        if (mine !== seq.current) return
        setState({ key, entries: [...seen.values()], now: server, error: '' })
      } catch (e) {
        if (mine !== seq.current) return
        setState({ key, entries: [], now: Date.now(), error: e instanceof Error && e.message ? e.message : 'The time clock did not load.' })
      }
    })()
    const stop = () => { seq.current += 1 }
    return stop
  }, [enabled, key, range, tries])

  const current = state.key === key
  return { entries: current ? state.entries : [], now: state.now, error: current ? state.error : '', loading: enabled && !current, retry: () => setTries(n => n + 1) }
}
