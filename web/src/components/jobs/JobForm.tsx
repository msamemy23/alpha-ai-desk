'use client'
import { useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import { phonePretty } from '@/lib/today'
import { PRIORITIES, STATUSES, carLine, statusWord } from './types'
import type { Job, JobCustomer } from './types'

export default function JobForm({ form, setForm, isNew, customers, techs, saving, error, onSave, onCancel }: {
  form: Partial<Job>
  setForm: React.Dispatch<React.SetStateAction<Partial<Job>>>
  isNew: boolean
  customers: JobCustomer[]
  techs: string[]
  saving: boolean
  error: string
  onSave: () => void
  onCancel: () => void
}) {
  const [q, setQ] = useState('')
  const [picking, setPicking] = useState(!form.customer_name)
  const term = q.trim().toLowerCase()
  const digits = term.replace(/\D/g, '')
  const matches = useMemo(() => {
    if (!term) return []
    return customers.filter(c =>
      String(c.name || '').toLowerCase().includes(term)
      || (digits.length > 1 && String(c.phone || '').replace(/\D/g, '').includes(digits))
      || carLine(c).toLowerCase().includes(term)
    ).slice(0, 6)
  }, [customers, term, digits])

  const set = <K extends keyof Job>(k: K, v: Job[K]) => setForm(f => ({ ...f, [k]: v }))
  const choose = (c: JobCustomer) => {
    setForm(f => ({
      ...f, customer_id: c.id, customer_name: c.name,
      vehicle_year: c.vehicle_year || '', vehicle_make: c.vehicle_make || '', vehicle_model: c.vehicle_model || '',
      vehicle_color: c.vehicle_color || '', vehicle_engine: c.vehicle_engine || '', vehicle_plate: c.vehicle_plate || '',
    }))
    setPicking(false); setQ('')
  }
  const text = (k: keyof Job) => String(form[k] ?? '')

  return (
    <form onSubmit={e => { e.preventDefault(); onSave() }} className="space-y-5" noValidate>
      <fieldset className="space-y-3">
        <legend className="section-title mb-2">Customer</legend>
        {form.customer_name && !picking ? (
          <div className="flex min-h-[60px] items-center gap-3 rounded-md border border-line bg-bg-input px-3">
            <Icon name="user" className="h-5 w-5 shrink-0 text-text-secondary" />
            <span className="min-w-0 flex-1">
              <span className="block truncate font-bold">{form.customer_name}</span>
              <span className="block truncate text-[0.875rem] text-text-secondary">{form.customer_id ? 'In your customer list' : 'Walk-in, not in your customer list'}</span>
            </span>
            <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => { setPicking(true); setQ('') }}>Change</button>
          </div>
        ) : (
          <div>
            <label htmlFor="jb-find" className="form-label">Find a customer</label>
            <div className="relative">
              <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted" />
              <input id="jb-find" className="form-input pl-10" type="search" autoComplete="off" placeholder="Name, phone or vehicle" value={q} onChange={e => setQ(e.target.value)} />
            </div>
            {matches.length > 0 && (
              <ul className="ledger mt-2">
                {matches.map(c => (
                  <li key={c.id}>
                    <button type="button" className="ledger-row" onClick={() => choose(c)}>
                      <span className="ledger-main">
                        <span className="ledger-title block">{c.name}</span>
                        <span className="ledger-sub block">{[c.phone ? phonePretty(c.phone) : '', carLine(c)].filter(Boolean).join(' · ')}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {term && matches.length === 0 && <p className="mt-2 text-[0.9375rem] text-text-secondary">No customer matches “{q.trim()}”. Type their name below for a walk-in.</p>}
            <div className="mt-3">
              <label htmlFor="jb-name" className="form-label">Or type a name</label>
              <input id="jb-name" className="form-input" autoComplete="off" value={form.customer_name || ''} onChange={e => set('customer_name', e.target.value)} placeholder="Customer name" />
              {form.customer_name && <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => setPicking(false)}>Use “{form.customer_name}”</button>}
            </div>
          </div>
        )}
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="section-title mb-2">Vehicle</legend>
        <div className="grid grid-cols-3 gap-3">
          <div><label htmlFor="jb-year" className="form-label">Year</label><input id="jb-year" className="form-input" inputMode="numeric" autoComplete="off" value={text('vehicle_year')} onChange={e => set('vehicle_year', e.target.value)} placeholder="2018" /></div>
          <div><label htmlFor="jb-make" className="form-label">Make</label><input id="jb-make" className="form-input" autoComplete="off" value={text('vehicle_make')} onChange={e => set('vehicle_make', e.target.value)} placeholder="Toyota" /></div>
          <div><label htmlFor="jb-model" className="form-label">Model</label><input id="jb-model" className="form-input" autoComplete="off" value={text('vehicle_model')} onChange={e => set('vehicle_model', e.target.value)} placeholder="Camry" /></div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><label htmlFor="jb-vin" className="form-label">VIN</label><input id="jb-vin" className="form-input num" autoComplete="off" autoCapitalize="characters" maxLength={17} value={text('vehicle_vin')} onChange={e => set('vehicle_vin', e.target.value.toUpperCase())} placeholder="17 characters" /></div>
          <div><label htmlFor="jb-miles" className="form-label">Mileage in</label><input id="jb-miles" className="form-input" inputMode="numeric" autoComplete="off" value={text('vehicle_mileage')} onChange={e => set('vehicle_mileage', e.target.value)} placeholder="87,432" /></div>
          <div><label htmlFor="jb-plate" className="form-label">License plate</label><input id="jb-plate" className="form-input" autoComplete="off" autoCapitalize="characters" value={text('vehicle_plate')} onChange={e => set('vehicle_plate', e.target.value.toUpperCase())} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label htmlFor="jb-color" className="form-label">Color</label><input id="jb-color" className="form-input" autoComplete="off" value={text('vehicle_color')} onChange={e => set('vehicle_color', e.target.value)} /></div>
            <div><label htmlFor="jb-engine" className="form-label">Engine</label><input id="jb-engine" className="form-input" autoComplete="off" value={text('vehicle_engine')} onChange={e => set('vehicle_engine', e.target.value)} placeholder="2.5L" /></div>
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="section-title mb-2">The job</legend>
        <div>
          <label htmlFor="jb-concern" className="form-label">What the customer says is wrong</label>
          <textarea id="jb-concern" className="form-textarea" rows={3} value={text('concern')} onChange={e => set('concern', e.target.value)} placeholder="Grinding noise when braking, worse on the highway" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="jb-status" className="form-label">Status</label>
            <select id="jb-status" className="form-select" value={form.status || 'New'} onChange={e => set('status', e.target.value)}>
              {STATUSES.map(s => <option key={s} value={s}>{statusWord(s)}</option>)}
              {form.status && !(STATUSES as readonly string[]).includes(form.status) && <option value={form.status}>{form.status}</option>}
            </select>
          </div>
          <div>
            <label htmlFor="jb-priority" className="form-label">Priority</label>
            <select id="jb-priority" className="form-select" value={form.priority || 'Normal'} onChange={e => set('priority', e.target.value)}>
              {PRIORITIES.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="jb-tech" className="form-label">Technician</label>
            {techs.length > 1 ? (
              <select id="jb-tech" className="form-select" value={form.tech || ''} onChange={e => set('tech', e.target.value)}>
                <option value="">Unassigned</option>
                {techs.filter(t => t !== 'Unassigned').map(t => <option key={t} value={t}>{t}</option>)}
                {form.tech && !techs.includes(form.tech) && <option value={form.tech}>{form.tech}</option>}
              </select>
            ) : (
              <input id="jb-tech" className="form-input" value={form.tech || ''} placeholder="Optional" onChange={e => set('tech', e.target.value)} />
            )}
          </div>
          <div>
            <label htmlFor="jb-due" className="form-label">Promised for</label>
            <input id="jb-due" type="date" className="form-input" value={(form.promise_date || '').slice(0, 10)} onChange={e => set('promise_date', e.target.value || null)} />
          </div>
        </div>
        <div>
          <label htmlFor="jb-internal" className="form-label">Notes for the shop</label>
          <textarea id="jb-internal" className="form-textarea" rows={2} value={text('internal_notes')} onChange={e => set('internal_notes', e.target.value)} placeholder="Only your team sees this" />
        </div>
        <div>
          <label htmlFor="jb-customer-notes" className="form-label">Notes for the customer</label>
          <textarea id="jb-customer-notes" className="form-textarea" rows={2} value={text('customer_notes')} onChange={e => set('customer_notes', e.target.value)} placeholder="Printed on the customer’s paperwork" />
        </div>
      </fieldset>

      {error && (
        <div role="alert" className="flex items-start gap-2.5 rounded-md border border-red/50 bg-red/[0.08] px-3 py-2.5 text-[0.9375rem] text-red">
          <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0" /><p>{error}</p>
        </div>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : isNew ? 'Create job' : 'Save changes'}</button>
      </div>
    </form>
  )
}
