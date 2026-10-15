import Link from 'next/link'
import type { ReactNode } from 'react'

/**
 * Shared frame for the screens that sit outside the app shell: help, privacy,
 * terms and the sign-in hand-off pages. A concrete header strip with the brand
 * mark, paper in the middle, and one footer row of links.
 */

export function BrandMark({ large = false }: { large?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <span className="lamp lamp-green" aria-hidden="true" />
      <span className={`display font-bold leading-none ${large ? 'text-[1.5rem]' : 'text-[1.25rem]'}`}>Alpha Desk</span>
    </span>
  )
}

export function PublicHeader({ showSignIn = true }: { showSignIn?: boolean }) {
  return (
    <header className="no-print border-b border-border bg-bg-chrome">
      <div className="mx-auto flex min-h-[3.5rem] w-full max-w-3xl items-center justify-between gap-3 px-4 sm:px-6">
        <Link href="/" className="inline-flex min-h-[44px] items-center no-underline" aria-label="Alpha Desk home">
          <BrandMark />
        </Link>
        {showSignIn && <Link href="/login" className="btn btn-secondary">Sign in</Link>}
      </div>
    </header>
  )
}

export type FooterKey = 'help' | 'privacy' | 'terms'

const FOOTER_LINKS: { key: FooterKey; href: string; label: string }[] = [
  { key: 'help', href: '/help', label: 'Help' },
  { key: 'privacy', href: '/privacy', label: 'Privacy' },
  { key: 'terms', href: '/terms', label: 'Terms' },
]

export function PublicFooter({ current, centered = false }: { current?: FooterKey; centered?: boolean }) {
  return (
    <footer className="no-print border-t border-border">
      <nav
        aria-label="Help and legal"
        className={`mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-6 px-4 sm:px-6 ${centered ? 'justify-center' : ''}`}
      >
        <ul className="flex flex-wrap gap-x-6">
          {FOOTER_LINKS.map(link => (
            <li key={link.key}>
              <Link
                href={link.href}
                aria-current={current === link.key ? 'page' : undefined}
                className="inline-flex min-h-[48px] items-center text-[0.9375rem] font-bold text-text-secondary underline-offset-4 hover:text-text-primary hover:underline aria-[current=page]:text-text-primary aria-[current=page]:underline"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </footer>
  )
}

/** Header, readable column and footer for the plain text pages. */
export function PublicPage({ current, children }: { current?: FooterKey; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg-base text-text-primary">
      <PublicHeader />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-12 pt-8 sm:px-6 sm:pt-12">{children}</main>
      <PublicFooter current={current} />
    </div>
  )
}

/** A small centred card under the brand header: used while sign-in finishes. */
export function StatusScreen({ children, showSignIn = false }: { children: ReactNode; showSignIn?: boolean }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg-base text-text-primary">
      <PublicHeader showSignIn={showSignIn} />
      <main className="mx-auto grid w-full max-w-3xl flex-1 place-items-center px-4 py-10 sm:px-6">
        <section className="panel w-full max-w-md p-6 text-center sm:p-8">{children}</section>
      </main>
      <PublicFooter />
    </div>
  )
}

/** A small spinner for loading states on a card. */
export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return <span aria-hidden="true" className={`spinner inline-block rounded-full border-[3px] border-border border-t-blue ${className}`} />
}
