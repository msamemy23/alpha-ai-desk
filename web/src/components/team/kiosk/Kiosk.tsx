'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import Sheet from '@/components/Sheet'
import { ErrorCard, SearchField } from '@/components/ListKit'
import { fmtTimeOfDay } from '@/lib/timeclock'
import type { KioskPerson, KioskRoster } from '@/lib/kiosk-types'
import { Avatar } from '../parts'
import KioskPanel from './KioskPanel'
import type { KioskCall, KioskReply } from './KioskPanel'

const lampOf = (p: KioskPerson): 'green' | 'amber' | 'off' | 'red' => (p.needs_fix ? 'red' : p.state === 'in' ? 'green' : p.state === 'break' ? 'amber' : 'off')

function stateWords(p: KioskPerson): string {
  if (p.needs_fix) return 'Needs a manager'
  if (p.state === 'out') return 'Clocked out'
  const t = p.since ? fmtTimeOfDay(p.since) : ''
  return p.state === 'break' ? `On break since ${t}` : `In since ${t}`
}

/** The shop tablet: everyone on the team, tap a name, enter a PIN, clock in or out, take a break or start a repair order. */
export default function Kiosk() {
  const [roster, setRoster] = useState<KioskRoster | null>(null)
  const [error, setError] = useState('')
  const [stale, setStale] = useState(false)
  const [offset, setOffset] = useState(0)
  const [tick, setTick] = useState(0)
  const [q, setQ] = useState('')
  const [openId, setOpenId] = useState<number | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/timeclock/kiosk', { cache: 'no-store' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.ok === false) throw new Error(res.status === 401 ? 'This tablet was signed out. Sign in again.' : d.error || 'The team did not load.')
      setRoster(d as KioskRoster)
      const server = Date.parse(String(d.now))
      if (!isNaN(server)) setOffset(server - Date.now())
      setError(''); setStale(false)
    } catch (e) {
      const msg = e instanceof Error && e.message ? e.message : 'The team did not load. Check the connection and try again.'
      // With a roster already on screen, a failed refresh is a warning; with none, it is the whole screen.
      setStale(true); setError(msg)
    }
  }, [])

  useEffect(() => {
    void load()
    const poll = setInterval(() => { if (document.visibilityState === 'visible' && openId === null) void load() }, 20_000)
    const back = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', back)
    window.addEventListener('focus', back)
    return () => { clearInterval(poll); document.removeEventListener('visibilitychange', back); window.removeEventListener('focus', back) }
  }, [load, openId])

  useEffect(() => {
    setTick(Date.now())
    const t = setInterval(() => setTick(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [])

  const call: KioskCall = useCallback(async body => {
    let res: Response
    try {
      res = await fetch('/api/timeclock/kiosk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    } catch {
      return { ok: false, status: 0, error: 'No connection. Check the internet and try again.' }
    }
    const d = (await res.json().catch(() => ({}))) as Partial<KioskReply>
    if (!res.ok || d.ok === false) {
      return { ok: false, status: res.status, code: d.code, error: d.error || (res.status === 401 ? 'This tablet was signed out. Sign in again.' : 'That did not work. Try again.') }
    }
    return { ...d, ok: true, status: res.status }
  }, [])

  const now = tick ? tick + offset : 0
  const people = useMemo(() => {
    const list = roster ? roster.people : []
    const needle = q.trim().toLowerCase()
    return needle ? list.filter(p => p.name.toLowerCase().includes(needle)) : list
  }, [roster, q])
  const open = roster && openId !== null ? roster.people.find(p => p.id === openId) || null : null
  const inCount = roster ? roster.people.filter(p => p.state !== 'out' && !p.needs_fix).length : 0

  const patch = (p: KioskPerson | null) => {
    if (!p) return
    setRoster(r => (r ? { ...r, people: r.people.map(x => (x.id === p.id ? p : x)) } : r))
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-[1100px] px-4 py-5 sm:px-8 sm:py-8">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="page-title">{roster && roster.shopName ? roster.shopName : 'Shop clock'}</h1>
          <p className="page-subtitle num" aria-live="polite">
            {!roster ? 'Loading…' : roster.people.length === 0 ? 'No one on the team yet' : `${inCount} of ${roster.people.length} clocked in`}
            {now > 0 ? ` · ${new Date(now).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : ''}
          </p>
        </div>
        <a href="/staff" className="btn btn-ghost btn-sm"><Icon name="back" className="h-4 w-4" />Back to Team</a>
      </header>

      {error && roster && stale && (
        <p role="alert" className="mb-4 flex flex-wrap items-center gap-2 rounded-md border border-amber/50 bg-amber/[0.10] px-3 py-2.5 text-[0.9375rem]">
          <Icon name="wifiOff" className="h-5 w-5 shrink-0 text-amber" />
          <span className="min-w-0 flex-1">{error} What you see may be out of date.</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void load()}>Try again</button>
        </p>
      )}

      {!roster && error ? (
        <ErrorCard title="The shop clock did not load" message={error} onRetry={() => void load()} />
      ) : !roster ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true" aria-label="Loading the team">{[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="skeleton h-24" />)}</div>
      ) : roster.people.length === 0 ? (
        <div className="empty-state">
          <Icon name="staff" className="mx-auto mb-3 h-8 w-8 text-text-muted" />
          <p className="font-bold text-text-primary">No one is on the team yet</p>
          <p className="mx-auto mt-1 max-w-md">Add people in Team, People. Then they can clock in here.</p>
          <a href="/staff" className="btn btn-primary mt-4">Go to Team</a>
        </div>
      ) : (
        <>
          {roster.people.length > 8 && <SearchField className="mb-4 sm:max-w-sm" value={q} onChange={setQ} label="Find your name" placeholder="Find your name" />}
          {people.length === 0 ? (
            <p className="rounded-md border border-dashed border-border px-3 py-8 text-center text-text-secondary">No one with that name.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Team">
              {people.map(p => (
                <li key={p.id}>
                  <button type="button" onClick={() => setOpenId(p.id)} className="flex h-full min-h-[88px] w-full items-center gap-4 rounded-lg border border-border bg-bg-card px-4 py-3 text-left hover:bg-bg-hover">
                    <Avatar name={p.name} size={52} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[1.125rem] font-bold">{p.name}</span>
                      <span className="flex items-center gap-1.5 text-[0.9375rem] text-text-secondary"><span className={`lamp lamp-${lampOf(p)} shrink-0`} aria-hidden="true" /><span className="num min-w-0 truncate">{stateWords(p)}</span></span>
                      {p.job && p.state === 'in' && <span className="mt-0.5 block truncate text-[0.875rem]">On {p.job.label}</span>}
                    </span>
                    <Icon name="chevronRight" className="h-5 w-5 shrink-0 text-text-muted" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <Sheet open={!!open} onClose={() => setOpenId(null)} title={open ? open.name : 'Shop clock'} hideTitle>
        {open && roster && (
          <KioskPanel key={open.id} person={open} roster={roster} nowMs={now} call={call} onChanged={patch} onClose={() => { setOpenId(null); void load() }} />
        )}
      </Sheet>
    </main>
  )
}
