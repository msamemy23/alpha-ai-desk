'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getShopId, supabase } from '@/lib/supabase'
import { LIST_NEW, LIST_OLD, listRowFrom, rowFrom } from './types'
import type { DviListRow, DviRow } from './types'

const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)
// 42703 is Postgres saying a column does not exist: migration 036 has not been applied yet.
const noColumn = (e: { code?: string; message?: string } | null) => Boolean(e) && (e?.code === '42703' || /column .* does not exist|schema cache/i.test(e?.message || ''))

/** The list of inspections, kept fresh. `enabled` is false while one is open for editing so its own saves do not reload the list. */
export function useDviList(enabled: boolean) {
  const [rows, setRows] = useState<DviListRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  const [migrated, setMigrated] = useState(false)
  const seq = useRef(0)
  const migratedRef = useRef<boolean | null>(null)

  const load = useCallback(async () => {
    const mine = ++seq.current
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('We could not find your shop. Refresh, or sign out and back in.')
      const ask = (cols: string) => supabase.from('dvi').select(cols).eq('shop_id', shopId).order('created_at', { ascending: false }).limit(300)
      let res = await ask(migratedRef.current === false ? LIST_OLD : LIST_NEW)
      if (res.error && noColumn(res.error) && migratedRef.current !== false) { migratedRef.current = false; res = await ask(LIST_OLD) }
      else if (!res.error && migratedRef.current === null) migratedRef.current = true
      if (res.error) throw res.error
      if (mine !== seq.current) return
      setRows(((res.data || []) as unknown as Record<string, unknown>[]).map(listRowFrom))
      setMigrated(migratedRef.current === true)
      setError('')
    } catch (e) {
      if (mine !== seq.current) return
      setError(errText(e, 'Check your connection and try again.'))
    } finally {
      if (mine === seq.current) setLoaded(true)
    }
  }, [])

  useEffect(() => {
    if (!enabled) return
    void load()
    const back = () => { if (document.visibilityState === 'visible') void load() }
    const poll = setInterval(back, 60_000)
    document.addEventListener('visibilitychange', back)
    window.addEventListener('focus', back)
    const channel = supabase.channel('dvi_list').on('postgres_changes', { event: '*', schema: 'public', table: 'dvi' }, () => { void load() }).subscribe()
    return () => {
      clearInterval(poll)
      document.removeEventListener('visibilitychange', back)
      window.removeEventListener('focus', back)
      supabase.removeChannel(channel)
    }
  }, [enabled, load])

  return { rows, loading: !loaded, error, migrated, reload: load }
}

/** Load one whole inspection (with its photos). */
export async function loadInspection(id: string): Promise<{ row?: DviRow; error?: string; notFound?: boolean }> {
  try {
    const shopId = await getShopId()
    if (!shopId) return { error: 'We could not find your shop. Refresh, or sign out and back in.' }
    const { data, error } = await supabase.from('dvi').select('*').eq('id', id).eq('shop_id', shopId).maybeSingle()
    if (error) throw error
    if (!data) return { error: 'That inspection could not be found. It may have been deleted.', notFound: true }
    return { row: rowFrom(data as Record<string, unknown>) }
  } catch (e) {
    return { error: errText(e, 'The inspection did not load. Check your connection and try again.') }
  }
}

/** Just the customer's side of one inspection, so an open inspection can notice an answer without reloading its photos. */
export async function loadAnswers(id: string): Promise<Partial<DviRow> | null> {
  try {
    const shopId = await getShopId()
    if (!shopId) return null
    const { data, error } = await supabase.from('dvi').select('sent_to_customer,sent_at,customer_approved,customer_decisions,customer_decided_at,viewed_at,share_token').eq('id', id).eq('shop_id', shopId).maybeSingle()
    if (error || !data) return null
    const r = data as Record<string, unknown>
    const dec = r.customer_decisions && typeof r.customer_decisions === 'object' && !Array.isArray(r.customer_decisions) ? (r.customer_decisions as DviRow['customer_decisions']) : {}
    return {
      sent_to_customer: r.sent_to_customer === true, sent_at: typeof r.sent_at === 'string' ? r.sent_at : null, customer_approved: r.customer_approved === true,
      customer_decisions: dec, customer_decided_at: typeof r.customer_decided_at === 'string' ? r.customer_decided_at : null,
      viewed_at: typeof r.viewed_at === 'string' ? r.viewed_at : null, has_link: typeof r.share_token === 'string' && r.share_token.length > 0,
    }
  } catch { return null }
}
