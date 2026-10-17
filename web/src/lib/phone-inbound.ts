// Who may post a customer's text into a shop's inbox through a phone gateway. Pure, so tests can run it.
//
// The gateway apps do not sign what they send, so a code in the address is the only proof. Two forms exist:
//   per shop:        ?shop=SHOP_ID&secret=CODE   the code is the one saved for that shop (Settings, Text with my own phone)
//   deployment-wide: ?secret=VALUE               the older single-shop form, checked against the SMS_INBOUND_SECRET setting
// Anything that does not match is refused, and a missing setting always refuses.

import { timingSafeEqual } from 'node:crypto'
import { choseOwnPhone } from './text-channel.ts'

export type InboundAccess =
  | { ok: true; shopId: string | null }
  | { ok: false; status: 401 | 503; error?: string }
  | { ok: false; skipped: string; status: 200 }

function same(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** A shop id as it is written in an address: letters, digits and dashes only, the length of a UUID. */
export const looksLikeShopId = (v: string): boolean => /^[0-9a-fA-F-]{32,40}$/.test(v)

export function inboundAccess(input: {
  shopParam: string
  provided: string
  /** The shop's saved choice, read by the caller. Only used with a shop in the address. */
  saved: Record<string, unknown> | null | undefined
  envSecret: string | undefined
}): InboundAccess {
  const { shopParam, provided, saved, envSecret } = input
  if (shopParam) {
    if (!looksLikeShopId(shopParam) || !provided) return { ok: false, status: 401 }
    const code = typeof saved?.phone_gateway_secret === 'string' ? saved.phone_gateway_secret : ''
    if (!saved || !code || !same(provided, code)) return { ok: false, status: 401 }
    // The shop went back to its Telnyx number: a gateway still pointed here is told "fine", so it does not keep retrying.
    if (!choseOwnPhone(saved)) return { ok: false, status: 200, skipped: 'phone texting is off for this shop' }
    return { ok: true, shopId: String(saved.shop_id || shopParam) }
  }
  if (!envSecret) return { ok: false, status: 503, error: 'SMS_INBOUND_SECRET not configured' }
  if (!same(provided, envSecret)) return { ok: false, status: 401 }
  return { ok: true, shopId: null }
}
