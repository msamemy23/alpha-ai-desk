// The three repair-post tables, read and written with the service client. Every query is filtered by the shop.
// A missing table raises NeedsDatabaseUpdate so the route can say so in plain words instead of failing.

import type { SupabaseClient } from '@supabase/supabase-js'
import { NeedsDatabaseUpdate, isMissing } from '@/lib/automation-store'
import { DuplicateOpenItem } from '@/lib/posts-engine'
import type { NewItem, PostStore } from '@/lib/posts-engine'
import { DEFAULT_POST_SETTINGS, cleanPlatforms, cleanSettings } from '@/lib/posts-rules'
import type { PostSettings, QueueRow } from '@/lib/posts-rules'

type DbError = { code?: string; message?: string } | null

const WHAT = 'repair posts'

function throwIf(error: DbError): void {
  if (!error) return
  if (isMissing(error)) throw new NeedsDatabaseUpdate(WHAT)
  throw new Error(error.message || 'The post could not be saved.')
}

const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : [])

/** A row from the database, with every list and object defaulted so the rest of the code never meets a null. */
export function normalizeRow(r: Record<string, unknown>): QueueRow {
  return {
    ...(r as unknown as QueueRow),
    facts: r.facts && typeof r.facts === 'object' ? (r.facts as QueueRow['facts']) : null,
    photos: arr(r.photos),
    platforms: cleanPlatforms(r.platforms),
    flags: arr<string>(r.flags).filter(x => typeof x === 'string'),
    results: arr(r.results),
    metrics: (r.metrics && typeof r.metrics === 'object' && !Array.isArray(r.metrics) ? r.metrics : {}) as QueueRow['metrics'],
    caption: typeof r.caption === 'string' ? r.caption : '',
    attempt: Number(r.attempt) || 0,
  }
}

/** The customer's yes, the photos the owner checked ahead of time, and "how did you hear about us" for one job. */
export interface ClearedPhoto { ref: string; path: string; covered: boolean; label: string; by: string | null; at: string }

export interface JobInfo {
  job_id: string
  customer_ok: boolean
  ok_note: string
  ok_at: string | null
  heard_from: string
  cleared: ClearedPhoto[]
  updated_at: string | null
}

const cleanCleared = (v: unknown): ClearedPhoto[] => arr<Record<string, unknown>>(v)
  .filter(x => x && typeof x.ref === 'string' && typeof x.path === 'string')
  .map(x => ({ ref: String(x.ref), path: String(x.path), covered: x.covered === true, label: typeof x.label === 'string' ? x.label : '', by: typeof x.by === 'string' ? x.by : null, at: typeof x.at === 'string' ? x.at : '' }))

const toInfo = (r: Record<string, unknown>): JobInfo => ({
  job_id: String(r.job_id),
  customer_ok: r.customer_ok === true,
  ok_note: typeof r.ok_note === 'string' ? r.ok_note : '',
  ok_at: typeof r.ok_at === 'string' ? r.ok_at : null,
  heard_from: typeof r.heard_from === 'string' ? r.heard_from : '',
  cleared: cleanCleared(r.cleared),
  updated_at: typeof r.updated_at === 'string' ? r.updated_at : null,
})

export interface PostDb extends PostStore {
  saveSettings(shopId: string, settings: PostSettings, userId: string | null): Promise<void>
  /** Null when the job_post_info table is missing. A job with no row has the default: no yes, no cleared photos. */
  jobInfo(shopId: string, jobId: string): Promise<JobInfo | null>
  jobInfos(shopId: string, jobIds: string[]): Promise<Map<string, JobInfo> | null>
  /** Every job where the customer said yes and at least one photo is cleared. */
  jobsWithYes(shopId: string): Promise<Array<{ job_id: string; cleared: ClearedPhoto[] }> | null>
  setPermission(shopId: string, jobId: string, ok: boolean, userId: string | null, note: string): Promise<void>
  setCleared(shopId: string, jobId: string, cleared: ClearedPhoto[]): Promise<void>
  setHeardFrom(shopId: string, jobId: string, heardFrom: string): Promise<void>
}

export function createPostStore(db: SupabaseClient): PostDb {
  const now = () => new Date().toISOString()

  const upsertInfo = async (shopId: string, jobId: string, patch: Record<string, unknown>): Promise<void> => {
    const { error } = await db.from('job_post_info').upsert({ shop_id: shopId, job_id: jobId, ...patch, updated_at: now() }, { onConflict: 'shop_id,job_id' })
    throwIf(error)
  }

  return {
    async list(shopId) {
      const { data, error } = await db.from('post_queue').select('*').eq('shop_id', shopId).order('created_at', { ascending: false }).limit(200)
      throwIf(error)
      return (data || []).map(r => normalizeRow(r as Record<string, unknown>))
    },
    async get(shopId, id) {
      const { data, error } = await db.from('post_queue').select('*').eq('shop_id', shopId).eq('id', id).maybeSingle()
      throwIf(error)
      return data ? normalizeRow(data as Record<string, unknown>) : null
    },
    async insert(row: NewItem) {
      const { data, error } = await db.from('post_queue').insert(row).select('*').single()
      if (error?.code === '23505') throw new DuplicateOpenItem()
      throwIf(error)
      return normalizeRow(data as Record<string, unknown>)
    },
    async update(shopId, id, patch, from) {
      const rest: Record<string, unknown> = { ...patch }
      delete rest.id
      delete rest.shop_id
      delete rest.created_at
      const { data, error } = await db.from('post_queue').update({ ...rest, updated_at: now() }).eq('shop_id', shopId).eq('id', id).in('state', [...from]).select('*').maybeSingle()
      throwIf(error)
      return data ? normalizeRow(data as Record<string, unknown>) : null
    },
    async settings(shopId) {
      const { data, error } = await db.from('post_settings').select('mode,weekly_cap,platforms').eq('shop_id', shopId).maybeSingle()
      throwIf(error)
      return data ? cleanSettings(data) : { ...DEFAULT_POST_SETTINGS }
    },
    async saveSettings(shopId, settings, userId) {
      const { error } = await db.from('post_settings').upsert({ shop_id: shopId, mode: settings.mode, weekly_cap: settings.weeklyCap, platforms: settings.platforms, updated_by: userId, updated_at: now() }, { onConflict: 'shop_id' })
      throwIf(error)
    },
    async permission(shopId, jobId) {
      const { data, error } = await db.from('job_post_info').select('customer_ok').eq('shop_id', shopId).eq('job_id', jobId).maybeSingle()
      if (error) {
        if (isMissing(error)) return null
        throw new Error(error.message)
      }
      return data?.customer_ok === true
    },
    async jobInfo(shopId, jobId) {
      const { data, error } = await db.from('job_post_info').select('*').eq('shop_id', shopId).eq('job_id', jobId).maybeSingle()
      if (error) {
        if (isMissing(error)) return null
        throw new Error(error.message)
      }
      return data ? toInfo(data as Record<string, unknown>) : { job_id: jobId, customer_ok: false, ok_note: '', ok_at: null, heard_from: '', cleared: [], updated_at: null }
    },
    async jobInfos(shopId, jobIds) {
      const out = new Map<string, JobInfo>()
      for (let i = 0; i < jobIds.length; i += 100) {
        const { data, error } = await db.from('job_post_info').select('*').eq('shop_id', shopId).in('job_id', jobIds.slice(i, i + 100))
        if (error) {
          if (isMissing(error)) return null
          throw new Error(error.message)
        }
        for (const r of data || []) out.set(String((r as Record<string, unknown>).job_id), toInfo(r as Record<string, unknown>))
      }
      return out
    },
    async jobsWithYes(shopId) {
      const { data, error } = await db.from('job_post_info').select('job_id,cleared').eq('shop_id', shopId).eq('customer_ok', true).order('updated_at', { ascending: false }).limit(200)
      if (error) {
        if (isMissing(error)) return null
        throw new Error(error.message)
      }
      return (data || []).map(r => ({ job_id: String((r as Record<string, unknown>).job_id), cleared: cleanCleared((r as Record<string, unknown>).cleared) })).filter(r => r.cleared.length > 0)
    },
    async setPermission(shopId, jobId, ok, userId, note) {
      await upsertInfo(shopId, jobId, { customer_ok: ok, ok_by: userId, ok_at: now(), ok_note: note.slice(0, 300) || null })
    },
    async setCleared(shopId, jobId, cleared) {
      await upsertInfo(shopId, jobId, { cleared: cleared.slice(0, 40) })
    },
    async setHeardFrom(shopId, jobId, heardFrom) {
      await upsertInfo(shopId, jobId, { heard_from: heardFrom.slice(0, 120) || null, heard_from_at: now() })
    },
  }
}
