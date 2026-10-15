'use client'
import { useMemo, useState } from 'react'
import { formatCurrency } from '@/lib/supabase'
import { phonePretty } from '@/lib/today'
import Icon from '@/components/Icon'
import { Field } from './LineCards'
import { PAYMENT_METHODS, fmtDate } from './types'
import type { Customer } from './types'

/* ---------- small shared pieces ---------- */

export function ErrorMsg({ children }: { children: React.ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2.5 rounded-md border border-red/50 bg-red/[0.08] px-3 py-2.5 text-[0.9375rem] text-red">
      <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  )
}

export function OkMsg({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="flex items-start gap-2.5 rounded-md border border-green/50 bg-green/[0.1] px-3 py-2.5 text-[0.9375rem] text-green">
      <Icon name="check" className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  )
}

export function WarnMsg({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="flex items-start gap-2.5 rounded-md border border-amber/50 bg-amber/[0.1] px-3 py-2.5 text-[0.9375rem] text-amber">
      <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0" />
      <div className="min-w-0 break-words">{children}</div>
    </div>
  )
}

const actions = 'mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end'

function SummaryRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <dt className={strong ? 'font-bold' : 'text-text-secondary'}>{label}</dt>
      <dd className={`num text-right ${strong ? 'display text-[1.125rem] font-bold' : ''}`}>{value}</dd>
    </div>
  )
}

/* ---------- Send to customer ---------- */

export function SendForm({ noun, docNumber, customerName, total, email, phone, busy, error, success, onSend, onClose }: {
  noun: string; docNumber: string; customerName: string; total: number
  email: string; phone: string
  busy: boolean; error: string; success: string
  onSend: (channel: 'sms' | 'email') => void; onClose: () => void
}) {
  const [channel, setChannel] = useState<'sms' | 'email' | null>(phone ? 'sms' : email ? 'email' : null)
  const who = customerName || 'the customer'
  const option = (id: 'sms' | 'email', title: string, address: string, missing: string, detail: string) => {
    const has = !!address
    const on = channel === id
    return (
      <label className={`flex min-h-[64px] items-start gap-3 rounded-md border p-3 ${has ? 'cursor-pointer' : 'cursor-not-allowed opacity-70'} ${on && has ? 'border-blue bg-blue/10' : 'border-line bg-bg-card'}`}>
        <input type="radio" name="send-channel" className="mt-1 h-5 w-5 shrink-0 accent-[rgb(var(--c-blue))]" checked={on && has} disabled={!has || busy || !!success} onChange={() => setChannel(id)} />
        <span className="min-w-0">
          <span className="block font-bold">{title}</span>
          <span className="block break-words text-[0.9375rem]">{has ? `To ${id === 'sms' ? phonePretty(address) : address}` : missing}</span>
          {has && <span className="mt-0.5 block text-[0.8125rem] text-text-secondary">{detail}</span>}
        </span>
      </label>
    )
  }
  const totalText = formatCurrency(total)
  const sentence = channel === 'sms'
    ? `We will text ${who} at ${phonePretty(phone)}: a short message saying ${noun} ${docNumber} is ready, with the total of ${totalText} and the shop's phone number.`
    : channel === 'email'
      ? `We will email ${who} at ${email} the full ${noun} ${docNumber}: parts, labor and the total of ${totalText}.`
      : ''
  return (
    <div>
      <dl className="mb-4 rounded-md border border-border bg-bg-base px-3 py-2 text-[0.9375rem]">
        <SummaryRow label={`${noun[0].toUpperCase()}${noun.slice(1)}`} value={docNumber} />
        <SummaryRow label="Customer" value={customerName || 'No customer yet'} />
        <SummaryRow label="Total" value={totalText} strong />
      </dl>
      <fieldset className="space-y-2">
        <legend className="form-label">How should we send it?</legend>
        {option('sms', 'Text message', phone, 'No phone number on file', 'The customer replies to your shop number.')}
        {option('email', 'Email', email, 'No email on file', 'Includes every line and the total.')}
      </fieldset>
      {!phone && !email && <div className="mt-3"><WarnMsg>Add a phone number or email to this customer first, then send.</WarnMsg></div>}
      {sentence && !success && <p className="mt-3 text-[0.9375rem]">{sentence}</p>}
      {error && <div className="mt-3"><ErrorMsg>Not sent. {error}</ErrorMsg></div>}
      {success && <div className="mt-3"><OkMsg>{success}</OkMsg></div>}
      <div className={actions}>
        {success ? (
          <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
        ) : (
          <>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={busy || !channel} onClick={() => channel && onSend(channel)}>
              <Icon name="send" className="h-5 w-5" />
              {busy ? 'Sending…' : channel === 'email' ? 'Send email' : 'Send text message'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/* ---------- Request signature ---------- */

export interface SigResult { type: 'success' | 'error' | 'partial'; msg: string; signUrl?: string }

export function SignatureForm({ noun, isEstimate, docNumber, customerName, email, total, signedAt, signerName, requestedAt, busy, result, onSend, onClose }: {
  noun: string; isEstimate: boolean; docNumber: string; customerName: string; email: string; total: number
  signedAt?: string; signerName?: string; requestedAt?: string
  busy: boolean; result: SigResult | null
  onSend: () => void; onClose: () => void
}) {
  const [copied, setCopied] = useState(false)
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(true) } catch { setCopied(false) }
  }
  if (signedAt) {
    return (
      <div>
        <OkMsg>
          <p className="font-bold">Already signed</p>
          <p>Signed by {signerName || 'the customer'} on {new Date(signedAt).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}.</p>
        </OkMsg>
        <div className={actions}><button type="button" className="btn btn-primary" onClick={onClose}>Close</button></div>
      </div>
    )
  }
  const who = customerName || 'the customer'
  const done = result?.type === 'success'
  return (
    <div>
      <dl className="mb-4 rounded-md border border-border bg-bg-base px-3 py-2 text-[0.9375rem]">
        <SummaryRow label={`${noun[0].toUpperCase()}${noun.slice(1)}`} value={docNumber} />
        <SummaryRow label="Customer" value={customerName || 'No customer yet'} />
        <SummaryRow label="Email" value={email || 'None on file'} />
        <SummaryRow label="Total" value={formatCurrency(total)} strong />
      </dl>
      {requestedAt && !done && (
        <p className="mb-3 text-[0.9375rem] text-text-secondary">A request was already sent on {new Date(requestedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}. Sending again emails a new link; the old link keeps working.</p>
      )}
      {!email ? (
        <WarnMsg>There is no email on file for {who}. Add one on the {noun}, save, then request a signature.</WarnMsg>
      ) : !done && (
        <p className="text-[0.9375rem]">
          We will email {who} at {email} a secure link to review and sign {noun} {docNumber} for {formatCurrency(total)}.{isEstimate ? ' The email also has a button to approve the estimate without signing.' : ''} The link works for 30 days. You will see the signature here once they sign.
        </p>
      )}
      {result && (
        <div className="mt-3 space-y-2">
          {result.type === 'success' && <OkMsg>{result.msg}</OkMsg>}
          {result.type === 'partial' && <WarnMsg>{result.msg}</WarnMsg>}
          {result.type === 'error' && <ErrorMsg>{result.msg}</ErrorMsg>}
          {result.signUrl && (
            <div className="rounded-md border border-border bg-bg-base p-3">
              <p className="text-[0.8125rem] font-bold text-text-secondary">Signing link</p>
              <a href={result.signUrl} target="_blank" rel="noopener noreferrer" className="block break-all text-[0.9375rem] text-blue underline">{result.signUrl}</a>
              <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => copy(result.signUrl!)}>
                <Icon name="copy" className="h-4 w-4" />
                {copied ? 'Copied' : 'Copy link'}
              </button>
            </div>
          )}
        </div>
      )}
      <div className={actions}>
        {done ? (
          <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
        ) : (
          <>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={busy || !email} onClick={onSend}>
              <Icon name="pen" className="h-5 w-5" />
              {busy ? 'Sending…' : requestedAt ? 'Send again' : 'Email signature request'}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

/* ---------- Record payment ---------- */

export function PaymentForm({ noun, docNumber, customerName, total, paid, owed, initialMethod, methods: shopMethods, busy, error, done, onSubmit, onClose }: {
  noun: string; docNumber: string; customerName: string
  total: number; paid: number; owed: number
  initialMethod: string
  /** The shop's accepted payment methods. Falls back to a standard list. */
  methods?: string[]
  busy: boolean; error: string
  done: { amount: number; balance: number } | null
  onSubmit: (rawAmount: string, method: string) => void
  onClose: () => void
}) {
  const [amount, setAmount] = useState(owed.toFixed(2))
  const [method, setMethod] = useState(initialMethod)
  const base = shopMethods && shopMethods.length > 0 ? shopMethods : PAYMENT_METHODS
  const methods = useMemo(() => (method && method !== 'unspecified' && !base.includes(method) ? [method, ...base] : base), [method, base])
  const typed = Number.parseFloat(amount.replace(/[^0-9.]/g, ''))
  const valid = typed > 0 && typed <= owed + 0.005
  const after = Math.max(0, owed - (typed > 0 ? typed : 0))
  if (done) {
    return (
      <div>
        <OkMsg>
          <p className="font-bold">{formatCurrency(done.amount)} payment recorded</p>
          <p>{done.balance > 0.005 ? `${formatCurrency(done.balance)} is still due.` : `${noun[0].toUpperCase()}${noun.slice(1)} ${docNumber} is paid in full.`}</p>
        </OkMsg>
        <div className={actions}><button type="button" className="btn btn-primary" onClick={onClose}>Done</button></div>
      </div>
    )
  }
  return (
    <div>
      <dl className="mb-4 rounded-md border border-border bg-bg-base px-3 py-2 text-[0.9375rem]">
        <SummaryRow label={customerName || docNumber} value={docNumber} />
        <SummaryRow label="Total" value={formatCurrency(total)} />
        {paid > 0 && <SummaryRow label="Paid so far" value={formatCurrency(paid)} />}
        <SummaryRow label="Balance due" value={formatCurrency(owed)} strong />
      </dl>
      <div className="space-y-3">
        <Field id="pay-amount" label="Amount received">
          <div className="relative">
            <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary">$</span>
            <input
              id="pay-amount"
              className="form-input num pl-7 text-[1.25rem] font-bold"
              inputMode="decimal"
              autoComplete="off"
              value={amount}
              onFocus={e => e.currentTarget.select()}
              onChange={e => setAmount(e.target.value)}
              aria-describedby="pay-help"
            />
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAmount(owed.toFixed(2))}>Full balance {formatCurrency(owed)}</button>
            {owed > 1 && <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAmount((Math.round(owed * 50) / 100).toFixed(2))}>Half {formatCurrency(Math.round(owed * 50) / 100)}</button>}
          </div>
        </Field>
        <Field id="pay-method" label="Paid by">
          <select id="pay-method" className="form-select" value={method} onChange={e => setMethod(e.target.value)}>
            {(!method || method === 'unspecified') && <option value="unspecified">Not recorded</option>}
            {methods.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
      </div>
      <p id="pay-help" className="mt-3 text-[0.8125rem] text-text-secondary">This records money you already received. It does not charge the customer&apos;s card.</p>
      {typed > owed + 0.005 && <p className="form-error">Payment cannot exceed the remaining balance of {formatCurrency(owed)}.</p>}
      {!(typed > 0) && amount.trim() !== '' && <p className="form-error">Enter a payment greater than zero.</p>}
      {valid && <p className="mt-2 text-[0.9375rem] num">Balance due after this payment: <strong>{formatCurrency(after)}</strong></p>}
      {error && <div className="mt-3"><ErrorMsg>{error}</ErrorMsg></div>}
      <div className={actions}>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={busy || !valid} onClick={() => onSubmit(amount, method)}>
          <Icon name="dollar" className="h-5 w-5" />
          {busy ? 'Recording…' : valid ? `Record ${formatCurrency(typed)} payment` : 'Record payment'}
        </button>
      </div>
    </div>
  )
}

/* ---------- Payment plan ---------- */

export function PlanForm({ docNumber, total, form, setForm, busy, error, onSave, onClose }: {
  docNumber: string; total: number
  form: { down_payment: number; installments: number; frequency: string }
  setForm: (f: (p: { down_payment: number; installments: number; frequency: string }) => { down_payment: number; installments: number; frequency: string }) => void
  busy: boolean; error: string
  onSave: () => void; onClose: () => void
}) {
  const remaining = total - form.down_payment
  const per = remaining / form.installments
  const freqDays = form.frequency === 'weekly' ? 7 : form.frequency === 'biweekly' ? 14 : 30
  const first = new Date(); first.setDate(first.getDate() + freqDays)
  const firstDue = fmtDate(first.toISOString().split('T')[0])
  const invalid = !(form.down_payment >= 0) || form.down_payment > total
  const freqWord = form.frequency === 'weekly' ? 'weekly' : form.frequency === 'biweekly' ? 'every two weeks' : 'monthly'
  return (
    <div>
      <p className="mb-3 text-[0.9375rem] text-text-secondary">Invoice {docNumber} total: <strong className="num text-text-primary">{formatCurrency(total)}</strong></p>
      <div className="space-y-3">
        <Field id="plan-down" label="Down payment">
          <div className="relative">
            <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary">$</span>
            <input id="plan-down" className="form-input num pl-7" type="number" inputMode="decimal" step="0.01" min="0" value={form.down_payment} onFocus={e => e.currentTarget.select()} onChange={e => setForm(f => ({ ...f, down_payment: Number(e.target.value) }))} />
          </div>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="plan-count" label="Number of payments">
            <select id="plan-count" className="form-select" value={form.installments} onChange={e => setForm(f => ({ ...f, installments: Number(e.target.value) }))}>
              {[2, 3, 4, 5, 6, 12].map(n => <option key={n} value={n}>{n} payments</option>)}
            </select>
          </Field>
          <Field id="plan-freq" label="How often">
            <select id="plan-freq" className="form-select" value={form.frequency} onChange={e => setForm(f => ({ ...f, frequency: e.target.value }))}>
              <option value="weekly">Weekly</option>
              <option value="biweekly">Every two weeks</option>
              <option value="monthly">Monthly</option>
            </select>
          </Field>
        </div>
      </div>
      <dl className="mt-4 rounded-md border border-border bg-bg-base px-3 py-2 text-[0.9375rem]">
        <SummaryRow label="After the down payment" value={formatCurrency(remaining)} />
        <SummaryRow label={`${form.installments} payments, ${freqWord}`} value={formatCurrency(per)} strong />
        <SummaryRow label="First payment due" value={firstDue} />
      </dl>
      {invalid && <p className="form-error">The down payment must be between $0.00 and {formatCurrency(total)}.</p>}
      <p className="mt-3 text-[0.8125rem] text-text-secondary">A payment plan is a schedule to keep track of. Record each payment you receive with Record payment.</p>
      {error && <div className="mt-3"><ErrorMsg>{error}</ErrorMsg></div>}
      <div className={actions}>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-primary" disabled={busy || invalid} onClick={onSave}>{busy ? 'Saving…' : 'Save payment plan'}</button>
      </div>
    </div>
  )
}

/* ---------- Customer picker and quick add ---------- */

export function CustomerPicker({ customers, selectedId, onPick, onAddNew }: {
  customers: Customer[]; selectedId?: string
  onPick: (id: string) => void; onAddNew: () => void
}) {
  const [q, setQ] = useState('')
  const term = q.trim().toLowerCase()
  const digits = term.replace(/\D/g, '')
  const matches = useMemo(() => customers.filter(c => {
    if (!term) return true
    return String(c.name || '').toLowerCase().includes(term)
      || String(c.email || '').toLowerCase().includes(term)
      || (digits.length > 1 && String(c.phone || '').replace(/\D/g, '').includes(digits))
      || [c.vehicle_year, c.vehicle_make, c.vehicle_model].filter(Boolean).join(' ').toLowerCase().includes(term)
  }), [customers, term, digits])
  const shown = matches.slice(0, 40)
  return (
    <div>
      <div className="relative">
        <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted" />
        <input type="search" className="form-input pl-10" placeholder="Search by name, phone or vehicle" aria-label="Search customers" value={q} onChange={e => setQ(e.target.value)} autoFocus />
      </div>
      <button type="button" className="btn btn-secondary mt-3 w-full" onClick={onAddNew}>
        <Icon name="plus" className="h-5 w-5" />
        Add a new customer
      </button>
      {customers.length === 0 ? (
        <p className="py-6 text-center text-[0.9375rem] text-text-secondary">No customers yet. Add the first one above.</p>
      ) : shown.length === 0 ? (
        <p className="py-6 text-center text-[0.9375rem] text-text-secondary">No customer matches “{q.trim()}”.</p>
      ) : (
        <ul className="ledger mt-3 max-h-[50dvh] overflow-y-auto">
          {shown.map(c => {
            const car = [c.vehicle_year, c.vehicle_make, c.vehicle_model].filter(Boolean).join(' ')
            const sub = [c.phone ? phonePretty(c.phone) : '', car].filter(Boolean).join(' · ')
            return (
              <li key={c.id}>
                <button type="button" className="ledger-row" onClick={() => onPick(c.id)} aria-current={c.id === selectedId ? 'true' : undefined}>
                  <span className="ledger-main">
                    <span className="ledger-title block">{c.name || 'Unnamed'}</span>
                    {sub && <span className="ledger-sub block">{sub}</span>}
                  </span>
                  {c.id === selectedId && <Icon name="check" className="h-5 w-5 shrink-0 text-blue" />}
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {matches.length > shown.length && <p className="mt-2 text-[0.8125rem] text-text-muted num">Showing {shown.length} of {matches.length}. Keep typing to narrow the list.</p>}
    </div>
  )
}

export function NewCustomerForm({ busy, error, onSubmit, onCancel }: {
  busy: boolean; error: string
  onSubmit: (v: { name: string; email: string; phone: string }) => void; onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  return (
    <form onSubmit={e => { e.preventDefault(); if (name.trim() && !busy) onSubmit({ name, email, phone }) }}>
      <div className="space-y-3">
        <Field id="nc-name" label="Name">
          <input id="nc-name" className="form-input" value={name} onChange={e => setName(e.target.value)} autoFocus autoComplete="off" required />
        </Field>
        <Field id="nc-phone" label="Phone (optional)">
          <input id="nc-phone" className="form-input" type="tel" inputMode="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="(555) 123-4567" />
        </Field>
        <Field id="nc-email" label="Email (optional)">
          <input id="nc-email" className="form-input" type="email" inputMode="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@example.com" />
        </Field>
      </div>
      {error && <div className="mt-3"><ErrorMsg>{error}</ErrorMsg></div>}
      <div className={actions}>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Back</button>
        <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>{busy ? 'Adding…' : 'Add and select customer'}</button>
      </div>
    </form>
  )
}

/* ---------- More actions menu ---------- */

export interface MenuItem { key: string; label: string; hint?: string; icon: string; onClick: () => void; danger?: boolean }

export function ActionsMenu({ items }: { items: MenuItem[] }) {
  const normal = items.filter(i => !i.danger)
  const danger = items.filter(i => i.danger)
  const row = (i: MenuItem) => (
    <li key={i.key}>
      <button type="button" className={`ledger-row ${i.danger ? '!text-red' : ''}`} onClick={i.onClick}>
        <Icon name={i.icon} className={`h-5 w-5 shrink-0 ${i.danger ? '' : 'text-text-secondary'}`} />
        <span className="ledger-main">
          <span className="ledger-title block">{i.label}</span>
          {i.hint && <span className={`ledger-sub block ${i.danger ? '!text-red' : ''}`}>{i.hint}</span>}
        </span>
        {!i.danger && <Icon name="chevronRight" className="h-5 w-5 shrink-0 text-text-muted" />}
      </button>
    </li>
  )
  return (
    <div>
      <ul className="ledger">{normal.map(row)}</ul>
      {danger.length > 0 && <ul className="mt-4 ledger">{danger.map(row)}</ul>}
    </div>
  )
}
