import type { ReactNode } from 'react'

/** One number in the strip at the top. A button when it takes you somewhere. */
export function Stat({ label, value, lamp, onClick }: { label: string; value: number | string; lamp?: 'amber' | 'green'; onClick?: () => void }) {
  const body = (
    <>
      <span className="block text-[0.875rem] font-bold leading-tight text-text-secondary">{label}</span>
      <span className="mt-1 flex items-center gap-1.5">
        {lamp && <span className={`lamp lamp-${lamp}`} aria-hidden="true" />}
        <span className="display num text-[1.5rem] font-bold leading-none">{value}</span>
      </span>
    </>
  )
  const cls = 'block min-h-[4.5rem] w-full px-3 py-3 text-left'
  return onClick
    ? <button type="button" onClick={onClick} className={`${cls} hover:bg-bg-hover`}>{body}</button>
    : <div className={cls}>{body}</div>
}

export function Section({ title, hint, action, children }: { title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mt-8 first:mt-0">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h2 className="section-title">{title}</h2>
          {hint && <p className="mt-0.5 text-[0.9375rem] text-text-secondary">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  )
}

/** "Texts off" and similar small facts that sit beside a name. A word, never only a colour. */
export function Flagged({ children }: { children: ReactNode }) {
  return <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-bg-card px-2.5 py-0.5 text-[0.8125rem] font-bold leading-tight text-text-secondary"><span className="lamp lamp-off !h-2 !w-2" aria-hidden="true" />{children}</span>
}

export const PAGE = 50
