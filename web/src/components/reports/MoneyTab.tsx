'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { aging, collectedOn, inRange, methodLabel, money2, paymentsCsv, quarters, rangeLabel } from '@/lib/reports'
import type { Owed } from '@/lib/reports'
import { Block, Rank } from './parts'
import type { Ctx } from './types'

const fmtDate = (k: string) => (k ? new Date(`${k.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'No date')
const dayWord = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`
const ageLamp = (days: number) => (days > 60 ? 'red' : days > 30 ? 'amber' : 'off')
const BAR = ['bg-text-primary/30', 'bg-amber/60', 'bg-amber', 'bg-red']
const link = (d: Owed['doc']) => `${d.type === 'Receipt' ? '/receipts' : '/invoices'}?document=${encodeURIComponent(d.id)}`

/** Download text as a file the browser saves. */
function saveText(name: string, text: string) {
  const url = URL.createObjectURL(new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export default function MoneyTab({ ctx }: { ctx: Ctx }) {
  const { docs, payments, range, todayKey } = ctx
  const [allOwed, setAllOwed] = useState(false)
  const [allPaid, setAllPaid] = useState(false)
  const [fileError, setFileError] = useState('')

  const byId = useMemo(() => new Map(docs.map(d => [d.id, d])), [docs])
  const owed = useMemo(() => aging(docs, todayKey), [docs, todayKey])
  const mine = useMemo(() => payments
    .map(p => ({ p, date: collectedOn(p, byId) }))
    .filter(x => inRange(x.date, range))
    .sort((a, b) => b.date.localeCompare(a.date) || b.p.amount - a.p.amount), [payments, byId, range])
  const received = useMemo(() => Math.round(mine.reduce((s, x) => s + x.p.amount, 0) * 100) / 100, [mine])
  const qs = useMemo(() => quarters(docs, payments).slice(0, 8), [docs, payments])

  const download = () => {
    try {
      saveText(`payments-${range.from}-to-${range.to}.csv`, paymentsCsv(payments, docs, range))
      setFileError('')
    } catch { setFileError('The file could not be made. Try again, or pick a shorter period.') }
  }

  const owedRows = allOwed ? owed.open : owed.open.slice(0, 8)
  const paidRows = allPaid ? mine : mine.slice(0, 10)

  return (
    <div className="space-y-4">
      <Block title="Who owes you" right={<span className="num text-[1.0625rem] font-bold">{money2(owed.total)}</span>}>
        {owed.open.length === 0 ? (
          <p className="text-text-secondary">Every invoice is paid. Nothing is owed.</p>
        ) : (
          <>
            <div className="flex h-3 overflow-hidden rounded-full bg-text-primary/10" aria-hidden="true">
              {owed.buckets.map((b, i) => b.amount > 0 && <div key={b.key} className={BAR[i]} style={{ width: `${(b.amount / owed.total) * 100}%` }} />)}
            </div>
            <ul className="mt-3 grid gap-x-6 sm:grid-cols-2">
              {owed.buckets.map((b, i) => (
                <li key={b.key} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="flex items-center gap-2 text-text-secondary">
                    <span className={`h-3 w-3 shrink-0 rounded-sm ${BAR[i]}`} aria-hidden="true" />
                    {b.label}
                    <span className="text-text-muted">({b.count})</span>
                  </span>
                  <span className="num font-bold text-text-primary">{money2(b.amount)}</span>
                </li>
              ))}
            </ul>
            <ul className="ledger mt-4">
              {owedRows.map(o => (
                <li key={o.doc.id}>
                  <Link href={link(o.doc)} className="ledger-row">
                    <span className="ledger-main">
                      <span className="ledger-title block">{o.doc.customer || 'No customer name'}</span>
                      <span className="ledger-sub !whitespace-normal block">{[o.doc.number, `Written ${fmtDate(o.doc.date)}`, o.doc.paid > 0 ? `${money2(o.doc.paid)} paid so far` : ''].filter(Boolean).join(' · ')}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[0.875rem] font-bold text-text-secondary">
                        <span className={`lamp lamp-${ageLamp(o.days)} !h-2.5 !w-2.5`} aria-hidden="true" />
                        {dayWord(o.days)} old
                      </span>
                    </span>
                    <span className="ledger-amt">{money2(o.doc.balance)}</span>
                    <Icon name="chevronRight" className="h-5 w-5 shrink-0 text-text-muted" />
                  </Link>
                </li>
              ))}
            </ul>
            {owed.open.length > 8 && (
              <button type="button" className="btn btn-secondary mt-3" onClick={() => setAllOwed(v => !v)}>
                {allOwed ? 'Show fewer' : `Show all ${owed.open.length}`}
              </button>
            )}
          </>
        )}
      </Block>

      <Block
        title="Payments received"
        right={<span className="num text-[1.0625rem] font-bold">{money2(received)}</span>}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-text-secondary">{mine.length} {mine.length === 1 ? 'payment' : 'payments'}, {rangeLabel(range)}</p>
          <button type="button" className="btn btn-secondary" onClick={download} disabled={mine.length === 0}>
            <Icon name="download" className="h-5 w-5" />
            Download payments
          </button>
        </div>
        {fileError && <Notice kind="error" className="mb-3">{fileError}</Notice>}
        {mine.length === 0 ? (
          <p className="text-text-secondary">No payments were received in this period.</p>
        ) : (
          <>
            <ul className="ledger">
              {paidRows.map(({ p, date }) => {
                const d = p.docId ? byId.get(p.docId) : undefined
                const row = (
                  <>
                    <span className="ledger-main">
                      <span className="ledger-title block">{p.customer || d?.customer || 'No customer name'}</span>
                      <span className="ledger-sub !whitespace-normal block">{[fmtDate(date), methodLabel(p.method), d?.number].filter(Boolean).join(' · ')}</span>
                    </span>
                    <span className="ledger-amt">{money2(p.amount)}</span>
                  </>
                )
                return <li key={p.id}>{d ? <Link href={link(d)} className="ledger-row">{row}<Icon name="chevronRight" className="h-5 w-5 shrink-0 text-text-muted" /></Link> : <div className="ledger-row">{row}</div>}</li>
              })}
            </ul>
            {mine.length > 10 && (
              <button type="button" className="btn btn-secondary mt-3" onClick={() => setAllPaid(v => !v)}>
                {allPaid ? 'Show fewer' : `Show all ${mine.length}`}
              </button>
            )}
          </>
        )}
      </Block>

      <Block title="By quarter, for your tax return">
        <Rank
          empty="Nothing to total yet."
          rows={qs.map(q => ({
            key: q.label, label: q.label, value: q.collected, shown: money2(q.collected),
            sub: `Collected. Billed ${money2(q.invoiced)} on ${q.invoices} ${q.invoices === 1 ? 'invoice' : 'invoices'}, sales tax ${money2(q.tax)}`,
          }))}
        />
        <p className="mt-3 text-[0.875rem] text-text-secondary">
          Quarters are calendar quarters and do not change with the period above. Sales tax is what was charged on invoices written that quarter, not what has been paid to the state.
        </p>
      </Block>
    </div>
  )
}
