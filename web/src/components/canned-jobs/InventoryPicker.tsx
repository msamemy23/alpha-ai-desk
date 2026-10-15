'use client'
import { useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import { EmptyBlock, ErrorCard, RowsSkeleton, SearchField } from '@/components/ListKit'
import { searchStock } from '@/lib/list-logic'
import { money } from './types'

export interface StockPart { id: string; name: string; part_number: string; brand: string; category: string; retail_price: number | null; qty_on_hand: number | null }

/** Pick a part the shop already stocks. Its retail price becomes the price on the canned job. */
export default function InventoryPicker({ stock, loading, error, onRetry, onPick, onBack }: {
  stock: StockPart[] | null
  loading: boolean
  error: string
  onRetry: () => void
  onPick: (p: StockPart) => void
  onBack: () => void
}) {
  const [q, setQ] = useState('')
  const shown = useMemo(() => (stock ? (q.trim() ? searchStock(stock, q, 40) : stock.slice(0, 40)) : []), [stock, q])
  return (
    <div>
      <button type="button" className="mb-3 inline-flex min-h-[44px] items-center gap-1.5 font-bold text-blue" onClick={onBack}>
        <Icon name="back" className="h-5 w-5" />Back to the job
      </button>
      {error ? <ErrorCard title="Inventory could not load" message={error} onRetry={onRetry} busy={loading} />
        : stock === null ? <RowsSkeleton rows={5} label="Loading inventory" />
        : stock.length === 0 ? (
          <EmptyBlock icon="box" title="No parts in inventory yet">Add parts in Inventory first, or go back and add a part by hand.</EmptyBlock>
        ) : (
          <>
            <SearchField className="mb-3" label="Search your inventory" placeholder="Search your inventory" value={q} onChange={setQ} />
            {shown.length === 0 ? (
              <EmptyBlock icon="search" title={`No parts match “${q.trim()}”`}>Try a shorter search, or go back and add the part by hand.</EmptyBlock>
            ) : (
              <ul className="ledger">
                {shown.map(p => (
                  <li key={p.id}>
                    <button type="button" className="ledger-row py-3" onClick={() => onPick(p)}>
                      <span className="ledger-main">
                        <span className="ledger-title block !whitespace-normal">{p.name}</span>
                        <span className="ledger-sub block !whitespace-normal">{[p.brand, p.part_number].filter(Boolean).join(' · ') || 'No part number'}</span>
                        <span className="ledger-sub block">{(p.qty_on_hand || 0) > 0 ? `${p.qty_on_hand} on hand` : 'None on hand'}</span>
                      </span>
                      <span className="ledger-amt shrink-0">{p.retail_price ? money(p.retail_price) : 'No price'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {!q.trim() && stock.length > shown.length && <p className="mt-2 text-[0.875rem] text-text-secondary">Showing the first {shown.length} of {stock.length}. Search to find the rest.</p>}
          </>
        )}
    </div>
  )
}
