'use client'
import Link from 'next/link'
import { useEffect } from 'react'
import { reportClientError } from '@/lib/report-error'
import { referenceCode } from '@/lib/client-errors'

export interface ErrorScreenProps {
  error: Error & { digest?: string }
  /** Next's "try to load this page again". */
  retry: () => void
  /** Where the second button goes. Signed-in screens go to Today; public screens go to the home page. */
  homeHref: string
  homeLabel: string
}

/**
 * The screen shown when a page breaks. It says what happened in plain words, what is safe, and gives two ways out.
 * It reports the error once, quietly, to the server log. It never shows the technical message to the person:
 * that goes to the log, and the short reference below it is how a person and the log find each other.
 */
export default function ErrorScreen({ error, retry, homeHref, homeLabel }: ErrorScreenProps) {
  useEffect(() => { reportClientError('screen', error, { digest: error.digest }) }, [error])
  const ref = referenceCode(error.digest)

  return (
    <div className="page-container">
      <div className="mx-auto max-w-xl">
        <div className="rotag lamp-red" role="alert">
          <h1 className="section-title">This page ran into a problem</h1>
          <p className="mt-2 text-[0.9375rem] leading-6 text-text-secondary">
            Alpha Desk could not show this page. Anything you already saved is safe. If you were typing something and had not saved it yet, check it after the page loads again.
          </p>
          <p className="mt-2 text-[0.9375rem] leading-6 text-text-secondary">
            Alpha Desk records problems like this so they can be fixed.
          </p>
          {ref && (
            <p className="mt-3 text-[0.875rem] text-text-secondary">
              Reference: <span className="font-bold text-text-primary tabular-nums">{ref}</span>
              <span className="block">If this keeps happening, give that reference to whoever looks after Alpha Desk.</span>
            </p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className="btn btn-primary" onClick={() => retry()}>Try again</button>
            <Link href={homeHref} className="btn btn-secondary">{homeLabel}</Link>
          </div>
        </div>
      </div>
    </div>
  )
}
