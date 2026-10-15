// The promotions table, read and written with the service client. Every query is filtered by the shop.

import type { SupabaseClient } from '@supabase/supabase-js'
import { NeedsDatabaseUpdate, isMissing } from '@/lib/automation-store'
import { emptyCounts, type CampaignCounts, type PromotionRow, type PromotionStore } from '@/lib/growth-promotions'

type Row = Record<string, any>

const throwIf = (error: { code?: string; message?: string } | null) => {
  if (!error) return
  if (isMissing(error)) throw new NeedsDatabaseUpdate('promotions')
  throw new Error(error.message || 'The promotion could not be saved.')
}

function addCount(into: CampaignCounts, status: string, delivery: string | null, n: number, next: string | null) {
  if (status === 'queued') {
    into.queued += n
    if (next && (!into.next_send_after || next < into.next_send_after)) into.next_send_after = next
  } else if (status === 'sending') into.sending += n
  else if (status === 'sent') {
    into.sent += n
    if (delivery === 'delivered') into.delivered += n
    else if (delivery === 'undelivered' || delivery === 'failed') into.undelivered += n
  } else if (status === 'failed') into.failed += n
  else if (status === 'unknown') into.unknown += n
  else if (status === 'skipped') into.skipped += n
  else if (status === 'cancelled') into.cancelled += n
}

export function createPromotionStore(db: SupabaseClient): PromotionStore {
  return {
    async list(shopId) {
      const { data, error } = await db.from('growth_promotions').select('*').eq('shop_id', shopId).order('created_at', { ascending: false }).limit(100)
      throwIf(error)
      return (data || []) as PromotionRow[]
    },

    async get(shopId, id) {
      const { data, error } = await db.from('growth_promotions').select('*').eq('shop_id', shopId).eq('id', id).maybeSingle()
      throwIf(error)
      return (data as PromotionRow | null) ?? null
    },

    async insert(row) {
      const { data, error } = await db.from('growth_promotions').insert(row).select('*').single()
      throwIf(error)
      return data as PromotionRow
    },

    async update(shopId, id, patch, from) {
      let q = db.from('growth_promotions').update({ ...patch, updated_at: new Date().toISOString() }).eq('shop_id', shopId).eq('id', id)
      if (from?.length) q = q.in('status', from)
      const { data, error } = await q.select('*').maybeSingle()
      throwIf(error)
      return (data as PromotionRow | null) ?? null
    },

    async remove(shopId, id) {
      const { data, error } = await db.from('growth_promotions').delete().eq('shop_id', shopId).eq('id', id).eq('status', 'draft').select('id').maybeSingle()
      throwIf(error)
      return Boolean(data)
    },

    async counts(shopId, ids) {
      const out: Record<string, CampaignCounts> = {}
      for (const id of ids) out[id] = emptyCounts()
      if (!ids.length) return out
      const rpc = await db.rpc('growth_campaign_counts', { p_shop_id: shopId, p_ids: ids })
      if (!rpc.error) {
        for (const r of (rpc.data || []) as Row[]) {
          const c = out[String(r.campaign_id)]
          if (c) addCount(c, String(r.status), r.delivery_status ?? null, Number(r.n) || 0, r.next_send_after ?? null)
        }
        return out
      }
      // The counting function is not there (older database): count the messages directly, a page at a time.
      for (let from = 0; from < 20_000; from += 1000) {
        const { data, error } = await db.from('automation_messages').select('campaign_id,status,delivery_status,send_after').eq('shop_id', shopId).eq('is_test', false).in('campaign_id', ids).range(from, from + 999)
        if (error) { if (isMissing(error)) return out; throw new Error(error.message) }
        for (const r of (data || []) as Row[]) {
          const c = out[String(r.campaign_id)]
          if (c) addCount(c, String(r.status), r.delivery_status ?? null, 1, r.send_after ?? null)
        }
        if (!data || data.length < 1000) break
      }
      return out
    },
  }
}
