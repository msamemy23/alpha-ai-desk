import { NextRequest, NextResponse } from 'next/server'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { isMissingDbObject } from '@/lib/db-missing'
import { loadCallCustomer } from '@/lib/ai-call-server'
import { normalizePhoneDigits } from '@/lib/sms-normalize'
import { writeAuditLog } from '@/lib/audit-log'

export const dynamic = 'force-dynamic'

const CHANNELS = new Set(['call', 'text', 'email'])
const EMPTY = { do_not_call: false, do_not_email: false, best_time: '', preferred_channel: '' }

/**
 * How one customer may be contacted: the shop's own choices (do not call, do not email, best time) and whether the number
 * replied STOP to texts. Texting can be turned back on only by the customer's own START, so nothing here changes it.
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()
    const db = getServiceClient()
    const found = await loadCallCustomer(db, auth.shopId, req.nextUrl.searchParams.get('customer_id'))
    if (found.failed) return NextResponse.json({ ok: false, error: 'The customer could not be loaded.' }, { status: 500 })
    if (!found.customer) return NextResponse.json({ ok: false, error: 'Customer not found.' }, { status: 404 })

    let available = true
    let prefs = { ...EMPTY }
    const meta = await db.from('customer_meta').select('do_not_call,do_not_email,best_time,preferred_channel').eq('shop_id', auth.shopId).eq('customer_id', found.customer.id).maybeSingle()
    if (meta.error) {
      if (isMissingDbObject(meta.error)) available = false
      else return NextResponse.json({ ok: false, error: 'Contact choices could not be loaded.' }, { status: 500 })
    } else if (meta.data) {
      prefs = {
        do_not_call: meta.data.do_not_call === true,
        do_not_email: meta.data.do_not_email === true,
        best_time: typeof meta.data.best_time === 'string' ? meta.data.best_time : '',
        preferred_channel: typeof meta.data.preferred_channel === 'string' && CHANNELS.has(meta.data.preferred_channel) ? meta.data.preferred_channel : '',
      }
    }

    let sms: { opted_out: boolean; source: string; updated_at: string } | null = null
    let smsCheckFailed = false
    const digits = normalizePhoneDigits(found.customer.phone)
    if (digits) {
      const consent = await db.from('sms_consents').select('opted_out,source,updated_at').eq('shop_id', auth.shopId).eq('phone_digits', digits).maybeSingle()
      if (consent.error) smsCheckFailed = true
      else if (consent.data) sms = { opted_out: consent.data.opted_out === true, source: String(consent.data.source || ''), updated_at: String(consent.data.updated_at || '') }
    }
    return NextResponse.json({ ok: true, available, prefs, sms, sms_check_failed: smsCheckFailed })
  } catch (error) {
    console.error('[customers/contact-prefs] GET error:', error)
    return NextResponse.json({ ok: false, error: 'Contact choices could not be loaded.' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()
    if (auth.role === 'viewer') return forbidden()

    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    const db = getServiceClient()
    const found = await loadCallCustomer(db, auth.shopId, body?.customer_id)
    if (found.failed) return NextResponse.json({ ok: false, error: 'The customer could not be loaded.' }, { status: 500 })
    if (!found.customer) return NextResponse.json({ ok: false, error: 'Customer not found.' }, { status: 404 })

    const change: Record<string, unknown> = {}
    if (body && 'do_not_call' in body) { if (typeof body.do_not_call !== 'boolean') return NextResponse.json({ ok: false, error: 'do_not_call must be on or off.' }, { status: 400 }); change.do_not_call = body.do_not_call }
    if (body && 'do_not_email' in body) { if (typeof body.do_not_email !== 'boolean') return NextResponse.json({ ok: false, error: 'do_not_email must be on or off.' }, { status: 400 }); change.do_not_email = body.do_not_email }
    if (body && 'best_time' in body) {
      if (typeof body.best_time !== 'string') return NextResponse.json({ ok: false, error: 'Best time must be text.' }, { status: 400 })
      change.best_time = body.best_time.trim().slice(0, 120) || null
    }
    if (body && 'preferred_channel' in body) {
      const v = body.preferred_channel
      if (v !== null && v !== '' && !(typeof v === 'string' && CHANNELS.has(v))) return NextResponse.json({ ok: false, error: 'Pick call, text or email.' }, { status: 400 })
      change.preferred_channel = v ? v : null
    }
    if (Object.keys(change).length === 0) return NextResponse.json({ ok: false, error: 'Nothing to change.' }, { status: 400 })

    // Only the columns sent are written, so tags and fleet details saved with this customer stay as they are.
    const { error } = await db.from('customer_meta').upsert({
      shop_id: auth.shopId,
      customer_id: found.customer.id,
      ...change,
      updated_by: auth.userId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'shop_id,customer_id' })
    if (error) {
      if (isMissingDbObject(error)) return NextResponse.json({ ok: false, error: 'Contact choices need a database update first.' }, { status: 503 })
      return NextResponse.json({ ok: false, error: 'The choice could not be saved. Try again.' }, { status: 500 })
    }
    await writeAuditLog({ shopId: auth.shopId, userId: auth.userId, action: 'customer.contact_choice', targetType: 'customer', targetId: found.customer.id, permission: 'write', approved: true, metadata: change }).catch(() => undefined)
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[customers/contact-prefs] PUT error:', error)
    return NextResponse.json({ ok: false, error: 'The choice could not be saved. Try again.' }, { status: 500 })
  }
}
