'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import Icon from '@/components/Icon'
import { EmptyBlock, ErrorCard, RowsSkeleton, SearchField } from '@/components/ListKit'
import { phonePretty } from '@/lib/today'
import { agoWords, hasPhone, lastVisitOf } from '@/lib/growth-text'
import { Flagged, PAGE, Section } from './parts'
import ReviewReplies from './ReviewReplies'
import { timeAgo } from './helpers'
import type { Rec, ShopInfo } from './helpers'

interface Props {
  loading: boolean
  failedCustomers: boolean
  customers: Rec[]
  visits: Parameters<typeof lastVisitOf>[1]
  shop: ShopInfo
  onRetry: () => void
  onRetryShop: () => void
  onAsk: (customer: Rec) => void
  notify: (message: string, kind?: 'success' | 'error' | 'info') => void
}

export default function ReviewsTab({ loading, failedCustomers, customers, visits, shop, onRetry, onRetryShop, onAsk, notify }: Props) {
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const reviewReady = shop.state === 'ready' && !!shop.reviewUrl

  // Newest visitors first: they are the ones who remember the work.
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const digits = q.replace(/\D/g, '')
    return customers
      .filter(c => !q || String(c.name || '').toLowerCase().includes(q) || (digits.length > 2 && String(c.phone || '').replace(/\D/g, '').includes(digits)))
      .sort((a, b) => (lastVisitOf(b, visits) ?? 0) - (lastVisitOf(a, visits) ?? 0))
  }, [customers, search, visits])

  const copyLink = async () => {
    try { await navigator.clipboard.writeText(shop.reviewUrl); notify('Review link copied.', 'success') }
    catch { notify('The link could not be copied. Press and hold it to copy.', 'error') }
  }

  return (
    <>
      <Section title="Your Google review link" hint="Customers can leave a review in one tap.">
        {shop.state === 'loading' ? <div className="skeleton h-28" aria-busy="true" />
          : shop.state === 'error' ? <ErrorCard title="Your review link did not load" message="Check your connection and try again." onRetry={onRetryShop} />
          : reviewReady ? (
            <div className="card">
              <p className="break-all rounded-md bg-bg-hover px-3 py-2 text-[0.9375rem] font-bold text-blue">{shop.reviewUrl}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="btn btn-secondary" onClick={copyLink}><Icon name="copy" className="h-5 w-5" />Copy link</button>
                <a href={shop.reviewUrl} target="_blank" rel="noopener noreferrer" className="btn btn-secondary no-underline"><Icon name="openExternal" className="h-5 w-5" />Open link</a>
              </div>
            </div>
          ) : (
            <EmptyBlock icon="star" title="Add your Google review link" action={<Link href="/settings" className="btn btn-primary">Open settings</Link>}>
              Paste your Google review link in Settings. Then you can text it to customers here.
            </EmptyBlock>
          )}
      </Section>

      <Section title="Ask customers for a review" hint="Text your review link to someone who was happy with the work. Recent customers are first.">
        {failedCustomers ? <ErrorCard title="Your customers did not load" message="Check your connection and try again." onRetry={onRetry} busy={loading} />
          : loading ? <RowsSkeleton rows={5} label="Loading customers" />
          : customers.length === 0 ? <EmptyBlock icon="customers" title="No customers yet">When you have customers you can ask them for reviews here.</EmptyBlock>
          : (
            <>
              <SearchField className="mb-3 max-w-md" value={search} onChange={v => { setSearch(v); setLimit(PAGE) }} label="Find a customer" placeholder="Find a customer by name or phone" />
              {rows.length === 0 ? <EmptyBlock title="No customers match">Try a different name or phone number.</EmptyBlock> : (
                <ul className="ledger">
                  {rows.slice(0, limit).map(c => {
                    const optedOut = c.sms_opted_out === true
                    const last = lastVisitOf(c, visits)
                    return (
                      <li key={c.id}>
                        <div className="ledger-row">
                          <span className="ledger-main">
                            <span className="ledger-title block">{c.name}</span>
                            <span className="ledger-sub block">{hasPhone(c.phone) ? phonePretty(c.phone) : 'No phone number'} · {c.review_requested ? `Asked ${timeAgo(c.review_requested)}` : 'Not asked yet'}</span>
                            <span className="ledger-sub block">{last ? `Last visit ${agoWords(last)}` : 'No visit on record'}</span>
                            {optedOut && <span className="mt-1 block"><Flagged>Texts off: replied STOP</Flagged></span>}
                          </span>
                          <button type="button" className={`btn shrink-0 ${c.review_requested ? 'btn-secondary' : 'btn-primary'}`} onClick={() => onAsk(c)} disabled={!hasPhone(c.phone) || optedOut || !reviewReady} aria-label={`${c.review_requested ? 'Text review link again to' : 'Text review link to'} ${c.name}`}>
                            {c.review_requested ? 'Text again' : 'Text link'}
                          </button>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
              {rows.length > limit && (
                <button type="button" className="btn btn-secondary mt-3 w-full sm:w-auto" onClick={() => setLimit(n => n + PAGE)}>Show {Math.min(PAGE, rows.length - limit)} more of {rows.length - limit}</button>
              )}
              {!reviewReady && shop.state === 'ready' && <p className="form-hint mt-2">Texting is off until you add your review link above.</p>}
            </>
          )}
      </Section>

      <ReviewReplies notify={notify} />
    </>
  )
}
