/**
 * What happens when a customer texts the shop's number.
 *
 * Order matters and is the same every time:
 *   record the text, honour STOP / START / HELP, check consent, then the shop's rules (switch, automated senders, a person
 *   took over, rate limit, quiet hours), then the decision engine, then send or draft, then log what happened.
 *
 * All outside effects (sending a text, sending an email, reading consent) are passed in, so the same code runs in the
 * webhook and under test, and the test screen can stop short of sending.
 */
import { decideTurn, emptyState, readState } from './engine.ts'
import type { ConvState, Decision, ModelFn, Outcome } from './engine.ts'
import { isAutomatedSenderAddress, isRepeat, looksAutomated, smsKeyword } from './guardrails.ts'
import { inQuietHours, wallClock } from './hours.ts'
import { shopNumberOf } from '../text-channel.ts'
import { firstTextIntro, helpReply, OPT_OUT_LINE, shopFromSettings, startReply } from './prompt.ts'
import type { ShopProfile } from './prompt.ts'
import { phoneKey, phoneLikePattern } from './rules.ts'
import type { VoiceRules } from './rules.ts'
import { admitsAi } from './guardrails.ts'
import { applyBooking, raiseNeedsPerson, syncBooking } from './actions.ts'
import type { EmailSender } from './actions.ts'
import { newTextEmail } from './notify.ts'
import type { InboundMedia } from './media.ts'
import { fallbackSummary } from './prompt.ts'
import {
  customerContext, forContact, getThreadState, latestSmsInteraction, loadRules, openInteraction, patchInteraction,
  recentTexts, threadFacts, unionFired, upcomingAppointments, errKind,
} from './store.ts'
import type { Db, InteractionRow, ThreadFacts } from './store.ts'

export interface ShopRow { shop_id: string; [column: string]: any }

export interface SmsConsent {
  /** Throws when consent cannot be read, so the caller fails closed. */
  isOptedOut(shopId: string, phone: string): Promise<boolean>
  optOut(shopId: string, phone: string, source: string): Promise<void>
  optIn(shopId: string, phone: string, source: string): Promise<void>
}

export interface SmsDeps {
  db: Db
  now: () => Date
  send: (to: string, text: string, opts: { idempotencyKey: string }) => Promise<void>
  model: ModelFn | null
  email: EmailSender
  consent: SmsConsent
  appUrl: string
  /** Keeps a copy of pictures and video the customer sent. Optional: texting works without it. */
  saveMedia?: (shopId: string, messageId: string, contactKey: string, media: InboundMedia[]) => Promise<void>
}

export interface InboundSms {
  from: string
  body: string
  messageId: string
  /** Telnyx already answered a STOP, START or HELP keyword for this message. */
  autoResponded?: boolean
  /** Pictures or video that came with the text. */
  media?: InboundMedia[]
}

export type SmsAction =
  | 'ignored' | 'opt_out' | 'opt_in' | 'help' | 'opted_out' | 'skipped' | 'sent' | 'draft' | 'silent' | 'flagged'

export interface SmsResult {
  action: SmsAction
  reason: string
  rulesFired: string[]
  sent?: string
  inboundMessageId?: string | null
  decision?: Decision
}

/* ---------------- which tables exist ---------------- */

export interface Tables { interactions: boolean; bookings: boolean; threadState: boolean }
const probeCache = new Map<string, { at: number; value: Tables }>()
export function resetProbeCache() { probeCache.clear() }

export async function probeTables(db: Db, nowMs: number): Promise<Tables> {
  const hit = probeCache.get('tables')
  if (hit && nowMs - hit.at < 60_000) return hit.value
  const check = async (table: string) => {
    try { const { error } = await db.from(table).select('shop_id').limit(1); return !(error && errKind(error) === 'missing') } catch { return false }
  }
  const [interactions, bookings, threadState] = await Promise.all([check('ai_interactions'), check('ai_booking_requests'), check('ai_thread_state')])
  const value = { interactions, bookings, threadState }
  probeCache.set('tables', { at: nowMs, value })
  return value
}

/* ---------------- pieces shared with the test screen ---------------- */

/** The words that actually go out: the AI notice and the opt-out line on the first message in a conversation. */
export function composeSms(say: string, rules: VoiceRules, shop: ShopProfile, hasPriorAi: boolean): { text: string; fired: string[] } {
  const clean = say.replace(/\s+/g, ' ').trim()
  if (!clean) return { text: '', fired: [] }
  if (hasPriorAi) return { text: clean, fired: [] }
  const intro = admitsAi(clean) ? '' : firstTextIntro(rules, shop)
  return { text: `${intro} ${clean} ${OPT_OUT_LINE}`.replace(/\s+/g, ' ').trim(), fired: ['first_reply', 'ai_disclosure'] }
}

const RANK: Record<Outcome, number> = {
  booked: 6, booking_requested: 5, transferred: 5, needs_person: 4, after_hours: 3, message_taken: 3, answered: 2, spam: 2, opt_out: 2, draft: 1, silent: 0, missed: 0,
}
export function betterOutcome(prev: Outcome | undefined, next: Outcome): Outcome {
  if (!prev) return next
  return (RANK[next] ?? 0) >= (RANK[prev] ?? 0) ? next : prev
}

const EPISODE_HOURS = 12

async function replayState(deps: SmsDeps, rules: VoiceRules, shop: ShopProfile, facts: ThreadFacts, fromNumber: string, skipLast: boolean): Promise<ConvState> {
  let st = emptyState()
  const cutoff = deps.now().getTime() - EPISODE_HOURS * 3_600_000
  const mine = facts.history.filter(h => h.role === 'user' && h.at >= cutoff)
  const past = skipLast ? mine.slice(0, -1) : mine
  for (const m of past.slice(-6)) {
    const d = await decideTurn({ channel: 'sms', text: m.content, rules, shop, now: deps.now(), state: st, history: [], context: { fromNumber }, model: null })
    st = d.state
  }
  return st
}

/* ---------------- the handler ---------------- */

export async function processInboundSms(deps: SmsDeps, shopRow: ShopRow, msg: InboundSms): Promise<SmsResult> {
  const { db } = deps
  const shopId = String(shopRow.shop_id)
  const shop = shopFromSettings(shopRow)
  const now = deps.now()
  const fromRaw = msg.from
  const body = msg.body || ''
  const key = phoneKey(fromRaw)
  const fired: string[] = []
  const done = (r: Omit<SmsResult, 'rulesFired'> & { rulesFired?: string[] }): SmsResult => ({ ...r, rulesFired: r.rulesFired || fired })

  if (!fromRaw || !key) return done({ action: 'ignored', reason: 'no_number' })
  // The number customers text: the Telnyx number, or the owner's own phone when the shop chose that.
  const shopNumber = shopNumberOf(shopRow)
  if (!shopNumber) return done({ action: 'ignored', reason: 'no_shop_number' })
  if (phoneKey(shopNumber) === key) return done({ action: 'ignored', reason: 'own_number' })

  if (msg.messageId) {
    const { data: existing } = await db.from('messages').select('id').eq('shop_id', shopId).eq('telnyx_message_id', msg.messageId).limit(1)
    if (existing && existing.length > 0) return done({ action: 'ignored', reason: 'duplicate' })
  }

  const { data: customers } = await db.from('customers').select('id,name,phone,sms_opted_out').eq('shop_id', shopId).ilike('phone', phoneLikePattern(fromRaw)).limit(1)
  const customer = (customers || [])[0] as { id: string; name?: string; sms_opted_out?: boolean } | undefined

  const ins = await db.from('messages').insert({
    shop_id: shopId, direction: 'inbound', channel: 'sms', from_address: fromRaw, to_address: shopNumber, body,
    status: 'received', customer_id: customer?.id || null, read: false, telnyx_message_id: msg.messageId || null, ai_handled: false,
  }).select('id').maybeSingle()
  if (ins.error) return done({ action: 'ignored', reason: 'record_failed' })
  const inboundMessageId: string | null = ins.data?.id ? String(ins.data.id) : null
  const hasMedia = Boolean(msg.media && msg.media.length)
  if (hasMedia && deps.saveMedia && inboundMessageId) {
    try { await deps.saveMedia(shopId, inboundMessageId, key, msg.media as InboundMedia[]) } catch (e) {
      console.error('[sms-pipeline] picture could not be saved:', e instanceof Error ? e.message : e)
    }
  }

  const outbound = async (text: string, idKey: string, aiHandled: boolean, checkConsent: boolean): Promise<boolean> => {
    if (checkConsent) {
      try { if (await deps.consent.isOptedOut(shopId, fromRaw)) return false } catch { return false }
    }
    try {
      await deps.send(fromRaw, text, { idempotencyKey: idKey })
    } catch (e) {
      console.error('[sms-pipeline] send failed:', e instanceof Error ? e.message : e)
      return false
    }
    await db.from('messages').insert({
      shop_id: shopId, direction: 'outbound', channel: 'sms', from_address: shopNumber, to_address: fromRaw, body: text,
      status: 'sent', customer_id: customer?.id || null, ai_handled: aiHandled, read: true,
    })
    return true
  }

  /* STOP, START and HELP are handled here, on the server, whatever the assistant's switches say. */
  const keyword = smsKeyword(body)
  if (keyword === 'stop') {
    try { await deps.consent.optOut(shopId, fromRaw, 'inbound_stop') } catch (e) {
      console.error('[sms-pipeline] opt-out could not be recorded:', e instanceof Error ? e.message : e)
      return done({ action: 'ignored', reason: 'optout_failed', inboundMessageId })
    }
    if (customer?.id) { try { await db.from('customers').update({ sms_opted_out: true }).eq('id', customer.id).eq('shop_id', shopId) } catch { /* older schemas have no flag */ } }
    fired.push('opt_out')
    if (!msg.autoResponded) await outbound(`You're unsubscribed from ${shop.name || 'our'} texts. No more messages will be sent. Reply START to turn texts back on.`, `stop-confirm-${msg.messageId || shopId + key}`, true, false)
    return done({ action: 'opt_out', reason: 'stop', inboundMessageId })
  }
  if (keyword === 'start') {
    try { await deps.consent.optIn(shopId, fromRaw, 'inbound_start') } catch { return done({ action: 'ignored', reason: 'optin_failed', inboundMessageId }) }
    if (customer?.id) { try { await db.from('customers').update({ sms_opted_out: false }).eq('id', customer.id).eq('shop_id', shopId) } catch { /* ignore */ } }
    fired.push('start')
    if (!msg.autoResponded) await outbound(startReply(shop), `start-confirm-${msg.messageId || shopId + key}`, true, false)
    return done({ action: 'opt_in', reason: 'start', inboundMessageId })
  }
  if (keyword === 'help') {
    fired.push('help')
    if (!msg.autoResponded) await outbound(helpReply(shop), `help-${msg.messageId || shopId + key}`, true, false)
    return done({ action: 'help', reason: 'help', inboundMessageId })
  }

  /* A previous STOP stays in force. Fail closed when consent cannot be read. */
  if (customer?.sms_opted_out) return done({ action: 'opted_out', reason: 'customer_flag', inboundMessageId })
  try { if (await deps.consent.isOptedOut(shopId, fromRaw)) return done({ action: 'opted_out', reason: 'consent', inboundMessageId }) } catch {
    return done({ action: 'opted_out', reason: 'consent_unreadable', inboundMessageId })
  }

  /* The shop's rules. */
  const loaded = await loadRules(db, shopId)
  const rules = loaded.rules
  const tables = await probeTables(db, now.getTime())
  const bookingsOk = tables.bookings && tables.interactions
  const effective: VoiceRules = bookingsOk ? rules : { ...rules, booking_mode: 'off' }
  const notifyTo = rules.notify_email || String(shopRow.shop_email || '')

  const since = new Date(now.getTime() - 30 * 86_400_000).toISOString()
  const recent = await recentTexts(db, shopId, since)
  const mine = forContact(recent.rows, key)
  const facts = threadFacts(mine, rules, now)

  const emailNewText = async () => {
    if (!rules.email_new_texts || !notifyTo) return
    const lastHour = facts.history.filter(h => h.role === 'user' && now.getTime() - h.at < 30 * 60_000).length
    if (lastHour > 1) return
    try {
      const mail = newTextEmail({ shop, phone: fromRaw, body, link: `${deps.appUrl}/messages?thread=${encodeURIComponent(key)}` })
      await deps.email({ to: notifyTo, subject: mail.subject, text: mail.text, idempotencyKey: `new-text-${msg.messageId || shopId + key + now.getTime()}` })
    } catch { /* an email problem never blocks texting */ }
  }

  if (rules.texts_mode === 'off') { fired.push('texts_off'); await emailNewText(); return done({ action: 'skipped', reason: 'texts_off', inboundMessageId }) }
  if (isAutomatedSenderAddress(fromRaw)) { fired.push('automated_sender'); return done({ action: 'skipped', reason: 'automated_sender', inboundMessageId }) }
  if (looksAutomated(body) || isRepeat(body, facts.recentAiBodies)) { fired.push('automated_sender'); return done({ action: 'skipped', reason: 'automated_text', inboundMessageId }) }

  const auto = rules.texts_mode === 'auto'
  const thread = await getThreadState(db, shopId, 'sms', key)
  const pausedByState = thread.state.pausedUntil && Date.parse(thread.state.pausedUntil) > now.getTime() && thread.state.pauseReason !== 'needs_person'
  if (thread.state.needsPerson) { fired.push('paused_thread'); await emailNewText(); return done({ action: 'skipped', reason: 'needs_person_pending', inboundMessageId }) }
  if (pausedByState) { fired.push('paused_thread'); await emailNewText(); return done({ action: 'skipped', reason: 'paused', inboundMessageId }) }
  const resumedAfter = thread.state.resumedAt !== null && Date.parse(thread.state.resumedAt) >= (facts.humanAt ?? 0)
  if (auto && facts.humanAt !== null && !resumedAfter) { fired.push('paused_thread'); await emailNewText(); return done({ action: 'skipped', reason: 'human_took_over', inboundMessageId }) }

  /* Open or continue the conversation record. */
  const episodeSince = new Date(now.getTime() - EPISODE_HOURS * 3_600_000).toISOString()
  let interaction: InteractionRow | null = tables.interactions ? await latestSmsInteraction(db, shopId, key, episodeSince) : null
  const customerInfo = await customerContext(db, shopId, fromRaw, rules.may_share_job_status)
  const openNew = async (): Promise<InteractionRow | null> => {
    if (!tables.interactions) return null
    const o = await openInteraction(db, shopId, { channel: 'sms', refId: `sms:${key}:${now.getTime()}`, contactPhone: fromRaw, contactName: customerInfo.name, customerId: customerInfo.id || customer?.id || null, startedAt: now.toISOString() })
    return o.row
  }

  if (auto && facts.aiRepliesInWindow >= rules.max_replies.count) {
    fired.push('rate_limit')
    interaction = interaction || await openNew()
    if (interaction) {
      await patchInteraction(db, shopId, interaction.id, { outcome: 'needs_person', rules_fired: unionFired(interaction.rules_fired, ['rate_limit', 'needs_person_limit']) })
    }
    await raiseNeedsPerson({ db, now: deps.now, email: deps.email, appUrl: deps.appUrl }, {
      shopId, rules, shop, channel: 'sms', interactionId: interaction?.id || null, phone: fromRaw, reason: 'limit',
      captured: readState(interaction?.detail?.state).captured, lastMessage: body, shopEmail: String(shopRow.shop_email || ''),
    })
    return done({ action: 'flagged', reason: 'rate_limit', inboundMessageId })
  }

  if (auto && inQuietHours(rules.quiet_hours, shop.timezone, now)) {
    fired.push('quiet_hours')
    interaction = interaction || await openNew()
    if (interaction) await patchInteraction(db, shopId, interaction.id, { outcome: betterOutcome(interaction.outcome, 'silent'), rules_fired: unionFired(interaction.rules_fired, ['quiet_hours']) })
    await emailNewText()
    return done({ action: 'skipped', reason: 'quiet_hours', inboundMessageId })
  }

  /* A picture with no words: a person has to look at it. Say so once and leave it for them. */
  if (hasMedia && !body.trim()) {
    fired.push('media_only')
    interaction = interaction || await openNew()
    const composedMedia = composeSms('Thanks, we got your picture. Someone on our team will look at it and get back to you.', effective, shop, facts.hasPriorAi)
    for (const f of composedMedia.fired) if (!fired.includes(f)) fired.push(f)
    let sentMedia = ''
    if (auto && !facts.recentAiBodies.some(b => b.includes('got your picture'))) {
      if (await outbound(composedMedia.text, `ai-sms-media-${shopId}-${msg.messageId || key + now.getTime()}`, true, true)) sentMedia = composedMedia.text
    }
    if (interaction) {
      await patchInteraction(db, shopId, interaction.id, {
        outcome: betterOutcome(interaction.outcome, 'message_taken'), rules_fired: unionFired(interaction.rules_fired, fired), ended_at: now.toISOString(),
        summary: 'Customer sent a picture.',
      })
    }
    if (!sentMedia) await emailNewText()
    return done({ action: sentMedia ? 'sent' : 'skipped', reason: 'media_only', sent: sentMedia || undefined, inboundMessageId })
  }

  /* Decide. */
  const history = facts.history.map(h => ({ role: h.role, content: h.content }))
  if (history.length && history[history.length - 1].role === 'user' && history[history.length - 1].content === body) history.pop()
  const appointments = effective.booking_mode === 'book'
    ? await upcomingAppointments(db, shopId, wallClock(now, shop.timezone).ymd, new Date(now.getTime() + 30 * 86_400_000).toISOString().slice(0, 10))
    : []
  let state: ConvState = interaction?.detail?.state ? readState(interaction.detail.state) : emptyState()
  if (!interaction?.detail?.state && !tables.interactions) state = await replayState(deps, effective, shop, facts, fromRaw, true)
  const decision = await decideTurn({
    channel: 'sms', text: body, rules: effective, shop, now, state, history,
    context: { customerName: customerInfo.name, openJobs: customerInfo.openJobs, appointments, fromNumber: fromRaw },
    model: deps.model,
  })
  fired.push(...decision.rulesFired.filter(f => !fired.includes(f)))

  if (decision.optOut) {
    try { await deps.consent.optOut(shopId, fromRaw, 'inbound_text_request') } catch { /* the next STOP will record it */ }
    if (customer?.id) { try { await db.from('customers').update({ sms_opted_out: true }).eq('id', customer.id).eq('shop_id', shopId) } catch { /* ignore */ } }
  }

  interaction = interaction || await openNew()
  const composed = composeSms(decision.say, effective, shop, facts.hasPriorAi)
  for (const f of composed.fired) if (!fired.includes(f)) fired.push(f)

  let action: SmsAction = decision.silent || !decision.say ? 'silent' : 'sent'
  let sentText = ''
  let draft: { text: string; at: string } | null = null
  if (decision.say && composed.text) {
    if (auto) {
      const ok = await outbound(composed.text, `ai-sms-${shopId}-${msg.messageId || key + now.getTime()}`, true, true)
      if (ok) sentText = composed.text
      else action = 'skipped'
    } else {
      draft = { text: composed.text, at: now.toISOString() }
      fired.push('draft_only')
      action = tables.interactions ? 'draft' : 'skipped'
    }
  }
  if (decision.flag) action = 'flagged'

  if (interaction) {
    const detail = { ...(interaction.detail || {}), state: decision.state, last_inbound: body.slice(0, 300), turns: (Number(interaction.detail?.turns) || 0) + 1, draft }
    await patchInteraction(db, shopId, interaction.id, {
      outcome: betterOutcome(interaction.outcome, decision.outcome),
      captured: decision.state.captured,
      rules_fired: unionFired(interaction.rules_fired, fired),
      contact_name: decision.state.captured.name || interaction.contact_name || customerInfo.name || null,
      summary: fallbackSummary({ channel: 'sms', captured: decision.state.captured, outcomeText: decision.outcome === 'needs_person' ? 'needs a person' : 'text conversation' }),
      ended_at: now.toISOString(),
      detail,
    })
  }

  if (decision.booking && interaction) {
    await applyBooking({ db, now: deps.now, email: deps.email, appUrl: deps.appUrl }, {
      shopId, rules: effective, shop, interactionId: interaction.id, channel: 'sms', booking: decision.booking,
      captured: decision.state.captured, phone: fromRaw, customerId: customerInfo.id || customer?.id || null,
    })
  }
  if (!decision.booking && decision.state.booking && interaction) {
    await syncBooking(db, shopId, { interactionId: interaction.id, captured: decision.state.captured, phone: fromRaw })
  }
  if (decision.flag) {
    await raiseNeedsPerson({ db, now: deps.now, email: deps.email, appUrl: deps.appUrl }, {
      shopId, rules, shop, channel: 'sms', interactionId: interaction?.id || null, phone: fromRaw, reason: decision.flag.reason,
      captured: decision.state.captured, lastMessage: body, shopEmail: String(shopRow.shop_email || ''),
    })
  } else if (!sentText) {
    await emailNewText()
  }

  return done({ action, reason: decision.flag ? decision.flag.reason : decision.outcome, sent: sentText || undefined, inboundMessageId, decision })
}
