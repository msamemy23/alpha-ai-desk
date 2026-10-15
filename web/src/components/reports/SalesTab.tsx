'use client'
import { useMemo } from 'react'
import Notice from '@/components/Notice'
import { money, money2, spanDays, summarize } from '@/lib/reports'
import { bundleFor } from '@/lib/report-bundles'
import type { BundleInput } from '@/lib/report-bundles'
import { carCount, docsById, effectiveLaborRate, NOT_RECORDED, revenueMix, salesByAdvisor, salesByCategory, salesByTech } from '@/lib/report-metrics'
import type { Slice } from '@/lib/report-metrics'
import ExportBar from './ExportBar'
import { Block, Kpi, Line, Rank } from './parts'
import type { Ctx } from './types'

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Sales split by kind of work, who wrote it and who did it. Tap any row to see the invoices it was added up from. */
export default function SalesTab({ ctx, input }: { ctx: Ctx; input: BundleInput }) {
  const { docs, payments, range } = ctx
  const now = useMemo(() => summarize(docs, payments, range), [docs, payments, range])
  const categories = useMemo(() => salesByCategory(docs, range), [docs, range])
  const advisors = useMemo(() => salesByAdvisor(docs, range), [docs, range])
  const techs = useMemo(() => salesByTech(docs, range), [docs, range])
  const mix = useMemo(() => revenueMix(docs, range), [docs, range])
  const cars = useMemo(() => carCount(docs, range), [docs, range])
  const labor = useMemo(() => effectiveLaborRate(docs, range, ctx.shop.postedRate), [docs, range, ctx.shop.postedRate])
  const bundle = useMemo(() => bundleFor('sales', input), [input])
  const days = spanDays(range)

  const exTax = Math.round((now.invoiced - now.tax) * 100) / 100
  const aro = now.invoices ? Math.round((exTax / now.invoices) * 100) / 100 : 0
  const open = (s: Slice, what: string) => () => ctx.drill({ title: `${s.label}`, sub: `${what}, ${ctx.title}. Amounts are before sales tax.`, docs: docsById(docs, s.ids) })
  const rows = (list: Slice[], what: string) => list.map(s => ({
    key: s.key, label: s.label, value: s.amount, shown: money2(s.amount),
    sub: `${plural(s.count, 'invoice')}${s.hours ? `, ${Math.round(s.hours * 10) / 10} h billed` : ''}`, onOpen: s.ids.length ? open(s, what) : undefined,
  }))
  const unrecordedAdvisor = advisors.find(a => a.label === NOT_RECORDED)
  const taxRows = mix.total > 0 ? mix : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-text-secondary">All amounts are before sales tax unless they say otherwise.</p>
        <ExportBar bundle={bundle} base="sales" range={range} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Sales before tax" value={money(exTax)} note={plural(now.invoices, 'invoice')} />
        <Kpi label="Average repair order" value={now.invoices ? money(aro) : '—'} note="Per invoice, before sales tax" />
        <Kpi label="Cars serviced" value={String(cars.cars)} note={cars.carsAssumed ? `${plural(cars.carsAssumed, 'invoice')} name no car, counted as one each` : 'Different cars, each counted once'} />
        <Kpi label="New customers" value={String(cars.newCustomers)} note={`${cars.returningCustomers} returning${cars.unknownOrders ? `, ${plural(cars.unknownOrders, 'walk-in')} with no name` : ''}`} />
      </div>
      {now.invoices === 0 && <Notice kind="info">No invoices were written in these {plural(days, 'day')}. Pick a longer period to see sales.</Notice>}
      {!ctx.extended && <Notice kind="info">Your database does not have the advisor and car columns yet, so sales by advisor and cars serviced are limited. The rest is unaffected.</Notice>}

      <Block title="Sales by kind of work" right={<span className="text-[0.875rem] text-text-secondary">Tap a row for the invoices</span>}>
        <Rank empty="No invoices in this period." rows={rows(categories.slices, 'Kind of work')} />
        {categories.other.length > 0 && (
          <div className="mt-3 border-t border-border pt-3">
            <p className="text-[0.9375rem] font-bold text-text-primary">What landed in Other work</p>
            <p className="text-[0.875rem] text-text-secondary">These lines did not match a kind of work. Name them more clearly and they will sort themselves.</p>
            <ul className="mt-1 text-[0.9375rem]">
              {categories.other.map(o => <li key={o.name} className="flex justify-between gap-3 py-1"><span className="min-w-0 truncate text-text-secondary">{o.name}</span><span className="num font-bold">{money2(o.amount)}</span></li>)}
            </ul>
          </div>
        )}
      </Block>

      <div className="grid gap-4 lg:grid-cols-2">
        <Block title="Sales by advisor" right={<span className="text-[0.875rem] text-text-secondary">Who wrote the invoice</span>}>
          <Rank empty="No invoices in this period." rows={rows(advisors, 'Written by')} />
          {unrecordedAdvisor && <p className="mt-3 text-[0.875rem] text-text-secondary">{plural(unrecordedAdvisor.count, 'invoice')} name nobody as the writer, so {unrecordedAdvisor.count === 1 ? 'it is' : 'they are'} listed as {NOT_RECORDED}. Fill in the advisor on each invoice and this fills in.</p>}
        </Block>
        <Block title="Labor sold by technician" right={<span className="text-[0.875rem] text-text-secondary">Named on labor lines</span>}>
          <Rank empty="No labor in this period." rows={rows(techs, 'Labor by')} />
          <p className="mt-3 text-[0.875rem] text-text-secondary">Flat-priced labor adds dollars but no hours.</p>
        </Block>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Block title="Where the money came from">
          {taxRows ? (
            <div>
              <Line label="Labor" value={money2(mix.labor)} />
              <Line label="Parts" value={money2(mix.parts)} />
              <Line label="Shop supplies" value={money2(mix.supplies)} />
              <Line label="Sublet" value={money2(mix.sublet)} />
              <Line label="Core charges" value={money2(mix.core)} />
              {mix.other > 0 && <Line label="Other fees" value={money2(mix.other)} />}
              <Line label="Sales tax" value={money2(mix.tax)} />
              <Line label="Total invoiced" value={money2(mix.total)} strong />
            </div>
          ) : <p className="text-text-secondary">No invoices in this period.</p>}
        </Block>
        <Block title="Labor rate you earn">
          {labor.rate === null ? (
            <p className="text-text-secondary">{labor.flatLines ? `All ${plural(labor.flatLines, 'labor line')} in this period were priced as a whole, with no hours, so there is no hourly rate to work out.` : 'No labor in this period.'}</p>
          ) : (
            <div>
              <p className="display num text-[1.75rem] font-bold">{money2(labor.rate)}<span className="text-[1rem] font-normal text-text-secondary"> per hour</span></p>
              <p className="mt-1 text-text-secondary">{money2(labor.hourlyAmount)} of hourly labor over {labor.hours} hours billed.</p>
              {labor.posted !== null && labor.gap !== null && (
                <p className="mt-2">You post {money2(labor.posted)} an hour in Settings. {Math.abs(labor.gap) < 0.5 ? 'You earn about that.' : labor.gap > 0 ? `You actually earn ${money2(labor.gap)} less per hour, usually from discounts or time billed under what the job took.` : `You actually earn ${money2(-labor.gap)} more per hour.`}</p>
              )}
              {labor.flatLines > 0 && <p className="mt-2 text-[0.875rem] text-text-secondary">{plural(labor.flatLines, 'flat-priced line')} ({money2(labor.flatAmount)}) have no hours and are not part of this rate. The rate covers {labor.coveragePct}% of your labor dollars.</p>}
            </div>
          )}
        </Block>
      </div>
    </div>
  )
}
