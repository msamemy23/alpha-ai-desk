'use client'
import Link from 'next/link'
import type { RefObject } from 'react'
import Icon from '@/components/Icon'

const NEXT_STEPS = [
  { href: '/settings#ai', icon: 'alpha', title: 'Add your AI key', sub: 'So Alpha can answer questions and draft estimates and texts.' },
  { href: '/settings#comms', icon: 'inbox', title: 'Set up texts and calls', sub: 'Add your Telnyx number so you can text and call customers from Alpha Desk.' },
  { href: '/connectors', icon: 'plug', title: 'Connect Facebook and Google', sub: 'So Alpha can post updates and reply to reviews.' },
]

export default function DoneCard({ headingRef }: { headingRef: RefObject<HTMLHeadingElement> }) {
  return (
    <section className="card sm:p-8" aria-labelledby="done-title">
      <div className="text-center">
        <h2 id="done-title" ref={headingRef} tabIndex={-1} className="display inline-flex items-center gap-2.5 text-[1.5rem] font-bold leading-tight outline-none">
          <span className="lamp lamp-green" aria-hidden="true" />
          Your shop is set up
        </h2>
        <p className="mx-auto mt-2 max-w-sm text-[0.9375rem] text-text-secondary">
          Your details are saved and now show on your estimates, invoices and texts. Today is your home screen: it shows the calls, texts, estimates and unpaid invoices that need you.
        </p>
      </div>

      <h3 className="mt-6 font-bold">Good next steps</h3>
      <ul className="ledger mt-2">
        {NEXT_STEPS.map(n => (
          <li key={n.href}>
            <Link href={n.href} className="ledger-row no-underline">
              <Icon name={n.icon} className="h-5 w-5 shrink-0 text-text-secondary" />
              <span className="ledger-main">
                <span className="ledger-title block">{n.title}</span>
                <span className="ledger-sub block !overflow-visible !whitespace-normal">{n.sub}</span>
              </span>
              <Icon name="chevronRight" className="h-5 w-5 shrink-0 text-text-muted" />
            </Link>
          </li>
        ))}
      </ul>

      <div className="mt-6 flex flex-col items-center gap-2">
        <Link href="/dashboard" className="btn btn-primary btn-lg w-full sm:w-auto">
          Go to Today
          <Icon name="arrowRight" className="h-5 w-5" />
        </Link>
        <Link href="/settings" className="btn btn-ghost">Open settings</Link>
      </div>
    </section>
  )
}
