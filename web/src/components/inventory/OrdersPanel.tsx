'use client'
import { useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import { EmptyBlock, FilterChips, Pill } from '@/components/ListKit'
import { PO_STATUS_LABEL, poTotals } from '@/lib/inventory-logic'
import type { PurchaseOrder } from '@/lib/inventory-logic'
import { STATUS_LAMP, isLate } from './OrderDetail'
import type { OrderCommand } from './OrderSheets'
import StockNotice, { LookOnly } from './StockNotice'
import type { StockData } from './useStock'
import { dayWords, emptySeed, usd } from '@/lib/inventory-view'

type Show = 'open' | 'draft' | 'received' | 'cancelled' | 'all'

const matches = (o: PurchaseOrder, show: Show): boolean =>
  show === 'all' ? true : show === 'open' ? o.status === 'sent' || o.status === 'partial' : o.status === show

/** Purchase orders: what is waiting on a vendor, what is still a draft, and what came in. */
export default function OrdersPanel({ stock, onCommand, reload }: { stock: StockData; onCommand: (c: OrderCommand) => void; reload: () => void }) {
  const [show, setShow] = useState<Show>('open')
  const orders = stock.orders.value
  const today = stock.today

  const counts = useMemo(() => ({
    open: orders.filter(o => matches(o, 'open')).length, draft: orders.filter(o => o.status === 'draft').length,
    received: orders.filter(o => o.status === 'received').length, cancelled: orders.filter(o => o.status === 'cancelled').length,
  }), [orders])
  const list = useMemo(() => orders.filter(o => matches(o, show)), [orders, show])
  const waiting = useMemo(() => {
    const live = orders.filter(o => matches(o, 'open'))
    let units = 0, value = 0
    for (const o of live) for (const l of o.lines) { const left = Math.max(0, l.qty - l.qty_received); units += left; value += left * (l.unit_cost + l.core_charge) }
    return { units, value: Math.round(value * 100) / 100, late: live.filter(o => isLate(o, today)).length }
  }, [orders, today])

  const nonce = () => Date.now()
  const startNew = () => onCommand({ nonce: nonce(), kind: 'new', seed: emptySeed() })

  if (stock.orders.state !== 'ok') return <StockNotice r={stock.orders} what="Purchase orders" onRetry={reload} />

  return (
    <div>
      {!stock.canBuy && <LookOnly what="Purchase orders" />}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <FilterChips
          label="Show orders" scroll value={show} onChange={setShow}
          options={[{ key: 'open', label: 'Waiting on vendor', count: counts.open }, { key: 'draft', label: 'Drafts', count: counts.draft }, { key: 'received', label: 'Received', count: counts.received }, { key: 'cancelled', label: 'Cancelled', count: counts.cancelled }, { key: 'all', label: 'All', count: orders.length }]}
        />
        {stock.canBuy && <button type="button" className="btn btn-primary w-full sm:w-auto" onClick={startNew}><Icon name="plus" className="h-5 w-5" />New order</button>}
      </div>

      {waiting.units > 0 && (
        <p className="num mb-3 text-[0.9375rem] text-text-secondary" aria-live="polite">
          <span className="font-bold text-text-primary">{waiting.units}</span> {waiting.units === 1 ? 'part' : 'parts'} still to come, worth <span className="font-bold text-text-primary">{usd(waiting.value)}</span>
          {waiting.late > 0 && <> · <span className="font-bold text-red">{waiting.late} {waiting.late === 1 ? 'order is' : 'orders are'} late</span></>}
        </p>
      )}

      {orders.length === 0 ? (
        <EmptyBlock icon="box" title="No purchase orders yet" action={stock.canBuy ? <button type="button" className="btn btn-primary" onClick={startNew}><Icon name="plus" className="h-5 w-5" />Write your first order</button> : undefined}>
          Order parts from a vendor, see what is still on the way, and check each delivery in when it arrives. The Reorder list shows what is running low.
        </EmptyBlock>
      ) : list.length === 0 ? (
        <EmptyBlock icon="search" title={show === 'open' ? 'Nothing is waiting on a vendor' : show === 'draft' ? 'No drafts' : show === 'received' ? 'No received orders' : 'No cancelled orders'} action={<button type="button" className="btn btn-secondary" onClick={() => setShow('all')}>Show all orders</button>}>
          {show === 'open' ? 'Orders you have sent show here until every part is in.' : 'Nothing matches this view.'}
        </EmptyBlock>
      ) : (
        <ul className="ledger" aria-label="Purchase orders">
          {list.map(o => {
            const t = poTotals(o.lines)
            const late = isLate(o, today)
            const sub = [
              o.sent_at ? `Sent ${dayWords(o.sent_at, today)}` : `Started ${dayWords(o.created_at, today)}`,
              o.expected_on && o.status !== 'received' && o.status !== 'cancelled' ? `needed ${dayWords(o.expected_on, today)}` : '',
              o.status === 'sent' || o.status === 'partial' ? `${t.received} of ${t.units} in` : `${t.units} ${t.units === 1 ? 'part' : 'parts'}`,
            ].filter(Boolean).join(' · ')
            return (
              <li key={o.id}>
                <button type="button" className="ledger-row w-full items-start py-3 text-left" onClick={() => onCommand({ nonce: nonce(), kind: 'open', id: o.id })}>
                  <span className="ledger-main">
                    <span className="ledger-title block !whitespace-normal">{o.po_number} · {o.vendor_name || 'No vendor'}</span>
                    <span className="ledger-sub num block !whitespace-normal">{sub}</span>
                    <span className="mt-1 flex flex-wrap gap-1.5">
                      <Pill lamp={STATUS_LAMP[o.status]}>{PO_STATUS_LABEL[o.status]}</Pill>
                      {late && <Pill lamp="red">Late</Pill>}
                    </span>
                  </span>
                  <span className="ledger-amt">{usd(t.total)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
