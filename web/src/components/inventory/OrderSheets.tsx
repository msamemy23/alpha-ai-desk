'use client'
import { useMemo, useState } from 'react'
import ConfirmSheet from '@/components/forms/ConfirmSheet'
import type { Flash } from '@/components/forms/FlashNotice'
import { Field } from '@/components/forms/Field'
import type { PartExtra, ShopFacts } from '@/lib/inventory-logic'
import { poTotals } from '@/lib/inventory-logic'
import { seedFrom } from '@/lib/inventory-view'
import type { OrderSeed } from '@/lib/inventory-view'
import type { StockPart } from '@/lib/inventory-logic'
import OrderDetail from './OrderDetail'
import OrderEditor from './OrderEditor'
import ReceiveOrder from './ReceiveOrder'
import SendOrder from './SendOrder'
import type { StockAct, StockData } from './useStock'

/** What the Inventory screen asks for: a blank or prefilled new order, or an order that exists. `nonce` makes a repeat ask start fresh. */
export type OrderCommand = { nonce: number; kind: 'new'; seed: OrderSeed } | { nonce: number; kind: 'open'; id: string }

type Step =
  | { kind: 'detail'; id: string }
  | { kind: 'edit'; id: string | null; seed: OrderSeed }
  | { kind: 'send'; id: string }
  | { kind: 'receive'; id: string }
  | { kind: 'marksent'; id: string }
  | { kind: 'cancel'; id: string }

/** The sheets that make up working an order, one after another: look at it, change it, send it, receive it, mark it sent, cancel it. */
export default function OrderSheets({ command, stock, parts, act, flash, onClose, onOpenVendor }: {
  command: OrderCommand
  stock: StockData
  parts: StockPart[]
  act: StockAct
  flash: (f: Flash) => void
  onClose: () => void
  onOpenVendor: (vendorId: string) => void
}) {
  const [step, setStep] = useState<Step>(() => (command.kind === 'new' ? { kind: 'edit', id: null, seed: command.seed } : { kind: 'detail', id: command.id }))
  const [via, setVia] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const orders = stock.orders.value
  const vendors = stock.vendors.value
  const extras = useMemo(() => new Map<string, PartExtra>(stock.extras.value.map(x => [x.part_id, x])), [stock.extras.value])
  const shop: ShopFacts = stock.shop
  const po = 'id' in step && step.id ? orders.find(o => o.id === step.id) || null : null
  const vendor = po?.vendor_id ? vendors.find(v => v.id === po.vendor_id) || null : null
  const back = (id: string) => { setStep({ kind: 'detail', id }); setError(''); setVia('') }

  if (step.kind === 'edit') {
    return (
      <OrderEditor
        seed={step.seed} parts={parts} vendors={vendors} prices={stock.prices.value} extras={extras} act={act}
        onClose={() => (step.id ? back(step.id) : onClose())}
        onSaved={(id, number) => { flash({ kind: 'success', text: `${number} is saved as a draft. Nothing has been sent.` }); back(id) }}
      />
    )
  }

  if (!po) {
    // The order is not in the list (it was removed, or the list is reloading). Say so instead of showing an empty sheet.
    return (
      <ConfirmSheet open title="That order is not in the list" confirmLabel="Close" cancelLabel="Close" danger={false} onConfirm={onClose} onCancel={onClose}>
        <p>It may have been removed, or the list is still loading. Close this and open it again from the Orders list.</p>
      </ConfirmSheet>
    )
  }

  const markSent = async () => {
    setBusy(true); setError('')
    const r = await act<{ already: boolean }>({ action: 'po-mark-sent', id: po.id, via })
    setBusy(false)
    if (r.ok) { flash({ kind: 'success', text: r.data.already ? `${po.po_number} was already marked sent.` : `${po.po_number} is marked sent. Its parts now show as on order.` }); back(po.id); return }
    setError(r.needsUpdate ? 'Purchase orders need a one-time update to your Alpha Desk database first.' : r.message)
  }
  const cancel = async () => {
    setBusy(true); setError('')
    const r = await act<{ already: boolean }>({ action: 'po-cancel', id: po.id })
    setBusy(false)
    if (r.ok) { flash({ kind: 'success', text: `${po.po_number} was cancelled.` }); back(po.id); return }
    setError(r.needsUpdate ? 'Purchase orders need a one-time update to your Alpha Desk database first.' : r.message)
  }

  const waiting = poTotals(po.lines).outstanding
  return (
    <>
      {step.kind === 'detail' && (
        <OrderDetail
          po={po} vendor={vendor} shop={shop} today={stock.today} canBuy={stock.canBuy} canAdjust={stock.canAdjust}
          onClose={onClose}
          onEdit={() => setStep({ kind: 'edit', id: po.id, seed: seedFrom(po) })}
          onSend={() => setStep({ kind: 'send', id: po.id })}
          onMarkSent={() => { setError(''); setStep({ kind: 'marksent', id: po.id }) }}
          onCancel={() => { setError(''); setStep({ kind: 'cancel', id: po.id }) }}
          onReceive={() => setStep({ kind: 'receive', id: po.id })}
        />
      )}
      {step.kind === 'send' && (
        <SendOrder
          po={po} act={act} onClose={() => back(po.id)}
          onSent={(to, recorded) => {
            flash(recorded ? { kind: 'success', text: `${po.po_number} was emailed to ${to}. Its parts now show as on order.` } : { kind: 'error', text: `${po.po_number} was emailed to ${to}, but Alpha Desk could not record that. Open the order and tap I already sent it so the on-order counts update.` })
            back(po.id)
          }}
          onMarkSent={() => { setError(''); setStep({ kind: 'marksent', id: po.id }) }}
          onOpenVendor={onOpenVendor}
        />
      )}
      {step.kind === 'receive' && (
        <ReceiveOrder po={po} parts={parts} act={act} onClose={() => back(po.id)} onDone={(text, warn) => { flash({ kind: 'success', text: warn ? `${text} ${warn}` : text }); back(po.id) }} />
      )}
      <ConfirmSheet
        open={step.kind === 'marksent'} title={`Mark ${po.po_number} as sent?`} confirmLabel="Mark as sent" busyLabel="Saving…" cancelLabel="Not yet" danger={false} busy={busy} error={error}
        onConfirm={() => void markSent()} onCancel={() => back(po.id)}
      >
        <p>Use this when you placed the order by phone, on the vendor&apos;s website or from your own email. Alpha Desk does not email anything now. The parts on it will show as on order, and you can receive them when they arrive.</p>
        <div className="mt-3">
          <Field id="po-via" label="How did you send it? (optional)"><input id="po-via" className="form-input" autoComplete="off" value={via} onChange={e => setVia(e.target.value)} placeholder="Called Mike, vendor website, my email" /></Field>
        </div>
      </ConfirmSheet>
      <ConfirmSheet
        open={step.kind === 'cancel'} title={`Cancel ${po.po_number}?`} confirmLabel="Cancel order" busyLabel="Cancelling…" cancelLabel="Keep order" busy={busy} error={error}
        onConfirm={() => void cancel()} onCancel={() => back(po.id)}
      >
        {po.status === 'draft' ? (
          <p>This draft is cancelled. Nothing was sent to the vendor, and your counts do not change. A cancelled order stays on record.</p>
        ) : (
          <p>The {waiting} {waiting === 1 ? 'part' : 'parts'} still waiting on this order come off your on-order counts. Alpha Desk does not tell the vendor, so call or email them yourself. What you already received stays on your shelf. A cancelled order stays on record.</p>
        )}
      </ConfirmSheet>
    </>
  )
}
