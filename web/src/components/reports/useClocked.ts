'use client'
import { useEffect, useRef, useState } from 'react'
import { entryDay, normalizeEntry, workedMinutes } from '@/lib/timeclock'
import type { ClockEntry, Person } from '@/lib/timeclock'
import { addDays, diffDays, inRange, normTech, round2 } from '@/lib/reports'
import type { Range } from '@/lib/reports'

const CHUNK_DAYS = 90

const startOf = (k: string) => new Date(`${k}T00:00:00`).toISOString()

/** The range cut into pieces the time clock will answer (it refuses more than 100 days at once). */
export function chunks(r: Range): Range[] {
  const out: Range[] = []
  for (let from = r.from; from <= r.to; from = addDays(from, CHUNK_DAYS)) {
    const to = addDays(from, CHUNK_DAYS - 1)
    out.push({ from, to: to > r.to ? r.to : to })
  }
  return out
}

/** Hours on the time clock per person over the range, or null when it could not be read. */
export function useClocked(range: Range, people: Person[], enabled: boolean) {
  const [state, setState] = useState<{ key: string; hours: Map<string, number> | null; error: string }>({ key: '', hours: null, error: '' })
  const seq = useRef(0)
  const key = `${range.from}|${range.to}`
  const ready = enabled && people.length > 0

  useEffect(() => {
    if (!ready) return
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
        const hours = new Map<string, number>()
        const byId = new Map(people.map(p => [p.id, p]))
        const byName = new Map(people.map(p => [normTech(p.name), p]))
        for (const e of seen.values()) {
          if (!inRange(entryDay(e), range)) continue
          const who = (e.staff_id != null ? byId.get(e.staff_id) : undefined) || byName.get(normTech(e.staff_name))
          if (!who) continue
          hours.set(who.name, round2((hours.get(who.name) || 0) + workedMinutes(e, server) / 60))
        }
        setState({ key, hours, error: '' })
      } catch (e) {
        if (mine !== seq.current) return
        setState({ key, hours: null, error: e instanceof Error && e.message ? e.message : 'The time clock did not load.' })
      }
    })()
    const stop = () => { seq.current += 1 }
    return stop
  }, [ready, key, range, people])

  const current = state.key === key
  return { hours: current ? state.hours : null, error: current ? state.error : '', loading: ready && !current, days: diffDays(range.from, range.to) + 1 }
}
