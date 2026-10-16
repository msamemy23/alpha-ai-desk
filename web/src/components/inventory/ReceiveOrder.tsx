'use client'
import { useMemo, useState } from 'react'
import { Field } from '@/components/forms/Field'
import FormActions from '@/components/forms/FormActions'
import FormError from '@/components/forms/FormError'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import Sheet from '@/components/Sheet'
import { newKey } from '@/lib/client-api'
import { billOutcomeWords, checkReceipt, COST_METHODS, PO_STATUS_LABEL, receiptAmount } from '@/lib/inventory-logic'
import type { BillOutcome, CostMethod, PoStatus, PurchaseOrder, StockPart } from '@/lib/inventory-logic'
import { parseCount, parseMoney, roundCents } from '@/lib/list-logic'
import type { StockAct } from './useStock'
import { usd } from '@/lib/inventory-view'

/**
 * Check in a delivery: how many of each part arrived. Counts on the shelf go up, "on order" goes down by the same amount, and the cost
 * changes only the way the person picks. The delivery has a key made when this opens, so a second tap or a retry after a dropped
 * connection counts it once.
 */
export default function ReceiveOrder({ po, parts, act, canBill, onClose, onDone }: {
  po: PurchaseOrder
  parts: StockPart[]
  act: StockAct
  /** The signed-in person may enter bills in Accounting (owner, admin, manager). Nobody else is shown the bill choice. */
  canBill: boolean
  onClose: () => void
  onDone: (text: string, warn: string) => void
}) {
  const open = po.lines.filter(l => l.qty > l.qty_received)
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(open.map(l => [l.id, String(l.qty - l.qty_received)])))
  const [method, setMethod] = useState<CostMethod>('keep')
  const [allowOver, setAllowOver] = useState(false)
  const [key] = useState(() => newKey('rcv'))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  // The bill from the vendor. The amount starts as what arrived (cost plus any core charge) and stays whatever the person types.
  const [addBill, setAddBill] = useState(canBill)
  const [billPaid, setBillPaid] = useState(false)
  const [billText, setBillText] = useState<string | null>(null)

  const items = open.map(l => ({ lineId: l.id, qty: parseCount(qty[l.id] ?? '') ?? 0 }))
  const bad = open.filter(l => (qty[l.id] ?? '').trim() !== '' && parseCount(qty[l.id]) === null)
  const check = useMemo(() => checkReceipt(po, items, allowOver), [po, items, allowOver])
  const partOf = (id: string | null) => (id ? parts.find(p => p.id === id) : undefined)
  const pricier = open.filter(l => {
    const p = partOf(l.part_id); const n = parseCount(qty[l.id] ?? '') ?? 0
    return p && n > 0 && l.unit_cost > 0 && roundCents(l.unit_cost) !== roundCents(p.cost ?? 0)
  })
  const units = check.units
  const suggested = useMemo(() => receiptAmount(po, items), [po, items])
  const billShown = billText ?? (suggested > 0 ? suggested.toFixed(2) : '')
  const billAmount = parseMoney(billShown)
  const billBad = addBill && (billAmount === null || billAmount <= 0)

  const submit = async () => {
    if (saving) return
    if (bad.length) { setError(`${bad[0].description}: enter how many arrived as a whole number.`); return }
    if (!check.ok) { setError(check.problems[0] || 'Check the delivery.'); return }
    if (billBad) { setError('Enter the amount on the vendor\'s bill as a number, like 245.50, or turn off adding the bill.'); return }
    setSaving(true); setError('')
    const r = await act<{ status: PoStatus; duplicate: boolean; missing: string[]; bill: BillOutcome | null }>({
      action: 'po-receive', id: po.id,
      receipt: {
        receipt_key: key, items: items.filter(i => i.qty > 0).map(i => ({ line_id: i.lineId, qty: i.qty })), allow_over: allowOver, cost_method: method,
        ...(canBill && addBill ? { bill: { add: true, amount: billAmount, paid: billPaid } } : {}),
      },
    })
    setSaving(false)
    if (r.ok) {
      const gone = r.data.missing?.length ? `${r.data.missing.length === 1 ? 'One part was' : `${r.data.missing.length} parts were`} no longer in your inventory, so only the order was updated for ${r.data.missing.length === 1 ? 'it' : 'them'}.` : ''
      const bill = billOutcomeWords(r.data.bill)
      const warn = [gone, bill].filter(Boolean).join(' ')
      onDone(r.data.duplicate ? `That delivery was already checked in on ${po.po_number}. Nothing was counted twice.${canBill && addBill ? ' If you wanted its bill added, look in Accounting under Bills.' : ''}` : `Checked in ${units} ${units === 1 ? 'part' : 'parts'} on ${po.po_number}. The order is now ${PO_STATUS_LABEL[r.data.status].toLowerCase()}.`, warn)
      return
    }
    setError(r.needsUpdate ? 'Receiving needs a one-time update to your Alpha Desk database first.' : r.message)
  }

  const fillAll = () => setQty(Object.fromEntries(open.map(l => [l.id, String(l.qty - l.qty_received)])))
  const clearAll = () => setQty(Object.fromEntries(open.map(l => [l.id, '0'])))

  return (
    <Sheet open onClose={() => { if (!saving) onClose() }} title={`Receive ${po.po_number}`} wide>
      <form className="space-y-5" noValidate onSubmit={e => { e.preventDefault(); void submit() }}>
        <p className="text-[0.9375rem] text-text-secondary">Count what is in the box, not what was ordered. Enter 0 for anything that did not come. Leave the rest on the order for the next delivery.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary" onClick={fillAll}>Everything arrived</button>
          <button type="button" className="btn btn-ghost" onClick={clearAll}>Clear all</button>
        </div>

        <ul className="space-y-3" aria-label="Parts on this order">
          {po.lines.map(l => {
            const left = l.qty - l.qty_received
            if (left <= 0) {
              return (
                <li key={l.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-3 text-[0.9375rem]">
                  <Icon name="check" className="h-5 w-5 shrink-0 text-green" />
                  <span className="min-w-0 flex-1"><span className="font-bold">{l.description}</span> <span className="num text-text-secondary">All {l.qty} in</span></span>
                </li>
              )
            }
            return (
              <li key={l.id} className="rounded-md border border-border p-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{l.description}</p>
                    <p className="num text-[0.875rem] text-text-secondary">{[l.sku, `ordered ${l.qty}`, l.qty_received > 0 ? `${l.qty_received} in already` : '', `${left} still to come`, `${usd(l.unit_cost)} each`].filter(Boolean).join(' · ')}</p>
                  </div>
                  <div className="w-24 shrink-0">
                    <Field id={`rc-${l.id}`} label="Arrived now"><input id={`rc-${l.id}`} className="form-input num" inputMode="numeric" autoComplete="off" value={qty[l.id] ?? ''} onChange={e => setQty(q => ({ ...q, [l.id]: e.target.value }))} /></Field>
                  </div>
                </div>
                {!l.part_id && <p className="mt-1 text-[0.875rem] text-text-secondary">Not tied to a part in your stock, so only the order is updated.</p>}
              </li>
            )
          })}
        </ul>

        <fieldset className="rounded-md border border-border p-3">
          <legend className="px-1 text-[0.9375rem] font-bold">What should happen to each part&apos;s cost?</legend>
          <div className="space-y-1">
            {[...COST_METHODS].sort((a, b) => Number(b.key === 'keep') - Number(a.key === 'keep')).map(m => (
              <label key={m.key} className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-bg-hover">
                <input type="radio" name="cost-method" className="mt-1 h-5 w-5 shrink-0" checked={method === m.key} onChange={() => setMethod(m.key)} />
                <span><span className="block font-bold">{m.key === 'keep' ? 'Leave the cost alone' : m.label}</span><span className="block text-[0.875rem] text-text-secondary">{m.help}</span></span>
              </label>
            ))}
          </div>
          {pricier.length > 0 && method === 'keep' && (
            <p className="mt-2 text-[0.875rem] text-text-secondary">On this delivery {pricier.length} {pricier.length === 1 ? 'part costs' : 'parts cost'} a different amount than the cost you have stored. Pick one of the other two to update {pricier.length === 1 ? 'it' : 'them'}.</p>
          )}
        </fieldset>

        {canBill && (
          <fieldset className="rounded-md border border-border p-3">
            <legend className="px-1 text-[0.9375rem] font-bold">The vendor&apos;s bill</legend>
            <label className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-md px-2 py-2 hover:bg-bg-hover">
              <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={addBill} onChange={e => setAddBill(e.target.checked)} />
              <span><span className="block font-bold">Add this delivery to my bills in Accounting</span><span className="block text-[0.875rem] text-text-secondary">One bill under Parts bought, with {po.po_number} on it{po.vendor_name ? `, from ${po.vendor_name}` : ''}. Skip this if you enter the vendor&apos;s bill yourself.</span></span>
            </label>
            {addBill && (
              <div className="mt-2 space-y-2 pl-2">
                <Field id="rc-bill" label="Amount on the vendor's bill" hint={suggested > 0 ? `The parts that arrived come to ${usd(suggested)}, cores included. Change it to match the paper bill (freight, tax).` : 'Type the total from the paper bill.'} error={billBad ? 'Enter the amount as a number, like 245.50.' : undefined}>
                  <input id="rc-bill" className="form-input num" inputMode="decimal" autoComplete="off" value={billShown} onChange={e => setBillText(e.target.value)} placeholder="0.00" {...(billBad ? { 'aria-invalid': true as const, 'aria-describedby': 'rc-bill-err' } : {})} />
                </Field>
                <label className="flex min-h-[44px] cursor-pointer items-center gap-3 px-1"><input type="checkbox" className="h-5 w-5" checked={billPaid} onChange={e => setBillPaid(e.target.checked)} /><span>Already paid today<span className="block text-[0.875rem] text-text-secondary">Leave this off for a bill you still owe. It then shows under Bills to pay.</span></span></label>
              </div>
            )}
          </fieldset>
        )}

        {check.over.length > 0 && (
          <Notice kind="warn">
            <p className="font-bold">More than was ordered</p>
            <ul className="mt-1 list-disc pl-5">{check.over.map(o => <li key={o.lineId}>{o.description}: <span className="num">{o.wouldBe}</span> would be in against <span className="num">{o.ordered}</span> ordered</li>)}</ul>
            <label className="mt-2 flex min-h-[44px] cursor-pointer items-center gap-3"><input type="checkbox" className="h-5 w-5" checked={allowOver} onChange={e => setAllowOver(e.target.checked)} /><span className="font-bold">The vendor really sent the extra</span></label>
          </Notice>
        )}
        {error && <FormError>{error}</FormError>}

        <FormActions>
          <button type="submit" className="btn btn-primary" disabled={saving || units === 0 || billBad}><Icon name="box" className="h-5 w-5" />{saving ? 'Checking in…' : units > 0 ? `Check in ${units} ${units === 1 ? 'part' : 'parts'}` : 'Check in'}</button>
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
        </FormActions>
      </form>
    </Sheet>
  )
}
