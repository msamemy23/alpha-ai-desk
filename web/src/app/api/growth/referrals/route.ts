import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { forbidden, getRouteShop, unauthorized } from '@/lib/api-auth'
import { calculateDocumentTotals } from '@/lib/document-money'
import { referralCode } from '@/lib/growth-text'
import { checkRedemption, looksLikeCode, normalizeCode, paidAmount, summarize, type RedemptionRow } from '@/lib/growth-referrals'

export const dynamic = 'force-dynamic'

// Referral codes and what they brought in. The server makes the codes (so none repeats), checks every redemption
// (a new customer, not the code owner, one invoice credited once) and adds up what the referred customers paid.

type Row = Record<string, any>
const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status })
const isMissing = (e: { code?: string; message?: string } | null | undefined) => Boolean(e) && (e!.code === '42P01' || e!.code === 'PGRST205' || /schema cache|does not exist/i.test(e!.message || ''))
const fail = (error: unknown) => {
  console.error('[growth/referrals]', error instanceof Error ? error.message : error)
  return json({ ok: false, error: 'Something went wrong. Nothing was changed twice. Try again.' }, 500)
}
const needsUpdate = () => json({ ok: false, error: 'Referral tracking needs a database update before it can be used. Ask your developer to apply it.', needs_database_update: true }, 409)
/** Characters that would change a search filter. */
const safeSearch = (s: string) => s.replace(/[%_,()*\\]/g, ' ').trim().slice(0, 60)

export async function GET(req: NextRequest) {
  try {
    const q = req.nextUrl.searchParams
    const auth = await getRouteShop(req, q.get('shop_id'))
    if (!auth) return unauthorized()
    const db = getServiceClient()

    // Find an invoice to credit: recent invoices that have not been credited yet.
    if (q.get('invoices') !== null) {
      const term = safeSearch(q.get('invoices') || '')
      let query = db.from('documents').select('*').eq('shop_id', auth.shopId).in('type', ['Invoice', 'Receipt']).order('created_at', { ascending: false }).limit(15)
      if (term) query = query.or(`customer_name.ilike.%${term}%,doc_number.ilike.%${term}%`)
      const { data, error } = await query
      if (error) throw error
      const docs = (data || []) as Row[]
      const credited = new Set<string>()
      if (docs.length) {
        const r = await db.from('referral_redemptions').select('document_id').eq('shop_id', auth.shopId).in('document_id', docs.map(d => d.id))
        if (r.error && !isMissing(r.error)) throw r.error
        for (const row of r.data || []) credited.add(String(row.document_id))
      }
      return json({
        ok: true,
        invoices: docs.filter(d => !credited.has(String(d.id))).map(d => ({
          id: d.id, number: d.doc_number || '', customer_id: d.customer_id || null, customer: d.customer_name || 'No name', status: d.status || '', date: d.created_at,
          total: calculateDocumentTotals(d).total,
        })),
      })
    }

    // Look up one code, for checkout: whose is it and what does it give.
    if (q.get('code')) {
      const code = normalizeCode(q.get('code'))
      if (!looksLikeCode(code)) return json({ ok: false, error: 'That does not look like a referral code.' }, 400)
      const { data, error } = await db.from('referrals').select('*').eq('shop_id', auth.shopId).eq('code', code).maybeSingle()
      if (error) throw error
      if (!data) return json({ ok: false, error: 'That code was not found. Check the spelling.' }, 404)
      return json({ ok: true, code: data.code, referrer: data.customer_name, referrer_id: data.customer_id, discount_percent: Number(data.discount_percent) || 0, active: data.active !== false })
    }

    const codes = await db.from('referrals').select('*').eq('shop_id', auth.shopId).order('created_at', { ascending: false }).limit(1000)
    if (codes.error) throw codes.error
    const red = await db.from('referral_redemptions').select('*').eq('shop_id', auth.shopId).order('created_at', { ascending: false }).limit(500)
    if (red.error && !isMissing(red.error)) throw red.error
    const rows = (red.data || []) as Row[]

    // What each referred customer has actually paid so far, from the invoice itself.
    const ids = rows.map(r => r.document_id).filter(Boolean)
    const docs = new Map<string, Row>()
    for (let i = 0; i < ids.length; i += 100) {
      const d = await db.from('documents').select('*').eq('shop_id', auth.shopId).in('id', ids.slice(i, i + 100))
      if (d.error) throw d.error
      for (const doc of d.data || []) docs.set(String(doc.id), doc)
    }
    const redemptions: RedemptionRow[] = rows.map(r => {
      const doc = r.document_id ? docs.get(String(r.document_id)) : undefined
      const totals = doc ? calculateDocumentTotals(doc) : null
      return {
        id: String(r.id), code: String(r.code), referrer_name: r.referrer_name ?? null, referred_name: r.referred_name ?? null, document_id: r.document_id ?? null,
        reward_given: r.reward_given === true, reward_note: r.reward_note ?? null, created_at: String(r.created_at),
        paid: doc && totals ? paidAmount(totals, String(doc.status || '')) : 0, invoice_total: totals ? totals.total : 0,
      }
    })
    const usesByCode = new Map<string, number>()
    for (const r of redemptions) usesByCode.set(r.code, (usesByCode.get(r.code) || 0) + 1)
    return json({
      ok: true,
      codes: (codes.data || []).map((c: Row) => ({ id: c.id, code: c.code, customer_id: c.customer_id, customer_name: c.customer_name, discount_percent: Number(c.discount_percent) || 0, uses: usesByCode.get(String(c.code)) ?? (Number(c.uses) || 0), created_at: c.created_at })),
      redemptions,
      stats: summarize(codes.data || [], redemptions),
      needs_database_update: Boolean(red.error && isMissing(red.error)),
    })
  } catch (e) {
    return fail(e)
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    const auth = await getRouteShop(req, body?.shopId)
    if (!auth) return unauthorized()
    if (auth.role === 'viewer') return forbidden()
    const db = getServiceClient()
    const action = typeof body?.action === 'string' ? body.action : ''

    // A new code for a customer. One code per customer: asking again returns the one they have.
    if (action === 'create') {
      const customerId = typeof body?.customer_id === 'string' ? body.customer_id : ''
      const percentRaw = Number(body?.discount_percent ?? 10)
      if (!customerId) return json({ ok: false, error: 'Choose a customer first.' }, 400)
      if (!Number.isFinite(percentRaw) || percentRaw < 1 || percentRaw > 100) return json({ ok: false, error: 'Enter a discount from 1 to 100.' }, 400)
      const discount = Math.round(percentRaw * 100) / 100
      const { data: customer, error: cErr } = await db.from('customers').select('id,name').eq('id', customerId).eq('shop_id', auth.shopId).maybeSingle()
      if (cErr) throw cErr
      if (!customer) return json({ ok: false, error: 'That customer was not found.' }, 404)
      const existing = await db.from('referrals').select('*').eq('shop_id', auth.shopId).eq('customer_id', customerId).order('created_at', { ascending: true }).limit(1).maybeSingle()
      if (existing.error) throw existing.error
      if (existing.data) return json({ ok: true, existing: true, code: existing.data.code, discount_percent: Number(existing.data.discount_percent) || discount })
      let code = ''
      for (let attempt = 0; attempt < 10 && !code; attempt += 1) {
        const candidate = referralCode(customer.name)
        const dup = await db.from('referrals').select('id').eq('shop_id', auth.shopId).eq('code', candidate).limit(1).maybeSingle()
        if (dup.error) throw dup.error
        if (!dup.data) code = candidate
      }
      if (!code) return json({ ok: false, error: 'A code could not be made just now. Try again.' }, 503)
      const { error } = await db.from('referrals').insert({ shop_id: auth.shopId, customer_id: customerId, customer_name: customer.name, code, discount_percent: discount, uses: 0 })
      if (error) throw error
      await db.from('growth_activity').insert({ shop_id: auth.shopId, action: 'referral_created', target: customer.name, details: `Code: ${code}`, status: 'sent', created_at: new Date().toISOString() })
      return json({ ok: true, existing: false, code, discount_percent: discount })
    }

    // Credit an invoice to a code.
    if (action === 'redeem') {
      const code = normalizeCode(body?.code)
      const documentId = typeof body?.document_id === 'string' ? body.document_id : ''
      if (!looksLikeCode(code)) return json({ ok: false, error: 'Enter the referral code.', code: 'no_code' }, 400)
      if (!documentId) return json({ ok: false, error: 'Choose the invoice the new customer paid for.', code: 'no_invoice' }, 400)
      const ref = await db.from('referrals').select('*').eq('shop_id', auth.shopId).eq('code', code).maybeSingle()
      if (ref.error) throw ref.error
      const doc = await db.from('documents').select('*').eq('shop_id', auth.shopId).eq('id', documentId).maybeSingle()
      if (doc.error) throw doc.error
      const referrerRow = ref.data?.customer_id ? (await db.from('customers').select('id,name,phone,email').eq('shop_id', auth.shopId).eq('id', ref.data.customer_id).maybeSingle()).data as Row | null : null
      const referredRow = doc.data?.customer_id ? (await db.from('customers').select('id,name,phone,email').eq('shop_id', auth.shopId).eq('id', doc.data.customer_id).maybeSingle()).data as Row | null : null
      const referred = referredRow
        ? { id: String(referredRow.id), name: String(referredRow.name || ''), phone: referredRow.phone, email: referredRow.email }
        : doc.data ? { id: null, name: String(doc.data.customer_name || ''), phone: doc.data.customer_phone, email: doc.data.customer_email } : null

      let earlier = 0
      if (referredRow && doc.data) {
        const r = await db.from('documents').select('id', { count: 'exact', head: true }).eq('shop_id', auth.shopId).eq('customer_id', referredRow.id).in('type', ['Invoice', 'Receipt']).neq('id', doc.data.id).lt('created_at', doc.data.created_at)
        if (r.error) throw r.error
        earlier = r.count || 0
      }
      const dupDoc = await db.from('referral_redemptions').select('id').eq('shop_id', auth.shopId).eq('document_id', documentId).limit(1).maybeSingle()
      if (dupDoc.error) { if (isMissing(dupDoc.error)) return needsUpdate(); throw dupDoc.error }
      let alreadyReferred = false
      if (referredRow) {
        const r = await db.from('referral_redemptions').select('id').eq('shop_id', auth.shopId).eq('referred_customer_id', referredRow.id).limit(1).maybeSingle()
        if (r.error) throw r.error
        alreadyReferred = Boolean(r.data)
      }

      const verdict = checkRedemption({
        referral: ref.data ? { id: String(ref.data.id), code: String(ref.data.code), customer_id: ref.data.customer_id ?? null, customer_name: String(ref.data.customer_name || ''), active: ref.data.active ?? null } : null,
        referrer: referrerRow ? { id: String(referrerRow.id), name: String(referrerRow.name || ''), phone: referrerRow.phone, email: referrerRow.email } : null,
        referred,
        document: doc.data ? { id: String(doc.data.id), type: String(doc.data.type || ''), customer_id: doc.data.customer_id ?? null } : null,
        earlierInvoices: earlier,
        documentAlreadyCredited: Boolean(dupDoc.data),
        customerAlreadyReferred: alreadyReferred,
      })
      if (!verdict.ok) return json({ ok: false, error: verdict.error, code: verdict.code }, 409)

      const totals = calculateDocumentTotals(doc.data as Row)
      const discount = Number(ref.data!.discount_percent) || 0
      const inserted = await db.from('referral_redemptions').insert({
        shop_id: auth.shopId, code, referrer_customer_id: ref.data!.customer_id ?? null, referrer_name: ref.data!.customer_name ?? null,
        referred_customer_id: referredRow?.id ?? null, referred_name: referred?.name || null, document_id: documentId,
        revenue: totals.total, discount_amount: Math.round(totals.total * discount) / 100, created_by: auth.userId,
      }).select('id').single()
      if (inserted.error) {
        if (isMissing(inserted.error)) return needsUpdate()
        // Two people pressing the button at once: the database refuses the second.
        if (inserted.error.code === '23505') return json({ ok: false, error: 'This invoice or customer was just credited to a referral.', code: 'doc_credited' }, 409)
        throw inserted.error
      }
      const count = await db.from('referral_redemptions').select('id', { count: 'exact', head: true }).eq('shop_id', auth.shopId).eq('code', code)
      if (!count.error) await db.from('referrals').update({ uses: count.count || 0 }).eq('id', ref.data!.id).eq('shop_id', auth.shopId)
      await db.from('growth_activity').insert({ shop_id: auth.shopId, action: 'referral_redeemed', target: referred?.name || 'New customer', details: `Referred by ${ref.data!.customer_name} (${code})`, status: 'sent', created_at: new Date().toISOString() })
      return json({ ok: true, id: inserted.data.id, referrer: ref.data!.customer_name, referred: referred?.name || '', discount_percent: discount, message: `Credited. ${ref.data!.customer_name} referred ${referred?.name || 'a new customer'}. Remember to give them their reward.` })
    }

    // Mark that the thank-you reward was given to the person who referred.
    if (action === 'reward') {
      const id = typeof body?.id === 'string' ? body.id : ''
      if (!id) return json({ ok: false, error: 'Choose a referral first.' }, 400)
      const note = typeof body?.note === 'string' ? body.note.trim().slice(0, 300) : ''
      const { data, error } = await db.from('referral_redemptions').update({ reward_given: body?.given !== false, reward_note: note || null }).eq('id', id).eq('shop_id', auth.shopId).select('id').maybeSingle()
      if (error) { if (isMissing(error)) return needsUpdate(); throw error }
      if (!data) return json({ ok: false, error: 'That referral was not found.' }, 404)
      return json({ ok: true })
    }

    return json({ ok: false, error: 'Unknown action' }, 400)
  } catch (e) {
    return fail(e)
  }
}
