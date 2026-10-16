'use client'
import Notice from '@/components/Notice'
import type { Resource } from '@/lib/inventory-store'

/** Why a part of the Inventory screen is not showing, in words. Returns nothing when it loaded fine. */
export default function StockNotice<T>({ r, what, onRetry }: { r: Resource<T>; what: string; onRetry?: () => void }) {
  if (r.state === 'ok') return null
  if (r.state === 'needs-update') {
    return (
      <Notice kind="info" className="mb-4">
        <p className="font-bold">{what} needs a database update</p>
        <p className="mt-0.5 text-text-secondary">This needs a one-time update to your Alpha Desk database. It does not change your parts counts or invoices. Until it is applied this part stays off and the rest of Inventory works.</p>
      </Notice>
    )
  }
  return (
    <Notice kind="error" className="mb-4">
      <p className="font-bold">{what} did not load</p>
      <p className="mt-0.5 text-text-secondary">{r.error || 'Try again in a moment.'}</p>
      {onRetry && <button type="button" className="btn btn-secondary mt-2" onClick={onRetry}>Try again</button>}
    </Notice>
  )
}

/** Shown in place of a buying screen to someone whose role may look but not change it. */
export function LookOnly({ what }: { what: string }) {
  return (
    <Notice kind="info" className="mb-4">
      <p className="font-bold">{what} are set up by owners and managers</p>
      <p className="mt-0.5 text-text-secondary">You can look at everything here. Ask an owner or manager to change it.</p>
    </Notice>
  )
}
