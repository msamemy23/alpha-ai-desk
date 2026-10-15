'use client'
import Icon from '@/components/Icon'
import { hostOf, safeHref } from '@/components/ListKit'
import { lineTotal, matchStock, tierLabel, usd } from '@/lib/list-logic'
import { confidenceLabel, confidenceLamp } from './types'
import type { KitOption, PartOption, PartResult, StockItem } from './types'

export function SourceLink({ url, store }: { url: string; store: string }) {
  return (
    <a className="mt-1 inline-flex min-h-[44px] items-center gap-1.5 font-bold text-blue underline-offset-4 hover:underline" href={safeHref(url)} target="_blank" rel="noreferrer noopener">
      View on {store || hostOf(url) || 'the store'}
      <Icon name="openExternal" className="h-4 w-4" />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  )
}

/** Whether the store has it: a lamp and words, and the store branch when the page said which one. */
function Availability({ part }: { part: PartResult }) {
  const lamp = part.inStock === true ? 'green' : part.inStock === false ? 'red' : 'off'
  const word = part.inStock === true ? 'In stock' : part.inStock === false ? 'Out of stock' : 'Stock not checked'
  return (
    <p className="mt-0.5 flex items-center gap-1.5 text-[0.9375rem] text-text-secondary">
      <span className={`lamp lamp-${lamp}`} aria-hidden="true" />
      <span className={part.inStock === false ? 'font-bold text-text-primary' : ''}>{word}{part.storeLocation ? ` at ${part.storeLocation}` : ''}</span>
    </p>
  )
}

/** The same part already on the shop's own shelf, so nobody orders what is in the back. */
function OnYourShelf({ stock, part }: { stock: StockItem[]; part: PartResult }) {
  const hit = matchStock(stock, part.partNumber, part.name)[0]?.part
  if (!hit) return null
  const have = hit.qty_on_hand || 0
  return (
    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[0.9375rem] text-text-secondary">
      <span className={`lamp ${have > 0 ? 'lamp-green' : 'lamp-amber'}`} aria-hidden="true" />
      <span className="font-bold text-text-primary">{have > 0 ? `You have ${have} on hand` : 'On your inventory list, none on hand'}</span>
      {hit.location && <span>at {hit.location}</span>}
    </p>
  )
}

function Row({ part, stock }: { part: PartResult; stock: StockItem[] }) {
  const qty = Math.max(1, Number(part.quantity) || 1)
  return (
    <div className="ledger-row items-start py-3">
      <div className="ledger-main">
        <p className="font-bold leading-snug">{part.position ? `${part.position}: ` : ''}{part.name}</p>
        <p className="text-[0.9375rem] text-text-secondary">{part.store}{part.partNumber ? <> · <span className="num">{part.partNumber}</span></> : null}</p>
        <Availability part={part} />
        <p className="mt-0.5 flex items-center gap-1.5 text-[0.9375rem] text-text-secondary">
          <span className={`lamp lamp-${confidenceLamp(part.sourceConfidence)}`} aria-hidden="true" />
          {part.sourceConfidence ? confidenceLabel(part.sourceConfidence) : 'Search result only'}
        </p>
        <OnYourShelf stock={stock} part={part} />
        <SourceLink url={part.url} store={part.store} />
      </div>
      <div className="shrink-0 text-right">
        <p className="ledger-amt">{usd(part.price)}</p>
        <p className="num text-[0.875rem] text-text-secondary">{qty > 1 ? `each × ${qty} = ${usd(lineTotal(part.price, qty))}` : 'each'}</p>
      </div>
    </div>
  )
}

/** One price level (budget, mid-grade, premium) with its parts and its own "build an estimate" button. */
export function OptionPanel({ option, stock, onBuild }: { option: PartOption; stock: StockItem[]; onBuild: () => void }) {
  const label = `${tierLabel(option.tier)}${option.brand ? `, ${option.brand}` : ''}`
  return (
    <section className="panel" aria-label={label}>
      <div className="panel-header">
        <div className="min-w-0">
          <h3 className="section-title">{tierLabel(option.tier)}</h3>
          {option.brand && <p className="text-[0.9375rem] text-text-secondary">{option.brand}</p>}
        </div>
        <span className="min-w-0 text-right">
          <span className="display num block text-[1.25rem] font-bold">{usd(option.partsTotal)}</span>
          <span className="block text-[0.875rem] text-text-secondary">parts total</span>
        </span>
      </div>
      <ul className="ledger !border-t-0">
        {option.parts.map((part, i) => <li key={`${part.position}-${part.partNumber || i}-${i}`}><Row part={part} stock={stock} /></li>)}
      </ul>
      <div className="border-t border-border p-3">
        <button type="button" className="btn btn-primary w-full sm:w-auto" onClick={onBuild}>
          <Icon name="alpha" className="h-5 w-5" />Build an estimate from this option
        </button>
      </div>
    </section>
  )
}

export function KitPanel({ kits, onBuild }: { kits: KitOption[]; onBuild: (k: KitOption) => void }) {
  return (
    <section className="panel" aria-label="Kits">
      <div className="panel-header"><h3 className="section-title">Kits</h3></div>
      <ul className="ledger !border-t-0">
        {kits.map((kit, i) => (
          <li key={`${kit.name}-${i}`}>
            <div className="ledger-row items-start py-3">
              <div className="ledger-main">
                <p className="font-bold leading-snug">{kit.name}</p>
                <p className="text-[0.9375rem] text-text-secondary">{kit.store}{kit.brand ? ` · ${kit.brand}` : ''}</p>
                {kit.includes && <p className="text-[0.9375rem] text-text-secondary">Includes: {kit.includes}</p>}
                <p className="mt-0.5 flex items-center gap-1.5 text-[0.9375rem] text-text-secondary">
                  <span className={`lamp lamp-${confidenceLamp(kit.sourceConfidence)}`} aria-hidden="true" />
                  {kit.sourceConfidence ? confidenceLabel(kit.sourceConfidence) : 'Search result only'}
                </p>
                <SourceLink url={kit.url} store={kit.store} />
              </div>
              <p className="ledger-amt shrink-0">{usd(kit.price)}</p>
            </div>
            <div className="px-3 pb-3">
              <button type="button" className="btn btn-secondary w-full sm:w-auto" onClick={() => onBuild(kit)}>
                <Icon name="alpha" className="h-5 w-5" />Build an estimate with this kit
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}
