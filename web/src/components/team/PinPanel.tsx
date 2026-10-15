'use client'
import { useState } from 'react'
import Icon from '@/components/Icon'
import { validatePin } from '@/lib/pin-shape'

/** Set, change or clear the PIN a person uses on the shop tablet. A PIN is never shown again after it is saved. */
export default function PinPanel({ name, hasPin, unavailable, busy, error, onSet, onClear, onBack }: {
  name: string
  hasPin: boolean | null
  unavailable: boolean
  busy: boolean
  error: string
  onSet: (pin: string) => void
  onClear: () => void
  onBack: () => void
}) {
  const [pin, setPin] = useState('')
  const [again, setAgain] = useState('')
  const [shown, setShown] = useState('')
  const [confirm, setConfirm] = useState(false)

  const submit = () => {
    const checked = validatePin(pin)
    if (!checked.ok) { setShown(checked.error); return }
    if (pin !== again) { setShown('The two PINs are not the same.'); return }
    setShown('')
    onSet(pin)
  }
  const message = shown || error

  return (
    <form onSubmit={e => { e.preventDefault(); submit() }} className="space-y-4" noValidate>
      <button type="button" className="btn btn-ghost btn-sm -ml-2" onClick={onBack}><Icon name="chevronLeft" className="h-4 w-4" />Back to {name}</button>
      <h3 className="section-title">Shop tablet PIN for {name}</h3>
      {unavailable ? (
        <p className="text-[0.9375rem] text-text-secondary">PINs need a database update. Ask whoever set up the app to apply it.</p>
      ) : (
        <>
          <p className="text-[0.9375rem]">
            {hasPin === null ? 'Could not check whether a PIN is set.' : hasPin ? `${name} has a PIN. Setting a new one replaces it.` : `${name} does not have a PIN yet.`}
            {' '}The PIN is used to clock in and out on the shop tablet. It is stored scrambled and cannot be read back, so if it is forgotten, set a new one.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor="pin-new" className="form-label">New PIN (4 to 8 digits)</label>
              <input id="pin-new" className="form-input num" type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={pin} onChange={e => { setPin(e.target.value.replace(/\D/g, '')); setShown('') }} />
            </div>
            <div>
              <label htmlFor="pin-again" className="form-label">Type it again</label>
              <input id="pin-again" className="form-input num" type="password" inputMode="numeric" autoComplete="new-password" maxLength={8} value={again} onChange={e => { setAgain(e.target.value.replace(/\D/g, '')); setShown('') }} />
            </div>
          </div>
          <p className="text-[0.8125rem] text-text-secondary">Avoid 1234, 0000 and birthdays. After 5 wrong tries the PIN is locked for 5 minutes.</p>
          {message && <p role="alert" className="form-error">{message}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
            {hasPin && (confirm
              ? <button type="button" className="btn btn-danger sm:mr-auto" disabled={busy} onClick={() => { setConfirm(false); onClear() }}>Yes, remove the PIN</button>
              : <button type="button" className="btn btn-ghost !text-red sm:mr-auto" disabled={busy} onClick={() => setConfirm(true)}>Remove PIN</button>)}
            <button type="button" className="btn btn-secondary" onClick={onBack} disabled={busy}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}><Icon name="key" className="h-5 w-5" />{busy ? 'Saving…' : hasPin ? 'Replace PIN' : 'Save PIN'}</button>
          </div>
        </>
      )}
    </form>
  )
}
