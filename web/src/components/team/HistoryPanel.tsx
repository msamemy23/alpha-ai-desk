'use client'
import { useCallback, useEffect, useState } from 'react'
import Icon from '@/components/Icon'
import { ErrorCard } from '@/components/ListKit'
import { dayLabel, dayKey, fmtTimeOfDay } from '@/lib/timeclock'

interface Change {
  id: number
  entry_id: number
  action: string
  before_row: Record<string, unknown> | null
  after_row: Record<string, unknown> | null
  reason: string | null
  changed_at: string
  restorable: boolean
}

const WORDS: Record<string, string> = { add: 'Added by hand', edit: 'Changed', delete: 'Removed', undo_clock_out: 'Clock-out taken back', restore: 'Put back' }

const span = (r: Record<string, unknown> | null): string => {
  if (!r || !r.clock_in) return ''
  const out = r.clock_out ? fmtTimeOfDay(String(r.clock_out)) : 'still in'
  return `${dayLabel(dayKey(new Date(String(r.clock_in))))}, ${fmtTimeOfDay(String(r.clock_in))} to ${out}`
}

/** Every change made to one person's punches: what it was, what it became, why, and when. A removed punch can be put back. */
export default function HistoryPanel({ staffId, name, onRestore, onBack }: {
  staffId: number
  name: string
  /** Resolves to an error message, or '' when it worked. */
  onRestore: (changeId: number) => Promise<string>
  onBack: () => void
}) {
  const [rows, setRows] = useState<Change[] | null>(null)
  const [available, setAvailable] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [problem, setProblem] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await fetch(`/api/timeclock/changes?staff_id=${staffId}`, { cache: 'no-store' })
      const d = await res.json().catch(() => ({}))
      if (!res.ok || d.ok === false) throw new Error(d.error || 'The history did not load.')
      setAvailable(d.available !== false)
      setRows((d.changes || []) as Change[])
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : 'The history did not load. Check your connection and try again.')
    }
  }, [staffId])

  useEffect(() => { void load() }, [load])

  const restore = async (c: Change) => {
    setBusyId(c.id); setProblem('')
    const err = await onRestore(c.id)
    setBusyId(null)
    if (err) setProblem(err); else await load()
  }

  return (
    <div className="space-y-3">
      <button type="button" className="btn btn-ghost btn-sm -ml-2" onClick={onBack}><Icon name="chevronLeft" className="h-4 w-4" />Back to {name}</button>
      <h3 className="section-title">Change history for {name}</h3>
      {error ? <ErrorCard title="The history did not load" message={error} onRetry={() => void load()} />
        : rows === null ? <div className="space-y-2" aria-busy="true" aria-label="Loading history">{[0, 1, 2].map(i => <div key={i} className="skeleton h-16" />)}</div>
        : !available ? <p className="text-[0.9375rem] text-text-secondary">Keeping a history of changes needs a database update. Ask whoever set up the app to apply it. Changes made until then are not recorded here.</p>
        : rows.length === 0 ? <div className="empty-state"><p className="font-bold text-text-primary">No changes yet</p><p className="mt-1">Fixes, added punches and removals show here with the reason.</p></div>
        : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {rows.map(c => (
              <li key={c.id} className="space-y-0.5 px-3 py-2.5">
                <p className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <strong>{WORDS[c.action] || c.action}</strong>
                  <span className="num text-[0.8125rem] text-text-secondary">{new Date(c.changed_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                </p>
                {c.action === 'edit' && c.before_row && c.after_row && (
                  <p className="num text-[0.9375rem]"><span className="text-text-secondary">Was </span>{span(c.before_row)}<br /><span className="text-text-secondary">Now </span>{span(c.after_row)}</p>
                )}
                {c.action !== 'edit' && <p className="num text-[0.9375rem]">{span(c.after_row || c.before_row)}</p>}
                {c.reason && <p className="text-[0.875rem] text-text-secondary">Reason: {c.reason}</p>}
                {c.restorable && (
                  <button type="button" className="btn btn-secondary btn-sm mt-1" disabled={busyId === c.id} onClick={() => void restore(c)}>
                    <Icon name="undo" className="h-4 w-4" />{busyId === c.id ? 'Putting back…' : 'Put this back'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      {problem && <p role="alert" className="form-error">{problem}</p>}
    </div>
  )
}
