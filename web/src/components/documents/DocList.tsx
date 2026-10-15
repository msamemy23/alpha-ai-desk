'use client'
import { useMemo } from 'react'
import { calcTotals, formatCurrency } from '@/lib/supabase'
import { money0, ageLabel } from '@/lib/today'
import { docLamp, docStatusLabel } from '@/lib/doc-status'
import Icon from '@/components/Icon'
import { docCar, docWord } from './types'
import type { Doc, DocType } from './types'

export type ListFilter = 'all' | 'draft' | 'waiting' | 'approved' | 'unpaid' | 'part' | 'paid'

const OWED = new Set(['Unpaid', 'Partial', 'Sent'])

interface Row { doc: Doc; total: number; balance: number; owes: boolean }

/** The filter chips for each page, in order. */
const FILTERS: Record<'Estimate' | 'Invoice', { id: ListFilter; label: string }[]> = {
  Estimate: [
    { id: 'all', label: 'All' },
    { id: 'draft', label: 'Not sent' },
    { id: 'waiting', label: 'Waiting on customer' },
    { id: 'approved', label: 'Approved' },
  ],
  Invoice: [
    { id: 'all', label: 'All' },
    { id: 'unpaid', label: 'Unpaid' },
    { id: 'part', label: 'Part paid' },
    { id: 'paid', label: 'Paid' },
    { id: 'draft', label: 'Not sent' },
  ],
}

function matchesFilter(f: ListFilter, r: Row): boolean {
  const s = r.doc.status
  switch (f) {
    case 'all': return true
    case 'draft': return s === 'Draft'
    case 'waiting': return s === 'Sent'
    case 'approved': return s === 'Approved'
    case 'unpaid': return r.owes
    case 'part': return s === 'Partial'
    case 'paid': return s === 'Paid'
  }
}

export default function DocList({
  type, docs, loading, loadError, actionError, onDismissActionError, onRetry, onNew, onOpen, onQuickSend, onQuickPay,
  search, setSearch, filter, setFilter,
}: {
  type: DocType
  docs: Doc[]
  loading: boolean
  loadError: string | null
  actionError: string | null
  onDismissActionError: () => void
  onRetry: () => void
  onNew: () => void
  onOpen: (d: Doc) => void
  onQuickSend: (d: Doc) => void
  onQuickPay: (d: Doc) => void
  search: string
  setSearch: (v: string) => void
  filter: ListFilter
  setFilter: (f: ListFilter) => void
}) {
  const noun = docWord(type)
  const nouns = `${noun}s`
  const isEstimate = type === 'Estimate'
  const chips = FILTERS[isEstimate ? 'Estimate' : 'Invoice']

  const rows: Row[] = useMemo(() => docs.map(doc => {
    const t = calcTotals(doc as unknown as Record<string, unknown>)
    return { doc, total: t.total, balance: t.balanceDue, owes: OWED.has(doc.status) && t.balanceDue > 0.005 }
  }), [docs])

  const counts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const f of chips) c[f.id] = rows.filter(r => matchesFilter(f.id, r)).length
    return c
  }, [rows, chips])

  const summary = useMemo(() => {
    if (isEstimate) {
      const waiting = rows.filter(r => r.doc.status === 'Draft' || r.doc.status === 'Sent')
      return { n: waiting.length, sum: waiting.reduce((s, r) => s + r.total, 0) }
    }
    const owed = rows.filter(r => r.owes)
    return { n: owed.length, sum: owed.reduce((s, r) => s + r.balance, 0) }
  }, [rows, isEstimate])

  const q = search.trim().toLowerCase()
  const visible = rows.filter(r => {
    if (!matchesFilter(filter, r)) return false
    if (!q) return true
    const d = r.doc
    return [d.doc_number, d.customer_name, d.status, docStatusLabel(d.type, d.status), d.vehicle_year, d.vehicle_make, d.vehicle_model, d.vehicle_plate, d.vehicle_vin]
      .some(v => String(v || '').toLowerCase().includes(q))
  })

  const subtitle = loading && docs.length === 0 && !loadError
    ? 'Loading…'
    : docs.length === 0
      ? (isEstimate ? 'Write it, send it, get it approved.' : 'Bill the customer, then collect payment.')
      : isEstimate
        ? (summary.n ? `${summary.n} waiting, ${money0(summary.sum)}` : 'Nothing is waiting on a customer')
        : (summary.n ? `${summary.n} unpaid, ${money0(summary.sum)} to collect` : 'Everything is paid')

  const showSkeleton = loading && docs.length === 0 && !loadError
  const initialFailure = !!loadError && docs.length === 0

  return (
    <div className="page-container animate-fade-in">
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">{isEstimate ? 'Estimates' : 'Invoices'}</h1>
          <p className="page-subtitle num" aria-live="polite">{subtitle}</p>
        </div>
        <button type="button" className="btn btn-primary w-full sm:w-auto" onClick={onNew}>
          <Icon name="plus" className="h-5 w-5" />
          New {noun}
        </button>
      </header>

      {actionError && (
        <div role="alert" className="mb-4 flex items-start justify-between gap-3 rounded-md border border-red/50 bg-red/[0.08] px-4 py-3 text-[0.9375rem]">
          <p className="text-red">{actionError}</p>
          <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={onDismissActionError}>Dismiss</button>
        </div>
      )}

      {initialFailure ? (
        <div role="alert" className="card max-w-xl">
          <p className="font-bold text-red">Your {nouns} did not load</p>
          <p className="mt-1 text-[0.9375rem] text-text-secondary">{loadError}</p>
          <button type="button" className="btn btn-secondary mt-4" onClick={onRetry}>Try again</button>
        </div>
      ) : (
        <>
          {loadError && (
            <div role="alert" className="mb-4 flex items-center justify-between gap-3 rounded-md border border-red/50 bg-red/[0.08] px-4 py-3 text-[0.9375rem]">
              <p className="text-red">{loadError} What you see may be out of date.</p>
              <button type="button" className="btn btn-secondary btn-sm shrink-0" onClick={onRetry}>Try again</button>
            </div>
          )}

          {(docs.length > 0 || showSkeleton) && (
            <div className="mb-4 space-y-3">
              <div className="relative max-w-xl">
                <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted" />
                <input
                  type="search"
                  className="form-input pl-10"
                  placeholder="Search by name, number or vehicle"
                  aria-label={`Search ${nouns}`}
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  disabled={showSkeleton}
                />
              </div>
              <div className="flex flex-wrap gap-2" role="group" aria-label={`Filter ${nouns}`}>
                {chips.map(f => {
                  const on = filter === f.id
                  return (
                    <button
                      key={f.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setFilter(f.id)}
                      disabled={showSkeleton}
                      className={`inline-flex min-h-[44px] items-center gap-2 rounded-full border px-4 text-[0.9375rem] font-bold sm:min-h-[40px] ${on ? 'border-blue bg-blue/10 text-blue' : 'border-line bg-bg-card text-text-primary hover:bg-bg-hover'}`}
                    >
                      {f.label}
                      <span className={`num text-[0.8125rem] ${on ? 'text-blue' : 'text-text-secondary'}`}>{showSkeleton ? '' : counts[f.id] ?? 0}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {showSkeleton ? (
            <div className="space-y-2" aria-busy="true" aria-label={`Loading ${nouns}`}>
              {[0, 1, 2, 3, 4, 5].map(i => <div key={i} className="skeleton h-[4.25rem]" />)}
            </div>
          ) : docs.length === 0 ? (
            <div className="empty-state">
              <p className="font-bold text-text-primary">No {nouns} yet</p>
              <p className="mx-auto mt-1 max-w-md">
                {isEstimate
                  ? 'An estimate lists the parts and labor for a job. Send it to the customer for approval, then turn it into an invoice.'
                  : 'An invoice bills the customer for finished work. Turn an approved estimate into one, or write one from scratch.'}
              </p>
              <button type="button" className="btn btn-primary mt-4" onClick={onNew}>
                <Icon name="plus" className="h-5 w-5" />
                New {noun}
              </button>
            </div>
          ) : visible.length === 0 ? (
            <div className="empty-state">
              <p className="font-bold text-text-primary">
                {q ? `No ${nouns} match “${search.trim()}”` : `No ${nouns} here`}
              </p>
              <p className="mt-1">{q ? 'Check the spelling, or search by customer name, document number or vehicle.' : 'Nothing has this status right now.'}</p>
              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {q && <button type="button" className="btn btn-secondary" onClick={() => setSearch('')}>Clear search</button>}
                {filter !== 'all' && <button type="button" className="btn btn-secondary" onClick={() => setFilter('all')}>Show all {nouns}</button>}
              </div>
            </div>
          ) : (
            <section aria-label={`${isEstimate ? 'Estimates' : 'Invoices'} list`}>
              <div className="hidden items-center gap-3.5 px-3 pb-2 text-[0.8125rem] font-bold text-text-secondary lg:flex" aria-hidden="true">
                <span className="w-[0.7rem] shrink-0" />
                <span className="flex-1">Customer</span>
                <span className="w-44 shrink-0">Status</span>
                <span className="w-28 shrink-0 text-right">Age</span>
                <span className="w-28 shrink-0 text-right">Amount</span>
                <span className="w-[10.5rem] shrink-0" />
              </div>
              <ul className="ledger">
                {visible.map(({ doc: d, total, balance, owes }) => {
                  const lamp = docLamp(d.type, d.status)
                  const word = docStatusLabel(d.type, d.status)
                  const car = docCar(d)
                  const paid = d.status === 'Paid'
                  const wordTone = d.status === 'Unpaid' ? 'font-bold text-red' : d.status === 'Partial' ? 'font-bold text-amber' : 'text-text-secondary'
                  const wordFull = d.status === 'Partial' ? `${word}, ${formatCurrency(balance)} due` : word
                  const age = ageLabel(d.created_at)
                  const canPay = type !== 'Estimate' && owes
                  const canSend = d.status === 'Draft'
                  return (
                    <li key={d.id}>
                      <div className="flex items-center">
                        <button type="button" className="ledger-row min-w-0 flex-1" onClick={() => onOpen(d)} data-doc-id={d.id}>
                          <span className={`lamp lamp-${lamp}`} aria-hidden="true" />
                          <span className="ledger-main">
                            <span className="ledger-title block">{d.customer_name || 'No customer yet'}</span>
                            <span className="ledger-sub block">
                              {d.doc_number}{car ? ` · ${car}` : ''}<span className="lg:hidden">{age ? ` · ${age}` : ''}</span>
                            </span>
                          </span>
                          <span className={`hidden w-44 shrink-0 text-[0.9375rem] lg:block ${wordTone}`}>{wordFull}</span>
                          <span className="hidden w-28 shrink-0 text-right text-[0.9375rem] text-text-secondary lg:block">{age}</span>
                          <span className="w-auto shrink-0 text-right lg:w-28">
                            <span className={`ledger-amt block ${paid ? '!font-semibold text-text-secondary' : ''}`}>{formatCurrency(total)}</span>
                            <span className={`block text-[0.8125rem] lg:hidden ${wordTone}`}>{wordFull}</span>
                          </span>
                        </button>
                        <div className="hidden w-[10.5rem] shrink-0 justify-end pr-3 lg:flex">
                          {canPay ? (
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onQuickPay(d)} aria-label={`Record payment for ${d.customer_name || d.doc_number}`}>Record payment</button>
                          ) : canSend ? (
                            <button type="button" className="btn btn-secondary btn-sm" onClick={() => onQuickSend(d)} aria-label={`Send ${noun} to ${d.customer_name || d.doc_number}`}>Send {noun}</button>
                          ) : null}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
              <p className="mt-3 text-[0.8125rem] text-text-muted num">
                {visible.length === rows.length ? `${rows.length} ${rows.length === 1 ? noun : nouns}` : `Showing ${visible.length} of ${rows.length} ${nouns}`}
              </p>
            </section>
          )}
        </>
      )}
    </div>
  )
}
