'use client'
import { useEffect, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import { carLine, dueInfo, roShort, statusLamp, statusWord } from '@/components/jobs/types'
import { wallCustomer } from '@/lib/shopboard'
import type { WallColumn } from '@/lib/shopboard'
import type { BoardJob } from './types'

/** Asks the browser for the whole screen. Phones and some TVs say no; the wall still fills the window then. */
export async function enterFullScreen(): Promise<void> {
  try { await document.documentElement.requestFullscreen?.() } catch { /* the wall covers the window instead */ }
}

const clockText = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
const dateText = (ms: number) => new Date(ms).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })

type WakeLockLike = { release: () => Promise<void> }

/**
 * The shop wall: every open car in a column per technician, in large type, for a TV. It only looks. Nothing here saves,
 * and the customer's name stays off unless the shop turned it on.
 */
export default function ShopWall({ columns, idle, todayKey, showNames, seconds, updatedAt, error, total, ready, late, onExit }: {
  columns: WallColumn<BoardJob>[]
  /** Technicians with no cars, named at the bottom instead of drawn as empty columns. */
  idle: string[]
  todayKey: string
  showNames: boolean
  seconds: number
  /** When the cars last loaded, in ms. 0 before the first load. */
  updatedAt: number
  /** A sentence when the last refresh failed, so the screen says its numbers may be old. */
  error: string
  total: number
  ready: number
  late: number
  onExit: () => void
}) {
  const [now, setNow] = useState(() => Date.now())
  const exitRef = useRef(onExit)
  useEffect(() => { exitRef.current = onExit })

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000)
    return () => clearInterval(t)
  }, [])

  // Escape leaves. In full screen the browser keeps Escape for itself, so the fullscreen change below covers that.
  useEffect(() => {
    let sawFullScreen = !!document.fullscreenElement
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') exitRef.current() }
    const onFs = () => {
      if (document.fullscreenElement) sawFullScreen = true
      else if (sawFullScreen) exitRef.current()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('fullscreenchange', onFs)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('fullscreenchange', onFs)
      document.body.style.overflow = overflow
      if (document.fullscreenElement) void document.exitFullscreen?.().catch(() => {})
    }
  }, [])

  // A TV that goes to sleep is no use as a wall. Ask the screen to stay on, and ask again if the tab was hidden and came back.
  useEffect(() => {
    let lock: WakeLockLike | null = null
    let gone = false
    const hold = async () => {
      try {
        const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<WakeLockLike> } }).wakeLock
        if (!wl || document.visibilityState !== 'visible') return
        const got = await wl.request('screen')
        if (gone) { void got.release().catch(() => {}); return }
        lock = got
      } catch { /* not allowed here; the TV's own sleep setting applies */ }
    }
    const back = () => { if (document.visibilityState === 'visible' && !lock) void hold() }
    void hold()
    document.addEventListener('visibilitychange', back)
    return () => {
      gone = true
      document.removeEventListener('visibilitychange', back)
      void lock?.release().catch(() => {})
    }
  }, [])

  const summary = [
    `${total} ${total === 1 ? 'car' : 'cars'} in the shop`,
    ready > 0 ? `${ready} ready for pickup` : '',
    late > 0 ? `${late} late` : '',
  ].filter(Boolean).join(' · ')

  return (
    <div role="dialog" aria-modal="true" aria-label="Shop wall" className="fixed inset-0 z-[65] flex flex-col overflow-y-auto bg-bg-base text-text-primary">
      <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-border px-5 py-4 2xl:px-10 2xl:py-6">
        <div className="min-w-0">
          <h1 className="font-display text-[1.75rem] font-bold leading-none 2xl:text-[2.75rem]">Shop board</h1>
          <p className="num mt-1.5 text-[1.0625rem] text-text-secondary 2xl:text-[1.5rem]" aria-live="polite">{summary}</p>
        </div>
        <div className="flex items-center gap-5">
          <div className="text-right">
            <p className="num font-display text-[1.75rem] font-bold leading-none 2xl:text-[2.75rem]">{clockText(now)}</p>
            <p className="mt-1.5 text-[1.0625rem] text-text-secondary 2xl:text-[1.5rem]">{dateText(now)}</p>
          </div>
          <button type="button" className="btn btn-secondary" onClick={onExit}>
            <Icon name="compress" className="h-5 w-5" />Close the wall
          </button>
        </div>
      </header>

      {error && (
        <p role="alert" className="flex items-center gap-2 border-b border-border bg-bg-chrome px-5 py-2.5 text-[1.0625rem] font-bold text-amber 2xl:px-10 2xl:text-[1.25rem]">
          <Icon name="alert" className="h-5 w-5 shrink-0" />
          {error}{updatedAt > 0 ? ` These cars are from ${clockText(updatedAt)}.` : ''}
        </p>
      )}

      <main className="flex-1 px-5 py-5 2xl:px-10 2xl:py-8">
        {columns.length === 0 ? (
          <div className="grid min-h-[50vh] place-items-center text-center">
            <div>
              <Icon name="board" className="mx-auto mb-4 h-12 w-12 text-text-muted" />
              <p className="text-[1.5rem] font-bold 2xl:text-[2.25rem]">No cars in the shop right now</p>
              <p className="mt-2 text-[1.0625rem] text-text-secondary 2xl:text-[1.5rem]">Cars show here as soon as they are written up.</p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(min(100%,19rem),1fr))] 2xl:gap-6 2xl:[grid-template-columns:repeat(auto-fit,minmax(min(100%,26rem),1fr))]">
            {columns.map(col => (
              <section key={col.key} aria-label={`${col.name}, ${col.jobs.length} ${col.jobs.length === 1 ? 'car' : 'cars'}`} className="min-w-0 rounded-lg border border-border bg-bg-chrome/50 p-3 2xl:p-4">
                <div className="mb-3 flex items-center justify-between gap-3 px-1">
                  <h2 className="min-w-0 truncate text-[1.375rem] font-bold leading-tight 2xl:text-[2rem]">{col.name}</h2>
                  <span className="num shrink-0 rounded-full border border-border bg-bg-card px-3 py-0.5 text-[1.125rem] font-bold 2xl:px-4 2xl:text-[1.5rem]">{col.jobs.length}</span>
                </div>
                <div className="space-y-3">
                  {col.jobs.map(j => {
                    const lamp = statusLamp(j.status)
                    const who = wallCustomer(j.customer_name, showNames)
                    const due = dueInfo(j, todayKey)
                    return (
                      <div key={j.id} className={`rotag lamp-${lamp} !pb-3`}>
                        <span className="flex items-start justify-between gap-3">
                          <span className="min-w-0 break-words text-[1.25rem] font-bold leading-snug 2xl:text-[1.875rem]">{carLine(j) || 'No vehicle noted'}</span>
                          {j.ro_number && <span className="num shrink-0 whitespace-nowrap text-[1rem] text-text-secondary 2xl:text-[1.5rem]">{roShort(j.ro_number)}</span>}
                        </span>
                        {who && <span className="mt-0.5 block text-[1.0625rem] text-text-secondary 2xl:text-[1.5rem]">{who}</span>}
                        {j.concern && <span className="mt-1 line-clamp-2 block text-[1.0625rem] 2xl:text-[1.5rem]">{j.concern}</span>}
                        <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                          <span className="flex items-center gap-2 text-[1.0625rem] font-bold 2xl:text-[1.5rem]">
                            <span className={`lamp lamp-${lamp} !h-3 !w-3 2xl:!h-4 2xl:!w-4`} aria-hidden="true" />{statusWord(j.status)}
                          </span>
                          {due && (
                            <span className={`inline-flex items-center gap-1.5 text-[1.0625rem] 2xl:text-[1.5rem] ${due.tone === 'late' ? 'font-bold text-red' : due.tone === 'soon' ? 'font-bold text-amber' : 'text-text-secondary'}`}>
                              {due.tone === 'late' && <Icon name="alert" className="h-5 w-5" />}{due.text}
                            </span>
                          )}
                          {(j.priority === 'Rush' || j.priority === 'High') && <span className="tag tag-red">{j.priority === 'Rush' ? 'Rush' : 'High priority'}</span>}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </main>

      <footer className="flex flex-wrap items-center justify-between gap-x-6 gap-y-1 border-t border-border px-5 py-3 text-[1rem] text-text-secondary 2xl:px-10 2xl:py-4 2xl:text-[1.25rem]">
        <span className="min-w-0">{idle.length > 0 ? `No cars right now: ${idle.join(', ')}.` : ''}</span>
        <span className="num">
          {updatedAt > 0 ? `Updated ${clockText(updatedAt)}` : 'Loading'} · refreshes every {seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60} ${seconds === 60 ? 'minute' : 'minutes'}` : `${seconds} seconds`}
        </span>
      </footer>
    </div>
  )
}
