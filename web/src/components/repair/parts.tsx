'use client'
import type { ReactNode } from 'react'
import Icon from '@/components/Icon'
import { safeHref } from '@/components/ListKit'
import type { Lamp } from './types'

/** A titled box. `right` holds a button or a short figure for the header. */
export function Block({ title, right, children, className = '', id }: { title: string; right?: ReactNode; children: ReactNode; className?: string; id?: string }) {
  return (
    <section className={`panel ${className}`} aria-labelledby={id}>
      <div className="panel-header">
        <h3 id={id} className="section-title">{title}</h3>
        {right}
      </div>
      <div className="panel-body">{children}</div>
    </section>
  )
}

/** A status as a lamp and a word, so colour is never the only signal. */
export function Status({ lamp, children, className = '' }: { lamp: Lamp; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-start gap-1.5 text-[0.875rem] font-bold leading-tight text-text-secondary ${className}`}>
      <span className={`lamp lamp-${lamp} mt-[0.1875rem] shrink-0`} aria-hidden="true" />
      {children}
    </span>
  )
}

/** A link to a page on another site. Only web addresses are ever opened. */
export function ExternalLink({ url, children, className = 'btn btn-secondary' }: { url: string; children: ReactNode; className?: string }) {
  return (
    <a className={className} href={safeHref(url)} target="_blank" rel="noreferrer noopener">
      {children}
      <Icon name="openExternal" className="h-4 w-4 shrink-0" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  )
}

/** Label and value pairs, one per line. */
export function Facts({ rows }: { rows: Array<{ label: string; value: ReactNode }> }) {
  return (
    <dl className="divide-y divide-border">
      {rows.map(row => (
        <div key={row.label} className="flex items-baseline justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
          <dt className="shrink-0 text-text-secondary">{row.label}</dt>
          <dd className="min-w-0 break-words text-right">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function BulletList({ items, className = '' }: { items: string[]; className?: string }) {
  return (
    <ul className={`space-y-2 ${className}`}>
      {items.map(item => (
        <li key={item} className="flex gap-2.5 leading-snug">
          <span className="mt-[0.5rem] h-1.5 w-1.5 shrink-0 rounded-full bg-text-muted" aria-hidden="true" />
          <span className="min-w-0">{item}</span>
        </li>
      ))}
    </ul>
  )
}

/** Diagrams are dark lines on white paper, so they sit on a light mat in either theme. */
export const imageMat = { colorScheme: 'light', backgroundColor: 'Canvas', color: 'CanvasText' } as const
