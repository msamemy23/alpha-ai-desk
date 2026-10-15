// An in-memory shop for testing the automation engine: a store that behaves like the database
// (unique keys, claim-before-send, cancel-queued) and senders that only record what they were asked to send.
// Nothing here can reach a phone, an inbox or a database.

import { normalizeRules } from '../../src/lib/automation-rules.ts'

export const SHOP_ID = '11111111-1111-4111-8111-111111111111'

export function fakeShop(overrides = {}) {
  return {
    shopId: SHOP_ID,
    name: 'Bayou City Garage',
    phone: '7135550188',
    timezone: 'America/Chicago',
    reviewUrl: 'https://g.page/r/bayou-city-garage/review',
    smsReady: true,
    emailReady: false,
    rules: normalizeRules({}),
    states: {},
    ...overrides,
  }
}

export function enabledState(extra = {}) {
  return { enabled: true, enabled_at: '2026-01-01T00:00:00Z', config: {}, last_run: null, run_count: 0, last_result: null, last_status: 'never', ...extra }
}

export function emptyRaw() {
  return { customers: [], documents: [], jobs: [], appointments: [], vehicles: [], dvi: [], growth_leads: [], leads: [] }
}

export function createFake({ shop = fakeShop(), raw = emptyRaw(), recent = [], optedOutPhones = [], optedOutEmails = [], optedOutCustomers = [], start = Date.parse('2026-10-14T20:00:00Z') } = {}) {
  let t = start
  let seq = 0
  const state = {
    shop,
    raw,
    recent: [...recent],
    messages: [],
    optedOutPhones: new Set(optedOutPhones.map(p => String(p).replace(/\D/g, '').slice(-10))),
    optedOutEmails: new Set(optedOutEmails),
    optedOutCustomers: new Set(optedOutCustomers),
    consentFails: false,
    visitCheckFails: false,
    after: [],
    alerts: [],
    sent: [],
    sendPlan: [], // results to return in order; empty means success
  }
  const iso = ms => new Date(ms).toISOString()
  const key = p => String(p ?? '').replace(/\D/g, '').slice(-10)

  const store = {
    async loadShop() { return state.shop },
    async loadRaw() { return state.raw },
    async recentSends(_shop, since) {
      const fromMessages = state.messages
        .filter(m => m.status === 'sent' && !m.is_test && new Date(m.sent_at).getTime() >= since)
        .map(m => ({ customerId: m.customer_id, phone: m.channel === 'sms' ? m.recipient : null, email: m.channel === 'email' ? m.recipient : null, automationId: m.automation_id, klass: m.message_class, at: new Date(m.sent_at).getTime() }))
      return [...state.recent.filter(r => r.at >= since), ...fromMessages]
    },
    async existingKeys(_shop, keys) {
      const wanted = new Set(keys)
      return new Set(state.messages.filter(m => m.dedupe_key && wanted.has(m.dedupe_key) && m.status !== 'cancelled').map(m => m.dedupe_key))
    },
    async blockedDestinations(_shop, phones, emails) {
      return {
        phones: new Set(phones.filter(p => state.optedOutPhones.has(p))),
        emails: new Set(emails.filter(e => state.optedOutEmails.has(e))),
      }
    },
    async cameBackSince(_shop, customerId, sinceMs) {
      if (state.visitCheckFails) throw new Error('visits unavailable')
      return state.raw.documents.some(d => d.customer_id === customerId && ['Invoice', 'Receipt'].includes(d.type) && d.status !== 'Void' && new Date(d.created_at).getTime() >= sinceMs)
    },
    async isOptedOut(_shop, channel, destination, customerId) {
      if (state.consentFails) throw new Error('consent unavailable')
      if (customerId && state.optedOutCustomers.has(customerId)) return true
      return channel === 'sms' ? state.optedOutPhones.has(key(destination)) : state.optedOutEmails.has(String(destination).toLowerCase())
    },
    async insertMessages(rows) {
      const out = []
      for (const r of rows) {
        if (r.dedupe_key && state.messages.some(m => m.dedupe_key === r.dedupe_key)) continue
        const row = { ...r, id: `m${++seq}`, attempts: 0, next_attempt_at: null, provider_message_id: null, sent_at: null, last_error: null, created_at: iso(t), updated_at: iso(t) }
        state.messages.push(row)
        out.push(row)
      }
      return out
    },
    async dueMessages(_shop, nowMs, limit, automationId) {
      return state.messages
        .filter(m => m.status === 'queued' && new Date(m.send_after).getTime() <= nowMs && (!m.next_attempt_at || new Date(m.next_attempt_at).getTime() <= nowMs) && (!automationId || m.automation_id === automationId))
        .sort((a, b) => new Date(a.send_after) - new Date(b.send_after))
        .slice(0, limit)
        .map(m => ({ ...m }))
    },
    async claimMessage(row) {
      const m = state.messages.find(x => x.id === row.id)
      if (!m || m.status !== 'queued') return null
      m.status = 'sending'
      m.attempts += 1
      return { ...m }
    },
    async finishMessage(row, patch) {
      const m = state.messages.find(x => x.id === row.id)
      Object.assign(m, patch)
    },
    async cancelQueued(_shop, automationId, reason, campaignId) {
      let n = 0
      for (const m of state.messages) {
        const scope = campaignId ? m.campaign_id === campaignId : automationId ? m.automation_id === automationId && !m.campaign_id : true
        if (m.status === 'queued' && scope) {
          m.status = 'cancelled'; m.skip_reason = reason; m.dedupe_key = null; n += 1
        }
      }
      return n
    },
    async afterSent(row) { state.after.push(row.id) },
  }

  const senders = {
    async sms(m) { return reply(m, 'sms') },
    async email(m) { return reply(m, 'email') },
  }
  function reply(m, channel) {
    state.sent.push({ channel, to: m.to, text: m.text, subject: m.subject, key: m.idempotencyKey, id: m.row.id })
    const next = state.sendPlan.shift()
    if (next instanceof Error) throw next
    return next ?? { ok: true, id: `prov-${m.row.id}` }
  }

  const deps = {
    store,
    senders,
    now: () => t,
    alert: async (shopId, a) => { state.alerts.push({ shopId, ...a }) },
  }
  return {
    state,
    deps,
    at: ms => { t = typeof ms === 'string' ? Date.parse(ms) : ms },
    advance: ms => { t += ms },
    get now() { return t },
  }
}

export const customer = (id, name, phone, extra = {}) => ({ id, name, phone, email: '', sms_opted_out: false, sentiment: 'neutral', ...extra })

export const paidInvoice = (id, customerId, paidAt, extra = {}) => ({
  id, type: 'Invoice', status: 'Paid', doc_number: `INV-2026-${id}`, customer_id: customerId, customer_name: 'x',
  created_at: paidAt, updated_at: paidAt, vehicle_year: '2019', vehicle_make: 'Honda', vehicle_model: 'Civic', ...extra,
})
