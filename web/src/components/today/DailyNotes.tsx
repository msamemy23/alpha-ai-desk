'use client'
import { useCallback, useEffect, useState } from 'react'
import Icon from '@/components/Icon'

interface Note { id: string; note_date: string; content: string; created_at: string }

const SHOWN = 5
const MAX_LENGTH = 500

const when = (iso: string): string => {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return ''
  const today = new Date()
  const same = d.toDateString() === today.toDateString()
  const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  return same ? `Today, ${time}` : `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${time}`
}

async function call(method: 'GET' | 'POST' | 'DELETE', body?: Record<string, unknown>): Promise<{ ok: boolean; error?: string; notes?: Note[] }> {
  try {
    const res = await fetch('/api/daily-notes', { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.error) return { ok: false, error: res.status === 401 ? 'You were signed out. Refresh the page and sign in again.' : 'That did not work. Try again.' }
    return { ok: true, notes: Array.isArray(data.notes) ? data.notes : undefined }
  } catch {
    return { ok: false, error: 'No connection. Check your internet and try again.' }
  }
}

/** A few lines to remember for the shop: who to call back, a part to order. Newest first. */
export default function DailyNotes() {
  const [notes, setNotes] = useState<Note[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [all, setAll] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)

  const load = useCallback(async () => {
    const r = await call('GET')
    if (r.ok) { setNotes(r.notes || []); setError('') } else setError(r.error || '')
    setLoaded(true)
  }, [])
  useEffect(() => { void load() }, [load])

  const add = async () => {
    const content = text.trim()
    if (!content) return
    setBusy(true); setError('')
    const r = await call('POST', { content })
    if (!r.ok) { setError(r.error || ''); setBusy(false); return }
    setText('')
    await load()
    setBusy(false)
  }

  const remove = async (id: string) => {
    setRemoving(id); setError('')
    const r = await call('DELETE', { id })
    if (!r.ok) setError(r.error || '')
    else setNotes(n => n.filter(x => x.id !== id))
    setRemoving(null)
  }

  const shown = all ? notes : notes.slice(0, SHOWN)

  return (
    <section aria-labelledby="notes-h">
      <h2 id="notes-h" className="section-title mb-2">Notes</h2>
      <form className="flex gap-2" onSubmit={e => { e.preventDefault(); void add() }}>
        <label className="min-w-0 flex-1">
          <span className="sr-only">Add a note</span>
          <input className="form-input" value={text} maxLength={MAX_LENGTH} onChange={e => setText(e.target.value)} placeholder="Call Rita back about the AC" autoComplete="off" />
        </label>
        <button type="submit" className="btn btn-secondary shrink-0" disabled={busy || !text.trim()}><Icon name="plus" className="h-5 w-5" />Add</button>
      </form>
      {error && <p role="alert" className="form-error">{error}</p>}
      {!loaded ? (
        <div className="mt-3 space-y-2" aria-busy="true" aria-label="Loading notes"><div className="skeleton h-12" /><div className="skeleton h-12" /></div>
      ) : notes.length === 0 ? (
        <p className="mt-3 text-[0.9375rem] text-text-secondary">Nothing noted. Jot down what you need to remember today.</p>
      ) : (
        <>
          <ul className="ledger mt-3" aria-label="Notes">
            {shown.map(n => (
              <li key={n.id} className="flex items-start">
                <div className="ledger-row min-w-0 flex-1">
                  <span className="ledger-main">
                    <span className="ledger-title block !whitespace-normal break-words">{n.content}</span>
                    <span className="ledger-sub block">{when(n.created_at)}</span>
                  </span>
                </div>
                <button type="button" className="btn-icon mr-1 mt-1.5 shrink-0" disabled={removing === n.id} onClick={() => void remove(n.id)} aria-label={`Delete the note: ${n.content.slice(0, 40)}`}>
                  <Icon name="trash" className="h-5 w-5" />
                </button>
              </li>
            ))}
          </ul>
          {notes.length > SHOWN && (
            <button type="button" className="btn btn-ghost btn-sm mt-1" onClick={() => setAll(v => !v)}>{all ? 'Show fewer' : `Show all ${notes.length}`}</button>
          )}
        </>
      )}
    </section>
  )
}
