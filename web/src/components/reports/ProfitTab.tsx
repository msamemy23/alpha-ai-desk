'use client'
import { useMemo, useState } from 'react'
import Notice from '@/components/Notice'
import { FilterChips } from '@/components/ListKit'
import { change, money, money2 } from '@/lib/reports'
import { bundleFor } from '@/lib/report-bundles'
import type { BundleInput } from '@/lib/report-bundles'
import { docsById, grossProfit } from '@/lib/report-metrics'
import { profitLoss, profitLossByMonth, profitLossCsv } from '@/lib/profit-loss'
import { fileName } from '@/lib/report-files'
import Icon from '@/components/Icon'
import { BooksGate, ResourceNotice } from './BooksNotice'
import ExportBar from './ExportBar'
import { saveText } from './files'
import { Block, DeltaLine, Kpi, Line } from './parts'
import type { Ctx } from './types'
import type { BooksState } from './useBooks'

type Order = 'low' | 'high'

/** What each job earned (gross profit) and the shop's profit and loss. Profit and loss needs the books; gross profit does not. */
export default function ProfitTab({ ctx, input, books, onGoSettings }: { ctx: Ctx; input: BundleInput; books: { state: BooksState; reload: () => void }; onGoSettings: () => void }) {
  const { docs, payments, range, previous } = ctx
  const [order, setOrder] = useState<Order>('low')
  const ready = books.state.status === 'ready' ? books.state.books : null
  const expensesOk = !!ready && ready.expenses.state === 'ok'

  const gp = useMemo(() => grossProfit(docs, range, { laborCostPerHour: input.laborCostPerHour }), [docs, range, input.laborCostPerHour])
  const opts = useMemo(() => ({ basis: input.basis, cogsMethod: input.cogsMethod }), [input.basis, input.cogsMethod])
  const pl = useMemo(() => profitLoss(docs, payments, input.expenses, range, opts), [docs, payments, input.expenses, range, opts])
  const plBefore = useMemo(() => (previous ? profitLoss(docs, payments, input.expenses, previous, opts) : null), [docs, payments, input.expenses, previous, opts])
  const months = useMemo(() => profitLossByMonth(docs, payments, input.expenses, range, opts), [docs, payments, input.expenses, range, opts])
  const bundle = useMemo(() => bundleFor('profit', input), [input])
  const jobs = useMemo(() => [...gp.jobs].sort((a, b) => (order === 'low' ? a.gross - b.gross : b.gross - a.gross) || a.id.localeCompare(b.id)), [gp.jobs, order])
  const [all, setAll] = useState(false)
  const shown = all ? jobs : jobs.slice(0, 12)

  const plCsv = () => saveText(fileName('profit-and-loss', range, 'csv'), profitLossCsv(pl))
  const costKnown = gp.partsCost > 0 || gp.laborCost !== null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-text-secondary">Profit is what is left after the cost of parts{gp.laborCost !== null ? ' and technician time' : ''}{expensesOk ? ' and your bills' : ''}.</p>
        <ExportBar bundle={bundle} base="profit-and-loss" range={range} />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Gross profit on jobs" value={costKnown ? money(gp.gross) : '—'} note={costKnown ? `${gp.marginPct ?? 0}% margin on ${money(gp.revenue)} of sales` : 'Write the cost on part lines to see profit'} />
        <Kpi label="Parts cost" value={money(gp.partsCost)} note={gp.partLines ? `${gp.partsCosted} of ${gp.partLines} part lines have a cost` : 'No parts sold in this period'} />
        <Kpi label="Technician time" value={gp.laborCost === null ? 'Not counted' : money(gp.laborCost)} note={gp.laborCost === null ? 'Set what an hour of a technician costs you in Accounting settings' : 'Hours billed times your cost per hour'} />
        <Kpi label="Jobs missing a cost" value={String(gp.incomplete)} note={gp.incomplete ? 'Their profit looks higher than it is' : 'Every job has what it needs'} />
      </div>
      {gp.passedThrough > 0 && <p className="text-[0.875rem] text-text-secondary">{money2(gp.passedThrough)} of sublet and core charges are passed through to others and are left out of sales here.</p>}

      <Block title="Profit on each job" right={<FilterChips<Order> label="Order" value={order} onChange={setOrder} options={[{ key: 'low', label: 'Lowest first' }, { key: 'high', label: 'Highest first' }]} />}>
        {jobs.length === 0 ? <p className="text-text-secondary">No invoices in this period.</p> : (
          <>
            <ul className="ledger">
              {shown.map(j => (
                <li key={j.id}>
                  <button type="button" className="ledger-row w-full text-left" onClick={() => ctx.drill({ title: j.number || 'Invoice', sub: `${j.customer || 'No customer name'}. Sold ${money2(j.revenue)}, parts cost ${money2(j.partsCost)}${j.laborCost !== null ? `, technician time ${money2(j.laborCost)}` : ''}.`, docs: docsById(docs, [j.id]) })}>
                    <span className="ledger-main">
                      <span className="ledger-title block">{j.customer || 'No customer name'}</span>
                      <span className="ledger-sub !whitespace-normal block">{[j.number, j.vehicle, `Sold ${money2(j.revenue)}`].filter(Boolean).join(' · ')}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[0.875rem] font-bold text-text-secondary">
                        <span className={`lamp lamp-${j.complete ? 'green' : 'amber'} !h-2.5 !w-2.5`} aria-hidden="true" />
                        {j.complete ? (j.marginPct === null ? 'Full cost known' : `${j.marginPct}% margin`) : j.partLines > j.partsCosted ? `${j.partLines - j.partsCosted} part ${j.partLines - j.partsCosted === 1 ? 'line has' : 'lines have'} no cost` : 'Technician time is only partly known'}
                      </span>
                    </span>
                    <span className="ledger-amt">{money2(j.gross)}</span>
                    <Icon name="chevronRight" className="h-5 w-5 shrink-0 text-text-muted" />
                  </button>
                </li>
              ))}
            </ul>
            {jobs.length > 12 && <button type="button" className="btn btn-secondary mt-3" onClick={() => setAll(v => !v)}>{all ? 'Show fewer' : `Show all ${jobs.length}`}</button>}
          </>
        )}
      </Block>

      <section className="panel" aria-labelledby="pl-h">
        <div className="panel-header">
          <h2 id="pl-h" className="section-title">Profit and loss, {pl.basis === 'accrual' ? 'accrual' : 'cash'}</h2>
          <div className="flex gap-2">
            <button type="button" className="btn btn-secondary btn-sm" onClick={plCsv}><Icon name="download" className="h-5 w-5" />CSV</button>
          </div>
        </div>
        <div className="panel-body">
          {books.state.status === 'loading' && <div className="skeleton h-40" role="status" aria-label="Loading your books" />}
          <BooksGate state={books.state} what="Profit and loss" onRetry={books.reload} />
          {ready && (
            <>
              <ResourceNotice r={ready.expenses} what="Your bills and expenses" onRetry={books.reload} />
              <ResourceNotice r={ready.settings} what="Your accounting settings" onRetry={books.reload} />
              {!expensesOk && <Notice kind="warn" className="mb-3">Bills and expenses are not counted below, so profit looks higher than it really is.</Notice>}
              <p className="mb-3 text-[0.9375rem] text-text-secondary">
                Counted on {pl.basis === 'accrual' ? 'what you billed and bill dates (accrual)' : 'money in and bills paid (cash)'}. Cost of parts comes from {pl.cogsMethod === 'invoices' ? 'the cost written on invoices' : 'your parts bills'}.{' '}
                <button type="button" className="font-bold text-blue underline" onClick={onGoSettings}>Change this</button>
              </p>
              <div>
                <Line label="Income" value={money2(pl.totalIncome)} strong />
                {pl.income.map(r => <Line key={r.key} label={<span className="pl-3">{r.label}</span>} value={money2(r.amount)} />)}
                <Line label="Cost of goods sold" value={money2(pl.totalCogs)} strong />
                {pl.cogs.map(r => <Line key={r.key} label={<span className="pl-3">{r.label}</span>} value={money2(r.amount)} />)}
                <Line label={`Gross profit${pl.grossMarginPct !== null ? ` (${pl.grossMarginPct}%)` : ''}`} value={money2(pl.grossProfit)} strong />
                <Line label="Expenses" value={money2(pl.totalExpenses)} strong />
                {pl.expenses.map(r => <Line key={r.key} label={<span className="pl-3">{r.label}</span>} value={money2(r.amount)} />)}
                <Line label={pl.netIncome >= 0 ? 'Net income' : 'Net loss'} value={money2(pl.netIncome)} strong />
              </div>
              <DeltaLine change={plBefore ? change(pl.netIncome, plBefore.netIncome) : null} vs={ctx.vs} />
              <p className="mt-3 text-[0.875rem] text-text-secondary">Sales tax collected ({money2(pl.salesTax)}) is owed to the state and is not income. This is a working copy for your accountant, not a tax return.</p>
              {pl.notes.map(n => <p key={n} className="mt-1 text-[0.875rem] text-text-secondary">{n}</p>)}
              {months.length > 1 && (
                <div className="mt-4 overflow-x-auto">
                  <table className="data-table w-full min-w-[34rem] text-left">
                    <caption className="sr-only">Profit and loss by month</caption>
                    <thead><tr><th scope="col">Month</th><th scope="col" className="text-right">Income</th><th scope="col" className="text-right">Cost of goods</th><th scope="col" className="text-right">Expenses</th><th scope="col" className="text-right">Net</th></tr></thead>
                    <tbody>{months.map(m => <tr key={m.key}><th scope="row">{m.label}</th><td className="num text-right">{money2(m.income)}</td><td className="num text-right">{money2(m.cogs)}</td><td className="num text-right">{money2(m.expenses)}</td><td className="num text-right font-bold">{money2(m.net)}</td></tr>)}</tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </div>
  )
}
