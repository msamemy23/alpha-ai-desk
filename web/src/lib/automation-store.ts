// The real database and phone company behind the automation engine (automation-engine.ts).
// Reads the shop's rows, keeps the message ledger, and sends through the shop's own Telnyx and email accounts.
//
// Every table added by migration 040 is optional here: if it is not there yet, reads return nothing and the
// caller is told to show a "needs a database update" notice for that feature only.

import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { calculateDocumentTotals } from '@/lib/document-money'
import { sendEmail } from '@/lib/email'
import { emailHtml, emailPlainText, sendResendEmail } from '@/lib/marketing-email'
import { sendDurableSms } from '@/lib/durable-sms'
import { isSmsOptedOut } from '@/lib/sms-consent'
import { findings, normalizeSections } from '@/lib/dvi'
import { createUnsubscribeToken, unsubscribeUrl } from '@/lib/unsubscribe-token'
import { normalizeRules, phoneKey, validTimezone, type Channel, type RecentSend } from '@/lib/automation-rules'
import { CATALOG, CATALOG_BY_ID, type DataNeed, type Raw } from '@/lib/automation-catalog'
import type { AutomationState, MessageRow, NewMessage, OutgoingMessage, SendResult, Senders, ShopInfo, Store } from '@/lib/automation-engine'

type Db = SupabaseClient
type Row = Record<string, any>

const DAY = 86_400_000
const PAGE = 1000

/** Postgres or PostgREST saying a table or column is not there (the database update has not been applied). */
export function isMissing(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  return error.code === '42P01' || error.code === '42703' || error.code === 'PGRST205' || error.code === 'PGRST204'
    || /schema cache|does not exist|could not find the/i.test(error.message || '')
}

export class NeedsDatabaseUpdate extends Error {
  constructor(public what = 'automation messages') {
    super(`The database update for ${what} has not been applied yet.`)
  }
}

async function pageAll<T>(make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code?: string; message?: string } | null }>, max = 10_000): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; from < max; from += PAGE) {
    const { data, error } = await make(from, from + PAGE - 1)
    if (error) throw error
    out.push(...(data || []))
    if (!data || data.length < PAGE) break
  }
  return out
}

/** Like pageAll, but a missing table or column gives an empty list. */
async function pageOptional<T>(make: Parameters<typeof pageAll<T>>[0]): Promise<T[]> {
  try {
    return await pageAll<T>(make)
  } catch (error) {
    if (isMissing(error as { code?: string; message?: string })) return []
    throw error
  }
}

// ── The shop ──────────────────────────────────────────────────────────────

const RULES_KEY = '_rules'

export function splitConfig(raw: unknown): { rules: ReturnType<typeof normalizeRules>; states: Record<string, AutomationState | undefined>; rulesRaw: Record<string, unknown> } {
  const all = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>
  const rulesRaw = (all[RULES_KEY] && typeof all[RULES_KEY] === 'object' ? all[RULES_KEY] : {}) as Record<string, unknown>
  const states: Record<string, AutomationState | undefined> = {}
  for (const d of CATALOG) {
    const s = all[d.id]
    if (s && typeof s === 'object') states[d.id] = s as AutomationState
  }
  return { rules: normalizeRules(rulesRaw), states, rulesRaw }
}

export async function loadShopInfo(db: Db, shopId: string): Promise<ShopInfo & { settingsId: string | null; updatedAt: string | null; address: string; shopEmail: string; rawConfig: Record<string, unknown> }> {
  const { data, error } = await db.from('settings').select('*').eq('shop_id', shopId).order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error('Unable to load shop settings')
  const s = (data || {}) as Row
  const parsed = splitConfig(s.automation_config)
  return {
    shopId,
    name: String(s.shop_name || '').trim(),
    phone: String(s.shop_phone || '').trim(),
    timezone: validTimezone(s.timezone),
    reviewUrl: String(s.google_review_url || s.google_review_link || '').trim(),
    smsReady: Boolean(s.telnyx_api_key && s.telnyx_phone_number),
    emailReady: Boolean(s.resend_api_key && s.from_email && String(s.shop_address || '').trim()),
    rules: parsed.rules,
    states: parsed.states,
    settingsId: s.id ? String(s.id) : null,
    updatedAt: s.updated_at ? String(s.updated_at) : null,
    address: String(s.shop_address || '').trim(),
    shopEmail: String(s.shop_email || '').trim(),
    rawConfig: (s.automation_config && typeof s.automation_config === 'object' ? s.automation_config : {}) as Record<string, unknown>,
  }
}

// ── Reading rows for the finders ──────────────────────────────────────────

function withMoney(d: Row): Row {
  try {
    const t = calculateDocumentTotals(d)
    const paid = t.amountPaid > 0 ? Math.min(t.amountPaid, t.total || t.amountPaid) : d.status === 'Paid' ? t.total : 0
    return { ...d, __total: t.total, __paid: paid }
  } catch {
    return { ...d, __total: 0, __paid: 0 }
  }
}

const ymd = (ms: number, tz: string): string => {
  const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms))
  const v = Object.fromEntries(p.map(x => [x.type, x.value]))
  return `${v.year}-${v.month}-${v.day}`
}

async function loadRaw(db: Db, shopId: string, needs: readonly DataNeed[], now: number, tz: string): Promise<Raw> {
  const want = new Set(needs)
  const raw: Raw = { customers: [], documents: [], jobs: [], appointments: [], vehicles: [], dvi: [], growth_leads: [], leads: [] }
  if (want.has('customers')) {
    raw.customers = await pageAll<Row>((a, b) => db.from('customers').select('*').eq('shop_id', shopId).order('created_at', { ascending: true }).range(a, b))
    // Tags the shop put on the customer card (migration 053). Promotions can be aimed at a tag.
    const meta = await pageOptional<Row>((a, b) => db.from('customer_meta').select('customer_id,tags').eq('shop_id', shopId).range(a, b))
    if (meta.length) {
      const tags = new Map(meta.map(m => [String(m.customer_id), Array.isArray(m.tags) ? m.tags : []]))
      for (const c of raw.customers) if (!Array.isArray(c.tags) && tags.has(String(c.id))) c.tags = tags.get(String(c.id))
    }
  }
  if (want.has('documents')) {
    const since = new Date(now - 800 * DAY).toISOString()
    const docs = await pageAll<Row>((a, b) => db.from('documents').select('*').eq('shop_id', shopId).gte('created_at', since).order('created_at', { ascending: false }).range(a, b))
    raw.documents = docs.map(withMoney)
  }
  if (want.has('jobs')) {
    raw.jobs = await pageAll<Row>((a, b) => db.from('jobs').select('id,customer_id,customer_name,status,vehicle_year,vehicle_make,vehicle_model,updated_at').eq('shop_id', shopId).eq('status', 'Ready for Pickup').gte('updated_at', new Date(now - 14 * DAY).toISOString()).range(a, b))
  }
  if (want.has('appointments')) {
    const from = ymd(now - DAY, tz)
    const to = ymd(now + 5 * DAY, tz)
    raw.appointments = await pageAll<Row>((a, b) => db.from('appointments').select('*').eq('shop_id', shopId).gte('date', from).lte('date', to).in('status', ['Scheduled', 'Confirmed']).range(a, b))
  }
  if (want.has('vehicles')) {
    raw.vehicles = await pageAll<Row>((a, b) => db.from('vehicles').select('*').eq('shop_id', shopId).range(a, b))
  }
  if (want.has('growth_leads')) {
    raw.growth_leads = await pageOptional<Row>((a, b) => db.from('growth_leads').select('id,name,phone,email,status,needs_followup,converted,touch_count,last_contact,created_at').eq('shop_id', shopId).eq('converted', false).range(a, b))
  }
  if (want.has('leads')) {
    raw.leads = await pageOptional<Row>((a, b) => db.from('leads').select('id,name,owner_name,email,status,source,service_needed,created_at').eq('shop_id', shopId).eq('status', 'new').not('email', 'is', null).order('created_at', { ascending: true }).range(a, b))
  }
  if (want.has('dvi')) {
    // Inspections the customer answered need migration 036. Without it there is simply nothing to read.
    const rows = await pageOptional<Row>((a, b) => db.from('dvi').select('id,customer_id,customer_name,vehicle,sections,customer_decisions,customer_decided_at,updated_at,created_at').eq('shop_id', shopId).not('customer_decided_at', 'is', null).range(a, b))
    raw.dvi = rows.map(r => {
      const decisions = (r.customer_decisions && typeof r.customer_decisions === 'object' ? r.customer_decisions : {}) as Record<string, string>
      let names: string[] = []
      try {
        names = findings(normalizeSections(r.sections)).filter(f => decisions[f.id] === 'declined').map(f => f.name)
      } catch { names = [] }
      return { id: r.id, customer_id: r.customer_id, customer_name: r.customer_name, vehicle: r.vehicle, customer_decided_at: r.customer_decided_at, updated_at: r.updated_at, created_at: r.created_at, declinedNames: names }
    }).filter(r => r.declinedNames.length > 0)
  }
  return raw
}

// ── The store ─────────────────────────────────────────────────────────────

export function createStore(db: Db): Store & { db: Db; recoverStuck: (shopId: string, nowMs: number) => Promise<void> } {
  return {
    db,

    async loadShop(shopId) {
      return loadShopInfo(db, shopId)
    },

    async loadRaw(shopId, needs, now) {
      const info = await loadShopInfo(db, shopId)
      return loadRaw(db, shopId, needs, now, info.timezone)
    },

    async recentSends(shopId, sinceMs) {
      const since = new Date(sinceMs).toISOString()
      const out: RecentSend[] = []
      const mine = await pageOptional<Row>((a, b) => db.from('automation_messages').select('customer_id,recipient,channel,automation_id,message_class,sent_at').eq('shop_id', shopId).eq('status', 'sent').eq('is_test', false).gte('sent_at', since).range(a, b))
      for (const m of mine) {
        out.push({ customerId: m.customer_id, phone: m.channel === 'sms' ? m.recipient : null, email: m.channel === 'email' ? m.recipient : null, automationId: m.automation_id, klass: m.message_class, at: new Date(m.sent_at).getTime() })
      }
      // Texts the older automations sent before this ledger existed still count toward the limits.
      const legacy: Array<[string, string, 'service' | 'marketing', string]> = [
        ['growth_review_requests', 'review_requests', 'marketing', 'phone'],
        ['growth_followups', 're_engagement', 'marketing', 'phone'],
        ['estimate_followups_sent', 'estimate_followups', 'service', ''],
        ['service_reminders_sent', 'service_reminders', 'service', ''],
      ]
      for (const [table, automationId, klass, phoneColumn] of legacy) {
        const cols = ['customer_id', 'created_at', phoneColumn].filter(Boolean).join(',')
        const rows = await pageOptional<Row>((a, b) => db.from(table).select(cols).eq('shop_id', shopId).eq('sent', true).gte('created_at', since).range(a, b))
        for (const r of rows) out.push({ customerId: r.customer_id, phone: phoneColumn ? r[phoneColumn] : null, automationId, klass, at: new Date(r.created_at).getTime() })
      }
      return out
    },

    async existingKeys(shopId, keys) {
      const found = new Set<string>()
      const unique = [...new Set(keys)]
      for (let i = 0; i < unique.length; i += 150) {
        const chunk = unique.slice(i, i + 150)
        const { data, error } = await db.from('automation_messages').select('dedupe_key').eq('shop_id', shopId).in('dedupe_key', chunk).neq('status', 'cancelled')
        if (error) { if (isMissing(error)) break; throw error }
        for (const r of data || []) if (r.dedupe_key) found.add(String(r.dedupe_key))
      }
      // Estimates the older follow-up already handled.
      const estimateIds = unique.filter(k => k.startsWith('estimate_followups:')).map(k => k.slice('estimate_followups:'.length))
      for (let i = 0; i < estimateIds.length; i += 150) {
        const { data, error } = await db.from('estimate_followups_sent').select('estimate_id').eq('shop_id', shopId).eq('sent', true).in('estimate_id', estimateIds.slice(i, i + 150))
        if (error) { if (isMissing(error)) break; throw error }
        for (const r of data || []) found.add(`estimate_followups:${r.estimate_id}`)
      }
      return found
    },

    async blockedDestinations(shopId, phones, emails) {
      const out = { phones: new Set<string>(), emails: new Set<string>() }
      if (phones.length) {
        const consents = await pageAll<Row>((a, b) => db.from('sms_consents').select('phone_digits').eq('shop_id', shopId).eq('opted_out', true).range(a, b))
        const stopped = new Set(consents.map(c => phoneKey(c.phone_digits)))
        const flagged = await pageAll<Row>((a, b) => db.from('customers').select('phone').eq('shop_id', shopId).eq('sms_opted_out', true).range(a, b))
        for (const c of flagged) stopped.add(phoneKey(c.phone))
        for (const p of phones) if (stopped.has(p)) out.phones.add(p)
      }
      if (emails.length) {
        const rows = await pageOptional<Row>((a, b) => db.from('email_opt_outs').select('email_lower').eq('shop_id', shopId).range(a, b))
        const stopped = new Set(rows.map(r => String(r.email_lower)))
        // Customers the shop marked "do not email" on the customer card.
        const marked = await pageOptional<Row>((a, b) => db.from('customer_meta').select('customer_id').eq('shop_id', shopId).eq('do_not_email', true).range(a, b))
        const markedIds = marked.map(r => String(r.customer_id))
        for (let i = 0; i < markedIds.length; i += 150) {
          const { data, error } = await db.from('customers').select('email').eq('shop_id', shopId).in('id', markedIds.slice(i, i + 150))
          if (error) throw new Error('Email consent could not be checked')
          for (const c of data || []) if (c.email) stopped.add(String(c.email).trim().toLowerCase())
        }
        for (const e of emails) if (stopped.has(e)) out.emails.add(e)
      }
      return out
    },

    async cameBackSince(shopId, customerId, sinceMs) {
      const { count, error } = await db.from('documents').select('id', { count: 'exact', head: true })
        .eq('shop_id', shopId).eq('customer_id', customerId).in('type', ['Invoice', 'Receipt']).neq('status', 'Void')
        .gte('created_at', new Date(sinceMs).toISOString())
      if (error) throw new Error('Recent visits could not be checked')
      return (count || 0) > 0
    },

    async isOptedOut(shopId, channel, destination, customerId) {
      if (channel === 'sms') {
        if (await isSmsOptedOut(db, shopId, destination)) return true
        if (customerId) {
          const { data, error } = await db.from('customers').select('sms_opted_out').eq('shop_id', shopId).eq('id', customerId).maybeSingle()
          if (error) throw new Error('Customer consent could not be checked')
          if (data?.sms_opted_out === true) return true
        }
        const flagged = await pageAll<Row>((a, b) => db.from('customers').select('phone').eq('shop_id', shopId).eq('sms_opted_out', true).range(a, b))
        const key = phoneKey(destination)
        return flagged.some(c => phoneKey(c.phone) === key)
      }
      const { data, error } = await db.from('email_opt_outs').select('email_lower').eq('shop_id', shopId).eq('email_lower', destination.trim().toLowerCase()).maybeSingle()
      if (error && !isMissing(error)) throw new Error('Email consent could not be checked')
      if (data) return true
      if (customerId) {
        const meta = await db.from('customer_meta').select('do_not_email').eq('shop_id', shopId).eq('customer_id', customerId).maybeSingle()
        if (meta.error && !isMissing(meta.error)) throw new Error('Email consent could not be checked')
        if (meta.data?.do_not_email === true) return true
      }
      return false
    },

    async insertMessages(rows) {
      const out: MessageRow[] = []
      for (let i = 0; i < rows.length; i += 200) {
        const chunk = rows.slice(i, i + 200)
        const { data, error } = await db.from('automation_messages').upsert(chunk, { onConflict: 'shop_id,dedupe_key', ignoreDuplicates: true }).select('*')
        if (error) { if (isMissing(error)) throw new NeedsDatabaseUpdate(); throw new Error(error.message) }
        out.push(...((data || []) as MessageRow[]))
      }
      return out
    },

    async dueMessages(shopId, nowMs, limit, automationId) {
      const iso = new Date(nowMs).toISOString()
      let q = db.from('automation_messages').select('*').eq('shop_id', shopId).eq('status', 'queued').lte('send_after', iso).or(`next_attempt_at.is.null,next_attempt_at.lte.${iso}`).order('send_after', { ascending: true }).limit(limit)
      if (automationId) q = q.eq('automation_id', automationId)
      const { data, error } = await q
      if (error) { if (isMissing(error)) return []; throw new Error(error.message) }
      return (data || []) as MessageRow[]
    },

    async claimMessage(row, nowMs) {
      const { data, error } = await db.from('automation_messages')
        .update({ status: 'sending', attempts: row.attempts + 1, updated_at: new Date(nowMs).toISOString() })
        .eq('id', row.id).eq('shop_id', row.shop_id).eq('status', 'queued').eq('attempts', row.attempts)
        .select('*').maybeSingle()
      if (error) throw new Error(error.message)
      return (data as MessageRow | null) ?? null
    },

    async finishMessage(row, patch: Partial<MessageRow>) {
      const { error } = await db.from('automation_messages').update({ ...patch, updated_at: patch.updated_at || new Date().toISOString() })
        .eq('id', row.id).eq('shop_id', row.shop_id).in('status', ['queued', 'sending'])
      if (error) throw new Error(error.message)
    },

    async cancelQueued(shopId, automationId, reason, campaignId) {
      let q = db.from('automation_messages').update({ status: 'cancelled', skip_reason: reason, dedupe_key: null, updated_at: new Date().toISOString() }).eq('shop_id', shopId).eq('status', 'queued')
      if (campaignId) q = q.eq('campaign_id', campaignId)
      else if (automationId) q = q.eq('automation_id', automationId).is('campaign_id', null)
      const { data, error } = await q.select('id')
      if (error) { if (isMissing(error)) return 0; throw new Error(error.message) }
      return (data || []).length
    },

    async afterSent(row) {
      if (row.source_type === 'lead' && row.source_id) {
        // The lead moves to "contacted" and the Get more customers history shows what went out.
        const at = new Date().toISOString()
        await db.from('leads').update({ status: 'contacted', last_contact: at, updated_at: at }).eq('id', row.source_id).eq('shop_id', row.shop_id).eq('status', 'new')
        await db.from('outreach_history').insert({ shop_id: row.shop_id, lead_id: row.source_id, method: row.channel, status: 'sent', message: row.body, to_contact: row.recipient, ai_mode: false, metadata: { automation: row.automation_id, message_id: row.id }, created_at: at })
        await db.from('growth_activity').insert({ shop_id: row.shop_id, action: 'outreach_email', target: row.recipient_name, details: 'Lead outreach email sent by an automation', status: 'sent', created_at: at })
      }
      if (row.source_type === 'growth_lead' && row.source_id) {
        // One more touch on the lead, so the next follow-up waits its turn. Only if nobody else touched it meanwhile.
        const { data } = await db.from('growth_leads').select('touch_count').eq('id', row.source_id).eq('shop_id', row.shop_id).maybeSingle()
        if (data) await db.from('growth_leads').update({ touch_count: (Number(data.touch_count) || 1) + 1, last_contact: new Date().toISOString() }).eq('id', row.source_id).eq('shop_id', row.shop_id).eq('touch_count', data.touch_count)
      }
      if (row.source_type === 'appointment' && row.source_id) {
        await db.from('appointments').update({ reminder_sent_at: new Date().toISOString() }).eq('id', row.source_id).eq('shop_id', row.shop_id).is('reminder_sent_at', null)
      }
    },

    /** A worker that died mid-send leaves a row stuck as "sending". Texts go back in line (the carrier ledger stops a repeat); emails are marked uncertain. */
    async recoverStuck(shopId, nowMs) {
      const cutoff = new Date(nowMs - 10 * 60_000).toISOString()
      await db.from('automation_messages').update({ status: 'queued', updated_at: new Date(nowMs).toISOString() }).eq('shop_id', shopId).eq('status', 'sending').eq('channel', 'sms').lt('updated_at', cutoff)
      await db.from('automation_messages').update({ status: 'unknown', last_error: 'The email may or may not have gone out. Check before sending again.', updated_at: new Date(nowMs).toISOString() }).eq('shop_id', shopId).eq('status', 'sending').eq('channel', 'email').lt('updated_at', cutoff)
    },
  }
}

// ── Sending ───────────────────────────────────────────────────────────────

async function credentialsFor(db: Db, shopId: string) {
  const { data, error } = await db.from('settings').select('*').eq('shop_id', shopId).order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (error || !data) throw new Error('Shop settings could not be loaded')
  const { data: profile } = await db.from('shop_profiles').select('user_id').eq('id', shopId).maybeSingle()
  return { settings: data as Row, userId: String(profile?.user_id || '') }
}

export function createSenders(db: Db, baseUrl: string): Senders {
  return {
    async sms(m: OutgoingMessage, shop: ShopInfo): Promise<SendResult> {
      const { settings, userId } = await credentialsFor(db, shop.shopId)
      const request = new Request('https://internal.invalid/automation', { method: 'POST', headers: { 'Idempotency-Key': m.idempotencyKey } })
      const result = await sendDurableSms({
        request, db, shopId: shop.shopId, userId, to: m.to, text: m.text, customerId: m.row.customer_id, settings: {
          telnyx_api_key: settings.telnyx_api_key, telnyx_phone_number: settings.telnyx_phone_number, telnyx_messaging_profile_id: settings.telnyx_messaging_profile_id,
        },
      })
      if (result.ok) return { ok: true, id: result.messageId }
      const uncertain = result.uncertain === true || /uncertain|do not retry|reconcile/i.test(result.error)
      return { ok: false, error: result.error, uncertain }
    },

    async email(m: OutgoingMessage, shop: ShopInfo): Promise<SendResult> {
      const { settings } = await credentialsFor(db, shop.shopId)
      if (!settings.resend_api_key || !settings.from_email) return { ok: false, error: 'Email is not configured for this shop' }
      const marketing = m.row.message_class === 'marketing'
      if (marketing && !String(settings.shop_address || '').trim()) return { ok: false, error: 'Email is not configured: add your shop address in Settings' }
      const footer = {
        shopName: String(settings.shop_name || ''),
        address: String(settings.shop_address || ''),
        phone: String(settings.shop_phone || ''),
        unsubscribe: marketing ? unsubscribeUrl(baseUrl, createUnsubscribeToken(shop.shopId, m.to)) : undefined,
      }
      try {
        const sent = await sendResendEmail({
          apiKey: String(settings.resend_api_key),
          from: String(settings.from_email),
          to: m.to,
          subject: m.subject || String(settings.shop_name || 'A message from your auto shop'),
          html: emailHtml(m.text, footer),
          text: emailPlainText(m.text, footer),
          replyTo: String(settings.shop_email || '') || undefined,
          unsubscribeUrl: footer.unsubscribe,
          idempotencyKey: m.idempotencyKey,
        })
        return { ok: true, id: sent.id }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : 'The email could not be sent', uncertain: false }
      }
    },
  }
}

// ── Failure alerts ────────────────────────────────────────────────────────

/** Tell the shop by email, at most once a day for each automation. The email goes to the shop's own address and names no customer. */
export function createAlerter(db: Db) {
  return async (shopId: string, alert: { automationId: string; count: number; error: string; advice: string }): Promise<void> => {
    const info = await loadShopInfo(db, shopId)
    const to = info.shopEmail
    if (!to || !info.emailReady) return
    const name = CATALOG_BY_ID[alert.automationId]?.name || 'An automation'
    const marker = `alert:${shopId}:${alert.automationId}`
    const { data } = await db.from('scheduler_heartbeats').select('last_tick_at').eq('name', marker).maybeSingle()
    if (data?.last_tick_at && Date.now() - new Date(data.last_tick_at).getTime() < DAY) return
    const { settings } = await credentialsFor(db, shopId)
    await sendEmail({
      to,
      subject: `${name} needs your attention`,
      html: emailHtml(`${name} could not send ${alert.count} ${alert.count === 1 ? 'message' : 'messages'}.\n\n${alert.advice}\n\nOpen Automations in your shop software to see which messages failed and why.`, { shopName: info.name, address: info.address }),
      apiKey: String(settings.resend_api_key),
      from: String(settings.from_email),
      idempotencyKey: `${marker}:${new Date().toISOString().slice(0, 10)}`,
    })
    await db.from('scheduler_heartbeats').upsert({ name: marker, last_tick_at: new Date().toISOString(), detail: { count: alert.count } }, { onConflict: 'name' })
  }
}

export async function touchHeartbeat(db: Db, name: string, detail: Record<string, unknown> = {}): Promise<void> {
  const { error } = await db.from('scheduler_heartbeats').upsert({ name, last_tick_at: new Date().toISOString(), detail }, { onConflict: 'name' })
  if (error && !isMissing(error)) throw new Error(error.message)
}

export async function readHeartbeat(db: Db, name: string): Promise<{ at: string; detail: Record<string, unknown> } | null> {
  const { data, error } = await db.from('scheduler_heartbeats').select('last_tick_at,detail').eq('name', name).maybeSingle()
  if (error) { if (isMissing(error)) return null; throw new Error(error.message) }
  return data ? { at: String(data.last_tick_at), detail: (data.detail || {}) as Record<string, unknown> } : null
}

export const hashOf = (v: string): string => createHash('sha256').update(v).digest('hex').slice(0, 24)

export type { Channel, NewMessage }
