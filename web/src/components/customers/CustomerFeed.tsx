'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { formatCurrency } from '@/lib/supabase'
import { monthHeading } from '@/lib/customers/timeline'
import type { TimelineItem } from '@/lib/customers/timeline'
import { FEED_FILTERS, FEED_PAGE, KIND_ICON, countByFilter, filterLabel, itemsFor, readFeedItems, showsTime, toneMark } from '@/lib/customers/feed-view'
import type { FeedFilter } from '@/lib/customers/feed-view'
import { asTextList, fetchJson } from './http'
import { fmtDay, fmtDayTime } from './types'

function FeedRow({ item }: { item: TimelineItem }) {
  const mark = toneMark(item)
  const when = showsTime(item.kind) ? fmtDayTime(item.at) : fmtDay(item.at)
  // The lamp already says "Paid" or "Missed"; do not say it twice.
  const detail = item.detail && item.detail.toLowerCase() !== mark?.word.toLowerCase() ? item.detail : ''
  const body = (
    <>
      <Icon name={KIND_ICON[item.kind]} className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" />
      <span className="ledger-main">
        <span className="ledger-title block !whitespace-normal break-words">{item.title}</span>
        {detail && <span className="mt-0.5 block line-clamp-3 break-words text-[0.9375rem] text-text-secondary">{detail}</span>}
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.9375rem] text-text-secondary">
          {when && <span>{when}</span>}
          {mark && (
            <span className={`flex items-center gap-1.5 font-bold ${mark.lamp === 'red' ? 'text-red' : 'text-text-primary'}`}>
              <span className={`lamp lamp-${mark.lamp}`} aria-hidden="true" />{mark.word}
            </span>
          )}
        </span>
      </span>
      {item.amount !== null && <span className="ledger-amt shrink-0">{formatCurrency(item.amount)}</span>}
    </>
  )
  return item.href
    ? <Link href={item.href} className="ledger-row !items-start no-underline">{body}</Link>
    : <div className="ledger-row !items-start">{body}</div>
}

/**
 * The feed once it has loaded: a chip for each kind of thing with how many there are, the rows in months, and a button that
 * shows 20 more. Exported so it can be drawn with test data.
 */
export function FeedView({ items, notes, total }: { items: TimelineItem[]; notes: string[]; total: number }) {
  const [filter, setFilter] = useState<FeedFilter>('all')
  const [shown, setShown] = useState(FEED_PAGE)
  const counts = useMemo(() => countByFilter(items), [items])
  const matching = useMemo(() => itemsFor(items, filter), [items, filter])
  const visible = useMemo(() => matching.slice(0, shown), [matching, shown])
  const months = useMemo(() => {
    const out: { heading: string; rows: TimelineItem[] }[] = []
    for (const row of visible) {
      const heading = monthHeading(row.at)
      const last = out[out.length - 1]
      if (last && last.heading === heading) last.rows.push(row)
      else out.push({ heading, rows: [row] })
    }
    return out
  }, [visible])

  return (
    <div className="space-y-3">
      {notes.length > 0 && (
        <Notice kind="warn">
          <p className="font-bold">Some of this could not be shown.</p>
          {notes.map(n => <p key={n} className="mt-0.5 break-words">{n}</p>)}
        </Notice>
      )}

      {items.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-[0.9375rem] text-text-secondary">
          {notes.length > 0
            ? 'Nothing yet for this customer in the parts that could be read.'
            : 'Nothing yet for this customer. Estimates, invoices, repair orders, texts and calls show here as they happen.'}
        </p>
      ) : (
        <>
          <div role="group" aria-label="Show only" className="flex flex-wrap gap-2">
            {FEED_FILTERS.map(f => {
              const on = f === filter
              return (
                <button
                  key={f} type="button" aria-pressed={on}
                  className={`inline-flex min-h-[44px] items-center gap-2 rounded-full border px-4 text-[0.9375rem] font-bold ${on ? 'border-blue bg-blue/10 text-blue' : 'border-line bg-bg-card hover:bg-bg-hover'}`}
                  onClick={() => { setFilter(f); setShown(FEED_PAGE) }}
                >
                  {filterLabel(f)}<span className="num font-normal">{counts[f]}</span>
                </button>
              )
            })}
          </div>

          {matching.length === 0 ? (
            <p className="rounded-lg border border-dashed border-border p-4 text-[0.9375rem] text-text-secondary">
              Nothing under {filterLabel(filter)} yet for this customer.
            </p>
          ) : (
            <div className="space-y-4">
              {months.map(m => (
                <div key={m.heading}>
                  <h4 className="mb-1 text-[0.9375rem] font-bold text-text-secondary">{m.heading}</h4>
                  <ul className="ledger">
                    {m.rows.map(r => <li key={r.id}><FeedRow item={r} /></li>)}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {matching.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[0.9375rem] text-text-secondary" aria-live="polite">
                Showing <span className="num font-bold">{visible.length}</span> of <span className="num font-bold">{matching.length}</span>
              </p>
              {visible.length < matching.length && (
                <button type="button" className="btn btn-secondary" onClick={() => setShown(n => n + FEED_PAGE)}>Show more</button>
              )}
            </div>
          )}

          {total > items.length && (
            <p className="text-[0.9375rem] text-text-secondary">
              This list holds the newest <span className="num">{items.length}</span> of <span className="num">{total}</span>. Older ones are on the Estimates, Invoices, Jobs and Messages screens.
            </p>
          )}
        </>
      )}
    </div>
  )
}

/**
 * Everything that has happened with one customer in one list: paperwork, repair orders, appointments, inspections, texts,
 * calls and notes, newest first, with a filter for each kind. Read only.
 */
export default function CustomerFeed({ customerId }: { customerId: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [items, setItems] = useState<TimelineItem[]>([])
  const [notes, setNotes] = useState<string[]>([])
  const [total, setTotal] = useState(0)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const mine = ++seq.current
    setState('loading')
    try {
      const r = await fetchJson(`/api/customers/feed?customer_id=${encodeURIComponent(customerId)}`, { cache: 'no-store' })
      if (mine !== seq.current) return
      if (!r.ok || !r.data || r.data.ok !== true) { setState('error'); return }
      const list = readFeedItems(r.data.items)
      setItems(list)
      setNotes(asTextList(r.data.notes))
      setTotal(typeof r.data.total === 'number' && Number.isFinite(r.data.total) ? Math.max(r.data.total, list.length) : list.length)
      setState('ready')
    } catch {
      if (mine === seq.current) setState('error')
    }
  }, [customerId])

  useEffect(() => { void load(); return () => { seq.current += 1 } }, [load])

  if (state === 'loading') return <div className="space-y-2" aria-busy="true" aria-label="Loading everything with this customer" role="status">{[0, 1, 2].map(i => <div key={i} className="skeleton h-14" />)}</div>
  if (state === 'error') {
    return (
      <div role="alert" className="rounded-lg border border-red/40 bg-red/[0.08] p-4">
        <p className="font-bold text-red">Everything with this customer could not be loaded.</p>
        <p className="mt-1 text-[0.9375rem] text-text-secondary">Check your connection and try again.</p>
        <button type="button" className="btn btn-secondary mt-3" onClick={() => void load()}>Try again</button>
      </div>
    )
  }
  return <FeedView items={items} notes={notes} total={total} />
}
