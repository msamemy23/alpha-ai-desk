'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import Icon from '@/components/Icon'
import { EmptyBlock, ErrorCard, RowsSkeleton } from '@/components/ListKit'
import { phonePretty } from '@/lib/today'
import { QUIET_DAYS, agoWords, followUpTemplate, hasPhone, lastVisitOf, splitForText } from '@/lib/growth-text'
import { Flagged, PAGE, Section } from './parts'
import type { Rec, ShopInfo } from './helpers'

interface Props {
  loading: boolean
  failed: { customers: boolean; visits: boolean }
  customers: Rec[]
  quiet: Rec[]
  visits: Parameters<typeof lastVisitOf>[1]
  shop: ShopInfo
  onRetry: () => void
  onText: (customers: Rec[]) => void
}

export default function FollowUpsTab({ loading, failed, customers, quiet, visits, shop, onRetry, onText }: Props) {
  const [limit, setLimit] = useState(PAGE)
  const split = useMemo(() => splitForText(quiet), [quiet])
  const example = followUpTemplate(shop.name || 'your shop', shop.phone).replace('{name}', '[first name]')

  return (
    <Section title="Customers to win back" hint={`People who have not visited or heard from you in ${QUIET_DAYS} days or more.`}>
      {failed.customers || failed.visits ? (
        <ErrorCard
          title={failed.customers ? 'Your customers did not load' : 'Recent visits did not load'}
          message={failed.customers ? 'Check your connection and try again.' : 'Without them this list could include people who were in last week, so it is hidden. Check your connection and try again.'}
          onRetry={onRetry}
          busy={loading}
        />
      ) : loading ? <RowsSkeleton rows={5} label="Loading customers" />
        : customers.length === 0 ? (
          <EmptyBlock icon="customers" title="No customers yet" action={<Link href="/customers" className="btn btn-primary">Go to customers</Link>}>
            Once you have customers, the ones who go quiet show up here with a one-tap text.
          </EmptyBlock>
        ) : quiet.length === 0 ? (
          <EmptyBlock icon="check" title="Nobody has gone quiet">Every customer has visited or heard from you in the last {QUIET_DAYS} days. Check back later.</EmptyBlock>
        ) : (
          <>
            <div className="mb-4 rounded-lg border border-border bg-bg-card p-4">
              <p className="form-label">The text each customer gets</p>
              <p className="rounded-md bg-bg-hover px-3 py-2.5 text-[0.9375rem]">{shop.state === 'loading' ? 'Loading…' : example}</p>
              {shop.state === 'ready' && !shop.name && <p className="form-hint">Add your shop name in <Link href="/settings" className="font-bold text-blue underline underline-offset-2">Settings</Link> so the text says who it is from.</p>}
              <button type="button" className="btn btn-primary mt-3 w-full sm:w-auto" onClick={() => onText(quiet)} disabled={split.eligible.length === 0}>
                <Icon name="send" className="h-5 w-5" />
                {split.eligible.length === 0 ? 'Nobody here can be texted' : `Review and text ${split.eligible.length} ${split.eligible.length === 1 ? 'customer' : 'customers'}`}
              </button>
              <p className="form-hint">You see the exact words and the list before anything goes out.</p>
              {(split.noPhone.length > 0 || split.optedOut.length > 0 || split.duplicate.length > 0) && (
                <p className="form-hint">
                  Left out: {[
                    split.noPhone.length > 0 ? `${split.noPhone.length} with no phone number` : '',
                    split.optedOut.length > 0 ? `${split.optedOut.length} who replied STOP` : '',
                    split.duplicate.length > 0 ? `${split.duplicate.length} sharing a number with someone else` : '',
                  ].filter(Boolean).join(', ')}.
                </p>
              )}
            </div>
            <ul className="ledger">
              {quiet.slice(0, limit).map(c => {
                const optedOut = c.sms_opted_out === true
                const canText = hasPhone(c.phone) && !optedOut
                const last = lastVisitOf(c, visits)
                return (
                  <li key={c.id}>
                    <div className="ledger-row">
                      <span className="lamp lamp-amber" aria-hidden="true" />
                      <span className="ledger-main">
                        <span className="ledger-title block">{c.name}</span>
                        <span className="ledger-sub block">{hasPhone(c.phone) ? phonePretty(c.phone) : 'No phone number'}</span>
                        <span className="ledger-sub block">{last ? `Last visit ${agoWords(last)}` : 'No visit on record'}</span>
                        {optedOut && <span className="mt-1 block"><Flagged>Texts off: replied STOP</Flagged></span>}
                      </span>
                      <button type="button" className="btn btn-secondary shrink-0" onClick={() => onText([c])} disabled={!canText} aria-label={`Text ${c.name}`}>Text</button>
                    </div>
                  </li>
                )
              })}
            </ul>
            {quiet.length > limit && (
              <button type="button" className="btn btn-secondary mt-3 w-full sm:w-auto" onClick={() => setLimit(n => n + PAGE)}>
                Show {Math.min(PAGE, quiet.length - limit)} more of {quiet.length - limit}
              </button>
            )}
          </>
        )}
    </Section>
  )
}
