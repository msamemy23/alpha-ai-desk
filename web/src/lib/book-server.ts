import { createHash } from 'node:crypto'
import type { NextRequest } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { checkRateLimit } from '@/lib/rate-limit'
import { missingSchema } from '@/lib/schema-missing'
import { clientIp } from '@/lib/booking'
import { addDaysYmd } from '@/lib/schedule-capacity'
import type { Slot } from '@/lib/schedule-capacity'

/** Shared by the public booking routes. Server only. */

export const ipOf = (req: NextRequest): string =>
  clientIp({ forwardedFor: req.headers.get('x-forwarded-for'), realIp: req.headers.get('x-real-ip') })

/** The secret that signs the booking form. Never printed, never sent. Empty means: not available, so the form stays closed. */
export const bookingSecret = (): string => process.env.BOOKING_FORM_SECRET || process.env.INTERNAL_API_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || ''

/** A one-way fingerprint, so a tally can be kept without storing an address or a phone number. */
export const fingerprint = (value: string): string => createHash('sha256').update(`${bookingSecret()}|${value}`).digest('hex').slice(0, 32)

/**
 * Counts this visitor's tries in the database, so the limit holds across servers (the in-memory limiter only sees one).
 * If the table is not there yet, it quietly falls back to the in-memory limiter alone.
 */
export async function overLimit(scope: string, key: string, max: number, windowMinutes: number): Promise<boolean> {
  if (!checkRateLimit(`${scope}:${key}`, max * 2, windowMinutes * 60_000).ok) return true
  try {
    const sb = getServiceClient()
    const hash = fingerprint(key)
    const since = new Date(Date.now() - windowMinutes * 60_000).toISOString()
    const ins = await sb.from('public_rate_hits').insert({ scope, key_hash: hash })
    if (ins.error) return false // the table is not there yet (or hiccuped): the in-memory limit above still applies
    const { count } = await sb.from('public_rate_hits').select('id', { count: 'exact', head: true }).eq('scope', scope).eq('key_hash', hash).gte('hit_at', since)
    // Tidy this one key's old tally. A tight filter: this scope, this key, older than a day.
    void sb.from('public_rate_hits').delete().eq('scope', scope).eq('key_hash', hash).lt('hit_at', new Date(Date.now() - 86_400_000).toISOString()).then(() => undefined, () => undefined)
    return (count ?? 0) > max
  } catch {
    return false
  }
}

/** Bookings for a stretch of days: just what availability needs. Names, phones and notes are never read here. */
export async function loadSlots(shopId: string, from: string, to: string): Promise<Slot[]> {
  const sb = getServiceClient()
  const run = async (cols: string) => {
    const r = await sb.from('appointments').select(cols).eq('shop_id', shopId).gte('date', from).lte('date', to).limit(2000)
    return { data: r.data as unknown as Record<string, unknown>[] | null, error: r.error }
  }
  let res = await run('id,date,time,duration,status,tech,kind,bay')
  if (res.error && missingSchema(res.error)) res = await run('id,date,time,duration,status,tech')
  if (res.error) throw new Error('Bookings could not be loaded')
  return (res.data || []).map(r => ({
    id: String(r.id), date: String(r.date || '').slice(0, 10), time: String(r.time || '').slice(0, 5), duration: Number(r.duration) || 60,
    status: String(r.status || ''), tech: String(r.tech || ''), kind: r.kind === 'wait' ? 'wait' : r.kind === 'dropoff' ? 'dropoff' : null, bay: typeof r.bay === 'string' ? r.bay : null,
  }))
}

export const yearAgo = (today: string): string => addDaysYmd(today, -365)

export const json = (body: Record<string, unknown>, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'private, no-store' } })
