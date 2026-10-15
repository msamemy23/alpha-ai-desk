import type { ReactNode } from 'react'

/** A titled block inside a long form. */
export function Section({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="border-t border-border pt-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="display text-[1.0625rem] font-bold">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  )
}

/** A label above a box, with the problem or the hint underneath. The message id is `${id}-err` so a box can point at it. */
export function Field({ id, label, error, hint, children, className = '' }: { id: string; label: string; error?: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label className="form-label !text-[0.875rem]" htmlFor={id}>{label}</label>
      {children}
      {error ? <p id={`${id}-err`} className="form-error !text-[0.875rem]">{error}</p> : hint ? <p className="form-hint !text-[0.875rem] !text-text-secondary">{hint}</p> : null}
    </div>
  )
}
