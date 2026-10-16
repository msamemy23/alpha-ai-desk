import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { calcTotals, getServiceClient } from '@/lib/supabase'
import { buildVehicles, carName } from '@/lib/list-logic'
import { historyTotals, serviceHistory } from '@/lib/vehicles/history'
import type { HistoryDoc } from '@/lib/vehicles/history'
import { parseMiles, summarizeMileage } from '@/lib/vehicles/mileage'
import type { Reading } from '@/lib/vehicles/mileage'
import { loadCustomerRef, readAll } from '@/lib/customers/server'

export const dynamic = 'force-dynamic'

type Row = Record<string, unknown>
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim()

const MAX_CARS = 12
const MAX_ITEMS = 100

const total = (d: Row): number => {
  try { return Number(calcTotals(d).total) || 0 } catch { return 0 }
}

/** The customer card's own car is the one with the same VIN, or the same year, make and model when there is no VIN to compare. */
function isCardCar(card: Row, car: { vin: string; year: string; make: string; model: string }): boolean {
  const vin = str(card.vehicle_vin).toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (vin.length >= 11 && car.vin) return vin === car.vin
  const key = (y: unknown, m: unknown, d: unknown) => [y, m, d].map(x => str(x).toLowerCase()).join('|')
  return key(card.vehicle_year, card.vehicle_make, card.vehicle_model) === key(car.year, car.make, car.model)
}

/**
 * One customer's cars with the service history of each: repair orders and what they billed, invoices written without a repair
 * order, and the odometer readings with a warning when one is lower than an earlier one. Read only. Every query is limited to
 * the signed-in shop and to this customer.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()
    const db = getServiceClient()

    const found = await loadCustomerRef(db, auth.shopId, req.nextUrl.searchParams.get('customer_id'))
    if (found.failed) return NextResponse.json({ ok: false, error: 'The customer could not be loaded.' }, { status: 500 })
    if (!found.customer) return NextResponse.json({ ok: false, error: 'Customer not found.' }, { status: 404 })
    const id = found.customer.id

    const [card, jobRows, docRows] = await Promise.all([
      db.from('customers').select('*').eq('shop_id', auth.shopId).eq('id', id).maybeSingle(),
      readAll<Row>((a, b) => db.from('jobs').select('*').eq('shop_id', auth.shopId).eq('customer_id', id).order('id').range(a, b), 5000),
      readAll<Row>((a, b) => db.from('documents').select('*').eq('shop_id', auth.shopId).eq('customer_id', id).order('id').range(a, b), 5000),
    ])
    if (card.error || !card.data || jobRows.failed || docRows.failed) {
      return NextResponse.json({ ok: false, error: 'The vehicle history could not be loaded.' }, { status: 500 })
    }
    const customer = card.data as Row

    const docs: HistoryDoc[] = docRows.rows.map(d => ({
      id: str(d.id), type: str(d.type), status: str(d.status), number: str(d.doc_number), date: str(d.created_at), total: total(d),
      paid: Number(d.amount_paid) || 0, jobId: str(d.job_id), customerId: str(d.customer_id), vin: str(d.vehicle_vin),
      year: str(d.vehicle_year), make: str(d.vehicle_make), model: str(d.vehicle_model),
    }))

    const cars = buildVehicles([customer], jobRows.rows).map(v => {
      const items = serviceHistory(v.jobs, docs, { vin: v.vin, ownerId: id, year: v.year, make: v.make, model: v.model })
      const readings: Reading[] = v.jobs.filter(j => j.mileage !== null).map(j => ({
        id: `job:${j.id}`, at: j.created, miles: j.mileage as number, source: 'repair_order' as const, label: j.ro ? `Repair order ${j.ro}` : 'Repair order', note: '',
      }))
      const onCard = isCardCar(customer, v) ? parseMiles(customer.vehicle_mileage) : null
      if (onCard !== null) readings.push({ id: 'card', at: '', miles: onCard, source: 'card', label: 'On the customer card', note: '' })
      const miles = summarizeMileage(readings)
      const flags: Record<string, 'lower' | 'jump'> = {}
      for (const r of miles.rows) if (r.jump) flags[r.id] = 'jump'; else if (r.lower) flags[r.id] = 'lower'
      return {
        key: v.key,
        label: carName(v),
        vin: v.vin,
        plate: v.plate,
        items: items.slice(0, MAX_ITEMS),
        item_count: items.length,
        totals: historyTotals(items),
        mileage: { last: miles.lastKnown ? miles.lastKnown.miles : null, last_at: miles.lastKnown ? miles.lastKnown.at : '', per_year: miles.milesPerYear, flagged: miles.flagged },
        flags,
      }
    }).sort((a, b) => b.totals.lastDate.localeCompare(a.totals.lastDate) || a.label.localeCompare(b.label))

    return NextResponse.json({ ok: true, cars: cars.slice(0, MAX_CARS), car_count: cars.length })
  } catch (error) {
    console.error('[customers/history] GET error:', error)
    return NextResponse.json({ ok: false, error: 'The vehicle history could not be loaded.' }, { status: 500 })
  }
}
