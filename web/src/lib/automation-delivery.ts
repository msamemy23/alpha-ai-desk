// What the phone company says happened to a text after it accepted it: delivered, or why not.
// The carrier sends this to the shop's messaging webhook some seconds after sending. This file reads that
// notice and writes it onto the message in the automation history. Nothing here sends anything.

import type { SupabaseClient } from '@supabase/supabase-js'

export type DeliveryStatus = 'delivered' | 'undelivered' | 'failed'

export interface DeliveryNotice {
  /** The carrier's id for the message (the same id stored when it was sent). */
  providerMessageId: string
  status: DeliveryStatus
  /** The carrier's reason when it did not arrive, in its own words. */
  error: string
}

/**
 * Reads a Telnyx "message.finalized" webhook body. Returns null for anything else (inbound texts, other events),
 * so the caller can run this on every notice without checking the type first.
 */
export function parseTelnyxDelivery(body: unknown): DeliveryNotice | null {
  const root = (body && typeof body === 'object' ? body : {}) as Record<string, any>
  const data = root.data && typeof root.data === 'object' ? root.data : root
  const type = String(data.event_type || root.event_type || '')
  if (type !== 'message.finalized' && type !== 'message.sent' && type !== 'message.delivery_status') return null
  const payload = (data.payload && typeof data.payload === 'object' ? data.payload : {}) as Record<string, any>
  if (String(payload.direction || 'outbound') !== 'outbound') return null
  const id = String(payload.id || '')
  if (!id) return null
  const to = Array.isArray(payload.to) ? payload.to[0] : null
  const raw = String(to?.status || payload.status || '').toLowerCase()
  const errors = Array.isArray(payload.errors) ? payload.errors : []
  const error = String(errors[0]?.detail || errors[0]?.title || '').slice(0, 300)
  if (raw === 'delivered') return { providerMessageId: id, status: 'delivered', error: '' }
  if (raw === 'delivery_failed' || raw === 'sending_failed' || raw === 'failed') return { providerMessageId: id, status: 'failed', error: error || 'The carrier could not deliver this text.' }
  if (raw === 'delivery_unconfirmed' || raw === 'undelivered') return { providerMessageId: id, status: 'undelivered', error: error || 'The carrier could not confirm this text arrived.' }
  return null
}

/**
 * Writes the carrier's answer onto the matching automation message. Messages the shop sent some other way match
 * nothing, which is fine. Returns how many rows were updated.
 */
export async function recordDelivery(db: SupabaseClient, notice: DeliveryNotice, now: Date = new Date()): Promise<number> {
  const patch: Record<string, unknown> = { delivery_status: notice.status, updated_at: now.toISOString() }
  if (notice.status === 'delivered') patch.delivered_at = now.toISOString()
  else patch.last_error = notice.error
  const { data, error } = await db.from('automation_messages').update(patch).eq('provider_message_id', notice.providerMessageId).eq('channel', 'sms').select('id')
  if (error) {
    // The history table not being there yet is not the carrier webhook's problem.
    if (error.code === '42P01' || error.code === '42703' || error.code === 'PGRST205' || error.code === 'PGRST204') return 0
    throw new Error(error.message)
  }
  return data?.length ?? 0
}
