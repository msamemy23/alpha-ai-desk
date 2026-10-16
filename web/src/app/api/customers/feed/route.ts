import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { statusWord } from '@/components/jobs/types'
import { loadCustomerRef } from '@/lib/customers/server'
import { FEED_KIND_LIMIT, buildFeed, feedPhoneKey, readKind } from '@/lib/customers/feed'
import type { FeedRow } from '@/lib/customers/feed'

export const dynamic = 'force-dynamic'

// Just the columns each kind needs. A document's lines and rates are here because its total is worked out the same way as
// everywhere else in the app.
const DOC_COLS = 'id,customer_id,type,status,doc_number,created_at,parts,labors,shop_supplies,sublet,tax_rate,apply_tax,deposit,amount_paid'
const JOB_COLS = 'id,customer_id,ro_number,concern,status,created_at,vehicle_year,vehicle_make,vehicle_model'
// Not every database has the repair order number column (the timeclock kiosk reads it the same way).
const JOB_COLS_NO_RO = JOB_COLS.replace('ro_number,', '')
const APPT_COLS = 'id,customer_id,phone,service,status,date,time,created_at'
const MESSAGE_COLS = 'id,direction,body,created_at,from_address,to_address'
const CALL_COLS = 'id,direction,duration_secs,start_time,status,from_number,to_number'
const DVI_COLS = 'id,job_id,customer_id,vehicle,overall_status,sent_to_customer,customer_approved,created_at'
// Before the customer link was added to inspections (migration 036) the table has no customer_id column.
const DVI_COLS_OLD = 'id,job_id,vehicle,overall_status,sent_to_customer,customer_approved,created_at'
const NOTE_COLS = 'id,customer_id,body,pinned,author_name,created_at'
// Appointments are matched by customer and by the last four digits of the phone, then checked against the whole number.
const APPT_READ = 100

/**
 * Everything that has happened with one customer in one list, newest first: estimates, invoices, repair orders, appointments,
 * texts, calls, inspections and notes. Read only. The shop always comes from the signed-in session; every query is limited to
 * that shop and to this customer. A kind that cannot be read (a table not set up yet, or an error) comes back empty with a
 * short note saying so, and the rest of the feed still shows.
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

    const notes: string[] = []
    const card = await db.from('customers').select('phone').eq('shop_id', auth.shopId).eq('id', id).maybeSingle()
    const phone = card.error ? '' : feedPhoneKey(card.data?.phone)
    const noTexts: { rows: FeedRow[]; note: string } = { rows: [], note: '' }
    if (card.error) notes.push('Texts and calls could not be read, so they are left out.')
    else if (!phone) notes.push('There is no phone number on this customer’s card, so texts and calls are left out.')

    const jobs = readKind('Repair orders', [
      () => db.from('jobs').select(JOB_COLS).eq('shop_id', auth.shopId).eq('customer_id', id).order('created_at', { ascending: false }).limit(FEED_KIND_LIMIT),
      () => db.from('jobs').select(JOB_COLS_NO_RO).eq('shop_id', auth.shopId).eq('customer_id', id).order('created_at', { ascending: false }).limit(FEED_KIND_LIMIT),
    ])
    const [docs, jobRows, appointments, messages, calls, inspections, customerNotes] = await Promise.all([
      readKind('Estimates and invoices', [
        () => db.from('documents').select(DOC_COLS).eq('shop_id', auth.shopId).eq('customer_id', id).order('created_at', { ascending: false }).limit(FEED_KIND_LIMIT),
      ]),
      jobs,
      readKind('Appointments', [
        () => db.from('appointments').select(APPT_COLS).eq('shop_id', auth.shopId)
          .or(phone ? `customer_id.eq.${id},phone.ilike.%${phone.slice(-4)}%` : `customer_id.eq.${id}`)
          .order('date', { ascending: false }).order('time', { ascending: false }).limit(APPT_READ),
      ]),
      phone
        ? readKind('Texts', [
          () => db.from('messages').select(MESSAGE_COLS).eq('shop_id', auth.shopId)
            .or(`from_address.ilike.%${phone}%,to_address.ilike.%${phone}%`).order('created_at', { ascending: false }).limit(FEED_KIND_LIMIT),
        ])
        : noTexts,
      phone
        ? readKind('Calls', [
          () => db.from('call_history').select(CALL_COLS).eq('shop_id', auth.shopId)
            .or(`from_number.ilike.%${phone}%,to_number.ilike.%${phone}%`).order('start_time', { ascending: false }).limit(FEED_KIND_LIMIT),
        ])
        : noTexts,
      readKind('Inspections', [
        () => db.from('dvi').select(DVI_COLS).eq('shop_id', auth.shopId).eq('customer_id', id).order('created_at', { ascending: false }).limit(FEED_KIND_LIMIT),
        // Without the customer link, an inspection is this customer's when it is on one of this customer's repair orders.
        async () => {
          const ids = (await jobs).rows.map(r => String(r.id || '')).filter(Boolean)
          if (ids.length === 0) return { data: [], error: null }
          return db.from('dvi').select(DVI_COLS_OLD).eq('shop_id', auth.shopId).in('job_id', ids).order('created_at', { ascending: false }).limit(FEED_KIND_LIMIT)
        },
      ]),
      readKind('Notes', [
        () => db.from('customer_notes').select(NOTE_COLS).eq('shop_id', auth.shopId).eq('customer_id', id).is('archived_at', null).order('created_at', { ascending: false }).limit(FEED_KIND_LIMIT),
      ]),
    ])
    for (const kind of [docs, jobRows, appointments, messages, calls, inspections, customerNotes]) if (kind.note) notes.push(kind.note)

    const { items, total } = buildFeed({
      docs: docs.rows, jobs: jobRows.rows, appointments: appointments.rows, messages: messages.rows, calls: calls.rows,
      inspections: inspections.rows, notes: customerNotes.rows,
    }, { customerId: id, phone, jobWord: statusWord })

    return NextResponse.json({ ok: true, items, total, notes })
  } catch (error) {
    console.error('[customers/feed] GET error:', error)
    return NextResponse.json({ ok: false, error: 'This customer’s feed could not be loaded.' }, { status: 500 })
  }
}
