// Shared inbound-text handler, used by BOTH the Telnyx webhook (/api/sms) and the phone-gateway webhook (/api/sms-inbound).
//
// This file is only the connection to the real services. What actually happens to a text (STOP/START/HELP, consent, the shop's
// rules, the assistant, booking, "needs a person") lives in src/lib/voice/sms-pipeline.ts, which is tested without a network.

import { getServiceClient } from '@/lib/supabase'
import { buildConsent, buildEmailSender, buildTextSender, appUrl, findShopByNumber, loadShopRow } from '@/lib/voice-runtime'
import { makeModel } from '@/lib/voice/model'
import { processInboundSms } from '@/lib/voice/sms-pipeline'
import type { SmsResult } from '@/lib/voice/sms-pipeline'
import { saveInboundMedia } from '@/lib/voice/media-store'
import type { InboundMedia } from '@/lib/voice/media'

export async function handleInboundSms(opts: {
  from: string
  body: string
  messageId?: string
  toNumber?: string
  /** The shop the text belongs to, when the sender already knows it (a phone gateway's address carries it). Otherwise the number decides. */
  shopId?: string
  /** Telnyx already answered a STOP, START or HELP keyword for this message. */
  autoResponded?: boolean
  media?: InboundMedia[]
}): Promise<SmsResult | null> {
  const from = String(opts.from || '')
  if (!from) return null
  const db = getServiceClient()

  // Resolve the destination to one shop before reading or writing any tenant data.
  const shopRow = opts.shopId ? await loadShopRow(db, opts.shopId) : await findShopByNumber(db, opts.toNumber || '')
  if (!shopRow?.shop_id) return null

  return processInboundSms({
    db,
    now: () => new Date(),
    send: buildTextSender(shopRow),
    model: makeModel(shopRow, { timeoutMs: 8000, appUrl: appUrl() }),
    email: buildEmailSender(shopRow),
    consent: buildConsent(db),
    appUrl: appUrl(),
    saveMedia: (shopId, messageId, contactKey, media) =>
      saveInboundMedia(db, shopId, messageId, contactKey, media, (url, init) => fetch(url, init)).then(() => undefined),
  }, shopRow, {
    from,
    body: opts.body || '',
    messageId: opts.messageId || '',
    autoResponded: opts.autoResponded === true,
    media: opts.media,
  })
}
