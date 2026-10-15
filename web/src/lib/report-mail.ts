/**
 * Sends an email the way the rest of the app does: through the shop's own email account when it has one, otherwise through the
 * server's default. Used by the emailed reports and the purchase orders. Server only.
 */
import { sendEmail } from '@/lib/email'
import type { Db } from '@/lib/db-types'

export type Mailer = (mail: { to: string; subject: string; html: string; text: string; replyTo?: string; idempotencyKey?: string }) => Promise<void>

export async function mailerFor(db: Db, shopId: string): Promise<Mailer> {
  const { data } = await db.from('settings').select('*').eq('shop_id', shopId).maybeSingle()
  const apiKey = typeof data?.resend_api_key === 'string' ? data.resend_api_key : ''
  const from = typeof data?.from_email === 'string' ? data.from_email : ''
  return async mail => {
    await sendEmail({ to: mail.to, subject: mail.subject, html: mail.html, replyTo: mail.replyTo, idempotencyKey: mail.idempotencyKey, ...(apiKey && from ? { apiKey, from } : {}) })
  }
}
