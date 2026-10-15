/**
 * Emailing reports: saved reports, test sends, and the scheduled run.
 *
 * What makes this safe to leave on:
 *  - it goes only to addresses the owner typed in for that report, never to customers;
 *  - the exact subject, recipients and text are built here and shown to the owner before anything is turned on;
 *  - a scheduled period is claimed in the database first (one row per report and period), so a retry, a second server or a
 *    double click can never send the same period twice;
 *  - a send that started and never reported back is marked "unknown" and is never sent again on its own;
 *  - turning a schedule on does not send the period that just ended, only the next one;
 *  - every attempt, success or failure, is written to a history the owner can read.
 *
 * Plain TypeScript. Sending is passed in, so tests can run every path without sending anything.
 */
import type { Db, Row } from './db-types.ts'
import { isMissingSchemaError } from './report-docs.ts'
import { bundleFor } from './report-bundles.ts'
import type { BundleInput } from './report-bundles.ts'
import { emailHtml, plainText } from './report-files.ts'
import type { ReportBundle } from './report-files.ts'
import { loadBooks } from './books-store.ts'
import { withAiOnlyCalls } from './report-calls.ts'
import { loadAiCalls, loadCalls, loadDocs, loadPayments } from './report-load.ts'
import { periodPhrase, resolveRange } from './report-ranges.ts'
import { checkSaved, duePeriod, emailSubject, periodToSkip, savedFrom } from './saved-reports.ts'
import type { DuePeriod, SavedReport } from './saved-reports.ts'
import { callStats } from './reports.ts'
import type { ReportCall } from './reports.ts'
import { dayOfStamp } from './report-docs.ts'

export interface Actor { userId: string; name: string; email?: string }

export interface ShopFacts { name: string; address: string; phone: string; email: string; timezone: string; postedRate: number | null }

export type Mailer = (mail: { to: string; subject: string; html: string; text: string; replyTo?: string; idempotencyKey?: string }) => Promise<void>

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim())

/** The shop's calendar day right now, in its own time zone (a server runs in UTC, the shop does not). */
export function todayKeyIn(timezone: string, now: Date): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone || 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now)
    const get = (t: string) => parts.find(p => p.type === t)?.value || ''
    return `${get('year')}-${get('month')}-${get('day')}`
  } catch {
    return todayKeyIn('America/Chicago', now)
  }
}

export async function loadShopFacts(db: Db, shopId: string): Promise<ShopFacts> {
  let r = await db.from('settings').select('shop_name,shop_address,shop_phone,shop_email,labor_rate,timezone').eq('shop_id', shopId).maybeSingle()
  if (r.error) r = await db.from('settings').select('shop_name,shop_address,shop_phone,shop_email,labor_rate').eq('shop_id', shopId).maybeSingle()
  const d = (r.data || {}) as Row
  const rate = Number(d.labor_rate)
  return { name: str(d.shop_name), address: str(d.shop_address), phone: str(d.shop_phone), email: str(d.shop_email), timezone: str(d.timezone) || 'America/Chicago', postedRate: rate > 0 ? rate : null }
}

/* ---------- building a report ---------- */

export interface Loaded {
  docs: Awaited<ReturnType<typeof loadDocs>>['docs']
  payments: Awaited<ReturnType<typeof loadPayments>>
  books: Awaited<ReturnType<typeof loadBooks>>
  calls: ReportCall[] | null
}

/** Reads what a report is made from. A failure to read money throws; the calls are optional and left out if they fail. */
export async function loadForReports(db: Db, shopId: string, now: Date): Promise<Loaded> {
  const snapshot = now.toISOString()
  const { docs } = await loadDocs(db, shopId, snapshot)
  const [payments, books] = await Promise.all([loadPayments(db, shopId, snapshot, docs), loadBooks(db, shopId)])
  let calls: Loaded['calls'] = null
  try {
    const since = `${now.getFullYear() - 1}-01-01T00:00:00`
    calls = await loadCalls(db, shopId, snapshot, since)
    // The AI assistant's calls are counted as incoming calls too, when its log can be read.
    try {
      calls = withAiOnlyCalls(calls, await loadAiCalls(db, shopId))
    } catch { /* the phone log alone is still right, just without the AI-only calls */ }
  } catch {
    calls = null
  }
  return { docs, payments, books, calls }
}

const hourOf = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? -1 : d.getHours() }

export interface Period { range: { from: string; to: string }; previous: { from: string; to: string } | null; phrase: string; vs: string; title: string; key: string | null }

export interface Built { bundle: ReportBundle; subject: string; text: string; html: string }

export function buildReport(saved: Pick<SavedReport, 'kind' | 'name'>, period: Period, todayKey: string, facts: ShopFacts, loaded: Loaded): Built {
  const settings = loaded.books.settings.value
  const callsNow = loaded.calls ? callStats(loaded.calls, period.range, dayOfStamp, hourOf).inbound : null
  const callsBefore = loaded.calls && period.previous ? callStats(loaded.calls, period.previous, dayOfStamp, hourOf).inbound : null
  const input: BundleInput = {
    docs: loaded.docs, payments: loaded.payments, expenses: loaded.books.expenses.value, range: period.range, previous: period.previous,
    phrase: period.phrase, vs: period.vs, periodTitle: period.title, todayKey, shopName: facts.name,
    taxComponents: settings.taxComponents, laborCostPerHour: settings.laborCostPerHour, postedRate: facts.postedRate, basis: settings.basis, cogsMethod: settings.cogsMethod,
    calls: callsNow !== null && callsBefore !== null ? { now: callsNow, before: callsBefore } : null,
  }
  const bundle = bundleFor(saved.kind, input)
  if (saved.kind === 'profit' && loaded.books.expenses.state !== 'ok') {
    bundle.notes.unshift('Bills and expenses could not be read, so profit here leaves them out and is higher than it really is.')
  }
  bundle.notes.push(`This email was set up in ${facts.name || 'your shop'}'s reports. To stop it, open Reports, then Emailed reports, and switch it off.`)
  const subject = emailSubject(facts.name, saved.name, period.title)
  return { bundle, subject, text: plainText(bundle), html: emailHtml(bundle) }
}

/** The period a saved report covers when it is sent by hand today: its own date range. */
export function manualPeriod(saved: SavedReport, todayKey: string): Period {
  const r = resolveRange(saved.range, saved.compare, todayKey)
  return { range: r.range, previous: r.previous, phrase: periodPhrase(saved.range, r.range), vs: r.vs, title: r.title, key: null }
}

/** The period for a scheduled send. */
export function scheduledPeriodFor(saved: SavedReport, due: DuePeriod): Period {
  const weekly = saved.schedule === 'weekly'
  return { range: due.range, previous: due.previous, phrase: weekly ? 'last week' : 'last month', vs: weekly ? 'the week before' : 'the month before', title: due.title, key: due.key }
}

/* ---------- saved reports ---------- */

export interface SendLogEntry {
  id: string
  saved_report_id: string | null
  report_name: string
  trigger: 'schedule' | 'manual' | 'test'
  period_title: string
  recipients: string[]
  subject: string
  status: 'claimed' | 'sent' | 'failed' | 'unknown'
  error: string
  created_at: string
  sent_at: string | null
}

const SAVED_COLUMNS = 'id,name,kind,range,compare,schedule,recipients,enabled,last_period,last_sent_at,created_at'
const LOG_COLUMNS = 'id,saved_report_id,report_name,trigger,period_title,recipients,subject,status,error,created_at,sent_at'

export const logFrom = (r: Row): SendLogEntry => ({
  id: str(r.id), saved_report_id: r.saved_report_id ? str(r.saved_report_id) : null, report_name: str(r.report_name),
  trigger: r.trigger === 'schedule' ? 'schedule' : r.trigger === 'test' ? 'test' : 'manual',
  period_title: str(r.period_title), recipients: Array.isArray(r.recipients) ? r.recipients.map(String) : [], subject: str(r.subject),
  status: r.status === 'sent' || r.status === 'failed' || r.status === 'unknown' ? r.status : 'claimed', error: str(r.error), created_at: str(r.created_at), sent_at: r.sent_at ? str(r.sent_at) : null,
})

export type Failure = { ok: false; status: number; message: string; needsUpdate?: boolean; fields?: Record<string, string> }
const fail = (status: number, message: string, extra: Partial<Failure> = {}): Failure => ({ ok: false, status, message, ...extra })
const NEEDS_UPDATE = 'Saved and emailed reports need a one-time update to your Alpha Desk database. It does not change your invoices or payments.'
const failed = (error: { code?: string; message?: string } | null | undefined, what: string): Failure => {
  if (isMissingSchemaError(error)) return fail(503, NEEDS_UPDATE, { needsUpdate: true })
  console.error(`[reports] ${what}:`, error?.message || 'unknown error')
  return fail(500, `${what} did not work. Nothing was sent. Try again in a moment.`)
}

export interface SavedList { state: 'ok' | 'needs-update' | 'error'; reports: SavedReport[]; log: SendLogEntry[]; error: string }

export async function listSaved(db: Db, shopId: string): Promise<SavedList> {
  const r = await db.from('saved_reports').select(SAVED_COLUMNS).eq('shop_id', shopId).order('created_at', { ascending: false }).limit(200)
  if (r.error) {
    if (isMissingSchemaError(r.error)) return { state: 'needs-update', reports: [], log: [], error: '' }
    console.error('[reports] list saved:', r.error.message)
    return { state: 'error', reports: [], log: [], error: 'Your saved reports did not load. Try again.' }
  }
  const l = await db.from('report_send_log').select(LOG_COLUMNS).eq('shop_id', shopId).order('created_at', { ascending: false }).limit(60)
  // The history is a convenience: if it cannot be read, say so rather than showing an empty one.
  const logOk = !l.error
  return {
    state: 'ok', reports: (r.data || []).map(savedFrom), log: logOk ? (l.data || []).map(logFrom) : [],
    error: logOk ? '' : 'The history of emails did not load.',
  }
}

export async function loadSavedOne(db: Db, shopId: string, id: string): Promise<{ ok: true; report: SavedReport } | Failure> {
  const r = await db.from('saved_reports').select(SAVED_COLUMNS).eq('id', id).eq('shop_id', shopId).maybeSingle()
  if (r.error) return failed(r.error, 'Reading the report')
  if (!r.data) return fail(404, 'That report was not found. It may have been deleted.')
  return { ok: true, report: savedFrom(r.data) }
}

/** A report typed into the form and not saved yet, in the shape the preview and test send need. */
export function draftFrom(input: Record<string, unknown>): { ok: true; report: SavedReport } | Failure {
  const checked = checkSaved(input)
  if (!checked.ok) return fail(400, Object.values(checked.errors)[0] || 'Check the report.', { fields: checked.errors as Record<string, string> })
  return { ok: true, report: { id: '', ...checked.value, last_period: null, last_sent_at: null, created_at: '' } }
}

/** Creates or changes a saved report. Turning a schedule on records the current period as already covered, so nothing is sent at once. */
export async function saveReport(db: Db, shopId: string, actor: Actor, id: string | null, input: Record<string, unknown>, todayKey: string): Promise<{ ok: true; report: SavedReport } | Failure> {
  const checked = checkSaved(input)
  if (!checked.ok) return fail(400, Object.values(checked.errors)[0] || 'Check the report.', { fields: checked.errors as Record<string, string> })
  const v = checked.value
  const now = new Date().toISOString()
  const base: Row = { name: v.name, kind: v.kind, range: v.range, compare: v.compare, schedule: v.schedule, recipients: v.recipients, enabled: v.enabled, updated_by: actor.userId, updated_at: now }
  if (!id) {
    const row: Row = { ...base, shop_id: shopId, created_by: actor.userId, last_period: v.enabled ? periodToSkip(v.schedule, todayKey) : null }
    const { data, error } = await db.from('saved_reports').insert(row).select(SAVED_COLUMNS).maybeSingle()
    if (error) return failed(error, 'Saving the report')
    return { ok: true, report: savedFrom(data || row) }
  }
  const cur = await db.from('saved_reports').select(SAVED_COLUMNS).eq('id', id).eq('shop_id', shopId).maybeSingle()
  if (cur.error) return failed(cur.error, 'Saving the report')
  if (!cur.data) return fail(404, 'That report was not found. It may have been deleted.')
  const before = savedFrom(cur.data)
  // A schedule that was off (or a different one) and is now on starts with the next period.
  const turnedOn = v.enabled && v.schedule !== 'none' && (!before.enabled || before.schedule !== v.schedule)
  const patch: Row = { ...base, ...(turnedOn ? { last_period: periodToSkip(v.schedule, todayKey) } : {}) }
  const { data, error } = await db.from('saved_reports').update(patch).eq('id', id).eq('shop_id', shopId).select(SAVED_COLUMNS).maybeSingle()
  if (error) return failed(error, 'Saving the report')
  if (!data) return fail(404, 'That report was not found. It may have been deleted.')
  return { ok: true, report: savedFrom(data) }
}

/** The one-switch pause. */
export async function setEnabled(db: Db, shopId: string, actor: Actor, id: string, enabled: boolean, todayKey: string): Promise<{ ok: true; report: SavedReport } | Failure> {
  const cur = await db.from('saved_reports').select(SAVED_COLUMNS).eq('id', id).eq('shop_id', shopId).maybeSingle()
  if (cur.error) return failed(cur.error, 'Changing the report')
  if (!cur.data) return fail(404, 'That report was not found. It may have been deleted.')
  const before = savedFrom(cur.data)
  if (enabled && before.schedule === 'none') return fail(400, 'Choose weekly or monthly before turning this on.')
  if (enabled && before.recipients.length === 0) return fail(400, 'Add at least one email address before turning this on.')
  const patch: Row = { enabled, updated_by: actor.userId, updated_at: new Date().toISOString(), ...(enabled && !before.enabled ? { last_period: periodToSkip(before.schedule, todayKey) } : {}) }
  const { data, error } = await db.from('saved_reports').update(patch).eq('id', id).eq('shop_id', shopId).select(SAVED_COLUMNS).maybeSingle()
  if (error) return failed(error, 'Changing the report')
  return { ok: true, report: savedFrom(data || { ...cur.data, ...patch }) }
}

/** Deleting a saved report removes the definition only; the history of what was sent stays. */
export async function deleteReport(db: Db, shopId: string, id: string): Promise<{ ok: true } | Failure> {
  const { data, error } = await db.from('saved_reports').delete().eq('id', id).eq('shop_id', shopId).select('id')
  if (error) return failed(error, 'Deleting the report')
  if (!data || data.length === 0) return fail(404, 'That report was not found. It may already be deleted.')
  return { ok: true }
}

/* ---------- sending ---------- */

export interface Preview { to: string[]; subject: string; text: string; periodTitle: string; empty: boolean }

/** What would be sent, without sending: shown to the owner before a schedule is turned on or a report goes out. */
export async function previewSaved(db: Db, shopId: string, saved: SavedReport, now: Date, which?: 'send-now' | 'next-scheduled'): Promise<Preview> {
  const facts = await loadShopFacts(db, shopId)
  const todayKey = todayKeyIn(facts.timezone, now)
  const loaded = await loadForReports(db, shopId, now)
  // "Send now" and "Send me a test" cover the dates saved with the report; the schedule covers the week or month that just ended.
  // Each preview shows exactly the email its own button would send.
  const kind = which ?? (saved.schedule !== 'none' ? 'next-scheduled' : 'send-now')
  const period = kind === 'next-scheduled' && saved.schedule !== 'none' ? scheduledPeriodFor(saved, duePeriodAlways(saved, todayKey)) : manualPeriod(saved, todayKey)
  const built = buildReport(saved, period, todayKey, facts, loaded)
  return { to: saved.recipients, subject: built.subject, text: built.text, periodTitle: period.title, empty: loaded.docs.length === 0 }
}

/** The period a schedule would send for today, whether or not it was already sent (for a preview). */
function duePeriodAlways(saved: SavedReport, todayKey: string): DuePeriod {
  const due = duePeriod({ ...saved, enabled: true, last_period: null, recipients: saved.recipients.length ? saved.recipients : ['preview@example.com'] }, todayKey)
  if (!due) throw new Error('A schedule always has a period.')
  return due
}

export type SendOutcome =
  | { ok: true; status: 'sent'; sentTo: string[]; duplicate: false }
  | { ok: true; status: 'duplicate'; duplicate: true; earlier: SendLogEntry }
  | { ok: false; status: number; message: string; needsUpdate?: boolean; partial?: { sentTo: string[]; failedTo: string[] } }

const MAX_ATTEMPTS = 3
const STUCK_MS = 30 * 60 * 1000

/** Sends one report to a list of addresses, one at a time, and says exactly who it reached. */
async function deliver(send: Mailer, logId: string, to: string[], built: Built, replyTo: string): Promise<{ sentTo: string[]; failedTo: string[]; error: string }> {
  const sentTo: string[] = [], failedTo: string[] = []
  let error = ''
  for (const address of to) {
    try {
      await send({ to: address, subject: built.subject, html: built.html, text: built.text, replyTo: replyTo || undefined, idempotencyKey: `report:${logId}:${address.toLowerCase()}` })
      sentTo.push(address)
    } catch (e) {
      failedTo.push(address)
      error = e instanceof Error ? e.message.slice(0, 200) : 'The email could not be sent.'
    }
  }
  return { sentTo, failedTo, error }
}

const outcomeText = (r: { sentTo: string[]; failedTo: string[]; error: string }): string =>
  r.failedTo.length === 0 ? '' : `${r.sentTo.length ? `Sent to ${r.sentTo.join(', ')}. ` : ''}Could not send to ${r.failedTo.join(', ')}${r.error ? `: ${r.error}` : ''}`.slice(0, 480)

export interface SendDeps { db: Db; shopId: string; send: Mailer; now: Date; actor: Actor }

/**
 * A send the owner asked for: "Send now" to the saved recipients, or "Send me a test" to their own address.
 * `sendKey` is made by the screen when the sheet opens, so pressing Send twice sends once.
 */
export async function sendSaved(deps: SendDeps, saved: SavedReport, mode: 'manual' | 'test', sendKey: string): Promise<SendOutcome> {
  const { db, shopId, now, actor } = deps
  if (!sendKey || sendKey.length < 8 || sendKey.length > 80) return { ok: false, status: 400, message: 'The send could not be checked for repeats. Refresh and try again.' }
  const to = mode === 'test' ? (actor.email ? [actor.email] : []) : saved.recipients
  if (to.length === 0) return { ok: false, status: 400, message: mode === 'test' ? 'Your own email address is not available, so a test cannot be sent.' : 'Add at least one email address first.' }
  const facts = await loadShopFacts(db, shopId)
  const todayKey = todayKeyIn(facts.timezone, now)
  const loaded = await loadForReports(db, shopId, now)
  const built = buildReport(saved, manualPeriod(saved, todayKey), todayKey, facts, loaded)

  const claim = await db.from('report_send_log').insert({
    shop_id: shopId, saved_report_id: saved.id || null, report_name: saved.name, kind: saved.kind, trigger: mode, period_key: null, period_title: manualPeriod(saved, todayKey).title,
    recipients: to, subject: built.subject, status: 'claimed', send_key: `${mode}:${sendKey}`, created_by: actor.userId,
  }).select('id').maybeSingle()
  if (claim.error) {
    if (claim.error.code === '23505') {
      const prior = await db.from('report_send_log').select(LOG_COLUMNS).eq('shop_id', shopId).eq('send_key', `${mode}:${sendKey}`).maybeSingle()
      if (prior.data) return { ok: true, status: 'duplicate', duplicate: true, earlier: logFrom(prior.data) }
    }
    const f = failed(claim.error, 'Sending the report')
    return { ok: false, status: f.status, message: f.message, needsUpdate: f.needsUpdate }
  }
  const logId = str(claim.data?.id)
  const result = await deliver(deps.send, logId, to, built, facts.email)
  const ok = result.failedTo.length === 0
  await db.from('report_send_log').update({
    status: ok ? 'sent' : 'failed', error: outcomeText(result) || null, sent_at: result.sentTo.length ? new Date().toISOString() : null,
    recipients: ok ? to : result.failedTo,
  }).eq('id', logId).eq('shop_id', shopId)
  if (mode === 'manual' && result.sentTo.length && saved.id) {
    await db.from('saved_reports').update({ last_sent_at: new Date().toISOString() }).eq('id', saved.id).eq('shop_id', shopId)
  }
  if (!ok) return { ok: false, status: 502, message: outcomeText(result) || 'The email could not be sent.', partial: { sentTo: result.sentTo, failedTo: result.failedTo } }
  return { ok: true, status: 'sent', sentTo: result.sentTo, duplicate: false }
}

/* ---------- the scheduled run ---------- */

export interface ScheduledResult { id: string; name: string; action: 'sent' | 'skipped' | 'failed' | 'unknown' | 'retry-later'; detail: string }

/**
 * Sends every scheduled report that is due for this shop. Safe to run as often as the cron likes: each report and period is
 * claimed once in the database before anything is sent.
 */
export async function runScheduled(deps: { db: Db; shopId: string; send: Mailer; now: Date }): Promise<{ ok: true; results: ScheduledResult[] } | Failure> {
  const { db, shopId, now } = deps
  const list = await db.from('saved_reports').select(SAVED_COLUMNS).eq('shop_id', shopId).eq('enabled', true).neq('schedule', 'none').limit(200)
  if (list.error) {
    if (isMissingSchemaError(list.error)) return { ok: true, results: [] }
    return failed(list.error, 'Reading the scheduled reports')
  }
  const reports = (list.data || []).map(savedFrom)
  const results: ScheduledResult[] = []
  if (reports.length === 0) return { ok: true, results }

  const facts = await loadShopFacts(db, shopId)
  const todayKey = todayKeyIn(facts.timezone, now)
  let loaded: Loaded | null = null

  for (const saved of reports) {
    const due = duePeriod(saved, todayKey)
    if (!due) { results.push({ id: saved.id, name: saved.name, action: 'skipped', detail: 'Already sent for this period, or nothing is due.' }); continue }
    const claim = await db.from('report_send_log').insert({
      shop_id: shopId, saved_report_id: saved.id, report_name: saved.name, kind: saved.kind, trigger: 'schedule', period_key: due.key, period_title: due.title,
      recipients: saved.recipients, status: 'claimed', attempts: 1, created_by: null,
    }).select('id,attempts').maybeSingle()

    let logId = '', attempts = 1
    if (claim.error) {
      if (claim.error.code !== '23505') { results.push({ id: saved.id, name: saved.name, action: 'failed', detail: 'Could not record the send, so nothing was sent.' }); continue }
      // This period already has a row. Decide whether it is finished, stuck, or worth another try.
      const prior = await db.from('report_send_log').select('id,status,attempts,claimed_at,recipients').eq('shop_id', shopId).eq('saved_report_id', saved.id).eq('period_key', due.key).maybeSingle()
      if (!prior.data) { results.push({ id: saved.id, name: saved.name, action: 'skipped', detail: 'Another run is handling this period.' }); continue }
      const p = prior.data as Row
      const status = str(p.status), tries = Number(p.attempts) || 1
      if (status === 'sent') {
        await db.from('saved_reports').update({ last_period: due.key }).eq('id', saved.id).eq('shop_id', shopId)
        results.push({ id: saved.id, name: saved.name, action: 'skipped', detail: 'Already sent for this period.' }); continue
      }
      if (status === 'claimed') {
        const age = now.getTime() - new Date(str(p.claimed_at)).getTime()
        if (Number.isFinite(age) && age > STUCK_MS) {
          await db.from('report_send_log').update({ status: 'unknown', error: 'A send started and never reported back. It was not sent again, in case it already went out. Check your sent mail, then send it by hand if needed.' })
            .eq('id', str(p.id)).eq('shop_id', shopId).eq('status', 'claimed')
          results.push({ id: saved.id, name: saved.name, action: 'unknown', detail: 'A send started and never finished. It will not be sent again on its own.' })
        } else results.push({ id: saved.id, name: saved.name, action: 'skipped', detail: 'Another run is handling this period.' })
        continue
      }
      if (status === 'unknown') { results.push({ id: saved.id, name: saved.name, action: 'unknown', detail: 'A send started and never finished. It will not be sent again on its own.' }); continue }
      if (status === 'failed' && tries >= MAX_ATTEMPTS) { results.push({ id: saved.id, name: saved.name, action: 'failed', detail: `It failed ${tries} times, so it stopped trying. Check the addresses and send it by hand.` }); continue }
      // A failed try: take it back with a compare-and-set so two runs cannot both retry.
      const retake = await db.from('report_send_log').update({ status: 'claimed', attempts: tries + 1, claimed_at: now.toISOString() })
        .eq('id', str(p.id)).eq('shop_id', shopId).eq('status', 'failed').eq('attempts', tries).select('id,attempts').maybeSingle()
      if (!retake.data) { results.push({ id: saved.id, name: saved.name, action: 'skipped', detail: 'Another run is handling this period.' }); continue }
      logId = str(p.id); attempts = tries + 1
      // Only the addresses that did not get it last time.
      const left = Array.isArray(p.recipients) ? p.recipients.map(String).filter(Boolean) : []
      if (left.length) saved.recipients = left
    } else {
      logId = str(claim.data?.id)
    }

    try {
      loaded ||= await loadForReports(db, shopId, now)
      const built = buildReport(saved, scheduledPeriodFor(saved, due), todayKey, facts, loaded)
      await db.from('report_send_log').update({ subject: built.subject }).eq('id', logId).eq('shop_id', shopId)
      const result = await deliver(deps.send, logId, saved.recipients, built, facts.email)
      const ok = result.failedTo.length === 0
      await db.from('report_send_log').update({
        status: ok ? 'sent' : 'failed', error: outcomeText(result) || null, sent_at: result.sentTo.length ? now.toISOString() : null, recipients: ok ? saved.recipients : result.failedTo,
      }).eq('id', logId).eq('shop_id', shopId)
      if (ok) await db.from('saved_reports').update({ last_period: due.key, last_sent_at: now.toISOString() }).eq('id', saved.id).eq('shop_id', shopId)
      results.push({ id: saved.id, name: saved.name, action: ok ? 'sent' : 'failed', detail: ok ? `Sent to ${result.sentTo.length} ${result.sentTo.length === 1 ? 'person' : 'people'}.` : outcomeText(result) })
    } catch (e) {
      // Could not even build the report (the money could not be read). Nothing was sent; the try is recorded and can be retried.
      console.error('[reports] scheduled build:', e instanceof Error ? e.message : e)
      await db.from('report_send_log').update({ status: 'failed', error: 'The report could not be built, so nothing was sent.' }).eq('id', logId).eq('shop_id', shopId)
      results.push({ id: saved.id, name: saved.name, action: attempts >= MAX_ATTEMPTS ? 'failed' : 'retry-later', detail: 'The report could not be built, so nothing was sent. It will try again.' })
    }
  }
  return { ok: true, results }
}

