// The review_replies table, read and written with the service client. Every query is filtered by the shop.

import type { SupabaseClient } from '@supabase/supabase-js'
import { NeedsDatabaseUpdate, isMissing } from '@/lib/automation-store'
import type { ReplyRow, ReplyStore } from '@/lib/review-replies'

const throwIf = (error: { code?: string; message?: string } | null) => {
  if (!error) return
  if (isMissing(error)) throw new NeedsDatabaseUpdate('review replies')
  throw new Error(error.message || 'The reply could not be saved.')
}

export function createReplyStore(db: SupabaseClient): ReplyStore {
  return {
    async list(shopId) {
      const { data, error } = await db.from('review_replies').select('*').eq('shop_id', shopId).order('created_at', { ascending: false }).limit(100)
      throwIf(error)
      return (data || []) as ReplyRow[]
    },
    async get(shopId, id) {
      const { data, error } = await db.from('review_replies').select('*').eq('shop_id', shopId).eq('id', id).maybeSingle()
      throwIf(error)
      return (data as ReplyRow | null) ?? null
    },
    async insert(row) {
      const { data, error } = await db.from('review_replies').insert(row).select('*').single()
      throwIf(error)
      return data as ReplyRow
    },
    async update(shopId, id, patch, from) {
      const { data, error } = await db.from('review_replies').update({ ...patch, updated_at: new Date().toISOString() }).eq('shop_id', shopId).eq('id', id).in('status', from).select('*').maybeSingle()
      throwIf(error)
      return (data as ReplyRow | null) ?? null
    },
  }
}
