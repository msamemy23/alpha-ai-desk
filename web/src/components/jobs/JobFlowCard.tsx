'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { useScheduleSettings } from '@/components/schedule/useScheduleSettings'
import { longDate } from './types'
import {
  DEFAULT_LABELS, MAX_LABEL, MAX_LABELS, MAX_PARTS_NOTE, MAX_PUBLIC_NOTE, PARTS_STATUSES, PARTS_TONE, PARTS_WORD,
  draftFrom, emptyFlow, flowFrom, hoursProblem, patchFrom, toggleLabel,
} from '@/lib/jobflow'
import type { FlowDraft, JobFlow, PartsStatus } from '@/lib/jobflow'

type Phase = 'loading' | 'update' | 'ready' | 'error'

const LAMP: Record<'off' | 'red' | 'amber' | 'green', string> = { off: 'lamp-off', red: 'lamp-red', amber: 'lamp-amber', green: 'lamp-green' }

/**
 * The extras on one car, in one place to edit: parts status and due date, labels, hours, the promised time, and the line the customer reads.
 * Self-contained: it reads and writes only the extras table, never the repair order, estimate or invoice.
 * On the board the page already holds every car's copy and passes it in; on the job sheet it loads its own.
 */
export default function JobFlowCard({
  jobId, promiseDate, labelChoices, flow, available, onSaved, onBusy, onDirty,
}: {
  jobId: string
  /** The date on the job (yyyy-mm-dd). A promised time needs one. */
  promiseDate: string | null
  /** The shop's own list of quick labels. */
  labelChoices?: string[]
  /** The board's copy of this car. Leave out to load it here. */
  flow?: JobFlow | null
  /** Whether the database holds the extras. null while the board is still finding out. */
  available?: boolean | null
  onSaved?: (f: JobFlow) => void
  /** True while a save is running, so the board does not refresh over it. */
  onBusy?: (busy: boolean) => void
  onDirty?: (dirty: boolean) => void
}) {
  const own = flow === undefined
  const [mine, setMine] = useState<JobFlow | null>(null)
  const [phase, setPhase] = useState<Phase>(own ? 'loading' : 'ready')
  const [loadError, setLoadError] = useState('')
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const read = useCallback(async () => {
    setPhase('loading'); setLoadError('')
    try {
      const res = await fetch(`/api/jobflow?job_id=${encodeURIComponent(jobId)}`, { cache: 'no-store' })
      const d = await res.json().catch(() => ({})) as Record<string, unknown>
      if (!alive.current) return
      if (!res.ok || d.ok !== true) { setLoadError(typeof d.error === 'string' ? d.error : 'The parts, labels and hours could not be loaded. Try again.'); setPhase('error'); return }
      if (d.available === false) { setPhase('update'); return }
      const rows = Array.isArray(d.flows) ? d.flows as Record<string, unknown>[] : []
      const row = rows.find(r => r.job_id === jobId)
      setMine(row ? flowFrom(row) : emptyFlow(jobId))
      setPhase('ready')
    } catch {
      if (alive.current) { setLoadError('No connection. Check your internet and try again.'); setPhase('error') }
    }
  }, [jobId])
  useEffect(() => { if (own) void read() }, [own, read])

  const current: JobFlow | null = own ? mine : (flow ?? emptyFlow(jobId))
  const showing: Phase = own ? phase : available === null || available === undefined ? 'loading' : available === false ? 'update' : 'ready'

  return (
    <section className="mt-5" aria-label="Board details for this car">
      <h3 className="section-title mb-1.5">Parts, hours and promised time</h3>
      {showing === 'loading' && <div className="skeleton h-40" aria-busy="true" aria-label="Loading the parts and hours" />}
      {showing === 'update' && <Notice kind="info">These board details need a database update before they can be saved. Nothing else on this job is affected.</Notice>}
      {showing === 'error' && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-2 text-[0.9375rem]">
          <span className="min-w-0 flex-1 basis-56 text-red">{loadError}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void read()}>Try again</button>
        </div>
      )}
      {showing === 'ready' && current && (
        <FlowForm
          key={current.job_id}
          jobId={jobId}
          saved={current}
          promiseDate={promiseDate}
          choices={labelChoices ?? DEFAULT_LABELS}
          onSaved={f => { if (own) setMine(f); onSaved?.(f) }}
          onBusy={onBusy}
          onDirty={onDirty}
        />
      )}
    </section>
  )
}

/** The shop's own label list comes from its board settings; the job sheet reads them here. */
export function JobFlowCardWithSettings(props: Omit<React.ComponentProps<typeof JobFlowCard>, 'labelChoices'>) {
  const sched = useScheduleSettings()
  return <JobFlowCard {...props} labelChoices={sched.settings.board.labels} />
}

function FlowForm({ jobId, saved, promiseDate, choices, onSaved, onBusy, onDirty }: {
  jobId: string
  saved: JobFlow
  promiseDate: string | null
  choices: string[]
  onSaved: (f: JobFlow) => void
  onBusy?: (busy: boolean) => void
  onDirty?: (dirty: boolean) => void
}) {
  /** The copy this draft started from. Only fields changed against it are saved, so somebody else's change to another field is never undone. */
  const [baseline, setBaseline] = useState<JobFlow>(saved)
  const [draft, setDraft] = useState<FlowDraft>(() => draftFrom(saved))
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const [said, setSaid] = useState('')
  const [problem, setProblem] = useState('')
  const lock = useRef(false)

  const patch = useMemo(() => patchFrom(baseline, draft), [baseline, draft])
  const dirty = Object.keys(patch).length > 0
  const hoursBad = hoursProblem(draft.est_hours)
  const timeNeedsDate = draft.promise_time !== '' && !promiseDate

  useEffect(() => { onDirty?.(dirty) }, [dirty, onDirty])
  useEffect(() => () => onDirty?.(false), [onDirty])

  // A fresh copy arrives (a refresh, or somebody else saved). If nothing is typed, show it; if something is, keep the typing.
  useEffect(() => {
    if (saved.version === baseline.version && saved.updated_at === baseline.updated_at) return
    if (!dirty) { setBaseline(saved); setDraft(draftFrom(saved)) }
  }, [saved, baseline.version, baseline.updated_at, dirty])

  const set = <K extends keyof FlowDraft>(k: K, v: FlowDraft[K]) => { setDraft(d => ({ ...d, [k]: v })); setSaid(''); setProblem('') }
  const usesParts = draft.parts === 'needed' || draft.parts === 'ordered' || draft.parts === 'partial'

  const allLabels = useMemo(() => {
    const seen = new Set<string>(); const out: string[] = []
    for (const l of [...choices, ...draft.labels]) { const k = l.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(l) } }
    return out
  }, [choices, draft.labels])
  const onCar = (l: string) => draft.labels.some(x => x.toLowerCase() === l.toLowerCase())
  const full = draft.labels.length >= MAX_LABELS

  const addCustom = () => {
    const t = custom.trim()
    if (!t) return
    set('labels', toggleLabel(draft.labels.filter(l => l.toLowerCase() !== t.toLowerCase()), t))
    setCustom('')
  }

  const save = async () => {
    if (lock.current || !dirty || hoursBad || timeNeedsDate) return
    lock.current = true; setBusy(true); setProblem(''); setSaid(''); onBusy?.(true)
    try {
      const res = await fetch('/api/jobflow', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: jobId, base_version: saved.version, patch }),
      })
      const d = await res.json().catch(() => ({})) as Record<string, unknown>
      if (d.flow && typeof d.flow === 'object') {
        const f = flowFrom(d.flow as Record<string, unknown>)
        if (res.ok && d.ok === true) {
          setBaseline(f); setDraft(draftFrom(f)); setSaid('Saved.'); onSaved(f)
        } else {
          // Somebody else saved first: show their copy and let the shop make the change again on top of it.
          setBaseline(f); setDraft(draftFrom(f)); onSaved(f)
          setProblem('Somebody else just changed this car. Their version is showing now. Make your change again.')
        }
        return
      }
      if (d.available === false) { setProblem('These board details need a database update before they can be saved.'); return }
      setProblem(typeof d.error === 'string' ? d.error : 'That did not save. Try again.')
    } catch {
      setProblem('No connection. Check your internet and try again.')
    } finally { lock.current = false; setBusy(false); onBusy?.(false) }
  }

  return (
    <form onSubmit={e => { e.preventDefault(); void save() }} noValidate>
      <fieldset disabled={busy} className="m-0 min-w-0 border-0 p-0">
        <legend className="form-label">Parts for this car</legend>
        <ul className="ledger" aria-label="Parts status">
          {PARTS_STATUSES.map((p: PartsStatus) => {
            const on = draft.parts === p
            return (
              <li key={p}>
                <button type="button" className="ledger-row" aria-pressed={on} onClick={() => set('parts', p)}>
                  <span className={`lamp ${LAMP[PARTS_TONE[p]]} shrink-0`} aria-hidden="true" />
                  <span className="ledger-main"><span className="ledger-title block">{PARTS_WORD[p]}</span></span>
                  {on && <Icon name="check" className="h-5 w-5 shrink-0 text-blue" strokeWidth={2.4} />}
                </button>
              </li>
            )
          })}
        </ul>
        <p className="form-hint">The customer sees the parts line on their status page while the car is set to Waiting on parts.</p>

        {usesParts && (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor={`fl-pn-${jobId}`} className="form-label">What is being waited on</label>
              <input id={`fl-pn-${jobId}`} className="form-input" maxLength={MAX_PARTS_NOTE} value={draft.parts_note} onChange={e => set('parts_note', e.target.value)} placeholder="Front brake pads and rotors" />
            </div>
            <div>
              <label htmlFor={`fl-pe-${jobId}`} className="form-label">Parts due</label>
              <input id={`fl-pe-${jobId}`} type="date" className="form-input" value={draft.parts_eta} onChange={e => set('parts_eta', e.target.value)} />
            </div>
          </div>
        )}

        <div className="mt-4">
          <p className="form-label" id={`fl-lb-${jobId}`}>Labels</p>
          <div className="flex flex-wrap gap-2" role="group" aria-labelledby={`fl-lb-${jobId}`}>
            {allLabels.map(l => {
              const on = onCar(l)
              return (
                <button
                  key={l}
                  type="button"
                  aria-pressed={on}
                  disabled={!on && full}
                  onClick={() => set('labels', toggleLabel(draft.labels, l))}
                  className={`inline-flex min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-full border px-4 text-[0.9375rem] font-bold transition-colors disabled:opacity-50 sm:min-h-[36px] ${on ? 'border-blue bg-blue/10 text-blue' : 'border-[rgb(var(--c-line))] bg-bg-card text-text-primary hover:bg-bg-hover'}`}
                >
                  {on && <Icon name="check" className="h-4 w-4" strokeWidth={2.4} />}{l}
                </button>
              )
            })}
          </div>
          <div className="mt-2 flex gap-2">
            <label htmlFor={`fl-cl-${jobId}`} className="sr-only">Add your own label</label>
            <input
              id={`fl-cl-${jobId}`} className="form-input min-w-0 flex-1" maxLength={MAX_LABEL} value={custom} placeholder="Add your own label"
              disabled={full}
              onChange={e => setCustom(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addCustom() } }}
            />
            <button type="button" className="btn btn-secondary" disabled={full || !custom.trim()} onClick={addCustom}>Add</button>
          </div>
          <p className="form-hint">{full ? `A car can have ${MAX_LABELS} labels. Take one off to add another.` : `Up to ${MAX_LABELS} labels. They show on the board card.`}</p>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor={`fl-h-${jobId}`} className="form-label">Hours of work expected</label>
            <input id={`fl-h-${jobId}`} className="form-input" inputMode="decimal" value={draft.est_hours} onChange={e => set('est_hours', e.target.value)} placeholder="2.5" aria-invalid={hoursBad ? true : undefined} aria-describedby={`fl-h-note-${jobId}`} />
            <p id={`fl-h-note-${jobId}`} className={hoursBad ? 'form-error' : 'form-hint'}>{hoursBad || 'Used for the hours on each technician’s column. Quarter hours.'}</p>
          </div>
          <div>
            <label htmlFor={`fl-t-${jobId}`} className="form-label">Promised time</label>
            <input id={`fl-t-${jobId}`} type="time" className="form-input" value={draft.promise_time} onChange={e => set('promise_time', e.target.value)} aria-describedby={`fl-t-note-${jobId}`} />
            <p id={`fl-t-note-${jobId}`} className={timeNeedsDate ? 'form-error' : 'form-hint'}>
              {timeNeedsDate ? 'A time needs a date. Set the promise date with Edit job first.'
                : promiseDate ? `On ${longDate(promiseDate)}.` : 'No promise date is set on this job yet. Set one with Edit job.'}
            </p>
          </div>
        </div>

        <div className="mt-4">
          <label htmlFor={`fl-n-${jobId}`} className="form-label">Note for the customer</label>
          <input id={`fl-n-${jobId}`} className="form-input" maxLength={MAX_PUBLIC_NOTE} value={draft.public_note} onChange={e => set('public_note', e.target.value)} placeholder="We will text you when the parts arrive." />
          <p className="form-hint">One line, shown on their status page. No prices or private notes.</p>
        </div>
      </fieldset>

      {problem && <p role="alert" className="form-error">{problem}</p>}
      {said && !dirty && <p role="status" className="mt-2 flex items-center gap-2 text-[0.9375rem] text-green"><Icon name="check" className="h-5 w-5 shrink-0" />{said}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-secondary" disabled={busy || !dirty} onClick={() => { setDraft(draftFrom(baseline)); setSaid(''); setProblem('') }}>Discard</button>
        <button type="submit" className="btn btn-primary" disabled={busy || !dirty || Boolean(hoursBad) || timeNeedsDate} aria-busy={busy}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
      {dirty && <p className="mt-1.5 flex items-center gap-2 text-[0.875rem] text-text-secondary"><span className="lamp lamp-amber !h-2.5 !w-2.5" aria-hidden="true" />Not saved yet</p>}
    </form>
  )
}
