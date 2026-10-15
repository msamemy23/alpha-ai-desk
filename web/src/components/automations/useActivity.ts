'use client'
import { useCallback, useEffect, useState } from 'react'
import { getShopId, supabase } from '@/lib/supabase'
import type { Row } from '@/lib/automation-text'

export interface Sent {
  id: string
  at: string
  /** Which automation did it, in words. */
  what: string
  who: string
  ok: boolean
  /** The words that were sent, when they were saved. */
  words: string
  /** Why it did not send, when it did not. */
  why: string
}

const DAYS = 30
const LIMIT = 40
const SOURCES = ['review requests', 'win-back texts', 'oil change reminders', 'estimate follow-ups', 'appointment reminders'] as const

/** What the automations that keep a record sent in the last 30 days. A source that cannot be read is named, not hidden. */
export function useActivity() {
  const [items, setItems] = useState<Sent[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [missing, setMissing] = useState<string[]>([])

  const load = useCallback(async () => {
    setState(s => (s === 'ready' ? s : 'loading'))
    try {
      const shopId = await getShopId()
      if (!shopId) throw new Error('No shop')
      const since = new Date(Date.now() - DAYS * 86_400_000).toISOString()
      const q = (table: string, cols: string, col = 'created_at') => supabase.from(table).select(cols).eq('shop_id', shopId).gte(col, since).order(col, { ascending: false }).limit(LIMIT)
      const apptQ = supabase.from('appointments').select('id,customer_name,service,date,time,reminder_sent_at').eq('shop_id', shopId).not('reminder_sent_at', 'is', null).gte('reminder_sent_at', since).order('reminder_sent_at', { ascending: false }).limit(LIMIT)
      const done = await Promise.allSettled([
        q('growth_review_requests', 'id,customer_name,sent,error,created_at'),
        q('growth_followups', 'id,customer_name,message,sent,error,created_at'),
        q('service_reminders_sent', 'id,customer_id,message,sent,created_at'),
        q('estimate_followups_sent', 'id,customer_id,method,sent,created_at'),
        apptQ,
      ])
      const rows = done.map(r => (r.status === 'fulfilled' && !r.value.error ? ((r.value.data || []) as unknown as Row[]) : null))
      const bad = SOURCES.filter((_, i) => rows[i] === null)
      if (bad.length === SOURCES.length) throw new Error('none')

      // The two logs that only know a customer id need their names.
      const ids = [...new Set([...(rows[2] || []), ...(rows[3] || [])].map(r => r.customer_id).filter(Boolean))].map(String)
      const names = new Map<string, string>()
      if (ids.length) {
        const { data } = await supabase.from('customers').select('id,name').eq('shop_id', shopId).in('id', ids)
        for (const c of data || []) names.set(String(c.id), String(c.name || ''))
      }

      const out: Sent[] = []
      for (const r of rows[0] || []) out.push({ id: `rr-${r.id}`, at: r.created_at, what: 'Review request', who: String(r.customer_name || 'Customer'), ok: r.sent === true, words: '', why: String(r.error || '') })
      for (const r of rows[1] || []) out.push({ id: `wb-${r.id}`, at: r.created_at, what: 'Win-back text', who: String(r.customer_name || 'Customer'), ok: r.sent === true, words: String(r.message || ''), why: String(r.error || '') })
      for (const r of rows[2] || []) out.push({ id: `sr-${r.id}`, at: r.created_at, what: 'Oil change reminder', who: names.get(String(r.customer_id)) || 'Customer', ok: r.sent === true, words: String(r.message || ''), why: '' })
      for (const r of rows[3] || []) out.push({ id: `ef-${r.id}`, at: r.created_at, what: r.method === 'email' ? 'Estimate follow-up by email' : 'Estimate follow-up by text', who: names.get(String(r.customer_id)) || 'Customer', ok: r.sent === true, words: '', why: '' })
      for (const r of rows[4] || []) out.push({ id: `ar-${r.id}`, at: r.reminder_sent_at, what: 'Appointment reminder', who: String(r.customer_name || 'Customer'), ok: true, words: [r.service, r.date ? `on ${r.date}` : '', r.time ? `at ${r.time}` : ''].filter(Boolean).join(' '), why: '' })
      out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      setItems(out)
      setMissing(bad)
      setState('ready')
    } catch {
      setState(s => (s === 'ready' ? s : 'error'))
    }
  }, [])
  useEffect(() => { void load() }, [load])

  return { items, state, missing, reload: load }
}
