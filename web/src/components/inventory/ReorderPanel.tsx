'use client'
import { useMemo } from 'react'
import Icon from '@/components/Icon'
import { EmptyBlock } from '@/components/ListKit'
import Notice from '@/components/Notice'
import { saveText } from '@/components/reports/files'
import { groupByVendor, reorderCsv, reorderSuggestions, usageFromSales } from '@/lib/inventory-logic'
import type { PartExtra, StockPart, Suggestion } from '@/lib/inventory-logic'
import type { OrderCommand } from './OrderSheets'
import StockNotice from './StockNotice'
import type { StockData } from './useStock'
import { lineForPart, lineKey, usd } from '@/lib/inventory-view'

/** What is running low and how many to order, from the reorder points, what is already on order, how fast it sells, and each vendor's price. */
export function buildSuggestions(stock: StockData | null, parts: StockPart[]): Suggestion[] {
  if (!stock) return []
  const extras = new Map<string, PartExtra>(stock.extras.value.map(x => [x.part_id, x]))
  const usage = stock.sold && stock.sold.state === 'ok' ? usageFromSales(stock.sold.lines, parts, stock.today, 90) : new Map()
  return reorderSuggestions({ parts, extras, vendors: stock.vendors.value, prices: stock.prices.value, usage })
}

export default function ReorderPanel({ stock, suggestions, onCommand, reload }: {
  stock: StockData
  suggestions: Suggestion[]
  onCommand: (c: OrderCommand) => void
  reload: () => void
}) {
  const groups = useMemo(() => groupByVendor(suggestions), [suggestions])
  const extras = useMemo(() => new Map<string, PartExtra>(stock.extras.value.map(x => [x.part_id, x])), [stock.extras.value])
  const total = groups.reduce((s, g) => s + g.total, 0)

  const make = (g: (typeof groups)[number]) => onCommand({
    nonce: Date.now(), kind: 'new',
    seed: {
      id: null, vendor_id: g.vendorId || '', vendor_name: g.vendorId ? '' : g.vendorName, expected_on: '', notes: '',
      lines: g.items.map(s => ({ ...lineForPart(s.part, g.vendorId || '', stock.prices.value, extras, s.qty), key: lineKey() })),
    },
  })
  const draftFor = (vendorId: string | null) => (vendorId ? stock.orders.value.find(o => o.status === 'draft' && o.vendor_id === vendorId) : undefined)

  return (
    <div>
      <StockNotice r={stock.vendors} what="Your vendors" onRetry={reload} />
      <StockNotice r={stock.prices} what="Vendor prices" onRetry={reload} />
      {stock.orders.state !== 'ok' && <StockNotice r={stock.orders} what="Purchase orders" onRetry={reload} />}
      {stock.sold?.state === 'error' && <Notice kind="warn" className="mb-4"><p className="font-bold">Sales did not load</p><p className="mt-0.5 text-text-secondary">{stock.sold.error} Quantities come from your reorder points alone.</p></Notice>}

      {suggestions.length === 0 ? (
        <EmptyBlock icon="check" title="Nothing needs ordering right now">
          A part shows up here when it drops to its reorder point and is not already covered by what is on order. Set a reorder point on a part to include it.
        </EmptyBlock>
      ) : (
        <>
          <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="num text-[0.9375rem] text-text-secondary" aria-live="polite">
              <span className="font-bold text-text-primary">{suggestions.length}</span> {suggestions.length === 1 ? 'part' : 'parts'} to order from <span className="font-bold text-text-primary">{groups.length}</span> {groups.length === 1 ? 'vendor' : 'vendors'}, about <span className="font-bold text-text-primary">{usd(total)}</span>
            </p>
            <button type="button" className="btn btn-secondary w-full sm:w-auto" onClick={() => saveText('reorder-list.csv', reorderCsv(suggestions))}><Icon name="download" className="h-5 w-5" />Download the list</button>
          </div>
          <div className="space-y-4">
            {groups.map(g => {
              const draft = draftFor(g.vendorId)
              return (
                <section key={g.vendorId || `n:${g.vendorName}`} className="panel" aria-label={g.vendorName || 'No vendor chosen'}>
                  <div className="panel-header">
                    <div className="min-w-0">
                      <h3 className="section-title !text-[1.0625rem]">{g.vendorName || 'No vendor chosen'}</h3>
                      <p className="num text-[0.875rem] text-text-secondary">{g.items.length} {g.items.length === 1 ? 'part' : 'parts'} · about {usd(g.total)}{!g.vendorId && g.vendorName ? ' · not in your vendor list yet' : ''}</p>
                    </div>
                    {stock.canBuy && <button type="button" className="btn btn-primary shrink-0" onClick={() => make(g)}><Icon name="plus" className="h-5 w-5" />Make order</button>}
                  </div>
                  {draft && (
                    <div className="border-b border-border px-4 py-2 sm:px-5">
                      <Notice kind="info">
                        <p>You already have a draft, <span className="font-bold">{draft.po_number}</span>, for this vendor. A new order will be separate from it.</p>
                        <button type="button" className="btn btn-secondary mt-2" onClick={() => onCommand({ nonce: Date.now(), kind: 'open', id: draft.id })}>Open {draft.po_number}</button>
                      </Notice>
                    </div>
                  )}
                  <ul className="ledger !border-t-0">
                    {g.items.map(s => (
                      <li key={s.part.id}>
                        <div className="flex items-start gap-3 px-4 py-3 sm:px-5">
                          <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-2 font-bold"><span className={`lamp ${s.state === 'out' ? 'lamp-red' : 'lamp-amber'}`} aria-hidden="true" /><span className="min-w-0 break-words">{s.part.name}</span></p>
                            <p className="num text-[0.875rem] text-text-secondary">{[s.part.part_number, s.reason, s.state === 'low' && s.daysLeft !== null ? `about ${s.daysLeft} days left at the recent pace` : ''].filter(Boolean).join(' · ')}</p>
                            {s.costFrom === 'none' && <p className="text-[0.875rem] text-amber">No cost on file. You will enter it on the order.</p>}
                          </div>
                          <div className="num shrink-0 text-right">
                            <p className="font-bold">{s.qty} × {s.unitCost > 0 ? usd(s.unitCost) : '—'}</p>
                            <p className="text-[0.875rem] text-text-secondary">{s.costFrom === 'vendor price' ? 'vendor price' : s.costFrom === 'last cost' ? 'your last cost' : ''}</p>
                          </div>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
