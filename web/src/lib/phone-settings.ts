// What the Settings screen may change about texting through the owner's own phone, and what must be true before it is turned on.
// Pure: the route reads the saved row, calls this, and writes what comes back. Every value is checked here, whatever the screen sent.

import { gatewayOf, isGatewayProvider, newGatewaySecret } from './text-channel.ts'

const OWN = ['sms_channel', 'phone_gateway', 'phone_gateway_device', 'phone_gateway_number', 'phone_gateway_key'] as const

/** True when this save has anything to do with the phone choice. Other saves never touch these columns. */
export function touchesPhone(body: Record<string, unknown>): boolean {
  return OWN.some(k => Object.prototype.hasOwnProperty.call(body, k)) || body.rotate_phone_secret === true
}

/**
 * True when a save actually asks for the phone: switches it on, or fills in or replaces any detail. A save that only carries blank or
 * empty phone fields along with other settings is not asking for anything.
 */
export function wantsPhone(body: Record<string, unknown>): boolean {
  const filled = (v: unknown) => typeof v === 'string' && v.trim() !== ''
  return body.rotate_phone_secret === true
    || body.sms_channel === 'phone'
    || filled(body.phone_gateway) || filled(body.phone_gateway_key) || filled(body.phone_gateway_device) || filled(body.phone_gateway_number)
}

/** +17135550000 from the ways people write a US number or a full international one, or '' when it is neither. */
export function gatewayNumber(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  const e164 = raw.startsWith('+') ? `+${digits}` : digits.length === 10 ? `+1${digits}` : digits.length === 11 && digits.startsWith('1') ? `+${digits}` : ''
  return /^\+\d{10,15}$/.test(e164) ? e164 : ''
}

export type PhoneUpdate =
  | { ok: true; updates: Record<string, unknown>; rotatedSecret: string }
  | { ok: false; error: string }

export function phoneUpdates(body: Record<string, unknown>, current: Record<string, unknown> | null | undefined): PhoneUpdate {
  const updates: Record<string, unknown> = {}
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k)

  if (has('sms_channel')) {
    const v = body.sms_channel
    if (v === 'telnyx' || v === 'phone') updates.sms_channel = v
    else if (v === '' || v === null) updates.sms_channel = null
    else return { ok: false, error: 'sms_channel must be telnyx or phone' }
  }
  if (has('phone_gateway')) {
    const v = body.phone_gateway
    if (v === '' || v === null) updates.phone_gateway = null
    else if (isGatewayProvider(v)) updates.phone_gateway = v
    else return { ok: false, error: 'Choose TextBee or httpSMS' }
  }
  if (has('phone_gateway_device')) {
    const v = body.phone_gateway_device
    updates.phone_gateway_device = typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : null
  }
  if (has('phone_gateway_number')) {
    const raw = typeof body.phone_gateway_number === 'string' ? body.phone_gateway_number.trim() : ''
    if (!raw) updates.phone_gateway_number = null
    else {
      const number = gatewayNumber(raw)
      if (!number) return { ok: false, error: 'Enter the phone number with its country code, like +17135550000' }
      updates.phone_gateway_number = number
    }
  }
  if (has('phone_gateway_key')) {
    const v = body.phone_gateway_key
    // A blank box means "keep the saved key". The explicit word clears it.
    if (v === '__CLEAR__' || v === null) updates.phone_gateway_key = null
    else if (typeof v === 'string' && v.trim()) updates.phone_gateway_key = v.trim().slice(0, 300)
  }

  // The phone can be switched on only when everything it needs is filled in, so a half-finished setup can never stop the shop's texts.
  const merged = { ...(current || {}), ...updates }
  if (merged.sms_channel === 'phone' && !gatewayOf(merged)) {
    return { ok: false, error: 'Finish the phone details first: the service, its key, the phone number' + (merged.phone_gateway === 'textbee' ? ' and the TextBee device ID.' : '.') }
  }

  // A code for this shop's incoming-text address: made once the service is chosen, kept until the owner asks for a new one.
  let rotatedSecret = ''
  if (body.rotate_phone_secret === true) {
    rotatedSecret = newGatewaySecret()
    updates.phone_gateway_secret = rotatedSecret
  } else if (merged.phone_gateway && !merged.phone_gateway_secret) {
    updates.phone_gateway_secret = newGatewaySecret()
  }
  return { ok: true, updates, rotatedSecret }
}
