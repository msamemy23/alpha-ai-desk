'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getShopId, supabase } from '@/lib/supabase'
import type { Db } from '@/lib/db-types'
import { dayOfStamp, docFrom } from '@/lib/report-docs'
import { loadAiCalls, loadCalls, loadDocs, loadJobs, loadPayments } from '@/lib/report-load'
import type { AiCall } from '@/lib/report-load'
import type { ReportCall, ReportDoc, ReportJob, ReportPayment } from '@/lib/reports'

export { dayOfStamp, docFrom }

const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)

/** One source of data (documents, payments and so on) with its own loading and error state, so one failing never hides the rest. */
export interface Source<T> { rows: T[]; loaded: boolean; error: string }
const empty = <T,>(): Source<T> => ({ rows: [], loaded: false, error: '' })

/** What the reports need to know about the shop itself, read from its settings. */
export interface ShopInfo { name: string; phone: string; postedRate: number | null; timezone: string }
const NO_SHOP: ShopInfo = { name: '', phone: '', postedRate: null, timezone: '' }

/**
 * Everything the Reports screen reads. Documents, payments, jobs and calls load side by side and each reports on its own,
 * so a calls problem never hides the money. The same loaders feed the scheduled emails, so a number on the screen and in
 * an email come from the same code. `reload` fetches everything again. Nothing here writes.
 */
export function useReportData() {
  const [docs, setDocs] = useState<Source<ReportDoc>>(empty)
  /** False when this database predates the advisor, car and approval columns. */
  const [extended, setExtended] = useState(true)
  const [payments, setPayments] = useState<Source<ReportPayment>>(empty)
  const [jobs, setJobs] = useState<Source<ReportJob>>(empty)
  const [calls, setCalls] = useState<Source<ReportCall>>(empty)
  const [aiCalls, setAiCalls] = useState<Source<AiCall>>(empty)
  const [shop, setShop] = useState<ShopInfo>(NO_SHOP)
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
        setJobs({ rows: [], loaded: true, error: err }); setCalls({ rows: [], loaded: true, error: err }); setAiCalls({ rows: [], loaded: true, error: err })
      }
      return
    }
    const sid = shopId
    const db = supabase as unknown as Db
    // One shared cutoff, so rows added while later pages load do not shift the pages.
    const snapshot = new Date().toISOString()
    // Calls older than last year's start are never compared, so they are not downloaded.
    const since = `${new Date().getFullYear() - 1}-01-01T00:00:00`

    const guard = async <T,>(set: (s: Source<T>) => void, work: () => Promise<T[]>, fallback: string) => {
      try { const rows = await work(); if (fresh()) set({ rows, loaded: true, error: '' }) }
      catch (e) { if (fresh()) set({ rows: [], loaded: true, error: errText(e, fallback) }) }
    }

    const docsDone = (async () => {
      try {
        const out = await loadDocs(db, sid, snapshot)
        if (fresh()) { setDocs({ rows: out.docs, loaded: true, error: '' }); setExtended(out.extended) }
        return out.docs
      } catch (e) {
        if (fresh()) setDocs({ rows: [], loaded: true, error: errText(e, 'Invoices did not load. Check your connection and try again.') })
        return null
      }
    })()

    await Promise.all([
      docsDone,
      // Payments take customer names from the invoices, so they wait for them. A failed invoice load means no names, not no payments.
      docsDone.then(rows => guard(setPayments, () => loadPayments(db, sid, snapshot, rows || []), 'Payments did not load. Check your connection and try again.')),
      guard(setJobs, () => loadJobs(db, sid, snapshot), 'Jobs did not load. Check your connection and try again.'),
      guard(setCalls, () => loadCalls(db, sid, snapshot, since), 'Calls did not load. Check your connection and try again.'),
      // The AI assistant's own log is optional: without it the calls tab says who answered is unknown.
      guard(setAiCalls, () => loadAiCalls(db, sid), 'The AI assistant call log did not load.'),
      (async () => {
        try {
          let r = await supabase.from('settings').select('shop_name,shop_phone,labor_rate,timezone').eq('shop_id', sid).maybeSingle()
          if (r.error) r = await supabase.from('settings').select('shop_name,shop_phone,labor_rate').eq('shop_id', sid).maybeSingle()
          const d = (r.data || {}) as Record<string, unknown>
          const rate = Number(d.labor_rate)
          if (fresh()) setShop({ name: String(d.shop_name ?? '').trim(), phone: String(d.shop_phone ?? '').trim(), postedRate: rate > 0 ? rate : null, timezone: String(d.timezone ?? '').trim() })
        } catch { if (fresh()) setShop(NO_SHOP) }
      })(),
    ])
  }, [])

  useEffect(() => {
    void load()
    // Leaving the screen retires any load still in flight, so it cannot set state afterwards.
    const stop = () => { seq.current += 1 }
    return stop
  }, [load])

  return { docs, extended, payments, jobs, calls, aiCalls, shop, reload: load }
}
