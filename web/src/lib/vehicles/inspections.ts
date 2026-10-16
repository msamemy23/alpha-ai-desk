/**
 * The inspections done on one car, for the Vehicles screen. Which inspections belong to a car is decided with the same
 * rule the inspection screen uses for "what changed since last visit" (the VIN when both have one, otherwise the same
 * customer and a matching description), plus any inspection written on one of the car's own repair orders.
 * Two different customers with the same model of car are never joined.
 */
import { sameVehicle } from '../dvi-history.ts'

export interface CarRef {
  ownerId: string
  owner: string
  vin: string
  year: string
  make: string
  model: string
  /** Ids of the repair orders written for this car. */
  jobIds: string[]
}

export interface InspectionRow {
  id: string
  job_id: string | null
  customer_id: string | null
  customer_name: string
  vehicle: string
  tech: string
  created_at: string
}

export interface Tally { urgent: number; soon: number; good: number }

export interface CarInspection {
  id: string
  at: string
  tech: string
  /** Null when the short summary was never saved for this inspection. */
  tally: Tally | null
}

const carText = (c: Pick<CarRef, 'year' | 'make' | 'model'>): string => [c.year, c.make, c.model].filter(Boolean).join(' ')

/** The inspections that belong to this car, newest first. `vinOfJob` is the VIN written on a repair order, when there is one. */
export function inspectionsOfCar(car: CarRef, rows: InspectionRow[], vinOfJob: (jobId: string) => string = () => ''): InspectionRow[] {
  const jobs = new Set(car.jobIds)
  const me = { customerId: car.ownerId || null, customerName: car.owner, vehicle: carText(car), vin: car.vin }
  return rows
    .filter(r => {
      if (r.job_id && jobs.has(r.job_id)) return true
      return sameVehicle(me, { customerId: r.customer_id, customerName: r.customer_name, vehicle: r.vehicle, vin: r.job_id ? vinOfJob(r.job_id) : '' })
    })
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
}

/** Counts the rated lines of a saved summary. Returns null for anything that is not a summary. */
export function tallyOf(digest: unknown): Tally | null {
  if (!Array.isArray(digest) || digest.length === 0) return null
  const t: Tally = { urgent: 0, soon: 0, good: 0 }
  let rated = 0
  for (const d of digest) {
    const r = d && typeof d === 'object' ? (d as Record<string, unknown>).r : undefined
    if (r === 'r') { t.urgent++; rated++ } else if (r === 'y') { t.soon++; rated++ } else if (r === 'g') { t.good++; rated++ }
  }
  return rated > 0 ? t : null
}

/** "2 urgent, 3 need attention soon, 14 good", or the words for nothing found. Empty when there is no summary. */
export function tallyWords(t: Tally | null): string {
  if (!t) return ''
  const parts: string[] = []
  if (t.urgent) parts.push(`${t.urgent} urgent`)
  if (t.soon) parts.push(`${t.soon} ${t.soon === 1 ? 'needs' : 'need'} attention soon`)
  if (t.good) parts.push(`${t.good} good`)
  return parts.join(', ')
}

/** The lamp for the worst thing found. */
export function tallyLamp(t: Tally | null): 'red' | 'amber' | 'green' | 'off' {
  if (!t) return 'off'
  return t.urgent > 0 ? 'red' : t.soon > 0 ? 'amber' : 'green'
}
