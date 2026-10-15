import type { ReactNode } from 'react'

/** The Save and Cancel row at the bottom of a sheet. It stays in view on a phone while the form scrolls. */
export default function FormActions({ children }: { children: ReactNode }) {
  return (
    <div className="sticky bottom-[calc(-1.25rem-env(safe-area-inset-bottom))] z-10 -mx-5 flex flex-wrap items-center gap-2 border-t border-border bg-bg-card px-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 sm:-bottom-6 sm:-mx-6 sm:px-6 sm:pb-3">
      {children}
    </div>
  )
}
