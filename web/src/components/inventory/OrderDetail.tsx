'use client'
import { useState } from 'react'
import Icon from '@/components/Icon'
import { Pill } from '@/components/ListKit'
import Notice from '@/components/Notice'
import Sheet from '@/components/Sheet'
import FormActions from '@/components/forms/FormActions'
import { copyText, openPrintable, saveText } from '@/components/reports/files'
import { PO_STATUS_LABEL, poCsv, poHtml, poMessage, poTotals } from '@/lib/inventory-logic'
import type { PoStatus, PurchaseOrder, ShopFacts, Vendor } from '@/lib/inventory-logic'
import { dayWords, daysBetween, usd } from '@/lib/inventory-view'

export const STATUS_LAMP: Record<PoStatus, 'green' | 'amber' | 'red' | 'blue' | 'off'> = { draft: 'off', sent: 'blue', partial: 'amber', received: 'green', cancelled: 'off' }

/** Waiting on the vendor and past the date it was needed. */
export const isLate = (po: PurchaseOrder, today: string): boolean => (po.status === 'sent' || po.status === 'partial') && !!po.expected_on && po.expected_on < today

/** One order in full: who, when, every line with what has come in, and what can be done with it right now. */
export default function OrderDetail({
  po, vendor, shop, today, canBuy, canAdjust, onClose, onEdit, onSend, onMarkSent, onCancel, onReceive,
}: {
  po: PurchaseOrder
  vendor: Vendor | null
  shop: ShopFacts
  today: string
  canBuy: boolean
  canAdjust: boolean
  onClose: () => void
  onEdit: () => void
  onSend: () => void
  onMarkSent: () => void
  onCancel: () => void
  onReceive: () => void
}) {
  const t = poTotals(po.lines)
  const late = isLate(po, today)
  const [note, setNote] = useState('')
  const vendorFacts = { name: vendor?.name || po.vendor_name, contact: vendor?.contact, account_number: vendor?.account_number }

  const print = () => { setNote(openPrintable(poHtml(po, vendorFacts, shop, true)) ? '' : 'Your browser blocked the print page. Allow pop-ups for Alpha Desk and try again.') }
  const copy = async () => { setNote((await copyText(poMessage(po, vendorFacts, shop).text)) ? 'The order text is copied. Paste it into a message or your vendor\'s website.' : 'Your browser did not allow copying. Download the file instead.') }

  const open = po.status === 'sent' || po.status === 'partial'
  return (
    <Sheet open onClose={onClose} title={po.po_number} wide>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Pill lamp={STATUS_LAMP[po.status]}>{PO_STATUS_LABEL[po.status]}</Pill>
          {late && <Pill lamp="red">Late, was needed {dayWords(po.expected_on, today)}</Pill>}
        </div>

        <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-[0.9375rem] sm:grid-cols-2">
          <div className="flex gap-2"><dt className="w-24 shrink-0 font-bold text-text-secondary">Vendor</dt><dd className="min-w-0 break-words">{vendorFacts.name}{vendor && !vendor.active ? ' (archived)' : ''}</dd></div>
          <div className="flex gap-2"><dt className="w-24 shrink-0 font-bold text-text-secondary">Started</dt><dd>{dayWords(po.created_at, today) || '—'}</dd></div>
          {po.sent_at && <div className="flex gap-2"><dt className="w-24 shrink-0 font-bold text-text-secondary">Sent</dt><dd className="min-w-0 break-words">{dayWords(po.sent_at, today)}{po.sent_to ? `, ${po.sent_to}` : ''}</dd></div>}
          {po.expected_on && <div className="flex gap-2"><dt className="w-24 shrink-0 font-bold text-text-secondary">Needed by</dt><dd className={late ? 'font-bold text-red' : ''}>{dayWords(po.expected_on, today)}{po.status !== 'received' && po.status !== 'cancelled' && po.expected_on >= today ? ` (${daysBetween(today, po.expected_on) === 0 ? 'today' : `in ${daysBetween(today, po.expected_on)} days`})` : ''}</dd></div>}
          {vendor?.phone && <div className="flex gap-2"><dt className="w-24 shrink-0 font-bold text-text-secondary">Phone</dt><dd className="num">{vendor.phone}</dd></div>}
        </dl>

        <ul className="ledger" aria-label="Parts on this order">
          {po.lines.map(l => {
            const done = l.qty_received >= l.qty
            return (
              <li key={l.id}>
                <div className="flex items-start gap-3 px-1 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{l.description}</p>
                    <p className="num text-[0.875rem] text-text-secondary">{[l.sku, `${l.qty} × ${usd(l.unit_cost)}`, l.core_charge > 0 ? `plus ${usd(l.core_charge)} core each` : ''].filter(Boolean).join(' · ')}</p>
                    {po.status !== 'draft' && po.status !== 'cancelled' && (
                      <p className="mt-0.5 inline-flex items-center gap-1.5 text-[0.875rem] font-bold"><span className={`lamp ${done ? 'lamp-green' : l.qty_received > 0 ? 'lamp-amber' : 'lamp-blue'}`} aria-hidden="true" /><span className="num">{done ? `All ${l.qty} in` : l.qty_received > 0 ? `${l.qty_received} of ${l.qty} in` : 'Not here yet'}</span></p>
                    )}
                  </div>
                  <p className="num shrink-0 font-bold">{usd(l.qty * (l.unit_cost + l.core_charge))}</p>
                </div>
              </li>
            )
          })}
        </ul>

        <div className="num rounded-md border border-border px-4 py-3 text-[0.9375rem]">
          <p>{t.units} {t.units === 1 ? 'part' : 'parts'} · subtotal <span className="font-bold">{usd(t.subtotal)}</span>{t.cores > 0 ? <> · core charges <span className="font-bold">{usd(t.cores)}</span></> : null}</p>
          <p className="mt-0.5 text-[1.0625rem]">Order total <span className="display font-bold">{usd(t.total)}</span>{open && t.outstanding > 0 ? <span className="text-[0.9375rem] text-text-secondary"> · {t.outstanding} still to come</span> : null}</p>
        </div>
        {po.notes && <p className="text-[0.9375rem]"><span className="font-bold text-text-secondary">Note for the vendor: </span>{po.notes}</p>}
        {po.status === 'draft' && <Notice kind="info">This is a draft. Nothing has been sent, and your counts have not changed. Parts show as on order once it is sent.</Notice>}
        {po.status === 'cancelled' && <Notice kind="info">This order was cancelled. Anything still waiting on it was taken off the on-order counts.</Notice>}
        {note && <Notice kind="info">{note}</Notice>}

        <FormActions>
          {po.status === 'draft' && canBuy && <button type="button" className="btn btn-primary" onClick={onSend}><Icon name="send" className="h-5 w-5" />Review and send</button>}
          {open && canAdjust && <button type="button" className="btn btn-primary" onClick={onReceive}><Icon name="box" className="h-5 w-5" />Receive parts</button>}
          {po.status === 'draft' && canBuy && <button type="button" className="btn btn-secondary" onClick={onEdit}><Icon name="edit" className="h-5 w-5" />Change</button>}
          {po.status === 'draft' && canBuy && <button type="button" className="btn btn-secondary" onClick={onMarkSent}>I already sent it</button>}
          <button type="button" className="btn btn-secondary" onClick={print}><Icon name="print" className="h-5 w-5" />Print</button>
          <button type="button" className="btn btn-ghost" onClick={() => saveText(`${po.po_number}.csv`, poCsv(po))}><Icon name="download" className="h-5 w-5" />Spreadsheet</button>
          {po.status !== 'draft' && po.status !== 'cancelled' && <button type="button" className="btn btn-ghost" onClick={() => void copy()}><Icon name="copy" className="h-5 w-5" />Copy text</button>}
          {(po.status === 'draft' || open) && canBuy && <button type="button" className="btn btn-danger sm:ml-auto" onClick={onCancel}>Cancel order</button>}
        </FormActions>
      </div>
    </Sheet>
  )
}
