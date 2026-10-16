'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import ConfirmSheet from '@/components/forms/ConfirmSheet'
import { Field, Section } from '@/components/forms/Field'
import FormActions from '@/components/forms/FormActions'
import FormError from '@/components/forms/FormError'
import Icon from '@/components/Icon'
import { SearchField } from '@/components/ListKit'
import Notice from '@/components/Notice'
import Sheet from '@/components/Sheet'
import { checkPo, poTotals } from '@/lib/inventory-logic'
import type { PartExtra, StockPart, Vendor, VendorPrice } from '@/lib/inventory-logic'
import { normPart, parseCount, parseMoney } from '@/lib/list-logic'
import { lineForPart, lineKey, usd } from '@/lib/inventory-view'
import type { LineForm, OrderSeed } from '@/lib/inventory-view'
import type { StockAct } from './useStock'

const OTHER = '__other'
const parsed = (lines: LineForm[]) => lines.map(l => ({
  part_id: l.part_id, description: l.description, sku: l.sku, qty: parseCount(l.qty) ?? NaN, unit_cost: parseMoney(l.unit_cost) ?? NaN, core_charge: l.core_charge.trim() === '' ? 0 : (parseMoney(l.core_charge) ?? NaN),
}))

/**
 * Write or change a draft purchase order: who it goes to, what and how many, what each costs. Nothing is sent from here; saving keeps it
 * as a draft. Costs start from the vendor's price for the part when one is saved, and can be changed.
 */
export default function OrderEditor({
  seed, parts, vendors, prices, extras, act, onClose, onSaved,
}: {
  seed: OrderSeed
  parts: StockPart[]
  vendors: Vendor[]
  prices: VendorPrice[]
  extras: Map<string, PartExtra>
  act: StockAct
  onClose: () => void
  onSaved: (id: string, number: string) => void
}) {
  const known = vendors.some(v => v.id === seed.vendor_id)
  const [vendorPick, setVendorPick] = useState(seed.vendor_id && known ? seed.vendor_id : seed.vendor_name ? OTHER : '')
  const [otherName, setOtherName] = useState(seed.vendor_id && known ? '' : seed.vendor_name)
  const [expected, setExpected] = useState(seed.expected_on)
  const [notes, setNotes] = useState(seed.notes)
  const [lines, setLines] = useState<LineForm[]>(seed.lines)
  const [find, setFind] = useState('')
  const [problems, setProblems] = useState<string[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [asking, setAsking] = useState(false)
  const alertRef = useRef<HTMLDivElement>(null)

  const baseline = useMemo(() => JSON.stringify([seed.vendor_id && known ? seed.vendor_id : seed.vendor_name ? OTHER : '', seed.vendor_id && known ? '' : seed.vendor_name, seed.expected_on, seed.notes, seed.lines]), [seed, known])
  const dirty = JSON.stringify([vendorPick, otherName, expected, notes, lines]) !== baseline

  // On a phone the message is below the parts, out of sight from the Save button. Bring it into view when it appears.
  useEffect(() => { if (problems.length || error) alertRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }) }, [problems, error])

  const vendorId = vendorPick && vendorPick !== OTHER ? vendorPick : ''
  const picks = useMemo(() => vendors.filter(v => v.active || v.id === seed.vendor_id), [vendors, seed.vendor_id])
  const totals = useMemo(() => poTotals(parsed(lines).map(l => ({ qty: Number.isFinite(l.qty) ? l.qty : 0, unit_cost: Number.isFinite(l.unit_cost) ? l.unit_cost : 0, core_charge: Number.isFinite(l.core_charge) ? l.core_charge : 0, qty_received: 0 }))), [lines])

  const query = find.trim().toLowerCase()
  const matches = useMemo(() => {
    const words = query.split(/\s+/).filter(Boolean)
    if (!words.length) return []
    return parts.filter(p => {
      const hay = [p.name, p.part_number, p.supplier_part_number, p.brand, p.category].join(' ').toLowerCase()
      const squashed = normPart(hay)
      return words.every(w => hay.includes(w) || squashed.includes(normPart(w)))
    }).slice(0, 6)
  }, [parts, query])

  const setLine = (key: string, patch: Partial<LineForm>) => setLines(ls => ls.map(l => (l.key === key ? { ...l, ...patch } : l)))
  const addPart = (p: StockPart) => {
    setLines(ls => {
      const same = ls.find(l => l.part_id === p.id)
      if (same) return ls.map(l => (l.key === same.key ? { ...l, qty: String((parseCount(l.qty) ?? 0) + 1) } : l))
      return [...ls, lineForPart(p, vendorId, prices, extras)]
    })
    setFind('')
  }
  const addFree = () => { setLines(ls => [...ls, { key: lineKey(), part_id: null, description: '', sku: '', qty: '1', unit_cost: '', core_charge: '' }]); setFind('') }

  const check = (): string[] => {
    const out: string[] = []
    const p = parsed(lines)
    lines.forEach((l, i) => {
      if (l.description.trim() && l.unit_cost.trim() === '') out.push(`Line ${i + 1} (${l.description.trim()}): enter what one costs, like 12.50.`)
      else if (l.description.trim() && !Number.isFinite(p[i].qty)) out.push(`Line ${i + 1} (${l.description.trim()}): the quantity must be a whole number, 1 or more.`)
      else if (l.description.trim() && !Number.isFinite(p[i].unit_cost)) out.push(`Line ${i + 1} (${l.description.trim()}): enter what one costs, like 12.50.`)
      else if (l.description.trim() && !Number.isFinite(p[i].core_charge)) out.push(`Line ${i + 1} (${l.description.trim()}): the core charge must be a number, like 25.00.`)
    })
    if (out.length) return out
    const v = checkPo({ vendor_id: vendorId, vendor_name: vendorId ? '' : otherName, notes, expected_on: expected, lines: p })
    return v.ok ? [] : v.errors
  }

  const save = async () => {
    if (saving) return
    const found = check()
    setProblems(found)
    setError('')
    if (found.length) return
    setSaving(true)
    const r = await act<{ id: string; po_number: string }>({
      action: 'po-save', id: seed.id || undefined,
      po: { vendor_id: vendorId, vendor_name: vendorId ? '' : otherName, notes, expected_on: expected, lines: parsed(lines) },
    })
    setSaving(false)
    if (r.ok) { onSaved(r.data.id, r.data.po_number); return }
    setError(r.needsUpdate ? 'Purchase orders need a one-time update to your Alpha Desk database before they can be saved.' : r.message)
  }

  const requestClose = () => { if (dirty) setAsking(true); else onClose() }
  const hasLines = lines.length > 0

  return (
    <>
      <Sheet open={!asking} onClose={requestClose} title={seed.id ? 'Change order' : 'New order'} wide dirty={dirty}>
        <form className="space-y-5" noValidate onSubmit={e => { e.preventDefault(); void save() }}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field id="po-vendor" label="Vendor (required)">
              <select id="po-vendor" className="form-select" value={vendorPick} onChange={e => setVendorPick(e.target.value)}>
                <option value="">Choose a vendor</option>
                {picks.map(v => <option key={v.id} value={v.id}>{v.name}{v.active ? '' : ' (archived)'}</option>)}
                <option value={OTHER}>Another vendor (type the name)</option>
              </select>
            </Field>
            {vendorPick === OTHER ? (
              <Field id="po-vendor-name" label="Vendor name" hint="This vendor is not in your list, so there is no email on file. You can still print the order or mark it sent after you place it.">
                <input id="po-vendor-name" className="form-input" autoComplete="off" value={otherName} onChange={e => setOtherName(e.target.value)} />
              </Field>
            ) : (
              <Field id="po-expected" label="Needed by">
                <input id="po-expected" type="date" className="form-input" value={expected} onChange={e => setExpected(e.target.value)} />
              </Field>
            )}
            {vendorPick === OTHER && (
              <Field id="po-expected" label="Needed by">
                <input id="po-expected" type="date" className="form-input" value={expected} onChange={e => setExpected(e.target.value)} />
              </Field>
            )}
            <Field id="po-notes" label="Note for the vendor" className="sm:col-span-2">
              <textarea id="po-notes" className="form-textarea" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Deliver to the back door, call before dropping off" />
            </Field>
          </div>

          <Section title="Parts on this order">
            {hasLines ? (
              <ul className="space-y-3" aria-label="Parts on this order">
                {lines.map((l, i) => (
                  <li key={l.key} className="rounded-md border border-border p-3">
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <label className="form-label" htmlFor={`po-d-${l.key}`}>Part {i + 1}{l.part_id ? ' (from your stock)' : ''}</label>
                        <input id={`po-d-${l.key}`} className="form-input" autoComplete="off" value={l.description} onChange={e => setLine(l.key, { description: e.target.value })} placeholder="Describe the part" />
                      </div>
                      <button type="button" className="btn-icon mt-6 shrink-0" onClick={() => setLines(ls => ls.filter(x => x.key !== l.key))} aria-label={`Take ${l.description || `part ${i + 1}`} off the order`}><Icon name="trash" className="h-5 w-5" /></button>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                      <Field id={`po-s-${l.key}`} label="Vendor part number"><input id={`po-s-${l.key}`} className="form-input" autoComplete="off" autoCapitalize="characters" value={l.sku} onChange={e => setLine(l.key, { sku: e.target.value })} /></Field>
                      <Field id={`po-q-${l.key}`} label="Quantity"><input id={`po-q-${l.key}`} className="form-input num" inputMode="numeric" autoComplete="off" value={l.qty} onChange={e => setLine(l.key, { qty: e.target.value })} /></Field>
                      <Field id={`po-c-${l.key}`} label="Each"><input id={`po-c-${l.key}`} className="form-input num" inputMode="decimal" autoComplete="off" value={l.unit_cost} onChange={e => setLine(l.key, { unit_cost: e.target.value })} placeholder="0.00" /></Field>
                      <Field id={`po-k-${l.key}`} label="Core charge"><input id={`po-k-${l.key}`} className="form-input num" inputMode="decimal" autoComplete="off" value={l.core_charge} onChange={e => setLine(l.key, { core_charge: e.target.value })} placeholder="0.00" /></Field>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[0.9375rem] text-text-secondary">No parts yet. Search your stock below, or add one that is not in your stock.</p>
            )}

            <div className="mt-4">
              <SearchField label="Search your stock to add a part" placeholder="Search your stock by name or part number" value={find} onChange={setFind} />
              {query && (
                matches.length ? (
                  <ul className="ledger mt-2" aria-label="Parts that match">
                    {matches.map(p => (
                      <li key={p.id}>
                        <button type="button" className="ledger-row w-full text-left" onClick={() => addPart(p)}>
                          <span className="ledger-main">
                            <span className="ledger-title block !whitespace-normal">{p.name}</span>
                            <span className="ledger-sub num block !whitespace-normal">{[p.part_number, `${p.qty_on_hand ?? 0} on hand`, (p.qty_on_order ?? 0) > 0 ? `${p.qty_on_order} on order` : '', p.cost ? `cost ${usd(p.cost)}` : ''].filter(Boolean).join(' · ')}</span>
                          </span>
                          <span className="inline-flex items-center gap-1 font-bold text-blue"><Icon name="plus" className="h-5 w-5" />Add</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : <p className="mt-2 text-[0.9375rem] text-text-secondary">Nothing in your stock matches. You can add it as a new line instead.</p>
              )}
              <button type="button" className="btn btn-secondary mt-3" onClick={addFree}><Icon name="plus" className="h-5 w-5" />Add a part that is not in stock</button>
            </div>
          </Section>

          {hasLines && (
            <div className="rounded-md border border-border bg-bg-card px-4 py-3 text-[0.9375rem]" aria-live="polite">
              <p className="num"><span className="font-bold">{totals.units}</span> {totals.units === 1 ? 'part' : 'parts'} · subtotal <span className="font-bold">{usd(totals.subtotal)}</span>{totals.cores > 0 ? <> · core charges <span className="font-bold">{usd(totals.cores)}</span></> : null}</p>
              <p className="num mt-0.5 text-[1.0625rem]">Order total <span className="display font-bold">{usd(totals.total)}</span></p>
            </div>
          )}

          <div ref={alertRef} className="space-y-3 empty:hidden">
          {problems.length > 0 && (
            <Notice kind="error">
              <p className="font-bold">Fix this before saving</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">{problems.map(p => <li key={p}>{p}</li>)}</ul>
            </Notice>
          )}
          {error && <FormError>{error}</FormError>}
          </div>

          <FormActions>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save draft'}</button>
            <button type="button" className="btn btn-secondary" onClick={requestClose} disabled={saving}>Cancel</button>
            <p className="hidden text-[0.875rem] text-text-secondary sm:ml-auto sm:block">Saving keeps it as a draft. Nothing is sent until you review and send it.</p>
          </FormActions>
        </form>
      </Sheet>
      <ConfirmSheet open={asking} title="Discard your changes?" confirmLabel="Discard changes" cancelLabel="Keep editing" onConfirm={onClose} onCancel={() => setAsking(false)}>
        <p>You typed changes to this order that are not saved yet. If you leave now they are lost.</p>
      </ConfirmSheet>
    </>
  )
}
