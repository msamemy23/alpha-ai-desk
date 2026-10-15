'use client'
import { useState } from 'react'
import Icon from '@/components/Icon'
import type { PayMethod, PayRate } from '@/lib/jobtime'

const METHODS: { value: PayMethod; label: string; unit: string; help: string }[] = [
  { value: 'hourly', label: 'Hourly', unit: 'Dollars an hour', help: 'Paid for hours on the clock. Overtime counts at the rates in the pay rules.' },
  { value: 'flat', label: 'Flat rate', unit: 'Dollars per hour sold', help: 'Paid for the hours sold on the repair orders they worked, whatever the clock says.' },
  { value: 'commission', label: 'Commission', unit: 'Percent of labor sold', help: 'Paid a share of the labor sold on their repair orders.' },
]

/** One person's pay rate. Owners and admins only. It is used for a rough cost on the efficiency screen and never goes into a payroll file. */
export default function PayPanel({ name, rate, unavailable, busy, error, onSave, onBack }: {
  name: string
  rate: PayRate | undefined
  unavailable: boolean
  busy: boolean
  error: string
  onSave: (r: { method: PayMethod; value: number }) => void
  onBack: () => void
}) {
  const [method, setMethod] = useState<PayMethod>(rate ? rate.method : 'hourly')
  const [value, setValue] = useState(() => {
    if (!rate) return ''
    const v = rate.method === 'flat' ? rate.flat : rate.method === 'commission' ? rate.commissionPct : rate.hourly
    return v === null ? '' : String(v)
  })
  const [shown, setShown] = useState('')
  const m = METHODS.find(x => x.value === method) as (typeof METHODS)[number]

  const submit = () => {
    const n = Number(value.replace(/[$,%\s]/g, ''))
    if (value.trim() === '' || !Number.isFinite(n) || n < 0) { setShown('Enter a number, like 28.50.'); return }
    if (method === 'commission' && n > 100) { setShown('A commission is between 0 and 100 percent.'); return }
    if (method !== 'commission' && n > 1000) { setShown('That rate looks too high. Enter dollars an hour.'); return }
    setShown('')
    onSave({ method, value: n })
  }
  const message = shown || error

  return (
    <form onSubmit={e => { e.preventDefault(); submit() }} className="space-y-4" noValidate>
      <button type="button" className="btn btn-ghost btn-sm -ml-2" onClick={onBack}><Icon name="chevronLeft" className="h-4 w-4" />Back to {name}</button>
      <h3 className="section-title">Pay rate for {name}</h3>
      {unavailable ? <p className="text-[0.9375rem] text-text-secondary">Pay rates need a database update. Ask whoever set up the app to apply it.</p> : (
        <>
          <p className="text-[0.875rem] text-text-secondary">Only owners and admins can see this. It is used to estimate what a shift or a job cost the shop. It is not a payroll calculation and is never put in the payroll files.</p>
          <div role="radiogroup" aria-label="How they are paid" className="space-y-2">
            {METHODS.map(x => (
              <label key={x.value} className={`flex min-h-[44px] cursor-pointer items-start gap-3 rounded-md border px-3 py-2.5 ${method === x.value ? 'border-blue bg-blue/[0.06]' : 'border-border bg-bg-card'}`}>
                <input type="radio" name="pay-method" className="mt-1 h-5 w-5 shrink-0 accent-[rgb(var(--c-blue))]" checked={method === x.value} onChange={() => { setMethod(x.value); setShown('') }} />
                <span className="min-w-0"><span className="block font-bold">{x.label}</span><span className="block text-[0.875rem] text-text-secondary">{x.help}</span></span>
              </label>
            ))}
          </div>
          <div>
            <label htmlFor="pay-value" className="form-label">{m.unit}</label>
            <input id="pay-value" className="form-input num sm:max-w-[14rem]" inputMode="decimal" value={value} onChange={e => { setValue(e.target.value); setShown('') }} />
          </div>
          {message && <p role="alert" className="form-error">{message}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className="btn btn-secondary" onClick={onBack} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save pay rate'}</button>
          </div>
        </>
      )}
    </form>
  )
}
