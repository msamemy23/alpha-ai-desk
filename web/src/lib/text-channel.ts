// Which way a shop's texts go out: the shop's Telnyx number, or the shop's own Android phone through a text gateway app.
//
// One place decides this for every send path (replies, estimates and invoices, scheduled texts, follow-ups, reminders, review
// requests, the assistant). Pure, so tests can run it without a network. The settings row is passed in, never read here.
//
//   Telnyx  - a real business number on a carrier-registered campaign. Pictures work. Delivery reports come back.
//   Phone   - TextBee or httpSMS installed on the owner's Android phone. Texts leave from that phone's own number and SIM.
//             No pictures, no delivery report, and carriers can flag a phone that sends in bulk, so promotions are kept off it.
//
// An iPhone cannot be a gateway (Apple has no way to send a text for an app). The iPhone route is the "From my phone" button.

import type { SmsOptions } from './sms'

export type GatewayProvider = 'textbee' | 'httpsms'

export const GATEWAYS: Record<GatewayProvider, { label: string; site: string }> = {
  textbee: { label: 'TextBee', site: 'textbee.dev' },
  httpsms: { label: 'httpSMS', site: 'httpsms.com' },
}

/** What the sender needs to reach one shop's phone. */
export interface PhoneGateway {
  provider: GatewayProvider
  apiKey: string
  /** TextBee names the phone by a device id; httpSMS names it by its number. */
  deviceId: string
  /** The phone's own number, with the country code. Texts leave from it and replies arrive on it. */
  number: string
}

export type TextChannel =
  | { kind: 'telnyx'; apiKey: string; from: string; messagingProfileId: string }
  | { kind: 'phone'; gateway: PhoneGateway; from: string }
  | { kind: 'none'; why: 'not_set_up' | 'phone_incomplete'; message: string }

type Row = Record<string, unknown> | null | undefined

const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

export const NOT_SET_UP_MESSAGE = 'Texting is not set up for this shop. Add it in Settings, Communications.'
export const PHONE_INCOMPLETE_MESSAGE = 'Texting through your own phone is chosen but not finished. Finish it in Settings, Communications.'

export function isGatewayProvider(v: unknown): v is GatewayProvider {
  return v === 'textbee' || v === 'httpsms'
}

/** The phone gateway, only when every part it needs is filled in. */
export function gatewayOf(row: Row): PhoneGateway | null {
  if (!row) return null
  const provider = text(row.phone_gateway).toLowerCase()
  if (!isGatewayProvider(provider)) return null
  const apiKey = text(row.phone_gateway_key)
  const number = text(row.phone_gateway_number)
  const deviceId = text(row.phone_gateway_device)
  if (!apiKey || !number) return null
  if (provider === 'textbee' && !deviceId) return null
  return { provider, apiKey, deviceId, number }
}

/** True when the shop chose its own phone, finished or not. */
export function choseOwnPhone(row: Row): boolean {
  return text(row?.sms_channel).toLowerCase() === 'phone'
}

export function channelOf(row: Row): TextChannel {
  if (choseOwnPhone(row)) {
    const gateway = gatewayOf(row)
    // Chosen but unfinished never falls back to Telnyx: a text must not leave from a different number than the owner picked.
    if (!gateway) return { kind: 'none', why: 'phone_incomplete', message: PHONE_INCOMPLETE_MESSAGE }
    return { kind: 'phone', gateway, from: gateway.number }
  }
  const apiKey = text(row?.telnyx_api_key)
  const from = text(row?.telnyx_phone_number)
  if (apiKey && from) return { kind: 'telnyx', apiKey, from, messagingProfileId: text(row?.telnyx_messaging_profile_id) }
  return { kind: 'none', why: 'not_set_up', message: NOT_SET_UP_MESSAGE }
}

/** Can this shop text at all right now? */
export function textReady(row: Row): boolean {
  return channelOf(row).kind !== 'none'
}

/** The number a text leaves from, for the message record. Empty when texting is not set up. */
export function fromNumberOf(row: Row): string {
  const c = channelOf(row)
  return c.kind === 'none' ? '' : c.from
}

/** The shop's own number as the receptionist and the inbound handler should treat it. */
export function shopNumberOf(row: Row): string {
  const c = channelOf(row)
  if (c.kind === 'telnyx' || c.kind === 'phone') return c.from
  return text(row?.telnyx_phone_number) || text(row?.phone_gateway_number) || text(row?.shop_phone)
}

/** Pictures only go through Telnyx. A phone gateway sends plain text. */
export function canSendPictures(row: Row): boolean {
  return channelOf(row).kind === 'telnyx'
}

/**
 * Marketing and mass texts (promotions, win-backs) stay off a personal phone: carriers flag a SIM that sends in bulk, and the
 * shop would lose the number its customers know. They need the shop number (Telnyx). One-to-one texts and service messages are fine.
 */
export function allowsBulk(row: Row): boolean {
  return channelOf(row).kind !== 'phone'
}

export const PHONE_NO_PICTURES_MESSAGE = 'Pictures cannot go through your own phone. Send them from the shop number, or send the text without the picture.'
export const PHONE_NO_BULK_MESSAGE = 'Promotions are not sent through your own phone, because carriers block a phone that sends in bulk. Use the shop number for these.'

/** The options sendSMS needs for this shop. Throws a plain sentence when the shop cannot text. */
export function smsOptionsFor(row: Row, extra: { idempotencyKey?: string; mediaUrls?: string[] } = {}): SmsOptions {
  const c = channelOf(row)
  if (c.kind === 'none') throw new Error(c.message)
  if (c.kind === 'phone') {
    if (extra.mediaUrls?.length) throw new Error(PHONE_NO_PICTURES_MESSAGE)
    return { phone: c.gateway, idempotencyKey: extra.idempotencyKey }
  }
  return {
    apiKey: c.apiKey,
    messagingProfileId: c.messagingProfileId,
    idempotencyKey: extra.idempotencyKey,
    ...(extra.mediaUrls?.length ? { mediaUrls: extra.mediaUrls } : {}),
  }
}

/** A hard-to-guess code for the webhook address. 32 hex characters from the platform's random source. */
export function newGatewaySecret(): string {
  const bytes = new Uint8Array(16)
  globalThis.crypto.getRandomValues(bytes)
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

/** The columns that hold the phone choice. A database that has not had migration 063 yet does not have them. */
export const PHONE_COLUMNS = ['sms_channel', 'phone_gateway', 'phone_gateway_key', 'phone_gateway_device', 'phone_gateway_number', 'phone_gateway_secret'] as const
