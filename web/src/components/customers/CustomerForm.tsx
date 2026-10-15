'use client'
import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import FormActions from '@/components/inventory/FormActions'
import FormError from '@/components/inventory/FormError'
import { contactProblems } from '@/lib/list-logic'
import type { DuplicateHit } from '@/lib/list-logic'
import { SENTIMENTS, toTitleCase, text } from './types'
import type { Customer } from './types'

interface Props {
  form: Partial<Customer>
  setForm: Dispatch<SetStateAction<Partial<Customer>>>
  isNew: boolean
  saving: boolean
  error: string
  nameError: boolean
  /** True once Save has been tapped, so every problem is shown, not just the ones already left. */
  tried: boolean
  /** People already in the book who look like this one. */
  duplicates: DuplicateHit<Customer>[]
  onOpenExisting: (id: string) => void
  onSave: () => void
  onCancel: () => void
  onDelete?: () => void
}

/** Add and edit a customer. Same fields and rules as before, laid out for a phone. */
export default function CustomerForm({ form, setForm, isNew, saving, error, nameError, tried, duplicates, onOpenExisting, onSave, onCancel, onDelete }: Props) {
  const [vinBusy, setVinBusy] = useState(false)
  const [vinMessage, setVinMessage] = useState('')
  const [left, setLeft] = useState<{ phone?: boolean; email?: boolean }>({})
  const problems = contactProblems(form.phone, form.email)
  const phoneProblem = (left.phone || tried) ? problems.phone : undefined
  const emailProblem = (left.email || tried) ? problems.email : undefined

  const set = (key: keyof Customer, value: string) => setForm(f => ({ ...f, [key]: value }))

  const decodeVin = async () => {
    const vin = text(form.vehicle_vin).trim().toUpperCase()
    if (vin.length < 11) { setVinMessage(`A VIN has 17 characters and this one has ${vin.length}. Type the full VIN, then tap Fill in from VIN.`); return }
    setVinBusy(true)
    setVinMessage('')
    try {
      const res = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/DecodeVinValues/${encodeURIComponent(vin)}?format=json`, { signal: AbortSignal.timeout(15000) })
      const data = await res.json()
      const row = data?.Results?.[0] || {}
      const year = row.ModelYear || ''
      const make = row.Make ? String(row.Make).charAt(0) + String(row.Make).slice(1).toLowerCase() : ''
      const model = row.Model || ''
      if (!year && !make && !model) setVinMessage('That VIN did not decode. Check it and try again.')
      else setForm(f => ({ ...f, vehicle_year: year || f.vehicle_year, vehicle_make: make || f.vehicle_make, vehicle_model: model || f.vehicle_model }))
    } catch {
      setVinMessage('The VIN lookup did not finish. Try again in a moment.')
    } finally { setVinBusy(false) }
  }

  return (
    <form className="space-y-6" onSubmit={e => { e.preventDefault(); onSave() }} noValidate>
      <section aria-labelledby="cf-contact" className="space-y-4">
        <h3 id="cf-contact" className="section-title">Contact</h3>
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="form-label !text-[0.875rem]" htmlFor="cf-name">Name <span className="text-red" aria-hidden="true">*</span></label>
            <input
              id="cf-name" className="form-input" autoFocus={isNew} autoComplete="off" required aria-required="true"
              aria-invalid={nameError || undefined} aria-describedby={nameError ? 'cf-name-err' : undefined}
              value={text(form.name)} onChange={e => set('name', toTitleCase(e.target.value))} placeholder="Full name"
            />
            {nameError && <p id="cf-name-err" className="form-error !text-[0.875rem]">Enter the customer&apos;s name.</p>}
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="form-label !text-[0.875rem]" htmlFor="cf-phone">Phone</label>
            <input
              id="cf-phone" className="form-input" type="tel" inputMode="tel" autoComplete="off" value={text(form.phone)}
              aria-invalid={phoneProblem ? true : undefined} aria-describedby={phoneProblem ? 'cf-phone-err' : undefined}
              onChange={e => set('phone', e.target.value)} onBlur={() => setLeft(l => ({ ...l, phone: true }))} placeholder="(555) 000-0000"
            />
            {phoneProblem && <p id="cf-phone-err" className="form-error !text-[0.875rem]">{phoneProblem}</p>}
          </div>
          <div className="col-span-2 sm:col-span-1">
            <label className="form-label !text-[0.875rem]" htmlFor="cf-email">Email</label>
            <input
              id="cf-email" className="form-input" type="email" inputMode="email" autoComplete="off" autoCapitalize="none" value={text(form.email)}
              aria-invalid={emailProblem ? true : undefined} aria-describedby={emailProblem ? 'cf-email-err' : undefined}
              onChange={e => set('email', e.target.value)} onBlur={() => setLeft(l => ({ ...l, email: true }))} placeholder="name@example.com"
            />
            {emailProblem && <p id="cf-email-err" className="form-error !text-[0.875rem]">{emailProblem}</p>}
          </div>
          <div className="col-span-2 empty:hidden">
          {duplicates.length > 0 && (
            <Notice kind="warn">
              <p className="font-bold">{duplicates[0].why === 'name' ? 'Someone with this name is already in your book.' : `Already in your book with this ${duplicates[0].why === 'phone' ? 'phone number' : 'email'}.`}</p>
              <ul className="mt-1.5 space-y-1">
                {duplicates.slice(0, 3).map(h => (
                  <li key={h.customer.id} className="flex flex-wrap items-center gap-x-3">
                    <span className="min-w-0 break-words">{h.customer.name || 'Unnamed customer'}{h.customer.phone ? `, ${h.customer.phone}` : ''}</span>
                    <button type="button" className="inline-flex min-h-[44px] items-center font-bold text-blue underline underline-offset-2" onClick={() => onOpenExisting(h.customer.id)}>Open them instead</button>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-text-secondary">You can still save this one if it is a different person.</p>
            </Notice>
          )}
          </div>
          <div>
            <label className="form-label !text-[0.875rem]" htmlFor="cf-pref">Preferred contact</label>
            <select id="cf-pref" className="form-select" value={text(form.preferred_contact) || 'Call'} onChange={e => set('preferred_contact', e.target.value)}>
              {['Call', 'Text', 'Email'].map(v => <option key={v} value={v}>{v}</option>)}
            </select>
          </div>
          <div>
            <label className="form-label !text-[0.875rem]" htmlFor="cf-sent">How the customer feels</label>
            <select id="cf-sent" className="form-select" value={text(form.sentiment) || 'neutral'} onChange={e => set('sentiment', e.target.value)}>
              {SENTIMENTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="form-label !text-[0.875rem]" htmlFor="cf-address">Address</label>
            <input id="cf-address" className="form-input" autoComplete="off" value={text(form.address)} onChange={e => set('address', e.target.value)} />
          </div>
        </div>
      </section>

      <section aria-labelledby="cf-vehicle" className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 id="cf-vehicle" className="section-title">Vehicle</h3>
          <button type="button" className="btn btn-secondary" disabled={vinBusy || !text(form.vehicle_vin).trim()} onClick={decodeVin}>
            {vinBusy ? 'Looking up…' : 'Fill in from VIN'}
          </button>
        </div>
        {vinMessage && <p role="status" className="form-error !text-[0.875rem]">{vinMessage}</p>}
        <div className="grid grid-cols-3 gap-3 sm:gap-4">
          <div>
            <label className="form-label !text-[0.875rem]" htmlFor="cf-year">Year</label>
            <input id="cf-year" className="form-input" inputMode="numeric" autoComplete="off" value={text(form.vehicle_year)} onChange={e => set('vehicle_year', e.target.value)} placeholder="2018" />
          </div>
          <div>
            <label className="form-label !text-[0.875rem]" htmlFor="cf-make">Make</label>
            <input id="cf-make" className="form-input" autoComplete="off" value={text(form.vehicle_make)} onChange={e => set('vehicle_make', e.target.value)} placeholder="Toyota" />
          </div>
          <div>
            <label className="form-label !text-[0.875rem]" htmlFor="cf-model">Model</label>
            <input id="cf-model" className="form-input" autoComplete="off" value={text(form.vehicle_model)} onChange={e => set('vehicle_model', e.target.value)} placeholder="Camry" />
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
          <div>
            <label className="form-label !text-[0.875rem]" htmlFor="cf-vin">VIN</label>
            <input id="cf-vin" className="form-input num" autoComplete="off" autoCapitalize="characters" maxLength={17} value={text(form.vehicle_vin)} onChange={e => set('vehicle_vin', e.target.value.toUpperCase())} />
          </div>
          <div>
            <label className="form-label !text-[0.875rem]" htmlFor="cf-plate">License plate</label>
            <input id="cf-plate" className="form-input" autoComplete="off" autoCapitalize="characters" value={text(form.vehicle_plate)} onChange={e => set('vehicle_plate', e.target.value.toUpperCase())} />
          </div>
          <div>
            <label className="form-label !text-[0.875rem]" htmlFor="cf-miles">Mileage</label>
            <input id="cf-miles" className="form-input" inputMode="numeric" autoComplete="off" value={text(form.vehicle_mileage)} onChange={e => set('vehicle_mileage', e.target.value)} />
          </div>
        </div>
      </section>

      <section aria-labelledby="cf-notes" className="space-y-2">
        <h3 id="cf-notes" className="section-title">Notes</h3>
        <label className="sr-only" htmlFor="cf-notes-box">Notes about this customer</label>
        <textarea id="cf-notes-box" className="form-textarea" rows={3} value={text(form.notes)} onChange={e => set('notes', e.target.value)} placeholder="Anything the next person who talks to them should know" />
      </section>

      {error && <FormError>{error}</FormError>}

      <FormActions>
        <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : isNew ? 'Add customer' : 'Save changes'}</button>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        {onDelete && (
          <button type="button" className="btn btn-danger ml-auto" onClick={onDelete} disabled={saving}>
            <Icon name="trash" className="h-5 w-5" />Delete customer
          </button>
        )}
      </FormActions>
    </form>
  )
}
