'use client'
import { useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import { EmptyBlock, ErrorCard, RowsSkeleton, SearchField } from '@/components/ListKit'
import { phonePretty } from '@/lib/today'
import { hasPhone } from '@/lib/growth-text'
import { Flagged, PAGE, Section } from './parts'
import ReferralResults from './ReferralResults'
import type { Rec } from './helpers'

interface Props {
  loading: boolean
  failed: boolean
  customers: Rec[]
  referrals: Rec[]
  onRetry: () => void
  onCreate: (customer: Rec) => void
  notify: (message: string, kind?: 'success' | 'error' | 'info') => void
}

export default function ReferralsTab({ loading, failed, customers, referrals, onRetry, onCreate, notify }: Props) {
  const [search, setSearch] = useState('')
  const [limit, setLimit] = useState(PAGE)
  const byCustomer = useMemo(() => new Map(referrals.map(r => [String(r.customer_id), r])), [referrals])
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const digits = q.replace(/\D/g, '')
    return customers.filter(c => !q || String(c.name || '').toLowerCase().includes(q) || (digits.length > 2 && String(c.phone || '').replace(/\D/g, '').includes(digits)))
  }, [customers, search])

  const copy = async (code: string) => {
    try { await navigator.clipboard.writeText(code); notify(`Code ${code} copied.`, 'success') }
    catch { notify('The code could not be copied. Press and hold it to copy.', 'error') }
  }

  return (
    <>
    <Section title="Referral codes" hint="Give a happy customer a code to share. You choose the discount and see the text before it goes.">
      {failed ? <ErrorCard title="Referral codes did not load" message="Check your connection and try again." onRetry={onRetry} busy={loading} />
        : loading ? <RowsSkeleton rows={5} label="Loading customers" />
        : customers.length === 0 ? <EmptyBlock icon="customers" title="No customers yet">When you have customers you can give them referral codes here.</EmptyBlock>
        : (
          <>
            <SearchField className="mb-3 max-w-md" value={search} onChange={v => { setSearch(v); setLimit(PAGE) }} label="Find a customer" placeholder="Find a customer by name or phone" />
            {rows.length === 0 ? <EmptyBlock title="No customers match">Try a different name or phone number.</EmptyBlock> : (
              <ul className="ledger">
                {rows.slice(0, limit).map(c => {
                  const ex = byCustomer.get(String(c.id))
                  const optedOut = c.sms_opted_out === true
                  return (
                    <li key={c.id}>
                      <div className="ledger-row">
                        <span className="ledger-main">
                          <span className="ledger-title block">{c.name}</span>
                          <span className="ledger-sub block">{ex ? `Code ${ex.code} · used ${ex.uses || 0} ${(ex.uses || 0) === 1 ? 'time' : 'times'}` : hasPhone(c.phone) ? phonePretty(c.phone) : 'No phone number'}</span>
                          {optedOut && !ex && <span className="mt-1 block"><Flagged>Texts off: replied STOP</Flagged></span>}
                        </span>
                        {ex ? (
                          <span className="inline-flex shrink-0 items-center gap-1">
                            <span className="inline-flex items-center gap-2 pr-1 font-bold"><span className="lamp lamp-green" aria-hidden="true" />Active</span>
                            <button type="button" className="btn-icon" onClick={() => copy(String(ex.code))} aria-label={`Copy code ${ex.code}`}><Icon name="copy" className="h-5 w-5" /></button>
                          </span>
                        ) : (
                          <button type="button" className="btn btn-secondary shrink-0" onClick={() => onCreate(c)} aria-label={`Give ${c.name} a referral code`}>Give a code</button>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
            {rows.length > limit && (
              <button type="button" className="btn btn-secondary mt-3 w-full sm:w-auto" onClick={() => setLimit(n => n + PAGE)}>Show {Math.min(PAGE, rows.length - limit)} more of {rows.length - limit}</button>
            )}
          </>
        )}
    </Section>
    <ReferralResults notify={notify} />
    </>
  )
}
