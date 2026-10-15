'use client'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { EmptyBlock, FilterChips, Pill } from '@/components/ListKit'
import { vehicleLabel } from '@/lib/repair-ui'
import { formatCurrency } from '@/lib/supabase'
import { BulletList, Block, Facts, Status } from './parts'
import { DiagramThumb } from './DiagramViewer'
import { WORKSPACE_SECTIONS, coverageRows, matchInfo, riskInfo, sourceStatusWord, stepInfo } from './types'
import type { Say, WorkspaceSection } from './types'
import type { Repair } from './useRepair'

const noticeKind = (s: Say) => (s.kind === 'success' ? 'success' : s.kind === 'warn' ? 'warn' : s.kind === 'info' ? 'info' : 'error')

function Overview({ r }: { r: Repair }) {
  const result = r.result!
  const risk = riskInfo(result.safetyProfile.level)
  const match = result.workflow.vehicleMatch
  const veh = result.normalizedVehicle
  const cov = result.coverageDashboard
  const flags: Array<[keyof typeof result.workflow.coverage, string]> = [
    ['hasManual', 'Repair manual found'],
    ['hasOfficialData', 'Official records found'],
    ['hasProcedureCandidate', 'Procedure page found'],
    ['hasExactProcedureMatch', 'Exact procedure match'],
    ['hasEstimateReadyDraft', 'Estimate draft ready'],
    ['hasShopProcedure', 'Your shop’s procedure on file'],
  ]
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Block title="Vehicle" id="ov-vehicle">
        <div className="mb-3 flex flex-wrap gap-2">
          <Pill lamp={match.confidence >= 70 ? 'green' : 'amber'}>{`${match.confidence}% vehicle match`}</Pill>
          <Pill lamp={risk.lamp}>{risk.word}</Pill>
        </div>
        <Facts rows={[
          { label: 'Vehicle', value: vehicleLabel(veh) },
          { label: 'Match', value: match.label },
          { label: 'VIN', value: <span className="num">{veh.vin || 'Not entered'}</span> },
          { label: 'Drive', value: veh.drivetrain || 'Not known' },
          { label: 'Transmission', value: veh.transmission || 'Not known' },
          { label: 'Brakes', value: veh.brakeSystem || 'Not known' },
        ]} />
        {match.missing.length > 0 && <p className="mt-3 text-[0.9375rem] text-text-secondary">Still needed for an exact match: {match.missing.join(', ')}.</p>}
      </Block>

      <Block title="What the lookup found" id="ov-cov">
        <ul className="space-y-2">
          {coverageRows(cov).map(row => (
            <li key={row.key} className="flex items-center justify-between gap-3">
              <span>{row.label}</span>
              <Status lamp={row.lamp}>{row.word}</Status>
            </li>
          ))}
        </ul>
        <p className="num mt-3 border-t border-border pt-3 text-[0.9375rem] text-text-secondary">
          {cov.indexedPages} pages and {cov.indexedLinks} links read. {cov.exactMatches} likely exact, {cov.likelyMatches} likely sections, {cov.diagrams} diagrams, {cov.specs} specs.
        </p>
      </Block>

      <Block title="Work items" id="ov-work" className="lg:col-span-2">
        {result.operationLines.length === 0 ? (
          <p className="text-text-secondary">No work items were found for this lookup.</p>
        ) : (
          <ul className="-mx-4 divide-y divide-border sm:-mx-5">
            {result.operationLines.map(line => {
              const lr = riskInfo(line.risk)
              return (
                <li key={line.id} className="flex items-start justify-between gap-4 px-4 py-3 sm:px-5">
                  <div className="min-w-0">
                    <p className="font-bold leading-snug">{line.label}</p>
                    <p className="text-[0.875rem] text-text-secondary">{line.system} · {sourceStatusWord(line.sourceStatus)}</p>
                    <Status lamp={lr.lamp} className="mt-1">{lr.word}</Status>
                  </div>
                  <p className="num shrink-0 font-bold">{typeof line.estimateAmount === 'number' ? formatCurrency(line.estimateAmount) : <span className="font-normal text-text-secondary">Needs price</span>}</p>
                </li>
              )
            })}
          </ul>
        )}
      </Block>

      <Block title="Steps to finish" id="ov-steps" className="lg:col-span-2">
        <ul className="grid gap-3 md:grid-cols-2">
          {result.workflow.steps.map(step => {
            const si = stepInfo(step.status)
            return (
              <li key={step.id} className="rounded-md border border-border bg-bg-base p-3">
                <p className="font-bold leading-snug">{step.label}</p>
                <Status lamp={si.lamp} className="mt-1">{si.word}</Status>
                <p className="mt-1.5 text-[0.9375rem] text-text-secondary">{step.detail}</p>
              </li>
            )
          })}
        </ul>
        <ul className="mt-4 grid gap-x-6 gap-y-2 border-t border-border pt-4 sm:grid-cols-2">
          {flags.map(([key, label]) => (
            <li key={key}><Status lamp={result.workflow.coverage[key] ? 'green' : 'off'}>{label}: {result.workflow.coverage[key] ? 'yes' : 'no'}</Status></li>
          ))}
        </ul>
      </Block>

      <Block title="Your shop’s procedures" id="ov-shop">
        {(result.shopProcedures || []).length === 0 ? (
          <p className="text-text-secondary">
            {cov.shopProcedure === 'needs_database'
              ? 'Shop procedure cards are not set up for this shop yet. Ask whoever manages your Alpha account to finish the repair workspace setup.'
              : 'Your shop has no procedure card for this vehicle and repair yet. Save one under Shop notes.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {(result.shopProcedures || []).map(card => (
              <li key={card.id} className="rounded-md border border-border bg-bg-base p-3">
                <p className="font-bold leading-snug">{card.title}</p>
                <Status lamp={card.status === 'verified' ? 'green' : 'amber'} className="mt-1">{card.status === 'verified' ? 'Verified by a technician' : 'Draft, not verified'}</Status>
              </li>
            ))}
          </ul>
        )}
      </Block>

      <Block title="Shop checklist" id="ov-draft">
        <Status lamp="amber">Technician verification required</Status>
        <p className="mt-2 font-bold leading-snug">{result.draft.title}</p>
        <BulletList className="mt-3" items={result.draft.checklist} />
        {result.draft.estimateNotes.length > 0 && (
          <>
            <h4 className="mt-4 font-bold">Estimate notes</h4>
            <BulletList className="mt-2" items={result.draft.estimateNotes} />
          </>
        )}
      </Block>

    </div>
  )
}

function Safety({ r }: { r: Repair }) {
  const { safetyProfile: sp, workflow } = r.result!
  const risk = riskInfo(sp.level)
  return (
    <div className="space-y-5">
      <section className="card" aria-labelledby="sf-level">
        <h3 id="sf-level" className="section-title">{risk.word}</h3>
        <Status lamp={risk.lamp} className="mt-1">{sp.technicianSignoffRequired ? 'A technician must sign off before work starts' : 'No sign-off required, but check the steps below'}</Status>
        <p className="mt-3 text-text-secondary">Systems involved: {sp.systems.join(', ') || 'general repair'}.</p>
      </section>
      {sp.gates.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2">
          {sp.gates.map(gate => (
            <li key={gate.id} className="card !p-4">
              <p className="font-bold leading-snug">{gate.label}</p>
              <Status lamp={gate.required ? 'amber' : 'off'} className="mt-1">{gate.required ? 'Required' : 'Recommended'}</Status>
              <p className="mt-2 leading-snug text-text-secondary">{gate.reason}</p>
            </li>
          ))}
        </ul>
      )}
      {workflow.safetyGates.length > 0 && (
        <Block title="Before work starts" id="sf-gates">
          <BulletList items={workflow.safetyGates} />
        </Block>
      )}
    </div>
  )
}

function Pages({ r }: { r: Repair }) {
  const matches = useMemo(() => (r.result?.manualMatches || []).filter(m => m.category !== 'diagram' && m.category !== 'spec'), [r.result])
  return (
    <div className="space-y-4">
      {r.manualPage && (
        <button type="button" className="btn btn-secondary w-full justify-between sm:w-auto" onClick={r.openReader}>
          <span className="min-w-0 truncate">Continue reading: {r.manualPage.title}</span>
          <Icon name="chevronRight" className="h-5 w-5 shrink-0" />
        </button>
      )}
      {matches.length === 0 ? (
        <EmptyBlock icon="manual" title="No page inside the manual matched yet">
          Preview a LEMON or CHARM source on the Sources tab, then browse its pages from there.
        </EmptyBlock>
      ) : (
        <ul className="panel divide-y divide-border">
          {matches.slice(0, 8).map(m => {
            const info = matchInfo(m.matchType)
            return (
              <li key={m.url} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="min-w-0">
                  <p className="font-bold leading-snug">{m.title}</p>
                  {m.path.length > 0 && <p className="text-[0.875rem] text-text-secondary">{m.path.join(' › ')}</p>}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3"><span className="text-[0.875rem] font-bold text-text-secondary">{m.provider}</span><Status lamp={info.lamp}>{info.word}</Status></div>
                </div>
                <button type="button" className="btn btn-secondary shrink-0" onClick={() => void r.loadManual(m.url, { open: true })}><Icon name="eye" className="h-4 w-4" />Preview</button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function Specs({ r }: { r: Repair }) {
  const specs = useMemo(() => (r.result?.manualMatches || []).filter(m => m.category === 'spec' || /torque|spec|capacity|fluid/i.test(m.title)), [r.result])
  return (
    <div className="space-y-4">
      <Notice kind="warn">Torque values, capacities and clearances must come from the source page. Check each one before you quote or start work.</Notice>
      {specs.length === 0 ? (
        <EmptyBlock icon="inspect" title="No spec page found yet">Open the source manuals from the Sources tab and look the specs up yourself.</EmptyBlock>
      ) : (
        <ul className="panel divide-y divide-border">
          {specs.map(m => {
            const info = matchInfo(m.matchType)
            return (
              <li key={m.url} className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <div className="min-w-0">
                  <p className="font-bold leading-snug">{m.title}</p>
                  {m.note && <p className="text-[0.9375rem] text-text-secondary">{m.note}</p>}
                  <Status lamp={info.lamp} className="mt-1">{info.word}</Status>
                </div>
                <button type="button" className="btn btn-secondary shrink-0" onClick={() => void r.loadManual(m.url, { open: true })}><Icon name="eye" className="h-4 w-4" />Preview the source</button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function Diagrams({ r }: { r: Repair }) {
  const matches = useMemo(
    () => (r.result?.manualMatches || []).filter(m => m.category === 'diagram' || m.matchType === 'diagram_or_spec' || /wiring|diagram|schematic|connector|pinout/i.test(m.title)),
    [r.result],
  )
  const images = r.manualPage?.images || []
  return (
    <div className="space-y-5">
      {matches.length > 0 && (
        <Block title="Pages that likely have a diagram" id="dg-matches">
          <ul className="-mx-4 divide-y divide-border sm:-mx-5">
            {matches.map(m => (
              <li key={m.url} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                <p className="min-w-0 font-bold leading-snug">{m.title}</p>
                <button type="button" className="btn btn-secondary shrink-0" onClick={() => void r.loadManual(m.url, { open: true })}><Icon name="eye" className="h-4 w-4" />Preview the diagram page</button>
              </li>
            ))}
          </ul>
        </Block>
      )}
      <Block title="Diagrams on the page you are reading" id="dg-images">
        {images.length === 0 ? (
          <p className="text-text-secondary">Preview a manual page that has images and its diagrams show here.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {images.slice(0, 12).map(image => <li key={image.url}><DiagramThumb image={image} onOpen={r.setViewer} /></li>)}
          </ul>
        )}
      </Block>
      <Block title="Bookmarked diagrams" id="dg-marks">
        {r.bookmarks.length === 0 ? (
          <p className="text-text-secondary">Open a diagram and tap Bookmark to keep it here for this lookup.</p>
        ) : (
          <ul className="grid grid-cols-2 gap-3 md:grid-cols-3">
            {r.bookmarks.map(image => <li key={image.url}><DiagramThumb image={image} onOpen={r.setViewer} /></li>)}
          </ul>
        )}
      </Block>
    </div>
  )
}

function ToolsParts({ r }: { r: Repair }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="card" aria-labelledby="tp-tools">
        <h3 id="tp-tools" className="section-title">Tools</h3>
        <p className="mt-1 text-text-secondary">Your own notes on the tools this job needs. They are saved with the procedure card, not copied from a manual.</p>
        <label htmlFor="tp-tools-in" className="form-label mt-3">Tools for this job</label>
        <textarea id="tp-tools-in" className="form-textarea" rows={7} placeholder="Lift and support points, scan tool, brake service mode, cooling system pressure tester, pullers, torque wrench range" value={r.tools} onChange={e => { r.setTools(e.target.value); r.setProcedureSay(null) }} />
        <p className="form-hint">One per line, or separated by commas.</p>
      </section>
      <section className="card" aria-labelledby="tp-parts">
        <h3 id="tp-parts" className="section-title">Parts and fluids</h3>
        <p className="mt-1 text-text-secondary">Parts, fluids, capacities to check and anything the customer is supplying. Do not enter prices you have not checked.</p>
        <label htmlFor="tp-parts-in" className="form-label mt-3">Parts and fluids for this job</label>
        <textarea id="tp-parts-in" className="form-textarea" rows={7} placeholder="Pads and rotors, coolant type to confirm, bulbs, reservoir, alignment, customer-supplied parts" value={r.partsFluids} onChange={e => { r.setPartsFluids(e.target.value); r.setProcedureSay(null) }} />
        <p className="form-hint">One per line, or separated by commas.</p>
      </section>
      <p className="text-[0.9375rem] text-text-secondary lg:col-span-2">Save these with the procedure card under Shop notes.</p>
    </div>
  )
}

function Notes({ r }: { r: Repair }) {
  const result = r.result!
  const target = `${vehicleLabel(result.normalizedVehicle)} - ${result.draft.operation}`
  const filled = r.tools.trim() || r.partsFluids.trim() || r.notes.trim()
  return (
    <form className="card space-y-4" onSubmit={e => { e.preventDefault() }} aria-labelledby="sn-title">
      <div>
        <h3 id="sn-title" className="section-title">Procedure card</h3>
        <p className="mt-1 text-text-secondary">Write your shop’s own steps, in your own words. Do not paste text from a manual.</p>
        <p className="mt-2 rounded-md bg-text-primary/[0.06] px-3 py-2 text-[0.9375rem]"><span className="text-text-secondary">Saves to: </span><span className="font-bold">{target}</span></p>
      </div>
      <div>
        <label htmlFor="sn-notes" className="form-label">Technician notes</label>
        <textarea id="sn-notes" className="form-textarea" rows={8} placeholder="What your shop does, in order, and what to watch for" value={r.notes} onChange={e => { r.setNotes(e.target.value); r.setProcedureSay(null) }} />
      </div>
      <div>
        <label htmlFor="sn-by" className="form-label">Approved by (technician)</label>
        <input id="sn-by" className="form-input" autoComplete="off" placeholder="Name of the technician who checked it" value={r.approvedBy} onChange={e => { r.setApprovedBy(e.target.value); r.setProcedureSay(null) }} aria-describedby="sn-by-hint" />
        <p id="sn-by-hint" className="form-hint">Needed to save a verified procedure. A draft can be saved without it.</p>
      </div>
      <p className="text-[0.9375rem] text-text-secondary">
        {filled ? 'Tools, parts and fluids you entered are saved with this card.' : 'Tools, parts and fluids from the other sections are saved with this card.'}
        {r.pinned.length > 0 ? ` ${r.pinned.length} pinned ${r.pinned.length === 1 ? 'source is' : 'sources are'} saved with it too.` : ''}
      </p>
      {r.procedureSay && <Notice kind={noticeKind(r.procedureSay)}>{r.procedureSay.text}</Notice>}
      <div className="flex flex-col gap-2 sm:flex-row">
        <button type="button" className="btn btn-secondary" onClick={() => void r.saveProcedure('draft')} disabled={r.saving}>{r.saving ? 'Saving…' : 'Save draft procedure'}</button>
        <button type="button" className="btn btn-primary" onClick={() => void r.saveProcedure('verified')} disabled={r.saving || !r.approvedBy.trim()}>Save verified procedure</button>
      </div>
    </form>
  )
}

/** The deeper view: what was found, safety, the manual itself, specs, diagrams, and the shop's own procedure card. */
export default function WorkspaceTab({ r }: { r: Repair }) {
  const [section, setSection] = useState<WorkspaceSection>('overview')
  if (!r.result) return null
  const label = WORKSPACE_SECTIONS.find(s => s.key === section)?.label || ''
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-text-secondary">Work through it in order: check the vehicle, read the safety steps, open the manual pages, then save what your shop knows as a procedure card.</p>
        <Link href="/estimates" className="btn btn-secondary shrink-0">Open estimates</Link>
      </div>
      <FilterChips<WorkspaceSection> scroll label="Workspace section" options={WORKSPACE_SECTIONS.map(s => ({ key: s.key, label: s.label }))} value={section} onChange={setSection} />
      <div role="region" aria-label={label}>
        {section === 'overview' && <Overview r={r} />}
        {section === 'safety' && <Safety r={r} />}
        {section === 'pages' && <Pages r={r} />}
        {section === 'specs' && <Specs r={r} />}
        {section === 'diagrams' && <Diagrams r={r} />}
        {section === 'tools' && <ToolsParts r={r} />}
        {section === 'notes' && <Notes r={r} />}
      </div>
    </div>
  )
}
