'use client'
import { useMemo } from 'react'
import Icon from '@/components/Icon'
import { ExternalLink, Facts, BulletList, Status } from './parts'
import { DiagramThumb } from './DiagramViewer'
import { Pill } from '@/components/ListKit'
import { plainLabel } from '@/lib/repair-ui'
import { formatCurrency } from '@/lib/supabase'
import type { MainTab } from './types'
import type { Repair } from './useRepair'

/** The first thing a mechanic needs: what it means, what to check, what not to assume, and where the diagram is. */
export default function AnswerTab({ r, goTab }: { r: Repair; goTab: (tab: MainTab) => void }) {
  const { result, repairView: v, manualPage } = r
  const diagramMatches = useMemo(
    () => (result?.manualMatches || []).filter(m => m.category === 'diagram' || m.matchType === 'diagram_or_spec' || /wiring|diagram|schematic|connector|pinout/i.test(m.title)),
    [result],
  )
  if (!result || !v) return null

  const images = manualPage?.images || []
  const checks = v.checks

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="min-w-0 space-y-5">
        {/* Diagram */}
        {images.length > 0 ? (
          <section className="card" aria-labelledby="ans-diagram">
            <h3 id="ans-diagram" className="section-title">Diagram from the manual</h3>
            <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {images.slice(0, 6).map(image => <li key={image.url}><DiagramThumb image={image} onOpen={r.setViewer} /></li>)}
            </ul>
            <p className="mt-2 text-[0.875rem] text-text-secondary">Tap a diagram to enlarge it. {manualPage?.title ? `From: ${manualPage.title}.` : ''}</p>
          </section>
        ) : r.manualLoading ? (
          <div role="status" aria-busy="true" aria-label="Loading the diagram from the manual">
            <div className="skeleton h-40" />
            <p className="mt-2 text-[0.875rem] text-text-secondary">Looking for a diagram in the manual…</p>
          </div>
        ) : diagramMatches.length > 0 ? (
          <section className="card" aria-labelledby="ans-diagram">
            <h3 id="ans-diagram" className="section-title">Diagram pages</h3>
            <p className="mt-1 text-text-secondary">These manual pages are likely to have a diagram. Open one to load it here.</p>
            <ul className="mt-3 space-y-2">
              {diagramMatches.slice(0, 4).map(match => (
                <li key={match.url}>
                  <button type="button" className="btn btn-secondary w-full justify-between text-left" onClick={() => void r.loadManual(match.url)} disabled={r.manualLoading}>
                    <span className="min-w-0 break-words">{match.title}</span>
                    <Icon name="chevronRight" className="h-5 w-5 shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
            {r.manualError && <p role="alert" className="mt-3 font-bold text-red">{r.manualError}</p>}
          </section>
        ) : r.manualError ? (
          <div role="alert" className="card flex items-start gap-3">
            <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0 text-red" />
            <div className="min-w-0 flex-1">
              <p className="font-bold">The manual page did not load</p>
              <p className="text-text-secondary">{/[.!?]$/.test(r.manualError.trim()) ? r.manualError.trim() : `${r.manualError.trim()}.`} The answer below is still good. Try again to get the diagram.</p>
              <button type="button" className="btn btn-secondary mt-3" onClick={r.retryManual}>Try again</button>
            </div>
          </div>
        ) : null}

        {/* The answer */}
        <section className="card" aria-labelledby="ans-title">
          <h3 id="ans-title" className="section-title text-[1.25rem]">{v.title}</h3>
          <p className="mt-2 max-w-3xl leading-relaxed text-text-secondary">{v.plainAnswer}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Pill>{v.vehicle}</Pill>
            {v.needsExactVehicle && <Pill lamp="amber">Engine needed for the exact diagram</Pill>}
          </div>
        </section>

        {/* Where to look */}
        <section className="card" aria-labelledby="ans-open">
          <h3 id="ans-open" className="section-title">{plainLabel(v.primaryActionLabel || (v.needsExactVehicle ? 'Pick Engine First' : 'Open The Info'))}</h3>
          {v.needsExactVehicle && <p className="mt-1 text-text-secondary">Pick the engine that matches the car. Alpha then finds the right pages for it.</p>}
          <ul className="mt-3 grid gap-3 md:grid-cols-2">
            {v.actionLinks.map(link => {
              const choice = v.vehicleChoices.find(item => item.url === link.url)
              if (link.confidence === 'manual_choice') {
                return (
                  <li key={`${link.kind}-${link.url}`} className="flex flex-col rounded-md border border-border bg-bg-base p-3">
                    <p className="font-bold leading-snug">{link.label}</p>
                    <p className="mt-1 flex-1 text-[0.9375rem] text-text-secondary">{link.detail}</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" className="btn btn-primary" onClick={() => void r.search(choice?.selectionQuery || `${r.query} ${link.label}`)} disabled={r.loading}>Use this engine</button>
                      <ExternalLink url={link.url}>Open source</ExternalLink>
                    </div>
                  </li>
                )
              }
              return (
                <li key={`${link.kind}-${link.url}`}>
                  <a
                    className="flex h-full items-start gap-3 rounded-md border border-border bg-bg-base p-3 transition-colors hover:border-blue hover:bg-bg-hover"
                    href={link.url} target="_blank" rel="noreferrer noopener"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold leading-snug">{plainLabel(link.label)}</span>
                      <span className="mt-1 block text-[0.9375rem] text-text-secondary">{link.detail}</span>
                      <span className="mt-2 block text-[0.875rem] font-bold text-text-secondary">{link.provider || 'Source link'}</span>
                    </span>
                    <Icon name="openExternal" className="mt-0.5 h-5 w-5 shrink-0 text-blue" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                </li>
              )
            })}
          </ul>
          {v.actionLinks.length === 0 && (
            <p className="mt-3 text-text-secondary">No exact page yet. Add the engine or VIN under Vehicle details at the top, search again, and Alpha will narrow this to the right page.</p>
          )}
        </section>

        {/* What to check */}
        {checks.length > 0 && (
          <section className="card" aria-labelledby="ans-check">
            <h3 id="ans-check" className="section-title">{plainLabel(v.checkHeading || 'What To Check First')}</h3>
            <ol className="mt-3 space-y-3">
              {checks.map((item, index) => (
                <li key={item} className="flex gap-3">
                  <span className="num grid h-7 w-7 shrink-0 place-items-center rounded-md bg-text-primary/[0.08] text-[0.875rem] font-bold" aria-hidden="true">{index + 1}</span>
                  <span className="min-w-0 pt-0.5 leading-snug"><span className="sr-only">Step {index + 1}: </span>{item}</span>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>

      <aside className="min-w-0 space-y-5" aria-label="Notes for the shop">
        <section className="rounded-lg border border-amber/60 bg-amber/[0.1] p-4" aria-labelledby="ans-dont">
          <h3 id="ans-dont" className="section-title flex items-center gap-2"><Icon name="alert" className="h-5 w-5 text-amber" />Do not assume</h3>
          <BulletList className="mt-3" items={v.dontAssume} />
        </section>

        <section className="rounded-lg border border-green/50 bg-green/[0.1] p-4" aria-labelledby="ans-next">
          <h3 id="ans-next" className="section-title flex items-center gap-2"><Icon name="check" className="h-5 w-5 text-green" />Next step in the shop</h3>
          <p className="mt-2 leading-snug">{v.action}</p>
          <button type="button" className="btn btn-primary mt-3 w-full" onClick={() => goTab('estimate')}>Create estimate</button>
        </section>

        <section className="card" aria-labelledby="ans-sum">
          <h3 id="ans-sum" className="section-title">Summary</h3>
          <div className="mt-3">
            <Facts rows={[
              { label: 'Problem', value: v.jobCard.problem },
              { label: 'Source', value: <Status lamp={v.jobCard.sourceState.startsWith('No useful') ? 'amber' : 'green'}>{v.jobCard.sourceState}</Status> },
              ...(v.showEstimateCard ? [{ label: 'Estimate', value: result.estimateDraft.totalLocked && result.estimateDraft.targetTotal ? formatCurrency(result.estimateDraft.targetTotal) : v.jobCard.estimateState }] : []),
            ]} />
          </div>
        </section>

        {v.askNext.length > 0 && (
          <section className="card" aria-labelledby="ans-ask">
            <h3 id="ans-ask" className="section-title">Ask Alpha next</h3>
            <p className="mt-1 text-[0.9375rem] text-text-secondary">Opens Ask Alpha with this car and your question.</p>
            <ul className="mt-3 flex flex-wrap gap-2">
              {v.askNext.map(item => (
                <li key={item}>
                  <button type="button" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-[rgb(var(--c-line))] bg-bg-card px-4 text-[0.9375rem] font-bold hover:bg-bg-hover sm:min-h-[38px]" onClick={() => r.openRepairAi(item)}>
                    <Icon name="alpha" className="h-4 w-4" />{item.charAt(0).toUpperCase() + item.slice(1)}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </aside>
    </div>
  )
}
