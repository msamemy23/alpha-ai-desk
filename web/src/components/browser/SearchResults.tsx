'use client'
import { EmptyBlock } from '@/components/ListKit'
import type { SearchHit } from '../../lib/browser/reader'
import { addressText, safeLink } from './address'
import { isPlainClick } from './blocks'

/** Search results are plain text from the search page. Opening one opens it in Reader view in the same tab. */
export default function SearchResults({
  query, hits, hidden, onOpen, onSearchAgain,
}: { query: string; hits: SearchHit[]; hidden: number; onOpen: (url: string) => void; onSearchAgain: () => void }) {
  const shown = hits.flatMap(h => {
    const link = safeLink(h.url)
    return link && link.kind === 'web' ? [{ ...h, url: link.url }] : []
  })
  return (
    <section aria-label={`Search results for ${query}`}>
      <h2 className="section-title mb-1 break-words">Search: {query}</h2>
      {hidden > 0 && (
        <p className="mb-2 text-[0.875rem] text-text-secondary">
          {hidden} {hidden === 1 ? 'result was' : 'results were'} left out because of your shop’s site rules.
        </p>
      )}
      {shown.length === 0 ? (
        <EmptyBlock icon="search" title="No results" action={<button type="button" className="btn btn-primary" onClick={onSearchAgain}>Search again</button>}>
          Try different words, or a web address if you know the site.
        </EmptyBlock>
      ) : (
        <ul className="ledger">
          {shown.map((h, i) => (
            <li key={`${h.url}-${i}`}>
              <a
                href={h.url}
                rel="nofollow noopener noreferrer"
                className="block min-h-[44px] px-3 py-3 hover:bg-bg-hover"
                onClick={e => { if (isPlainClick(e)) { e.preventDefault(); onOpen(h.url) } }}
              >
                <span className="block break-words font-bold text-blue">{h.title || addressText(h.url)}</span>
                <span className="block break-all text-[0.875rem] text-text-secondary">{h.host || addressText(h.url)}</span>
                {h.snippet && <span className="mt-1 block break-words text-[0.9375rem] text-text-primary">{h.snippet}</span>}
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
