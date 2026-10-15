'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getShopId, supabase } from '@/lib/supabase'
import { calculateDocumentTotals, getLaborFlatAmount, laborLineTotal, partLineTotal, quantityFromUnknown, nonNegativeMoney } from '@/lib/document-money'
import { balanceFor, keyOf } from '@/lib/reports'
import type { ReportCall, ReportDoc, ReportJob, ReportPayment } from '@/lib/reports'

const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)
type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))

/** One source of data (documents, payments and so on) with its own loading and error state, so one failing never hides the rest. */
export interface Source<T> { rows: T[]; loaded: boolean; error: string }
const empty = <T,>(): Source<T> => ({ rows: [], loaded: false, error: '' })

/** A timestamp as the shop's calendar day; a plain date stays as it is. */
export const dayOfStamp = (v: unknown): string => {
  const s = str(v)
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  return isNaN(d.getTime()) ? '' : keyOf(d)
}

/**
 * Every row of a shop's table, newest first. Pages are cut by the sort value and the id together, so a row added while a
 * later page is loading can neither be skipped nor come back twice.
 */
async function allRows(table: string, select: string, shopId: string, order: string, snapshot: string, extra?: (q: ReturnType<typeof base>) => ReturnType<typeof base>, size = 1000): Promise<Row[]> {
  const out: Row[] = []
  let cursor: { value: string; id: string } | null = null
  for (;;) {
    let q = extra ? extra(base(table, select, shopId)) : base(table, select, shopId)
    q = q.lte(order, snapshot).order(order, { ascending: false }).order('id', { ascending: false })
    if (cursor) q = q.or(`${order}.lt.${cursor.value},and(${order}.eq.${cursor.value},id.lt.${cursor.id})`)
    const { data, error } = await q.range(0, size - 1)
    if (error) throw new Error(error.message)
    const page = (data || []) as unknown as Row[]
    out.push(...page)
    if (page.length < size) return out
    const last = page[page.length - 1]
    if (last[order] == null || last.id == null) throw new Error('A report row is missing its place in the list.')
    cursor = { value: str(last[order]), id: str(last.id) }
  }
}
const base = (table: string, select: string, shopId: string) => supabase.from(table).select(select).eq('shop_id', shopId)

const DOC_COLUMNS = 'id,type,doc_number,status,doc_date,created_at,customer_id,customer_name,parts,labors,shop_supplies,sublet,tax_rate,apply_tax,amount_paid,payment_method'

export function docFrom(raw: Row): ReportDoc {
  const t = calculateDocumentTotals(raw)
  const labors = (Array.isArray(raw.labors) ? raw.labors : []).filter((l): l is Row => !!l && typeof l === 'object')
  const parts = (Array.isArray(raw.parts) ? raw.parts : []).filter((l): l is Row => !!l && typeof l === 'object')
  const ops = labors.map(l => ({ name: str(l.operation ?? l.description ?? l.name).trim(), amount: laborLineTotal(l) })).filter(o => o.name || o.amount > 0)
  const hours = labors.filter(l => str(l.tech).trim()).map(l => ({
    tech: str(l.tech).trim(),
    // Only lines priced by the hour have hours to count. A flat-priced line still counts as money.
    hours: getLaborFlatAmount(l) === null ? quantityFromUnknown(l.hours, 0) : 0,
    amount: laborLineTotal(l),
  }))
  const items = parts.map(p => ({ name: str(p.name).trim(), qty: quantityFromUnknown(p.qty, 1), amount: partLineTotal(p), cost: Math.round(nonNegativeMoney(p.cost) * quantityFromUnknown(p.qty, 1) * 100) / 100 })).filter(i => i.name)
  const status = str(raw.status)
  return {
    id: str(raw.id), type: str(raw.type), number: str(raw.doc_number).trim(), status,
    date: dayOfStamp(raw.doc_date) || dayOfStamp(raw.created_at),
    customerId: raw.customer_id ? str(raw.customer_id) : null, customer: str(raw.customer_name).trim(),
    total: t.total, labor: t.laborTotal, parts: t.partsTotal, fees: Math.round((t.shopSupplies + t.sublet + t.coreTotal) * 100) / 100, tax: t.taxAmount,
    paid: t.amountPaid, balance: balanceFor(status, t.balanceDue), method: str(raw.payment_method),
    ops, items, hours,
  }
}

const paymentFrom = (r: Row, names: Map<string, string>): ReportPayment => ({
  id: str(r.id), docId: r.document_id ? str(r.document_id) : null, amount: Math.max(0, Number(r.amount) || 0),
  method: str(r.method), date: dayOfStamp(r.paid_at) || dayOfStamp(r.created_at), customer: names.get(str(r.document_id)) || '',
})
const jobFrom = (r: Row): ReportJob => ({ id: str(r.id), status: str(r.status), tech: str(r.tech).trim(), date: dayOfStamp(r.created_at), customer: str(r.customer_name).trim() })
const callFrom = (r: Row): ReportCall => ({ id: str(r.id), direction: str(r.direction).toLowerCase(), seconds: Math.max(0, Number(r.duration_secs) || 0), start: str(r.start_time) })

/**
 * Everything the Reports screen reads. Documents, payments, jobs and calls load side by side and each reports on its own,
 * so a calls problem never hides the money. `reload` fetches everything again.
 */
export function useReportData() {
  const [docs, setDocs] = useState<Source<ReportDoc>>(empty)
  const [payments, setPayments] = useState<Source<ReportPayment>>(empty)
  const [jobs, setJobs] = useState<Source<ReportJob>>(empty)
  const [calls, setCalls] = useState<Source<ReportCall>>(empty)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const mine = ++seq.current
    const fresh = () => mine === seq.current
    let shopId: string | null = null
    try { shopId = await getShopId() } catch { shopId = null }
    if (!shopId) {
      const err = 'We could not find your shop. Refresh, or sign out and back in.'
      if (fresh()) {
        setDocs({ rows: [], loaded: true, error: err }); setPayments({ rows: [], loaded: true, error: err })
        setJobs({ rows: [], loaded: true, error: err }); setCalls({ rows: [], loaded: true, error: err })
      }
      return
    }
    const sid = shopId
    // One shared cutoff, so rows added while later pages load do not shift the pages.
    const snapshot = new Date().toISOString()
    // Calls and jobs older than last year's start are never compared, so they are not downloaded.
    const since = `${new Date().getFullYear() - 1}-01-01T00:00:00`

    const names = new Map<string, string>()
    const guard = async <T,>(set: (s: Source<T>) => void, work: () => Promise<T[]>, fallback: string) => {
      try { const rows = await work(); if (fresh()) set({ rows, loaded: true, error: '' }) }
      catch (e) { if (fresh()) set({ rows: [], loaded: true, error: errText(e, fallback) }) }
    }

    const docsDone = guard(setDocs, async () => {
      const raw = await allRows('documents', DOC_COLUMNS, sid, 'created_at', snapshot, q => q.in('type', ['Invoice', 'Receipt']))
      const rows = raw.map(docFrom)
      for (const d of rows) names.set(d.id, d.customer)
      return rows
    }, 'Invoices did not load. Check your connection and try again.')
    const payDone = guard(setPayments, async () => (await allRows('payments', 'id,document_id,amount,method,paid_at,created_at', sid, 'created_at', snapshot)).map(r => paymentFrom(r, names)), 'Payments did not load. Check your connection and try again.')
    await Promise.all([
      docsDone,
      payDone.then(async () => {
        // Names come from the invoices; fill them in once both are here.
        await docsDone
        if (fresh()) setPayments(p => ({ ...p, rows: p.rows.map(x => (x.customer || !x.docId ? x : { ...x, customer: names.get(x.docId) || '' })) }))
      }),
      guard(setJobs, async () => (await allRows('jobs', 'id,status,tech,customer_name,created_at', sid, 'created_at', snapshot)).map(jobFrom), 'Jobs did not load. Check your connection and try again.'),
      guard(setCalls, async () => (await allRows('call_history', 'id,direction,duration_secs,start_time', sid, 'start_time', snapshot, q => q.gte('start_time', since))).map(callFrom), 'Calls did not load. Check your connection and try again.'),
    ])
  }, [])

  useEffect(() => {
    void load()
    // Leaving the screen retires any load still in flight, so it cannot set state afterwards.
    const stop = () => { seq.current += 1 }
    return stop
  }, [load])

  return { docs, payments, jobs, calls, reload: load }
}
