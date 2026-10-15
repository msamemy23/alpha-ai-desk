'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import { api } from '@/components/inbox/api'
import { REG_PATHS } from '@/lib/voice/registration'
import type { RegCopy, RegPath, RegState, RegStatus, RegView } from '@/lib/voice/registration'
import { Group } from './fields'
import { StatusLine } from './shared'

interface Payload {
  unavailable: boolean; failed: boolean; state: RegState; view: RegView; copy: RegCopy[]; webhook: string
  refFields: Array<{ id: string; label: string; paths: RegPath[] }>; canEdit: boolean
}

const LAMP: Record<RegStatus, 'green' | 'amber' | 'red' | 'blue' | 'off'> = { not_started: 'amber', in_progress: 'amber', submitted: 'blue', approved: 'green', rejected: 'red' }

/**
 * Getting the shop's texting number approved by the carriers. US carriers block business texts from numbers that are not
 * registered, and only the owner can do the registration (it is in the Telnyx account). This lists each step in plain words,
 * writes the answers to paste into the forms, and remembers how far along it is. It never stops the app from working.
 */
export default function RegistrationCard() {
  const [load, setLoad] = useState<{ status: 'loading' | 'error' | 'ready'; data?: Payload; error?: string }>({ status: 'loading' })
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState('')
  const [copied, setCopied] = useState('')
  const [openCopy, setOpenCopy] = useState<string | null>(null)
  const [notes, setNotes] = useState('')
  const [refs, setRefs] = useState<Record<string, string>>({})
  const sync = useRef(false)

  const read = useCallback(async () => {
    const r = await api<Payload>('/api/receptionist/registration')
    if (!r.ok || !r.data) { setLoad({ status: 'error', error: r.error }); return }
    setLoad({ status: 'ready', data: r.data })
    if (!sync.current) { sync.current = true; setNotes(r.data.state.notes || ''); setRefs(r.data.state.refs || {}) }
  }, [])
  useEffect(() => { void read() }, [read])

  const save = async (change: Record<string, unknown>) => {
    setSaving('saving'); setSaveError('')
    const r = await api('/api/receptionist/registration', { method: 'PUT', body: change })
    if (!r.ok) { setSaving('error'); setSaveError(r.error); return }
    setSaving('saved')
    await read()
  }

  const copy = async (id: string, text: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(id); setTimeout(() => setCopied(c => (c === id ? '' : c)), 2000) } catch { setOpenCopy(id) }
  }

  if (load.status === 'loading') return <div className="panel space-y-3 p-4 sm:p-5" role="status" aria-busy="true" aria-label="Loading the texting approval checklist"><div className="skeleton h-6 w-56" /><div className="skeleton h-20" /><div className="skeleton h-40" /></div>
  if (load.status === 'error' || !load.data) {
    return (
      <Group title="Texting approval">
        <div role="alert" className="rounded-lg border border-red/40 bg-red/[0.08] p-4">
          <p className="font-bold text-red">The checklist did not load</p>
          <p className="mt-1 text-text-secondary">{load.error || 'Check your connection and try again.'}</p>
          <button type="button" className="btn btn-secondary mt-3" onClick={() => { setLoad({ status: 'loading' }); void read() }}>Try again</button>
        </div>
      </Group>
    )
  }

  const { state, view, copy: blocks, canEdit, unavailable, refFields } = load.data
  const path = view.path
  const editable = canEdit && !unavailable
  const approved = state.status === 'approved'

  return (
    <Group
      title="Texting approval from the carriers"
      description="Phone carriers block business texts from numbers they have not approved. Until yours is approved, some texts to customers may not arrive. Nothing in the app stops working, and only you can do the registration, in your Telnyx account. This page lists each step and writes the answers to paste."
    >
      <div className="rounded-lg border border-border bg-bg-base p-4">
        <StatusLine lamp={LAMP[state.status === 'not_started' && view.doneCount > 0 ? 'in_progress' : state.status]}>{view.headline}</StatusLine>
        <p className="mt-1 text-[0.9375rem] text-text-secondary">{view.detail}</p>
        {view.totalCount > 0 && !approved && (
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-bg-chrome" role="progressbar" aria-label="Steps done" aria-valuemin={0} aria-valuemax={view.totalCount} aria-valuenow={view.doneCount}>
            <div className="h-full bg-blue" style={{ width: `${Math.round((view.doneCount / view.totalCount) * 100)}%` }} />
          </div>
        )}
      </div>

      {unavailable && <p className="rounded-lg border border-dashed border-border p-4 text-[0.9375rem] text-text-secondary">Saving your progress on this checklist needs a one-time database update, which your admin can apply. The steps and the wording below still work.</p>}

      <div>
        <label htmlFor="reg-path" className="form-label">What kind of number do you text from?</label>
        <select id="reg-path" className="form-select" value={state.path} disabled={!editable} onChange={e => void save({ path: e.target.value })}>
          <option value="unsure">{view.pathGuess ? `Not chosen, looks ${view.pathGuess === 'toll_free' ? 'toll-free' : 'local'}` : 'Not chosen yet'}</option>
          {REG_PATHS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
        <p className="form-hint !text-text-secondary">{REG_PATHS.find(p => p.value === path)?.hint || 'Pick one and the list below shows only the steps that apply.'}</p>
      </div>

      <ol className="ledger" aria-label="Registration steps">
        {view.steps.map(s => (
          <li key={s.id}>
            <div className="flex items-start gap-3 px-3 py-3">
              {s.automatic || s.wait ? (
                <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center" aria-hidden="true"><span className={`lamp ${s.done ? 'lamp-green' : 'lamp-amber'}`} /></span>
              ) : (
                <input
                  id={`reg-${s.id}`} type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--c-blue))]" checked={s.done} disabled={!editable}
                  onChange={e => void save({ items: { [s.id]: { done: e.target.checked } } })}
                />
              )}
              <div className="min-w-0 flex-1">
                <label htmlFor={s.automatic || s.wait ? undefined : `reg-${s.id}`} className="block font-bold">
                  {s.title}
                  {s.automatic && <span className="ml-2 text-[0.875rem] font-normal text-text-secondary">{s.done ? 'Done for you' : 'Not set up yet'}</span>}
                  {s.wait && <span className="ml-2 text-[0.875rem] font-normal text-text-secondary">{s.done ? 'Approved' : 'Carriers decide'}</span>}
                </label>
                <p className="text-[0.9375rem] text-text-secondary">{s.help}</p>
              </div>
            </div>
          </li>
        ))}
      </ol>

      {refFields.filter(f => path === 'unsure' || f.paths.includes(path)).length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {refFields.filter(f => path === 'unsure' || f.paths.includes(path)).map(f => (
            <div key={f.id}>
              <label htmlFor={`reg-ref-${f.id}`} className="form-label">{f.label} (from Telnyx)</label>
              <input
                id={`reg-ref-${f.id}`} className="form-input font-mono" value={refs[f.id] || ''} disabled={!editable} maxLength={80} autoComplete="off" spellCheck={false}
                onChange={e => setRefs({ ...refs, [f.id]: e.target.value })}
                onBlur={() => { if ((refs[f.id] || '') !== (state.refs[f.id] || '')) void save({ refs: { [f.id]: refs[f.id] || '' } }) }}
              />
            </div>
          ))}
        </div>
      )}

      <div>
        <label htmlFor="reg-notes" className="form-label">Your notes (optional)</label>
        <textarea id="reg-notes" className="form-textarea" rows={2} value={notes} disabled={!editable} maxLength={2000} onChange={e => setNotes(e.target.value)} onBlur={() => { if (notes !== (state.notes || '')) void save({ notes }) }} placeholder="For example: what Telnyx asked for, or who is handling it" />
      </div>

      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          {state.status !== 'submitted' && !approved && <button type="button" className="btn btn-secondary" onClick={() => void save({ status: 'submitted' })}>I sent it in</button>}
          {state.status === 'submitted' && <button type="button" className="btn btn-primary" onClick={() => void save({ status: 'approved' })}>Carriers approved it</button>}
          {state.status === 'submitted' && <button type="button" className="btn btn-secondary" onClick={() => void save({ status: 'rejected' })}>Carriers sent it back</button>}
          {(state.status === 'submitted' || state.status === 'rejected' || approved) && <button type="button" className="btn btn-ghost" onClick={() => void save({ status: 'in_progress' })}>Back to in progress</button>}
          <span className="text-[0.875rem] text-text-secondary" aria-live="polite">{saving === 'saving' ? 'Saving...' : saving === 'saved' ? 'Saved' : ''}</span>
        </div>
      )}
      {saveError && <p role="alert" className="font-bold text-red">{saveError}</p>}
      {!canEdit && <p className="text-[0.9375rem] text-text-secondary">Only an owner, admin or manager can change this checklist.</p>}

      <div className="space-y-2">
        <h4 className="text-[0.9375rem] font-bold">Words to paste into the forms</h4>
        <p className="text-[0.875rem] text-text-secondary">Written from your shop details. Read each one, change anything that is not true for your shop, then paste it where it says.</p>
        <ul className="space-y-2">
          {blocks.map(b => (
            <li key={b.id} className="rounded-lg border border-border bg-bg-card">
              <div className="flex items-center gap-2 p-3">
                <button type="button" className="min-h-[44px] min-w-0 flex-1 text-left" aria-expanded={openCopy === b.id} onClick={() => setOpenCopy(openCopy === b.id ? null : b.id)}>
                  <span className="block font-bold">{b.title}</span>
                  <span className="block text-[0.875rem] text-text-secondary">{b.where}</span>
                </button>
                <button type="button" className="btn btn-secondary btn-sm shrink-0" onClick={() => void copy(b.id, b.text)}>
                  <Icon name={copied === b.id ? 'check' : 'copy'} className="h-4 w-4" />{copied === b.id ? 'Copied' : 'Copy'}
                </button>
              </div>
              {openCopy === b.id && <pre className="mx-3 mb-3 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-bg-base p-3 font-sans text-[0.9375rem] leading-snug">{b.text}</pre>}
            </li>
          ))}
        </ul>
      </div>
    </Group>
  )
}
