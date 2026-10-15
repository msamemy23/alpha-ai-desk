'use client'
import { useState } from 'react'
import Icon from '@/components/Icon'
import { EmptyBlock, FilterChips, Pill } from '@/components/ListKit'
import { Block, ExternalLink, Status } from './parts'
import { CATEGORIES, categoryLabel, confidenceInfo, isManualProvider, matchInfo } from './types'
import type { Repair } from './useRepair'
import type { RepairSource } from '@/lib/repair/sources'

function SourceItem({ source, pinned, onPreview, onPin }: { source: RepairSource; pinned: boolean; onPreview: () => void; onPin: () => void }) {
  const conf = confidenceInfo(source.confidence)
  return (
    <li className="px-4 py-3.5 sm:px-5">
      <p className="font-bold leading-snug">{source.title}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-[0.875rem] font-bold text-text-secondary">{source.provider}</span>
        <span className="text-[0.875rem] text-text-secondary">{categoryLabel(source.category)}</span>
        <Status lamp={conf.lamp}>{conf.word}</Status>
      </div>
      {source.description && <p className="mt-1.5 line-clamp-2 text-[0.9375rem] text-text-secondary">{source.description}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        {isManualProvider(source)
          ? <button type="button" className="btn btn-secondary" onClick={onPreview}><Icon name="eye" className="h-4 w-4" />Preview</button>
          : <ExternalLink url={source.url}>Open source</ExternalLink>}
        <button type="button" className="btn btn-ghost" onClick={onPin} aria-pressed={pinned}>
          <Icon name={pinned ? 'check' : 'plus'} className="h-4 w-4" />{pinned ? 'Pinned' : 'Pin'}<span className="sr-only">: {source.title}</span>
        </button>
      </div>
    </li>
  )
}

/** Every source the lookup found, the pages it matched inside the manual, and the ones you pinned. */
export default function SourcesTab({ r }: { r: Repair }) {
  const [category, setCategory] = useState<string>('all')
  const { result, pinned } = r
  if (!result) return null

  const sources = result.sources
  const options = CATEGORIES
    .map(c => ({ key: c.value as string, label: c.label, count: c.value === 'all' ? sources.length : sources.filter(s => s.category === c.value).length }))
    .filter(c => c.key === 'all' || c.count > 0 || c.key === category)
  const shown = category === 'all' ? sources : sources.filter(s => s.category === category)

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_21rem]">
      <div className="min-w-0 space-y-4">
        <p className="text-text-secondary">Open these when you need proof: the manual page, a diagram, a bulletin or a recall. Pin the ones that should travel with the estimate.</p>
        <FilterChips scroll label="Show sources" options={options} value={category} onChange={setCategory} />
        {shown.length === 0 ? (
          <EmptyBlock icon="manual" title={sources.length === 0 ? 'No sources found' : 'No sources in this group'}>
            {sources.length === 0 ? 'Try fewer words, check the spelling, or add the year, make and model under Vehicle details.' : 'Pick All to see every source again.'}
          </EmptyBlock>
        ) : (
          <section className="panel" aria-label={`${shown.length} ${shown.length === 1 ? 'source' : 'sources'}`}>
            <div className="panel-header">
              <h3 className="section-title"><span className="num">{shown.length}</span> {shown.length === 1 ? 'source' : 'sources'}</h3>
              <button type="button" className="btn btn-secondary" onClick={() => void r.copySources()}><Icon name="copy" className="h-4 w-4" />Copy all links</button>
            </div>
            <ul className="divide-y divide-border">
              {shown.map(s => (
                <SourceItem
                  key={s.id || s.url}
                  source={s}
                  pinned={pinned.some(p => p.url === s.url)}
                  onPreview={() => void r.loadManual(s.url, { open: true })}
                  onPin={() => r.togglePin(s)}
                />
              ))}
            </ul>
          </section>
        )}
      </div>

      <aside className="min-w-0 space-y-5" aria-label="Pages and pinned sources">
        <Block title="Pages inside the manual" id="src-matches">
          {result.manualMatches.length === 0 ? (
            <p className="text-text-secondary">No page inside the manual matched yet. Preview a LEMON or CHARM source to browse its pages.</p>
          ) : (
            <ul className="-mx-4 divide-y divide-border sm:-mx-5">
              {result.manualMatches.slice(0, 8).map(m => {
                const info = matchInfo(m.matchType)
                return (
                  <li key={m.url}>
                    <button type="button" className="ledger-row !items-start" onClick={() => void r.loadManual(m.url, { open: true })}>
                      <span className="ledger-main">
                        <span className="block font-bold leading-snug">{m.title}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                          <span className="text-[0.875rem] font-bold text-text-secondary">{m.provider}</span>
                          <Status lamp={info.lamp}>{info.word}</Status>
                        </span>
                      </span>
                      <Icon name="chevronRight" className="mt-1 h-5 w-5 shrink-0 text-text-muted" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Block>

        <Block title="Pinned sources" id="src-pinned" right={pinned.length > 0 ? <Pill>{`${pinned.length} of 8`}</Pill> : undefined}>
          {pinned.length === 0 ? (
            <p className="text-text-secondary">Pin a source and it is added to the estimate notes and to the procedure card.</p>
          ) : (
            <ul className="space-y-2">
              {pinned.map(p => (
                <li key={p.url} className="flex items-start gap-2 rounded-md border border-border bg-bg-base p-3">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 font-bold leading-snug">{p.title}</p>
                    <p className="text-[0.875rem] text-text-secondary">{p.provider} · {categoryLabel(p.category)}</p>
                  </div>
                  <button type="button" className="btn btn-ghost shrink-0" onClick={() => r.togglePin(p)}>Unpin<span className="sr-only">: {p.title}</span></button>
                </li>
              ))}
            </ul>
          )}
        </Block>
      </aside>
    </div>
  )
}
