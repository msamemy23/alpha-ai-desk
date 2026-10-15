'use client'
import { useState } from 'react'
import Icon from '@/components/Icon'
import { roleLabel } from '@/lib/timeclock'
import type { Person } from '@/lib/timeclock'
import { Avatar } from './parts'

/** Everyone on the team, and the people who used to be. Tap a person to change their name or role. */
export default function PeopleView({ people, onOpen, onAdd }: {
  people: Person[]
  onOpen: (p: Person) => void
  onAdd: () => void
}) {
  const [showFormer, setShowFormer] = useState(false)
  const current = people.filter(p => p.active).sort((a, b) => a.name.localeCompare(b.name))
  const former = people.filter(p => !p.active).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div>
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
                  <span className="ledger-sub block">{roleLabel(p.role)}</span>
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
