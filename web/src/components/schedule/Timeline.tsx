'use client'
import { useEffect, useRef, useState } from 'react'
import { byTime, endOf, firstName, fmtTime, fmtTimeShort, initials, layoutLanes, statusLamp, statusWord, toMin, fromMin } from './types'
import type { Appointment } from './types'

export interface TimelineColumn {
  key: string
  /** Heading, such as "Mon 13" or a tech's name. */
  label: string
  sub?: string
  date: string
  tech?: string
  isToday: boolean
  items: Appointment[]
}

const HOUR = 60 // px per hour
const GUTTER = 56 // px for the hour labels

function hourLabel(h: number) {
  return `${h % 12 || 12} ${h >= 12 ? 'PM' : 'AM'}`
}

/**
 * Hours down the side, one column per day (week view) or per tech (day board).
 * Tap an appointment to open it. Tap an empty spot to book that time.
 */
export default function Timeline({ columns, onOpen, onSlot }: {
  columns: TimelineColumn[]
  onOpen: (a: Appointment) => void
  onSlot: (date: string, mins: number, tech?: string) => void
}) {
  const all = columns.flatMap(c => c.items)
  const startH = Math.min(7, ...all.map(a => Math.floor(toMin(a.time) / 60)))
  const endH = Math.max(18, ...all.map(a => Math.ceil(endOf(a) / 60)))
  const hours = Array.from({ length: endH - startH }, (_, i) => startH + i)
  const height = hours.length * HOUR
  const [nowMin, setNowMin] = useState<number | null>(null)
  const [width, setWidth] = useState(0)
  const scroller = useRef<HTMLDivElement>(null)

  // Measure the grid so each card can choose a layout that fits its real width.
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const read = () => setWidth(el.clientWidth)
    read()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(read)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const tick = () => { const d = new Date(); setNowMin(d.getHours() * 60 + d.getMinutes()) }
    tick()
    const t = setInterval(tick, 60_000)
    return () => clearInterval(t)
  }, [])

  const minCol = columns.length > 5 ? 112 : 150
  const colPx = Math.max(minCol, (width - GUTTER) / columns.length)
  const cols = `${GUTTER}px repeat(${columns.length}, minmax(${minCol}px, 1fr))`

  return (
    <div ref={scroller} className="overflow-x-auto rounded-md border border-border bg-bg-card" role="region" aria-label="Schedule grid" tabIndex={0}>
      <div style={{ minWidth: GUTTER + columns.length * minCol }}>
        {/* column headings */}
        <div className="sticky top-0 z-10 grid border-b border-border bg-bg-chrome" style={{ gridTemplateColumns: cols }}>
          <div />
          {columns.map(c => (
            <div key={c.key} className={`border-l border-border px-2 py-2 text-center ${c.isToday ? 'bg-blue/10' : ''}`}>
              <p className={`text-[0.9375rem] font-bold leading-tight ${c.isToday ? 'text-blue' : ''}`}>{c.label}</p>
              {c.sub && <p className="num text-[0.8125rem] text-text-secondary">{c.sub}</p>}
            </div>
          ))}
        </div>

        {/* body */}
        <div className="relative grid" style={{ gridTemplateColumns: cols, height }}>
          <div className="relative">
            {hours.map((h, i) => (
              <span key={h} className="num absolute right-2 -translate-y-1/2 text-[0.75rem] text-text-secondary" style={{ top: i * HOUR + (i === 0 ? 8 : 0) }}>{hourLabel(h)}</span>
            ))}
          </div>
          {columns.map(c => {
            const lanes = layoutLanes(c.items)
            return (
              <div
                key={c.key}
                className={`relative border-l border-border ${c.isToday ? 'bg-blue/[0.04]' : ''}`}
                onClick={e => {
                  if (e.target !== e.currentTarget) return
                  const rect = e.currentTarget.getBoundingClientRect()
                  const mins = Math.floor(((e.clientY - rect.top) / HOUR) * 2) * 30 + startH * 60
                  onSlot(c.date, mins, c.tech)
                }}
                role="presentation"
              >
                {hours.map((h, i) => (
                  <div key={h} className="pointer-events-none absolute inset-x-0 border-t border-border/70" style={{ top: i * HOUR }} />
                ))}
                {hours.map((h, i) => (
                  <div key={`h${h}`} className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border/40" style={{ top: i * HOUR + HOUR / 2 }} />
                ))}
                {[...c.items].sort(byTime).map(a => {
                  const L = lanes.get(a.id) || { lane: 0, lanes: 1 }
                  const top = ((toMin(a.time) - startH * 60) / 60) * HOUR
                  const h = Math.max(30, ((endOf(a) - toMin(a.time)) / 60) * HOUR - 2)
                  const lamp = statusLamp(a.status)
                  const closed = a.status === 'Cancelled' || a.status === 'No Show'
                  const lanePx = colPx / L.lanes
                  const tiny = lanePx < 56 // only initials fit; the hover text and the detail sheet carry the rest
                  const tight = lanePx < 96 // first name and a bare time are all that fit
                  const oneLine = h < 46 // too short for two lines, so time and name share one
                  const who = tight ? firstName(a.customer_name) : a.customer_name
                  const when = tight ? fmtTimeShort(a.time) : fmtTime(a.time)
                  const full = `${fmtTime(a.time)} to ${fmtTime(fromMin(endOf(a)))}, ${a.customer_name}${a.service ? `, ${a.service}` : ''}, ${statusWord(a.status)}`
                  return (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => onOpen(a)}
                      title={full}
                      className={`lamp-${lamp} absolute overflow-hidden rounded-md border border-line border-l-[5px] border-l-[rgb(var(--lamp))] bg-bg-card px-1.5 py-1 text-left hover:bg-bg-hover focus-visible:z-20 ${closed ? 'opacity-60' : ''}`}
                      style={{ top, height: h, left: `calc(${(L.lane / L.lanes) * 100}% + 2px)`, width: `calc(${100 / L.lanes}% - 4px)` }}
                      aria-label={full}
                    >
                      {tiny ? (
                        <span className={`block truncate text-center text-[0.8125rem] font-bold leading-tight ${closed ? 'line-through' : ''}`}>{initials(a.customer_name)}</span>
                      ) : oneLine ? (
                        <span className={`block truncate text-[0.875rem] leading-tight ${closed ? 'line-through' : ''}`}>
                          <span className="num text-[0.75rem] text-text-secondary">{when}</span>{' '}
                          <span className="font-bold">{who}</span>
                        </span>
                      ) : (
                        <>
                          <span className="num block truncate text-[0.75rem] leading-tight text-text-secondary">{when}</span>
                          <span className={`block truncate ${tight ? 'text-[0.8125rem]' : 'text-[0.875rem]'} font-bold leading-tight ${closed ? 'line-through' : ''}`}>{who}</span>
                          {h > 52 && a.service && <span className="block truncate text-[0.8125rem] leading-tight text-text-secondary">{a.service}</span>}
                          {h > 74 && !tight && <span className="block truncate text-[0.8125rem] leading-tight text-text-secondary">{statusWord(a.status)}</span>}
                        </>
                      )}
                    </button>
                  )
                })}
                {c.isToday && nowMin !== null && nowMin >= startH * 60 && nowMin <= endH * 60 && (
                  <div className="pointer-events-none absolute inset-x-0 z-10 flex items-center" style={{ top: ((nowMin - startH * 60) / 60) * HOUR }} aria-hidden="true">
                    <span className="h-2.5 w-2.5 -ml-1 rounded-full bg-red" />
                    <span className="h-0.5 flex-1 bg-red" />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
