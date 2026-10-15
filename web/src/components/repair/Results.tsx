'use client'
import { useEffect, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import AnswerTab from './AnswerTab'
import EstimateTab from './EstimateTab'
import SourcesTab from './SourcesTab'
import WorkspaceTab from './WorkspaceTab'
import type { MainTab } from './types'
import type { Repair } from './useRepair'

const TABS: { value: MainTab; label: string }[] = [
  { value: 'answer', label: 'Answer' },
  { value: 'sources', label: 'Sources' },
  { value: 'estimate', label: 'Estimate' },
  { value: 'workspace', label: 'Workspace' },
]

/** Underlined tabs. Arrow keys, Home and End move between them, as a screen reader user expects. */
function TabBar({ value, onChange }: { value: MainTab; onChange: (tab: MainTab) => void }) {
  const move = (to: number) => {
    const next = TABS[(to + TABS.length) % TABS.length]
    onChange(next.value)
    requestAnimationFrame(() => document.getElementById(`repair-tab-${next.value}`)?.focus())
  }
  return (
    <div role="tablist" aria-label="Repair info sections" className="flex gap-0.5 overflow-x-auto border-b border-border min-[420px]:gap-1">
      {TABS.map((t, i) => {
        const on = t.value === value
        return (
          <button
            key={t.value}
            id={`repair-tab-${t.value}`}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.value)}
            onKeyDown={e => {
              if (e.key === 'ArrowRight') { e.preventDefault(); move(i + 1) }
              else if (e.key === 'ArrowLeft') { e.preventDefault(); move(i - 1) }
              else if (e.key === 'Home') { e.preventDefault(); move(0) }
              else if (e.key === 'End') { e.preventDefault(); move(TABS.length - 1) }
            }}
            className={`-mb-px inline-flex min-h-[44px] shrink-0 items-center border-b-[3px] px-2 text-[1rem] font-bold transition-colors min-[420px]:px-3.5 sm:px-5 ${on ? 'border-blue text-blue' : 'border-transparent text-text-secondary hover:text-text-primary'}`}
          >
            {t.label}
          </button>
        )
      })}
    </div>
  )
}

/** One lookup's answer. The page gives it a new key for every search, so it always opens on the Answer tab. */
export default function Results({ r }: { r: Repair }) {
  const [tab, setTab] = useState<MainTab>('answer')
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => { heading.current?.focus() }, [])
  const { result, repairView: v } = r
  if (!result || !v) return null

  const go = (next: MainTab) => {
    setTab(next)
    // Landing on a tab from a button further down the page: show its top.
    document.getElementById('repair-tabs')?.scrollIntoView({ block: 'start' })
  }

  return (
    <section aria-labelledby="repair-result">
      <div className="card">
        <h2 id="repair-result" ref={heading} tabIndex={-1} className="section-title text-[1.5rem] leading-tight outline-none">{v.vehicle}</h2>
        <p className="mt-2 max-w-3xl leading-relaxed text-text-secondary">{v.mechanicSummary}</p>
        {v.needsExactVehicle && (
          <Notice kind="warn" className="mt-3">Pick the exact engine or trim before you trust diagrams, specs or removal steps.</Notice>
        )}
        {result.warnings.length > 0 && (
          <div className="mt-3 space-y-2">
            {result.warnings.map(w => <Notice key={w} kind="warn">{w}</Notice>)}
          </div>
        )}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <button type="button" className="btn btn-primary" onClick={() => go('estimate')}>Create estimate</button>
          <button type="button" className="btn btn-secondary" onClick={() => r.openRepairAi()}><Icon name="alpha" className="h-5 w-5" />Ask Alpha</button>
          <button type="button" className="btn btn-secondary" onClick={r.saveDraft}><Icon name="star" className="h-5 w-5" />Save for later</button>
          <button type="button" className="btn btn-secondary" onClick={() => void r.copySources()}><Icon name="copy" className="h-5 w-5" />Copy links</button>
        </div>
        {r.say && <Notice kind={r.say.kind} className="mt-3">{r.say.text}</Notice>}
      </div>

      <div id="repair-tabs" className="mt-5 scroll-mt-4">
        <TabBar value={tab} onChange={setTab} />
      </div>

      <div role="tabpanel" aria-labelledby={`repair-tab-${tab}`} className="mt-5">
        {tab === 'answer' && <AnswerTab r={r} goTab={go} />}
        {tab === 'sources' && <SourcesTab r={r} />}
        {tab === 'estimate' && <EstimateTab r={r} />}
        {tab === 'workspace' && <WorkspaceTab r={r} />}
      </div>
    </section>
  )
}
