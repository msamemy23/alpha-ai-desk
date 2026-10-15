'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import { supabase, getShopId, calcTotals, formatCurrency } from '@/lib/supabase'

interface CustomerHit { id: string; name: string; phone: string | null; vehicle: string }
interface DocHit { id: string; type: string; doc_number: string; customer_name: string; total: number; status: string }

// Characters that have meaning inside a PostgREST filter string.
const clean = (q: string) => q.replace(/[,()%*\\"'`:;]/g, ' ').replace(/\s+/g, ' ').trim()

export function docHref(type: string, id: string) {
  return `${type === 'Estimate' ? '/estimates' : '/invoices'}?document=${encodeURIComponent(id)}`
}

/** Search customers and paperwork in one box. Used by the desktop top bar and the phone search sheet. */
export default function SearchPanel({ onNavigate, autoFocus = false }: { onNavigate: () => void; autoFocus?: boolean }) {
  const [q, setQ] = useState('')
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
  const empty = term.length >= 2 && !busy && !failed && customers.length === 0 && docs.length === 0

  return (
    <div>
      <label className="relative block">
        <span className="sr-only">Search customers, estimates and invoices</span>
        <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted" />
        <input
          autoFocus={autoFocus}
          type="search"
          inputMode="search"
          autoComplete="off"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Name, phone, or invoice number"
          className="form-input pl-10"
        />
      </label>

      <div className="mt-3" aria-live="polite">
        {term.length < 2 && <p className="px-1 py-3 text-[0.9375rem] text-text-secondary">Type a customer name, a phone number, or an invoice number.</p>}
        {busy && <p className="px-1 py-3 text-[0.9375rem] text-text-secondary">Searching…</p>}
        {failed && <p className="px-1 py-3 text-[0.9375rem] text-red">Search could not run. Check your connection and try again.</p>}
        {empty && <p className="px-1 py-3 text-[0.9375rem] text-text-secondary">Nothing matches “{term}”. Try fewer letters, or the last four digits of a phone number.</p>}

        {customers.length > 0 && (
          <section className="mb-3">
            <h3 className="px-1 pb-1 text-[0.8125rem] font-bold text-text-secondary">Customers</h3>
            <ul className="ledger">
              {customers.map(c => (
                <li key={c.id}>
                  <Link href={`/customers?q=${encodeURIComponent(c.name)}`} onClick={onNavigate} className="ledger-row">
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
                  <Link href={docHref(d.type, d.id)} onClick={onNavigate} className="ledger-row">
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
    </div>
  )
}
