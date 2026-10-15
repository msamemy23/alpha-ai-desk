'use client'
import { useCallback, useEffect, useState } from 'react'
import Icon from '@/components/Icon'
import Sheet from '@/components/Sheet'
import { fillTemplate } from '@/lib/voice/templates'
import { api } from './api'
import { stamp } from './utils'
import type { Assignment, Teammate, Template, ThreadAi } from './useAiOverlay'

/* ---------- the assistant's state on one conversation ---------- */

/** One line under the header: waiting for a person, paused, or answering. Nothing is shown when the assistant is off or not set up. */
export function AssistantBar({ ai, onAct }: { ai: ThreadAi; onAct: (action: 'pause' | 'resume' | 'resolve') => Promise<string> }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!ai.loaded || ai.unavailable) return null
  const run = async (action: 'pause' | 'resume' | 'resolve') => {
    setBusy(true); setError('')
    const problem = await onAct(action)
    setBusy(false)
    if (problem) setError(problem)
  }
  if (ai.needsPerson) {
    return (
      <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-red/40 bg-red/[0.08] px-4 py-3">
        <span className="lamp lamp-red" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-[0.9375rem]">
          <span className="font-bold text-red">Needs a person.</span>{' '}
          <span className="text-text-primary">{ai.needsReason ? `${ai.needsReason}. ` : ''}The assistant has stopped replying here until you mark this handled.</span>
        </p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => run('resolve')} disabled={busy}>Mark handled</button>
        {error && <p role="alert" className="w-full text-[0.875rem] font-bold text-red">{error}</p>}
      </div>
    )
  }
  if (ai.paused) {
    return (
      <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-amber/40 bg-amber/[0.08] px-4 py-3">
        <span className="lamp lamp-amber" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-[0.9375rem]">
          <span className="font-bold">Assistant paused here</span>
          {ai.pausedUntil ? <span className="text-text-secondary"> until {stamp(ai.pausedUntil)}</span> : null}
          <span className="text-text-secondary">. You are handling this one.</span>
        </p>
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => run('resume')} disabled={busy}>Let the assistant answer again</button>
        {error && <p role="alert" className="w-full text-[0.875rem] font-bold text-red">{error}</p>}
      </div>
    )
  }
  if (ai.textsMode === 'off') return null
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-bg-card px-4 py-2">
      <span className={`lamp ${ai.textsMode === 'auto' ? 'lamp-green' : 'lamp-blue'}`} aria-hidden="true" />
      <p className="min-w-0 flex-1 text-[0.875rem] text-text-secondary">
        {ai.textsMode === 'auto' ? 'The assistant answers new texts here. When you reply, it steps back.' : 'The assistant writes replies here and waits for your OK.'}
      </p>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => run('pause')} disabled={busy}>Pause assistant</button>
      {error && <p role="alert" className="w-full text-[0.875rem] font-bold text-red">{error}</p>}
    </div>
  )
}

/* ---------- a reply the assistant wrote and is holding for approval ---------- */

export function DraftCard({ text, at, busy, onSend, onEdit, onDismiss }: {
  text: string; at: string; busy: boolean; onSend: () => void; onEdit: () => void; onDismiss: () => void
}) {
  return (
    <section aria-label="Reply waiting for your OK" className="mx-3 mb-3 rounded-lg border border-blue/40 bg-blue/[0.06] p-3 sm:mx-5">
      <p className="flex items-center gap-2 text-[0.875rem] font-bold text-blue">
        <Icon name="sparkle" className="h-4 w-4" />Assistant reply waiting for your OK
        <span className="font-normal text-text-secondary">{stamp(at)}</span>
      </p>
      <p className="mt-2 whitespace-pre-wrap break-words text-[1rem] leading-snug">{text}</p>
      <p className="mt-1 text-[0.8125rem] text-text-secondary">Nothing has been sent. This goes out as a normal text from your shop number.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn btn-primary btn-sm" onClick={onSend} disabled={busy}>{busy ? 'Sending...' : 'Send this reply'}</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={onEdit} disabled={busy}>Change it first</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onDismiss} disabled={busy}>Do not send</button>
      </div>
    </section>
  )
}

/* ---------- saved replies ---------- */

export function useTemplates() {
  const [items, setItems] = useState<Template[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'unavailable'>('loading')
  const load = useCallback(async () => {
    const r = await api<{ items: Template[]; unavailable: boolean; failed: boolean }>('/api/inbox/templates')
    if (!r.ok || !r.data) { setStatus('error'); return }
    if (r.data.unavailable) { setItems([]); setStatus('unavailable'); return }
    if (r.data.failed) { setStatus('error'); return }
    setItems(r.data.items || [])
    setStatus('ready')
  }, [])
  useEffect(() => { void load() }, [load])
  return { items, status, reload: load }
}

type Fill = { name?: string; shop?: string; phone?: string }

/** Pick a saved reply (it fills the text box, nothing is sent), or add, change and remove them. */
export function TemplatesSheet({ open, onClose, templates, status, reload, fill, onPick, canEdit }: {
  open: boolean; onClose: () => void; templates: Template[]; status: 'loading' | 'ready' | 'error' | 'unavailable'
  reload: () => Promise<void>; fill: Fill; onPick: (text: string) => void; canEdit: boolean
}) {
  const [managing, setManaging] = useState(false)
  const [editing, setEditing] = useState<{ id: string | null; title: string; body: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { if (!open) { setManaging(false); setEditing(null); setError('') } }, [open])

  const save = async () => {
    if (!editing) return
    setBusy(true); setError('')
    const r = editing.id
      ? await api('/api/inbox/templates', { method: 'PUT', body: { id: editing.id, title: editing.title, body: editing.body } })
      : await api('/api/inbox/templates', { method: 'POST', body: { title: editing.title, body: editing.body } })
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    setEditing(null)
    await reload()
  }
  const remove = async (id: string) => {
    setBusy(true); setError('')
    const r = await api(`/api/inbox/templates?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    setEditing(null)
    await reload()
  }
  const starter = async () => {
    setBusy(true); setError('')
    const r = await api('/api/inbox/templates', { body: { starter: true } })
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    await reload()
  }

  return (
    <Sheet open={open} onClose={onClose} title={editing ? (editing.id ? 'Change saved reply' : 'New saved reply') : managing ? 'Saved replies' : 'Pick a saved reply'} dirty={!!editing && !!(editing.title || editing.body)}>
      {status === 'loading' && <div className="space-y-2" role="status" aria-busy="true" aria-label="Loading saved replies">{[0, 1, 2].map(i => <div key={i} className="skeleton h-[3.5rem]" />)}</div>}
      {status === 'error' && (
        <div role="alert" className="rounded-lg border border-red/40 bg-red/[0.08] p-4">
          <p className="font-bold text-red">Saved replies did not load</p>
          <button type="button" className="btn btn-secondary mt-3" onClick={() => void reload()}>Try again</button>
        </div>
      )}
      {status === 'unavailable' && (
        <p className="rounded-lg border border-dashed border-border p-4 text-text-secondary">Saved replies are not turned on for this shop yet. They need a one-time database update, which your admin can apply.</p>
      )}

      {status === 'ready' && editing && (
        <form className="space-y-4" onSubmit={e => { e.preventDefault(); void save() }}>
          <label className="block">
            <span className="form-label">Name</span>
            <input className="form-input" value={editing.title} maxLength={60} onChange={e => setEditing({ ...editing, title: e.target.value })} placeholder="Vehicle is ready" />
          </label>
          <label className="block">
            <span className="form-label">What the text says</span>
            <textarea className="form-textarea" rows={5} value={editing.body} maxLength={1000} onChange={e => setEditing({ ...editing, body: e.target.value })} placeholder="Hi {name}, your vehicle is ready at {shop}." />
            <span className="form-hint">{'{name}'} becomes the customer&rsquo;s first name, {'{shop}'} your shop name, {'{phone}'} your shop number.</span>
          </label>
          {error && <p role="alert" className="font-bold text-red">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving...' : 'Save reply'}</button>
            <button type="button" className="btn btn-secondary" onClick={() => { setEditing(null); setError('') }} disabled={busy}>Cancel</button>
            {editing.id && <button type="button" className="btn btn-ghost ml-auto text-red" onClick={() => void remove(editing.id as string)} disabled={busy}>Delete</button>}
          </div>
        </form>
      )}

      {status === 'ready' && !editing && (
        <div className="space-y-3">
          {templates.length === 0 ? (
            <div className="empty-state">
              <p className="font-bold text-text-primary">No saved replies yet</p>
              <p className="mx-auto mt-1 max-w-md">Save the texts you send again and again, like &ldquo;your vehicle is ready&rdquo;, and add them with one tap.</p>
              {canEdit && (
                <div className="mt-4 flex flex-wrap justify-center gap-2">
                  <button type="button" className="btn btn-primary" onClick={() => void starter()} disabled={busy}>Add starter replies</button>
                  <button type="button" className="btn btn-secondary" onClick={() => setEditing({ id: null, title: '', body: '' })}>Write my own</button>
                </div>
              )}
            </div>
          ) : (
            <ul className="ledger">
              {templates.map(t => (
                <li key={t.id}>
                  <div className="flex items-start">
                    <button
                      type="button"
                      className="ledger-row min-w-0 flex-1 text-left"
                      onClick={() => managing ? setEditing({ id: t.id, title: t.title, body: t.body }) : onPick(fillTemplate(t.body, fill))}
                      aria-label={managing ? `Change ${t.title}` : `Use ${t.title}`}
                    >
                      <span className="ledger-main">
                        <span className="ledger-title">{t.title}</span>
                        <span className="ledger-sub line-clamp-2">{managing ? t.body : fillTemplate(t.body, fill)}</span>
                      </span>
                    </button>
                    {managing && <Icon name="edit" className="mr-3 mt-4 h-5 w-5 shrink-0 text-text-secondary" />}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {error && <p role="alert" className="font-bold text-red">{error}</p>}
          {canEdit && templates.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {managing
                ? <>
                    <button type="button" className="btn btn-secondary" onClick={() => setEditing({ id: null, title: '', body: '' })}><Icon name="plus" className="h-5 w-5" />New reply</button>
                    <button type="button" className="btn btn-ghost" onClick={() => setManaging(false)}>Done</button>
                  </>
                : <button type="button" className="btn btn-ghost" onClick={() => setManaging(true)}>Add or change replies</button>}
            </div>
          )}
        </div>
      )}
    </Sheet>
  )
}

/* ---------- who is handling this conversation ---------- */

export function AssignSheet({ open, onClose, team, current, available, onAssign }: {
  open: boolean; onClose: () => void; team: Teammate[]; current: Assignment | undefined; available: boolean
  onAssign: (assigneeId: string) => Promise<string>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (!open) setError('') }, [open])
  const pick = async (id: string) => {
    setBusy(true); setError('')
    const problem = await onAssign(id)
    setBusy(false)
    if (problem) setError(problem); else onClose()
  }
  return (
    <Sheet open={open} onClose={onClose} title="Who is handling this?">
      {!available ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-text-secondary">Giving a conversation to someone needs a one-time database update, which your admin can apply.</p>
      ) : team.length === 0 ? (
        <div className="empty-state">
          <p className="font-bold text-text-primary">No team members yet</p>
          <p className="mx-auto mt-1 max-w-md">Add your team under Staff, then you can hand conversations to them.</p>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-[0.9375rem] text-text-secondary">The name shows next to the conversation so the team knows who has it. It does not hide the conversation from anyone.</p>
          <ul className="ledger">
            {team.map(p => {
              const on = current?.assignee_id === p.id
              return (
                <li key={p.id}>
                  <button type="button" className="ledger-row w-full text-left" onClick={() => void pick(p.id)} disabled={busy} aria-pressed={on}>
                    <span className="ledger-main">
                      <span className="ledger-title">{p.name}</span>
                      {p.role && <span className="ledger-sub">{p.role}</span>}
                    </span>
                    {on && <span className="flex items-center gap-1.5 text-[0.9375rem] font-bold text-blue"><Icon name="check" className="h-5 w-5" />Has it now</span>}
                  </button>
                </li>
              )
            })}
          </ul>
          {error && <p role="alert" className="font-bold text-red">{error}</p>}
          {current && <button type="button" className="btn btn-secondary" onClick={() => void pick('')} disabled={busy}>Take the name off</button>}
        </div>
      )}
    </Sheet>
  )
}
