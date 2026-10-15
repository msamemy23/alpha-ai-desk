'use client'
import { useState } from 'react'
import Icon from '@/components/Icon'
import { roleLabel } from '@/lib/timeclock'
import type { Person } from '@/lib/timeclock'
import { Avatar } from './parts'

/** Everyone on the team, and the people who used to be. Tap a person to change their name or role. */
export default function PeopleView({ people, pinIds, requirePin, onOpen, onAdd }: {
  people: Person[]
  /** Who has a tablet PIN. Null when the signed-in person cannot see that or it could not be checked. */
  pinIds: Set<number> | null
  requirePin: boolean
  onOpen: (p: Person) => void
  onAdd: () => void
}) {
  const [showFormer, setShowFormer] = useState(false)
  const current = people.filter(p => p.active).sort((a, b) => a.name.localeCompare(b.name))
  const former = people.filter(p => !p.active).sort((a, b) => a.name.localeCompare(b.name))

  const missingPins = pinIds && requirePin ? current.filter(p => !pinIds.has(p.id)).length : 0

  return (
    <div>
      <div className="mb-4 flex flex-col gap-2 rounded-md border border-border bg-bg-card px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="font-bold">Shop tablet</p>
          <p className="text-[0.9375rem] text-text-secondary">
            Keep one tablet at the shop. People tap their name and enter their PIN to clock in, take a break or move onto a repair order.
            {missingPins > 0 ? ` ${missingPins} ${missingPins === 1 ? 'person does' : 'people do'} not have a PIN yet, so they cannot use it.` : ''}
          </p>
        </div>
        <a href="/kiosk" className="btn btn-secondary w-full shrink-0 sm:w-auto"><Icon name="openExternal" className="h-5 w-5" />Open the tablet screen</a>
      </div>
      {current.length === 0 ? (
        <div className="empty-state">
          <Icon name="staff" className="mx-auto mb-3 h-8 w-8 text-text-muted" />
          <p className="font-bold text-text-primary">No one on your team yet</p>
          <p className="mx-auto mt-1 max-w-md">Add each technician and staff member once. Their name is then offered when you give out a job or book an appointment.</p>
          <button type="button" className="btn btn-primary mt-4" onClick={onAdd}><Icon name="plus" className="h-5 w-5" />Add the first person</button>
        </div>
      ) : (
        <ul className="ledger" aria-label="Team">
          {current.map(p => (
            <li key={p.id}>
              <button type="button" className="ledger-row" onClick={() => onOpen(p)}>
                <Avatar name={p.name} />
                <span className="ledger-main">
                  <span className="ledger-title block">{p.name}</span>
                  <span className="ledger-sub block">{roleLabel(p.role)}{pinIds ? (pinIds.has(p.id) ? ' · Tablet PIN set' : ' · No tablet PIN') : ''}</span>
                </span>
                <Icon name="chevronRight" className="h-5 w-5 shrink-0 text-text-muted" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {former.length > 0 && (
        <div className="mt-5">
          <button type="button" className="btn btn-ghost btn-sm -ml-2" aria-expanded={showFormer} onClick={() => setShowFormer(v => !v)}>
            <Icon name={showFormer ? 'chevronDown' : 'chevronRight'} className="h-4 w-4" />
            {showFormer ? 'Hide' : 'Show'} former team ({former.length})
          </button>
          {showFormer && (
            <ul className="ledger mt-2" aria-label="Former team">
              {former.map(p => (
                <li key={p.id}>
                  <button type="button" className="ledger-row opacity-80" onClick={() => onOpen(p)}>
                    <Avatar name={p.name} />
                    <span className="ledger-main">
                      <span className="ledger-title block">{p.name}</span>
                      <span className="ledger-sub block">{roleLabel(p.role)} · No longer on the team</span>
                    </span>
                    <Icon name="chevronRight" className="h-5 w-5 shrink-0 text-text-muted" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
