import { getServiceClient } from '@/lib/supabase'
import { missingSchema } from '@/lib/schema-missing'
import { cleanCapacity } from '@/lib/schedule-capacity'
import type { CapacitySettings } from '@/lib/schedule-capacity'
import { cleanOnline } from '@/lib/booking'
import type { OnlineSettings } from '@/lib/booking'
import { cleanBoard } from '@/lib/jobflow'
import type { BoardSettings } from '@/lib/jobflow'

/**
 * A shop's scheduling settings, read and written only on the server (the table is closed to browsers).
 * `migrated` is false until migration 050 is applied: everything then runs on built-in defaults and nothing can be saved.
 */
export interface ShopSchedule {
  migrated: boolean
  capacity: CapacitySettings
  online: OnlineSettings
  board: BoardSettings
  icalToken: string | null
}

export interface ShopInfo { name: string; phone: string; address: string; timezone: string | null }

const toSchedule = (r: Record<string, unknown> | null): ShopSchedule => ({
  migrated: true,
  capacity: cleanCapacity(r?.capacity),
  online: cleanOnline(r?.online),
  board: cleanBoard(r?.board),
  icalToken: typeof r?.ical_token === 'string' && r.ical_token ? r.ical_token : null,
})

export const defaultSchedule = (migrated = false): ShopSchedule => ({ ...toSchedule(null), migrated })

export async function loadSchedule(shopId: string): Promise<ShopSchedule> {
  const { data, error } = await getServiceClient().from('schedule_settings').select('capacity,online,board,ical_token').eq('shop_id', shopId).maybeSingle()
  if (error) {
    if (missingSchema(error)) return defaultSchedule(false)
    throw new Error('Schedule settings could not be loaded')
  }
  return toSchedule(data as Record<string, unknown> | null)
}

export type ScheduleLookup = (ShopSchedule & { shopId: string }) | null

/** The shop that owns a booking address. Only shops whose online booking is switched on are found. */
export async function loadBySlug(slug: string): Promise<ScheduleLookup> {
  const { data, error } = await getServiceClient().from('schedule_settings').select('shop_id,capacity,online,board,ical_token').eq('online->>slug', slug).maybeSingle()
  if (error || !data) return null
  const s = toSchedule(data as Record<string, unknown>)
  return s.online.enabled && s.online.slug === slug ? { ...s, shopId: String(data.shop_id) } : null
}

export async function loadByIcalToken(token: string): Promise<ScheduleLookup> {
  const { data, error } = await getServiceClient().from('schedule_settings').select('shop_id,capacity,online,board,ical_token').eq('ical_token', token).maybeSingle()
  if (error || !data) return null
  return { ...toSchedule(data as Record<string, unknown>), shopId: String(data.shop_id) }
}

export async function saveSchedule(shopId: string, patch: Partial<{ capacity: CapacitySettings; online: OnlineSettings; board: BoardSettings; icalToken: string | null }>): Promise<{ ok: true } | { ok: false; code: 'missing' | 'slug-taken' | 'failed' }> {
  const row: Record<string, unknown> = { shop_id: shopId, updated_at: new Date().toISOString() }
  if (patch.capacity) row.capacity = patch.capacity
  if (patch.online) row.online = patch.online
  if (patch.board) row.board = patch.board
  if (patch.icalToken !== undefined) row.ical_token = patch.icalToken
  const { error } = await getServiceClient().from('schedule_settings').upsert(row, { onConflict: 'shop_id' })
  if (!error) return { ok: true }
  if (missingSchema(error)) return { ok: false, code: 'missing' }
  if (error.code === '23505') return { ok: false, code: 'slug-taken' }
  console.error('[schedule] save failed:', error.message)
  return { ok: false, code: 'failed' }
}

export async function loadShopInfo(shopId: string): Promise<ShopInfo> {
  const sb = getServiceClient()
  const first = await sb.from('settings').select('shop_name,shop_phone,shop_address,timezone').eq('shop_id', shopId).order('updated_at', { ascending: false }).limit(1).maybeSingle()
  let row = first.data as Record<string, unknown> | null
  if (first.error && missingSchema(first.error)) {
    const again = await sb.from('settings').select('shop_name,shop_phone,shop_address').eq('shop_id', shopId).order('updated_at', { ascending: false }).limit(1).maybeSingle()
    row = again.data as Record<string, unknown> | null
  }
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  return { name: s(row?.shop_name), phone: s(row?.shop_phone), address: s(row?.shop_address), timezone: s(row?.timezone) || null }
}
