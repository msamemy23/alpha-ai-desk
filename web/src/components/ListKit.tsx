'use client'

import { useId } from 'react'
import type { ReactNode } from 'react'
import Icon from '@/components/Icon'

/**
 * Small building blocks shared by the list screens (vehicles, inventory, canned jobs,
 * insurance claims, parts lookup, repair info) so they all behave the same way.
 */

/** Display-only: "Belts & Hoses" reads "Belts & hoses". Short codes like "A/C" are left alone. Stored values never change. */
export function sentenceCase(s: string): string {
  const t = String(s || '')
  if (/^[A-Z]{1,3}(\/[A-Z]{1,3})?$/.test(t)) return t
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()
}

export function SearchField({
  value, onChange, label, placeholder, className = '', onEnter,
}: { value: string; onChange: (v: string) => void; label: string; placeholder?: string; className?: string; onEnter?: () => void }) {
  const id = useId()
  return (
    <div className={`relative ${className}`}>
      <label htmlFor={id} className="sr-only">{label}</label>
      <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted" />
      <input
        id={id}
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        className="form-input pl-10"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onEnter ? (e => { if (e.key === 'Enter') onEnter() }) : undefined}
      />
    </div>
  )
}

export interface ChipOption<T extends string> { key: T; label: string; count?: number }

/** A row of toggle chips. One is always selected. Selected state is shown with a border and a tick, not colour alone. */
export function FilterChips<T extends string>({
  label, options, value, onChange, scroll = false,
}: { label: string; options: ChipOption<T>[]; value: T; onChange: (key: T) => void; /** One swipeable row on phones instead of wrapping. */ scroll?: boolean }) {
  return (
    <div role="group" aria-label={label} className={scroll ? '-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0' : 'flex flex-wrap gap-2'}>
      {options.map(o => {
        const on = o.key === value
        return (
          <button
            key={o.key}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(o.key)}
            className={`inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-[0.9375rem] font-bold leading-tight transition-colors sm:min-h-[38px] ${on ? 'border-blue bg-blue/10 text-blue' : 'border-[rgb(var(--c-line))] bg-bg-card text-text-primary hover:bg-bg-hover'}`}
          >
            {on && <Icon name="check" className="h-4 w-4" strokeWidth={2.4} />}
            {o.label}
            {o.count !== undefined && <span className="num font-normal text-text-secondary">{o.count}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** What failed and what to do. Never looks like an empty list. */
export function ErrorCard({ title, message, onRetry, busy = false, className = '' }: { title?: string; message: string; onRetry?: () => void; busy?: boolean; className?: string }) {
  return (
    <div role="alert" className={`card flex items-start gap-3 ${className}`}>
      <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-red" />
      <div className="min-w-0 flex-1">
        {title && <p className="font-bold text-text-primary">{title}</p>}
        <p className={title ? 'mt-0.5 text-text-secondary' : 'text-text-primary'}>{message}</p>
        {onRetry && <button type="button" className="btn btn-secondary mt-3" onClick={onRetry} disabled={busy}>{busy ? 'Trying again…' : 'Try again'}</button>}
      </div>
    </div>
  )
}

/** Skeleton rows that match the height of a ledger row. */
export function RowsSkeleton({ rows = 6, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div className="space-y-2" aria-busy="true" aria-label={label} role="status">
      {Array.from({ length: rows }, (_, i) => <div key={i} className="skeleton h-[4.25rem]" />)}
    </div>
  )
}

/** What this list is and the one thing to do next. */
export function EmptyBlock({ icon, title, children, action }: { icon?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty-state">
      {icon && <Icon name={icon} className="mx-auto mb-3 h-8 w-8 text-text-muted" />}
      <p className="font-bold text-text-primary">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-md">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

/** A small readable label (14px). Use instead of .tag, which is 12px. Pass a lamp to pair a status colour with the word. */
export function Pill({ children, lamp, className = '' }: { children: ReactNode; lamp?: 'green' | 'amber' | 'red' | 'blue' | 'off'; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-card px-3 py-1 text-[0.875rem] font-bold leading-tight text-text-secondary ${className}`}>
      {lamp && <span className={`lamp lamp-${lamp}`} aria-hidden="true" />}
      {children}
    </span>
  )
}

/** Only http(s) links are ever opened from search results. */
export function safeHref(url: string | undefined | null): string {
  const u = String(url || '')
  return /^https?:\/\//i.test(u) ? u : '#'
}

export function hostOf(url: string | undefined | null): string {
  try { return new URL(String(url || '')).hostname.replace(/^www\./, '') } catch { return '' }
}
