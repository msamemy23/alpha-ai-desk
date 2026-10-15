'use client'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { serviceLabel } from './services'
import type { ShopFields } from './ShopStep'

function ButtonSpinner() {
  return <span aria-hidden="true" className="spinner inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent" />
}

export default function ReviewStep({
  headingRef, shop, services, error, partial, saving, onEdit, onBack, onFinish,
}: {
  headingRef: React.RefObject<HTMLHeadingElement>
  shop: ShopFields
  services: string[]
  error: string
  /** The shop profile was saved but the details customers see were not. */
  partial: boolean
  saving: boolean
  onEdit: (step: number) => void
  onBack: () => void
  onFinish: () => void
}) {
  const line = [shop.phone, shop.address, shop.cityStateZip].filter(Boolean).join(' · ')
  return (
    <section className="card" aria-labelledby="step-title">
      <h2 id="step-title" ref={headingRef} tabIndex={-1} className="section-title outline-none"><span className="sr-only">Step 3 of 3: </span>Check and finish</h2>
      <p className="mt-1 text-[0.9375rem] text-text-secondary">This is what we will save for your shop.</p>

      <dl className="mt-4 divide-y divide-border border-y border-border">
        <div className="flex items-start gap-3 py-3">
          <div className="min-w-0 flex-1">
            <dt className="text-[0.8125rem] font-bold text-text-secondary">Shop</dt>
            <dd className="mt-0.5 break-words font-bold">{shop.shopName.trim() || 'No name yet'}</dd>
            <dd className="break-words text-[0.9375rem] text-text-secondary">{line || 'No phone or address added'}</dd>
          </div>
          <button type="button" className="btn btn-ghost btn-sm min-h-[44px] text-blue" onClick={() => onEdit(1)} disabled={saving}>Change<span className="sr-only"> shop info</span></button>
        </div>
        <div className="flex items-start gap-3 py-3">
          <div className="min-w-0 flex-1">
            <dt className="text-[0.8125rem] font-bold text-text-secondary">Services</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {services.length === 0
                ? <span className="text-[0.9375rem] text-text-secondary">None selected</span>
                : services.map(s => <span key={s} className="tag tag-gray text-[0.8125rem]">{serviceLabel(s)}</span>)}
            </dd>
          </div>
          <button type="button" className="btn btn-ghost btn-sm min-h-[44px] text-blue" onClick={() => onEdit(2)} disabled={saving}>Change<span className="sr-only"> services</span></button>
        </div>
      </dl>

      <details className="mt-4 rounded-md border border-border bg-bg-base">
        <summary className="flex min-h-[48px] cursor-pointer items-center gap-2 px-3 font-bold">
          <span className="lamp lamp-off" aria-hidden="true" />
          AI voicemail is coming soon
        </summary>
        <div className="space-y-2 px-3 pb-3 text-[0.9375rem] text-text-secondary">
          <p>There is nothing to do for this yet. Your dedicated AI line number is not ready. When it is, customers whose calls go unanswered for four rings will be greeted by your AI assistant.</p>
          <p>To forward unanswered calls, you will dial your carrier’s conditional call forwarding code from your shop phone. For AT&amp;T and T-Mobile it is <code className="num rounded bg-text-primary/[0.08] px-1.5 py-0.5 font-mono text-[0.875rem] text-text-primary">**61*[AI line number]#</code> and then Call.</p>
        </div>
      </details>

      {error && (
        <Notice kind="error" className="mt-4">
          <p className="font-bold">{partial ? 'Your setup was only partly saved.' : 'Your setup was not saved.'}</p>
          <p>{error}</p>
          <p className="mt-1">What you entered is still here. Check your connection, then choose Finish setup again{partial ? ' to finish saving.' : '.'}</p>
        </Notice>
      )}

      <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <button type="button" className="btn btn-secondary" onClick={onBack} disabled={saving}>
          <Icon name="chevronLeft" className="h-5 w-5" />
          Back
        </button>
        <button type="button" className="btn btn-primary btn-lg" onClick={onFinish} disabled={saving} aria-busy={saving}>
          {saving ? <><ButtonSpinner /> Saving…</> : 'Finish setup'}
        </button>
      </div>
    </section>
  )
}
