'use client'
import { useMemo, useState } from 'react'
import { Field } from '@/components/forms/Field'
import Icon from '@/components/Icon'
import { SearchField } from '@/components/ListKit'
import Notice from '@/components/Notice'
import { priceAge } from '@/lib/inventory-logic'
import type { StockPart, Vendor, VendorPrice } from '@/lib/inventory-logic'
import { normPart, parseMoney } from '@/lib/list-logic'
import type { StockAct } from './useStock'
import { dayWords, needsBanner, usd } from '@/lib/inventory-view'

/**
 * What one vendor charges for the parts in your stock. The Reorder list and new orders start from these prices, and a price nobody has
 * checked in four months is marked so it is not trusted blindly.
 *
 * This sits inside the vendor's form, so it is not a form of its own: a form inside a form is invalid HTML and the browser sends the outer
 * one (the page reloads). The Save price button saves the price, and so does Enter in a price box.
 */
export default function VendorPrices({ vendor, parts, prices, today, canEdit, act }: {
  vendor: Vendor
  parts: StockPart[]
  prices: VendorPrice[]
  today: string
  canEdit: boolean
  act: StockAct
}) {
  const mine = useMemo(() => prices.filter(p => p.vendor_id === vendor.id).map(p => ({ p, part: parts.find(x => x.id === p.part_id) })).sort((a, b) => (a.part?.name || '').localeCompare(b.part?.name || '')), [prices, vendor.id, parts])
  const [find, setFind] = useState('')
  const [part, setPart] = useState<StockPart | null>(null)
  const [sku, setSku] = useState('')
  const [price, setPrice] = useState('')
  const [core, setCore] = useState('')
  const [checked, setChecked] = useState(today)
  const [error, setError] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState<VendorPrice | null>(null)
  const [busy, setBusy] = useState(false)
  const [removeError, setRemoveError] = useState('')

  const query = find.trim().toLowerCase()
  const matches = useMemo(() => {
    const words = query.split(/\s+/).filter(Boolean)
    if (!words.length || part) return []
    return parts.filter(p => { const hay = [p.name, p.part_number, p.supplier_part_number, p.brand].join(' ').toLowerCase(); return words.every(w => hay.includes(w) || normPart(hay).includes(normPart(w))) }).slice(0, 6)
  }, [parts, query, part])

  const pick = (p: StockPart, existing?: VendorPrice) => {
    setPart(p); setFind(''); setError(''); setFields({})
    setSku(existing?.vendor_sku || p.supplier_part_number || ''); setPrice(existing ? existing.price.toFixed(2) : ''); setCore(existing && existing.core_charge > 0 ? existing.core_charge.toFixed(2) : ''); setChecked(today)
  }
  const reset = () => { setPart(null); setSku(''); setPrice(''); setCore(''); setChecked(today); setError(''); setFields({}) }

  const save = async () => {
    if (!part || saving) return
    const n = parseMoney(price)
    if (n === null || n < 0) { setFields({ price: 'Enter the price as a number, like 12.50.' }); return }
    setSaving(true); setError(''); setFields({})
    const r = await act({ action: 'price-save', price: { vendor_id: vendor.id, part_id: part.id, vendor_sku: sku, price: n, core_charge: core.trim() === '' ? 0 : parseMoney(core) ?? 0, checked_on: checked } })
    setSaving(false)
    if (r.ok) { reset(); return }
    setFields(r.fields); setError(r.needsUpdate ? 'Vendor prices need a one-time update to your Alpha Desk database first.' : needsBanner(r.fields, ['price', 'core_charge']) ? r.message : '')
  }

  const remove = async () => {
    if (!removing) return
    setBusy(true); setRemoveError('')
    const r = await act({ action: 'price-remove', id: removing.id })
    setBusy(false)
    if (r.ok) setRemoving(null)
    else setRemoveError(r.message)
  }

  return (
    <div>
      {mine.length === 0 ? (
        <p className="text-[0.9375rem] text-text-secondary">No prices saved for {vendor.name} yet. {canEdit ? 'Add the ones you buy often. The Reorder list then picks the cheapest vendor for each part.' : ''}</p>
      ) : (
        <ul className="ledger" aria-label={`Prices from ${vendor.name}`}>
          {mine.map(({ p, part: pt }) => {
            const age = priceAge(p.checked_on, today)
            return (
              <li key={p.id}>
                <div className="flex items-start gap-2 py-3">
                  <button type="button" className="min-w-0 flex-1 text-left disabled:cursor-default" disabled={!canEdit || !pt} onClick={() => pt && pick(pt, p)}>
                    <span className="block font-bold">{pt?.name || 'A part that was removed'}</span>
                    <span className="num block text-[0.875rem] text-text-secondary">{[p.vendor_sku, p.core_charge > 0 ? `plus ${usd(p.core_charge)} core` : '', p.checked_on ? `checked ${dayWords(p.checked_on, today)}` : 'never checked'].filter(Boolean).join(' · ')}</span>
                    {age.stale && <span className="block text-[0.875rem] font-bold text-amber">{age.days === null ? 'No check date' : `Checked ${age.days} days ago`}. Confirm it is still right.</span>}
                  </button>
                  <p className="num shrink-0 font-bold">{usd(p.price)}</p>
                  {canEdit && <button type="button" className="btn-icon shrink-0" onClick={() => { setRemoveError(''); setRemoving(p) }} aria-label={`Remove the price for ${pt?.name || 'this part'}`}><Icon name="trash" className="h-5 w-5" /></button>}
                </div>
                {removing?.id === p.id && (
                  <div className="mb-3 rounded-md border border-border bg-bg-card px-3 py-3 text-[0.9375rem]" role="group" aria-label="Confirm removing this price">
                    <p>Take {vendor.name}&apos;s price for {pt?.name || 'this part'} out of your comparison? The part and past orders are not touched, and you can add the price again.</p>
                    {removeError && <p role="alert" className="form-error">{removeError}</p>}
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" className="btn btn-danger" onClick={() => void remove()} disabled={busy}>{busy ? 'Removing…' : 'Remove price'}</button>
                      <button type="button" className="btn btn-secondary" onClick={() => setRemoving(null)} disabled={busy}>Keep it</button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}

      {canEdit && (
        <div className="mt-4 rounded-md border border-border p-3">
          <p className="mb-2 font-bold">{part ? `Price for ${part.name}` : 'Add or change a price'}</p>
          {!part ? (
            <>
              <SearchField label="Search your stock for a part" placeholder="Search your stock by name or part number" value={find} onChange={setFind} />
              {query && (matches.length ? (
                <ul className="ledger mt-2" aria-label="Parts that match">
                  {matches.map(p => (
                    <li key={p.id}><button type="button" className="ledger-row w-full text-left" onClick={() => pick(p, prices.find(x => x.vendor_id === vendor.id && x.part_id === p.id))}><span className="ledger-main"><span className="ledger-title block !whitespace-normal">{p.name}</span><span className="ledger-sub block !whitespace-normal">{[p.part_number, p.brand].filter(Boolean).join(' · ')}</span></span></button></li>
                  ))}
                </ul>
              ) : <p className="mt-2 text-[0.9375rem] text-text-secondary">Nothing in your stock matches.</p>)}
            </>
          ) : (
            <div
              className="space-y-3" role="group" aria-label={`Price for ${part.name}`}
              onKeyDown={e => { if (e.key === 'Enter' && (e.target as HTMLElement).tagName === 'INPUT') { e.preventDefault(); void save() } }}
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field id="vp-sku" label="Vendor part number"><input id="vp-sku" className="form-input" autoComplete="off" autoCapitalize="characters" value={sku} onChange={e => setSku(e.target.value)} /></Field>
                <Field id="vp-price" label="Price each" error={fields.price}><input id="vp-price" className="form-input num" inputMode="decimal" autoComplete="off" value={price} onChange={e => setPrice(e.target.value)} placeholder="0.00" /></Field>
                <Field id="vp-core" label="Core charge" error={fields.core_charge}><input id="vp-core" className="form-input num" inputMode="decimal" autoComplete="off" value={core} onChange={e => setCore(e.target.value)} placeholder="0.00" /></Field>
                <Field id="vp-checked" label="Price checked on"><input id="vp-checked" type="date" className="form-input" value={checked} onChange={e => setChecked(e.target.value)} /></Field>
              </div>
              {error && <Notice kind="error">{error}</Notice>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : 'Save price'}</button>
                <button type="button" className="btn btn-secondary" onClick={reset} disabled={saving}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

    </div>
  )
}
