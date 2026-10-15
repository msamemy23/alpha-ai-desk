'use client'
import Icon from '@/components/Icon'
import { sentenceCase } from '@/components/ListKit'
import { marginLabel, stockState } from '@/lib/list-logic'
import { money } from './types'
import type { Part } from './types'

const onHand = (p: Part) => p.qty_on_hand || 0

/** Red lamp and "Out of stock", or amber lamp and "Low stock". Nothing for parts that are fine. */
export function StockStatus({ part }: { part: Part }) {
  const state = stockState(part.qty_on_hand, part.qty_reorder)
  if (state === 'ok') return null
  const out = state === 'out'
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap font-bold ${out ? 'text-red' : 'text-amber'}`}>
      <span className={`lamp ${out ? 'lamp-red' : 'lamp-amber'}`} aria-hidden="true" />
      {out ? 'Out of stock' : 'Low stock'}
    </span>
  )
}

function Stepper({ part, onAdjust, compact = false }: { part: Part; onAdjust: (id: string, delta: number) => void; compact?: boolean }) {
  const btn = 'inline-grid h-11 w-11 shrink-0 place-items-center rounded-md border border-[rgb(var(--c-line))] bg-bg-card text-text-primary hover:bg-bg-hover disabled:opacity-50 sm:h-10 sm:w-10'
  return (
    <div className="flex items-center gap-1" role="group" aria-label={`Quantity on hand for ${part.name}`}>
      <button type="button" className={btn} disabled={onHand(part) <= 0} onClick={() => onAdjust(part.id, -1)} aria-label={`Take one ${part.name} out of stock`}>
        <Icon name="stepMinus" className="h-5 w-5" strokeWidth={2.2} />
      </button>
      <div className={`${compact ? 'w-9' : 'w-14'} text-center leading-tight`} aria-live="polite">
        <span className="display num block text-[1.25rem] font-bold">{onHand(part)}</span>
        {!compact && <span className="block text-[0.875rem] text-text-secondary">on hand</span>}
      </div>
      <button type="button" className={btn} onClick={() => onAdjust(part.id, 1)} aria-label={`Add one ${part.name} to stock`}>
        <Icon name="plus" className="h-5 w-5" strokeWidth={2.2} />
      </button>
    </div>
  )
}

const subline = (p: Part) => [p.brand, p.part_number].filter(Boolean).join(' · ') || 'No part number'

/** Phones and small laptops: one ledger row per part, with the count stepper on the right. */
export function PartList({ parts, errors, onOpen, onAdjust }: {
  parts: Part[]
  errors: Record<string, string>
  onOpen: (p: Part) => void
  onAdjust: (id: string, delta: number) => void
}) {
  return (
    <ul className="ledger xl:hidden">
      {parts.map(p => {
        const m = marginLabel(p.cost, p.retail_price)
        const state = stockState(p.qty_on_hand, p.qty_reorder)
        return (
          <li key={p.id}>
            <div className="flex items-center pr-2">
              <button type="button" className="ledger-row min-w-0 flex-1 !w-auto items-start py-3" onClick={() => onOpen(p)}>
                <span className="ledger-main">
                  <span className="ledger-title block !whitespace-normal">{p.name}</span>
                  <span className="ledger-sub block !whitespace-normal">{subline(p)}</span>
                  <span className="ledger-sub num block !whitespace-normal">Retail {money(p.retail_price)} · cost {money(p.cost)}{m ? ` · ${m} margin` : ''}</span>
                  {(state !== 'ok' || (p.qty_on_order || 0) > 0) && (
                    <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.875rem]">
                      <StockStatus part={p} />
                      {state === 'low' && <span className="text-text-secondary">reorder at {p.qty_reorder}</span>}
                      {(p.qty_on_order || 0) > 0 && <span className="inline-flex items-center gap-1.5 font-bold text-text-primary"><span className="lamp lamp-blue" aria-hidden="true" /><span className="num">{p.qty_on_order}</span> on order</span>}
                    </span>
                  )}
                  {p.location && <span className="ledger-sub block">{p.location}</span>}
                </span>
              </button>
              <Stepper part={p} onAdjust={onAdjust} />
            </div>
            {errors[p.id] && (
              <p role="alert" className="flex items-start gap-2 px-3 pb-3 text-[0.9375rem] text-red">
                <Icon name="alert" className="mt-0.5 h-5 w-5 shrink-0" />{errors[p.id]}
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** Wide screens: a table that reads like a ledger. */
export function PartTable({ parts, errors, onOpen, onAdjust }: {
  parts: Part[]
  errors: Record<string, string>
  onOpen: (p: Part) => void
  onAdjust: (id: string, delta: number) => void
}) {
  const dash = <span className="text-text-secondary" aria-label="Not entered">—</span>
  return (
    <div className="panel hidden overflow-x-auto xl:block">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Part</th>
            <th scope="col" className="text-right">Cost</th>
            <th scope="col" className="text-right">Retail</th>
            <th scope="col" className="text-right">Margin</th>
            <th scope="col">On hand</th>
            <th scope="col" className="text-right">On order</th>
            <th scope="col">Location</th>
          </tr>
        </thead>
        <tbody>
          {parts.map(p => {
            const m = marginLabel(p.cost, p.retail_price)
            const state = stockState(p.qty_on_hand, p.qty_reorder)
            return (
              <tr key={p.id} className={state === 'out' ? 'bg-red/[0.06]' : state === 'low' ? 'bg-amber/[0.08]' : ''}>
                <td className="max-w-[18rem]">
                  <button type="button" className="min-h-[32px] text-left font-bold hover:text-blue hover:underline" onClick={() => onOpen(p)}>{p.name}</button>
                  <div className="num text-[0.875rem] text-text-secondary">{[subline(p), p.category && sentenceCase(p.category)].filter(Boolean).join(' · ')}</div>
                  {errors[p.id] && <p role="alert" className="mt-1 flex items-start gap-1.5 text-[0.875rem] text-red"><Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />{errors[p.id]}</p>}
                </td>
                <td className="num whitespace-nowrap text-right">{money(p.cost)}</td>
                <td className="num whitespace-nowrap text-right">{money(p.retail_price)}</td>
                <td className="num whitespace-nowrap text-right">{m || dash}</td>
                <td>
                  <div className="flex items-center gap-3">
                    <Stepper part={p} compact onAdjust={onAdjust} />
                    <StockStatus part={p} />
                  </div>
                </td>
                <td className="num text-right">{(p.qty_on_order || 0) > 0 ? p.qty_on_order : dash}</td>
                <td className="whitespace-nowrap">{p.location || dash}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
