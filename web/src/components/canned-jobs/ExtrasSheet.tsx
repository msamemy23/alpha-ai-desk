'use client'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import Sheet from '@/components/Sheet'
import { ErrorCard } from '@/components/ListKit'
import ConfirmSheet from '@/components/forms/ConfirmSheet'
import FormActions from '@/components/forms/FormActions'
import FormError from '@/components/forms/FormError'
import { Field, Section } from '@/components/forms/Field'
import { getExtras, saveExtras } from '@/components/documents/api'
import { EMPTY_EXTRAS, normalizeExtras } from '@/lib/canned-match'
import type { CannedExtras } from '@/lib/canned-match'
import {
  blankFee, blankPart, blankVersion, describeExtras, draftToExtras, extrasToDraft, parseList, partsToDrafts, sameExtrasDraft, versionHasErrors, versionSummary,
  MAX_FEES, MAX_VERSIONS,
} from '@/lib/canned-extras-editor'
import type { ExtrasDraft, FeeDraft, PartDraft, VersionDraft } from '@/lib/canned-extras-editor'
import { money } from './types'
import type { CannedJob } from './types'

type Load = 'loading' | 'ready' | 'error' | 'unavailable'
type Save = 'idle' | 'saving' | 'saved' | 'error'

const NEEDS_UPDATE = 'Versions, keywords and fees need a database update first. Ask whoever manages your account to apply it.'

/** Props that tie a box to its message, for a screen reader. */
const bad = (id: string, message: string | undefined) => (message ? { 'aria-invalid': true as const, 'aria-describedby': `${id}-err` } : {})

/**
 * The extra details of one canned job: versions for certain cars (their own hours, flat labor price or parts), keywords that help
 * the search find the job, and extra fees that come with it. The Add a canned job sheet on an estimate already uses what is saved
 * here. It opens from the canned job's own form. Saving writes these details only (never the job's name, hours, rate or parts), and
 * starts from a fresh read so the details this screen has no box for are kept exactly as stored.
 */
export default function ExtrasSheet({ job, onBack }: { job: CannedJob; onBack: () => void }) {
  const [load, setLoad] = useState<Load>('loading')
  const [loadError, setLoadError] = useState('')
  const [base, setBase] = useState<CannedExtras>(EMPTY_EXTRAS)
  const [draft, setDraft] = useState<ExtrasDraft | null>(null)
  const [saved, setSaved] = useState<ExtrasDraft | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [save, setSave] = useState<Save>('idle')
  const [saveError, setSaveError] = useState('')
  const [showErrors, setShowErrors] = useState(false)
  const [leaving, setLeaving] = useState(false)

  const read = useCallback(async () => {
    setLoad('loading'); setLoadError('')
    const r = await getExtras()
    if (r.needsUpdate) { setLoad('unavailable'); return }
    if (!r.ok) { setLoadError(r.error || 'The details for this job did not load.'); setLoad('error'); return }
    if (r.data.available === false) { setLoad('unavailable'); return }
    const stored = normalizeExtras(r.data.extras?.[job.id])
    const d = extrasToDraft(stored)
    setBase(stored); setDraft(d); setSaved(d); setSave('idle'); setShowErrors(false); setOpen(null)
    setLoad('ready')
  }, [job.id])

  useEffect(() => { void read() }, [read])

  const dirty = !!draft && !!saved && !sameExtrasDraft(draft, saved)
  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const result = useMemo(() => (draft ? draftToExtras(draft, base) : null), [draft, base])

  const update = (fn: (d: ExtrasDraft) => ExtrasDraft) => { setDraft(d => (d ? fn(d) : d)); setSave(s => (s === 'saved' ? 'idle' : s)) }
  const changeVersion = (id: string, patch: Partial<VersionDraft>) => update(d => ({ ...d, versions: d.versions.map(v => (v.id === id ? { ...v, ...patch } : v)) }))
  const changePart = (id: string, key: string, patch: Partial<PartDraft>) =>
    update(d => ({ ...d, versions: d.versions.map(v => (v.id === id ? { ...v, parts: v.parts.map(p => (p.key === key ? { ...p, ...patch } : p)) } : v)) }))
  const changeFee = (key: string, patch: Partial<FeeDraft>) => update(d => ({ ...d, fees: d.fees.map(f => (f.key === key ? { ...f, ...patch } : f)) }))

  const addVersion = () => {
    const v = blankVersion()
    update(d => ({ ...d, versions: [...d.versions, v] }))
    setOpen(v.id)
    requestAnimationFrame(() => document.getElementById(`ce-v-${v.id}-label`)?.focus())
  }
  const addPart = (id: string) => {
    const p = blankPart()
    update(d => ({ ...d, versions: d.versions.map(v => (v.id === id ? { ...v, parts: [...v.parts, p] } : v)) }))
    requestAnimationFrame(() => document.getElementById(`ce-p-${p.key}-name`)?.focus())
  }
  const addFee = () => {
    const f = blankFee()
    update(d => ({ ...d, fees: [...d.fees, f] }))
    requestAnimationFrame(() => document.getElementById(`ce-f-${f.key}-name`)?.focus())
  }
  /** Turning on parts of their own starts from the job's parts, so only what differs for this car has to be changed. */
  const setOwnParts = (v: VersionDraft, on: boolean) => changeVersion(v.id, on ? { ownParts: true, parts: v.parts.length > 0 ? v.parts : partsToDrafts(job.parts) } : { ownParts: false })

  const requestBack = () => { if (save === 'saving') return; if (dirty) setLeaving(true); else onBack() }

  const doSave = async () => {
    if (!draft || !result || save === 'saving') return
    if (!result.ok) {
      setShowErrors(true)
      const firstBad = draft.versions.find(v => versionHasErrors(result.errors.versions[v.id]))
      if (firstBad) setOpen(firstBad.id)
      window.setTimeout(() => (document.querySelector('[aria-invalid="true"], .form-error') as HTMLElement | null)?.scrollIntoView({ block: 'center' }), 80)
      return
    }
    setSave('saving'); setSaveError('')
    // Read the stored details again just before saving, so the parts of them this screen has no box for are carried over as they
    // are now, and a read that fails stops the save instead of writing over anything.
    const fresh = await getExtras()
    if (!fresh.ok || fresh.data.available === false) {
      setSave('error'); setSaveError('The details stored for this job could not be checked, so nothing was saved. Try again.')
      return
    }
    const current = normalizeExtras(fresh.data.extras?.[job.id])
    const checked = draftToExtras(draft, current)
    const r = await saveExtras(job.id, checked.extras)
    if (!r.ok) { setSave('error'); setSaveError(r.needsUpdate ? NEEDS_UPDATE : r.error); return }
    const stored = normalizeExtras(r.data.extras ?? checked.extras)
    const d = extrasToDraft(stored)
    setBase(stored); setDraft(d); setSaved(d); setSave('saved'); setShowErrors(false)
  }

  const title = 'Versions, keywords and fees'
  const rate = Number(job.labor_rate) > 0 ? ` at ${money(Number(job.labor_rate))} an hour` : ''
  const jobLine = `${job.name}: ${Number(job.labor_hours) || 0} h${rate}, ${Array.isArray(job.parts) ? job.parts.length : 0} ${Array.isArray(job.parts) && job.parts.length === 1 ? 'part' : 'parts'}, ${money(job.total_price)} before tax.`

  const backButton = <button type="button" className="btn btn-secondary" onClick={onBack}>Back to the job</button>
  let body: React.ReactNode

  if (load === 'loading') {
    body = <div className="space-y-2" aria-busy="true" aria-label="Loading versions, keywords and fees">{[0, 1, 2].map(i => <div key={i} className="skeleton h-[3.75rem]" />)}</div>
  } else if (load === 'error') {
    body = (
      <div className="space-y-3">
        <ErrorCard title="The details for this job did not load" message={loadError || 'Check your connection and try again. Nothing was changed.'} onRetry={() => void read()} />
        {backButton}
      </div>
    )
  } else if (load === 'unavailable') {
    body = (
      <div className="space-y-3">
        <Notice kind="info"><p className="font-bold">Versions, keywords and fees need a database update first.</p><p>Ask whoever manages your account to apply it. Your canned jobs are not affected.</p></Notice>
        {backButton}
      </div>
    )
  } else if (draft && result && saved) {
    const shown = showErrors ? result.errors : { versions: {}, fees: {} } as typeof result.errors
    const keywords = parseList(draft.keywords)
    body = (
      <form className="space-y-5" noValidate onSubmit={e => { e.preventDefault(); void doSave() }}>
        <p className="text-[0.9375rem] text-text-secondary">{jobLine} These details sit beside the job. Saving them never changes its name, hours, rate or parts.</p>

        <Section title="Versions for certain cars" action={<span className="num text-[0.875rem] text-text-secondary">{draft.versions.length}</span>}>
          <p className="mb-3 text-[0.875rem] text-text-secondary">On an estimate, Add a canned job picks the version that fits the car. Leave hours, flat price or parts empty to keep the job’s own.</p>
          {draft.versions.length === 0 && <p className="rounded-md border border-dashed border-border px-4 py-5 text-center text-[0.9375rem] text-text-secondary">No versions yet. Add one when this job takes different time or parts on a certain car, like a longer brake job on a truck.</p>}
          <ul className="space-y-3">
            {draft.versions.map(v => {
              const ve = shown.versions[v.id]
              const problem = versionHasErrors(ve)
              const isOpen = open === v.id || problem
              const idp = `ce-v-${v.id}`
              return (
                <li key={v.id} className="rounded-md border border-border">
                  <button type="button" className="flex min-h-[56px] w-full items-center gap-3 px-3 py-2 text-left" aria-expanded={isOpen} aria-controls={`${idp}-body`} onClick={() => setOpen(isOpen ? null : v.id)}>
                    <span className="min-w-0 flex-1">
                      <span className="block break-words font-bold">{v.label.trim() || 'New version'}</span>
                      <span className="block break-words text-[0.875rem] text-text-secondary">{versionSummary(v)}</span>
                      {problem && <span className="mt-0.5 flex items-center gap-1.5 text-[0.875rem] font-bold text-red"><span className="lamp lamp-red" aria-hidden="true" />Needs a change</span>}
                    </span>
                    <Icon name={isOpen ? 'chevronDown' : 'chevronRight'} className="h-4 w-4 shrink-0 text-text-muted" />
                  </button>
                  {isOpen && (
                    <div id={`${idp}-body`} className="space-y-4 border-t border-border p-3">
                      <Field id={`${idp}-label`} label="Version name" error={ve?.label}>
                        <input id={`${idp}-label`} className="form-input" autoComplete="off" value={v.label} placeholder="Toyota Camry 2012 to 2018" onChange={e => changeVersion(v.id, { label: e.target.value })} {...bad(`${idp}-label`, ve?.label)} />
                      </Field>

                      <fieldset>
                        <legend className="form-label">Cars this fits</legend>
                        <p className="mb-2 text-[0.875rem] text-text-secondary">Fill in at least one. Leave a box empty to match any. Separate several makes or models with commas.</p>
                        <div className="grid grid-cols-2 gap-3">
                          <Field id={`${idp}-makes`} label="Makes" error={ve?.makes} className="col-span-2 sm:col-span-1">
                            <input id={`${idp}-makes`} className="form-input" autoComplete="off" value={v.makes} placeholder="Toyota, Lexus" onChange={e => changeVersion(v.id, { makes: e.target.value })} {...bad(`${idp}-makes`, ve?.makes)} />
                          </Field>
                          <Field id={`${idp}-models`} label="Models" error={ve?.models} className="col-span-2 sm:col-span-1">
                            <input id={`${idp}-models`} className="form-input" autoComplete="off" value={v.models} placeholder="Camry, Avalon" onChange={e => changeVersion(v.id, { models: e.target.value })} {...bad(`${idp}-models`, ve?.models)} />
                          </Field>
                          <Field id={`${idp}-from`} label="First year" error={ve?.yearFrom}>
                            <input id={`${idp}-from`} className="form-input num" inputMode="numeric" autoComplete="off" value={v.yearFrom} placeholder="2012" onChange={e => changeVersion(v.id, { yearFrom: e.target.value })} {...bad(`${idp}-from`, ve?.yearFrom)} />
                          </Field>
                          <Field id={`${idp}-to`} label="Last year" error={ve?.yearTo}>
                            <input id={`${idp}-to`} className="form-input num" inputMode="numeric" autoComplete="off" value={v.yearTo} placeholder="2018" onChange={e => changeVersion(v.id, { yearTo: e.target.value })} {...bad(`${idp}-to`, ve?.yearTo)} />
                          </Field>
                        </div>
                        {ve?.fit && <p className="form-error">{ve.fit}</p>}
                      </fieldset>

                      <fieldset>
                        <legend className="form-label">Labor for these cars</legend>
                        <div className="grid grid-cols-2 gap-3">
                          <Field id={`${idp}-hours`} label="Hours" error={ve?.hours} hint={`Empty uses ${Number(job.labor_hours) || 0} h.`}>
                            <input id={`${idp}-hours`} className="form-input num" inputMode="decimal" autoComplete="off" value={v.hours} placeholder={String(Number(job.labor_hours) || 0)} onChange={e => changeVersion(v.id, { hours: e.target.value })} {...bad(`${idp}-hours`, ve?.hours)} />
                          </Field>
                          <Field id={`${idp}-price`} label="Flat price ($)" error={ve?.laborPrice} hint="Empty charges hours times the rate.">
                            <input id={`${idp}-price`} className="form-input num" inputMode="decimal" autoComplete="off" value={v.laborPrice} placeholder="0.00" onChange={e => changeVersion(v.id, { laborPrice: e.target.value })} {...bad(`${idp}-price`, ve?.laborPrice)} />
                          </Field>
                        </div>
                        <p className="mt-2 text-[0.875rem] text-text-secondary">A flat price replaces hours times the rate.</p>
                      </fieldset>

                      <fieldset>
                        <legend className="form-label">Parts for these cars</legend>
                        <label className="flex min-h-[44px] cursor-pointer items-center gap-2.5 text-[0.9375rem]">
                          <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--c-blue))]" checked={v.ownParts} onChange={e => setOwnParts(v, e.target.checked)} />
                          Use different parts for these cars
                        </label>
                        {!v.ownParts ? (
                          <p className="text-[0.875rem] text-text-secondary">These cars get the job’s own parts.</p>
                        ) : (
                          <div className="mt-2">
                            <p className="mb-2 text-[0.875rem] text-text-secondary">These replace the job’s parts for these cars. It starts with the job’s parts. Price each is what the customer is charged. With no parts here, the job adds labor only.</p>
                            {ve?.partsLimit && <p className="form-error">{ve.partsLimit}</p>}
                            <ul className="space-y-3">
                              {v.parts.map((p, i) => {
                                const pe = ve?.parts[p.key]
                                const pid = `ce-p-${p.key}`
                                return (
                                  <li key={p.key} className="rounded-md border border-border bg-bg-base p-3">
                                    <div className="grid grid-cols-2 gap-3">
                                      <Field id={`${pid}-name`} label="Part name" error={pe?.name} className="col-span-2">
                                        <input id={`${pid}-name`} className="form-input" autoComplete="off" value={p.name} onChange={e => changePart(v.id, p.key, { name: e.target.value })} {...bad(`${pid}-name`, pe?.name)} />
                                      </Field>
                                      <Field id={`${pid}-num`} label="Part number" className="col-span-2">
                                        <input id={`${pid}-num`} className="form-input" autoComplete="off" autoCapitalize="characters" value={p.part_number} onChange={e => changePart(v.id, p.key, { part_number: e.target.value })} />
                                      </Field>
                                      <Field id={`${pid}-cost`} label="Price each ($)" error={pe?.cost}>
                                        <input id={`${pid}-cost`} className="form-input num" inputMode="decimal" autoComplete="off" placeholder="0.00" value={p.cost} onChange={e => changePart(v.id, p.key, { cost: e.target.value })} {...bad(`${pid}-cost`, pe?.cost)} />
                                      </Field>
                                      <Field id={`${pid}-qty`} label="Qty" error={pe?.qty}>
                                        <input id={`${pid}-qty`} className="form-input num" inputMode="numeric" autoComplete="off" value={p.qty} onChange={e => changePart(v.id, p.key, { qty: e.target.value })} {...bad(`${pid}-qty`, pe?.qty)} />
                                      </Field>
                                    </div>
                                    <div className="mt-2 flex justify-end">
                                      <button type="button" className="btn btn-ghost !text-red" onClick={() => update(d => ({ ...d, versions: d.versions.map(x => (x.id === v.id ? { ...x, parts: x.parts.filter(y => y.key !== p.key) } : x)) }))} aria-label={`Remove part ${p.name.trim() || i + 1} from ${v.label.trim() || 'this version'}`}>
                                        <Icon name="trash" className="h-5 w-5" />Remove
                                      </button>
                                    </div>
                                  </li>
                                )
                              })}
                            </ul>
                            <button type="button" className="btn btn-secondary mt-3" onClick={() => addPart(v.id)}><Icon name="plus" className="h-5 w-5" />Add a part</button>
                          </div>
                        )}
                      </fieldset>

                      <div className="flex justify-end">
                        <button type="button" className="btn btn-ghost !text-red" onClick={() => { update(d => ({ ...d, versions: d.versions.filter(x => x.id !== v.id) })); setOpen(null) }} aria-label={`Remove version ${v.label.trim() || 'this version'}`}>
                          <Icon name="trash" className="h-5 w-5" />Remove this version
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
          {draft.versions.length < MAX_VERSIONS && (
            <button type="button" className="btn btn-secondary mt-3 w-full justify-center sm:w-auto" onClick={addVersion}><Icon name="plus" className="h-5 w-5" />Add a version</button>
          )}
        </Section>

        <Section title="Keywords">
          <Field id="ce-keywords" label="Words that point to this job" error={shown.keywords} hint="They help the search on an estimate find this job, and match it to inspection findings. Separate with commas.">
            <textarea id="ce-keywords" className="form-textarea" rows={2} value={draft.keywords} placeholder="brake pads, squeaky brakes, stopping noise" onChange={e => update(d => ({ ...d, keywords: e.target.value }))} {...bad('ce-keywords', shown.keywords)} />
          </Field>
          {keywords.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Keywords as saved">
              {keywords.map(k => <li key={k.toLowerCase()} className="tag tag-gray">{k}</li>)}
            </ul>
          ) : (
            <p className="mt-2 text-[0.875rem] text-text-secondary">No keywords yet. The search still finds this job by its name, category and description.</p>
          )}
        </Section>

        <Section title="Extra fees" action={<span className="num text-[0.875rem] text-text-secondary">{draft.fees.length}</span>}>
          <p className="mb-3 text-[0.875rem] text-text-secondary">Added to the estimate with this job, like a disposal fee. The customer sees each one as its own line.</p>
          {draft.fees.length === 0 && <p className="rounded-md border border-dashed border-border px-4 py-5 text-center text-[0.9375rem] text-text-secondary">No extra fees. Add one if this job always comes with a charge, like Tire disposal for $5.00.</p>}
          <ul className="space-y-3">
            {draft.fees.map((f, i) => {
              const fe = shown.fees[f.key]
              const fid = `ce-f-${f.key}`
              return (
                <li key={f.key} className="rounded-md border border-border p-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field id={`${fid}-name`} label="What it is for" error={fe?.name} className="col-span-2">
                      <input id={`${fid}-name`} className="form-input" autoComplete="off" value={f.name} placeholder="Tire disposal" onChange={e => changeFee(f.key, { name: e.target.value })} {...bad(`${fid}-name`, fe?.name)} />
                    </Field>
                    <Field id={`${fid}-amount`} label="Amount ($)" error={fe?.amount}>
                      <input id={`${fid}-amount`} className="form-input num" inputMode="decimal" autoComplete="off" placeholder="0.00" value={f.amount} onChange={e => changeFee(f.key, { amount: e.target.value })} {...bad(`${fid}-amount`, fe?.amount)} />
                    </Field>
                    <Field id={`${fid}-kind`} label="Kind of charge">
                      <select id={`${fid}-kind`} className="form-select" value={f.kind} onChange={e => changeFee(f.key, { kind: e.target.value === 'sublet' ? 'sublet' : 'fee' })}>
                        <option value="fee">Shop fee</option>
                        <option value="sublet">Outside work</option>
                      </select>
                    </Field>
                    <label className="col-span-2 flex min-h-[44px] cursor-pointer items-center gap-2.5 text-[0.9375rem]">
                      <input type="checkbox" className="h-5 w-5 accent-[rgb(var(--c-blue))]" checked={f.taxable} onChange={e => changeFee(f.key, { taxable: e.target.checked })} />
                      Charge sales tax on this
                    </label>
                  </div>
                  <div className="mt-2 flex justify-end">
                    <button type="button" className="btn btn-ghost !text-red" onClick={() => update(d => ({ ...d, fees: d.fees.filter(x => x.key !== f.key) }))} aria-label={`Remove fee ${f.name.trim() || i + 1}`}>
                      <Icon name="trash" className="h-5 w-5" />Remove
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
          {draft.fees.length < MAX_FEES && (
            <button type="button" className="btn btn-secondary mt-3 w-full justify-center sm:w-auto" onClick={addFee}><Icon name="plus" className="h-5 w-5" />Add a fee</button>
          )}
        </Section>

        {showErrors && result.problem && <FormError>{result.problem}</FormError>}
        {showErrors && !result.ok && !result.problem && <FormError>Some boxes need a change. They are marked in red.</FormError>}

        <FormActions>
          <div className="w-full text-[0.9375rem]" aria-live="polite">
            {save === 'error' ? (
              <p role="alert" className="flex items-start gap-2"><span className="lamp lamp-red mt-1" aria-hidden="true" /><span><strong>Not saved.</strong> {saveError}</span></p>
            ) : save === 'saving' ? (
              <p className="flex items-center gap-2"><span className="lamp lamp-blue" aria-hidden="true" />Saving…</p>
            ) : dirty ? (
              <p className="flex items-center gap-2"><span className="lamp lamp-amber" aria-hidden="true" /><strong>Unsaved changes</strong></p>
            ) : save === 'saved' ? (
              <p className="flex items-center gap-2"><span className="lamp lamp-green" aria-hidden="true" />Saved: {describeExtras(base)}</p>
            ) : (
              <p className="flex items-center gap-2 text-text-secondary"><span className="lamp lamp-off" aria-hidden="true" />{describeExtras(base)}</p>
            )}
          </div>
          <button type="submit" className="btn btn-primary" disabled={save === 'saving' || (!dirty && save !== 'error')} aria-busy={save === 'saving'}>
            {save === 'saving' ? 'Saving…' : 'Save details'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={requestBack} disabled={save === 'saving'}>Back to the job</button>
        </FormActions>
      </form>
    )
  }

  return (
    <>
      <Sheet open={!leaving} onClose={requestBack} title={title} wide dirty={dirty}>
        {body}
      </Sheet>
      <ConfirmSheet
        open={leaving}
        title="Discard your changes?"
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onConfirm={onBack}
        onCancel={() => setLeaving(false)}
      >
        <p>You typed changes to the versions, keywords or fees that are not saved yet. If you go back now they are lost.</p>
      </ConfirmSheet>
    </>
  )
}
