'use client'
import type { ReactNode } from 'react'

export interface SegmentOption<T extends string> {
  value: T
  label: string
  /** Shown beside the label, e.g. a count of unread texts. */
  badge?: ReactNode
  /** Spoken in place of the badge text. */
  badgeLabel?: string
  badgeTone?: 'blue' | 'red'
}

/** Two or three big buttons that switch between views. Selected one is blue and outlined. */
export default function Segmented<T extends string>({ value, onChange, options, label, className = '' }: {
  value: T
  onChange: (v: T) => void
  options: SegmentOption<T>[]
  label: string
  className?: string
}) {
  const move = (dir: number, i: number) => {
    const next = options[(i + dir + options.length) % options.length]
    onChange(next.value)
    requestAnimationFrame(() => document.getElementById(`seg-${label}-${next.value}`)?.focus())
  }
  return (
    <div role="tablist" aria-label={label} className={`flex gap-1 rounded-lg border border-border bg-bg-chrome/60 p-1 ${className}`}>
      {options.map((o, i) => {
        const on = o.value === value
        return (
          <button
            key={o.value} id={`seg-${label}-${o.value}`} type="button" role="tab" aria-selected={on} tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={e => { if (e.key === 'ArrowRight') { e.preventDefault(); move(1, i) } else if (e.key === 'ArrowLeft') { e.preventDefault(); move(-1, i) } }}
            className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-md border px-3 text-[0.9375rem] font-bold transition-colors sm:min-h-[40px] ${on ? 'border-line bg-bg-card text-blue' : 'border-transparent text-text-secondary hover:bg-bg-hover hover:text-text-primary'}`}
          >
            {o.label}
            {o.badge !== undefined && o.badge !== null && o.badge !== 0 && (
              <>
                <span className={`num rounded-full px-2 text-[0.8125rem] leading-5 ${o.badgeTone === 'red' ? 'bg-red/[0.14] text-red' : 'bg-blue/[0.14] text-blue'}`} aria-hidden="true">{o.badge}</span>
                {o.badgeLabel && <span className="sr-only">{o.badgeLabel}</span>}
              </>
            )}
          </button>
        )
      })}
    </div>
  )
}
