// One-off promotions: a message the owner wrote, a group of customers they chose, sent now or at a set time.
//
// A promotion goes through the same automation engine as everything else (the "sms_blast" definition), so it gets the
// same rules for free: STOP is checked again right before each message, quiet hours are respected in the customer's own
// time zone, nobody gets more than the marketing limit, and every message is written down with what happened to it.
// The promotion row only holds what the owner decided (name, wording, audience, time). The counts come from the messages.
//
// No database or phone company is touched here directly: the caller hands in a `PromotionStore` and the engine `Deps`,
// so the same code is tested with in-memory fakes.

import {
  hasEmoji,
  prettyPhone,
  skipWords,
  templateProblems,
  unknownPlaceholders,
  validTimezone,
} from './automation-rules.ts'
import { CATALOG_BY_ID } from './automation-catalog.ts'
import {
  drainShop,
  messagesFromPlan,
  planAutomation,
  type Deps,
  type Plan,
} from './automation-engine.ts'
import { describeFilters, normalizeFilters, type AudienceFilters } from './growth-audience.ts'
import { subjectProblem } from './lead-compliance.ts'
import { zonedTimeToUtc } from './schedules.ts'

export const PROMOTION_AUTOMATION = 'sms_blast'
/** The most people one promotion will reach. Beyond this the owner splits it by audience. */
export const MAX_AUDIENCE = 5000
const MIN = 60_000
const DAY = 86_400_000

export type PromotionStatus = 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled'

export interface PromotionRow {
  id: string
  shop_id: string
  name: string
  message: string
  email_subject: string | null
  audience: Record<string, unknown>
  status: PromotionStatus
  send_at: string | null
  queued_count: number
  skipped_count: number
  created_by: string | null
  sent_at: string | null
  created_at: string
  updated_at: string
}

/** What happened to the messages of one promotion, counted from the message ledger. */
export interface CampaignCounts {
  queued: number
  sending: number
  sent: number
  failed: number
  unknown: number
  skipped: number
  cancelled: number
  delivered: number
  undelivered: number
  /** When the first waiting message is due. */
  next_send_after: string | null
}

export const emptyCounts = (): CampaignCounts => ({ queued: 0, sending: 0, sent: 0, failed: 0, unknown: 0, skipped: 0, cancelled: 0, delivered: 0, undelivered: 0, next_send_after: null })

export interface PromotionStore {
  list(shopId: string): Promise<PromotionRow[]>
  get(shopId: string, id: string): Promise<PromotionRow | null>
  insert(row: { shop_id: string; name: string; message: string; email_subject: string | null; audience: Record<string, unknown>; created_by: string | null }): Promise<PromotionRow>
  /** Change a promotion only while it is still in one of the `from` statuses. Null when someone else changed it first. */
  update(shopId: string, id: string, patch: Partial<Pick<PromotionRow, 'name' | 'message' | 'email_subject' | 'audience' | 'status' | 'send_at' | 'queued_count' | 'skipped_count' | 'sent_at'>>, from?: PromotionStatus[]): Promise<PromotionRow | null>
  remove(shopId: string, id: string): Promise<boolean>
  counts(shopId: string, ids: string[]): Promise<Record<string, CampaignCounts>>
}

// ── What the owner typed ──────────────────────────────────────────────────

export interface PromotionInput {
  name: string
  message: string
  email_subject: string
  audience: AudienceFilters
}

export function cleanInput(raw: unknown): { ok: true; value: PromotionInput } | { ok: false; errors: string[] } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const name = String(r.name ?? '').trim().replace(/\s+/g, ' ')
  const message = String(r.message ?? '').trim()
  const subject = String(r.email_subject ?? '').trim()
  const errors: string[] = []
  if (!name) errors.push('Give the promotion a name so you can find it later.')
  else if (name.length > 120) errors.push('Keep the name under 120 characters.')
  errors.push(...templateProblems(message, { klass: 'marketing', channel: 'sms' }))
  const allowed = CATALOG_BY_ID[PROMOTION_AUTOMATION].placeholders
  const stray = unknownPlaceholders(message, allowed).filter(k => !errors.some(e => e.includes(`{${k}}`)))
  if (stray.length) errors.push(`A promotion can only use ${allowed.map(a => `{${a}}`).join(', ')}. Remove ${stray.map(k => `{${k}}`).join(', ')}.`)
  if (hasEmoji(subject)) errors.push('Remove the emoji from the email subject.')
  else {
    const bad = subjectProblem(subject)
    if (bad) errors.push(bad)
  }
  if (errors.length) return { ok: false, errors: [...new Set(errors)] }
  return { ok: true, value: { name, message, email_subject: subject, audience: normalizeFilters(r.audience) } }
}

/**
 * The moment a scheduled promotion should go out, in the shop's own time zone.
 * `local` is what a date and time field gives: "2026-10-20T10:00". Returns the instant, or a plain problem.
 */
export function parseSendAt(input: { local?: unknown; iso?: unknown }, timeZone: string, now: number): { ok: true; at: number } | { ok: false; error: string } {
  let at = NaN
  const tz = validTimezone(timeZone)
  const local = typeof input.local === 'string' ? input.local.trim() : ''
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local)
  if (m) at = zonedTimeToUtc({ year: +m[1], month: +m[2], day: +m[3], hour: +m[4], minute: +m[5] }, tz).getTime()
  else if (typeof input.iso === 'string' && input.iso.trim()) at = new Date(input.iso).getTime()
  if (!Number.isFinite(at)) return { ok: false, error: 'Pick a date and time for the promotion.' }
  if (at < now + 5 * MIN) return { ok: false, error: 'Pick a time at least a few minutes from now. To send right away, use Send now.' }
  if (at > now + 60 * DAY) return { ok: false, error: 'Pick a time within the next 60 days.' }
  return { ok: true, at }
}

// ── Reading a promotion back ──────────────────────────────────────────────

export type DerivedStatus = PromotionStatus

/** The honest status, worked out from the messages rather than trusted from the row. */
export function deriveStatus(row: Pick<PromotionRow, 'status' | 'send_at'>, counts: CampaignCounts, now: number): DerivedStatus {
  if (row.status === 'draft' || row.status === 'cancelled') return row.status
  if (counts.queued + counts.sending > 0) return row.send_at && new Date(row.send_at).getTime() > now ? 'scheduled' : 'sending'
  return 'sent'
}

export interface PromotionView {
  id: string
  name: string
  message: string
  email_subject: string
  audience: AudienceFilters
  audience_text: string
  status: DerivedStatus
  send_at: string | null
  created_at: string
  sent_at: string | null
  counts: CampaignCounts
  /** Reached = sent. Left out = skipped before sending (STOP, limits, no contact). */
  waiting: number
}

export function viewOf(row: PromotionRow, counts: CampaignCounts | undefined, now: number): PromotionView {
  const c = counts || emptyCounts()
  const audience = normalizeFilters(row.audience)
  return {
    id: row.id,
    name: row.name,
    message: row.message,
    email_subject: row.email_subject || '',
    audience,
    audience_text: describeFilters(audience),
    status: deriveStatus(row, c, now),
    send_at: row.send_at,
    created_at: row.created_at,
    sent_at: row.sent_at,
    counts: c,
    waiting: c.queued + c.sending,
  }
}

// ── Preview (nothing is written) ──────────────────────────────────────────

export interface PromotionPreview {
  ok: true
  problems: string[]
  /** How many people the audience filters match, before consent and limits. */
  matched: number
  counts: { will_receive: number; texts: number; emails: number; held_for_quiet_hours: number; left_out: number; over_limit: number }
  left_out_by: Array<{ reason: string; label: string; count: number }>
  recipients: Array<{ name: string; to: string; channel: 'sms' | 'email'; text: string; subject: string | null; parts: number; send_at_iso: string; held: boolean }>
  left_out: Array<{ name: string; reason: string; label: string }>
  first_send_iso: string | null
  last_send_iso: string | null
  quiet_hours: { start: number; end: number; skip_sundays: boolean }
  note: string
}

async function planFor(deps: Deps, shopId: string, input: PromotionInput, campaignId: string, opts: { now: number; notBefore?: number; forRun?: boolean }): Promise<Plan> {
  return planAutomation(deps, {
    shopId,
    automationId: PROMOTION_AUTOMATION,
    configOverride: { message: input.message, email_subject: input.email_subject },
    audience: input.audience as Record<string, unknown>,
    campaignId,
    windowKey: `campaign:${campaignId}`,
    notBefore: opts.notBefore,
    maxPerRun: MAX_AUDIENCE,
    forRun: opts.forRun,
    now: opts.now,
  })
}

export async function previewPromotion(deps: Deps, shopId: string, input: PromotionInput, opts: { campaignId?: string; sendAt?: number; now?: number } = {}): Promise<PromotionPreview> {
  const now = opts.now ?? clockOf(deps)
  const plan = await planFor(deps, shopId, input, opts.campaignId || 'preview', { now, notBefore: opts.sendAt })
  const sends = plan.decisions.filter(d => d.action === 'send')
  const out = plan.decisions.filter(d => d.action === 'skip' && d.reason !== 'already_sent')
  const later = plan.decisions.filter(d => d.action === 'later')
  const times = sends.map(d => d.sendAfter).sort((a, b) => a - b)
  const by = Object.entries(plan.summary.skippedBy).filter(([k]) => k !== 'already_sent').map(([reason, count]) => ({ reason, label: skipWords(reason), count }))
  return {
    ok: true,
    problems: plan.problems,
    matched: plan.decisions.filter(d => !(d.action === 'skip' && d.reason === 'already_sent')).length,
    counts: {
      will_receive: sends.length,
      texts: sends.filter(d => d.candidate.channel === 'sms').length,
      emails: sends.filter(d => d.candidate.channel === 'email').length,
      held_for_quiet_hours: plan.summary.heldForQuietHours,
      left_out: out.length,
      over_limit: later.length,
    },
    left_out_by: by,
    recipients: sends.slice(0, 25).map(d => ({
      name: d.candidate.name || 'Customer',
      to: d.candidate.channel === 'sms' ? prettyPhone(d.to) : d.to,
      channel: d.candidate.channel,
      text: d.text,
      subject: d.subject || null,
      parts: d.parts,
      send_at_iso: new Date(d.sendAfter).toISOString(),
      held: d.heldForQuietHours,
    })),
    left_out: out.slice(0, 60).map(d => ({ name: d.candidate.name || 'Customer', reason: d.reason || 'skipped', label: skipWords(d.reason || 'skipped') })),
    first_send_iso: times.length ? new Date(times[0]).toISOString() : null,
    last_send_iso: times.length ? new Date(times[times.length - 1]).toISOString() : null,
    quiet_hours: { start: plan.info.rules.quiet_start_hour, end: plan.info.rules.quiet_end_hour, skip_sundays: plan.info.rules.skip_sundays },
    note: 'This is a preview. Nothing has been sent.',
  }
}

// ── Saving, sending, stopping ─────────────────────────────────────────────

export type Failure = { ok: false; status: number; error: string; code: string }
const clockOf = (deps: Deps): number => (deps.now ? deps.now() : Date.now())
const fail = (status: number, code: string, error: string): Failure => ({ ok: false, status, error, code })

export async function createPromotion(store: PromotionStore, shopId: string, userId: string | null, input: PromotionInput): Promise<PromotionRow> {
  return store.insert({ shop_id: shopId, name: input.name, message: input.message, email_subject: input.email_subject || null, audience: input.audience as Record<string, unknown>, created_by: userId })
}

export async function savePromotion(store: PromotionStore, shopId: string, id: string, input: PromotionInput): Promise<PromotionRow | Failure> {
  const row = await store.update(shopId, id, { name: input.name, message: input.message, email_subject: input.email_subject || null, audience: input.audience as Record<string, unknown> }, ['draft'])
  if (row) return row
  const current = await store.get(shopId, id)
  if (!current) return fail(404, 'not_found', 'That promotion was not found.')
  return fail(409, 'locked', 'This promotion has already been sent or scheduled, so it cannot be edited. Stop it first, or start a new one.')
}

export async function deletePromotion(store: PromotionStore, shopId: string, id: string): Promise<true | Failure> {
  const row = await store.get(shopId, id)
  if (!row) return fail(404, 'not_found', 'That promotion was not found.')
  if (row.status !== 'draft') return fail(409, 'locked', 'Only a draft can be deleted. A promotion that was sent stays in your history.')
  const counts = (await store.counts(shopId, [id]))[id] || emptyCounts()
  if (counts.queued + counts.sending + counts.sent + counts.failed + counts.unknown + counts.skipped + counts.cancelled > 0) return fail(409, 'locked', 'This promotion has messages on record, so it stays in your history.')
  return (await store.remove(shopId, id)) ? true : fail(409, 'locked', 'That promotion could not be deleted.')
}

export interface SendReport {
  ok: true
  status: DerivedStatus
  queued: number
  left_out: number
  sent: number
  failed: number
  waiting: number
  send_at: string | null
  first_send_iso: string | null
  message: string
}

/**
 * Line up every message for this promotion, then send what is due. A scheduled promotion lines them up now (so what
 * you previewed is what goes out) and sends at the chosen time. Safe to call twice: nobody is queued twice.
 */
export async function sendPromotion(deps: Deps, store: PromotionStore, shopId: string, id: string, opts: { sendAt?: number; now?: number; drainMs?: number } = {}): Promise<SendReport | Failure> {
  const now = opts.now ?? clockOf(deps)
  const row = await store.get(shopId, id)
  if (!row) return fail(404, 'not_found', 'That promotion was not found.')
  const existing = (await store.counts(shopId, [id]))[id] || emptyCounts()
  const hasMessages = existing.queued + existing.sending + existing.sent + existing.failed + existing.unknown + existing.skipped + existing.cancelled > 0
  if (row.status === 'cancelled') return fail(409, 'stopped', 'This promotion was stopped. Start a new one to send it again.')
  if (row.status !== 'draft' && hasMessages) return fail(409, 'already_sent', 'This promotion has already been sent or scheduled.')

  const parsed = cleanInput({ name: row.name, message: row.message, email_subject: row.email_subject, audience: row.audience })
  if (!parsed.ok) return fail(400, 'invalid', parsed.errors[0])
  const input = parsed.value

  const info = await deps.store.loadShop(shopId)
  if (!info.rules.master_enabled) return fail(409, 'master_off', 'All automations are switched off, and that includes promotions. Switch them back on first.')
  const scheduled = typeof opts.sendAt === 'number' && opts.sendAt > now + MIN
  const plan = await planFor(deps, shopId, input, id, { now, notBefore: scheduled ? opts.sendAt : undefined, forRun: true })
  if (plan.problems.length) return fail(409, 'needs_setup', plan.problems[0])
  const rows = messagesFromPlan(plan, null, true)
  const toSend = rows.filter(r => r.status === 'queued')
  if (!toSend.length) {
    const why = Object.entries(plan.summary.skippedBy).filter(([k]) => k !== 'already_sent').sort((a, b) => b[1] - a[1])[0]
    return fail(409, 'nobody', why ? `Nobody would receive this. The most common reason: ${skipWords(why[0]).toLowerCase()} (${why[1]}).` : 'Nobody matches this audience, so there is nobody to send to.')
  }

  // Take the promotion before writing any messages, so two presses of the button cannot both send.
  const taken = await store.update(shopId, id, { status: scheduled ? 'scheduled' : 'sending', send_at: scheduled ? new Date(opts.sendAt as number).toISOString() : new Date(now).toISOString() }, ['draft', 'sending', 'scheduled'])
  if (!taken) return fail(409, 'already_sent', 'This promotion has already been sent or scheduled.')

  try {
    await deps.store.insertMessages(rows)
  } catch (error) {
    // Nothing was lined up, so put it back and let the owner try again.
    await store.update(shopId, id, { status: 'draft', send_at: null }, ['sending', 'scheduled']).catch(() => null)
    throw error
  }
  // Counted from the messages on record, so a second press of the button (which queues nobody new) never lowers the totals.
  const lined = (await store.counts(shopId, [id]))[id] || emptyCounts()
  const queued = lined.queued + lined.sending + lined.sent + lined.failed + lined.unknown + lined.cancelled
  const leftOut = lined.skipped
  await store.update(shopId, id, { queued_count: queued, skipped_count: leftOut, ...(scheduled ? {} : { sent_at: new Date(now).toISOString() }) })

  if (!scheduled) {
    const deadline = clockOf(deps) + (opts.drainMs ?? 25_000)
    for (let batch = 0; batch < 25 && clockOf(deps) < deadline; batch += 1) {
      const d = await drainShop(deps, shopId, { automationId: PROMOTION_AUTOMATION, limit: 40, deadlineMs: deadline })
      if (d.looked < 40 || d.stoppedEarly) break
    }
  }
  const counts = (await store.counts(shopId, [id]))[id] || emptyCounts()
  const waiting = counts.queued + counts.sending
  const status = deriveStatus({ status: scheduled ? 'scheduled' : 'sending', send_at: scheduled ? new Date(opts.sendAt as number).toISOString() : null }, counts, now)
  const firstSend = scheduled || waiting ? counts.next_send_after : null
  return {
    ok: true,
    status,
    queued,
    left_out: leftOut,
    sent: counts.sent,
    failed: counts.failed + counts.unknown,
    waiting,
    send_at: scheduled ? new Date(opts.sendAt as number).toISOString() : null,
    first_send_iso: firstSend,
    message: scheduled
      ? `Scheduled. ${queued} ${queued === 1 ? 'person is' : 'people are'} lined up.`
      : waiting
        ? `${counts.sent} sent, ${waiting} still going out. Alpha keeps sending until they are all done.`
        : `${counts.sent} sent.`,
  }
}

/** Keep sending what is due for a promotion that is partly out. */
export async function continuePromotion(deps: Deps, store: PromotionStore, shopId: string, id: string, opts: { drainMs?: number } = {}): Promise<{ ok: true; sent: number; waiting: number } | Failure> {
  const row = await store.get(shopId, id)
  if (!row) return fail(404, 'not_found', 'That promotion was not found.')
  if (row.status === 'draft' || row.status === 'cancelled') return fail(409, 'not_sending', 'This promotion is not being sent.')
  const deadline = clockOf(deps) + (opts.drainMs ?? 25_000)
  let sent = 0
  for (let batch = 0; batch < 25 && clockOf(deps) < deadline; batch += 1) {
    const d = await drainShop(deps, shopId, { automationId: PROMOTION_AUTOMATION, limit: 40, deadlineMs: deadline })
    sent += d.sent
    if (d.looked < 40 || d.stoppedEarly) break
  }
  const counts = (await store.counts(shopId, [id]))[id] || emptyCounts()
  return { ok: true, sent, waiting: counts.queued + counts.sending }
}

/** Stop a promotion: what is still waiting is cancelled. What already went out cannot be taken back. */
export async function stopPromotion(deps: Deps, store: PromotionStore, shopId: string, id: string): Promise<{ ok: true; cancelled: number; already_sent: number } | Failure> {
  const row = await store.get(shopId, id)
  if (!row) return fail(404, 'not_found', 'That promotion was not found.')
  if (row.status === 'draft') return fail(409, 'not_sending', 'This promotion has not been sent. Delete it if you do not want it.')
  if (row.status === 'cancelled') return fail(409, 'stopped', 'This promotion is already stopped.')
  const before = (await store.counts(shopId, [id]))[id] || emptyCounts()
  if (before.queued + before.sending === 0) return fail(409, 'nothing_waiting', 'Everything in this promotion has already gone out, so there is nothing left to stop.')
  const cancelled = await deps.store.cancelQueued(shopId, PROMOTION_AUTOMATION, 'cancelled_by_you', id)
  await store.update(shopId, id, { status: 'cancelled' }, ['scheduled', 'sending', 'sent'])
  const counts = (await store.counts(shopId, [id]))[id] || emptyCounts()
  return { ok: true, cancelled, already_sent: counts.sent }
}

// ── The list ──────────────────────────────────────────────────────────────

export async function listPromotions(store: PromotionStore, shopId: string, now = Date.now()): Promise<PromotionView[]> {
  const rows = await store.list(shopId)
  const counts = rows.length ? await store.counts(shopId, rows.map(r => r.id)) : {}
  const views = rows.map(r => viewOf(r, counts[r.id], now))
  // Keep the saved status honest once everything has gone out, so other screens that read it agree.
  for (const v of views) {
    const row = rows.find(r => r.id === v.id)
    if (row && v.status === 'sent' && row.status !== 'sent') {
      await store.update(shopId, v.id, { status: 'sent', sent_at: row.sent_at || new Date(now).toISOString() }, ['scheduled', 'sending']).catch(() => null)
    }
  }
  return views
}
