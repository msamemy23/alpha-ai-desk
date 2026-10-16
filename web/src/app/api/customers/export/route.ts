import { NextResponse } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { calcTotals, getServiceClient } from '@/lib/supabase'
import { isMissingDbObject } from '@/lib/db-missing'
import { normalizePhoneDigits } from '@/lib/sms-normalize'
import { writeAuditLog } from '@/lib/audit-log'
import { readAll } from '@/lib/customers/server'
import { customersCsv, exportFileName } from '@/lib/customers/export'
import type { ExportCustomer } from '@/lib/customers/export'
import { customerStats } from '@/lib/customers/stats'
import type { StatDoc, StatJob } from '@/lib/customers/stats'
import { cleanTags } from '@/lib/customers/segments'

export const dynamic = 'force-dynamic'

type Row = Record<string, unknown>
const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v))

const total = (d: Row): number => {
  try { return Number(calcTotals(d).total) || 0 } catch { return 0 }
}

/**
 * This shop's customer list as a CSV file: the columns export.ts defines and no others. Read only. Cells that could run as a
 * formula in a spreadsheet are guarded by the CSV writer. The money columns use the same document maths as the Customers
 * screen, and if any of the reads fails nothing is sent, so a file never carries wrong or missing money.
 */
export async function GET() {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()
    const db = getServiceClient()
    const fail = (error: string) => NextResponse.json({ ok: false, error }, { status: 500 })

    const [people, jobRows, paper] = await Promise.all([
      readAll<Row>((a, b) => db.from('customers').select('*').eq('shop_id', auth.shopId).order('id').range(a, b)),
      readAll<Row>((a, b) => db.from('jobs').select('id,customer_id,created_at,status').eq('shop_id', auth.shopId).order('id').range(a, b)),
      readAll<Row>((a, b) => db.from('documents').select('id,customer_id,type,status,created_at,parts,labors,shop_supplies,sublet,tax_rate,apply_tax,deposit,amount_paid').eq('shop_id', auth.shopId).in('type', ['Invoice', 'Receipt']).order('id').range(a, b)),
    ])
    if (people.failed || jobRows.failed || paper.failed) return fail('Your customers could not be read, so no file was made. Try again.')
    if (people.truncated || jobRows.truncated || paper.truncated) return fail('There are too many records to put in one file. Nothing was exported.')

    // Tags are optional: without the customer records update the file simply has an empty Tags column.
    const tagsOf = new Map<string, string[]>()
    const meta = await readAll<Row>((a, b) => db.from('customer_meta').select('customer_id,tags').eq('shop_id', auth.shopId).order('customer_id').range(a, b))
    if (meta.failed && !isMissingDbObject(meta.error)) return fail('Customer tags could not be read, so no file was made. Try again.')
    if (!meta.failed) for (const m of meta.rows) tagsOf.set(str(m.customer_id), cleanTags(m.tags))

    // The text permission is never guessed: if it cannot be read, the column says so.
    const stopped = new Set<string>()
    const consent = await readAll<Row>((a, b) => db.from('sms_consents').select('phone_digits,opted_out').eq('shop_id', auth.shopId).order('phone_digits').range(a, b))
    const consentKnown = !consent.failed || isMissingDbObject(consent.error)
    if (!consent.failed) for (const c of consent.rows) if (c.opted_out === true) stopped.add(str(c.phone_digits))

    const docsBy = new Map<string, StatDoc[]>()
    for (const d of paper.rows) {
      const id = str(d.customer_id)
      if (!id) continue
      const list = docsBy.get(id) || []
      list.push({ id: str(d.id), type: str(d.type), status: str(d.status), date: str(d.created_at), total: total(d), paid: Number(d.amount_paid) || 0 })
      docsBy.set(id, list)
    }
    const jobsBy = new Map<string, StatJob[]>()
    for (const j of jobRows.rows) {
      const id = str(j.customer_id)
      if (!id) continue
      const list = jobsBy.get(id) || []
      list.push({ id: str(j.id), created: str(j.created_at), status: str(j.status) })
      jobsBy.set(id, list)
    }

    const now = Date.now()
    const list: ExportCustomer[] = people.rows.map(c => {
      const id = str(c.id)
      const s = customerStats(docsBy.get(id) || [], jobsBy.get(id) || [], now, str(c.created_at))
      const phone = str(c.phone).trim()
      const textStatus = !phone ? 'No phone'
        : c.sms_opted_out === true || stopped.has(normalizePhoneDigits(phone)) ? 'Opted out'
        : consentKnown ? 'Can text' : 'Not checked'
      return {
        name: str(c.name), phone, email: str(c.email), address: str(c.address), preferred_contact: str(c.preferred_contact),
        vehicle_year: str(c.vehicle_year), vehicle_make: str(c.vehicle_make), vehicle_model: str(c.vehicle_model), vehicle_vin: str(c.vehicle_vin),
        vehicle_plate: str(c.vehicle_plate), vehicle_mileage: str(c.vehicle_mileage), notes: str(c.notes), created_at: str(c.created_at),
        tags: tagsOf.get(id) || [], textStatus, visits: s.visits, lastVisit: s.lastVisit, lifetime: s.lifetime, owed: s.owed,
      }
    }).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))

    await writeAuditLog({ shopId: auth.shopId, userId: auth.userId, action: 'customer.export', targetType: 'customer', permission: 'read', approved: true, metadata: { count: list.length } }).catch(() => undefined)

    // A byte-order mark first, so a spreadsheet opens accented names correctly.
    return new Response(`﻿${customersCsv(list)}`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${exportFileName(new Date().toISOString().slice(0, 10))}"`,
        'Cache-Control': 'private, no-store',
        'X-Customer-Count': String(list.length),
      },
    })
  } catch (error) {
    console.error('[customers/export] GET error:', error)
    return NextResponse.json({ ok: false, error: 'The file could not be made. Try again.' }, { status: 500 })
  }
}
