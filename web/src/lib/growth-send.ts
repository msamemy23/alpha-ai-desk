// One way to send a text from the Growth screens (follow-ups, reminders, review requests, lead texts).
//
// Each of those routes used to carry its own copy of a Telnyx call, so a shop that texts through its own phone was left out of all
// of them. They now share this: it picks the shop's way of texting (text-channel.ts), refuses promotions on a personal phone, and
// returns the same small answer the routes already used. The opt-out checks stay in each route, where the customer is looked up.

import { sendSMS } from '@/lib/sms'
import { allowsBulk, channelOf, fromNumberOf, PHONE_NO_BULK_MESSAGE, smsOptionsFor } from '@/lib/text-channel'

export interface GrowthSendResult { success: boolean; messageId?: string; error?: string }

/**
 * service   - about the customer's own car, visit or estimate, sent to one person at a time.
 * marketing - a promotion, a win-back or a request, sent to many people. Not allowed through a personal phone.
 */
export type GrowthTextKind = 'service' | 'marketing'

export async function sendGrowthText(
  settings: Record<string, unknown> | null | undefined,
  to: string,
  message: string,
  idempotencyKey: string | undefined,
  kind: GrowthTextKind,
): Promise<GrowthSendResult> {
  const channel = channelOf(settings)
  if (channel.kind === 'none') return { success: false, error: channel.message }
  if (kind === 'marketing' && !allowsBulk(settings)) return { success: false, error: PHONE_NO_BULK_MESSAGE }
  try {
    const result = await sendSMS(to, message, fromNumberOf(settings), smsOptionsFor(settings, { idempotencyKey })) as { id?: unknown } | null
    const id = typeof result?.id === 'string' ? result.id : ''
    // Telnyx answers with an id when it accepted the text. No id means it did not.
    if (!id) return { success: false, error: 'The text was not accepted' }
    return { success: true, messageId: id }
  } catch (e) {
    const said = e && typeof (e as { message?: unknown }).message === 'string' ? String((e as { message: string }).message) : ''
    return { success: false, error: said || 'The text could not be sent' }
  }
}
