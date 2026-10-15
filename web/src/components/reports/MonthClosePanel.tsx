'use client'
import { useEffect, useMemo, useState } from 'react'
import { Field } from '@/components/forms/Field'
import FlashNotice from '@/components/forms/FlashNotice'
import type { Flash } from '@/components/forms/FlashNotice'
import ConfirmSheet from '@/components/forms/ConfirmSheet'
import { Switch } from '@/components/ScreenParts'
import { buildJournal, resolveAccounts, runChecks } from '@/lib/accounting'
import { DEFAULT_SETTINGS } from '@/lib/books-store'
import type { ApiResult } from '@/lib/client-api'
import { changedSinceClose, closeItems, closeReadiness, MANUAL_ITEMS, monthLabel, monthRange, monthSnapshot, previousMonth } from '@/lib/month-close'
import type { CloseItem } from '@/lib/month-close'
import { keyOf, parseDay } from '@/lib/reports'
import { docsById } from '@/lib/report-metrics'
import { ResourceNotice } from './BooksNotice'
import { Block } from './parts'
import type { Ctx } from './types'
import { NO_ACCOUNTS, NO_CLOSES, NO_EXPENSES } from './useBooks'
import type { BooksData } from './useBooks'

const monthsBack = (today: string, n: number): string[] => {
  const d = parseDay(today)
  return Array.from({ length: n }, (_, i) => keyOf(new Date(d.getFullYear(), d.getMonth() - i, 1, 12)).slice(0, 7))
}
const fmtDay = (iso: string) => { const d = new Date(iso); return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) }
const LAMP: Record<CloseItem['state'], 'green' | 'amber' | 'off' | 'blue'> = { ok: 'green', done: 'green', attention: 'amber', todo: 'off' }
const WORD: Record<CloseItem['state'], string> = { ok: 'Fine', done: 'Confirmed', attention: 'Needs a look', todo: 'Still to confirm' }

/** A checklist for the end of each month. Closing records that you reviewed it. It does not lock invoices. */
export default function MonthClosePanel({ ctx, books, reload, act }: { ctx: Ctx; books: BooksData; reload: () => void; act: (body: Record<string, unknown>) => Promise<ApiResult<Record<string, unknown>>> }) {
  const months = useMemo(() => monthsBack(ctx.todayKey, 18), [ctx.todayKey])
  const [month, setMonth] = useState(() => previousMonth(ctx.todayKey))
  const closes = books.closes.state === 'ok' ? books.closes.value : NO_CLOSES
  const saved = closes.find(c => c.month === month) || null
  const [ticks, setTicks] = useState<Record<string, boolean>>({})
  const [note, setNote] = useState('')
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<Flash | null>(null)
  const [confirmClose, setConfirmClose] = useState(false)
  const [confirmReopen, setConfirmReopen] = useState(false)

  useEffect(() => { setTicks(saved?.checked || {}); setNote(saved?.note || ''); setDirty(false) }, [saved, month])

  const settings = books.settings.state === 'ok' ? books.settings.value : DEFAULT_SETTINGS
  const expenses = books.expenses.state === 'ok' ? books.expenses.value : NO_EXPENSES
  const range = useMemo(() => monthRange(month), [month])
  const book = useMemo(() => resolveAccounts(books.mappings.state === 'ok' ? books.mappings.value : NO_ACCOUNTS), [books.mappings])
  const journal = useMemo(() => buildJournal(ctx.docs, ctx.payments, range, book, { mode: settings.journalMode, includeCost: settings.includeCost, dailyCustomer: settings.dailyCustomer, expenses }), [ctx.docs, ctx.payments, range, book, settings, expenses])
  const checks = useMemo(() => runChecks(ctx.docs, ctx.payments, range, journal), [ctx.docs, ctx.payments, range, journal])
  const snapshot = useMemo(() => monthSnapshot(ctx.docs, ctx.payments, expenses, month), [ctx.docs, ctx.payments, expenses, month])
  const items = useMemo(() => closeItems(month, ctx.todayKey, saved ? { ...saved, checked: ticks } : { month, checked: ticks, note: '', closed_at: null, closed_by: null, snapshot: null }, checks, expenses), [month, ctx.todayKey, saved, ticks, checks, expenses])
  const ready = closeReadiness(items)
  const changed = useMemo(() => (saved?.closed_at ? changedSinceClose(saved.snapshot, snapshot) : []), [saved, snapshot])
  const unavailable = books.closes.state !== 'ok'
  const closed = !!saved?.closed_at

  const run = async (action: 'save' | 'close' | 'reopen') => {
    setBusy(true)
    const r = await act({ action: 'close', close: { month, checked: ticks, note, action, snapshot } })
    setBusy(false); setConfirmClose(false); setConfirmReopen(false)
    if (r.ok) {
      setFlash({ kind: 'success', text: action === 'close' ? `${monthLabel(month)} is closed. The totals as they stand today were saved.` : action === 'reopen' ? `${monthLabel(month)} is open again.` : 'Checklist saved.' })
      setDirty(false)
    } else setFlash({ kind: 'error', text: r.needsUpdate ? 'This needs a one-time update to your Alpha Desk database before the checklist can be saved.' : r.message })
  }

  return (
    <div className="space-y-4">
      <ResourceNotice r={books.closes} what="Your month-end checklists" onRetry={reload} />
      {flash && <FlashNotice flash={flash} onDismiss={() => setFlash(null)} className="" />}
      <div className="sm:max-w-xs">
        <label htmlFor="close-month" className="form-label">Month</label>
        <select id="close-month" className="form-select" value={month} onChange={e => setMonth(e.target.value)}>
          {months.map(m => <option key={m} value={m}>{monthLabel(m)}{closes.find(c => c.month === m)?.closed_at ? ' (closed)' : ''}</option>)}
        </select>
      </div>

      {closed && (
        <div className="card flex items-start gap-3">
          <span className="lamp lamp-green mt-[0.4rem] shrink-0" aria-hidden="true" />
          <div>
            <p className="font-bold text-text-primary">{monthLabel(month)} was closed on {fmtDay(saved?.closed_at || '')}</p>
            <p className="text-text-secondary">Closing recorded that you reviewed it. Invoices can still be changed.</p>
            {changed.length > 0 ? (
              <div className="mt-2" role="alert"><p className="font-bold text-text-primary">Something changed after you closed it</p><ul className="mt-1 list-disc space-y-1 pl-5 text-text-secondary">{changed.map(c => <li key={c}>{c}</li>)}</ul></div>
            ) : <p className="mt-1 text-text-secondary">The totals are the same as when you closed it.</p>}
          </div>
        </div>
      )}

      <Block title={`Checklist for ${monthLabel(month)}`}>
        <ul className="divide-y divide-border">
          {items.map(i => (
            <li key={i.key} className="flex items-start gap-3 py-3">
              {i.kind === 'manual'
                ? <Switch checked={ticks[i.key] === true} onChange={v => { setTicks(t => ({ ...t, [i.key]: v })); setDirty(true) }} label={i.label} disabled={unavailable || closed} />
                : <span className={`lamp lamp-${LAMP[i.state]} ml-[1.125rem] mr-[1.125rem] mt-[0.9rem] shrink-0`} aria-hidden="true" />}
              <div className="min-w-0 flex-1 py-1">
                <p className="font-bold text-text-primary">{i.label}</p>
                <p className="text-[0.9375rem] text-text-secondary"><span className="font-bold">{WORD[i.state]}.</span> {i.kind === 'manual' ? i.help : i.detail}</p>
                {i.kind === 'auto' && i.state === 'attention' && docsById(ctx.docs, i.ids).length > 0 && (
                  <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => ctx.drill({ title: i.label, sub: i.detail, docs: docsById(ctx.docs, i.ids) })}>See the invoices</button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Block>

      <Block title="Totals as they stand">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
          {([['Billed', snapshot.billed], ['Collected', snapshot.collected], ['Sales tax', snapshot.tax], ['Still owed', snapshot.owed], ['Expenses', snapshot.expenses]] as const).map(([k, v]) => (
            <div key={k}><dt className="text-[0.875rem] text-text-secondary">{k}</dt><dd className="num font-bold">{`$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}</dd></div>
          ))}
          <div><dt className="text-[0.875rem] text-text-secondary">Invoices</dt><dd className="num font-bold">{snapshot.invoices}</dd></div>
        </dl>
        <Field id="close-note" label="Note for your records (optional)" className="mt-4"><textarea id="close-note" className="form-textarea" rows={3} maxLength={1000} value={note} disabled={unavailable || closed} onChange={e => { setNote(e.target.value); setDirty(true) }} /></Field>
      </Block>

      <div className="flex flex-wrap items-center gap-3">
        {!closed && <button type="button" className="btn btn-secondary" onClick={() => run('save')} disabled={busy || unavailable || !dirty}>{busy ? 'Saving' : 'Save checklist'}</button>}
        {!closed && <button type="button" className="btn btn-primary" onClick={() => setConfirmClose(true)} disabled={busy || unavailable || !ready.ready}>Close {monthLabel(month)}</button>}
        {closed && <button type="button" className="btn btn-secondary" onClick={() => setConfirmReopen(true)} disabled={busy || unavailable}>Reopen this month</button>}
        {!closed && !ready.ready && <p className="text-[0.9375rem] text-text-secondary">{ready.why}</p>}
      </div>
      {!closed && ready.ready && ready.needsAttention > 0 && <p className="text-[0.9375rem] text-text-secondary">{ready.needsAttention} {ready.needsAttention === 1 ? 'check needs' : 'checks need'} a look. You can still close the month if you have looked at {ready.needsAttention === 1 ? 'it' : 'them'}.</p>}
      <p className="text-[0.875rem] text-text-secondary">{MANUAL_ITEMS.length} items only you can confirm. Closing saves a copy of the totals above so a later change to an old invoice shows up here.</p>

      <ConfirmSheet open={confirmClose} title={`Close ${monthLabel(month)}?`} confirmLabel="Close the month" busyLabel="Closing" cancelLabel="Not yet" danger={false} busy={busy} onConfirm={() => run('close')} onCancel={() => setConfirmClose(false)}>
        <p>This saves your checklist and today&apos;s totals for the month. It does not lock anything: invoices can still be edited, and this screen will tell you if the totals change later.</p>
        {ready.needsAttention > 0 && <p className="mt-2 font-bold">{ready.needsAttention} {ready.needsAttention === 1 ? 'check still needs' : 'checks still need'} a look.</p>}
      </ConfirmSheet>
      <ConfirmSheet open={confirmReopen} title={`Reopen ${monthLabel(month)}?`} confirmLabel="Reopen" busyLabel="Reopening" cancelLabel="Keep it closed" danger={false} busy={busy} onConfirm={() => run('reopen')} onCancel={() => setConfirmReopen(false)}>
        <p>The checklist stays as you left it. Close the month again when you are done to save new totals.</p>
      </ConfirmSheet>
    </div>
  )
}
