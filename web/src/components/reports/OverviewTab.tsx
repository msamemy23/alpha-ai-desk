'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import Notice from '@/components/Notice'
import { FilterChips } from '@/components/ListKit'
import {
  aging, byMethod, callStats, change, collectedOn, isSale, money, money2, partsMargin, series, spanDays, summarize, topCustomers, topParts, topRepairs, unrecordedPaid, vsLabel,
} from '@/lib/reports'
import type { ReportCall } from '@/lib/reports'
import { BarChart, Block, DeltaLine, Kpi, Line, Rank } from './parts'
import type { Ctx } from './types'
import { dayOfStamp } from './useReportData'
import type { Source } from './useReportData'

type Measure = 'collected' | 'invoiced'
const hourOf = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? -1 : d.getHours() }

export default function OverviewTab({ ctx, calls }: { ctx: Ctx; calls: Source<ReportCall> }) {
  const { docs, payments, range, previous, todayKey, period } = ctx
  const [measure, setMeasure] = useState<Measure>('collected')
  const vs = vsLabel(period)

  const byId = useMemo(() => new Map(docs.map(d => [d.id, d])), [docs])
  const now = useMemo(() => summarize(docs, payments, range), [docs, payments, range])
  const before = useMemo(() => summarize(docs, payments, previous), [docs, payments, previous])
  const owed = useMemo(() => aging(docs, todayKey), [docs, todayKey])
  const unrecorded = useMemo(() => unrecordedPaid(docs, payments), [docs, payments])
  const methods = useMemo(() => byMethod(payments, byId, range), [payments, byId, range])
  const repairs = useMemo(() => topRepairs(docs, range, 6), [docs, range])
  const parts = useMemo(() => topParts(docs, range, 6), [docs, range])
  const margin = useMemo(() => partsMargin(docs, range), [docs, range])
  const customers = useMemo(() => topCustomers(docs, range, 5), [docs, range])

  const chart = useMemo(() => series(range, measure === 'collected'
    ? payments.map(p => ({ date: collectedOn(p, byId), amount: p.amount }))
    : docs.filter(isSale).map(d => ({ date: d.date, amount: d.total }))), [range, measure, payments, docs, byId])

  const callsOk = calls.loaded && !calls.error
  const callNow = useMemo(() => (callsOk ? callStats(calls.rows, range, dayOfStamp, hourOf) : null), [callsOk, calls.rows, range])
  const callBefore = useMemo(() => (callsOk ? callStats(calls.rows, previous, dayOfStamp, hourOf) : null), [callsOk, calls.rows, previous])

  const nothing = now.invoices === 0 && now.collected === 0
  const days = spanDays(range)
  const oldest = owed.open[0]
  const billedTotal = now.labor + now.parts + now.fees + now.tax

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi label="Collected" value={money(now.collected)} note={`${now.payments} ${now.payments === 1 ? 'payment' : 'payments'}`}>
          <DeltaLine change={change(now.collected, before.collected)} vs={vs} />
        </Kpi>
        <Kpi label="Invoiced" value={money(now.invoiced)} note="Billed on invoices and receipts">
          <DeltaLine change={change(now.invoiced, before.invoiced)} vs={vs} />
        </Kpi>
        <Kpi label="Average invoice" value={now.invoices ? money(now.average) : '$0'} note={`${now.invoices} ${now.invoices === 1 ? 'invoice' : 'invoices'} written`}>
          <DeltaLine change={change(now.average, before.average)} vs={vs} />
        </Kpi>
        <Kpi
          label="Still owed to you"
          value={money(owed.total)}
          note={owed.open.length ? `${owed.open.length} open ${owed.open.length === 1 ? 'invoice' : 'invoices'}, oldest ${oldest.days} ${oldest.days === 1 ? 'day' : 'days'}` : 'Every invoice is paid'}
        >
          <p className="mt-1 text-[0.875rem] text-text-secondary">All time, not just this period</p>
        </Kpi>
        <Kpi label="Parts profit" value={margin.costed ? money(margin.profit) : '—'} note={margin.costed ? (margin.costed === margin.lines ? `${margin.pct}% margin on ${margin.lines} part ${margin.lines === 1 ? 'line' : 'lines'}` : `${margin.pct}% margin, counting ${margin.costed} of ${margin.lines} part lines that have a cost`) : margin.lines ? `Write the cost on part lines to see profit (${margin.lines} lines have none)` : 'No parts sold in this period'} />
        {callsOk && callNow && callBefore
          ? <Kpi label="Incoming calls" value={String(callNow.inbound)} note={callNow.short ? `${callNow.short} hung up in seconds` : "Calls to your shop number"}><DeltaLine change={change(callNow.inbound, callBefore.inbound)} vs={vs} /></Kpi>
          : <Kpi label="Incoming calls" value="Not loaded" note={calls.error || 'Loading'} />}
      </div>

      {unrecorded.count > 0 && (
        <Notice kind="warn">
          <p className="font-bold">{unrecorded.count} {unrecorded.count === 1 ? 'invoice is' : 'invoices are'} marked Paid with no payment recorded</p>
          <p className="mt-0.5 text-text-secondary">
            Together they total {money2(unrecorded.amount)}. They are left out of Collected because nothing says how much came in or how.
            {' '}<Link href="/invoices" className="font-bold text-blue underline">Open invoices</Link> and record the payment to count them.
          </p>
        </Notice>
      )}

      {nothing && (
        <Notice kind="info">
          Nothing was invoiced or collected in these {days} {days === 1 ? 'day' : 'days'}. Pick a longer period above to see earlier work.
        </Notice>
      )}

      <Block title={measure === 'collected' ? 'Money collected' : 'Money billed'}>
        <div className="mb-4">
          <FilterChips<Measure> label="What the chart shows" value={measure} onChange={setMeasure} options={[{ key: 'collected', label: 'Collected' }, { key: 'invoiced', label: 'Invoiced' }]} />
        </div>
        <BarChart buckets={chart.buckets} format={money} what={measure === 'collected' ? 'Money collected' : 'Money billed on invoices'} />
        <p className="mt-3 text-[0.875rem] text-text-secondary">
          {measure === 'collected'
            ? 'Money counts on the day it was received. Payments brought in from past records count on the invoice date.'
            : 'Invoices count on the date written on them, not the day they were typed in.'}
        </p>
      </Block>

      <div className="grid gap-4 lg:grid-cols-2">
        <Block title="What you billed">
          {billedTotal > 0 ? (
            <div>
              <Line label="Labor" value={money2(now.labor)} />
              <Line label="Parts" value={money2(now.parts)} />
              <Line label="Shop supplies, sublet and core charges" value={money2(now.fees)} />
              <Line label="Sales tax" value={money2(now.tax)} />
              <Line label="Total invoiced" value={money2(now.invoiced)} strong />
            </div>
          ) : <p className="text-text-secondary">No invoices in this period.</p>}
        </Block>
        <Block title="How customers paid">
          <Rank
            empty="No payments in this period."
            rows={methods.map(m => ({ key: m.label, label: m.label, value: m.amount, shown: money2(m.amount), sub: `${m.count} ${m.count === 1 ? 'payment' : 'payments'}` }))}
          />
        </Block>
        <Block title="Repairs you sold most" right={<span className="text-[0.875rem] text-text-secondary">By invoices</span>}>
          <Rank
            empty="No labor lines in this period. Name each repair on its labor line and the most common ones show here."
            rows={repairs.map(r => ({ key: r.label, label: r.label, value: r.count, shown: `${r.count} ${r.count === 1 ? 'invoice' : 'invoices'}`, sub: `${money2(r.amount)} billed` }))}
          />
        </Block>
        <Block title="Parts you sold most" right={<span className="text-[0.875rem] text-text-secondary">By money</span>}>
          <Rank
            empty="No parts sold in this period."
            rows={parts.map(r => ({ key: r.label, label: r.label, value: r.amount, shown: money2(r.amount), sub: `${r.count} sold` }))}
          />
        </Block>
        <Block title="Customers who spent the most" className="lg:col-span-2">
          <Rank
            empty="No named customers in this period. Walk-ins and invoices with no customer name are left out."
            rows={customers.map(c => ({
              key: c.customerId || c.name, label: c.name, value: c.amount, shown: money2(c.amount),
              sub: `${c.count} ${c.count === 1 ? 'invoice' : 'invoices'}`, href: c.customerId ? `/customers?customer=${encodeURIComponent(c.customerId)}` : undefined,
            }))}
          />
        </Block>
      </div>
    </div>
  )
}
