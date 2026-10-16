'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import Icon from '@/components/Icon'
import { formatCurrency } from '@/lib/supabase'
import { docLamp, docStatusLabel } from '@/lib/doc-status'
import { statusLamp, statusWord } from '@/components/jobs/types'
import { asText, fetchJson } from './http'
import { fmtDay, fmtMonthYear } from './types'

interface Item {
  id: string
  kind: 'repair' | 'invoice'
  date: string
  title: string
  status: string
  mileage: number | null
  billed: number | null
  estimate: number | null
  docs: { id: string; type: string; number: string; status: string; total: number }[]
  jobId: string
}
interface Car {
  key: string
  label: string
  vin: string
  plate: string
  items: Item[]
  itemCount: number
  visits: number
  billed: number
  lastDate: string
  lastMiles: number | null
  perYear: number | null
  flagged: number
  flags: Record<string, string>
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const FIRST_ITEMS = 3

function readCars(list: unknown): Car[] {
  if (!Array.isArray(list)) return []
  return list.map(raw => {
    const c = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
    const totals = c.totals && typeof c.totals === 'object' ? (c.totals as Record<string, unknown>) : {}
    const mileage = c.mileage && typeof c.mileage === 'object' ? (c.mileage as Record<string, unknown>) : {}
    const flags = c.flags && typeof c.flags === 'object' ? (c.flags as Record<string, string>) : {}
    return {
      key: asText(c.key), label: asText(c.label) || 'Vehicle', vin: asText(c.vin), plate: asText(c.plate),
      items: Array.isArray(c.items) ? (c.items as Item[]) : [],
      itemCount: num(c.item_count), visits: num(totals.visits), billed: num(totals.billed), lastDate: asText(totals.lastDate),
      lastMiles: typeof mileage.last === 'number' ? mileage.last : null, perYear: typeof mileage.per_year === 'number' ? mileage.per_year : null,
      flagged: num(mileage.flagged), flags,
    }
  }).filter(c => c.key)
}

function ItemRow({ item, flag }: { item: Item; flag: string }) {
  const repair = item.kind === 'repair'
  const doc = item.docs[0]
  const href = repair ? `/jobs?job=${encodeURIComponent(item.jobId)}` : doc ? `/invoices?document=${encodeURIComponent(doc.id)}` : ''
  const lamp = repair ? statusLamp(item.status) : docLamp('Invoice', item.status)
  const word = repair ? statusWord(item.status) : docStatusLabel('Invoice', item.status)
  const body = (
    <>
      <Icon name={repair ? 'wrench' : 'invoice'} className="mt-0.5 h-5 w-5 shrink-0 text-text-secondary" />
      <span className="ledger-main">
        <span className="ledger-title block !whitespace-normal break-words">{item.title}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[0.9375rem] text-text-secondary">
          <span>{fmtDay(item.date)}</span>
          <span className="flex items-center gap-1.5"><span className={`lamp lamp-${lamp}`} aria-hidden="true" />{word}</span>
          {item.mileage !== null && <span className="num">{item.mileage.toLocaleString('en-US')} miles</span>}
        </span>
        {flag && (
          <span className="mt-0.5 flex items-start gap-1.5 text-[0.9375rem] font-bold text-amber">
            <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
            {flag === 'jump' ? 'This mileage is far above the reading before it. Check it.' : 'This mileage is lower than an earlier reading. Check it.'}
          </span>
        )}
      </span>
      <span className="shrink-0 text-right">
        {item.billed !== null
          ? <span className="ledger-amt block">{formatCurrency(item.billed)}</span>
          : item.estimate !== null
            ? <span className="block text-[0.9375rem] text-text-secondary">Quote <span className="num font-bold text-text-primary">{formatCurrency(item.estimate)}</span></span>
            : null}
      </span>
    </>
  )
  return href
    ? <Link href={href} className="ledger-row !items-start no-underline">{body}</Link>
    : <div className="ledger-row !items-start">{body}</div>
}

function CarCard({ car }: { car: Car }) {
  // A car with an odd mileage reading opens in full, so the marked repair order is not hidden behind Show all.
  const [all, setAll] = useState(car.flagged > 0)
  const items = all ? car.items : car.items.slice(0, FIRST_ITEMS)
  const ids = [car.plate && `Plate ${car.plate}`, car.vin && `VIN ${car.vin}`].filter(Boolean).join(' · ')
  return (
    <div className="panel overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <p className="flex items-center gap-2 break-words font-bold"><Icon name="vehicle" className="h-5 w-5 shrink-0 text-text-secondary" />{car.label}</p>
        {ids && <p className="mt-0.5 break-words text-[0.9375rem] text-text-secondary">{ids}</p>}
        <p className="mt-1 break-words text-[0.9375rem]">
          {car.visits === 0
            ? 'No repair orders or invoices for this car yet.'
            : <>
                <span className="num font-bold">{car.visits}</span> {car.visits === 1 ? 'visit' : 'visits'}, <span className="num font-bold">{formatCurrency(car.billed)}</span> billed
                {car.lastDate && <>, last in {fmtMonthYear(car.lastDate)}</>}.
              </>}
          {car.lastMiles !== null && <> Last known mileage <span className="num font-bold">{car.lastMiles.toLocaleString('en-US')}</span>{car.perYear !== null && <>, about <span className="num">{car.perYear.toLocaleString('en-US')}</span> miles a year</>}.</>}
        </p>
        {car.flagged > 0 && (
          <p className="mt-1 flex items-start gap-1.5 break-words text-[0.9375rem] font-bold text-amber">
            <Icon name="alert" className="mt-0.5 h-4 w-4 shrink-0" />
            {car.flagged === 1 ? '1 mileage reading looks wrong.' : `${car.flagged} mileage readings look wrong.`} Look for the marked repair orders below.
          </p>
        )}
      </div>
      {car.items.length > 0 && (
        <>
          <ul className="ledger !border-t-0">
            {items.map(i => <li key={i.id}><ItemRow item={i} flag={car.flags[i.id] || ''} /></li>)}
          </ul>
          {car.items.length > FIRST_ITEMS && (
            <div className="border-t border-border px-2">
              <button type="button" className="btn btn-ghost" onClick={() => setAll(v => !v)}>{all ? 'Show fewer' : `Show all ${car.items.length}`}</button>
            </div>
          )}
          {car.itemCount > car.items.length && <p className="border-t border-border px-4 py-2 text-[0.9375rem] text-text-secondary">Showing the latest {car.items.length} of {car.itemCount}.</p>}
        </>
      )}
    </div>
  )
}

/**
 * Service history for each of one customer's cars: repair orders with what they billed, invoices written without a repair
 * order, and the mileage readings with a warning where one looks wrong. Read only.
 */
export default function VehicleHistory({ customerId }: { customerId: string }) {
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [cars, setCars] = useState<Car[]>([])
  const [carCount, setCarCount] = useState(0)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const mine = ++seq.current
    setState('loading')
    try {
      const r = await fetchJson(`/api/customers/history?customer_id=${encodeURIComponent(customerId)}`, { cache: 'no-store' })
      if (mine !== seq.current) return
      if (!r.ok || !r.data || r.data.ok !== true) { setState('error'); return }
      setCars(readCars(r.data.cars))
      setCarCount(num(r.data.car_count))
      setState('ready')
    } catch {
      if (mine === seq.current) setState('error')
    }
  }, [customerId])

  useEffect(() => { void load(); return () => { seq.current += 1 } }, [load])

  if (state === 'loading') return <div className="space-y-2" aria-busy="true" aria-label="Loading vehicle history" role="status">{[0, 1].map(i => <div key={i} className="skeleton h-14" />)}</div>
  if (state === 'error') {
    return (
      <div role="alert" className="rounded-lg border border-red/40 bg-red/[0.08] p-4">
        <p className="font-bold text-red">The vehicle history could not be loaded.</p>
        <p className="mt-1 text-[0.9375rem] text-text-secondary">Check your connection and try again.</p>
        <button type="button" className="btn btn-secondary mt-3" onClick={() => void load()}>Try again</button>
      </div>
    )
  }
  if (cars.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-border p-4 text-[0.9375rem] text-text-secondary">
        No service history yet. A car shows here once it is on this customer&apos;s card or on a repair order.
      </p>
    )
  }
  return (
    <div className="space-y-3">
      {cars.map(c => <CarCard key={c.key} car={c} />)}
      {carCount > cars.length && <p className="text-[0.9375rem] text-text-secondary">Showing {cars.length} of {carCount} cars.</p>}
    </div>
  )
}
