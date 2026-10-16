import type { SupabaseClient } from '@supabase/supabase-js'
import { isMissingDbObject } from '@/lib/db-missing'
import { isSmsOptedOut } from '@/lib/sms-consent'
import { buildCallPlan, buildFreeCallPlan, checkAiCall, MAX_FIELD, type CallCheck, type CallPlan, type CallReasonId, type CallRequest } from '@/lib/ai-call'
import { phoneDigits, phoneKey, validTimezone } from '@/lib/automation-rules'

export interface CallShop {
  name: string
  phone: string
  timeZone: string
  rules: Record<string, unknown> | null
  configured: boolean
  telnyxApiKey: string
  telnyxPhone: string
  telnyxConnectionId: string
}

export interface CallCustomerMatch { id: string; name: string }

export interface CallContext {
  shop: CallShop
  customers: CallCustomerMatch[]
  doNotCall: boolean
  optedOut: boolean
  lookupFailed: boolean
}

/** The shop's calling settings and automation rules. Throws only when the settings cannot be read at all. */
export async function loadCallShop(db: SupabaseClient, shopId: string): Promise<CallShop> {
  const { data, error } = await db.from('settings').select('*').eq('shop_id', shopId).maybeSingle()
  if (error) throw new Error('Shop calling settings could not be loaded')
  const apiKey = String(data?.telnyx_api_key || '')
  const phone = String(data?.telnyx_phone_number || '')
  const connection = String(data?.telnyx_connection_id || '')
  const config = data?.automation_config && typeof data.automation_config === 'object' ? data.automation_config as Record<string, unknown> : null
  const rules = config && config._rules && typeof config._rules === 'object' ? config._rules as Record<string, unknown> : null
  return {
    name: String(data?.shop_name || '').trim().slice(0, 120),
    phone: String(data?.shop_phone || '').trim().slice(0, 40),
    timeZone: validTimezone(data?.timezone),
    rules,
    configured: Boolean(apiKey && phone && connection),
    telnyxApiKey: apiKey,
    telnyxPhone: phone,
    telnyxConnectionId: connection,
  }
}

/** Customers whose saved phone is this number. Phone formats vary, so the last four digits narrow it and the full ten decide. */
export async function customersWithPhone(db: SupabaseClient, shopId: string, phone: unknown): Promise<{ rows: CallCustomerMatch[]; failed: boolean }> {
  const key = phoneKey(phone)
  if (key.length < 10) return { rows: [], failed: false }
  const { data, error } = await db.from('customers').select('id,name,phone').eq('shop_id', shopId).ilike('phone', `%${key.slice(-4)}%`).limit(60)
  if (error) return { rows: [], failed: true }
  const rows = (data || []).filter(c => phoneKey(c.phone) === key).map(c => ({ id: String(c.id), name: String(c.name || '').trim() }))
  return { rows, failed: false }
}

/** Everything the call rules need to know about one number: who it belongs to, and whether it may be called. */
export async function loadCallContext(db: SupabaseClient, shopId: string, phone: unknown, shop?: CallShop): Promise<CallContext> {
  const theShop = shop || await loadCallShop(db, shopId)
  let lookupFailed = false
  const found = await customersWithPhone(db, shopId, phone)
  if (found.failed) lookupFailed = true

  let doNotCall = false
  if (found.rows.length > 0) {
    const meta = await db.from('customer_meta').select('customer_id,do_not_call').eq('shop_id', shopId).in('customer_id', found.rows.map(c => c.id))
    if (meta.error) {
      // The table not being there yet means no choices were ever saved; any other error is a failed check.
      if (!isMissingDbObject(meta.error)) lookupFailed = true
    } else doNotCall = (meta.data || []).some(m => m.do_not_call === true)
  }

  let optedOut = false
  if (phoneDigits(phone).length >= 10) {
    try { optedOut = await isSmsOptedOut(db, shopId, phone) } catch { lookupFailed = true }
  }
  return { shop: theShop, customers: found.rows, doNotCall, optedOut, lookupFailed }
}

/** The rules every assistant-placed call must pass, run on the server whatever the screen showed. */
export function checkCallContext(ctx: CallContext, phone: unknown, now?: Date): CallCheck {
  return checkAiCall({
    phone,
    configured: ctx.shop.configured,
    doNotCall: ctx.doNotCall,
    optedOut: ctx.optedOut,
    lookupFailed: ctx.lookupFailed,
    shopTimeZone: ctx.shop.timeZone,
    rules: ctx.shop.rules,
    now,
  })
}

/** What the browser sent for the call review, trimmed to plain text. The server builds the real instruction itself from this. */
export function readCallRequest(raw: unknown): CallRequest {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')
  return {
    reason: text(r.reason, 20) as CallReasonId,
    vehicle: text(r.vehicle, 120),
    when: text(r.when, 120),
    amount: text(r.amount, 60),
    note: text(r.note, MAX_FIELD),
  }
}

export interface CallCustomer { id: string; name: string; phone: string }

/** One customer of this shop, or null. The shop id is always part of the lookup. */
export async function loadCallCustomer(db: SupabaseClient, shopId: string, customerId: unknown): Promise<{ customer: CallCustomer | null; failed: boolean }> {
  const id = typeof customerId === 'string' ? customerId.trim() : ''
  if (!/^[0-9a-f-]{32,36}$/i.test(id)) return { customer: null, failed: false }
  const { data, error } = await db.from('customers').select('id,name,phone').eq('shop_id', shopId).eq('id', id).maybeSingle()
  if (error) return { customer: null, failed: true }
  if (!data) return { customer: null, failed: false }
  return { customer: { id: String(data.id), name: String(data.name || '').trim(), phone: String(data.phone || '').trim() }, failed: false }
}

export type ResolvedCall =
  | { ok: true; customer: CallCustomer; plan: CallPlan }
  | { ok: false; status: number; error: string }

/**
 * Who is being called and what Alpha would say, from what the browser sent. Two ways in: a customer chosen on their card with
 * the review card's choices, or a number with some words (a call proposed in Ask Alpha). The instruction is always built here.
 * A number that is not a saved customer comes back with an empty id.
 */
export async function resolveCall(db: SupabaseClient, shopId: string, shop: CallShop, body: Record<string, unknown> | null): Promise<ResolvedCall> {
  const to = typeof body?.to === 'string' ? body.to.trim().slice(0, 40) : ''
  if (!body?.customer_id && to) {
    const known = await customersWithPhone(db, shopId, to)
    if (known.failed) return { ok: false, status: 500, error: 'The number could not be checked. Nothing was dialled.' }
    const match = known.rows[0]
    const customer: CallCustomer = { id: match?.id || '', name: match?.name || '', phone: to }
    const plan = buildFreeCallPlan({ task: typeof body?.task === 'string' ? body.task : '', shopName: shop.name, customerName: customer.name })
    return { ok: true, customer, plan }
  }
  const found = await loadCallCustomer(db, shopId, body?.customer_id)
  if (found.failed) return { ok: false, status: 500, error: 'The customer could not be loaded. Nothing was dialled.' }
  if (!found.customer) return { ok: false, status: 404, error: 'Customer not found. Nothing was dialled.' }
  const plan = buildCallPlan({ request: readCallRequest(body?.request), shopName: shop.name, customerName: found.customer.name })
  return { ok: true, customer: found.customer, plan }
}
