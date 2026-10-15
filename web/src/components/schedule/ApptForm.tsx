'use client'
import { useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import { phonePretty } from '@/lib/today'
import { DURATIONS, TIMES, byTime, fmtTime, hhmm, overlaps, parseYmd, dayShort, isClosed } from './types'
import type { Appointment, ApptCustomer } from './types'

const field = 'form-label'

export default function ApptForm({
  form, setForm, isNew, customers, techs, serviceIdeas, appts, saving, error, onSave, onCancel, onDelete,
}: {
  form: Partial<Appointment>
  setForm: React.Dispatch<React.SetStateAction<Partial<Appointment>>>
  isNew: boolean
  customers: ApptCustomer[]
  techs: string[]
  /** Canned job names offered as one tap service choices. */
  serviceIdeas: string[]
  appts: Appointment[]
  saving: boolean
  error: string
  onSave: () => void
  onCancel: () => void
  onDelete?: () => void
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
      || [c.vehicle_year, c.vehicle_make, c.vehicle_model].filter(Boolean).join(' ').toLowerCase().includes(term)
    ).slice(0, 6)
  }, [customers, term, digits])

  const choose = (c: ApptCustomer) => {
    const v = [c.vehicle_year, c.vehicle_make, c.vehicle_model].filter(Boolean).join(' ')
    setForm(f => ({ ...f, customer_id: c.id, customer_name: c.name, phone: c.phone || '', vehicle: v }))
    setPicking(false); setQ('')
  }

  const set = <K extends keyof Appointment>(k: K, v: Appointment[K]) => setForm(f => ({ ...f, [k]: v }))
  const time = hhmm(form.time)
  const times = time && !TIMES.includes(time) ? [time, ...TIMES].sort() : TIMES

  // Warn, never block: a shop can double book on purpose.
  const clash = useMemo(() => {
    if (!form.date || !form.time) return null
    const me = { ...form, id: form.id || '__draft', time: form.time, duration: Number(form.duration) || 60 } as Appointment
    const hits = appts.filter(a => a.id !== form.id && !isClosed(a.status) && overlaps(me, a))
    if (!hits.length) return null
    const sameTech = form.tech && form.tech !== 'Unassigned' ? hits.find(a => a.tech === form.tech) : undefined
    return { sameTech, hits: hits.sort(byTime) }
  }, [form, appts])

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
            <label htmlFor="ap-find" className={field}>Find a customer</label>
            <div className="relative">
              <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted" />
              <input id="ap-find" className="form-input pl-10" type="search" autoComplete="off" placeholder="Name, phone or vehicle" value={q} onChange={e => setQ(e.target.value)} />
            </div>
            {matches.length > 0 && (
              <ul className="ledger mt-2">
                {matches.map(c => (
                  <li key={c.id}>
                    <button type="button" className="ledger-row" onClick={() => choose(c)}>
                      <span className="ledger-main">
                        <span className="ledger-title block">{c.name}</span>
                        <span className="ledger-sub block">{[c.phone ? phonePretty(c.phone) : '', [c.vehicle_year, c.vehicle_make, c.vehicle_model].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {term && matches.length === 0 && <p className="mt-2 text-[0.9375rem] text-text-secondary">No customer matches “{q.trim()}”. Type their name below to book a walk-in.</p>}
            <div className="mt-3">
              <label htmlFor="ap-name" className={field}>Or type a name</label>
              <input id="ap-name" className="form-input" autoComplete="off" value={form.customer_name || ''} onChange={e => set('customer_name', e.target.value)} placeholder="Customer name" />
              {form.customer_name && <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => setPicking(false)}>Use “{form.customer_name}”</button>}
            </div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="ap-phone" className={field}>Phone</label>
            <input id="ap-phone" className="form-input" type="tel" inputMode="tel" autoComplete="off" value={form.phone || ''} onChange={e => set('phone', e.target.value)} placeholder="(555) 123-4567" />
          </div>
          <div>
            <label htmlFor="ap-vehicle" className={field}>Vehicle</label>
            <input id="ap-vehicle" className="form-input" autoComplete="off" value={form.vehicle || ''} onChange={e => set('vehicle', e.target.value)} placeholder="2018 Toyota Camry" />
          </div>
        </div>
      </fieldset>

      <fieldset className="space-y-3">
        <legend className="section-title mb-2">The visit</legend>
        <div>
          <label htmlFor="ap-service" className={field}>Service</label>
          <input id="ap-service" className="form-input" autoComplete="off" value={form.service || ''} onChange={e => set('service', e.target.value)} placeholder="Oil change, brakes, diagnosis" />
          {serviceIdeas.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Quick service choices">
              {serviceIdeas.slice(0, 6).map(s => (
                <button key={s} type="button" className="inline-flex min-h-[36px] items-center rounded-full border border-line bg-bg-card px-3 text-[0.875rem] font-bold hover:bg-bg-hover" onClick={() => set('service', s)}>{s}</button>
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="ap-date" className={field}>Date</label>
            <input id="ap-date" type="date" className="form-input" value={form.date || ''} onChange={e => set('date', e.target.value)} required />
          </div>
          <div>
            <label htmlFor="ap-time" className={field}>Start time</label>
            <select id="ap-time" className="form-select" value={time} onChange={e => set('time', e.target.value)} required>
              <option value="">Choose a time</option>
              {times.map(t => <option key={t} value={t}>{fmtTime(t)}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="ap-dur" className={field}>How long</label>
            <select id="ap-dur" className="form-select" value={Number(form.duration) || 60} onChange={e => set('duration', Number(e.target.value))}>
              {DURATIONS.map(d => <option key={d.m} value={d.m}>{d.label}</option>)}
              {!DURATIONS.some(d => d.m === (Number(form.duration) || 60)) && <option value={Number(form.duration)}>{form.duration} minutes</option>}
            </select>
          </div>
          <div>
            <label htmlFor="ap-tech" className={field}>Technician</label>
            {techs.length > 1 ? (
              <select id="ap-tech" className="form-select" value={form.tech || 'Unassigned'} onChange={e => set('tech', e.target.value)}>
                {techs.map(t => <option key={t} value={t}>{t}</option>)}
                {form.tech && !techs.includes(form.tech) && <option value={form.tech}>{form.tech}</option>}
              </select>
            ) : (
              <input id="ap-tech" className="form-input" value={form.tech && form.tech !== 'Unassigned' ? form.tech : ''} placeholder="Optional" onChange={e => set('tech', e.target.value || 'Unassigned')} />
            )}
          </div>
        </div>
        {clash && (
          <div role="status" className="flex items-start gap-2.5 rounded-md border border-amber/50 bg-amber/[0.1] px-3 py-2.5 text-[0.9375rem]">
            <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-amber" />
            <p>
              {clash.sameTech
                ? <>{clash.sameTech.tech} is already booked then: {clash.sameTech.customer_name} at {fmtTime(clash.sameTech.time)}.</>
                : <>{clash.hits.length === 1 ? 'Another appointment overlaps' : `${clash.hits.length} other appointments overlap`}: {clash.hits.map(h => `${h.customer_name} at ${fmtTime(h.time)}`).join(', ')}.</>}
              {' '}You can still save it.
            </p>
          </div>
        )}
        {!isNew && (
          <div>
            <label htmlFor="ap-status" className={field}>Status</label>
            <select id="ap-status" className="form-select" value={form.status || 'Scheduled'} onChange={e => set('status', e.target.value)}>
              <option value="Scheduled">Scheduled</option>
              <option value="Confirmed">Confirmed</option>
              <option value="In Progress">In the shop</option>
              <option value="Completed">Done</option>
              <option value="No Show">No show</option>
              <option value="Cancelled">Cancelled</option>
            </select>
          </div>
        )}
        <div>
          <label htmlFor="ap-notes" className={field}>Notes</label>
          <textarea id="ap-notes" className="form-textarea" rows={3} value={form.notes || ''} onChange={e => set('notes', e.target.value)} placeholder="What the customer described, how to reach them, anything the tech should know" />
        </div>
      </fieldset>

      {error && (
        <div role="alert" className="flex items-start gap-2.5 rounded-md border border-red/50 bg-red/[0.08] px-3 py-2.5 text-[0.9375rem] text-red">
          <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0" /><p>{error}</p>
        </div>
      )}
      {form.date && <p className="sr-only" aria-live="polite">{dayShort(parseYmd(form.date))}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        {onDelete && <button type="button" className="btn btn-ghost !text-red sm:mr-auto" onClick={onDelete} disabled={saving}><Icon name="trash" className="h-5 w-5" />Delete appointment</button>}
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : isNew ? 'Book appointment' : 'Save changes'}</button>
      </div>
    </form>
  )
}
