'use client'
import { useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import type { DviSection } from '@/lib/dvi'
import { changeSummary, compareVisits, lastVisitWords, visitFromSections } from '@/lib/dvi-history'
import type { Change, ChangeKind } from '@/lib/dvi-history'
import type { HistoryState } from './useHistory'

const KIND_WORD: Record<ChangeKind, string> = {
  worse: 'Got worse', new: 'New', declined: 'Customer said no', still: 'Still open', better: 'Better', fixed: 'Fixed',
}
const KIND_LAMP: Record<ChangeKind, string> = {
  worse: 'lamp-red', new: 'lamp-amber', declined: 'lamp-amber', still: 'lamp-amber', better: 'lamp-green', fixed: 'lamp-green',
}

const fmtDate = (iso: string) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'earlier' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/**
 * What changed on this car since it was last inspected here: lines that got worse, new problems, work the customer said no to
 * that is still open, and how fast the tires and brakes are wearing. Lines that were good and still are good stay out of the way.
 */
export default function HistoryPanel({ state, sections, id, createdAt, tech }: {
  state: HistoryState
  sections: DviSection[]
  id: string
  createdAt: string
  tech: string
}) {
  const [open, setOpen] = useState(false)
  const ready = state.status === 'ready' ? state : null
  const prior = ready?.priors[0] ?? null
  const miles = ready?.miles ?? null
  const changes: Change[] = useMemo(
    () => (prior ? compareVisits(prior, visitFromSections({ id, at: createdAt, tech, sections, miles })) : []),
    [prior, id, createdAt, tech, sections, miles],
  )

  if (state.status === 'loading') return <div className="skeleton mt-4 h-14" aria-label="Loading the history of this vehicle" />
  if (state.status === 'error') return null // the checklist works without it; the history is a bonus
  if (!prior) {
    return (
      <p className="mt-4 flex items-center gap-2 text-[0.875rem] text-text-secondary">
        <Icon name="clock" className="h-4 w-4 shrink-0" />No earlier inspection of this vehicle in your shop. This one becomes the starting point.
      </p>
    )
  }

  const summary = changeSummary(changes)
  const rated = sections.some(s => s.items.some(i => i.status))
  const headline = !rated ? 'Rate a few lines and the changes show here.' : summary ? `${summary}.` : 'Nothing has changed since then.'
  return (
    <section className="panel mt-4" aria-label="History of this vehicle">
      <button type="button" className="flex min-h-[56px] w-full items-center gap-3 px-4 py-3 text-left hover:bg-bg-hover" aria-expanded={open} onClick={() => setOpen(o => !o)}>
        <Icon name="clock" className="h-5 w-5 shrink-0 text-text-secondary" />
        <span className="min-w-0 flex-1">
          <span className="block font-bold leading-tight">Since the last visit</span>
          <span className="block text-[0.8125rem] text-text-secondary">{lastVisitWords(prior, fmtDate)}</span>
          <span className="block text-[0.9375rem]">{headline}</span>
        </span>
        <Icon name="chevronDown" className={`h-5 w-5 shrink-0 text-text-secondary transition-transform ${open ? '' : '-rotate-90'}`} />
      </button>
      {open && (
        <div className="border-t border-border">
          {changes.length === 0 ? (
            <p className="px-4 py-3 text-[0.9375rem] text-text-secondary">{rated ? 'Every line matches the last inspection, or is still good.' : 'Nothing to compare yet.'}</p>
          ) : (
            <ul className="divide-y divide-border">
              {changes.slice(0, 40).map((c, n) => (
                <li key={`${c.section}-${c.name}-${n}`} className="px-4 py-2.5">
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className={`lamp ${KIND_LAMP[c.kind]} !h-2.5 !w-2.5 shrink-0`} aria-hidden="true" />
                    <span className="font-bold">{c.name}</span>
                    <span className="text-[0.8125rem] font-bold text-text-secondary">{KIND_WORD[c.kind]}</span>
                  </p>
                  <p className="mt-0.5 text-[0.875rem] text-text-secondary">{c.words}</p>
                  {c.reading && (
                    <p className="num mt-0.5 text-[0.875rem]">{c.reading.before} before, {c.reading.now} now.{c.reading.wear ? ` ${c.reading.wear}` : ''}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
          {ready && ready.priors.length > 1 && (
            <p className="border-t border-border px-4 py-2 text-[0.8125rem] text-text-secondary">
              {ready.priors.length + ready.more} earlier inspections of this vehicle. Compared with the newest, {fmtDate(prior.at)}.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
