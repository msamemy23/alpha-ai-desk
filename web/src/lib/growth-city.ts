import type { SupabaseClient } from '@supabase/supabase-js'
import { cityFromProfile } from './growth-text.ts'

/**
 * The place a lead search looks near: what the caller asked for, else the city on the shop's own profile.
 * Never a guess. Empty when neither exists, so the route can ask the owner to add their city.
 */
export async function resolveSearchCity(db: SupabaseClient, shopId: string, requested: unknown): Promise<string> {
  const asked = typeof requested === 'string' ? requested.trim().slice(0, 120) : ''
  if (asked) return asked
  const { data, error } = await db.from('shop_profiles').select('city_state_zip').eq('id', shopId).maybeSingle()
  if (error) throw error
  return cityFromProfile(data?.city_state_zip)?.search.slice(0, 120) || ''
}

export const NEEDS_CITY = 'Add your shop’s city in the setup guide first, so Alpha knows where to search.'

/** "Houston TX" gives "Houston". Used where a lead row wants only the city. */
export const cityName = (search: string): string => search.replace(/\s+[A-Za-z]{2}$/, '').trim() || search
