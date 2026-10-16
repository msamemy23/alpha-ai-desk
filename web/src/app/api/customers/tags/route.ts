import { NextRequest, NextResponse } from 'next/server'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { isMissingDbObject } from '@/lib/db-missing'
import { writeAuditLog } from '@/lib/audit-log'
import { loadCustomerRef, readAll } from '@/lib/customers/server'
import { cleanTags } from '@/lib/customers/segments'

export const dynamic = 'force-dynamic'

const MAX_TAGS = 12
type Row = Record<string, unknown>

/**
 * Tags on customers. With ?customer_id= it returns that customer's tags. Without it, it returns every tag in the shop and
 * which customers have it, for the filter on the Customers list. Read only.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()
    const db = getServiceClient()

    const wanted = req.nextUrl.searchParams.get('customer_id')
    if (wanted !== null) {
      const found = await loadCustomerRef(db, auth.shopId, wanted)
      if (found.failed) return NextResponse.json({ ok: false, error: 'The customer could not be loaded.' }, { status: 500 })
      if (!found.customer) return NextResponse.json({ ok: false, error: 'Customer not found.' }, { status: 404 })
      const meta = await db.from('customer_meta').select('tags').eq('shop_id', auth.shopId).eq('customer_id', found.customer.id).maybeSingle()
      if (meta.error) {
        if (isMissingDbObject(meta.error)) return NextResponse.json({ ok: true, available: false, tags: [] })
        return NextResponse.json({ ok: false, error: 'Tags could not be loaded.' }, { status: 500 })
      }
      return NextResponse.json({ ok: true, available: true, tags: cleanTags(meta.data?.tags) })
    }

    const all = await readAll<Row>((a, b) => db.from('customer_meta').select('customer_id,tags').eq('shop_id', auth.shopId).order('customer_id').range(a, b))
    if (all.failed) {
      if (isMissingDbObject(all.error)) return NextResponse.json({ ok: true, available: false, by_customer: {}, summary: [] })
      return NextResponse.json({ ok: false, error: 'Tags could not be loaded.' }, { status: 500 })
    }
    const byCustomer: Record<string, string[]> = {}
    const counts = new Map<string, { tag: string; count: number }>()
    for (const row of all.rows) {
      const tags = cleanTags(row.tags)
      if (tags.length === 0) continue
      byCustomer[String(row.customer_id)] = tags
      for (const tag of tags) {
        const k = tag.toLowerCase()
        const hit = counts.get(k)
        if (hit) hit.count += 1; else counts.set(k, { tag, count: 1 })
      }
    }
    const summary = [...counts.values()].sort((x, y) => y.count - x.count || x.tag.localeCompare(y.tag, undefined, { sensitivity: 'base' }))
    return NextResponse.json({ ok: true, available: true, by_customer: byCustomer, summary })
  } catch (error) {
    console.error('[customers/tags] GET error:', error)
    return NextResponse.json({ ok: false, error: 'Tags could not be loaded.' }, { status: 500 })
  }
}

/** Replaces one customer's tags with the list sent (at most 12). Only the tags are written, so contact choices stay as they are. */
export async function PUT(req: NextRequest) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()
    if (auth.role === 'viewer') return forbidden()

    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    if (!body || !Array.isArray(body.tags)) return NextResponse.json({ ok: false, error: 'Send the full list of tags.' }, { status: 400 })
    if (body.tags.length > MAX_TAGS) return NextResponse.json({ ok: false, error: `A customer can have up to ${MAX_TAGS} tags.` }, { status: 400 })
    const tags = cleanTags(body.tags.filter((t): t is string => typeof t === 'string'))

    const db = getServiceClient()
    const found = await loadCustomerRef(db, auth.shopId, body.customer_id)
    if (found.failed) return NextResponse.json({ ok: false, error: 'The customer could not be loaded.' }, { status: 500 })
    if (!found.customer) return NextResponse.json({ ok: false, error: 'Customer not found.' }, { status: 404 })

    // Only the tags column is written (plus who and when), so do-not-call, do-not-email and the best time are left alone.
    const { error } = await db.from('customer_meta').upsert({
      shop_id: auth.shopId,
      customer_id: found.customer.id,
      tags,
      updated_by: auth.userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'shop_id,customer_id' })
    if (error) {
      if (isMissingDbObject(error)) return NextResponse.json({ ok: false, error: 'Tags need a database update first.' }, { status: 503 })
      return NextResponse.json({ ok: false, error: 'The tags could not be saved. Try again.' }, { status: 500 })
    }
    await writeAuditLog({ shopId: auth.shopId, userId: auth.userId, action: 'customer.tags', targetType: 'customer', targetId: found.customer.id, permission: 'write', approved: true, metadata: { tags } }).catch(() => undefined)
    return NextResponse.json({ ok: true, tags })
  } catch (error) {
    console.error('[customers/tags] PUT error:', error)
    return NextResponse.json({ ok: false, error: 'The tags could not be saved. Try again.' }, { status: 500 })
  }
}
