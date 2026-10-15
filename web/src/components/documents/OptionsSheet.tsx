'use client'
import { useState } from 'react'
import { formatCurrency } from '@/lib/supabase'
import { choiceTotals } from '@/lib/doc-approval'
import type { OptionChoice, OptionGroup } from '@/lib/doc-approval'
import type { Line } from '@/lib/doc-lines'
import { jobNameOf } from '@/lib/doc-lines'
import Icon from '@/components/Icon'
import { Field, NumInput } from './LineCards'
import { ErrorMsg, WarnMsg } from './Dialogs'
import { deleteOptionGroup, saveOptionGroup } from './api'

const actions = 'mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end'
const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`)

interface Draft { id?: string; name: string; choices: OptionChoice[] }

const blankChoice = (label: string, recommended = false): OptionChoice => ({ id: newId(), label, description: '', recommended, parts: [], labors: [] })
const freshDraft = (): Draft => ({ name: '', choices: [blankChoice('Good'), blankChoice('Better', true), blankChoice('Best')] })

const STATUS_WORDS: Record<string, string> = { open: 'Waiting for the customer', chosen: 'Customer chose', declined: 'Customer said no', void: 'Removed' }

/**
 * Good, better, best. A group is one decision the customer makes, like "Brake pads", with two to five choices. The
 * lines of a choice are only added to the estimate when the customer picks it, so they must not also be on the
 * estimate itself. Once the customer has answered, a group is kept as part of the record and can no longer be changed.
 */
export default function OptionsSheet({ documentId, groups, available, loadError, loading, laborRate, jobs, docParts, docLabors, onChanged, onRemoveJob, onRetry, onClose }: {
  documentId: string
  groups: OptionGroup[]
  available: boolean
  loadError: string
  loading: boolean
  laborRate: number
  jobs: string[]
  docParts: Line[]
  docLabors: Line[]
  /** Called after a group is saved or removed, so the page can reload and note it in the history. */
  onChanged: (what: string) => void
  /** Takes a job's lines off the estimate (they move into a choice). */
  onRemoveJob: (job: string) => void
  onRetry: () => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  if (loading) return <div className="space-y-2" aria-busy="true" aria-label="Loading the choices">{[0, 1, 2].map(i => <div key={i} className="skeleton h-16" />)}</div>
  if (!available) return (
    <div>
      <WarnMsg>Choices like good, better, best need a database update first. Ask whoever manages your account to apply it.</WarnMsg>
      <div className={actions}><button type="button" className="btn btn-secondary" onClick={onClose}>Close</button></div>
    </div>
  )
  if (loadError) return (
    <div>
      <ErrorMsg>{loadError}</ErrorMsg>
      <div className={actions}>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
        <button type="button" className="btn btn-primary" onClick={onRetry}>Try again</button>
      </div>
    </div>
  )

  const open = (g: OptionGroup) => setDraft({ id: g.id, name: g.name, choices: g.choices.map(c => ({ ...c, parts: c.parts.map(p => ({ ...p })), labors: c.labors.map(l => ({ ...l })) })) })

  const save = async () => {
    if (!draft) return
    setBusy(true); setError('')
    const r = await saveOptionGroup({
      documentId, id: draft.id, name: draft.name,
      choices: draft.choices.map(c => ({ id: c.id, label: c.label, description: c.description, recommended: c.recommended, parts: c.parts, labors: c.labors })),
    })
    setBusy(false)
    if (!r.ok) { setError(r.error); return }
    onChanged(draft.id ? `Changed the choices for ${draft.name}` : `Added choices for ${draft.name}`)
    setDraft(null); setCopied(null)
  }

  const remove = async (g: OptionGroup) => {
    setBusy(true); setError('')
    const r = await deleteOptionGroup(g.id)
    setBusy(false); setConfirmDelete(null)
    if (!r.ok) { setError(r.error); return }
    onChanged(`Removed the choices for ${g.name}`)
  }

  /* ---------- editor ---------- */
  if (draft) {
    const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch })
    const setChoice = (i: number, patch: Partial<OptionChoice>) => set({ choices: draft.choices.map((c, j) => (j === i ? { ...c, ...patch } : c)) })
    const setRecommended = (i: number) => set({ choices: draft.choices.map((c, j) => ({ ...c, recommended: j === i ? !c.recommended : false })) })
    const copyJob = (i: number, job: string) => {
      const pick = (l: Line) => jobNameOf(l).toLowerCase() === job.toLowerCase()
      const parts = docParts.filter(pick)
      const labors = docLabors.filter(pick)
      setChoice(i, { parts: [...draft.choices[i].parts, ...parts.map(p => ({ ...p, job: undefined, approved: undefined }))], labors: [...draft.choices[i].labors, ...labors.map(l => ({ ...l, job: undefined, approved: undefined }))] })
      setCopied(job)
    }
    const valid = draft.name.trim().length > 0 && draft.choices.length >= 2 && draft.choices.every(c => c.label.trim() && c.parts.length + c.labors.length > 0)
    return (
      <div>
        <button type="button" className="btn btn-ghost btn-sm -ml-2 mb-2" onClick={() => { setDraft(null); setError(''); setCopied(null) }} disabled={busy}>
          <Icon name="chevronLeft" className="h-4 w-4" />
          All choices
        </button>
        <Field id="opt-name" label="What is the customer choosing?" hint="For example Brake pads, Tires or Battery.">
          <input id="opt-name" className="form-input" value={draft.name} maxLength={80} autoFocus onChange={e => set({ name: e.target.value })} />
        </Field>

        <ol className="mt-4 space-y-4">
          {draft.choices.map((c, i) => {
            const before = choiceTotals(c, { tax_rate: 0, apply_tax: false }).total
            return (
              <li key={c.id} className="card !p-3.5">
                <div className="grid grid-cols-6 gap-x-3 gap-y-3">
                  <Field id={`opt-l-${i}`} label={`Choice ${i + 1} name`} className="col-span-6 sm:col-span-2">
                    <input id={`opt-l-${i}`} className="form-input" value={c.label} maxLength={40} onChange={e => setChoice(i, { label: e.target.value })} />
                  </Field>
                  <Field id={`opt-d-${i}`} label="Short description" className="col-span-6 sm:col-span-4">
                    <input id={`opt-d-${i}`} className="form-input" value={c.description} maxLength={400} placeholder="Ceramic pads, quiet, lasts longer" onChange={e => setChoice(i, { description: e.target.value })} />
                  </Field>
                </div>

                <ul className="mt-3 space-y-2">
                  {c.labors.map((l, k) => (
                    <li key={`l${k}`} className="grid grid-cols-6 items-end gap-2">
                      <Field id={`opt-lo-${i}-${k}`} label="Labor" className="col-span-6 sm:col-span-3">
                        <input id={`opt-lo-${i}-${k}`} className="form-input" value={String(l.operation || '')} onChange={e => setChoice(i, { labors: c.labors.map((x, y) => (y === k ? { ...x, operation: e.target.value } : x)) })} />
                      </Field>
                      <Field id={`opt-lh-${i}-${k}`} label="Hours" className="col-span-2 sm:col-span-1">
                        <NumInput id={`opt-lh-${i}-${k}`} step="0.1" value={(l.hours as number | string | undefined) ?? 0} onChange={v => setChoice(i, { labors: c.labors.map((x, y) => (y === k ? { ...x, hours: Number(v) } : x)) })} />
                      </Field>
                      <Field id={`opt-lr-${i}-${k}`} label="Rate" className="col-span-3 sm:col-span-1">
                        <NumInput id={`opt-lr-${i}-${k}`} money value={(l.rate as number | string | undefined) ?? laborRate} onChange={v => setChoice(i, { labors: c.labors.map((x, y) => (y === k ? { ...x, rate: Number(v) } : x)) })} />
                      </Field>
                      <button type="button" className="btn btn-ghost btn-sm col-span-1 !text-red" aria-label={`Remove labor line ${k + 1} from choice ${c.label}`} onClick={() => setChoice(i, { labors: c.labors.filter((_, y) => y !== k) })}><Icon name="trash" className="h-4 w-4" /></button>
                    </li>
                  ))}
                  {c.parts.map((p, k) => (
                    <li key={`p${k}`} className="grid grid-cols-6 items-end gap-2">
                      <Field id={`opt-pn-${i}-${k}`} label="Part" className="col-span-6 sm:col-span-3">
                        <input id={`opt-pn-${i}-${k}`} className="form-input" value={String(p.name || '')} onChange={e => setChoice(i, { parts: c.parts.map((x, y) => (y === k ? { ...x, name: e.target.value } : x)) })} />
                      </Field>
                      <Field id={`opt-pq-${i}-${k}`} label="Qty" className="col-span-2 sm:col-span-1">
                        <NumInput id={`opt-pq-${i}-${k}`} step="1" value={(p.qty as number | string | undefined) ?? 1} onChange={v => setChoice(i, { parts: c.parts.map((x, y) => (y === k ? { ...x, qty: Number(v) } : x)) })} />
                      </Field>
                      <Field id={`opt-pp-${i}-${k}`} label="Price each" className="col-span-3 sm:col-span-1">
                        <NumInput id={`opt-pp-${i}-${k}`} money value={(p.unitPrice as number | string | undefined) ?? 0} onChange={v => setChoice(i, { parts: c.parts.map((x, y) => (y === k ? { ...x, unitPrice: Number(v) } : x)) })} />
                      </Field>
                      <button type="button" className="btn btn-ghost btn-sm col-span-1 !text-red" aria-label={`Remove part line ${k + 1} from choice ${c.label}`} onClick={() => setChoice(i, { parts: c.parts.filter((_, y) => y !== k) })}><Icon name="trash" className="h-4 w-4" /></button>
                    </li>
                  ))}
                </ul>
                {c.parts.length + c.labors.length === 0 && <p className="mt-2 text-[0.875rem] text-text-secondary">Add at least one line so the customer sees a price.</p>}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setChoice(i, { labors: [...c.labors, { operation: '', tech: '', hours: 1, rate: laborRate }] })}>Add labor</button>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => setChoice(i, { parts: [...c.parts, { name: '', brand: '', qty: 1, unitPrice: 0, taxable: true, status: 'Ordered' }] })}>Add part</button>
                  {jobs.length > 0 && (
                    <>
                      <label htmlFor={`opt-copy-${i}`} className="sr-only">Copy a job from the estimate into choice {c.label}</label>
                      <select id={`opt-copy-${i}`} className="form-select !w-auto" value="" onChange={e => { if (e.target.value) copyJob(i, e.target.value) }}>
                        <option value="">Copy a job from the estimate</option>
                        {jobs.map(j => <option key={j} value={j}>{j}</option>)}
                      </select>
                    </>
                  )}
                </div>

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
                  <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-[0.9375rem]">
                    <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--c-blue))]" checked={c.recommended} onChange={() => setRecommended(i)} />
                    Mark as recommended
                  </label>
                  <span className="num text-[0.9375rem]">
                    <span className="text-text-secondary">Before tax </span><span className="font-bold">{formatCurrency(before)}</span>
                  </span>
                  {draft.choices.length > 2 && (
                    <button type="button" className="btn btn-ghost btn-sm !text-red" onClick={() => set({ choices: draft.choices.filter((_, y) => y !== i) })}>Remove this choice</button>
                  )}
                </div>
              </li>
            )
          })}
        </ol>

        {draft.choices.length < 5 && (
          <button type="button" className="btn btn-secondary mt-3" onClick={() => set({ choices: [...draft.choices, blankChoice('')] })}>
            <Icon name="plus" className="h-5 w-5" />
            Add another choice
          </button>
        )}

        {copied && (
          <div className="mt-4">
            <WarnMsg>
              You copied “{copied}” from the estimate. A choice adds its lines only when the customer picks it, so take that job off the estimate or the customer is charged twice.
            </WarnMsg>
            <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={() => { onRemoveJob(copied); setCopied(null) }}>Take “{copied}” off the estimate</button>
          </div>
        )}
        {error && <div className="mt-3"><ErrorMsg>{error}</ErrorMsg></div>}
        <div className={actions}>
          <button type="button" className="btn btn-secondary" onClick={() => { setDraft(null); setError(''); setCopied(null) }} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={!valid || busy}>{busy ? 'Saving…' : 'Save these choices'}</button>
        </div>
      </div>
    )
  }

  /* ---------- list ---------- */
  const shown = groups.filter(g => g.status !== 'void')
  return (
    <div>
      <p className="text-[0.9375rem] text-text-secondary">Offer the customer a choice for part of the job, like good, better and best brake pads. They pick one on their phone, and the estimate total updates as they do.</p>
      {error && <div className="mt-3"><ErrorMsg>{error}</ErrorMsg></div>}
      {shown.length === 0 ? (
        <div className="empty-state mt-4">
          <p className="font-bold text-text-primary">No choices on this estimate</p>
          <p className="mx-auto mt-1 max-w-md">Add one when a part or service comes in more than one price.</p>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {shown.map(g => (
            <li key={g.id} className="card !p-3.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-bold">{g.name}</p>
                  <p className="text-[0.875rem] text-text-secondary">{STATUS_WORDS[g.status] || g.status}{g.status === 'chosen' && g.chosenChoiceId ? `: ${g.choices.find(c => c.id === g.chosenChoiceId)?.label || ''}` : ''}</p>
                </div>
                {g.status === 'open' && (
                  <div className="flex shrink-0 gap-1">
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => open(g)}>Change</button>
                    {confirmDelete === g.id ? (
                      <button type="button" className="btn btn-danger btn-sm" disabled={busy} onClick={() => void remove(g)}>Remove it</button>
                    ) : (
                      <button type="button" className="btn-icon" aria-label={`Remove the choices for ${g.name}`} onClick={() => setConfirmDelete(g.id)}><Icon name="trash" className="h-5 w-5" /></button>
                    )}
                  </div>
                )}
              </div>
              <ul className="mt-2 grid gap-1 text-[0.9375rem]">
                {g.choices.map(c => (
                  <li key={c.id} className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0">{c.label}{c.recommended && <span className="tag tag-green ml-2">Recommended</span>}</span>
                    <span className="num shrink-0 font-bold">{formatCurrency(choiceTotals(c, { tax_rate: 0, apply_tax: false }).total)}</span>
                  </li>
                ))}
              </ul>
              {g.status !== 'open' && <p className="mt-2 text-[0.8125rem] text-text-secondary">The customer already answered, so this is kept as it was.</p>}
            </li>
          ))}
        </ul>
      )}
      <div className={actions}>
        <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
        <button type="button" className="btn btn-primary" onClick={() => { setDraft(freshDraft()); setError('') }}>
          <Icon name="plus" className="h-5 w-5" />
          Add choices
        </button>
      </div>
    </div>
  )
}
