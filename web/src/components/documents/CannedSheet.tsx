'use client'
import { useMemo, useState } from 'react'
import { formatCurrency } from '@/lib/supabase'
import { getLaborFlatAmount, quantityFromUnknown } from '@/lib/document-money'
import { EMPTY_EXTRAS, buildJobLines, jobsForVehicle, matchFinding, searchScore, vehicleOf } from '@/lib/canned-match'
import type { BuiltJob, CannedExtras, Variant } from '@/lib/canned-match'
import Icon from '@/components/Icon'
import { Field } from './LineCards'
import { ErrorMsg } from './Dialogs'
import type { CannedJob } from './types'

const money = (n: number) => formatCurrency(n)

/** Short words for what a built job will put on the document. */
function describe(b: BuiltJob): { text: string; amount: number }[] {
  const out: { text: string; amount: number }[] = []
  for (const l of b.labors) {
    const flat = getLaborFlatAmount(l)
    const amount = flat ?? Math.round(Number(l.hours) * Number(l.rate) * 100) / 100
    out.push({ text: flat !== null ? `${String(l.operation)} (flat price)` : `${String(l.operation)}, ${Number(l.hours)} h at ${money(Number(l.rate))}`, amount })
  }
  for (const p of b.parts) {
    const qty = quantityFromUnknown(p.qty)
    out.push({ text: `${qty > 1 ? `${qty} x ` : ''}${String(p.name)}${p.kind === 'fee' ? ' (fee)' : p.kind === 'sublet' ? ' (outside work)' : ''}`, amount: Math.round(qty * Number(p.unitPrice) * 100) / 100 })
  }
  return out
}

/**
 * Pick a saved job to add. Jobs that fit the car on the document come first, the inspection's findings point at
 * matching jobs, and a search reaches everything. A job with versions for different cars adds the one that fits,
 * and you can switch before adding. What will be added is shown first, and nothing is added until you tap Add.
 */
export default function CannedSheet({ jobs, error, extras, extrasAvailable, doc, shopRate, techRate, findings, existingJobs, onAdd, onRetry, onClose }: {
  jobs: CannedJob[] | null
  error: string
  extras: Record<string, CannedExtras>
  extrasAvailable: boolean
  doc: Record<string, unknown>
  shopRate: number
  /** Optional hourly rate override, for example the rate for the work type. */
  techRate?: number | null
  /** Text of the inspection findings the customer needs work on, when this estimate came from an inspection. */
  findings?: string[]
  existingJobs: string[]
  onAdd: (built: BuiltJob, label: string) => void
  onRetry: () => void
  onClose: () => void
}) {
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<CannedJob | null>(null)
  const [variantId, setVariantId] = useState<string>('auto')
  const [jobName, setJobName] = useState('')
  const vehicle = useMemo(() => vehicleOf(doc), [doc])
  const hasCar = !!(vehicle.make || vehicle.model || vehicle.year)
  const carWords = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ')

  const fits = useMemo(() => (jobs ? jobsForVehicle(jobs, extras, vehicle) : []), [jobs, extras, vehicle])
  const fitIds = useMemo(() => new Set(fits.map(f => f.job.id)), [fits])
  const suggested = useMemo(() => {
    if (!jobs || !findings?.length) return [] as { finding: string; job: CannedJob }[]
    const seen = new Set<string>()
    const out: { finding: string; job: CannedJob }[] = []
    for (const f of findings) {
      const job = matchFinding(f, jobs, extras)
      if (job && !seen.has(job.id)) { seen.add(job.id); out.push({ finding: f, job }) }
    }
    return out
  }, [jobs, findings, extras])

  const matches = useMemo(() => {
    if (!jobs) return []
    const q = query.trim()
    return jobs
      .map(j => ({ j, s: searchScore(j, extras[j.id] || EMPTY_EXTRAS, q) }))
      .filter(x => x.s > 0)
      .sort((a, b) => b.s - a.s || a.j.name.localeCompare(b.j.name))
      .map(x => x.j)
  }, [jobs, extras, query])

  const pick = (j: CannedJob) => { setPicked(j); setVariantId('auto'); setJobName(j.name) }

  const ex = picked ? (extras[picked.id] || EMPTY_EXTRAS) : EMPTY_EXTRAS
  const chosenVariant: Variant | null | undefined = variantId === 'auto' ? undefined : variantId === 'none' ? null : ex.variants.find(v => v.id === variantId) ?? null
  const built = useMemo(() => (picked
    ? buildJobLines(picked, ex, { vehicle, shopRate, rateOverride: techRate ?? null, jobName, variant: chosenVariant })
    : null), [picked, ex, vehicle, shopRate, techRate, jobName, chosenVariant])

  /* ---------- detail ---------- */
  if (picked && built) {
    const lines = describe(built)
    const dupe = existingJobs.some(n => n.toLowerCase() === jobName.trim().toLowerCase())
    const autoLabel = built.variantLabel
    return (
      <div>
        <button type="button" className="btn btn-ghost btn-sm -ml-2 mb-2" onClick={() => setPicked(null)}>
          <Icon name="chevronLeft" className="h-4 w-4" />
          All jobs
        </button>
        <h3 className="display text-[1.125rem] font-bold">{picked.name}</h3>
        {picked.description && <p className="mt-0.5 text-[0.9375rem] text-text-secondary">{picked.description}</p>}

        {ex.variants.length > 0 && (
          <div className="mt-4">
            <Field id="cj-variant" label="Version for this car" hint={hasCar ? `The car on this document is ${carWords || 'not filled in'}.` : 'Fill in the car on the document and the right version is picked for you.'}>
              <select id="cj-variant" className="form-select" value={variantId} onChange={e => setVariantId(e.target.value)}>
                <option value="auto">{autoLabel ? `Best match: ${autoLabel}` : 'Standard version'}</option>
                <option value="none">Standard version</option>
                {ex.variants.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
              </select>
            </Field>
          </div>
        )}

        <div className="mt-4">
          <Field id="cj-job" label="Job name on the estimate" hint="The customer can approve or decline each job by itself.">
            <input id="cj-job" className="form-input" value={jobName} maxLength={80} onChange={e => setJobName(e.target.value)} />
          </Field>
          {dupe && <p className="form-hint !text-amber">A job with this name is already on the document. The new lines join it.</p>}
        </div>

        <section className="mt-4" aria-labelledby="cj-adds">
          <h4 id="cj-adds" className="text-[0.9375rem] font-bold">This adds</h4>
          {lines.length === 0 ? (
            <p className="mt-1 text-[0.9375rem] text-text-secondary">Nothing yet. This job has no hours or parts saved. Add them in Canned jobs.</p>
          ) : (
            <ul className="ledger mt-1">
              {lines.map((l, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 py-2 text-[0.9375rem]">
                  <span className="min-w-0 break-words">{l.text}</span>
                  <span className="num shrink-0 font-bold">{money(l.amount)}</span>
                </li>
              ))}
              <li className="flex items-baseline justify-between gap-3 py-2 text-[0.9375rem]">
                <span className="font-bold">Job total, before tax</span>
                <span className="num shrink-0 font-bold">{money(built.total)}</span>
              </li>
            </ul>
          )}
          {ex.note && <p className="mt-2 text-[0.875rem] text-text-secondary">Note for the customer: {ex.note}</p>}
        </section>

        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={() => setPicked(null)}>Back</button>
          <button type="button" className="btn btn-primary" disabled={lines.length === 0} onClick={() => onAdd(built, picked.name)}>
            <Icon name="plus" className="h-5 w-5" />
            Add to the estimate
          </button>
        </div>
      </div>
    )
  }

  /* ---------- list ---------- */
  if (error) {
    return (
      <div>
        <ErrorMsg>{error}</ErrorMsg>
        <button type="button" className="btn btn-secondary mt-3" onClick={onRetry}>Try again</button>
      </div>
    )
  }
  if (jobs === null) return <div className="space-y-2" aria-busy="true" aria-label="Loading canned jobs">{[0, 1, 2, 3].map(i => <div key={i} className="skeleton h-14" />)}</div>
  if (jobs.length === 0) {
    return (
      <p className="py-6 text-center text-[0.9375rem] text-text-secondary">
        No canned jobs yet. Save the jobs you quote often, like a brake job or an oil change, in <a className="text-blue underline" href="/canned-jobs">Canned jobs</a>, and add them here in one tap.
      </p>
    )
  }

  const row = (j: CannedJob, note?: string) => {
    const n = Array.isArray(j.parts) ? j.parts.length : 0
    const e = extras[j.id]
    const variant = hasCar && e ? jobsForVehicle([j], extras, vehicle)[0]?.variant : null
    return (
      <li key={j.id}>
        <button type="button" className="ledger-row" onClick={() => pick(j)}>
          <span className="ledger-main">
            <span className="ledger-title block">{j.name}</span>
            <span className="ledger-sub block">{[note, variant?.label, j.category, `${Number(j.labor_hours) || 0} h labor`, n > 0 ? `${n} ${n === 1 ? 'part' : 'parts'}` : ''].filter(Boolean).join(' · ')}</span>
          </span>
          <span className="ledger-amt">{Number(j.total_price) > 0 ? money(Number(j.total_price)) : ''}</span>
        </button>
      </li>
    )
  }

  const q = query.trim()
  return (
    <div>
      <input type="search" className="form-input" placeholder="Search canned jobs" aria-label="Search canned jobs" value={query} onChange={e => setQuery(e.target.value)} />
      {!extrasAvailable && <p className="mt-2 text-[0.8125rem] text-text-secondary">Per-car versions and keywords need a database update. Jobs still add as saved.</p>}
      <div className="mt-3 max-h-[52dvh] overflow-y-auto overscroll-contain">
        {!q && suggested.length > 0 && (
          <section aria-labelledby="cj-insp">
            <h3 id="cj-insp" className="mb-1 text-[0.875rem] font-bold text-text-secondary">From the inspection</h3>
            <ul className="ledger mb-4">{suggested.map(s => row(s.job, `Matches “${s.finding}”`))}</ul>
          </section>
        )}
        {!q && fits.length > 0 && (
          <section aria-labelledby="cj-fits">
            <h3 id="cj-fits" className="mb-1 text-[0.875rem] font-bold text-text-secondary">Fits {carWords}</h3>
            <ul className="ledger mb-4">{fits.map(f => row(f.job))}</ul>
          </section>
        )}
        {matches.length === 0 ? (
          <p className="py-6 text-center text-[0.9375rem] text-text-secondary">No canned job matches “{q}”.</p>
        ) : (
          <section aria-labelledby="cj-all">
            {!q && (fits.length > 0 || suggested.length > 0) && <h3 id="cj-all" className="mb-1 text-[0.875rem] font-bold text-text-secondary">All jobs</h3>}
            <ul className="ledger">{matches.filter(j => q || !fitIds.has(j.id)).map(j => row(j))}</ul>
          </section>
        )}
      </div>
      <div className="mt-4 flex justify-end">
        <button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>
      </div>
    </div>
  )
}
