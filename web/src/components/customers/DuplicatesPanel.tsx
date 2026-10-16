'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { EmptyBlock, ErrorCard } from '@/components/ListKit'
import { REASON_TEXT } from '@/lib/customers/duplicates'
import type { DupReason } from '@/lib/customers/duplicates'
import { phonePretty } from '@/lib/today'
import { asText, fetchJson } from './http'
import { fmtDay } from './types'

export interface Snap {
  id: string
  name: string
  phone: string
  email: string
  address: string
  vehicle: string
  vin: string
  plate: string
  mileage: string
  notes: string
  created_at: string
  documents: number | null
  jobs: number | null
  test_hint: string
}
interface Pair { a: Snap; b: Snap; reasons: DupReason[]; strength: 'strong' | 'possible' }

/** The one sentence this screen must always say. There is no merge button anywhere on it. */
export const NO_MERGE_SENTENCE = 'Merging changes records, so Alpha will not do it until you say so.'

const REASONS = new Set<string>(Object.keys(REASON_TEXT))

function readSnap(v: unknown): Snap {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {}
  const n = (k: string) => (typeof o[k] === 'number' ? (o[k] as number) : null)
  return {
    id: asText(o.id), name: asText(o.name), phone: asText(o.phone), email: asText(o.email), address: asText(o.address), vehicle: asText(o.vehicle),
    vin: asText(o.vin), plate: asText(o.plate), mileage: asText(o.mileage), notes: asText(o.notes), created_at: asText(o.created_at),
    documents: n('documents'), jobs: n('jobs'), test_hint: asText(o.test_hint),
  }
}

function readPairs(list: unknown): Pair[] {
  if (!Array.isArray(list)) return []
  return list.map(p => {
    const o = p && typeof p === 'object' ? (p as Record<string, unknown>) : {}
    const reasons = (Array.isArray(o.reasons) ? o.reasons : []).filter((r): r is DupReason => typeof r === 'string' && REASONS.has(r))
    return { a: readSnap(o.a), b: readSnap(o.b), reasons, strength: o.strength === 'strong' ? 'strong' as const : 'possible' as const }
  }).filter(p => p.a.id && p.b.id)
}

/** "Same phone number and same name": the first reason as written, the rest in lower case, joined in words. */
function reasonWords(reasons: DupReason[]): string {
  const parts = reasons.map((r, i) => (i === 0 ? REASON_TEXT[r] : REASON_TEXT[r].charAt(0).toLowerCase() + REASON_TEXT[r].slice(1)))
  return parts.length <= 1 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}
const reasonLine = (p: Pair): string => reasonWords(p.reasons)
const nameOf = (s: Snap): string => s.name || 'Unnamed customer'

function NoMerge({ className = '' }: { className?: string }) {
  return (
    <Notice kind="info" className={className}>
      <p className="break-words font-bold">{NO_MERGE_SENTENCE}</p>
      <p className="mt-0.5 break-words">You can look at each pair and open either customer. Nothing here changes or removes a customer.</p>
    </Notice>
  )
}

function Cell({ children }: { children: React.ReactNode }) {
  return <dd className="min-w-0 break-words rounded-md border border-border bg-bg-base px-2.5 py-2 text-[0.9375rem]">{children}</dd>
}
const none = <span className="text-text-secondary">None</span>

function Compare({ pair, onBack, onOpen }: { pair: Pair; onBack: () => void; onOpen: (id: string) => void }) {
  const { a, b } = pair
  const text = (v: string) => (v ? v : none)
  const count = (v: number | null) => (v === null ? <span className="text-text-secondary">Not counted</span> : <span className="num font-bold">{v}</span>)
  const fields: { label: string; left: React.ReactNode; right: React.ReactNode; same: boolean | null }[] = [
    { label: 'Name', left: text(a.name), right: text(b.name), same: a.name.trim().toLowerCase() === b.name.trim().toLowerCase() },
    { label: 'Phone', left: a.phone ? phonePretty(a.phone) : none, right: b.phone ? phonePretty(b.phone) : none, same: !a.phone || !b.phone ? null : a.phone.replace(/\D/g, '').slice(-10) === b.phone.replace(/\D/g, '').slice(-10) },
    { label: 'Email', left: text(a.email), right: text(b.email), same: !a.email || !b.email ? null : a.email.toLowerCase() === b.email.toLowerCase() },
    { label: 'Address', left: text(a.address), right: text(b.address), same: !a.address || !b.address ? null : a.address.toLowerCase() === b.address.toLowerCase() },
    { label: 'Vehicle', left: text(a.vehicle), right: text(b.vehicle), same: !a.vehicle || !b.vehicle ? null : a.vehicle.toLowerCase() === b.vehicle.toLowerCase() },
    { label: 'VIN', left: text(a.vin), right: text(b.vin), same: !a.vin || !b.vin ? null : a.vin.toLowerCase() === b.vin.toLowerCase() },
    { label: 'License plate', left: text(a.plate), right: text(b.plate), same: !a.plate || !b.plate ? null : a.plate.toLowerCase() === b.plate.toLowerCase() },
    { label: 'Customer since', left: a.created_at ? fmtDay(a.created_at) : none, right: b.created_at ? fmtDay(b.created_at) : none, same: null },
    { label: 'Estimates, invoices and receipts', left: count(a.documents), right: count(b.documents), same: null },
    { label: 'Repair orders', left: count(a.jobs), right: count(b.jobs), same: null },
    { label: 'Notes', left: <span className="whitespace-pre-wrap">{text(a.notes)}</span>, right: <span className="whitespace-pre-wrap">{text(b.notes)}</span>, same: null },
  ]
  return (
    <div className="space-y-4">
      <button type="button" className="btn btn-ghost -ml-2" onClick={onBack}><Icon name="chevronLeft" className="h-4 w-4" />Back to the list</button>
      <div>
        <h3 className="section-title break-words">{nameOf(a)} and {nameOf(b)}</h3>
        <p className="mt-1 flex items-center gap-1.5 text-[0.9375rem] font-bold">
          <span className={`lamp ${pair.strength === 'strong' ? 'lamp-amber' : 'lamp-off'}`} aria-hidden="true" />
          {pair.strength === 'strong' ? 'Likely the same person.' : 'Worth a look.'}
        </p>
        <p className="mt-0.5 break-words text-[0.9375rem] text-text-secondary">{reasonLine(pair)}.</p>
      </div>

      {[a, b].filter(s => s.test_hint).map(s => (
        <Notice key={s.id} kind="info"><p className="break-words"><span className="font-bold">{nameOf(s)}:</span> {s.test_hint}</p></Notice>
      ))}

      <dl className="space-y-3">
        {/* The two names stay at the top while the rows scroll, so each column is always labelled. */}
        <div className="sticky top-0 z-10 -mx-5 grid grid-cols-2 gap-2 border-b border-border bg-bg-card px-5 py-2 sm:-mx-6 sm:px-6">
          {[a, b].map((s, i) => (
            <div key={s.id} className="min-w-0">
              <dt className="text-[0.875rem] font-bold text-text-secondary">{i === 0 ? 'First card' : 'Second card'}</dt>
              <dd className="break-words font-bold">{nameOf(s)}</dd>
            </div>
          ))}
        </div>
        {fields.map(f => (
          <div key={f.label}>
            <dt className="mb-1 text-[0.875rem] font-bold text-text-secondary">
              {f.label}
              {f.same === true && <span className="ml-2 font-normal">Same</span>}
              {f.same === false && <span className="ml-2 font-normal text-amber">Different</span>}
            </dt>
            <div className="grid grid-cols-2 gap-2"><Cell>{f.left}</Cell><Cell>{f.right}</Cell></div>
          </div>
        ))}
      </dl>

      <div className="grid grid-cols-2 gap-2">
        <button type="button" className="btn btn-secondary" onClick={() => onOpen(a.id)}>Open first card</button>
        <button type="button" className="btn btn-secondary" onClick={() => onOpen(b.id)}>Open second card</button>
      </div>
      <NoMerge />
    </div>
  )
}

/** Customer tools, Possible duplicates: pairs that may be the same person, and a side by side look at either pair. Read only. */
export default function DuplicatesPanel({ onOpenCustomer }: { onOpenCustomer: (id: string) => void }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [pairs, setPairs] = useState<Pair[]>([])
  const [meta, setMeta] = useState({ checked: 0, total: 0 })
  const [open, setOpen] = useState<number | null>(null)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const mine = ++seq.current
    setState('loading')
    try {
      const r = await fetchJson('/api/customers/duplicates', { cache: 'no-store' }, 45000)
      if (mine !== seq.current) return
      const d = r.data
      if (!r.ok || !d || d.ok !== true) { setError(asText(d?.error) || 'The pairs could not be looked for. Check your connection and try again.'); setState('error'); return }
      setPairs(readPairs(d.pairs))
      setMeta({ checked: typeof d.checked === 'number' ? d.checked : 0, total: typeof d.total === 'number' ? d.total : 0 })
      setOpen(null)
      setState('ready')
    } catch {
      if (mine !== seq.current) return
      setError('We could not reach the server. Check your connection and try again.')
      setState('error')
    }
  }, [])

  useEffect(() => { void load(); return () => { seq.current += 1 } }, [load])

  if (state === 'loading') return <div className="space-y-2" aria-busy="true" aria-label="Looking for possible duplicates" role="status">{[0, 1, 2].map(i => <div key={i} className="skeleton h-[4.25rem]" />)}</div>
  if (state === 'error') return <ErrorCard title="The pairs did not load" message={error} onRetry={() => void load()} />

  if (open !== null && pairs[open]) return <Compare pair={pairs[open]} onBack={() => setOpen(null)} onOpen={onOpenCustomer} />

  return (
    <div className="space-y-4">
      <div>
        <h3 className="section-title">Possible duplicates</h3>
        <p className="mt-1 text-[0.9375rem] text-text-secondary">
          Customers who share a phone number, email, VIN, license plate or name. Two cards listed here are not always the same person, so look before you decide.
        </p>
      </div>
      <NoMerge />
      {pairs.length === 0 ? (
        <EmptyBlock icon="customers" title="No possible duplicates found" action={<button type="button" className="btn btn-secondary" onClick={() => void load()}>Check again</button>}>
          Alpha compared <span className="num">{meta.checked}</span> {meta.checked === 1 ? 'customer' : 'customers'} by phone, email, VIN, plate and name and found no two that match.
        </EmptyBlock>
      ) : (
        <>
          <p className="text-[0.9375rem]" aria-live="polite">
            <span className="num font-bold">{meta.total}</span> {meta.total === 1 ? 'pair' : 'pairs'} found among <span className="num">{meta.checked}</span> customers.
            {meta.total > pairs.length && <> Showing the {pairs.length} most likely.</>}
          </p>
          <ul className="ledger" aria-label="Possible duplicates">
            {pairs.map((p, i) => (
              <li key={`${p.a.id}-${p.b.id}`}>
                <button type="button" className="ledger-row w-full text-left" onClick={() => setOpen(i)} aria-label={`Compare ${nameOf(p.a)} and ${nameOf(p.b)}. ${reasonLine(p)}.`}>
                  <span className="ledger-main">
                    <span className="block break-words font-bold">{nameOf(p.a)} and {nameOf(p.b)}</span>
                    <span className="mt-0.5 block break-words text-[0.9375rem] text-text-secondary">{reasonLine(p)}</span>
                    <span className="mt-0.5 flex items-center gap-1.5 text-[0.9375rem] font-bold">
                      <span className={`lamp ${p.strength === 'strong' ? 'lamp-amber' : 'lamp-off'}`} aria-hidden="true" />
                      {p.strength === 'strong' ? 'Likely the same person' : 'Worth a look'}
                    </span>
                  </span>
                  <Icon name="chevronRight" className="h-5 w-5 shrink-0 text-text-secondary" />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
