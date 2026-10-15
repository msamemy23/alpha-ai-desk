'use client'
import { useMemo, useState } from 'react'
import ConfirmSheet from '@/components/forms/ConfirmSheet'
import { Field } from '@/components/forms/Field'
import FlashNotice from '@/components/forms/FlashNotice'
import type { Flash } from '@/components/forms/FlashNotice'
import FormActions from '@/components/forms/FormActions'
import FormError from '@/components/forms/FormError'
import Icon from '@/components/Icon'
import { FilterChips } from '@/components/ListKit'
import Notice from '@/components/Notice'
import Sheet from '@/components/Sheet'
import { Switch } from '@/components/ScreenParts'
import { EXPENSE_CATEGORIES, expenseLabel } from '@/lib/accounting'
import type { ApiResult } from '@/lib/client-api'
import { isActive, summarizeExpenses, unpaidBills, vendorNames } from '@/lib/expenses'
import type { Expense } from '@/lib/expenses'
import { inRange, money2, rangeLabel } from '@/lib/reports'
import { ResourceNotice } from './BooksNotice'
import { Block, Kpi } from './parts'
import type { Ctx } from './types'
import { NO_EXPENSES } from './useBooks'
import type { BooksData } from './useBooks'

type Show = 'range' | 'unpaid' | 'voided' | 'all'
interface Form { id: string; date: string; vendor: string; category: string; amount: string; memo: string; reference: string; paid: boolean; paid_on: string; method: string }
const PAY_METHODS = ['Check', 'Card', 'Cash', 'Bank transfer', 'Other']
const fmtDate = (k: string) => (k ? new Date(`${k}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'No date')

const blank = (today: string): Form => ({ id: '', date: today, vendor: '', category: 'parts', amount: '', memo: '', reference: '', paid: false, paid_on: today, method: 'Check' })
const formOf = (e: Expense): Form => ({ id: e.id, date: e.date, vendor: e.vendor, category: e.category, amount: e.amount.toFixed(2), memo: e.memo, reference: e.reference, paid: !!e.paid_on, paid_on: e.paid_on || e.date, method: e.method || 'Check' })

/**
 * Bills and expenses: what the shop spends, so profit and loss and the accountant files can include it.
 * Nothing is ever deleted. A mistake is voided, stays on record, and can be put back.
 */
export default function BillsPanel({ ctx, books, reload, act }: { ctx: Ctx; books: BooksData; reload: () => void; act: (body: Record<string, unknown>) => Promise<ApiResult<Record<string, unknown>>> }) {
  const basis = books.settings.state === 'ok' ? books.settings.value.basis : 'accrual'
  const all = books.expenses.state === 'ok' ? books.expenses.value : NO_EXPENSES
  const [show, setShow] = useState<Show>('range')
  const [form, setForm] = useState<Form | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [dup, setDup] = useState<Expense | null>(null)
  const [voiding, setVoiding] = useState<Expense | null>(null)
  const [reason, setReason] = useState('')
  const [flash, setFlash] = useState<Flash | null>(null)
  const [paying, setPaying] = useState<Expense | null>(null)
  const [payDay, setPayDay] = useState(ctx.todayKey)
  const [payMethod, setPayMethod] = useState('Check')

  const unavailable = books.expenses.state !== 'ok'
  const summary = useMemo(() => summarizeExpenses(all, ctx.range, basis), [all, ctx.range, basis])
  const owed = useMemo(() => unpaidBills(all, ctx.todayKey), [all, ctx.todayKey])
  const vendors = useMemo(() => vendorNames(all), [all])
  const list = useMemo(() => {
    const rows = all.filter(e => (show === 'voided' ? !!e.voided_at : show === 'unpaid' ? isActive(e) && !e.paid_on : show === 'range' ? isActive(e) && inRange(e.date, ctx.range) : true))
    return rows.sort((a, b) => b.date.localeCompare(a.date) || b.amount - a.amount)
  }, [all, show, ctx.range])
  const counts = useMemo(() => ({ unpaid: all.filter(e => isActive(e) && !e.paid_on).length, voided: all.filter(e => e.voided_at).length }), [all])

  const patch = (p: Partial<Form>) => setForm(f => (f ? { ...f, ...p } : f))
  const open = (e?: Expense) => { setErrors({}); setError(''); setDup(null); setForm(e ? formOf(e) : blank(ctx.todayKey)) }

  const save = async (confirmDuplicate = false) => {
    if (!form) return
    setBusy(true); setError(''); setErrors({})
    const expense = { date: form.date, vendor: form.vendor, category: form.category, amount: form.amount, memo: form.memo, reference: form.reference, paid: form.paid, paid_on: form.paid ? form.paid_on : '', method: form.paid ? form.method : '' }
    const r = form.id
      ? await act({ action: 'expense-update', id: form.id, expense })
      : await act({ action: 'expense-add', expense: { ...expense, confirm_duplicate: confirmDuplicate } })
    setBusy(false)
    if (r.ok) { setForm(null); setDup(null); setFlash({ kind: 'success', text: form.id ? 'Bill changed.' : `Bill from ${form.vendor.trim()} saved.` }); return }
    if (r.status === 409 && r.extra.duplicate) { setDup(r.extra.duplicate as Expense); return }
    setErrors(r.fields)
    setError(r.needsUpdate ? 'This needs a one-time update to your Alpha Desk database before bills can be saved.' : r.message)
  }

  const markPaid = async () => {
    if (!paying) return
    setBusy(true)
    const r = await act({ action: 'expense-pay', id: paying.id, paid_on: payDay, method: payMethod })
    setBusy(false)
    if (r.ok) { setFlash({ kind: 'success', text: `Marked paid on ${fmtDate(payDay)}.` }); setPaying(null) } else setError(r.message)
  }

  const doVoid = async () => {
    if (!voiding) return
    setBusy(true); setError('')
    const target = voiding
    const r = await act({ action: 'expense-void', id: target.id, reason })
    setBusy(false)
    if (r.ok) {
      setVoiding(null); setReason('')
      setFlash({ kind: 'success', text: `Voided the ${money2(target.amount)} bill from ${target.vendor}. It stays on record and is out of every total.`, action: { label: 'Undo', run: async () => { const u = await act({ action: 'expense-restore', id: target.id }); setFlash(u.ok ? { kind: 'success', text: 'Put back.' } : { kind: 'error', text: u.message }) } } })
    } else setError(r.message)
  }

  const restore = async (e: Expense) => {
    const r = await act({ action: 'expense-restore', id: e.id })
    setFlash(r.ok ? { kind: 'success', text: `Put back the bill from ${e.vendor}.` } : { kind: 'error', text: r.message })
  }

  const status = (e: Expense): { lamp: 'green' | 'amber' | 'red' | 'off'; text: string } => {
    if (e.voided_at) return { lamp: 'off', text: 'Voided' }
    if (e.paid_on) return { lamp: 'green', text: `Paid ${fmtDate(e.paid_on)}` }
    const o = owed.bills.find(b => b.expense.id === e.id)
    return o?.overdue ? { lamp: 'red', text: `Unpaid, ${o.days} days old` } : { lamp: 'amber', text: 'Unpaid' }
  }

  return (
    <div className="space-y-4">
      <ResourceNotice r={books.expenses} what="Your bills and expenses" onRetry={reload} />
      {flash && <FlashNotice flash={flash} onDismiss={() => setFlash(null)} className="" />}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Spent in these dates" value={money2(summary.total)} note={`${summary.count} ${summary.count === 1 ? 'bill' : 'bills'}, counted ${basis === 'cash' ? 'when paid' : 'on the bill date'}`} />
        <Kpi label="Parts and outside work" value={money2(summary.cogs)} note="Cost of goods" />
        <Kpi label="Overhead" value={money2(summary.operating)} note="Rent, utilities and the rest" />
        <Kpi label="Bills you owe" value={money2(owed.total)} note={owed.bills.length ? `${owed.bills.length} unpaid${owed.overdueTotal ? `, ${money2(owed.overdueTotal)} over 30 days` : ''}` : 'Nothing unpaid'} />
      </div>

      <Block title="Bills and expenses" right={<button type="button" className="btn btn-primary btn-sm" onClick={() => open()} disabled={unavailable}><Icon name="plus" className="h-5 w-5" />Add a bill</button>}>
        <div className="mb-3">
          <FilterChips<Show> label="Which bills" value={show} onChange={setShow} scroll options={[{ key: 'range', label: 'In these dates' }, { key: 'unpaid', label: 'Unpaid', count: counts.unpaid }, { key: 'voided', label: 'Voided', count: counts.voided }, { key: 'all', label: 'Everything' }]} />
        </div>
        {unavailable ? <p className="text-text-secondary">Bills are not available until the notice above is dealt with.</p> : list.length === 0 ? (
          <div className="empty-state">
            <p className="font-bold text-text-primary">{show === 'unpaid' ? 'No unpaid bills' : show === 'voided' ? 'Nothing voided' : all.length === 0 ? 'No bills entered yet' : `No bills in ${rangeLabel(ctx.range)}`}</p>
            <p className="mx-auto mt-1 max-w-md">{all.length === 0 ? 'Add what you spend on parts, rent and utilities and your profit and loss becomes complete.' : 'Change the filter above to see others.'}</p>
          </div>
        ) : (
          <ul className="ledger">
            {list.slice(0, 100).map(e => {
              const st = status(e)
              return (
                <li key={e.id} className="ledger-row !items-start">
                  <span className="ledger-main">
                    <span className="ledger-title block">{e.vendor}</span>
                    <span className="ledger-sub !whitespace-normal block">{[expenseLabel(e.category), fmtDate(e.date), e.reference ? `No. ${e.reference}` : ''].filter(Boolean).join(' · ')}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[0.875rem] font-bold text-text-secondary"><span className={`lamp lamp-${st.lamp} !h-2.5 !w-2.5`} aria-hidden="true" />{st.text}</span>
                    <span className="mt-1 flex flex-wrap gap-2">
                      {e.voided_at
                        ? <button type="button" className="btn btn-secondary btn-sm" onClick={() => restore(e)}>Put back</button>
                        : <>
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => open(e)}>Change</button>
                          {!e.paid_on && <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setError(''); setPayDay(ctx.todayKey); setPaying(e) }}>Mark paid</button>}
                          <button type="button" className="btn btn-secondary btn-sm" onClick={() => { setError(''); setReason(''); setVoiding(e) }}>Void</button>
                        </>}
                    </span>
                  </span>
                  <span className={`ledger-amt ${e.voided_at ? 'line-through opacity-60' : ''}`}>{money2(e.amount)}</span>
                </li>
              )
            })}
          </ul>
        )}
        {list.length > 100 && <p className="mt-3 text-[0.875rem] text-text-secondary">Showing the latest 100 of {list.length}. Pick a shorter period to see the rest.</p>}
      </Block>

      <Sheet open={!!form} onClose={() => { if (!busy) setForm(null) }} title={form?.id ? 'Change bill' : 'Add a bill'} dirty>
        {form && (
          <form onSubmit={e => { e.preventDefault(); void save() }} className="space-y-3">
            <Field id="bill-vendor" label="Paid to" error={errors.vendor}>
              <input id="bill-vendor" className="form-input" list="bill-vendors" value={form.vendor} maxLength={120} onChange={e => patch({ vendor: e.target.value })} autoComplete="off" />
              <datalist id="bill-vendors">{vendors.map(v => <option key={v} value={v} />)}</datalist>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="bill-date" label="Bill date" error={errors.date}><input id="bill-date" type="date" className="form-input" value={form.date} onChange={e => patch({ date: e.target.value })} /></Field>
              <Field id="bill-amount" label="Amount" error={errors.amount}>
                <div className="relative"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" aria-hidden="true">$</span><input id="bill-amount" className="form-input pl-7" inputMode="decimal" value={form.amount} onChange={e => patch({ amount: e.target.value })} placeholder="245.50" /></div>
              </Field>
            </div>
            <Field id="bill-category" label="What it was for" error={errors.category}>
              <select id="bill-category" className="form-select" value={form.category} onChange={e => patch({ category: e.target.value })}>
                <optgroup label="Cost of goods">{EXPENSE_CATEGORIES.filter(c => c.kind === 'cogs').map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</optgroup>
                <optgroup label="Overhead">{EXPENSE_CATEGORIES.filter(c => c.kind === 'operating').map(c => <option key={c.key} value={c.key}>{c.label}</option>)}</optgroup>
              </select>
            </Field>
            <Field id="bill-ref" label="Bill or invoice number (optional)" error={errors.reference}><input id="bill-ref" className="form-input" value={form.reference} maxLength={60} onChange={e => patch({ reference: e.target.value })} /></Field>
            <Field id="bill-memo" label="Note (optional)" error={errors.memo}><input id="bill-memo" className="form-input" value={form.memo} maxLength={400} onChange={e => patch({ memo: e.target.value })} /></Field>
            <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
              <div><p className="font-bold text-text-primary">Already paid</p><p className="text-[0.875rem] text-text-secondary">Leave off to keep it as a bill you still owe.</p></div>
              <Switch checked={form.paid} onChange={v => patch({ paid: v })} label="Already paid" />
            </div>
            {form.paid && (
              <div className="grid grid-cols-2 gap-3">
                <Field id="bill-paid" label="Paid on" error={errors.paid_on}><input id="bill-paid" type="date" className="form-input" value={form.paid_on} onChange={e => patch({ paid_on: e.target.value })} /></Field>
                <Field id="bill-method" label="Paid by"><select id="bill-method" className="form-select" value={form.method} onChange={e => patch({ method: e.target.value })}>{PAY_METHODS.map(m => <option key={m}>{m}</option>)}</select></Field>
              </div>
            )}
            {dup && (
              <Notice kind="warn">
                <p className="font-bold">This looks like a bill you already entered</p>
                <p className="mt-0.5 text-text-secondary">{dup.vendor}, {money2(dup.amount)}, {fmtDate(dup.date)}{dup.reference ? `, number ${dup.reference}` : ''}. Save it anyway only if it is a second bill.</p>
                <button type="button" className="btn btn-secondary mt-2" onClick={() => save(true)} disabled={busy}>It is a second bill, save it</button>
              </Notice>
            )}
            {error && !dup && <FormError>{error}</FormError>}
            <FormActions>
              <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving' : form.id ? 'Save changes' : 'Save bill'}</button>
              <button type="button" className="btn btn-secondary" onClick={() => setForm(null)} disabled={busy}>Cancel</button>
            </FormActions>
          </form>
        )}
      </Sheet>

      <ConfirmSheet open={!!voiding} title="Void this bill?" confirmLabel="Void bill" busyLabel="Voiding" cancelLabel="Keep it" busy={busy} error={error} onConfirm={doVoid} onCancel={() => setVoiding(null)}>
        {voiding && (
          <div className="space-y-3">
            <p>{voiding.vendor}, {money2(voiding.amount)}, {fmtDate(voiding.date)}. It stays on record but no longer counts in any total. You can put it back.</p>
            <Field id="void-reason" label="Why (optional)"><input id="void-reason" className="form-input" value={reason} maxLength={300} onChange={e => setReason(e.target.value)} placeholder="Entered twice" /></Field>
          </div>
        )}
      </ConfirmSheet>

      <ConfirmSheet open={!!paying} title="Mark this bill paid" confirmLabel="Mark paid" busyLabel="Saving" cancelLabel="Cancel" danger={false} busy={busy} error={error} onConfirm={markPaid} onCancel={() => setPaying(null)}>
        {paying && (
          <div className="space-y-3">
            <p>{paying.vendor}, {money2(paying.amount)}, dated {fmtDate(paying.date)}.</p>
            <div className="grid grid-cols-2 gap-3">
              <Field id="pay-day" label="Paid on"><input id="pay-day" type="date" className="form-input" value={payDay} onChange={e => setPayDay(e.target.value)} /></Field>
              <Field id="pay-method" label="Paid by"><select id="pay-method" className="form-select" value={payMethod} onChange={e => setPayMethod(e.target.value)}>{PAY_METHODS.map(m => <option key={m}>{m}</option>)}</select></Field>
            </div>
          </div>
        )}
      </ConfirmSheet>
    </div>
  )
}
