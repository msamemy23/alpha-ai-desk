import Link from 'next/link'
import { PublicFooter, PublicHeader } from '@/components/PublicChrome'

export const metadata = { title: 'Page not found', robots: { index: false } }

/**
 * Shown for any address that is not a page. It sits outside the signed-in shell on purpose: an unknown address could be
 * a mistyped link from a text message sent to a customer, who has no menu to go back to.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col bg-bg-base text-text-primary">
      <PublicHeader showSignIn={false} />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 pb-12 pt-8 sm:px-6 sm:pt-12">
        <div className="rotag lamp-amber">
          <h1 className="section-title">That page was not found</h1>
          <p className="mt-2 text-[0.9375rem] leading-6 text-text-secondary">
            The address may be mistyped, or the page may have moved. Nothing was lost.
          </p>
          <p className="mt-2 text-[0.9375rem] leading-6 text-text-secondary">
            If you were sent this link by a shop, ask them to send it again.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/dashboard" className="btn btn-primary">Open Alpha Desk</Link>
            <Link href="/help" className="btn btn-secondary">Help</Link>
          </div>
        </div>
      </main>
      <PublicFooter />
    </div>
  )
}
