'use client'
import Link from 'next/link'
import { useCallback, useEffect, useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { FilterChips } from '@/components/ListKit'
import { docTotals } from '@/components/jobs/types'
import { getShopId, supabase } from '@/lib/supabase'
import { claimApprovedTotal, hasSupplement, openForLabel, owesDeductible, reasonOf, roLabel, supplementWaiting } from '@/lib/list-logic'
import { SaveCheck, SaveField, SaveSelect } from './SaveField'
import type { SaveFn } from './SaveField'
import { NOTE_TYPES, PAY_METHODS, SUPPLEMENT_STATUSES, amountText, carOf, fmtDate, lampOf, money, stamp, statusChoices, statusLabel } from './types'
import type { Job, NoteEntry } from './types'

const notEntered = <span className="text-text-secondary">Not entered</span>

function Lampword({ status }: { status: string | undefined }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap font-bold">
      <span className={`lamp lamp-${lampOf(status)}`} aria-hidden="true" />
      {statusLabel(status)}
    </span>
  )
}

function Panel({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-header"><h2 className="section-title">{title}</h2>{action}</div>
      <div className="panel-body">{children}</div>
    </section>
  )
}

interface LinkedDoc { id: string; type: string; doc_number: string; status: string; total: number; paid: number }
const docHref = (d: LinkedDoc) => `/${d.type === 'Estimate' ? 'estimates' : d.type === 'Receipt' ? 'receipts' : 'invoices'}?document=${encodeURIComponent(d.id)}`

export default function ClaimDetail({ job, save, onBack, onAsk, onAddNote, onDeleteNote, onRemove }: {
  job: Job
  save: SaveFn
  onBack: () => void
  onAsk: () => void
  onAddNote: (type: string, text: string) => Promise<string | null>
  onDeleteNote: (id: string) => Promise<string | null>
  onRemove: () => void
}) {
  const dedDue = owesDeductible(job)
  const waiting = supplementWaiting(job)
  const approvedTotal = claimApprovedTotal(job)
  const supApproved = Number(job.supplement_amount_approved) || 0
  const open = !['Paid', 'Closed'].includes(job.status)

  const [statusError, setStatusError] = useState('')
  const [statusBusy, setStatusBusy] = useState(false)
  const changeStatus = async (s: string) => {
    if (s === job.status || statusBusy) return
    setStatusBusy(true); setStatusError('')
    const problem = await save({ status: s })
    setStatusBusy(false)
    if (problem) setStatusError(problem)
  }

  /* ---------- notes ---------- */
  const [noteType, setNoteType] = useState('Call')
  const [noteText, setNoteText] = useState('')
  const [noteBusy, setNoteBusy] = useState(false)
  const [noteError, setNoteError] = useState('')
  const [confirmNote, setConfirmNote] = useState('')
  const addNote = async () => {
    const text = noteText.trim()
    if (!text || noteBusy) return
    setNoteBusy(true); setNoteError('')
    const problem = await onAddNote(noteType, text)
    setNoteBusy(false)
    if (problem) setNoteError(problem); else setNoteText('')
  }
  const removeNote = async (id: string) => {
    setNoteBusy(true); setNoteError('')
    const problem = await onDeleteNote(id)
    setNoteBusy(false)
    if (problem) setNoteError(problem); else setConfirmNote('')
  }
  const notes: NoteEntry[] = Array.isArray(job.communication_log) ? job.communication_log : []

  /* ---------- the paperwork on this repair order ---------- */
  const [docs, setDocs] = useState<LinkedDoc[] | null>(null)
  const [docError, setDocError] = useState('')
  const loadDocs = useCallback(async () => {
    setDocError('')
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('We could not find your shop.')
      const { data, error } = await supabase.from('documents').select('id,type,doc_number,status,parts,labors,shop_supplies,sublet,tax_rate,apply_tax,deposit,amount_paid').eq('shop_id', shopId).eq('job_id', job.id).order('created_at', { ascending: false }).limit(50)
      if (error) throw new Error(error.message)
      setDocs((data || []).map((d: Record<string, unknown>) => {
        const t = docTotals(d)
        return { id: String(d.id), type: String(d.type || 'Invoice'), doc_number: String(d.doc_number || ''), status: String(d.status || ''), total: t.total, paid: t.paid }
      }))
    } catch (e) {
      setDocError(`The estimates and invoices for this claim did not load. ${reasonOf(e, 'Check your connection.')}`)
    }
  }, [job.id])
  useEffect(() => { void loadDocs() }, [loadDocs])

  const newDocQuery = job.customer_id ? `&customer=${encodeURIComponent(job.customer_id)}` : ''
  const dial = () => { if (job.adjuster_phone) window.dispatchEvent(new CustomEvent('phone:call', { detail: { number: job.adjuster_phone, name: job.adjuster || 'Adjuster' } })) }

  const field = (id: string, label: string, name: string, kind: 'text' | 'tel' | 'email' | 'date' | 'money', extra?: { hint?: string; placeholder?: string; className?: string }) => (
    <SaveField id={id} label={label} field={name} kind={kind} value={kind === 'money' ? amountText(job[name]) : String(job[name] ?? '')} save={save} {...extra} />
  )

  return (
    <div className="page-container animate-fade-in">
      <button type="button" className="btn btn-ghost -ml-3 mb-1" onClick={onBack}><Icon name="back" className="h-5 w-5" />All claims</button>
      <header className="page-header">
        <div className="min-w-0">
          <h1 className="page-title">{job.customer_name || 'Insurance claim'}</h1>
          <p className="page-subtitle">{carOf(job) || 'No vehicle on this claim'}{job.ro_number ? ` · ${roLabel(job.ro_number)}` : ''}</p>
        </div>
        <div className="toolbar">
          <Link href={`/jobs?job=${encodeURIComponent(job.id)}`} className="btn btn-secondary"><Icon name="wrench" className="h-5 w-5" />Open repair order</Link>
          <button type="button" className="btn btn-primary" onClick={onAsk}><Icon name="alpha" className="h-5 w-5" />Ask Alpha</button>
        </div>
      </header>
      <p className="-mt-2 mb-4 text-[0.9375rem] text-text-secondary">Each box saves when you leave it. If a save fails, the message appears under that box with a way to try again.</p>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="space-y-5">
          <Panel title="Claim status">
            <div className="md:hidden">
              <SaveSelect id="claim-status" label="Claim status" field="status" value={job.status || 'New'} save={save} options={statusChoices(job.status).map(s => ({ value: s, label: statusLabel(s) }))} />
            </div>
            <div className="hidden md:block">
              <FilterChips label="Claim status" value={job.status || 'New'} onChange={s => void changeStatus(s)} options={statusChoices(job.status).map(s => ({ key: s, label: statusLabel(s) }))} />
              {statusBusy && <p className="mt-2 text-[0.875rem] text-text-secondary" role="status">Saving…</p>}
              {statusError && <p role="alert" className="form-error !text-[0.875rem]">{statusError}</p>}
            </div>
            {job.status === 'Supplement' && <p className="mt-2 text-[0.875rem] text-text-secondary">On the Jobs board this repair order shows under Waiting, until the insurer answers. Use the Supplement section below to track the request itself.</p>}
          </Panel>

          <Panel title="Insurance and claim">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {field('f-ins', 'Insurance company', 'insurance_company', 'text')}
              {field('f-claim', 'Claim number', 'claim_number', 'text')}
              {field('f-loss', 'Loss date', 'loss_date', 'date')}
              {field('f-policy', 'Policy number', 'policy_number', 'text')}
            </div>
          </Panel>

          <Panel title="Adjuster">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {field('f-adj', 'Name', 'adjuster', 'text')}
              {field('f-adjph', 'Phone', 'adjuster_phone', 'tel')}
              {field('f-adjem', 'Email', 'adjuster_email', 'email')}
            </div>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row">
              <button type="button" className="btn btn-secondary" onClick={dial} disabled={!job.adjuster_phone}><Icon name="phone" className="h-5 w-5" />Call adjuster</button>
              {job.adjuster_email
                ? <a className="btn btn-secondary" href={`mailto:${job.adjuster_email}`}><Icon name="mail" className="h-5 w-5" />Email adjuster</a>
                : <button type="button" className="btn btn-secondary" disabled><Icon name="mail" className="h-5 w-5" />Email adjuster</button>}
            </div>
            {(!job.adjuster_phone || !job.adjuster_email) && <p className="mt-2 text-[0.875rem] text-text-secondary">{!job.adjuster_phone && !job.adjuster_email ? 'Add a phone number or email to call or write the adjuster from here.' : !job.adjuster_phone ? 'Add a phone number to call the adjuster from here.' : 'Add an email to write the adjuster from here.'}</p>}
          </Panel>

          <Panel title="Money">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {field('f-appr', 'Approved amount', 'approved_amount', 'money', { placeholder: '0.00' })}
              {field('f-ded', 'Deductible', 'deductible', 'money', { placeholder: '0.00' })}
              <SaveCheck id="f-dedcol" label="Deductible collected" field="deductible_collected" value={!!job.deductible_collected} save={save} className="sm:self-end" />
              <SaveSelect id="f-dedpm" label="How the deductible was paid" field="deductible_payment_method" value={job.deductible_payment_method || ''} placeholder="Choose a method" options={PAY_METHODS.map(m => ({ value: m, label: m }))} save={save} />
            </div>
          </Panel>

          <Panel title="Supplement">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <SaveSelect id="f-sup" label="Supplement status" field="supplement_status" value={job.supplement_status || 'None'} options={SUPPLEMENT_STATUSES.map(s => ({ value: s, label: s }))} save={save} />
              {field('f-supreq', 'Amount requested', 'supplement_amount_requested', 'money', { placeholder: '0.00' })}
              {field('f-supappr', 'Amount approved', 'supplement_amount_approved', 'money', { placeholder: '0.00' })}
            </div>
          </Panel>

          <Panel title="Damage and repair notes">
            <SaveField id="f-notes" label="Damage and repair notes" hideLabel kind="textarea" field="inspection_notes" value={String(job.inspection_notes ?? '')} save={save} placeholder="Damage description, parts needed, repair plan" />
          </Panel>

          <Panel title="Estimates and invoices" action={job.customer_id ? <Link href={`/estimates?new=1${newDocQuery}`} className="inline-flex min-h-[44px] items-center font-bold text-blue underline-offset-4 hover:underline">New estimate</Link> : null}>
            {docError ? (
              <Notice kind="error">{docError} <button type="button" className="inline-flex min-h-[44px] items-center font-bold underline underline-offset-2" onClick={() => void loadDocs()}>Try again</button></Notice>
            ) : docs === null ? (
              <div className="skeleton h-14" aria-busy="true" aria-label="Loading estimates and invoices" role="status" />
            ) : docs.length === 0 ? (
              <p className="text-text-secondary">No estimate or invoice is linked to this repair order yet. Write the estimate from the repair order so the adjuster sees the same numbers.</p>
            ) : (
              <ul className="ledger -mx-4 !border-x-0 sm:-mx-5">
                {docs.map(d => (
                  <li key={d.id}>
                    <Link className="ledger-row py-3 no-underline" href={docHref(d)}>
                      <span className="ledger-main">
                        <span className="ledger-title block">{d.type} {d.doc_number}</span>
                        <span className="ledger-sub block">{d.status || 'No status'}{d.paid > 0 ? ` · ${money(d.paid)} paid` : ''}</span>
                      </span>
                      <span className="ledger-amt shrink-0">{money(d.total)}</span>
                      <Icon name="chevronRight" className="h-4 w-4 shrink-0 text-text-muted" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-5">
          <section className="panel">
            <div className="panel-header"><h2 className="section-title">Summary</h2></div>
            <dl className="divide-y divide-border px-4 sm:px-5">
              {[
                { k: 'Status', v: <Lampword status={job.status} /> },
                ...(open && job.created_at ? [{ k: 'Open for', v: <span className="font-bold">{openForLabel(job.created_at).replace(/^Open /, '').replace('Opened today', 'Today')}</span> }] : []),
                { k: 'Insurance', v: job.insurance_company || notEntered },
                { k: 'Claim number', v: job.claim_number ? <span className="num">{job.claim_number}</span> : notEntered },
                { k: 'Loss date', v: job.loss_date ? fmtDate(job.loss_date) : notEntered },
                { k: 'Approved', v: job.approved_amount ? <span className="num font-bold">{money(job.approved_amount)}</span> : notEntered },
                ...(supApproved > 0 ? [{ k: 'With supplement', v: <span className="num font-bold">{money(approvedTotal)}</span> }] : []),
                { k: 'Deductible', v: job.deductible
                  ? <span className="num inline-flex flex-wrap items-center justify-end gap-x-2"><span className="font-bold">{money(job.deductible)}</span>{dedDue ? <span className="inline-flex items-center gap-1.5 font-bold text-amber"><span className="lamp lamp-amber" aria-hidden="true" />Not collected</span> : <span className="inline-flex items-center gap-1.5 font-bold text-green"><span className="lamp lamp-green" aria-hidden="true" />Collected</span>}</span>
                  : notEntered },
                ...(hasSupplement(job) ? [{ k: 'Supplement', v: <span className="inline-flex flex-wrap items-center justify-end gap-x-2"><span className="inline-flex items-center gap-1.5 font-bold">{waiting && <span className="lamp lamp-amber" aria-hidden="true" />}{job.supplement_status}</span>{Number(job.supplement_amount_requested) > 0 && <span className="num text-text-secondary">asked {money(job.supplement_amount_requested)}</span>}</span> }] : []),
              ].map(r => (
                <div key={r.k} className="flex items-start justify-between gap-4 py-2.5">
                  <dt className="text-text-secondary">{r.k}</dt>
                  <dd className="text-right">{r.v}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="panel">
            <div className="panel-header"><h2 className="section-title">Calls and notes</h2></div>
            <div className="panel-body">
              <form onSubmit={e => { e.preventDefault(); void addNote() }}>
                <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-2">
                  <div>
                    <label className="sr-only" htmlFor="note-type">Type of note</label>
                    <select id="note-type" className="form-select" value={noteType} onChange={e => setNoteType(e.target.value)}>
                      {NOTE_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="sr-only" htmlFor="note-text">Note</label>
                    <input id="note-text" className="form-input" autoComplete="off" placeholder="What was said or agreed" value={noteText} onChange={e => setNoteText(e.target.value)} />
                  </div>
                </div>
                <button type="submit" className="btn btn-secondary mt-2 w-full" disabled={!noteText.trim() || noteBusy}><Icon name="plus" className="h-5 w-5" />{noteBusy ? 'Saving…' : 'Add note'}</button>
              </form>
              {noteError && <p role="alert" className="form-error !text-[0.875rem]">{noteError} What you typed is still in the box.</p>}
              <ul className="mt-4 max-h-96 space-y-2 overflow-y-auto">
                {notes.length === 0 && (
                  <li className="py-3 text-center text-text-secondary">Nothing logged yet. Add each call or email with the adjuster so you can show what was agreed.</li>
                )}
                {notes.map(n => (
                  <li key={n.id} className="rounded-md border border-border bg-bg-base p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full border border-border bg-bg-card px-2.5 py-0.5 text-[0.875rem] font-bold">{n.type}</span>
                        <span className="num text-[0.875rem] text-text-secondary">{stamp(n.date)}</span>
                      </div>
                      {confirmNote !== n.id && <button type="button" className="btn-icon -my-2 -mr-2.5" onClick={() => setConfirmNote(n.id)} aria-label={`Delete ${String(n.type || 'note').toLowerCase()} note`}><Icon name="trash" className="h-5 w-5" /></button>}
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words">{n.text}</p>
                    {confirmNote === n.id && (
                      <div className="mt-2 border-t border-border pt-2">
                        <p className="mb-2 text-[0.9375rem] font-bold">Delete this note?</p>
                        <div className="flex gap-2">
                          <button type="button" className="btn btn-danger flex-1 sm:flex-none" onClick={() => void removeNote(n.id)} disabled={noteBusy}>{noteBusy ? 'Deleting…' : 'Delete note'}</button>
                          <button type="button" className="btn btn-secondary flex-1 sm:flex-none" onClick={() => setConfirmNote('')} disabled={noteBusy}>Keep it</button>
                        </div>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <section className="rounded-lg border border-border p-4">
            <h2 className="section-title">Not a claim after all?</h2>
            <p className="mt-1 text-[0.9375rem] text-text-secondary">Taking it off this list does not touch the repair order. The details you entered stay on it.</p>
            <button type="button" className="btn btn-secondary mt-3 w-full sm:w-auto" onClick={onRemove}>Remove from claims</button>
          </section>
        </div>
      </div>
    </div>
  )
}
