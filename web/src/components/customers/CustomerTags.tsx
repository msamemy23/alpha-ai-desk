'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { cleanTags } from '@/lib/customers/segments'
import { JSON_HEADERS, asText, asTextList, fetchJson } from './http'

const MAX_TAGS = 12
const MAX_TAG_CHARS = 24
const STARTERS = ['Fleet', 'Insurance', 'Referral', 'Warranty']

type State = 'loading' | 'ready' | 'error' | 'unavailable'

/**
 * Tags on one customer: chips you can remove and a box to add one. Tags group customers (fleet, insurance, referral) and the
 * Customers list can be filtered by them. Only the tags are saved, never the customer's contact choices.
 */
export default function CustomerTags({ customerId, onChanged }: { customerId: string; onChanged?: () => void }) {
  const [state, setState] = useState<State>('loading')
  const [tags, setTags] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState('')
  const seq = useRef(0)
  const input = useRef<HTMLInputElement>(null)
  const url = `/api/customers/tags?customer_id=${encodeURIComponent(customerId)}`

  const load = useCallback(async () => {
    const mine = ++seq.current
    setState('loading'); setProblem('')
    try {
      const r = await fetchJson(url, { cache: 'no-store' })
      if (mine !== seq.current) return
      if (!r.ok || !r.data || r.data.ok !== true) { setState('error'); return }
      if (r.data.available === false) { setState('unavailable'); return }
      setTags(asTextList(r.data.tags))
      setState('ready')
    } catch {
      if (mine === seq.current) setState('error')
    }
  }, [url])

  useEffect(() => { void load(); return () => { seq.current += 1 } }, [load])

  const save = async (next: string[], then?: () => void) => {
    if (busy) return
    setBusy(true); setProblem('')
    try {
      const r = await fetchJson('/api/customers/tags', { method: 'PUT', headers: JSON_HEADERS, body: JSON.stringify({ customer_id: customerId, tags: next }) })
      if (!r.ok || !r.data || r.data.ok !== true) {
        setProblem(r.status === 403 ? 'Your sign-in can look at tags but not change them.' : r.status === 503 ? 'Tags need a database update first.' : asText(r.data?.error) || 'The tags were not saved. Check your connection and try again.')
        return
      }
      setTags(asTextList(r.data.tags))
      then?.()
      onChanged?.()
    } catch {
      setProblem('The tags were not saved. Check your connection and try again.')
    } finally { setBusy(false) }
  }

  const add = (raw: string) => {
    const clean = cleanTags([raw])[0] || ''
    if (!clean) { setProblem('Type a tag first, for example fleet.'); return }
    if (tags.some(t => t.toLowerCase() === clean.toLowerCase())) { setProblem(`This customer already has the tag “${clean}”.`); return }
    if (tags.length >= MAX_TAGS) { setProblem(`A customer can have up to ${MAX_TAGS} tags. Remove one first.`); return }
    void save([...tags, clean], () => { setDraft(''); input.current?.focus() })
  }

  if (state === 'loading') return <div className="skeleton h-14" aria-busy="true" aria-label="Loading tags" role="status" />
  if (state === 'error') {
    return (
      <div role="alert" className="rounded-lg border border-red/40 bg-red/[0.08] p-4">
        <p className="font-bold text-red">Tags could not be loaded.</p>
        <p className="mt-1 text-[0.9375rem] text-text-secondary">Check your connection and try again.</p>
        <button type="button" className="btn btn-secondary mt-3" onClick={() => void load()}>Try again</button>
      </div>
    )
  }
  if (state === 'unavailable') {
    return <Notice kind="info"><p>Tags need a database update before they can be used. Nothing else about this customer is affected.</p></Notice>
  }

  const full = tags.length >= MAX_TAGS
  return (
    <div className="space-y-3">
      {tags.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-4 text-[0.9375rem] text-text-secondary">
          No tags yet. Tags group customers, like fleet or insurance, so you can find them from the Customers list.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-2" aria-label="Tags on this customer">
          {tags.map(t => (
            <li key={t} className="inline-flex max-w-full items-center rounded-full border border-line bg-bg-card pl-3.5 text-[0.9375rem] font-bold">
              <span className="min-w-0 break-words">{t}</span>
              <button
                type="button" className="inline-grid h-11 w-11 shrink-0 place-items-center rounded-full text-text-secondary hover:text-text-primary disabled:opacity-60"
                onClick={() => void save(tags.filter(x => x !== t))} disabled={busy} aria-label={`Remove the tag ${t}`}
              >
                <Icon name="close" className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {full ? (
        <p className="text-[0.9375rem] text-text-secondary">{MAX_TAGS} is the most tags one customer can have. Remove one to add another.</p>
      ) : (
        <form className="flex gap-2" onSubmit={e => { e.preventDefault(); add(draft) }}>
          <div className="min-w-0 flex-1">
            <label htmlFor={`tag-${customerId}`} className="sr-only">New tag</label>
            <input
              ref={input} id={`tag-${customerId}`} className="form-input" value={draft} maxLength={MAX_TAG_CHARS} placeholder="Add a tag, like fleet"
              autoComplete="off" enterKeyHint="done" disabled={busy}
              onChange={e => { setDraft(e.target.value); if (problem) setProblem('') }}
            />
          </div>
          <button type="submit" className="btn btn-secondary shrink-0" disabled={busy || draft.trim() === ''}>
            <Icon name="plus" className="h-5 w-5" />{busy ? 'Saving…' : 'Add tag'}
          </button>
        </form>
      )}

      {tags.length === 0 && !full && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Common tags">
          <span className="text-[0.9375rem] text-text-secondary">Common tags</span>
          {STARTERS.map(s => (
            <button key={s} type="button" className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-bg-card px-4 text-[0.9375rem] font-bold hover:bg-bg-hover disabled:opacity-60" onClick={() => add(s)} disabled={busy}>
              {s}
            </button>
          ))}
        </div>
      )}

      {problem && <p role="alert" className="form-error !text-[0.9375rem] break-words">{problem}</p>}
    </div>
  )
}
