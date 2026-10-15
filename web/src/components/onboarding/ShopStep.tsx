'use client'
import type { FormEvent, RefObject } from 'react'
import Icon from '@/components/Icon'

export interface ShopFields { shopName: string; phone: string; address: string; cityStateZip: string }
export type ShopErrors = { name?: string; phone?: string }

export default function ShopStep({
  headingRef, nameRef, phoneRef, values, onChange, errors, loading, onNext,
}: {
  headingRef: RefObject<HTMLHeadingElement>
  nameRef: RefObject<HTMLInputElement>
  phoneRef: RefObject<HTMLInputElement>
  values: ShopFields
  onChange: (key: keyof ShopFields, value: string) => void
  errors: ShopErrors
  loading: boolean
  onNext: () => void
}) {
  const submit = (e: FormEvent) => { e.preventDefault(); if (!loading) onNext() }
  return (
    <section className="card" aria-labelledby="step-title">
      <h2 id="step-title" ref={headingRef} tabIndex={-1} className="section-title outline-none"><span className="sr-only">Step 1 of 3: </span>Tell us about your shop</h2>
      <p className="mt-1 text-[0.9375rem] text-text-secondary">Customers see this on estimates, invoices and texts.</p>

      <form onSubmit={submit} noValidate>
        {loading ? (
          <div className="mt-5 space-y-4" aria-busy="true" role="status" aria-label="Loading your shop details">
            {[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-[4.25rem]" />)}
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <div>
              <label htmlFor="ob-name" className="form-label">Shop name</label>
              <input
                ref={nameRef}
                id="ob-name"
                className={`form-input ${errors.name ? 'border-red' : ''}`}
                value={values.shopName}
                onChange={e => onChange('shopName', e.target.value)}
                placeholder="Main Street Auto Repair"
                autoComplete="organization"
                enterKeyHint="next"
                aria-invalid={errors.name ? true : undefined}
                aria-describedby={errors.name ? 'ob-name-error' : undefined}
              />
              {errors.name && <p id="ob-name-error" className="form-error">{errors.name}</p>}
            </div>
            <div>
              <label htmlFor="ob-phone" className="form-label">Shop phone number</label>
              <input
                ref={phoneRef}
                id="ob-phone"
                className={`form-input ${errors.phone ? 'border-red' : ''}`}
                type="tel"
                inputMode="tel"
                value={values.phone}
                onChange={e => onChange('phone', e.target.value)}
                placeholder="(555) 555-0100"
                autoComplete="tel"
                enterKeyHint="next"
                aria-invalid={errors.phone ? true : undefined}
                aria-describedby={errors.phone ? 'ob-phone-error ob-phone-hint' : 'ob-phone-hint'}
              />
              {errors.phone && <p id="ob-phone-error" className="form-error">{errors.phone}</p>}
              <p id="ob-phone-hint" className="form-hint !text-text-secondary">The number customers call. You can leave it blank for now.</p>
            </div>
            <div>
              <label htmlFor="ob-address" className="form-label">Street address</label>
              <input
                id="ob-address"
                className="form-input"
                value={values.address}
                onChange={e => onChange('address', e.target.value)}
                placeholder="123 Main St"
                autoComplete="address-line1"
                enterKeyHint="next"
              />
            </div>
            <div>
              <label htmlFor="ob-city" className="form-label">City, state and ZIP</label>
              <input
                id="ob-city"
                className="form-input"
                value={values.cityStateZip}
                onChange={e => onChange('cityStateZip', e.target.value)}
                placeholder="Your city, ST 12345"
                autoComplete="off"
                enterKeyHint="next"
              />
            </div>
          </div>
        )}

        <div className="mt-6 flex justify-end">
          <button type="submit" className="btn btn-primary btn-lg w-full sm:w-auto" disabled={loading}>
            Next: services
            <Icon name="arrowRight" className="h-5 w-5" />
          </button>
        </div>
      </form>
    </section>
  )
}
