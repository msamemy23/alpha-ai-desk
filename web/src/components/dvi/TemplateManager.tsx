'use client'
import { useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { MAX_NAME, MAX_TEMPLATE_BLURB, MAX_TEMPLATE_LABEL, MAX_TEMPLATE_SECTIONS, TEMPLATES, cleanTemplate, templateBlurb } from '@/lib/dvi'
import type { ShopTemplate, TemplateInput } from './useTemplates'

interface Group { title: string; text: string }

type Api = {
  list: ShopTemplate[]
  available: boolean
  loaded: boolean
  error: string
  reload: () => Promise<void>
  save: (t: TemplateInput) => Promise<{ ok: boolean; error?: string }>
  setArchived: (id: string, archived: boolean) => Promise<{ ok: boolean; error?: string }>
}

const toGroups = (sections: { title: string; items: string[] }[]): Group[] => sections.map(s => ({ title: s.title, text: s.items.join('\n') }))

/** The shop's own inspection checklists: make one, change one, remove one (removing hides it and can be undone), start from a built-in one. */
export default function TemplateManager({ api, canEdit, onClose }: { api: Api; canEdit: boolean; onClose: () => void }) {
  const [editing, setEditing] = useState<null | { id?: string }>(null)
  const [label, setLabel] = useState('')
  const [blurb, setBlurb] = useState('')
  const [groups, setGroups] = useState<Group[]>([{ title: '', text: '' }])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const [showRemoved, setShowRemoved] = useState(false)

  const active = api.list.filter(t => !t.archived)
  const removed = api.list.filter(t => t.archived)

  const open = (t?: ShopTemplate, from?: { title: string; items: string[] }[]) => {
    setProblem('')
    setLabel(t ? t.label : '')
    setBlurb(t ? t.blurb : '')
    setGroups(t ? toGroups(t.sections) : from ? toGroups(from) : [{ title: '', text: '' }])
    setEditing({ id: t?.id })
  }

  const cleaned = useMemo(() => cleanTemplate({ label, blurb, sections: groups.map(g => ({ title: g.title, items: g.text.split('\n') })) }), [label, blurb, groups])

  const submit = async () => {
    setProblem('')
    if (!cleaned) { setProblem('Give the checklist a name and at least one check.'); return }
    setBusy(true)
    const r = await api.save({ id: editing?.id, label: cleaned.label, blurb: cleaned.blurb, sections: cleaned.sections })
    setBusy(false)
    if (!r.ok) { setProblem(r.error || 'That did not save. Try again.'); return }
    setEditing(null)
  }

  const archive = async (t: ShopTemplate, archived: boolean) => {
    setBusy(true); setProblem('')
    const r = await api.setArchived(t.id, archived)
    setBusy(false)
    if (!r.ok) setProblem(r.error || 'That did not save. Try again.')
  }

  if (editing) {
    const setGroup = (i: number, patch: Partial<Group>) => setGroups(g => g.map((x, j) => (j === i ? { ...x, ...patch } : x)))
    return (
      <div>
        <button type="button" className="btn btn-ghost -ml-3 mb-2" onClick={() => setEditing(null)} disabled={busy}><Icon name="chevronLeft" className="h-5 w-5" />Your checklists</button>
        <div className="space-y-3">
          <div>
            <label className="form-label" htmlFor="tpl-label">Name</label>
            <input id="tpl-label" className="form-input" maxLength={MAX_TEMPLATE_LABEL} value={label} onChange={e => setLabel(e.target.value)} placeholder="For example: Pre-trip check" autoComplete="off" />
          </div>
          <div>
            <label className="form-label" htmlFor="tpl-blurb">Short description (optional)</label>
            <input id="tpl-blurb" className="form-input" maxLength={MAX_TEMPLATE_BLURB} value={blurb} onChange={e => setBlurb(e.target.value)} placeholder="Shown under the name when you start an inspection" autoComplete="off" />
          </div>
          {!editing.id && (
            <div>
              <label className="form-label" htmlFor="tpl-from">Copy the checks from</label>
              <select id="tpl-from" className="form-select" value="" onChange={e => { const t = TEMPLATES.find(x => x.key === e.target.value); if (t) { setGroups(toGroups(t.sections)); if (!label.trim()) setLabel(`${t.label} (mine)`.slice(0, MAX_TEMPLATE_LABEL)) } }}>
                <option value="">Start from nothing</option>
                {TEMPLATES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              <p className="mt-1 text-[0.8125rem] text-text-secondary">Choosing one replaces the groups below. You can then add, remove and rename.</p>
            </div>
          )}
        </div>

        <h3 className="section-title mt-5">Groups and checks</h3>
        <p className="mt-0.5 text-[0.875rem] text-text-secondary">One check per line. The technician rates each line good, watch or needs work.</p>
        <div className="mt-2 space-y-3">
          {groups.map((g, i) => (
            <div key={i} className="rounded-md border border-border p-3">
              <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                  <label className="form-label" htmlFor={`tpl-g-${i}`}>Group name</label>
                  <input id={`tpl-g-${i}`} className="form-input" maxLength={60} value={g.title} onChange={e => setGroup(i, { title: e.target.value })} placeholder="For example: Brakes" autoComplete="off" />
                </div>
                {groups.length > 1 && <button type="button" className="btn-icon shrink-0" aria-label={`Remove the group ${g.title || i + 1}`} onClick={() => setGroups(x => x.filter((_, j) => j !== i))}><Icon name="trash" className="h-5 w-5" /></button>}
              </div>
              <label className="form-label mt-2" htmlFor={`tpl-t-${i}`}>Checks</label>
              <textarea id={`tpl-t-${i}`} className="form-input" rows={5} value={g.text} onChange={e => setGroup(i, { text: e.target.value })} placeholder={'Front brake pads\nRear brake pads'} aria-describedby={`tpl-h-${i}`} />
              <p id={`tpl-h-${i}`} className="mt-0.5 text-[0.8125rem] text-text-secondary">Each line up to {MAX_NAME} characters.</p>
            </div>
          ))}
        </div>
        {groups.length < MAX_TEMPLATE_SECTIONS && <button type="button" className="btn btn-secondary mt-3" onClick={() => setGroups(g => [...g, { title: '', text: '' }])}><Icon name="plus" className="h-5 w-5" />Add a group</button>}

        <p className="mt-4 text-[0.9375rem]" aria-live="polite">{cleaned ? templateBlurb(cleaned.sections) : 'Nothing to save yet.'}</p>
        {problem && <p role="alert" className="form-error">{problem}</p>}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => void submit()} disabled={busy}>{busy ? 'Saving…' : 'Save checklist'}</button>
        </div>
      </div>
    )
  }

  return (
    <div>
      {!api.loaded ? (
        <div className="space-y-2" aria-busy="true" aria-label="Loading your checklists"><div className="skeleton h-14" /><div className="skeleton h-14" /></div>
      ) : (
        <>
          {api.error && <Notice kind="error" className="mb-3"><span className="block">{api.error}</span><button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => void api.reload()}>Try again</button></Notice>}
          {!api.available && <Notice kind="warn" className="mb-3">Your own checklists need a database update before they can be saved. The three built-in checklists work in the meantime.</Notice>}

          {active.length === 0 ? (
            <p className="text-[0.9375rem] text-text-secondary">You have not made a checklist of your own yet. Make one for the jobs you inspect most, such as a pre-trip check or a fleet check, and it shows first when you start an inspection.</p>
          ) : (
            <ul className="ledger" aria-label="Your checklists">
              {active.map(t => (
                <li key={t.id}>
                  <div className="ledger-row">
                    <span className="ledger-main">
                      <span className="ledger-title block !whitespace-normal">{t.label}</span>
                      <span className="ledger-sub block !whitespace-normal">{t.blurb || templateBlurb(t.sections)}</span>
                    </span>
                    {canEdit && (
                      <span className="flex shrink-0 items-center gap-1">
                        <button type="button" className="btn btn-secondary btn-sm" onClick={() => open(t)} disabled={busy}><Icon name="edit" className="h-4 w-4" />Edit</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void archive(t, true)} disabled={busy} aria-label={`Remove the checklist ${t.label}`}>Remove</button>
                      </span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}

          {canEdit && api.available && <button type="button" className="btn btn-primary mt-4 w-full" onClick={() => open()}><Icon name="plus" className="h-5 w-5" />Make a new checklist</button>}
          {!canEdit && <p className="mt-3 text-[0.875rem] text-text-secondary">Only owners, admins and managers can change the checklists.</p>}

          {removed.length > 0 && (
            <div className="mt-5">
              <button type="button" className="btn btn-ghost btn-sm -ml-2" aria-expanded={showRemoved} onClick={() => setShowRemoved(v => !v)}>
                <Icon name="chevronDown" className={`h-4 w-4 transition-transform ${showRemoved ? '' : '-rotate-90'}`} />Removed checklists ({removed.length})
              </button>
              {showRemoved && (
                <ul className="ledger mt-1" aria-label="Removed checklists">
                  {removed.map(t => (
                    <li key={t.id}>
                      <div className="ledger-row">
                        <span className="ledger-main"><span className="ledger-title block !whitespace-normal">{t.label}</span><span className="ledger-sub block">Inspections already made from it are not changed.</span></span>
                        {canEdit && <button type="button" className="btn btn-secondary btn-sm shrink-0" onClick={() => void archive(t, false)} disabled={busy}>Bring back</button>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {problem && <p role="alert" className="form-error">{problem}</p>}
        </>
      )}
      <button type="button" className="btn btn-ghost mt-3 w-full" onClick={onClose}>Done</button>
    </div>
  )
}
