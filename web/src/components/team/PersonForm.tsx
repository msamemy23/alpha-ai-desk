'use client'
import { useState } from 'react'
import Icon from '@/components/Icon'
import { ROLES, normalizeRole } from '@/lib/timeclock'
import type { Person } from '@/lib/timeclock'

/** Add someone to the team, or change their name or role. Taking them off the team is a separate, confirmed step. */
export default function PersonForm({ person, busy, error, onSave, onRemove, onRestore, onCancel }: {
  /** Null when adding. */
  person: Person | null
  busy: boolean
  error: string
  onSave: (v: { name: string; role: string }) => void
  onRemove?: () => void
  onRestore?: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState(person?.name || '')
  const [role, setRole] = useState(person ? normalizeRole(person.role) || 'employee' : 'technician')
  const [shown, setShown] = useState('')
  const [confirming, setConfirming] = useState(false)

  const submit = () => {
    if (!name.trim()) { setShown('Enter a name.'); return }
    setShown('')
    onSave({ name: name.trim(), role })
  }

  if (confirming && person && onRemove) {
    return (
      <div className="space-y-4">
        <p className="text-[0.9375rem]">
          Take {person.name} off the team? Their past hours stay on the timesheets, and cars already assigned to them keep their name.
          They stop showing up to clock in and in the technician lists.
        </p>
        {error && <p role="alert" className="form-error">{error}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)} disabled={busy}>Keep on team</button>
          <button type="button" className="btn btn-danger" onClick={onRemove} disabled={busy}>{busy ? 'Removing…' : 'Take off team'}</button>
        </div>
      </div>
    )
  }

  return (
    <form onSubmit={e => { e.preventDefault(); submit() }} className="space-y-4" noValidate>
      {person && (
        <button type="button" className="btn btn-ghost btn-sm -ml-2" onClick={onCancel}>
          <Icon name="chevronLeft" className="h-4 w-4" />Back to {person.name}
        </button>
      )}
      <div>
        <label htmlFor="pf-name" className="form-label">Name</label>
        <input id="pf-name" className="form-input" autoComplete="off" maxLength={60} value={name} onChange={e => { setName(e.target.value); setShown('') }} placeholder="First and last name" />
        <p className="mt-1 text-[0.8125rem] text-text-secondary">This is the name shown on jobs, appointments and timesheets.</p>
      </div>
      <div>
        <label htmlFor="pf-role" className="form-label">Role</label>
        <select id="pf-role" className="form-select" value={role} onChange={e => setRole(e.target.value)}>
          {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <p className="mt-1 text-[0.8125rem] text-text-secondary">Technicians can be given jobs and appointments.</p>
      </div>
      {(shown || error) && <p role="alert" className="form-error">{shown || error}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        {person && person.active && onRemove && <button type="button" className="btn btn-ghost !text-red sm:mr-auto" onClick={() => setConfirming(true)} disabled={busy}>Take off team</button>}
        {person && !person.active && onRestore && <button type="button" className="btn btn-secondary sm:mr-auto" onClick={onRestore} disabled={busy}>Add back to team</button>}
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : person ? 'Save changes' : 'Add to team'}</button>
      </div>
    </form>
  )
}
