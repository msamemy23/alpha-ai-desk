'use client'
import { useState } from 'react'
import Notice from '@/components/Notice'
import type { BoardSettings } from '@/lib/jobflow'
import { wallSeconds } from '@/lib/shopboard'

const REFRESH = [
  { secs: 15, label: 'Every 15 seconds' },
  { secs: 30, label: 'Every 30 seconds' },
  { secs: 60, label: 'Every minute' },
  { secs: 120, label: 'Every 2 minutes' },
  { secs: 300, label: 'Every 5 minutes' },
]

/** The two choices for the shop wall screen. Held until Save, so the TV never changes half way through an edit. */
export default function WallSettings({ board, canChange, migrated, save, onSaved, onClose }: {
  board: BoardSettings
  canChange: boolean
  migrated: boolean
  save: (next: BoardSettings) => Promise<{ ok: boolean; error?: string }>
  onSaved: () => void
  onClose: () => void
}) {
  const [names, setNames] = useState(board.tvNames)
  // A saved value that is not one of the choices is kept as its own choice, so opening this sheet never changes it.
  const secs = wallSeconds(board.tvSeconds)
  const [every, setEvery] = useState(secs)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const dirty = names !== board.tvNames || every !== secs
  const options = REFRESH.some(r => r.secs === secs) ? REFRESH : [...REFRESH, { secs, label: `Every ${secs} seconds` }].sort((a, b) => a.secs - b.secs)

  const submit = async () => {
    setProblem(''); setBusy(true)
    const r = await save({ ...board, tvNames: names, tvSeconds: every })
    setBusy(false)
    if (!r.ok) { setProblem(r.error || 'That did not save. Try again.'); return }
    onSaved()
  }

  return (
    <div>
      <p className="mb-3 text-text-secondary">The shop wall is a full-screen, look-only view of every open car, made for a TV in the shop. Nothing on it can be changed.</p>
      {!migrated && <Notice kind="warn" className="mb-3">These choices need a database update before they can be saved. The wall still opens with the standard settings: no customer names, refreshed every 30 seconds.</Notice>}
      {migrated && !canChange && <Notice kind="info" className="mb-3">Only owners, admins and managers can change these choices.</Notice>}

      <fieldset disabled={!canChange || !migrated} className="min-w-0 border-0 p-0">
        <label className="flex min-h-[48px] items-start gap-3 rounded-md border border-border px-3 py-2.5">
          <input type="checkbox" className="mt-0.5 h-5 w-5" checked={names} onChange={e => setNames(e.target.checked)} />
          <span className="min-w-0">
            <span className="block font-bold">Show customers&apos; first names</span>
            <span className="mt-0.5 block text-[0.875rem] text-text-secondary">Off by default. Anyone who can see the screen can read it, so it shows the car and the repair number only. When this is on, it shows the first name and never the last.</span>
          </span>
        </label>
        <div className="mt-4">
          <label className="form-label" htmlFor="wall-every">Update the wall</label>
          <select id="wall-every" className="form-select" value={every} onChange={e => setEvery(Number(e.target.value))}>
            {options.map(o => <option key={o.secs} value={o.secs}>{o.label}</option>)}
          </select>
        </div>
      </fieldset>

      {problem && <p role="alert" className="form-error">{problem}</p>}
      <div className="sticky bottom-0 -mx-4 mt-5 grid grid-cols-2 gap-2 border-t border-border bg-bg-card px-4 py-3 sm:-mx-6 sm:px-6">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>{dirty ? 'Discard' : 'Close'}</button>
        <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy || !dirty || !canChange || !migrated}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  )
}
