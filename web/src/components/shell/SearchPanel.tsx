'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import { supabase, getShopId, calcTotals, formatCurrency } from '@/lib/supabase'
import { matchCommands, startingCommands } from './commands'
import type { Command } from './commands'

interface CustomerHit { id: string; name: string; phone: string | null; vehicle: string }
interface DocHit { id: string; type: string; doc_number: string; customer_name: string; total: number; status: string }

// Characters that have meaning inside a PostgREST filter string.
const clean = (q: string) => q.replace(/[,()%*\\"'`:;]/g, ' ').replace(/\s+/g, ' ').trim()

export function docHref(type: string, id: string) {
  return `${type === 'Estimate' ? '/estimates' : '/invoices'}?document=${encodeURIComponent(id)}`
}

/** One row in the command list: a page or action, with its shortcut on a wide screen. */
function CommandRow({ c, onNavigate, onTheme }: { c: Command; onNavigate: () => void; onTheme: () => void }) {
  const body = (
    <>
      <Icon name={c.icon} className="h-5 w-5 shrink-0 text-text-muted" />
      <span className="ledger-main"><span className="ledger-title block">{c.label}</span></span>
      {c.keys && <span className="num hidden shrink-0 text-[0.8125rem] text-text-secondary sm:inline">{c.keys}</span>}
    </>
  )
  if (c.href) return <Link href={c.href} onClick={onNavigate} className="ledger-row" data-result>{body}</Link>
  return <button type="button" className="ledger-row w-full text-left" data-result onClick={() => { onTheme(); onNavigate() }}>{body}</button>
}

/**
 * The command menu and search in one box. Used by the desktop top bar and the phone search sheet, and opened with
 * Ctrl or Cmd+K. Type a page or action to jump to it, or a name, phone number or invoice number to find a record.
 * Up and down move through the results, Enter opens the first one (or the one you are on).
 */
export default function SearchPanel({ onNavigate, autoFocus = false, commands = [], onTheme = () => {}, recent = [], current = '' }: {
  onNavigate: () => void
  autoFocus?: boolean
  commands?: Command[]
  onTheme?: () => void
  /** Page addresses opened lately, newest first. */
  recent?: string[]
  /** The page the person is on now, left out of Recent. */
  current?: string
}) {
  const [q, setQ] = useState('')
  const root = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [customers, setCustomers] = useState<CustomerHit[]>([])
  const [docs, setDocs] = useState<DocHit[]>([])
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    const term = clean(q)
    if (term.length < 2) { setCustomers([]); setDocs([]); setBusy(false); setFailed(false); return }
    const mine = ++seq.current
    setBusy(true)
    const t = setTimeout(async () => {
      try {
        const shopId = await getShopId()
        if (!shopId) throw new Error('no shop')
        const like = `%${term}%`
        const [c, d] = await Promise.all([
          supabase.from('customers').select('id,name,phone,vehicle_year,vehicle_make,vehicle_model')
            .eq('shop_id', shopId).or(`name.ilike.${like},phone.ilike.${like},email.ilike.${like}`).order('name').limit(6),
          supabase.from('documents').select('id,type,doc_number,status,customer_name,parts,labors,tax_rate,apply_tax,shop_supplies,amount_paid')
            .eq('shop_id', shopId).or(`customer_name.ilike.${like},doc_number.ilike.${like}`).order('created_at', { ascending: false }).limit(6),
        ])
        if (mine !== seq.current) return
        if (c.error && d.error) throw c.error
        setCustomers((c.data || []).map((r: Record<string, unknown>) => ({
          id: String(r.id), name: String(r.name || 'Unnamed'), phone: (r.phone as string) || null,
          vehicle: [r.vehicle_year, r.vehicle_make, r.vehicle_model].filter(Boolean).join(' '),
        })))
        setDocs((d.data || []).map((r: Record<string, unknown>) => ({
          id: String(r.id), type: String(r.type), doc_number: String(r.doc_number || ''), customer_name: String(r.customer_name || ''),
          status: String(r.status || ''), total: calcTotals(r).total,
        })))
        setFailed(false)
      } catch {
        if (mine === seq.current) setFailed(true)
      } finally {
        if (mine === seq.current) setBusy(false)
      }
    }, 220)
    return () => clearTimeout(t)
  }, [q])

  const term = clean(q)
  const typed = q.trim().length > 0
  const found = useMemo(() => matchCommands(commands, q), [commands, q])
  const starting = useMemo(() => startingCommands(commands, recent, current), [commands, recent, current])
  const shown = typed ? found : starting
  const empty = term.length >= 2 && !busy && !failed && shown.length === 0 && customers.length === 0 && docs.length === 0

  const results = () => Array.from(root.current?.querySelectorAll<HTMLElement>('[data-result]') ?? [])
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const list = results()
      if (list.length === 0) return
      e.preventDefault()
      const at = list.indexOf(document.activeElement as HTMLElement)
      if (e.key === 'ArrowDown') list[Math.min(list.length - 1, at + 1)]?.focus()
      else if (at <= 0) input.current?.focus()
      else list[at - 1]?.focus()
    } else if (e.key === 'Enter' && e.target === input.current) {
      const first = results()[0]
      if (first) { e.preventDefault(); first.click() }
    }
  }

  return (
    <div ref={root} onKeyDown={onKeyDown}>
      <label className="relative block">
        <span className="sr-only">Search, or jump to a page or action</span>
        <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted" />
        <input
          ref={input}
          autoFocus={autoFocus}
          type="search"
          inputMode="search"
          autoComplete="off"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder={commands.length > 0 ? 'Search, or jump to a page' : 'Name, phone, or invoice number'}
          className="form-input pl-10"
        />
      </label>

      <div className="mt-3" aria-live="polite">
        {term.length < 2 && !typed && <p className="px-1 pb-3 text-[0.9375rem] text-text-secondary">Jump to a page, start something, or type a customer name, a phone number, or an invoice number.</p>}
        {shown.length > 0 && (
          <section className="mb-3" aria-label={typed ? 'Pages and actions' : 'Quick start'}>
            {(typed ? [''] : ['Recent', 'Write', 'Go to', 'Switch']).map(g => {
              const rows = typed ? shown : shown.filter(c => c.group === g)
              if (rows.length === 0) return null
              return (
                <div key={g || 'found'} className="mb-3 last:mb-0">
                  <h3 className="px-1 pb-1 text-[0.8125rem] font-bold text-text-secondary">{typed ? 'Pages and actions' : g}</h3>
                  <ul className="ledger">
                    {rows.map(c => <li key={c.id}><CommandRow c={c} onNavigate={onNavigate} onTheme={onTheme} /></li>)}
                  </ul>
                </div>
              )
            })}
          </section>
        )}
        {busy && <p className="px-1 py-3 text-[0.9375rem] text-text-secondary">Searching…</p>}
        {failed && <p className="px-1 py-3 text-[0.9375rem] text-red">Search could not run. Check your connection and try again.</p>}
        {empty && <p className="px-1 py-3 text-[0.9375rem] text-text-secondary">Nothing matches “{term}”. Try fewer letters, or the last four digits of a phone number.</p>}

        {customers.length > 0 && (
          <section className="mb-3">
            <h3 className="px-1 pb-1 text-[0.8125rem] font-bold text-text-secondary">Customers</h3>
            <ul className="ledger">
              {customers.map(c => (
                <li key={c.id}>
                  <Link href={`/customers?q=${encodeURIComponent(c.name)}`} onClick={onNavigate} className="ledger-row" data-result>
                    <Icon name="user" className="h-5 w-5 shrink-0 text-text-muted" />
                    <span className="ledger-main">
                      <span className="ledger-title block">{c.name}</span>
                      <span className="ledger-sub block">{[c.phone, c.vehicle].filter(Boolean).join('  ·  ') || 'No phone or vehicle yet'}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        {docs.length > 0 && (
          <section>
            <h3 className="px-1 pb-1 text-[0.8125rem] font-bold text-text-secondary">Estimates and invoices</h3>
            <ul className="ledger">
              {docs.map(d => (
                <li key={d.id}>
                  <Link href={docHref(d.type, d.id)} onClick={onNavigate} className="ledger-row" data-result>
                    <Icon name={d.type === 'Estimate' ? 'doc' : 'invoice'} className="h-5 w-5 shrink-0 text-text-muted" />
                    <span className="ledger-main">
                      <span className="ledger-title block">{d.customer_name || 'No customer'}</span>
                      <span className="ledger-sub block">{d.doc_number}  ·  {d.status}</span>
                    </span>
                    <span className="ledger-amt">{formatCurrency(d.total)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
      {commands.length > 0 && <p className="mt-3 hidden px-1 text-[0.8125rem] text-text-secondary sm:block">Up and down arrows move, Enter opens, Esc closes.</p>}
    </div>
  )
}
