/**
 * What a shop tablet PIN may look like: 4 to 8 digits that are not an obvious guess. This file has no imports, so the browser
 * can check a PIN before sending it and the server can check it again. The server never trusts the browser's check.
 */
export const PIN_MIN = 4
export const PIN_MAX = 8

export type PinCheck = { ok: true; pin: string } | { ok: false; error: string }

/** Digits only, 4 to 8 long, and not something anyone would try first. */
export function validatePin(raw: unknown): PinCheck {
  const pin = String(raw ?? '').trim()
  if (!/^\d+$/.test(pin)) return { ok: false, error: 'A PIN is numbers only.' }
  if (pin.length < PIN_MIN || pin.length > PIN_MAX) return { ok: false, error: `A PIN is ${PIN_MIN} to ${PIN_MAX} numbers.` }
  if (/^(\d)\1+$/.test(pin)) return { ok: false, error: 'Pick a PIN that is not one number repeated.' }
  const asc = '01234567890123456789'
  const desc = '98765432109876543210'
  if (asc.includes(pin) || desc.includes(pin)) return { ok: false, error: 'Pick a PIN that is not a straight run of numbers.' }
  return { ok: true, pin }
}
