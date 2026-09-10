import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizePhoneDigits } from '@/lib/sms-normalize'

/** Consent is checked against the shop and the actual destination number. */
export async function isSmsOptedOut(db: SupabaseClient, shopId: string, phone: unknown): Promise<boolean> {
  const phoneDigits = normalizePhoneDigits(phone)
  if (!phoneDigits) return false

  const { data, error } = await db
    .from('sms_consents')
    .select('opted_out')
    .eq('shop_id', shopId)
    .eq('phone_digits', phoneDigits)
    .maybeSingle()
  if (error) throw new Error('SMS consent could not be checked')
  return data?.opted_out === true
}

export async function recordSmsOptOut(
  db: SupabaseClient,
  shopId: string,
  phone: unknown,
  source = 'inbound_stop'
): Promise<void> {
  const phoneDigits = normalizePhoneDigits(phone)
  if (!phoneDigits) return

  const { error } = await db.from('sms_consents').upsert({
    shop_id: shopId,
    phone_digits: phoneDigits,
    opted_out: true,
    source,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'shop_id,phone_digits' })
  if (error) throw new Error('SMS consent could not be recorded')
}
