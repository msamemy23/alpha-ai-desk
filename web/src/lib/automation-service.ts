// What the automation routes do, kept out of the route files so the scheduler, the screen and the tests share it:
// the overview, the preview, test sends, running one automation, running everything that is due, and the readable history.

import type { SupabaseClient } from '@supabase/supabase-js'
import { calculateDocumentTotals } from '@/lib/document-money'
import { checkRateLimit } from '@/lib/rate-limit'
import { isScheduleDueSince, nextScheduledRun, occurrenceKey, intervalMs } from '@/lib/schedules'
import {
  CATALOG,
  CATALOG_BY_ID,
  allFields,
  resolveConfig,
  scheduleOf,
  type AutomationDef,
} from '@/lib/automation-catalog'
import {
  planAutomation,
  runAutomation,
  drainShop,
  runContextFor,
  runSentence,
  setupProblems,
  type Deps,
  type MessageRow,
  type RunSummary,
  type ShopInfo,
} from '@/lib/automation-engine'
import {
  attribute,
  emptyOutcome,
  hasUsablePhone,
  prettyPhone,
  renderTemplate,
  addOptOut,
  skipWords,
  validTimezone,
  type Outcome,
} from '@/lib/automation-rules'
import {
  NeedsDatabaseUpdate,
  createAlerter,
  createSenders,
  createStore,
  isMissing,
  loadShopInfo,
  readHeartbeat,
  touchHeartbeat,
} from '@/lib/automation-store'

type Db = SupabaseClient
type Row = Record<string, any>

const DAY = 86_400_000
const MIN = 60_000
export const TICK_NAME = 'scheduler'

export class NoShopSettings extends Error {
  constructor() { super('Shop settings are not set up yet. Open Settings and save your shop details first.') }
}

export function engineDeps(db: Db, baseUrl: string): Deps {
  return { store: createStore(db), senders: createSenders(db, baseUrl), alert: createAlerter(db) }
}

// ── Saving settings without losing someone else's change ──────────────────

/**
 * Read the shop's automation settings fresh, change them, and save only if nobody else saved in between.
 * If someone did, read again and re-apply, a few times, so a worker finishing a run never undoes a switch the owner just flipped.
 */
export async function patchAutomationConfig(db: Db, shopId: string, mutate: (config: Record<string, any>) => void): Promise<Record<string, any>> {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const { data, error } = await db.from('settings').select('id,automation_config,updated_at').eq('shop_id', shopId).order('updated_at', { ascending: false }).limit(1).maybeSingle()
    if (error) throw new Error('Unable to load shop settings')
    if (!data?.id) throw new NoShopSettings()
    const config = JSON.parse(JSON.stringify(data.automation_config && typeof data.automation_config === 'object' && !Array.isArray(data.automation_config) ? data.automation_config : {})) as Record<string, any>
    mutate(config)
    let q = db.from('settings').update({ automation_config: config, updated_at: new Date().toISOString() }).eq('id', data.id).eq('shop_id', shopId)
    if (data.updated_at) q = q.eq('updated_at', data.updated_at)
    const { data: saved, error: saveError } = await q.select('id').maybeSingle()
    if (saveError) throw new Error(saveError.message)
    if (saved) return config
  }
  throw new Error('Automation settings changed while this was saving. Try again.')
}

export const blankState = () => ({
  enabled: false,
  enabled_at: null as string | null,
  config: {} as Record<string, unknown>,
  last_run: null as string | null,
  run_count: 0,
  last_result: null as string | null,
  last_status: 'never' as 'ok' | 'error' | 'never',
})

// ── Run claims (one run per scheduled moment) ─────────────────────────────

type Claim = { claimed: boolean; runId: string; fencingToken: number | null; failed?: boolean }

export async function claimRun(db: Db, shopId: string, automationId: string, windowKey: string, leaseSeconds = 300): Promise<Claim> {
  const { data, error } = await db.rpc('claim_automation_run_v2', { p_shop_id: shopId, p_automation_id: automationId, p_window_key: windowKey, p_lease_seconds: leaseSeconds })
  if (error) return { claimed: false, runId: '', fencingToken: null, failed: true }
  const c = (data && typeof data === 'object' ? data : {}) as { claimed?: boolean; id?: string; fencing_token?: number | string | null }
  const token = Number(c.fencing_token)
  if (c.claimed !== true || !Number.isSafeInteger(token) || token < 0) return { claimed: false, runId: '', fencingToken: null }
  return { claimed: true, runId: String(c.id || ''), fencingToken: token }
}

async function renewLease(db: Db, shopId: string, automationId: string, windowKey: string, token: number): Promise<void> {
  const now = new Date()
  const { data, error } = await db.from('automation_runs').update({ heartbeat_at: now.toISOString(), lease_expires_at: new Date(now.getTime() + 5 * MIN).toISOString() })
    .eq('shop_id', shopId).eq('automation_id', automationId).eq('window_key', windowKey).eq('fencing_token', token).eq('status', 'running').select('id').maybeSingle()
  if (error || !data) throw new Error('Automation lease was lost before execution')
}

async function finishRun(db: Db, shopId: string, automationId: string, windowKey: string, token: number, patch: { status: 'succeeded' | 'failed' | 'unknown'; result?: unknown; error?: string | null }): Promise<boolean> {
  const { data, error } = await db.from('automation_runs').update({
    status: patch.status,
    finished_at: new Date().toISOString(),
    next_attempt_at: patch.status === 'failed' ? new Date(Date.now() + 5 * MIN).toISOString() : null,
    result: patch.result ?? null,
    error: patch.error ?? null,
  }).eq('shop_id', shopId).eq('automation_id', automationId).eq('window_key', windowKey).eq('fencing_token', token).eq('status', 'running').select('id').maybeSingle()
  return !error && Boolean(data)
}

// ── What a run reports ────────────────────────────────────────────────────

export interface RunReport {
  ok: boolean
  uncertain: boolean
  message: string
  result: Record<string, unknown>
}

export function reportFromSummary(s: RunSummary, def: AutomationDef): RunReport {
  const failed = s.drain.failed + s.drain.unknown
  const result: Record<string, unknown> = {
    ok: s.ok && !s.error,
    engine: true,
    message: runSentence(s, def.name.toLowerCase()),
    sent: s.drain.sent,
    attempted: s.queued + s.skipped,
    queued: s.queued,
    skipped: s.skipped + s.drain.skipped,
    failed,
    retrying: s.drain.retrying,
    later: s.later,
    held: s.heldForQuietHours,
    ...(s.error ? { error: s.error } : {}),
    ...(s.problems.length ? { problems: s.problems } : {}),
  }
  return { ok: s.ok && !s.error, uncertain: s.drain.unknown > 0, message: String(result.message), result }
}

// ── Running ───────────────────────────────────────────────────────────────

export interface ChildCall { baseUrl: string; secret: string; extraHeaders?: Record<string, string> }

async function callLegacyChild(def: AutomationDef, shopId: string, config: Record<string, any>, runId: string, token: number, call: ChildCall): Promise<RunReport> {
  if (!def.legacy) return { ok: false, uncertain: false, message: 'This automation has nothing to run.', result: { ok: false, error: 'This automation has nothing to run.' } }
  const headers: Record<string, string> = { 'Content-Type': 'application/json', 'X-Automation-Run-Id': runId, 'X-Automation-Fencing-Token': String(token), ...(call.extraHeaders || {}) }
  if (call.secret) headers.Authorization = `Bearer ${call.secret}`
  const body = { ...def.legacy.body, ...config, shopId, automationRunId: runId, automationFencingToken: token }
  const res = await fetch(`${call.baseUrl}${def.legacy.endpoint}`, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) })
  const data = await res.json().catch(() => ({})) as Record<string, any>
  const ok = res.ok && data?.success !== false && data?.ok !== false && !data?.error
  const uncertain = !ok && (data?.uncertain === true || data?.reconciliation_required === true || /uncertain|manual reconciliation/i.test(String(data?.error || '')))
  const message = ok ? String(data?.message || 'Finished.') : String(data?.error || `The step returned ${res.status}.`)
  return { ok, uncertain, message, result: { ...data, ok, message } }
}

/**
 * Run one automation for one shop under a run claim: claim, run, record, and update the card's state.
 * `windowKey` identifies the scheduled moment (or a manual press), so the same moment never runs twice.
 */
export async function runOne(db: Db, deps: Deps, args: {
  shopId: string
  def: AutomationDef
  windowKey: string
  manual: boolean
  call: ChildCall
}): Promise<{ status: 'ran' | 'busy' | 'unavailable'; report?: RunReport; runId?: string }> {
  const { shopId, def, windowKey } = args
  const claim = await claimRun(db, shopId, def.id, windowKey)
  if (claim.failed) return { status: 'unavailable' }
  if (!claim.claimed || claim.fencingToken === null) return { status: 'busy' }
  const token = claim.fencingToken
  let report: RunReport
  let started = false
  try {
    await renewLease(db, shopId, def.id, windowKey, token)
    started = true
    if (def.kind === 'engine') {
      const summary = await runAutomation(deps, { shopId, automationId: def.id, runId: claim.runId || null, manual: args.manual })
      report = reportFromSummary(summary, def)
    } else {
      const info = await loadShopInfo(db, shopId)
      report = await callLegacyChild(def, shopId, resolveConfig(def, info.states[def.id]?.config), claim.runId, token, args.call)
    }
  } catch (error) {
    const needsUpdate = error instanceof NeedsDatabaseUpdate
    const text = needsUpdate ? 'This needs a database update before it can run. Ask your developer to apply it.' : error instanceof Error ? error.message : 'The run failed.'
    report = { ok: false, uncertain: started && def.kind === 'legacy', message: text, result: { ok: false, error: text, ...(needsUpdate ? { needs_database_update: true } : {}) } }
  }
  const saved = await finishRun(db, shopId, def.id, windowKey, token, {
    status: report.ok ? 'succeeded' : report.uncertain ? 'unknown' : 'failed',
    result: report.result,
    error: report.ok ? null : report.message,
  })
  const at = new Date().toISOString()
  try {
    await patchAutomationConfig(db, shopId, config => {
      const prev = config[def.id] && typeof config[def.id] === 'object' ? config[def.id] : blankState()
      config[def.id] = {
        ...prev,
        last_status: report.ok ? 'ok' : 'error',
        last_result: JSON.stringify(report.result).slice(0, 500),
        ...(report.ok ? { last_run: at, run_count: (Number(prev.run_count) || 0) + 1 } : {}),
      }
    })
  } catch { /* the run itself is recorded in the run history; the card catches up on the next change */ }
  if (!saved) return { status: 'ran', report: { ...report, ok: false, uncertain: true, message: 'The run finished, but its record could not be saved. Check the history.' }, runId: claim.runId }
  return { status: 'ran', report, runId: claim.runId }
}

// ── Everything that is due ────────────────────────────────────────────────

export interface TickReport { shops: number; ran: number; skipped: number; problems: number; drained: number; failed: number; stoppedEarly: boolean; results: Record<string, unknown> }

/** Run every automation that is due in every shop, then send whatever is waiting. Safe to call as often as you like. */
export async function runAllDue(db: Db, deps: Deps, call: ChildCall, opts: { now?: number; deadlineMs?: number } = {}): Promise<TickReport> {
  const now = opts.now ?? Date.now()
  const deadline = opts.deadlineMs ?? now + 50_000
  const report: TickReport = { shops: 0, ran: 0, skipped: 0, problems: 0, drained: 0, failed: 0, stoppedEarly: false, results: {} }
  const { data: rows, error } = await db.from('settings').select('shop_id').not('shop_id', 'is', null)
  if (error) throw new Error('Unable to load shops')
  const shopIds = [...new Set((rows || []).map(r => String(r.shop_id)))]
  for (const shopId of shopIds) {
    if (Date.now() > deadline) { report.stoppedEarly = true; break }
    report.shops += 1
    let info: Awaited<ReturnType<typeof loadShopInfo>>
    try { info = await loadShopInfo(db, shopId) } catch { report.failed += 1; continue }
    if (info.rules.master_enabled) {
      for (const def of CATALOG) {
        if (Date.now() > deadline) { report.stoppedEarly = true; break }
        const state = info.states[def.id]
        if (!state?.enabled) continue
        const cfg = resolveConfig(def, state.config)
        const schedule = scheduleOf(def, cfg)
        const due = isScheduleDueSince({ schedule, timeZone: info.timezone, lastRun: state.last_run, enabledAt: state.enabled_at, now: new Date(now) })
        if (!due) continue
        if (def.kind === 'engine') {
          const ctx = runContextFor(info, def, cfg, now)
          const blockers = setupProblems(info, def, cfg, ctx)
          if (blockers.length) {
            report.problems += 1
            const text = blockers[0]
            if (!String(state.last_result || '').includes(text)) {
              try {
                await patchAutomationConfig(db, shopId, config => {
                  const prev = config[def.id] || blankState()
                  config[def.id] = { ...prev, last_status: 'error', last_result: JSON.stringify({ ok: false, error: text, needs_setup: true }) }
                })
              } catch { /* try again next time */ }
            }
            continue
          }
        }
        const windowKey = occurrenceKey(schedule, info.timezone, new Date(now))
        const out = await runOne(db, deps, { shopId, def, windowKey, manual: false, call })
        if (out.status === 'ran') { report.ran += 1; report.results[`${shopId}:${def.id}`] = { ok: out.report?.ok, message: out.report?.message } } else report.skipped += 1
      }
    }
  }
  const sent = await drainAll(db, deps, { deadlineMs: deadline })
  report.drained = sent.sent
  report.failed += sent.failed
  report.stoppedEarly = report.stoppedEarly || sent.stoppedEarly
  return report
}

/** Send what is due for every shop that has anything waiting (including retries and messages held for morning). */
export async function drainAll(db: Db, deps: Deps, opts: { deadlineMs?: number } = {}): Promise<{ shops: number; sent: number; failed: number; stoppedEarly: boolean }> {
  const out = { shops: 0, sent: 0, failed: 0, stoppedEarly: false }
  const { data, error } = await db.from('automation_messages').select('shop_id').eq('status', 'queued').lte('send_after', new Date().toISOString()).limit(500)
  if (error) { if (isMissing(error)) return out; throw new Error(error.message) }
  const shops = [...new Set((data || []).map(r => String(r.shop_id)))]
  for (const shopId of shops) {
    if (opts.deadlineMs && Date.now() > opts.deadlineMs) { out.stoppedEarly = true; break }
    out.shops += 1
    // A big promotion is hundreds of messages. Keep going in batches until nothing is due or the time budget is used.
    for (let batch = 0; batch < 25; batch += 1) {
      if (opts.deadlineMs && Date.now() > opts.deadlineMs) { out.stoppedEarly = true; break }
      const d = await drainShop(deps, shopId, { limit: 40, deadlineMs: opts.deadlineMs })
      out.sent += d.sent
      out.failed += d.failed + d.unknown
      if (d.stoppedEarly) out.stoppedEarly = true
      // A batch that did not fill up means nothing else is due. Messages held back or set to retry move out of "due", so the next batch sees new ones.
      if (d.looked < 40 || d.stoppedEarly) break
    }
  }
  return out
}

/** One wake-up of the scheduler: note that it happened, then do the work. */
export async function tick(db: Db, deps: Deps, call: ChildCall): Promise<TickReport> {
  const before = await readHeartbeat(db, TICK_NAME).catch(() => null)
  await touchHeartbeat(db, TICK_NAME, { previous_at: before?.at || null }).catch(() => undefined)
  return runAllDue(db, deps, call)
}

/** How often the scheduler really wakes up, worked out from its last two wake-ups. */
export async function schedulerStatus(db: Db, now = Date.now()): Promise<{ last_tick_at: string | null; every_minutes: number | null; status: 'ok' | 'late' | 'unknown' }> {
  const beat = await readHeartbeat(db, TICK_NAME).catch(() => null)
  if (!beat) return { last_tick_at: null, every_minutes: null, status: 'unknown' }
  const last = new Date(beat.at).getTime()
  const prev = typeof beat.detail.previous_at === 'string' ? new Date(beat.detail.previous_at).getTime() : NaN
  const gap = Number.isFinite(prev) && last > prev ? Math.round((last - prev) / MIN) : null
  const every = gap !== null ? Math.min(Math.max(gap, 5), 1440) : null
  const late = every !== null ? now - last > every * 2 * MIN + 10 * MIN : now - last > 26 * 60 * MIN
  return { last_tick_at: beat.at, every_minutes: every, status: late ? 'late' : 'ok' }
}

/** When this automation will next get a chance to run: right away if it is already due, otherwise its next stated time. */
export function nextRunAt(info: ShopInfo, def: AutomationDef, cfg: Record<string, any>, now: number): string | null {
  const state = info.states[def.id]
  if (!state?.enabled) return null
  const tz = validTimezone(info.timezone)
  const schedule = scheduleOf(def, cfg)
  const every = intervalMs(schedule)
  const due = isScheduleDueSince({ schedule, timeZone: tz, lastRun: state.last_run, enabledAt: state.enabled_at, now: new Date(now) })
  if (due) return new Date(now).toISOString()
  if (every !== null) return new Date(Math.max(now, (state.last_run ? new Date(state.last_run).getTime() : now) + every)).toISOString()
  return nextScheduledRun(schedule, tz, new Date(now)).toISOString()
}

// ── The overview the screen shows ─────────────────────────────────────────

async function pageOptional<T>(make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { code?: string; message?: string } | null }>): Promise<{ rows: T[]; missing: boolean }> {
  const rows: T[] = []
  for (let from = 0; from < 10_000; from += 1000) {
    const { data, error } = await make(from, from + 999)
    if (error) { if (isMissing(error)) return { rows: [], missing: true }; throw error }
    rows.push(...(data || []))
    if (!data || data.length < 1000) break
  }
  return { rows, missing: false }
}

export interface CardInfo {
  id: string
  name: string
  blurb: string
  trigger: string
  category: string
  icon: string
  kind: 'engine' | 'legacy'
  klass: string
  channel: string
  schedule: string
  default_schedule: string
  claims_revenue: boolean
  template: string
  default_template: string
  email_subject: string
  placeholders: string[]
  detail: string[]
  fields: Array<ReturnType<typeof allFields>[number] & { value: unknown }>
  state: { enabled: boolean; enabled_at: string | null; last_run: string | null; run_count: number; last_result: string | null; last_status: 'ok' | 'error' | 'never' }
  setup: string | null
  next_run: string | null
  waiting: number
  next_send: string | null
  sent_30d: number
}

export async function overview(db: Db, shopId: string, now = Date.now()) {
  const info = await loadShopInfo(db, shopId)
  const tz = validTimezone(info.timezone)
  const since = new Date(now - 30 * DAY).toISOString()
  const queued = await pageOptional<Row>((a, b) => db.from('automation_messages').select('automation_id,send_after').eq('shop_id', shopId).eq('status', 'queued').range(a, b))
  const sent = await pageOptional<Row>((a, b) => db.from('automation_messages').select('automation_id').eq('shop_id', shopId).eq('status', 'sent').eq('is_test', false).gte('sent_at', since).range(a, b))
  const needsUpdate = queued.missing || sent.missing
  const waiting = new Map<string, { n: number; first: string }>()
  for (const q of queued.rows) {
    const w = waiting.get(q.automation_id) || { n: 0, first: String(q.send_after) }
    w.n += 1
    if (String(q.send_after) < w.first) w.first = String(q.send_after)
    waiting.set(q.automation_id, w)
  }
  const sentBy = new Map<string, number>()
  for (const s of sent.rows) sentBy.set(s.automation_id, (sentBy.get(s.automation_id) || 0) + 1)

  const cards: CardInfo[] = CATALOG.map(def => {
    const state = info.states[def.id]
    const cfg = resolveConfig(def, state?.config)
    const ctx = runContextFor(info, def, cfg, now)
    const problems = setupProblems(info, def, cfg, ctx)
    if (def.kind === 'engine' && !String(cfg.message || '').trim() && def.id !== 'sms_blast') problems.push('Write the message first.')
    const schedule = scheduleOf(def, cfg)
    const next = state?.enabled && info.rules.master_enabled ? nextRunAt(info, def, cfg, now) : null
    const w = waiting.get(def.id)
    return {
      id: def.id, name: def.name, blurb: def.blurb, trigger: def.trigger, category: def.category, icon: def.icon, kind: def.kind, klass: def.klass, channel: def.channel,
      schedule, default_schedule: def.schedule, claims_revenue: def.claimsRevenue, template: String(cfg.message || ''), default_template: def.template,
      email_subject: String(cfg.email_subject || def.emailSubject || ''), placeholders: def.placeholders, detail: def.detail,
      fields: allFields(def).map(f => ({ ...f, value: cfg[f.key] })),
      state: {
        enabled: state?.enabled === true, enabled_at: state?.enabled_at ?? null, last_run: state?.last_run ?? null, run_count: Number(state?.run_count) || 0,
        last_result: state?.last_result ?? null, last_status: state?.last_status ?? 'never',
      },
      setup: problems[0] || null, next_run: next, waiting: w?.n || 0, next_send: w?.first || null, sent_30d: sentBy.get(def.id) || 0,
    }
  })

  const attention: Array<{ id: string; kind: 'failed' | 'setup' | 'stopped'; automation_id: string | null; text: string }> = []
  if (!info.rules.master_enabled) attention.push({ id: 'master', kind: 'stopped', automation_id: null, text: 'All automations are switched off. Nothing is being sent.' })
  for (const c of cards) {
    if (c.state.enabled && c.setup) attention.push({ id: `setup:${c.id}`, kind: 'setup', automation_id: c.id, text: `${c.name} is on but cannot run. ${c.setup}` })
  }
  const failedRows = await pageOptional<Row>((a, b) => db.from('automation_messages').select('automation_id,status').eq('shop_id', shopId).in('status', ['failed', 'unknown']).gte('updated_at', new Date(now - 7 * DAY).toISOString()).range(a, b))
  const failedBy = new Map<string, number>()
  for (const f of failedRows.rows) failedBy.set(f.automation_id, (failedBy.get(f.automation_id) || 0) + 1)
  for (const [id, n] of failedBy) {
    attention.push({ id: `failed:${id}`, kind: 'failed', automation_id: id, text: `${n} ${n === 1 ? 'message' : 'messages'} from ${CATALOG_BY_ID[id]?.name || id} did not go out this week.` })
  }

  return {
    cards,
    rules: info.rules,
    shop: { name: info.name, timezone: tz, sms_ready: info.smsReady, email_ready: info.emailReady, review_link_set: Boolean(info.reviewUrl), has_settings: info.settingsId !== null },
    scheduler: await schedulerStatus(db, now),
    needs_database_update: needsUpdate,
    attention,
  }
}

// ── The next 30 days ──────────────────────────────────────────────────────

export async function upcoming(db: Db, deps: Deps, shopId: string, now = Date.now()) {
  const info = await loadShopInfo(db, shopId)
  const tz = validTimezone(info.timezone)
  const dayKey = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms))
  const horizon = now + 30 * DAY

  const waiting = await pageOptional<Row>((a, b) => db.from('automation_messages').select('automation_id,send_after').eq('shop_id', shopId).eq('status', 'queued').lte('send_after', new Date(horizon).toISOString()).range(a, b))
  const byDay = new Map<string, { date: string; count: number; by: Record<string, number> }>()
  for (const w of waiting.rows) {
    const k = dayKey(new Date(w.send_after).getTime())
    const d = byDay.get(k) || { date: k, count: 0, by: {} }
    d.count += 1
    d.by[w.automation_id] = (d.by[w.automation_id] || 0) + 1
    byDay.set(k, d)
  }

  const nextRuns = CATALOG.map(def => {
    const cfg = resolveConfig(def, info.states[def.id]?.config)
    return { automation_id: def.id, name: def.name, at: info.rules.master_enabled ? nextRunAt(info, def, cfg, now) : null }
  }).filter(r => r.at).sort((a, b) => String(a.at).localeCompare(String(b.at)))

  // Appointments in the next 30 days that will each get a reminder.
  const today = dayKey(now)
  const end = dayKey(horizon)
  const appts = await pageOptional<Row>((a, b) => db.from('appointments').select('id,date,status,reminder_sent_at').eq('shop_id', shopId).gte('date', today).lte('date', end).in('status', ['Scheduled', 'Confirmed']).range(a, b))
  const reminded = appts.rows.filter(r => !r.reminder_sent_at).length

  // Vehicles that reach their service interval within the next 30 days (not due yet today).
  let dueSoon: Array<{ name: string; vehicle: string; why: string }> = []
  const svc = CATALOG_BY_ID.service_reminders
  try {
    const raw = await deps.store.loadRaw(shopId, svc.needs, now)
    const cfg = resolveConfig(svc, info.states[svc.id]?.config)
    const ctxNow = runContextFor(info, svc, cfg, now)
    const nowKeys = new Set((svc.find?.(raw, cfg, ctxNow) || []).map(c => c.dedupeKey))
    const later = svc.find?.(raw, cfg, runContextFor(info, svc, cfg, horizon)) || []
    dueSoon = later.filter(c => !nowKeys.has(c.dedupeKey)).slice(0, 25).map(c => ({ name: c.name, vehicle: c.vars.vehicle || '', why: c.why }))
  } catch { dueSoon = [] }

  return {
    available: !waiting.missing,
    waiting_by_day: [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date)),
    waiting_total: waiting.rows.length,
    next_runs: nextRuns,
    appointments_to_remind: reminded,
    service_due_soon: dueSoon,
  }
}

// ── Preview ───────────────────────────────────────────────────────────────

export async function preview(deps: Deps, shopId: string, automationId: string, configOverride?: Record<string, unknown>, now?: number) {
  const plan = await planAutomation(deps, { shopId, automationId, configOverride, now })
  const tz = validTimezone(plan.info.timezone)
  const when = (ms: number) => new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ms))
  const sends = plan.decisions.filter(d => d.action === 'send')
  const later = plan.decisions.filter(d => d.action === 'later')
  const skipped = plan.decisions.filter(d => d.action === 'skip' && d.reason !== 'already_sent')
  const skippedBy = Object.entries(plan.summary.skippedBy).filter(([k]) => k !== 'already_sent').map(([reason, count]) => ({ reason, label: skipWords(reason), count }))
  return {
    ok: true,
    id: automationId,
    name: plan.def.name,
    klass: plan.def.klass,
    channel: plan.def.channel,
    problems: plan.problems,
    message: String(plan.config.message || ''),
    quiet_hours: { start: plan.info.rules.quiet_start_hour, end: plan.info.rules.quiet_end_hour, skip_sundays: plan.info.rules.skip_sundays },
    counts: { send: plan.summary.send, send_now: plan.summary.sendNow, held_for_quiet_hours: plan.summary.heldForQuietHours, later: plan.summary.later, skipped: skipped.length },
    skipped_by: skippedBy,
    recipients: sends.slice(0, 50).map(d => ({
      name: d.candidate.name, to: d.candidate.channel === 'sms' ? prettyPhone(d.to) : d.to, channel: d.candidate.channel, why: d.candidate.why,
      text: d.text, subject: d.subject || null, parts: d.parts, send_at: when(d.sendAfter), send_at_iso: new Date(d.sendAfter).toISOString(), held: d.heldForQuietHours, notes: d.notes,
    })),
    later: later.slice(0, 20).map(d => ({ name: d.candidate.name, why: d.candidate.why, reason: d.reason, label: d.reason === 'run_limit' ? 'Waiting for the next run' : `Not yet due. Goes out ${when(d.sendAfter)}`, send_at_iso: new Date(d.sendAfter).toISOString() })),
    skipped: skipped.slice(0, 80).map(d => ({ name: d.candidate.name, why: d.candidate.why, reason: d.reason, label: skipWords(d.reason || 'skipped') })),
    note: 'This is a preview. Nothing has been sent.',
  }
}

// ── Test send to yourself ─────────────────────────────────────────────────

export async function testSend(db: Db, deps: Deps, input: { shopId: string; userId: string; automationId: string; to: string; configOverride?: Record<string, unknown> }) {
  const def = CATALOG_BY_ID[input.automationId]
  if (!def || def.kind !== 'engine') return { ok: false as const, status: 404, error: 'Unknown automation' }
  if (!hasUsablePhone(input.to)) return { ok: false as const, status: 400, error: 'Enter a mobile number with the area code.' }
  const limit = checkRateLimit(`automation-test:${input.shopId}`, 8, 60 * MIN)
  if (!limit.ok) return { ok: false as const, status: 429, error: 'That is plenty of test texts for now. Try again in an hour.' }
  const info = await deps.store.loadShop(input.shopId)
  if (!info.smsReady) return { ok: false as const, status: 409, error: 'Texting is not set up yet. Add your Telnyx key and number in Settings.' }
  const plan = await planAutomation(deps, { shopId: input.shopId, automationId: input.automationId, configOverride: input.configOverride })
  const tpl = String(plan.config.message || '')
  if (!tpl.trim() || plan.problems.some(p => /message|placeholder|emoji/i.test(p))) return { ok: false as const, status: 409, error: plan.problems[0] || 'Write the message first.' }
  if (await deps.store.isOptedOut(input.shopId, 'sms', input.to, null)) return { ok: false as const, status: 409, error: 'That number is on your STOP list, so it will not be texted.' }
  // Use the first real person for the wording, so the test reads like the real thing. Only the owner's own phone receives it.
  const first = plan.decisions.find(d => d.action === 'send')?.candidate
  const sample = first ? first.vars : { name: 'Alex', vehicle: '2018 Honda Accord', service: 'oil change', date: 'tomorrow at 9:30 AM', items: 'the front brake pads', amount: '$320.00', contact: plan.info.phone ? `Call ${prettyPhone(plan.info.phone)} or reply to this text` : 'Reply to this text', shop: plan.info.name || 'our shop', review_link: plan.info.reviewUrl }
  const rendered = renderTemplate(tpl, sample).text
  const text = `[Test] ${def.klass === 'marketing' ? addOptOut(rendered) : rendered}`
  const now = Date.now()
  const rows = await deps.store.insertMessages([{
    shop_id: input.shopId, automation_id: def.id, run_id: null, channel: 'sms', message_class: def.klass, status: 'queued', skip_reason: null, customer_id: null,
    recipient_name: 'You (test)', recipient: input.to, subject: null, body: text, source_type: 'test', source_id: null, dedupe_key: null,
    send_after: new Date(now).toISOString(), is_test: true, detail: { test: true, manual: true },
  }])
  const row = rows[0] as MessageRow | undefined
  if (!row) return { ok: false as const, status: 502, error: 'The test text could not be queued.' }
  const claimed = await deps.store.claimMessage(row, now)
  if (!claimed) return { ok: false as const, status: 409, error: 'That test is already being sent.' }
  let result
  try {
    result = await deps.senders.sms({ row: claimed, to: input.to, text, idempotencyKey: `am:${claimed.id}` }, info)
  } catch (error) {
    result = { ok: false, error: error instanceof Error ? error.message : 'The test text could not be sent.', uncertain: true }
  }
  const at = new Date().toISOString()
  if (result.ok) {
    await deps.store.finishMessage(claimed, { status: 'sent', sent_at: at, provider_message_id: result.id || null, last_error: null, updated_at: at })
    return { ok: true as const, text, to: prettyPhone(input.to), message: 'Test text sent to your phone. No customer was texted.' }
  }
  await deps.store.finishMessage(claimed, { status: result.uncertain ? 'unknown' : 'failed', last_error: String(result.error || '').slice(0, 300), updated_at: at })
  return { ok: false as const, status: 502, error: String(result.error || 'The test text could not be sent.') }
}

// ── Results: sent, delivered, replied, booked, revenue ────────────────────

const CAMPAIGN_GROUP = 'campaign:'

/**
 * What the messages brought in. `by_automation` has one entry per automation; `by_campaign` one per one-off promotion
 * (those are not counted again under the automation they were sent through). Last-touch credit: a reply, booking or
 * payment goes to the most recent message that person got, once. Bookings and revenue are only credited to
 * automations that ask the customer to come in.
 */
export async function outcomes(db: Db, shopId: string, days = 30, now = Date.now()) {
  const since = now - days * DAY
  const sinceIso = new Date(since).toISOString()
  const sentRows = await pageOptional<Row>((a, b) => db.from('automation_messages').select('id,automation_id,campaign_id,customer_id,recipient,channel,sent_at,delivery_status').eq('shop_id', shopId).eq('status', 'sent').eq('is_test', false).gte('sent_at', sinceIso).range(a, b))
  if (sentRows.missing) return { available: false as const, days, by_automation: {} as Record<string, Outcome>, by_campaign: {} as Record<string, Outcome>, total: emptyOutcome(), delivery_tracking: false }
  const sent = sentRows.rows.map(r => ({
    id: String(r.id), customerId: r.customer_id, phone: r.channel === 'sms' ? r.recipient : null, email: r.channel === 'email' ? r.recipient : null,
    automationId: String(r.automation_id), at: new Date(r.sent_at).getTime(),
    group: r.campaign_id ? `${CAMPAIGN_GROUP}${r.campaign_id}` : undefined,
    delivered: r.delivery_status === 'delivered',
  }))
  const replies = (await pageOptional<Row>((a, b) => db.from('messages').select('customer_id,from_address,created_at').eq('shop_id', shopId).eq('direction', 'inbound').gte('created_at', sinceIso).range(a, b))).rows
    .map(r => ({ customerId: r.customer_id, phone: r.from_address, at: new Date(r.created_at).getTime() }))
  const bookings = (await pageOptional<Row>((a, b) => db.from('appointments').select('customer_id,phone,created_at').eq('shop_id', shopId).gte('created_at', sinceIso).range(a, b))).rows
    .map(r => ({ customerId: r.customer_id, phone: r.phone, at: new Date(r.created_at).getTime() }))
  const docs = (await pageOptional<Row>((a, b) => db.from('documents').select('*').eq('shop_id', shopId).in('type', ['Invoice', 'Receipt']).in('status', ['Paid', 'Partial']).gte('updated_at', sinceIso).range(a, b))).rows
  const payments = docs.map(d => {
    const t = calculateDocumentTotals(d)
    const amount = t.amountPaid > 0 ? Math.min(t.amountPaid, t.total || t.amountPaid) : d.status === 'Paid' ? t.total : 0
    return { customerId: d.customer_id, phone: d.customer_phone, at: new Date(d.updated_at || d.created_at).getTime(), amount }
  }).filter(p => p.amount > 0)
  const moneyFrom = new Set(CATALOG.filter(d => d.claimsRevenue).map(d => d.id))
  const all = attribute(sent, { replies, bookings, payments }, { moneyFrom })
  const by_automation: Record<string, Outcome> = {}
  const by_campaign: Record<string, Outcome> = {}
  for (const [key, o] of Object.entries(all)) {
    if (key.startsWith(CAMPAIGN_GROUP)) by_campaign[key.slice(CAMPAIGN_GROUP.length)] = o
    else by_automation[key] = o
  }
  const total = Object.values(all).reduce((a, o) => ({ sent: a.sent + o.sent, delivered: a.delivered + o.delivered, replied: a.replied + o.replied, booked: a.booked + o.booked, revenue: Math.round((a.revenue + o.revenue) * 100) / 100 }), emptyOutcome())
  return { available: true as const, days, by_automation, by_campaign, total, delivery_tracking: sentRows.rows.some(r => r.delivery_status) }
}

// ── Readable history ──────────────────────────────────────────────────────

export async function messageHistory(db: Db, shopId: string, opts: { automationId?: string; campaignId?: string; status?: string; limit?: number; before?: string; tests?: boolean }) {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200)
  let q = db.from('automation_messages').select('id,automation_id,campaign_id,status,skip_reason,channel,message_class,recipient_name,recipient,subject,body,send_after,sent_at,delivery_status,last_error,attempts,detail,created_at,is_test').eq('shop_id', shopId).order('created_at', { ascending: false }).limit(limit + 1)
  if (opts.automationId) q = q.eq('automation_id', opts.automationId)
  if (opts.campaignId) q = q.eq('campaign_id', opts.campaignId)
  if (opts.status) q = q.eq('status', opts.status)
  if (!opts.tests) q = q.eq('is_test', false)
  if (opts.before) q = q.lt('created_at', opts.before)
  const { data, error } = await q
  if (error) { if (isMissing(error)) return { available: false as const, rows: [], next: null as string | null } ; throw new Error(error.message) }
  const rows = (data || []).slice(0, limit).map(r => ({
    id: r.id, automation_id: r.automation_id, campaign_id: r.campaign_id || null, automation: CATALOG_BY_ID[r.automation_id]?.name || r.automation_id, status: r.status,
    delivery: r.delivery_status || null,
    reason: r.skip_reason ? skipWords(r.skip_reason) : null, reason_code: r.skip_reason, channel: r.channel, klass: r.message_class,
    name: r.recipient_name, to: r.channel === 'sms' ? prettyPhone(r.recipient) : r.recipient, subject: r.subject, body: r.body,
    send_after: r.send_after, sent_at: r.sent_at, error: r.last_error, attempts: r.attempts, why: (r.detail as Row | null)?.why || null,
    held: (r.detail as Row | null)?.held_for_quiet_hours === true, created_at: r.created_at, is_test: r.is_test,
  }))
  return { available: true as const, rows, next: (data || []).length > limit ? String(rows[rows.length - 1]?.created_at || '') : null }
}

export async function runHistory(db: Db, shopId: string, opts: { automationId?: string; limit?: number }) {
  let q = db.from('automation_runs').select('id,automation_id,window_key,status,attempts,started_at,finished_at,result,error').eq('shop_id', shopId).order('started_at', { ascending: false }).limit(Math.min(opts.limit ?? 30, 100))
  if (opts.automationId) q = q.eq('automation_id', opts.automationId)
  const { data, error } = await q
  if (error) { if (isMissing(error)) return [] ; throw new Error(error.message) }
  return (data || []).map(r => ({
    id: r.id, automation_id: r.automation_id, automation: CATALOG_BY_ID[r.automation_id]?.name || r.automation_id, status: r.status, attempts: r.attempts,
    started_at: r.started_at, finished_at: r.finished_at, manual: String(r.window_key || '').startsWith('manual:'),
    message: (r.result as Row | null)?.message || r.error || null, sent: (r.result as Row | null)?.sent ?? null, skipped: (r.result as Row | null)?.skipped ?? null, failed: (r.result as Row | null)?.failed ?? null,
  }))
}

export type { ShopInfo }
