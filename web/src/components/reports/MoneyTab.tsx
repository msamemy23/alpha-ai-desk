'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import { FilterChips } from '@/components/ListKit'
import Notice from '@/components/Notice'
import Sheet from '@/components/Sheet'
import { reminderCandidates, reminderWording } from '@/lib/ar-reminders'
import type { ReminderCandidate } from '@/lib/ar-reminders'
import { aging, collectedOn, inRange, methodLabel, money2, paymentsCsv, quarters, rangeLabel, summarize } from '@/lib/reports'
import type { Owed } from '@/lib/reports'
import { bundleFor } from '@/lib/report-bundles'
import type { BundleInput } from '@/lib/report-bundles'
import { CASH_VS_ACCRUAL_NOTE, cashVsAccrual, docsById, owedByCustomer } from '@/lib/report-metrics'
import { taxByPeriod, taxReport } from '@/lib/sales-tax'
import type { TaxGrain } from '@/lib/sales-tax'
import { docHref } from './DrillSheet'
import ExportBar from './ExportBar'
import { copyText, saveText } from './files'
import { Block, Rank } from './parts'
import type { Ctx } from './types'
import type { BooksState } from './useBooks'

const fmtDate = (k: string) => (k ? new Date(`${k.slice(0, 10)}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'No date')
const dayWord = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`
const ageLamp = (days: number) => (days > 60 ? 'red' : days > 30 ? 'amber' : 'off')
const BAR = ['bg-text-primary/30', 'bg-amber/60', 'bg-amber', 'bg-red']
const link = (d: Owed['doc']) => docHref(d)
type OwedView = 'invoice' | 'customer'

export default function MoneyTab({ ctx, input, books, onGoSettings }: { ctx: Ctx; input: BundleInput; books: { state: BooksState }; onGoSettings: () => void }) {
  const { docs, payments, range, todayKey } = ctx
  const [allOwed, setAllOwed] = useState(false)
  const [allPaid, setAllPaid] = useState(false)
  const [fileError, setFileError] = useState('')
  const [view, setView] = useState<OwedView>('invoice')
  const [remind, setRemind] = useState<ReminderCandidate | null>(null)
  const [grain, setGrain] = useState<TaxGrain>('month')
  const [copied, setCopied] = useState('')

  const byId = useMemo(() => new Map(docs.map(d => [d.id, d])), [docs])
  const owed = useMemo(() => aging(docs, todayKey), [docs, todayKey])
  const customers = useMemo(() => owedByCustomer(docs, todayKey), [docs, todayKey])
  const candidates = useMemo(() => new Map(reminderCandidates(docs, todayKey, { minDays: 0, minAmount: 0.01 }).map(c => [c.key, c])), [docs, todayKey])
  const mine = useMemo(() => payments
    .map(p => ({ p, date: collectedOn(p, byId) }))
    .filter(x => inRange(x.date, range))
    .sort((a, b) => b.date.localeCompare(a.date) || b.p.amount - a.p.amount), [payments, byId, range])
  const received = useMemo(() => Math.round(mine.reduce((s, x) => s + x.p.amount, 0) * 100) / 100, [mine])
  const qs = useMemo(() => quarters(docs, payments).slice(0, 8), [docs, payments])
  const now = useMemo(() => summarize(docs, payments, range), [docs, payments, range])
  const cva = useMemo(() => cashVsAccrual(now.invoiced, now.collected), [now])
  const tax = useMemo(() => taxReport(docs, range, input.taxComponents), [docs, range, input.taxComponents])
  const taxRows = useMemo(() => taxByPeriod(docs, range, input.taxComponents, grain), [docs, range, input.taxComponents, grain])
  const receivables = useMemo(() => bundleFor('receivables', input), [input])
  const taxBundle = useMemo(() => bundleFor('tax', input), [input])
  const booksOk = books.state.status === 'ready' && books.state.books.settings.state === 'ok'

  const download = () => {
    try { saveText(`payments-${range.from}-to-${range.to}.csv`, paymentsCsv(payments, docs, range)); setFileError('') }
    catch { setFileError('The file could not be made. Try again, or pick a shorter period.') }
  }
  const copy = async (what: string, text: string) => setCopied((await copyText(text)) ? `${what} copied.` : 'Your browser did not allow copying. Select the words and copy them by hand.')

  const owedRows = allOwed ? owed.open : owed.open.slice(0, 8)
  const custRows = allOwed ? customers : customers.slice(0, 8)
  const paidRows = allPaid ? mine : mine.slice(0, 10)
  const wording = remind ? reminderWording(remind, { name: ctx.shop.name, phone: ctx.shop.phone }) : null

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
                  <button
                    type="button"
                    className="flex min-h-[44px] flex-1 items-center gap-2 text-left text-text-secondary sm:min-h-0"
                    disabled={b.count === 0}
                    onClick={() => ctx.drill({ title: `Owed, ${b.label}`, sub: 'Unpaid balances by how long ago the invoice was written', docs: owed.open.filter(o => (b.key === '0-30' ? o.days <= 30 : b.key === '31-60' ? o.days > 30 && o.days <= 60 : b.key === '61-90' ? o.days > 60 && o.days <= 90 : o.days > 90)).map(o => o.doc), amountLabel: 'owed', amount: d => d.balance })}
                  >
                    <span className={`h-3 w-3 shrink-0 rounded-sm ${BAR[i]}`} aria-hidden="true" />
                    {b.label}
                    <span className="text-text-muted">({b.count})</span>
                  </button>
                  <span className="num font-bold text-text-primary">{money2(b.amount)}</span>
                </li>
              ))}
            </ul>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <FilterChips<OwedView> label="Group by" value={view} onChange={setView} options={[{ key: 'invoice', label: 'By invoice' }, { key: 'customer', label: 'By customer' }]} />
              <ExportBar bundle={receivables} base="who-owes-you" range={{ from: todayKey, to: todayKey }} />
            </div>
            {view === 'invoice' ? (
              <ul className="ledger mt-3">
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
            ) : (
              <ul className="ledger mt-3">
                {custRows.map(c => {
                  const cand = candidates.get(c.key)
                  return (
                    <li key={c.key} className="ledger-row !items-start">
                      <span className="ledger-main">
                        <span className="ledger-title block">{c.name}</span>
                        <span className="ledger-sub !whitespace-normal block">{c.count} {c.count === 1 ? 'invoice' : 'invoices'}, oldest {dayWord(c.oldestDays)}</span>
                        <span className="mt-1 flex flex-wrap gap-2">
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => ctx.drill({ title: c.name, sub: 'Their unpaid invoices', docs: docsById(docs, c.ids), amountLabel: 'owed', amount: d => d.balance })}>See invoices</button>
                          {cand && <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setCopied(''); setRemind(cand) }}>Reminder wording</button>}
                        </span>
                      </span>
                      <span className="ledger-amt">{money2(c.amount)}</span>
                    </li>
                  )
                })}
              </ul>
            )}
            {(view === 'invoice' ? owed.open.length : customers.length) > 8 && (
              <button type="button" className="btn btn-secondary mt-3" onClick={() => setAllOwed(v => !v)}>
                {allOwed ? 'Show fewer' : `Show all ${view === 'invoice' ? owed.open.length : customers.length}`}
              </button>
            )}
          </>
        )}
      </Block>

      <Block title="Billed and received">
        <p className="text-[1rem] text-text-primary">{cva.words}</p>
        <div className="mt-2">
          <div className="flex justify-between gap-3 py-1.5"><span className="text-text-secondary">Billed (accrual)</span><span className="num font-bold">{money2(cva.billed)}</span></div>
          <div className="flex justify-between gap-3 py-1.5"><span className="text-text-secondary">Received (cash)</span><span className="num font-bold">{money2(cva.received)}</span></div>
        </div>
        <p className="mt-2 text-[0.875rem] text-text-secondary">{CASH_VS_ACCRUAL_NOTE}</p>
      </Block>

      <Block title="Payments received" right={<span className="num text-[1.0625rem] font-bold">{money2(received)}</span>}>
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

      <Block title="Sales tax" right={<span className="num text-[1.0625rem] font-bold">{money2(tax.tax)}</span>}>
        {tax.invoices === 0 ? <p className="text-text-secondary">No invoices in this period, so no sales tax was charged.</p> : (
          <>
            <div>
              <div className="flex justify-between gap-3 py-1.5"><span className="text-text-secondary">Sales before tax</span><span className="num font-bold">{money2(tax.sales)}</span></div>
              <div className="flex justify-between gap-3 py-1.5"><span className="text-text-secondary">Taxable sales</span><span className="num font-bold">{money2(tax.taxable)}</span></div>
              <div className="flex justify-between gap-3 py-1.5"><span className="text-text-secondary">Not taxable</span><span className="num font-bold">{money2(tax.nonTaxable)}</span></div>
              <div className="flex justify-between gap-3 border-t border-line py-1.5 font-bold"><span>Tax collected</span><span className="num">{money2(tax.tax)}</span></div>
            </div>
            {tax.configured ? (
              <div className="mt-3">
                <p className="mb-1 font-bold text-text-primary">Owed to each authority</p>
                <ul className="divide-y divide-border">
                  {tax.byComponent.map(c => (
                    <li key={c.name} className="flex items-baseline justify-between gap-3 py-2">
                      <span className="min-w-0"><span className="block font-bold text-text-primary">{c.name} <span className="font-normal text-text-secondary">({c.ratePct}%)</span></span>{c.agency && <span className="block text-[0.875rem] text-text-secondary">Pay to {c.agency}</span>}</span>
                      <span className="num shrink-0 font-bold">{money2(c.tax)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <Notice kind="info" className="mt-3">
                <p className="font-bold">Tell Alpha Desk who you pay sales tax to</p>
                <p className="mt-0.5 text-text-secondary">Add each authority and its rate (for example state, county, city) and this splits what you collected for each filing.</p>
                {books.state.status === 'forbidden'
                  ? <p className="mt-1 text-text-secondary">Ask an owner or manager to set this up.</p>
                  : <button type="button" className="btn btn-secondary mt-2" onClick={onGoSettings} disabled={books.state.status !== 'ready'}>Set tax authorities</button>}
              </Notice>
            )}
            {tax.configured && tax.ratesDiffer.count > 0 && (
              <Notice kind="warn" className="mt-3">
                <p className="font-bold">{tax.ratesDiffer.count} {tax.ratesDiffer.count === 1 ? 'invoice was' : 'invoices were'} taxed at a different rate than you set</p>
                <p className="mt-0.5 text-text-secondary">They were charged {tax.ratesDiffer.rates.map(r => `${r}%`).join(' or ')}. Their tax is split by the same shares, so check them before you file.</p>
                <button type="button" className="btn btn-secondary mt-2" onClick={() => ctx.drill({ title: 'Taxed at another rate', docs: docsById(docs, tax.ratesDiffer.ids) })}>See the invoices</button>
              </Notice>
            )}
            {tax.untaxed.count > 0 && <p className="mt-3 text-[0.875rem] text-text-secondary">{tax.untaxed.count} {tax.untaxed.count === 1 ? 'invoice' : 'invoices'} had no sales tax charged. <button type="button" className="font-bold text-blue underline" onClick={() => ctx.drill({ title: 'No sales tax charged', docs: docsById(docs, tax.untaxed.ids) })}>See them</button></p>}
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <FilterChips<TaxGrain> label="Tax by" value={grain} onChange={setGrain} options={[{ key: 'month', label: 'By month' }, { key: 'quarter', label: 'By quarter' }]} />
              <ExportBar bundle={taxBundle} base="sales-tax" range={range} />
            </div>
            <div className="mt-3 overflow-x-auto">
              <table className="data-table w-full min-w-[30rem] text-left">
                <caption className="sr-only">Sales tax by {grain}</caption>
                <thead><tr><th scope="col">{grain === 'month' ? 'Month' : 'Quarter'}</th><th scope="col" className="text-right">Sales</th><th scope="col" className="text-right">Taxable</th><th scope="col" className="text-right">Tax</th></tr></thead>
                <tbody>{taxRows.map(r => <tr key={r.label}><th scope="row">{r.label}</th><td className="num text-right">{money2(r.sales)}</td><td className="num text-right">{money2(r.taxable)}</td><td className="num text-right font-bold">{money2(r.tax)}</td></tr>)}</tbody>
              </table>
            </div>
            <p className="mt-3 text-[0.875rem] text-text-secondary">Counted on the invoice date. Check with your accountant whether your state wants it on invoices or on payments. {booksOk ? '' : 'Tax authorities are set in Accounting settings.'}</p>
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

      <Sheet open={!!remind} onClose={() => setRemind(null)} title={remind ? `Reminder for ${remind.name}` : 'Reminder'} wide>
        {remind && wording && (
          <div className="space-y-4">
            <Notice kind="info">Alpha Desk does not send this. Copy the words and send them yourself from Messages or your email, or leave it. {remind.reach.length === 0 ? 'There is no phone number or email on these invoices.' : `On file: ${remind.reach.map(r => (r === 'text' ? `phone ${remind.phone}` : `email ${remind.email}`)).join(', ')}.`}</Notice>
            <div>
              <p className="form-label">Text message</p>
              <p className="rounded-md border border-border bg-bg-chrome p-3 text-[1rem] leading-snug">{wording.sms}</p>
              <button type="button" className="btn btn-secondary mt-2" onClick={() => copy('Text', wording.sms)}><Icon name="copy" className="h-5 w-5" />Copy text</button>
            </div>
            <div>
              <p className="form-label">Email</p>
              <p className="font-bold">{wording.emailSubject}</p>
              <p className="mt-1 whitespace-pre-line rounded-md border border-border bg-bg-chrome p-3 text-[1rem] leading-snug">{wording.emailBody}</p>
              <button type="button" className="btn btn-secondary mt-2" onClick={() => copy('Email', `${wording.emailSubject}\n\n${wording.emailBody}`)}><Icon name="copy" className="h-5 w-5" />Copy email</button>
            </div>
            {copied && <p role="status" className="text-[0.9375rem] font-bold text-text-primary">{copied}</p>}
            <p className="text-[0.875rem] text-text-secondary">This is a {remind.stage === 'friendly' ? 'friendly' : remind.stage === 'second' ? 'second' : 'final'} reminder because the oldest invoice is {dayWord(remind.oldestDays)} old. The words state what is owed and never threaten.</p>
          </div>
        )}
      </Sheet>
    </div>
  )
}
