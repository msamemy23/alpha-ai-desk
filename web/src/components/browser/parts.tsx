import type { ReactNode } from 'react'
import Icon from '@/components/Icon'
import { safeLink } from './address'
import type { Lamp } from './live'

/** A lamp and the words that go with it. Colour is never the only signal. */
export function StatusLine({ lamp, children, className = '' }: { lamp: Lamp; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-bold text-text-primary ${className}`}>
      <span className={`lamp lamp-${lamp}`} aria-hidden="true" />
      <span className="min-w-0">{children}</span>
    </span>
  )
}

/**
 * A link that opens the real website in the person's own browser. Only web addresses are ever linked.
 * Used for the steps Alpha never does (signing in, codes, payment).
 */
export function OutsideLink({ url, children = 'Open in your own browser' }: { url: string; children?: ReactNode }) {
  const link = safeLink(url)
  if (!link || link.kind !== 'web') return null
  return (
    <a href={link.url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm">
      <Icon name="openExternal" className="h-4 w-4" />
      {children}
    </a>
  )
}

/** The page's place on the screen while something loads. */
export function PageSkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-3" role="status" aria-busy="true" aria-label={label}>
      <div className="skeleton h-8 w-3/4" />
      <div className="skeleton h-4 w-full" />
      <div className="skeleton h-4 w-11/12" />
      <div className="skeleton h-4 w-5/6" />
      <div className="skeleton h-40 w-full" />
    </div>
  )
}
