/**
 * Reads the shop's paperwork, payments, jobs and calls for the reports. The Reports screen (signed in, in the browser) and the
 * scheduled emails (on the server) both call these, so an emailed number is built from exactly what the screen shows.
 *
 * Everything here only reads. Rows are fetched a page at a time, cut by the sort value and the id together, so a row added
 * while later pages load can neither be skipped nor come back twice.
 */
import type { Db, Query, Row } from './db-types.ts'
import { DOC_COLUMNS, DOC_COLUMNS_EXTRA, dayOfStamp, docFrom, isMissingSchemaError } from './report-docs.ts'
import type { ReportCall, ReportDoc, ReportJob, ReportPayment } from './reports.ts'

const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))

export async function allRows(
  db: Db, table: string, select: string, shopId: string, order: string, snapshot: string,
  extra?: (q: Query) => Query, size = 1000,
): Promise<Row[]> {
  const out: Row[] = []
  let cursor: { value: string; id: string } | null = null
  for (;;) {
    const start = db.from(table).select(select).eq('shop_id', shopId)
    let q = extra ? extra(start) : start
    q = q.lte(order, snapshot).order(order, { ascending: false }).order('id', { ascending: false })
    if (cursor) q = q.or(`${order}.lt.${cursor.value},and(${order}.eq.${cursor.value},id.lt.${cursor.id})`)
    const { data, error } = await q.range(0, size - 1)
    if (error) throw Object.assign(new Error(error.message || 'The database could not be read.'), { code: error.code })
    const page = (data || []) as Row[]
    out.push(...page)
    if (page.length < size) return out
    const last = page[page.length - 1]
    if (last[order] == null || last.id == null) throw new Error('A report row is missing its place in the list.')
    cursor = { value: str(last[order]), id: str(last.id) }
  }
}

export interface DocLoad {
  docs: ReportDoc[]
  /** False when this database predates the advisor, car and approval columns, so reports that need them say so. */
  extended: boolean
}

/**
 * Invoices and receipts, plus estimates that were sent for online approval (needed for the approval rate; reports that add up
 * sales ignore them). Asks for the extra columns first and quietly retries without them on a database that lacks any.
 */
export async function loadDocs(db: Db, shopId: string, snapshot: string): Promise<DocLoad> {
  const sales = (q: Query) => q.in('type', ['Invoice', 'Receipt'])
  let raw: Row[]
  let extended = true
  try {
    raw = await allRows(db, 'documents', DOC_COLUMNS_EXTRA, shopId, 'created_at', snapshot, sales)
  } catch (e) {
    if (!isMissingSchemaError(e)) throw e
    extended = false
    raw = await allRows(db, 'documents', DOC_COLUMNS, shopId, 'created_at', snapshot, sales)
  }
  const docs = raw.map(docFrom)
  if (extended) {
    try {
      const sent = await allRows(db, 'documents', DOC_COLUMNS_EXTRA, shopId, 'created_at', snapshot, q => q.eq('type', 'Estimate').not('signature_requested_at', 'is', null))
      docs.push(...sent.map(docFrom))
    } catch (e) {
      if (!isMissingSchemaError(e)) throw e
      extended = false
    }
  }
  return { docs, extended }
}

export const paymentFrom = (r: Row, names: Map<string, string>): ReportPayment => ({
  id: str(r.id), docId: r.document_id ? str(r.document_id) : null, amount: Math.max(0, Number(r.amount) || 0),
  method: str(r.method), date: dayOfStamp(r.paid_at) || dayOfStamp(r.created_at), customer: names.get(str(r.document_id)) || '',
})

export async function loadPayments(db: Db, shopId: string, snapshot: string, docs: ReportDoc[]): Promise<ReportPayment[]> {
  const names = new Map(docs.map(d => [d.id, d.customer]))
  const raw = await allRows(db, 'payments', 'id,document_id,amount,method,paid_at,created_at', shopId, 'created_at', snapshot)
  return raw.map(r => paymentFrom(r, names))
}

export const jobFrom = (r: Row): ReportJob => ({ id: str(r.id), status: str(r.status), tech: str(r.tech).trim(), date: dayOfStamp(r.created_at), customer: str(r.customer_name).trim() })
export const loadJobs = async (db: Db, shopId: string, snapshot: string): Promise<ReportJob[]> =>
  (await allRows(db, 'jobs', 'id,status,tech,customer_name,created_at', shopId, 'created_at', snapshot)).map(jobFrom)

export const callFrom = (r: Row): ReportCall => ({
  id: str(r.id), direction: str(r.direction).toLowerCase(), seconds: Math.max(0, Number(r.duration_secs) || 0), start: str(r.start_time),
  callId: r.call_id ? str(r.call_id) : undefined, status: r.status ? str(r.status).toLowerCase() : undefined,
})

/** Calls older than last year's start are never compared, so they are not downloaded. */
export async function loadCalls(db: Db, shopId: string, snapshot: string, since: string): Promise<ReportCall[]> {
  const columns = 'id,call_id,direction,duration_secs,start_time,status'
  let raw: Row[]
  try {
    raw = await allRows(db, 'call_history', columns, shopId, 'start_time', snapshot, q => q.gte('start_time', since))
  } catch (e) {
    if (!isMissingSchemaError(e)) throw e
    raw = await allRows(db, 'call_history', 'id,direction,duration_secs,start_time', shopId, 'start_time', snapshot, q => q.gte('start_time', since))
  }
  return raw.map(callFrom)
}

/* ---------- calls the AI assistant answered ---------- */

export interface AiCall { id: string; start: string; inbound: boolean; status: string }

/** The AI assistant's log keeps the start time as milliseconds (sometimes seconds, sometimes text). */
export function aiCallFrom(r: Row): AiCall | null {
  const raw = r.started_at
  const ms = typeof raw === 'number' ? (raw < 1e12 ? raw * 1000 : raw) : Date.parse(str(raw))
  if (!Number.isFinite(ms)) return null
  return { id: str(r.id), start: new Date(ms).toISOString(), inbound: str(r.task).includes('Inbound call from'), status: str(r.status).toLowerCase() }
}

/** The AI log has no created_at to page by, so it is read newest first up to a ceiling the screen states. */
export async function loadAiCalls(db: Db, shopId: string, limit = 2000): Promise<AiCall[]> {
  const { data, error } = await db.from('ai_calls').select('id,task,status,started_at').eq('shop_id', shopId).order('started_at', { ascending: false }).limit(limit)
  if (error) throw Object.assign(new Error(error.message || 'The AI call log could not be read.'), { code: error.code })
  return ((data || []) as Row[]).map(aiCallFrom).filter((c): c is AiCall => c !== null)
}
