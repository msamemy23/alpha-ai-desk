'use client'
import { useState } from 'react'
import Icon from '@/components/Icon'
import Sheet from '@/components/Sheet'
import { ErrorCard, SearchField } from '@/components/ListKit'
import { ExternalLink } from './parts'
import { DiagramThumb } from './DiagramViewer'
import { categoryLabel } from './types'
import type { Repair } from './useRepair'
import type { RepairManualPage } from '@/lib/repair/sources'

/** The page's own list of pages. Keyed by page, so the filter starts empty on every new page. */
function Tree({ page, onGo }: { page: RepairManualPage; onGo: (url: string) => void }) {
  const [filter, setFilter] = useState('')
  const term = filter.trim().toLowerCase()
  const links = term ? page.links.filter(l => `${l.title} ${l.category}`.toLowerCase().includes(term)) : page.links
  return (
    <section aria-labelledby="mr-tree" className="mt-5">
      <h3 id="mr-tree" className="section-title">Pages from here <span className="num font-normal text-text-secondary">{page.links.length}</span></h3>
      {page.links.length > 8 && <SearchField className="mt-2" label="Filter pages" placeholder="Filter pages" value={filter} onChange={setFilter} />}
      {links.length === 0 ? (
        <p className="mt-3 text-text-secondary">{page.links.length === 0 ? 'This page does not link to other pages.' : `No page matches “${filter.trim()}”.`}</p>
      ) : (
        <ul className="ledger mt-3 max-h-[28rem] overflow-y-auto">
          {links.map(link => (
            <li key={link.url}>
              <button type="button" className="ledger-row" onClick={() => onGo(link.url)}>
                <span className="ledger-main">
                  <span className="block font-bold leading-snug">{link.title}</span>
                  <span className="block text-[0.875rem] text-text-secondary">{categoryLabel(link.category)}{link.isDirectory ? ' · Folder' : ''}</span>
                </span>
                <Icon name="chevronRight" className="h-5 w-5 shrink-0 text-text-muted" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/** Reads one page of a public manual (LEMON or CHARM) without leaving the screen. */
export default function ManualReader({ r }: { r: Repair }) {
  const { manualPage: page, manualLoading: loading, manualError: error } = r
  // Browsing by hand goes exactly where you tap. Only a preview from the sources runs the smart search for the right page.
  const go = (url: string) => void r.loadManual(url, { open: true, literal: true })

  return (
    <Sheet open={r.readerOpen} onClose={() => { if (!r.viewer) r.closeReader() }} title="Manual page" wide>
      <div className="pb-2">
        {loading && (
          <div role="status" aria-busy="true" aria-label="Loading the manual page" className="space-y-3">
            <div className="skeleton h-8 w-3/4" />
            <div className="skeleton h-20" />
            <div className="skeleton h-40" />
            <p className="text-[0.9375rem] text-text-secondary">Loading the manual page. This can take up to 45 seconds.</p>
          </div>
        )}
        {!loading && error && <ErrorCard title="The manual page did not load" message={`${/[.!?]$/.test(error.trim()) ? error.trim() : `${error.trim()}.`} The manual site may be slow or down. Try again in a moment.`} onRetry={r.retryManual} />}
        {!loading && !error && !page && <p className="text-text-secondary">Pick a LEMON or CHARM source to read it here.</p>}
        {!loading && page && (
          <>
            {page.breadcrumbs.length > 0 && (
              <nav aria-label="Where this page sits in the manual" className="mb-3">
                <ol className="flex flex-wrap items-center gap-x-1 gap-y-1 text-[0.875rem]">
                  {page.breadcrumbs.map(b => (
                    <li key={b.url} className="flex items-center gap-1">
                      <button type="button" className="inline-flex min-h-[36px] max-w-[11rem] items-center truncate rounded-md px-1.5 font-bold text-blue hover:underline" onClick={() => go(b.url)} title={b.title}>{b.title}</button>
                      <Icon name="chevronRight" className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                    </li>
                  ))}
                  <li aria-current="page" className="px-1.5 font-bold text-text-secondary">This page</li>
                </ol>
              </nav>
            )}
            <h3 className="display break-words text-[1.25rem] font-bold leading-snug">{page.title}</h3>
            <p className="mt-2 text-text-secondary">{page.warning}</p>
            <div className="mt-3"><ExternalLink url={page.url}>Open the original page</ExternalLink></div>

            {page.images.length > 0 && (
              <section aria-labelledby="mr-images" className="mt-5">
                <h3 id="mr-images" className="section-title">Diagrams on this page</h3>
                <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {page.images.slice(0, 12).map(image => <li key={image.url}><DiagramThumb image={image} onOpen={r.setViewer} /></li>)}
                </ul>
              </section>
            )}

            {page.sections.length > 0 ? (
              <section aria-labelledby="mr-text" className="mt-5 space-y-3">
                <h3 id="mr-text" className="section-title">On this page</h3>
                {page.sections.map(section => (
                  <article key={`${section.heading}-${section.text.slice(0, 24)}`} className="rounded-md border border-border bg-bg-base p-4">
                    <h4 className="font-bold">{section.heading}</h4>
                    <p className="mt-2 whitespace-pre-wrap break-words leading-relaxed text-text-secondary">{section.text}</p>
                  </article>
                ))}
              </section>
            ) : (
              <p className="mt-5 rounded-md border border-dashed border-border px-4 py-5 text-center text-text-secondary">This page is mostly a list of other pages. Pick one below.</p>
            )}

            <Tree key={page.url} page={page} onGo={go} />
          </>
        )}
      </div>
    </Sheet>
  )
}
