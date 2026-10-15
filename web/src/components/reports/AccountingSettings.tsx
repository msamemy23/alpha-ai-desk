'use client'
import { useEffect, useState } from 'react'
import { Field } from '@/components/forms/Field'
import FormError from '@/components/forms/FormError'
import Notice from '@/components/Notice'
import { Segmented, Switch } from '@/components/ScreenParts'
import { DEFAULT_SETTINGS } from '@/lib/books-store'
import type { BooksSettings } from '@/lib/books-store'
import type { TaxComponent } from '@/lib/sales-tax'
import { totalRate } from '@/lib/sales-tax'
import { ResourceNotice } from './BooksNotice'
import type { BooksData } from './useBooks'
import type { ApiResult } from '@/lib/client-api'

interface Draft { basis: string; cogsMethod: string; journalMode: string; includeCost: boolean; dailyCustomer: string; laborCostPerHour: string; tax: { name: string; rate: string; agency: string }[] }

const draftFrom = (s: BooksSettings): Draft => ({
  basis: s.basis, cogsMethod: s.cogsMethod, journalMode: s.journalMode, includeCost: s.includeCost, dailyCustomer: s.dailyCustomer,
  laborCostPerHour: s.laborCostPerHour === null ? '' : String(s.laborCostPerHour),
  tax: s.taxComponents.map(t => ({ name: t.name, rate: String(t.ratePct), agency: t.agency })),
})

/** How the books are kept, who sales tax is paid to, and what a technician's hour costs. Changes only how reports are worked out. */
export default function AccountingSettings({ books, reload, act }: { books: BooksData; reload: () => void; act: (body: Record<string, unknown>) => Promise<ApiResult<Record<string, unknown>>> }) {
  const source = books.settings.state === 'ok' ? books.settings.value : DEFAULT_SETTINGS
  const [d, setD] = useState<Draft>(() => draftFrom(source))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [saved, setSaved] = useState(false)

  // A fresh read from the server replaces the draft only when the person has no unsaved typing in it.
  const [dirty, setDirty] = useState(false)
  useEffect(() => { if (!dirty) setD(draftFrom(source)) }, [source, dirty])
  const edit = (patch: Partial<Draft>) => { setD(x => ({ ...x, ...patch })); setDirty(true); setSaved(false) }

  const unavailable = books.settings.state !== 'ok'
  const comps: TaxComponent[] = d.tax.map(t => ({ name: t.name.trim(), ratePct: Number(t.rate) || 0, agency: t.agency.trim() }))
  const sum = totalRate(comps.filter(c => c.ratePct > 0))

  const save = async () => {
    setBusy(true); setError(''); setFields({}); setSaved(false)
    const r = await act({
      action: 'settings',
      settings: {
        basis: d.basis, cogsMethod: d.cogsMethod, journalMode: d.journalMode, includeCost: d.includeCost, dailyCustomer: d.dailyCustomer,
        laborCostPerHour: d.laborCostPerHour.trim() === '' ? null : d.laborCostPerHour,
        taxComponents: d.tax.filter(t => t.name.trim() || t.rate.trim() || t.agency.trim()).map(t => ({ name: t.name, ratePct: Number(t.rate), agency: t.agency })),
      },
    })
    setBusy(false)
    if (r.ok) { setDirty(false); setSaved(true); return }
    setError(r.needsUpdate ? 'This needs a one-time update to your Alpha Desk database before settings can be saved. Nothing else is affected.' : r.message)
    setFields(r.fields)
  }

  return (
    <div className="space-y-4">
      <ResourceNotice r={books.settings} what="Your accounting settings" onRetry={reload} />
      <section className="panel">
        <div className="panel-header"><h2 className="section-title">How you keep your books</h2></div>
        <div className="panel-body space-y-4">
          <Field id="acct-basis" label="Count income when it is" hint="Accrual counts a sale on the invoice date. Cash counts it on the day the money arrives. Ask your accountant which your tax return uses." error={fields.basis}>
            <Segmented label="Basis" idPrefix="acct-basis" value={d.basis as 'accrual' | 'cash'} onChange={k => edit({ basis: k })} columns="grid-cols-2" options={[{ key: 'accrual', label: 'Billed (accrual)' }, { key: 'cash', label: 'Received (cash)' }]} />
          </Field>
          <Field id="acct-cogs" label="Cost of parts comes from" hint="Invoices uses the cost written on each part line. Parts bills uses what you entered under Bills and expenses." error={fields.cogsMethod}>
            <Segmented label="Cost of parts" idPrefix="acct-cogs" value={d.cogsMethod as 'invoices' | 'purchases'} onChange={k => edit({ cogsMethod: k })} columns="grid-cols-2" options={[{ key: 'invoices', label: 'Costs on invoices' }, { key: 'purchases', label: 'Parts bills' }]} />
          </Field>
          <Field id="acct-labor-cost" label="What an hour of a technician costs you" hint="Used to estimate profit on each job. Pay, taxes and benefits together, per hour. Leave empty to count only parts." error={fields.laborCostPerHour}>
            <div className="relative sm:max-w-xs">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary" aria-hidden="true">$</span>
              <input id="acct-labor-cost" className="form-input pl-7" inputMode="decimal" value={d.laborCostPerHour} onChange={e => edit({ laborCostPerHour: e.target.value })} placeholder="32.50" aria-describedby={fields.laborCostPerHour ? 'acct-labor-cost-err' : undefined} />
            </div>
          </Field>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><h2 className="section-title">Sales tax authorities</h2></div>
        <div className="panel-body space-y-3">
          <p className="text-text-secondary">List each place you collect tax for, with its rate. Reports then split the tax you collected between them. Total rate: <span className="num font-bold text-text-primary">{sum}%</span>.</p>
          {d.tax.length === 0 && <p className="rounded-md border border-border bg-bg-chrome p-3 text-text-secondary">No authorities yet. Add your state, then any county, city or district that gets a share.</p>}
          {d.tax.map((t, i) => (
            <div key={i} className="grid grid-cols-[1fr_5.5rem] gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_6rem_1fr_auto]">
              <Field id={`tax-name-${i}`} label="Name"><input id={`tax-name-${i}`} className="form-input" value={t.name} placeholder="State" onChange={e => edit({ tax: d.tax.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} /></Field>
              <Field id={`tax-rate-${i}`} label="Rate %"><input id={`tax-rate-${i}`} className="form-input" inputMode="decimal" value={t.rate} placeholder="6.25" onChange={e => edit({ tax: d.tax.map((x, j) => (j === i ? { ...x, rate: e.target.value } : x)) })} /></Field>
              <Field id={`tax-agency-${i}`} label="Pay to (optional)" className="col-span-2 sm:col-span-1"><input id={`tax-agency-${i}`} className="form-input" value={t.agency} placeholder="State comptroller" onChange={e => edit({ tax: d.tax.map((x, j) => (j === i ? { ...x, agency: e.target.value } : x)) })} /></Field>
              <div className="col-span-2 flex items-end sm:col-span-1"><button type="button" className="btn btn-secondary" onClick={() => edit({ tax: d.tax.filter((_, j) => j !== i) })}>Remove</button></div>
            </div>
          ))}
          {fields.taxComponents && <p className="form-error">{fields.taxComponents}</p>}
          <button type="button" className="btn btn-secondary" disabled={d.tax.length >= 12} onClick={() => edit({ tax: [...d.tax, { name: '', rate: '', agency: '' }] })}>Add an authority</button>
        </div>
      </section>

      <section className="panel">
        <div className="panel-header"><h2 className="section-title">Files for your accountant</h2></div>
        <div className="panel-body space-y-4">
          <Field id="acct-mode" label="Each invoice becomes" hint="One entry per invoice keeps every invoice traceable. One entry per day is shorter if your accountant only wants daily totals." error={fields.journalMode}>
            <Segmented label="Entries" idPrefix="acct-mode" value={d.journalMode as 'individual' | 'daily'} onChange={k => edit({ journalMode: k })} columns="grid-cols-2" options={[{ key: 'individual', label: 'One entry each' }, { key: 'daily', label: 'One entry per day' }]} />
          </Field>
          {d.journalMode === 'daily' && (
            <Field id="acct-daily" label="Customer name on daily totals" hint="QuickBooks wants a name on receivable lines." error={fields.dailyCustomer}>
              <input id="acct-daily" className="form-input sm:max-w-xs" value={d.dailyCustomer} onChange={e => edit({ dailyCustomer: e.target.value })} />
            </Field>
          )}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><p className="font-bold text-text-primary">Also post the cost of parts sold</p><p className="text-[0.875rem] text-text-secondary">Adds entries that move parts from your stock account to cost of goods sold. Turn this on only if your accountant tracks inventory.</p></div>
            <Switch checked={d.includeCost} onChange={v => edit({ includeCost: v })} label="Also post the cost of parts sold" />
          </div>
        </div>
      </section>

      {error && <FormError>{error}</FormError>}
      {saved && <Notice kind="success">Saved. Reports and files now use these settings.</Notice>}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn btn-primary" onClick={save} disabled={busy || unavailable || !dirty}>{busy ? 'Saving' : 'Save settings'}</button>
        {dirty && <button type="button" className="btn btn-secondary" onClick={() => { setD(draftFrom(source)); setDirty(false); setFields({}); setError('') }} disabled={busy}>Discard changes</button>}
        {unavailable && <p className="text-[0.875rem] text-text-secondary">Settings cannot be saved until the notice above is dealt with.</p>}
      </div>
    </div>
  )
}
