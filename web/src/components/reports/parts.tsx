'use client'
import Link from 'next/link'
import { useId, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent, ReactNode } from 'react'
import { niceEven, niceMax } from '@/lib/reports'
import type { Bucket, Change } from '@/lib/reports'

/** A titled box. `right` holds a button or a short figure for the header. */
export function Block({ title, right, children, className = '' }: { title: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-header">
        <h2 className="section-title">{title}</h2>
        {right}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  )
}

/** Up, down or same, said in words and paired with a lamp. `goodWhen` says which direction is the good news for this figure. */
export function DeltaLine({ change, vs, goodWhen = 'up' }: { change: Change; vs: string; goodWhen?: 'up' | 'down' }) {
  if (change.kind === 'none') return <p className="mt-1 text-[0.875rem] text-text-muted">Nothing {vs} to compare with</p>
  const good = change.kind === 'same' ? null : (change.kind === 'up') === (goodWhen === 'up')
  const lamp = change.kind === 'same' ? 'off' : good ? 'green' : 'amber'
  const words = change.kind === 'same' ? `Same as ${vs}` : `${change.kind === 'up' ? 'Up' : 'Down'} ${change.pct}% from ${vs}`
  return (
    <p className="mt-1 flex items-start gap-1.5 text-[0.875rem] font-bold leading-snug text-text-secondary">
      <span className={`lamp lamp-${lamp} mt-[0.2rem] shrink-0`} aria-hidden="true" />
      {words}
    </p>
  )
}

/** One headline figure. */
export function Kpi({ label, value, note, children }: { label: string; value: string; note?: string; children?: ReactNode }) {
  return (
    <div className="card !p-4">
      <p className="text-[0.9375rem] font-bold text-text-secondary">{label}</p>
      <p className="display num mt-1 text-[1.75rem] font-bold leading-tight text-text-primary">{value}</p>
      {note && <p className="mt-0.5 text-[0.875rem] text-text-secondary">{note}</p>}
      {children}
    </div>
  )
}

export function KpiSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3" aria-busy="true" role="status" aria-label="Loading figures">
      {Array.from({ length: count }, (_, i) => <div key={i} className="skeleton h-[6.5rem]" />)}
    </div>
  )
}

function pickLabels(n: number, short: boolean): Set<number> {
  const out = new Set<number>()
  if (n <= 8) { for (let i = 0; i < n; i++) out.add(i); return out }
  // Short labels ("9a") fit more of them across a phone than long ones ("Sep 15").
  const want = short ? 6 : 4
  for (let i = 0; i < want; i++) out.add(Math.round((i * (n - 1)) / (want - 1)))
  return out
}

/**
 * A bar chart made of plain elements. Hover, touch-and-drag, or the arrow keys read one bar at a time; a hidden table
 * carries the same numbers for a screen reader.
 */
export function BarChart({ buckets, format, what, unit = '', height = 176, highlight, whole = false, labelEvery }: {
  buckets: Bucket[]
  format: (n: number) => string
  /** What the bars show, e.g. "Money collected". */
  what: string
  unit?: string
  height?: number
  /** Index drawn in blue when nothing is selected (for example the busiest hour). */
  highlight?: number
  /** The bars count whole things (calls), so the scale uses whole numbers only. */
  whole?: boolean
  /** Label every Nth bar (for hours: 4 gives 12a, 4a, 8a and so on) instead of spreading labels evenly. */
  labelEvery?: number
}) {
  const id = useId()
  const [pick, setPick] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const n = buckets.length
  const max = useMemo(() => {
    const peak = Math.max(0, ...buckets.map(b => b.value))
    if (!whole) return niceMax(peak)
    return niceEven(peak)
  }, [buckets, whole])
  const total = useMemo(() => buckets.reduce((s, b) => s + b.value, 0), [buckets])
  const best = useMemo(() => buckets.reduce((bi, b, i) => (b.value > (buckets[bi]?.value ?? -1) ? i : bi), 0), [buckets])
  const labels = useMemo(() => {
    if (labelEvery) { const s = new Set<number>(); for (let i = 0; i < n; i += labelEvery) s.add(i); return s }
    return pickLabels(n, buckets.every(b => b.label.length <= 3))
  }, [n, buckets, labelEvery])
  const sel = pick !== null && pick < n ? pick : null
  const shown = sel ?? (highlight !== undefined && highlight < n ? highlight : null)

  const at = (e: PointerEvent<HTMLDivElement>) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r || r.width <= 0) return
    setPick(Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n))))
  }
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const cur = sel ?? (e.key === 'ArrowLeft' ? n : -1)
    let next: number | null = null
    if (e.key === 'ArrowRight') next = Math.min(n - 1, cur + 1)
    else if (e.key === 'ArrowLeft') next = Math.max(0, cur - 1)
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = n - 1
    else if (e.key === 'Escape') { setPick(null); return }
    if (next !== null) { e.preventDefault(); setPick(next) }
  }

  const readout = sel !== null
    ? <><span className="font-bold text-text-primary">{buckets[sel].title}</span><span className="num ml-2 font-bold text-blue">{format(buckets[sel].value)}{unit}</span></>
    : total > 0
      ? <><span className="text-text-secondary">Total </span><span className="num font-bold text-text-primary">{format(total)}{unit}</span><span className="text-text-secondary">. Best: {buckets[best].title}, </span><span className="num font-bold text-text-primary">{format(buckets[best].value)}{unit}</span></>
      : <span className="text-text-secondary">Nothing to show for this period</span>

  return (
    <div>
      <p className="mb-3 min-h-[1.5rem] text-[0.9375rem]" aria-live="polite">{readout}</p>
      <div className="flex gap-2">
        <div className="relative w-12 shrink-0 text-right text-[0.8125rem] text-text-muted num" style={{ height }} aria-hidden="true">
          <span className="absolute right-0 top-0 -translate-y-1/2">{format(max)}</span>
          <span className="absolute right-0 top-1/2 -translate-y-1/2">{format(max / 2)}</span>
          <span className="absolute bottom-0 right-0 translate-y-1/2">{format(0)}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div
            ref={ref}
            tabIndex={0}
            role="group"
            aria-label={`${what}. Use the left and right arrow keys to read one bar at a time.`}
            aria-describedby={`${id}-table`}
            className="relative rounded-sm outline-offset-4"
            style={{ height, touchAction: 'pan-y' }}
            onPointerDown={at}
            onPointerMove={e => { if (e.pointerType === 'mouse' || e.buttons) at(e) }}
            onPointerLeave={e => { if (e.pointerType === 'mouse') setPick(null) }}
            onBlur={() => setPick(null)}
            onKeyDown={key}
          >
            <div className="pointer-events-none absolute inset-0" aria-hidden="true">
              <div className="absolute inset-x-0 top-0 border-t border-border" />
              <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-border" />
              <div className="absolute inset-x-0 bottom-0 border-t border-line" />
            </div>
            <div className="pointer-events-none absolute inset-0 flex items-end gap-[2px]" aria-hidden="true">
              {buckets.map((b, i) => (
                <div key={b.key} className="flex h-full min-w-0 flex-1 items-end">
                  <div
                    className={`w-full rounded-t-[2px] ${i === shown ? 'bg-blue' : 'bg-text-primary/30'}`}
                    style={{ height: b.value > 0 ? `max(2px, ${(b.value / max) * 100}%)` : 0 }}
                  />
                </div>
              ))}
            </div>
          </div>
          <div className="relative mt-1.5 h-5 text-[0.8125rem] text-text-muted" aria-hidden="true">
            {buckets.map((b, i) => labels.has(i) && (
              <span
                key={b.key}
                className="absolute top-0 whitespace-nowrap"
                style={{ left: `${((i + 0.5) / n) * 100}%`, transform: i === 0 ? 'none' : i === n - 1 && !labelEvery ? 'translateX(-100%)' : 'translateX(-50%)', ...(i === 0 ? { left: 0 } : {}) }}
              >{b.label}</span>
            ))}
          </div>
        </div>
      </div>
      <table id={`${id}-table`} className="sr-only">
        <caption>{what}</caption>
        <thead><tr><th scope="col">When</th><th scope="col">Amount</th></tr></thead>
        <tbody>{buckets.map(b => <tr key={b.key}><th scope="row">{b.title}</th><td>{format(b.value)}{unit}</td></tr>)}</tbody>
      </table>
    </div>
  )
}

export interface RankRow { key: string; label: string; value: number; shown: string; sub?: string; href?: string }

/** A short ranked list with a quiet bar behind each figure. */
export function Rank({ rows, empty }: { rows: RankRow[]; empty: string }) {
  const top = Math.max(0, ...rows.map(r => r.value))
  if (!rows.length) return <p className="text-text-secondary">{empty}</p>
  return (
    <ul className="divide-y divide-border">
      {rows.map(r => {
        const inner = (
          <>
            <span className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate font-bold text-text-primary">{r.label}</span>
              <span className="num shrink-0 font-bold text-text-primary">{r.shown}</span>
            </span>
            <span className="mt-1.5 block h-1.5 rounded-full bg-text-primary/10" aria-hidden="true">
              <span className="block h-full rounded-full bg-text-primary/40" style={{ width: top > 0 ? `${Math.max(2, (r.value / top) * 100)}%` : 0 }} />
            </span>
            {r.sub && <span className="mt-1 block text-[0.875rem] text-text-secondary">{r.sub}</span>}
          </>
        )
        return (
          <li key={r.key}>
            {r.href
              ? <Link href={r.href} className="block min-h-[44px] py-2.5 hover:bg-bg-hover">{inner}</Link>
              : <div className="py-2.5">{inner}</div>}
          </li>
        )
      })}
    </ul>
  )
}

/** A label and a figure on one line. */
export function Line({ label, value, strong = false }: { label: ReactNode; value: ReactNode; strong?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 py-2 ${strong ? 'border-t border-line font-bold' : ''}`}>
      <span className={strong ? 'text-text-primary' : 'text-text-secondary'}>{label}</span>
      <span className="num font-bold text-text-primary">{value}</span>
    </div>
  )
}
