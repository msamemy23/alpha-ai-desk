'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import Notice from '@/components/Notice'
import { FilterChips } from '@/components/ListKit'
import {
  aging, byMethod, callStats, change, collectedOn, isSale, money, money2, series, spanDays, summarize, topCustomers, topParts, topRepairs, unrecordedPaid,
} from '@/lib/reports'
import type { ReportCall } from '@/lib/reports'
import { approvalStats, carCount, docsById, effectiveLaborRate, grossProfit, repeatVisits } from '@/lib/report-metrics'
import { whatChanged } from '@/lib/report-summary'
import { BarChart, Block, DeltaLine, Kpi, Line, Rank } from './parts'
import type { Ctx } from './types'
import { dayOfStamp } from './useReportData'

type Measure = 'collected' | 'invoiced'
const hourOf = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? -1 : d.getHours() }
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** The first thing the owner sees: a few plain sentences about what changed, then the numbers behind them. */
export default function OverviewTab({ ctx, calls, laborCostPerHour }: { ctx: Ctx; calls: ReportCall[] | null; laborCostPerHour: number | null }) {
  const { docs, payments, range, previous, todayKey, vs, phrase } = ctx
  const [measure, setMeasure] = useState<Measure>('collected')

  const byId = useMemo(() => new Map(docs.map(d => [d.id, d])), [docs])
  const now = useMemo(() => summarize(docs, payments, range), [docs, payments, range])
  const before = useMemo(() => (previous ? summarize(docs, payments, previous) : null), [docs, payments, previous])
  const owed = useMemo(() => aging(docs, todayKey), [docs, todayKey])
  const unrecorded = useMemo(() => unrecordedPaid(docs, payments), [docs, payments])
  const methods = useMemo(() => byMethod(payments, byId, range), [payments, byId, range])
  const repairs = useMemo(() => topRepairs(docs, range, 6), [docs, range])
  const parts = useMemo(() => topParts(docs, range, 6), [docs, range])
  const customers = useMemo(() => topCustomers(docs, range, 5), [docs, range])
  const cars = useMemo(() => carCount(docs, range), [docs, range])
  const labor = useMemo(() => effectiveLaborRate(docs, range, ctx.shop.postedRate), [docs, range, ctx.shop.postedRate])
  const profit = useMemo(() => grossProfit(docs, range, { laborCostPerHour }), [docs, range, laborCostPerHour])
  const approval = useMemo(() => approvalStats(docs, range, todayKey), [docs, range, todayKey])
  const repeats = useMemo(() => repeatVisits(docs, range), [docs, range])

  const chart = useMemo(() => series(range, measure === 'collected'
    ? payments.map(p => ({ date: collectedOn(p, byId), amount: p.amount }))
    : docs.filter(isSale).map(d => ({ date: d.date, amount: d.total }))), [range, measure, payments, docs, byId])

  const callNow = useMemo(() => (calls ? callStats(calls, range, dayOfStamp, hourOf) : null), [calls, range])
  const callBefore = useMemo(() => (calls && previous ? callStats(calls, previous, dayOfStamp, hourOf) : null), [calls, previous])
  const summary = useMemo(() => whatChanged({
    docs, payments, range, previous, todayKey, phrase, vs,
    calls: callNow && callBefore ? { now: callNow.inbound, before: callBefore.inbound } : null,
  }), [docs, payments, range, previous, todayKey, phrase, vs, callNow, callBefore])

  const nothing = now.invoices === 0 && now.collected === 0
  const days = spanDays(range)
  const oldest = owed.open[0]
  const billedTotal = now.labor + now.parts + now.fees + now.tax
  const sales = useMemo(() => docs.filter(d => isSale(d) && d.date >= range.from && d.date <= range.to), [docs, range])
  const lamp = { good: 'green', watch: 'amber', info: 'blue' } as const
  const word = { good: 'Good news', watch: 'Worth a look', info: 'For your information' } as const

  return (
    <div className="space-y-4">
      <section className="panel" aria-labelledby="what-changed">
        <div className="panel-header"><h2 id="what-changed" className="section-title">What changed</h2></div>
        <div className="panel-body">
          <p className="display text-[1.25rem] font-bold leading-snug text-text-primary">{summary.headline}</p>
          {summary.points.length > 0 && (
            <ul className="mt-3 space-y-2">
              {summary.points.map((p, i) => (
                <li key={i} className="flex items-start gap-2.5 text-[1rem] leading-snug text-text-primary">
                  <span className={`lamp lamp-${lamp[p.tone]} mt-[0.4rem] shrink-0`} aria-hidden="true" />
                  <span><span className="sr-only">{word[p.tone]}: </span>{p.text}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[0.875rem] text-text-secondary">Written from your invoices, payments and calls. No guessing.</p>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Kpi label="Collected" value={money(now.collected)} note={plural(now.payments, 'payment')}>
          <DeltaLine change={before ? change(now.collected, before.collected) : null} vs={vs} />
        </Kpi>
        <Kpi label="Invoiced" value={money(now.invoiced)} note="Billed on invoices and receipts" open={now.invoices ? { label: 'See the invoices', run: () => ctx.drill({ title: 'Invoiced', sub: ctx.title, docs: sales }) } : undefined}>
          <DeltaLine change={before ? change(now.invoiced, before.invoiced) : null} vs={vs} />
        </Kpi>
        <Kpi label="Average invoice" value={now.invoices ? money(now.average) : '$0'} note={`${plural(now.invoices, 'invoice')} written. Tax included.`}>
          <DeltaLine change={before ? change(now.average, before.average) : null} vs={vs} />
        </Kpi>
        <Kpi
          label="Still owed to you"
          value={money(owed.total)}
          note={owed.open.length ? `${plural(owed.open.length, 'open invoice')}, oldest ${plural(oldest.days, 'day')}` : 'Every invoice is paid'}
          open={owed.open.length ? { label: 'See who owes you', run: () => ctx.drill({ title: 'Still owed to you', sub: 'All time, not just this period', docs: owed.open.map(o => o.doc), amountLabel: 'owed', amount: d => d.balance }) } : undefined}
        >
          <p className="mt-1 text-[0.875rem] text-text-secondary">All time, not just this period</p>
        </Kpi>
        <Kpi
          label="Cars serviced"
          value={String(cars.cars)}
          note={cars.newCustomers + cars.returningCustomers > 0 ? `${cars.newCustomers} new ${cars.newCustomers === 1 ? 'customer' : 'customers'}, ${cars.returningCustomers} returning` : plural(cars.orders, 'invoice written')}
          open={cars.orders ? { label: 'See the invoices', run: () => ctx.drill({ title: 'Cars serviced', sub: ctx.title, docs: sales }) } : undefined}
        />
        <Kpi
          label="Labor rate you earn"
          value={labor.rate === null ? '—' : `${money2(labor.rate)}/h`}
          note={labor.rate === null ? (labor.flatLines ? 'Labor was priced as a whole, with no hours to divide by' : 'No hourly labor in this period') : labor.posted !== null ? `You post ${money2(labor.posted)}/h. ${labor.gap !== null && Math.abs(labor.gap) >= 0.5 ? (labor.gap > 0 ? `You earn ${money2(labor.gap)} less per hour.` : `You earn ${money2(-labor.gap)} more per hour.`) : 'About the same.'}` : `${labor.hours} hours billed`}
        />
        <Kpi
          label="Gross profit"
          value={profit.partsCost > 0 || profit.laborCost !== null ? money(profit.gross) : '—'}
          note={profit.partsCost > 0 || profit.laborCost !== null ? `${profit.marginPct ?? 0}% of ${money(profit.revenue)} sold${profit.incomplete ? `. ${plural(profit.incomplete, 'job')} missing a part cost` : ''}` : profit.partLines ? 'Write the cost on part lines to see profit' : 'Nothing sold in this period'}
        />
        <Kpi
          label="Estimates approved online"
          value={approval.ratePct === null ? '—' : `${approval.ratePct}%`}
          note={approval.sent ? `${approval.approved} of ${approval.sent} sent for online approval` : 'Nothing was sent for online approval'}
          open={approval.waiting ? { label: `${plural(approval.waiting, 'estimate')} still waiting`, run: () => ctx.drill({ title: 'Estimates waiting for approval', sub: 'Sent for online approval, not approved yet', docs: docsById(docs, approval.waitingIds) }) } : undefined}
        />
        <Kpi
          label="Repeat visits"
          value={repeats.ratePct === null ? '—' : `${repeats.ratePct}%`}
          note={repeats.considered ? `${repeats.count} of ${repeats.considered} cars came back within ${repeats.withinDays} days` : 'No cars named on invoices in this period'}
          open={repeats.count ? { label: 'See which cars', run: () => ctx.drill({ title: 'Cars that came back', sub: `Back within ${repeats.withinDays} days of an earlier invoice. Some are new problems, not comebacks.`, docs: repeats.list.map(r => r.doc) }) } : undefined}
        />
        {callNow
          ? <Kpi label="Incoming calls" value={String(callNow.inbound)} note={callNow.short ? `${callNow.short} hung up in seconds` : 'Calls to your shop number'}><DeltaLine change={callBefore ? change(callNow.inbound, callBefore.inbound) : null} vs={vs} /></Kpi>
          : <Kpi label="Incoming calls" value="Not loaded" note="The call log did not load. Open the Calls tab to try again." />}
      </div>

      {!ctx.extended && (
        <Notice kind="info">Your database does not have the advisor, car and approval columns yet, so cars serviced, repeat visits and the approval rate cannot be worked out. Everything else here is unaffected.</Notice>
      )}

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
          Nothing was invoiced or collected in these {plural(days, 'day')}. Pick a longer period above to see earlier work.
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
            rows={methods.map(m => ({ key: m.label, label: m.label, value: m.amount, shown: money2(m.amount), sub: plural(m.count, 'payment') }))}
          />
        </Block>
        <Block title="Repairs you sold most" right={<span className="text-[0.875rem] text-text-secondary">By invoices</span>}>
          <Rank
            empty="No labor lines in this period. Name each repair on its labor line and the most common ones show here."
            rows={repairs.map(r => ({ key: r.label, label: r.label, value: r.count, shown: plural(r.count, 'invoice'), sub: `${money2(r.amount)} billed` }))}
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
              sub: plural(c.count, 'invoice'), href: c.customerId ? `/customers?customer=${encodeURIComponent(c.customerId)}` : undefined,
            }))}
          />
        </Block>
      </div>
    </div>
  )
}
