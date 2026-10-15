// Runs automations end to end: find people, decide, queue, send, retry, cancel, report.
//
// This file never talks to a database or a phone company itself. It is handed a `store` (reads and writes)
// and `senders` (text and email), so the exact same code is tested with in-memory fakes and run in
// production with Supabase and Telnyx. Every rule that matters (consent at send time, quiet hours,
// per-customer limits, never sending twice, pausing cancels what is waiting) lives here or in
// automation-rules.ts, and is covered by tests.

import {
  MAX_ATTEMPTS,
  classifyFailure,
  decide,
  earliestSend,
  failureAdvice,
  hasUsablePhone,
  limitReason,
  looksLikeEmail,
  nextSendable,
  normalizeRules,
  phoneKey,
  retryDelayMs,
  summarize,
  templateProblems,
  validTimezone,
  windowFromRules,
  type Candidate,
  type Channel,
  type Decision,
  type MessageClass,
  type RecentSend,
  type ShopRules,
} from './automation-rules.ts'
import {
  CATALOG_BY_ID,
  resolveConfig,
  type AutomationDef,
  type DataNeed,
  type Raw,
  type RunContext,
} from './automation-catalog.ts'
import { occurrenceKey } from './schedules.ts'

const DAY = 86_400_000

// ── What the engine needs from the outside ────────────────────────────────

export interface AutomationState {
  enabled: boolean
  /** When it was last switched on. Absent on older settings. */
  enabled_at?: string | null
  config: Record<string, unknown>
  last_run: string | null
  run_count: number
  last_result: string | null
  last_status: 'ok' | 'error' | 'never'
}

export interface ShopInfo {
  shopId: string
  name: string
  phone: string
  timezone: string
  reviewUrl: string
  smsReady: boolean
  emailReady: boolean
  rules: ShopRules
  states: Record<string, AutomationState | undefined>
}

export type MessageStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'skipped' | 'cancelled' | 'unknown'

export interface MessageRow {
  id: string
  shop_id: string
  automation_id: string
  run_id: string | null
  campaign_id?: string | null
  channel: Channel
  message_class: MessageClass
  status: MessageStatus
  skip_reason: string | null
  customer_id: string | null
  recipient_name: string | null
  recipient: string | null
  subject: string | null
  body: string | null
  source_type: string | null
  source_id: string | null
  dedupe_key: string | null
  send_after: string
  attempts: number
  next_attempt_at: string | null
  provider_message_id: string | null
  last_error: string | null
  is_test: boolean
  detail: Record<string, unknown>
  sent_at: string | null
  /** What the carrier said happened to a text after it left: delivered, undelivered or failed. Absent until a notice arrives. */
  delivery_status?: 'delivered' | 'undelivered' | 'failed' | null
  delivered_at?: string | null
  created_at: string
  updated_at: string
}

export type NewMessage = Omit<MessageRow, 'id' | 'created_at' | 'updated_at' | 'attempts' | 'provider_message_id' | 'sent_at' | 'last_error' | 'next_attempt_at'>

export interface Store {
  loadShop(shopId: string): Promise<ShopInfo>
  loadRaw(shopId: string, needs: readonly DataNeed[], now: number): Promise<Raw>
  /** Messages already sent in the last 31 days, from automations and from older logs. */
  recentSends(shopId: string, sinceMs: number): Promise<RecentSend[]>
  /** Which of these dedupe keys already belong to a message that was sent or is still waiting. */
  existingKeys(shopId: string, keys: string[]): Promise<Set<string>>
  /** Phone keys (last ten digits) and emails that have told us to stop, from the consent tables. */
  blockedDestinations(shopId: string, phones: string[], emails: string[]): Promise<{ phones: Set<string>; emails: Set<string> }>
  /** Is this recipient opted out right now? Checked again just before every send. */
  isOptedOut(shopId: string, channel: Channel, destination: string, customerId: string | null): Promise<boolean>
  insertMessages(rows: NewMessage[]): Promise<MessageRow[]>
  dueMessages(shopId: string, nowMs: number, limit: number, automationId?: string): Promise<MessageRow[]>
  /** queued to sending, only if still queued. Returns null when someone else got it. */
  claimMessage(row: MessageRow, nowMs: number): Promise<MessageRow | null>
  finishMessage(row: MessageRow, patch: Partial<MessageRow>): Promise<void>
  /**
   * Cancel what is waiting. Tight: this shop, queued rows only.
   * With a campaign, only that one promotion's messages. With just an automation, that automation's own messages
   * (a one-off promotion sent through the same engine is left alone). With neither, everything.
   */
  cancelQueued(shopId: string, automationId: string | null, reason: string, campaignId?: string | null): Promise<number>
  /** Has this customer been in (an invoice or receipt that is not void) since this moment? Used to drop a reminder they no longer need. */
  cameBackSince?(shopId: string, customerId: string, sinceMs: number): Promise<boolean>
  /** Called after a message went out, for things like marking an appointment reminded. */
  afterSent?(row: MessageRow): Promise<void>
  /** Puts back in line anything a crashed worker left half sent. */
  recoverStuck?(shopId: string, nowMs: number): Promise<void>
}

export interface SendResult { ok: boolean; id?: string | null; error?: string; uncertain?: boolean }
export interface OutgoingMessage { row: MessageRow; to: string; text: string; subject?: string; idempotencyKey: string }

export interface Senders {
  sms(m: OutgoingMessage, shop: ShopInfo): Promise<SendResult>
  email(m: OutgoingMessage, shop: ShopInfo): Promise<SendResult>
}

export interface Deps {
  store: Store
  senders: Senders
  now?: () => number
  /** Called when messages fail in a way the owner should hear about. */
  alert?: (shopId: string, alert: { automationId: string; count: number; error: string; advice: string }) => Promise<void>
}

const clock = (deps: Deps): number => (deps.now ? deps.now() : Date.now())

// ── Planning (no writes) ──────────────────────────────────────────────────

export interface Plan {
  def: AutomationDef
  info: ShopInfo
  config: Record<string, any>
  decisions: Decision[]
  summary: ReturnType<typeof summarize>
  /** Something that stops this from running at all. Empty list means ready. */
  problems: string[]
  windowKey: string
  now: number
  campaignId?: string
}

export function runContextFor(info: ShopInfo, def: AutomationDef, config: Record<string, any>, now: number): RunContext {
  const state = info.states[def.id]
  const enabledAt = state?.enabled_at ? new Date(state.enabled_at).getTime() : null
  return {
    now,
    timeZone: validTimezone(info.timezone),
    shopName: info.name || 'our shop',
    shopPhone: info.phone,
    reviewUrl: info.reviewUrl,
    emailReady: info.emailReady,
    enabledAt: enabledAt !== null && Number.isFinite(enabledAt) ? enabledAt : null,
    windowKey: occurrenceKey(String(config.schedule || def.schedule), validTimezone(info.timezone), new Date(now)),
  }
}

/** Things that stop an automation from running at all, in plain words. Empty when it is ready. */
export function setupProblems(info: ShopInfo, def: AutomationDef, config: Record<string, any>, ctx: RunContext): string[] {
  const out: string[] = []
  if (def.kind === 'engine' && def.channel === 'sms' && !info.smsReady) out.push('Texting is not set up yet. Add your Telnyx key and number in Settings.')
  const own = def.setupProblem?.(ctx, config)
  if (own) out.push(own)
  return out
}

export async function planAutomation(deps: Deps, input: {
  shopId: string
  automationId: string
  /** Try settings that are not saved yet (the settings sheet uses this to preview a change). */
  configOverride?: Record<string, unknown>
  /** A real run stops early when something blocks it; a preview still shows who would be reached. */
  forRun?: boolean
  now?: number
  /** One-off promotions: who to reach (instead of the saved filters), tied to this promotion. */
  audience?: Record<string, unknown>
  campaignId?: string
  /** Names this one send, so the same person is never sent the same promotion twice. */
  windowKey?: string
  /** Hold the send until then (a scheduled promotion). */
  notBefore?: number
  /** Everyone who matches, not just the usual per-run amount. */
  maxPerRun?: number
}): Promise<Plan> {
  const def = CATALOG_BY_ID[input.automationId]
  if (!def || def.kind !== 'engine' || !def.find) throw new Error('Unknown automation')
  const now = input.now ?? clock(deps)
  const info = await deps.store.loadShop(input.shopId)
  const config = resolveConfig(def, { ...(info.states[def.id]?.config || {}), ...(input.configOverride || {}) })
  if (input.audience) config.audience = input.audience
  const ctx = runContextFor(info, def, config, now)
  if (input.windowKey) ctx.windowKey = input.windowKey
  const problems = setupProblems(info, def, config, ctx)
  const tpl = String(config.message || '')
  const tplProblems = tpl.trim() ? templateProblems(tpl, { klass: def.klass, channel: def.channel }) : ['Write the message first.']
  problems.push(...tplProblems)
  const unique = [...new Set(problems)]
  const base = { def, info, config, windowKey: ctx.windowKey, now, problems: unique, campaignId: input.campaignId }
  if (tplProblems.length || (input.forRun && unique.length)) {
    return { ...base, decisions: [], summary: summarize([]) }
  }

  const raw = await deps.store.loadRaw(input.shopId, def.needs, now)
  const candidates = def.find(raw, config, ctx)
  const blocked = await deps.store.blockedDestinations(
    input.shopId,
    candidates.filter(c => c.channel === 'sms' && c.phone).map(c => phoneKey(c.phone)),
    candidates.filter(c => c.channel === 'email' && c.email).map(c => String(c.email).trim().toLowerCase()),
  )
  for (const c of candidates) {
    if (c.channel === 'sms' && c.phone && blocked.phones.has(phoneKey(c.phone))) c.smsOptedOut = true
    if (c.channel === 'email' && c.email && blocked.emails.has(String(c.email).trim().toLowerCase())) c.emailOptedOut = true
  }
  const recent = await deps.store.recentSends(input.shopId, now - 31 * DAY)
  const existing = await deps.store.existingKeys(input.shopId, candidates.map(c => c.dedupeKey))
  const decisions = decide(candidates, {
    now,
    shopTimeZone: ctx.timeZone,
    rules: info.rules,
    template: tpl,
    subject: String(config.email_subject || def.emailSubject || ''),
    recent,
    existingKeys: existing,
    capDays: Number(config.cap_days) || 0,
    maxPerRun: input.maxPerRun ?? (Number(config.max_per_run) || 50),
    notBefore: input.notBefore,
  })
  return { ...base, decisions, summary: summarize(decisions) }
}

// ── Queueing ──────────────────────────────────────────────────────────────

/** Skipped people are written down once each, so the history shows who was left out and why. */
const skipKey = (c: Candidate, reason: string): string => `skip:${c.dedupeKey}:${reason}`

export function messagesFromPlan(plan: Plan, runId: string | null, manual: boolean): NewMessage[] {
  const rows: NewMessage[] = []
  const iso = (ms: number) => new Date(ms).toISOString()
  for (const d of plan.decisions) {
    const c = d.candidate
    if (d.action === 'later') continue
    const base = {
      shop_id: plan.info.shopId,
      automation_id: plan.def.id,
      run_id: runId,
      campaign_id: plan.campaignId || null,
      channel: c.channel,
      message_class: c.klass,
      customer_id: c.customerId || null,
      recipient_name: c.name || null,
      recipient: d.to || (c.channel === 'sms' ? c.phone : c.email) || null,
      source_type: c.sourceType,
      source_id: c.sourceId,
      is_test: false,
    }
    if (d.action === 'skip') {
      if (d.reason === 'already_sent') continue
      rows.push({
        ...base, status: 'skipped', skip_reason: d.reason || 'skipped', subject: null, body: null,
        dedupe_key: skipKey(c, d.reason || 'skipped'), send_after: iso(plan.now), detail: { why: c.why },
      })
      continue
    }
    rows.push({
      ...base, status: 'queued', skip_reason: null, subject: d.subject || null, body: d.text,
      dedupe_key: c.dedupeKey, send_after: iso(d.sendAfter),
      detail: { why: c.why, held_for_quiet_hours: d.heldForQuietHours, parts: d.parts, manual, exempt: c.exemptFromLimits === true, notes: d.notes },
    })
  }
  return rows
}

// ── Sending what is waiting ───────────────────────────────────────────────

export interface DrainResult {
  looked: number
  sent: number
  failed: number
  retrying: number
  skipped: number
  cancelled: number
  rescheduled: number
  unknown: number
  stoppedEarly: boolean
}

export const emptyDrain = (): DrainResult => ({ looked: 0, sent: 0, failed: 0, retrying: 0, skipped: 0, cancelled: 0, rescheduled: 0, unknown: 0, stoppedEarly: false })

/**
 * Send what is due for one shop. Every message is checked again right before it goes out:
 * the master switch, the automation's own switch, STOP, quiet hours, and the per-customer limits.
 * A message is claimed before it is sent, so two workers can never send the same one.
 */
/** Automations whose point disappears when the customer visits first. */
export const CANCEL_ON_RETURN: ReadonlySet<string> = new Set(['service_reminders', 'declined_work', 're_engagement'])

export async function drainShop(deps: Deps, shopId: string, opts: { limit?: number; automationId?: string; deadlineMs?: number } = {}): Promise<DrainResult> {
  const out = emptyDrain()
  const now = clock(deps)
  const info = await deps.store.loadShop(shopId)
  const window = windowFromRules(info.rules)
  const tz = validTimezone(info.timezone)
  await deps.store.recoverStuck?.(shopId, now)
  const due = await deps.store.dueMessages(shopId, now, opts.limit ?? 40, opts.automationId)
  out.looked = due.length
  if (!due.length) return out
  const recent = await deps.store.recentSends(shopId, now - 31 * DAY)
  const failures = new Map<string, { count: number; error: string }>()

  for (const queued of due) {
    if (opts.deadlineMs && clock(deps) > opts.deadlineMs) { out.stoppedEarly = true; break }
    const state = info.states[queued.automation_id]
    const manual = queued.detail?.manual === true
    const finishNo = async (status: MessageStatus, reason: string, counter: 'skipped' | 'cancelled') => {
      await deps.store.finishMessage(queued, { status, skip_reason: reason, dedupe_key: null, updated_at: new Date(now).toISOString() })
      out[counter] += 1
    }

    if (!info.rules.master_enabled) { await finishNo('cancelled', 'master_off', 'cancelled'); continue }
    if (!manual && !queued.is_test && !state?.enabled) { await finishNo('cancelled', 'paused', 'cancelled'); continue }

    const dest = String(queued.recipient || '')
    if (queued.channel === 'sms' ? !hasUsablePhone(dest) : !looksLikeEmail(dest)) { await finishNo('skipped', queued.channel === 'sms' ? 'no_phone' : 'no_email', 'skipped'); continue }

    let optedOut = true
    try {
      optedOut = await deps.store.isOptedOut(shopId, queued.channel, dest, queued.customer_id)
    } catch {
      // If consent cannot be checked, do not send. It stays queued and is tried again next time.
      out.rescheduled += 1
      await deps.store.finishMessage(queued, { next_attempt_at: new Date(now + 10 * 60_000).toISOString(), last_error: 'Consent could not be checked, so nothing was sent.' })
      continue
    }
    if (optedOut) { await finishNo('skipped', queued.channel === 'sms' ? 'opted_out' : 'email_opted_out', 'skipped'); continue }

    // A reminder or win-back text is pointless if the customer came in after it was lined up. If this cannot be checked,
    // the message still goes: it is a courtesy check, unlike consent.
    if (!queued.is_test && !manual && queued.customer_id && CANCEL_ON_RETURN.has(queued.automation_id) && deps.store.cameBackSince) {
      let back = false
      try { back = await deps.store.cameBackSince(shopId, queued.customer_id, Date.parse(queued.created_at)) } catch { back = false }
      if (back) { await finishNo('cancelled', 'came_back', 'cancelled'); continue }
    }

    if (!queued.is_test) {
      const shell: Candidate = {
        automationId: queued.automation_id, klass: queued.message_class, channel: queued.channel, customerId: queued.customer_id,
        name: queued.recipient_name || '', phone: queued.channel === 'sms' ? dest : null, email: queued.channel === 'email' ? dest : null,
        sourceType: queued.source_type || '', sourceId: queued.source_id || '', dedupeKey: queued.dedupe_key || '', vars: {},
        why: '', exemptFromLimits: queued.detail?.exempt === true,
      }
      const limited = limitReason(shell, recent, info.rules, now, Number((state?.config as Record<string, unknown> | undefined)?.cap_days) || 0)
      if (limited) { await finishNo('skipped', limited, 'skipped'); continue }
      const when = queued.channel === 'sms' ? earliestSend(new Date(now), tz, dest, window) : nextSendable(new Date(now), tz, window)
      if (when.getTime() - now > 60_000) {
        await deps.store.finishMessage(queued, { send_after: when.toISOString(), updated_at: new Date(now).toISOString() })
        out.rescheduled += 1
        continue
      }
    }

    const claimed = await deps.store.claimMessage(queued, now)
    if (!claimed) continue
    const result = await sendOne(deps, info, claimed, dest)
    const at = new Date(clock(deps)).toISOString()
    if (result.ok) {
      await deps.store.finishMessage(claimed, { status: 'sent', sent_at: at, provider_message_id: result.id || null, last_error: null, next_attempt_at: null, updated_at: at })
      out.sent += 1
      if (!claimed.is_test) recent.push({ customerId: claimed.customer_id, phone: claimed.channel === 'sms' ? dest : null, email: claimed.channel === 'email' ? dest : null, automationId: claimed.automation_id, klass: claimed.message_class, at: clock(deps) })
      try { await deps.store.afterSent?.(claimed) } catch { /* the message went out; a side note failing must not undo that */ }
      continue
    }
    const error = String(result.error || 'The message could not be sent.').slice(0, 300)
    const noteFailure = () => {
      const f = failures.get(claimed.automation_id) || { count: 0, error }
      f.count += 1
      failures.set(claimed.automation_id, f)
    }
    if (result.uncertain) {
      await deps.store.finishMessage(claimed, { status: 'unknown', last_error: error, next_attempt_at: null, updated_at: at })
      out.unknown += 1
      noteFailure()
    } else if (classifyFailure(error) === 'transient' && claimed.attempts < MAX_ATTEMPTS) {
      await deps.store.finishMessage(claimed, { status: 'queued', last_error: error, next_attempt_at: new Date(clock(deps) + retryDelayMs(claimed.attempts)).toISOString(), updated_at: at })
      out.retrying += 1
    } else {
      await deps.store.finishMessage(claimed, { status: 'failed', last_error: error, next_attempt_at: null, updated_at: at })
      out.failed += 1
      noteFailure()
    }
  }
  if (deps.alert) {
    for (const [automationId, f] of failures) {
      if (!info.rules.alert_on_failure) continue
      try { await deps.alert(shopId, { automationId, count: f.count, error: f.error, advice: failureAdvice(f.error) }) } catch { /* telling the owner must never break a run */ }
    }
  }
  return out
}

async function sendOne(deps: Deps, info: ShopInfo, row: MessageRow, to: string): Promise<SendResult> {
  const msg: OutgoingMessage = { row, to, text: String(row.body || ''), subject: row.subject || undefined, idempotencyKey: `am:${row.id}` }
  try {
    return row.channel === 'sms' ? await deps.senders.sms(msg, info) : await deps.senders.email(msg, info)
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'The message could not be sent.', uncertain: true }
  }
}

// ── One whole run ─────────────────────────────────────────────────────────

export interface RunSummary {
  ok: boolean
  /** Rows queued for sending. */
  queued: number
  /** Left out, each with a reason. */
  skipped: number
  /** Waiting for a later run or for quiet hours to end. */
  later: number
  heldForQuietHours: number
  drain: DrainResult
  problems: string[]
  error?: string
}

/** Find the people, queue their messages, and send whatever is due now. */
export async function runAutomation(deps: Deps, input: { shopId: string; automationId: string; runId: string | null; manual: boolean; now?: number }): Promise<RunSummary> {
  const now = input.now ?? clock(deps)
  const plan = await planAutomation(deps, { shopId: input.shopId, automationId: input.automationId, now, forRun: true })
  const empty = emptyDrain()
  if (!plan.info.rules.master_enabled) {
    return { ok: true, queued: 0, skipped: 0, later: 0, heldForQuietHours: 0, drain: empty, problems: ['All automations are switched off.'] }
  }
  if (plan.problems.length) {
    return { ok: false, queued: 0, skipped: 0, later: 0, heldForQuietHours: 0, drain: empty, problems: plan.problems, error: plan.problems[0] }
  }
  const rows = messagesFromPlan(plan, input.runId, input.manual)
  const inserted = rows.length ? await deps.store.insertMessages(rows) : []
  const queued = inserted.filter(r => r.status === 'queued').length
  const skipped = inserted.filter(r => r.status === 'skipped').length
  const drain = await drainShop(deps, input.shopId, { automationId: input.automationId, limit: 60 })
  return {
    ok: true,
    queued,
    skipped,
    later: plan.summary.later,
    heldForQuietHours: plan.summary.heldForQuietHours,
    drain,
    problems: [],
  }
}

/** A short sentence for the run history and the card. */
export function runSentence(s: RunSummary, name = 'messages'): string {
  if (s.error) return s.error
  const bits: string[] = []
  if (s.drain.sent) bits.push(`${s.drain.sent} sent`)
  const waiting = Math.max(0, s.queued - s.drain.sent - s.drain.failed - s.drain.skipped - s.drain.cancelled - s.drain.unknown)
  if (waiting > 0) bits.push(`${waiting} waiting${s.heldForQuietHours ? ' for morning' : ''}`)
  if (s.drain.failed) bits.push(`${s.drain.failed} failed`)
  if (s.drain.retrying) bits.push(`${s.drain.retrying} will retry`)
  const left = s.skipped + s.drain.skipped
  if (left) bits.push(`${left} left out`)
  if (s.later) bits.push(`${s.later} for later`)
  return bits.length ? `${bits.join(', ')}.` : `No ${name} were due.`
}

// ── Pausing ───────────────────────────────────────────────────────────────

/** Pausing one automation cancels what it has waiting. Pausing everything cancels all of it. */
export async function pauseAndCancel(deps: Deps, shopId: string, automationId: string | null, reason: 'paused' | 'master_off'): Promise<number> {
  return deps.store.cancelQueued(shopId, automationId, reason)
}

export { normalizeRules }
