import { NextResponse } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { chunk, readAll } from '@/lib/customers/server'
import { findDuplicatePairs, looksLikeTest } from '@/lib/customers/duplicates'
import type { DupPair } from '@/lib/customers/duplicates'

export const dynamic = 'force-dynamic'

type Row = Record<string, unknown>
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim()

/** The most pairs sent back. Strongest first, so the ones most likely to be the same person are never the ones cut off. */
const MAX_PAIRS = 100

interface Snap {
  id: string
  name: string
  phone: string
  email: string
  address: string
  vehicle: string
  vin: string
  plate: string
  mileage: string
  notes: string
  created_at: string
  /** Estimates, invoices and receipts on this card. Null when they could not be counted. */
  documents: number | null
  /** Repair orders on this card. Null when they could not be counted. */
  jobs: number | null
  /** Why this card looks like a test entry, or empty. A label only. */
  test_hint: string
}

/**
 * Pairs of customers who may be the same person, with the reason for each. This only reads. It never merges, moves,
 * changes or removes anything: merging changes records, so it is not built, and nothing here calls it.
 */
export async function GET() {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()
    const db = getServiceClient()

    const people = await readAll<Row>((a, b) => db.from('customers').select('*').eq('shop_id', auth.shopId).order('id').range(a, b))
    if (people.failed) return NextResponse.json({ ok: false, error: 'Your customers could not be read, so no pairs were looked for. Try again.' }, { status: 500 })
    if (people.truncated) return NextResponse.json({ ok: false, error: 'Your customer book is too large to check here.' }, { status: 500 })

    const byId = new Map<string, Row>()
    for (const c of people.rows) byId.set(str(c.id), c)
    const all: DupPair[] = findDuplicatePairs(people.rows.map(c => ({
      id: str(c.id), name: c.name, phone: c.phone, email: c.email, vehicle_vin: c.vehicle_vin, vehicle_plate: c.vehicle_plate,
    })))
    const pairs = all.slice(0, MAX_PAIRS)

    // Paperwork and repair orders on each card, so the owner can see which one has the history.
    const ids = [...new Set(pairs.flatMap(p => [p.a, p.b]))]
    const docCount = new Map<string, number>()
    const jobCount = new Map<string, number>()
    let docsOk = true
    let jobsOk = true
    for (const part of chunk(ids, 100)) {
      const docs = await readAll<Row>((a, b) => db.from('documents').select('customer_id').eq('shop_id', auth.shopId).in('customer_id', part).order('id').range(a, b))
      if (docs.failed || docs.truncated) docsOk = false
      else for (const d of docs.rows) docCount.set(str(d.customer_id), (docCount.get(str(d.customer_id)) || 0) + 1)
      const jobs = await readAll<Row>((a, b) => db.from('jobs').select('customer_id').eq('shop_id', auth.shopId).in('customer_id', part).order('id').range(a, b))
      if (jobs.failed || jobs.truncated) jobsOk = false
      else for (const j of jobs.rows) jobCount.set(str(j.customer_id), (jobCount.get(str(j.customer_id)) || 0) + 1)
    }

    const snap = (id: string): Snap => {
      const c = byId.get(id) || {}
      return {
        id,
        name: str(c.name),
        phone: str(c.phone),
        email: str(c.email),
        address: str(c.address),
        vehicle: [str(c.vehicle_year), str(c.vehicle_make), str(c.vehicle_model)].filter(Boolean).join(' '),
        vin: str(c.vehicle_vin),
        plate: str(c.vehicle_plate),
        mileage: str(c.vehicle_mileage),
        notes: str(c.notes).slice(0, 300),
        created_at: str(c.created_at),
        documents: docsOk ? docCount.get(id) || 0 : null,
        jobs: jobsOk ? jobCount.get(id) || 0 : null,
        test_hint: looksLikeTest({ name: c.name, email: c.email }) || '',
      }
    }

    return NextResponse.json({
      ok: true,
      checked: people.rows.length,
      total: all.length,
      pairs: pairs.map(p => ({ a: snap(p.a), b: snap(p.b), reasons: p.reasons, strength: p.strength })),
    })
  } catch (error) {
    console.error('[customers/duplicates] GET error:', error)
    return NextResponse.json({ ok: false, error: 'The pairs could not be looked for. Try again.' }, { status: 500 })
  }
}
