/**
 * Lines up the cars the Vehicles screen works out from customers and repair orders with the extra records the shop saved
 * (an added car, a note, a mileage log, photos). A saved record joins a car by VIN, or by owner plus year, make and model,
 * so nothing about the existing customer and repair-order rows has to change. Imports only a type from list-logic.
 */
import type { Vehicle } from '../list-logic.ts'
import { cleanVin } from './vin.ts'

export interface VehicleRecord {
  id: string
  customer_id: string | null
  year: string
  make: string
  model: string
  vin: string
  plate: string
  color: string
  engine: string
  trim: string
  notes: string
  created_at: string
  updated_at: string
}

const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).replace(/\s+/g, ' ').trim()

export function normalizeRecord(raw: Record<string, unknown>): VehicleRecord {
  return {
    id: s(raw.id),
    customer_id: raw.customer_id ? s(raw.customer_id) : null,
    year: s(raw.year), make: s(raw.make), model: s(raw.model),
    vin: cleanVin(raw.vin).length >= 11 ? cleanVin(raw.vin) : '',
    plate: s(raw.plate).toUpperCase(), color: s(raw.color), engine: s(raw.engine), trim: s(raw.trim_level ?? raw.trim),
    notes: String(raw.notes ?? '').trim(),
    created_at: s(raw.created_at), updated_at: s(raw.updated_at),
  }
}

const ymm = (y: string, m: string, d: string): string => `${s(y)}|${s(m)}|${s(d)}`.toLowerCase()

/** The ways one car can be recognised: its VIN, and its owner with year, make and model. */
export function matchKeys(v: { vin?: string; ownerId?: string | null; customer_id?: string | null; year: string; make: string; model: string }): { vin: string; own: string } {
  const vin = cleanVin(v.vin)
  const owner = s(v.ownerId ?? v.customer_id)
  return {
    vin: vin.length >= 11 ? `vin:${vin}` : '',
    own: owner && (s(v.make) || s(v.model)) ? `own:${owner}|${ymm(v.year, v.make, v.model)}` : '',
  }
}

export interface VehicleRow extends Vehicle {
  /** The saved record for this car, if the shop has saved anything about it. */
  record: VehicleRecord | null
}

/**
 * Every car, with its saved record attached when there is one. A record that matches no car from the customers and repair
 * orders (a car added by hand) shows up as a car of its own.
 */
export function attachRecords(cars: Vehicle[], records: VehicleRecord[], owners: Map<string, string>): VehicleRow[] {
  const byVin = new Map<string, VehicleRecord>()
  const byOwn = new Map<string, VehicleRecord>()
  const ordered = [...records].sort((a, b) => a.created_at.localeCompare(b.created_at))
  for (const r of ordered) {
    const k = matchKeys(r)
    if (k.vin && !byVin.has(k.vin)) byVin.set(k.vin, r)
    if (k.own && !byOwn.has(k.own)) byOwn.set(k.own, r)
  }
  const used = new Set<string>()
  const out: VehicleRow[] = cars.map(c => {
    const k = matchKeys({ vin: c.vin, ownerId: c.ownerId, year: c.year, make: c.make, model: c.model })
    const hit = (k.vin && byVin.get(k.vin)) || (k.own && byOwn.get(k.own)) || null
    if (hit && !used.has(hit.id)) { used.add(hit.id); return { ...c, record: hit } }
    return { ...c, record: null }
  })
  for (const r of ordered) {
    if (used.has(r.id)) continue
    // A second record for a car that already has one (same VIN or owner and model) is folded into the first.
    const k = matchKeys(r)
    const dupOfUsed = out.some(c => c.record && ((k.vin && matchKeys(c.record).vin === k.vin) || (k.own && matchKeys(c.record).own === k.own)))
    if (dupOfUsed) continue
    out.push({
      key: `rec:${r.id}`, year: r.year, make: r.make, model: r.model, color: r.color, vin: r.vin, plate: r.plate,
      mileage: null, ownerId: r.customer_id || '', owner: r.customer_id ? owners.get(r.customer_id) || '' : '',
      lastIn: '', jobs: [], record: r,
    })
  }
  return out
}

/** What the server needs to find or create the saved record for a car. */
export function identityOf(v: Pick<Vehicle, 'ownerId' | 'year' | 'make' | 'model' | 'vin' | 'plate' | 'color'>): Record<string, string> {
  return { customer_id: v.ownerId, year: v.year, make: v.make, model: v.model, vin: v.vin, plate: v.plate, color: v.color }
}
