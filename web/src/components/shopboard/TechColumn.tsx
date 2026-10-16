'use client'
import type { ReactNode } from 'react'
import Icon from '@/components/Icon'
import { Avatar } from '@/components/team/parts'

/**
 * One column of the board: a person (or "Unassigned"), how they are doing, and their cars.
 * It is also where a dragged car lands.
 */
export default function TechColumn({
  id, name, sub, avatar = true, status, flag, actions, count, over, empty, onDragOver, onDragLeave, onDrop, children,
}: {
  /** What a jump chip scrolls to. */
  id?: string
  name: string
  /** A role, or "Not on your team list". */
  sub?: string
  avatar?: boolean
  /** Clock status and hours, already worded. */
  status?: ReactNode
  /** An amber line that says what needs a look in this column. */
  flag?: string
  actions?: ReactNode
  count: number
  over: boolean
  empty: string
  onDragOver?: (e: React.DragEvent) => void
  onDragLeave?: (e: React.DragEvent) => void
  onDrop?: (e: React.DragEvent) => void
  children: ReactNode
}) {
  return (
    <section
      id={id}
      aria-label={`${name}, ${count} ${count === 1 ? 'car' : 'cars'}`}
      className={`scroll-mt-20 rounded-lg border p-2.5 transition-colors lg:w-[16.5rem] lg:shrink-0 ${over ? 'border-blue bg-blue/[0.06]' : 'border-border bg-bg-chrome/50'}`}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <header className="mb-2.5 px-1">
        <div className="flex items-center gap-2.5">
          {avatar ? <Avatar name={name} size={36} /> : (
            <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-dashed border-line text-text-secondary"><Icon name="user" className="h-5 w-5" /></span>
          )}
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[1rem] font-bold leading-tight">{name}</h2>
            {sub && <p className="truncate text-[0.8125rem] text-text-secondary">{sub}</p>}
          </div>
          <span className="num shrink-0 rounded-full border border-border bg-bg-card px-2.5 py-0.5 text-[0.875rem] font-bold" aria-hidden="true">{count}</span>
        </div>
        {status && <div className="mt-2 text-[0.875rem] text-text-secondary">{status}</div>}
        {flag && (
          <p className="mt-1.5 flex items-start gap-1.5 text-[0.8125rem] font-bold text-amber">
            <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />{flag}
          </p>
        )}
        {actions && <div className="mt-2.5 flex gap-2">{actions}</div>}
      </header>
      {count === 0 ? (
        <p className="rounded-md border border-dashed border-border px-3 py-5 text-center text-[0.875rem] text-text-secondary">{over ? 'Drop here' : empty}</p>
      ) : (
        <div className="space-y-2.5">{children}</div>
      )}
    </section>
  )
}
