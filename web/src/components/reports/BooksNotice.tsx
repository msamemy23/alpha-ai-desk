'use client'
import Notice from '@/components/Notice'
import { NEEDS_UPDATE_MESSAGE } from '@/lib/books-store'
import type { Resource } from '@/lib/books-store'
import type { BooksState } from './useBooks'

/** Why a part of the books is not showing, in words. Returns nothing when it loaded fine. */
export function ResourceNotice<T>({ r, what, onRetry }: { r: Resource<T>; what: string; onRetry?: () => void }) {
  if (r.state === 'ok') return null
  if (r.state === 'needs-update') return <Notice kind="info"><p className="font-bold">{what} needs a database update</p><p className="mt-0.5 text-text-secondary">{NEEDS_UPDATE_MESSAGE} Ask whoever looks after your Alpha Desk setup to apply the accounting update. Until then this part stays off and the rest works.</p></Notice>
  return (
    <Notice kind="error">
      <p className="font-bold">{what} did not load</p>
      <p className="mt-0.5 text-text-secondary">{r.error || 'Try again in a moment.'}</p>
      {onRetry && <button type="button" className="btn btn-secondary mt-2" onClick={onRetry}>Try again</button>}
    </Notice>
  )
}

/** When the whole books call failed or the person's role cannot see them. */
export function BooksGate({ state, what, onRetry }: { state: BooksState; what: string; onRetry: () => void }) {
  if (state.status === 'forbidden') {
    return <Notice kind="info"><p className="font-bold">{what} is for owners and managers</p><p className="mt-0.5 text-text-secondary">Your role can see the sales reports but not the shop&apos;s books. Ask an owner or manager.</p></Notice>
  }
  if (state.status === 'error') {
    return <Notice kind="error"><p className="font-bold">{what} did not load</p><p className="mt-0.5 text-text-secondary">{state.message}</p><button type="button" className="btn btn-secondary mt-2" onClick={onRetry}>Try again</button></Notice>
  }
  return null
}
