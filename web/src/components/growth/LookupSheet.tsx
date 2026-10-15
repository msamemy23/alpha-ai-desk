'use client'
import { useRef, useState } from 'react'
import Sheet from '@/components/Sheet'
import Notice from '@/components/Notice'
import Icon from '@/components/Icon'
import { EmptyBlock } from '@/components/ListKit'
import { phonePretty } from '@/lib/today'
import { getAuthJsonHeaders } from './helpers'
import type { Rec } from './helpers'

/** Searches public pages for contact details. Finding a number does not mean a person agreed to be contacted. */
export default function LookupSheet({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [asked, setAsked] = useState('')
  const [results, setResults] = useState<Rec | null>(null)
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [tried, setTried] = useState(false)
  const busy = useRef(false)

  const lookUp = async () => {
    setTried(true)
    if (!query.trim() || busy.current) return
    busy.current = true; setSearching(true); setError(''); setResults(null)
    try {
      const r = await fetch('/api/growth/smart-search', { method: 'POST', headers: await getAuthJsonHeaders(), body: JSON.stringify({ query: query.trim() }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok || d.error) throw new Error(d.error || 'The search did not finish')
      setResults(d); setAsked(query.trim())
    } catch (e) {
      setError(`${e instanceof Error && e.message ? e.message : 'The search did not finish'}. Try again in a minute.`)
    } finally { busy.current = false; setSearching(false) }
  }

  const list: Rec[] = Array.isArray(results?.results) ? results!.results : []
  return (
    <Sheet open onClose={onClose} title="Look up a person" wide>
      <form onSubmit={e => { e.preventDefault(); void lookUp() }} className="space-y-3" noValidate>
        <p className="-mt-1 text-[0.9375rem] text-text-secondary">Type a name, business or Google reviewer. Alpha searches public pages for a phone number, email or social page.</p>
        <div>
          <label htmlFor="intel-q" className="form-label">Name or business</label>
          <input id="intel-q" className="form-input" value={query} onChange={e => setQuery(e.target.value)} placeholder="Name, business or reviewer" autoComplete="off" aria-invalid={tried && !query.trim()} />
          {tried && !query.trim() && <p className="form-error">Type a name or business to look up.</p>}
        </div>
        <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={searching}><Icon name="search" className="h-5 w-5" />{searching ? 'Searching…' : 'Look up'}</button>
      </form>
      {searching && <div className="skeleton mt-4 h-24" role="status" aria-label="Searching" />}
      {error && <Notice kind="error" className="mt-4">{error}</Notice>}
      {results && (
        <div className="mt-5">
          <h3 className="section-title mb-2 break-words">Results for {asked}</h3>
          {list.length === 0 ? (
            <EmptyBlock title="Nothing found">Try the full name, the business name or a nickname.</EmptyBlock>
          ) : (
            <ul className="space-y-2">
              {list.map((r, i) => (
                <li key={i} className="rounded-lg border border-border bg-bg-base p-3">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="font-bold">{r.source || 'Web'}</span>
                    <span className={`tag text-[0.8125rem] ${r.confidence === 'high' ? 'tag-green' : 'tag-amber'}`}>{r.confidence === 'high' ? 'High confidence' : `${r.confidence ? String(r.confidence).charAt(0).toUpperCase() + String(r.confidence).slice(1) : 'Medium'} confidence`}</span>
                  </div>
                  {r.name && <p className="text-[0.9375rem]">Name: {r.name}</p>}
                  {r.phone && <p className="text-[0.9375rem]">Phone: <a href={`tel:${r.phone}`} className="font-bold text-blue underline-offset-2 hover:underline">{phonePretty(r.phone)}</a></p>}
                  {r.email && <p className="break-all text-[0.9375rem]">Email: <a href={`mailto:${r.email}`} className="font-bold text-blue underline-offset-2 hover:underline">{r.email}</a></p>}
                  {r.social && <p className="break-all text-[0.9375rem]">Social: {r.social}</p>}
                </li>
              ))}
            </ul>
          )}
          {results.summary && <p className="mt-3 rounded-md bg-bg-hover px-3 py-2 text-[0.9375rem]">{results.summary}</p>}
        </div>
      )}
    </Sheet>
  )
}
