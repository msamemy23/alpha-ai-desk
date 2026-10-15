/**
 * Shop-floor PINs for the shared clock-in tablet. A PIN is 4 to 8 digits, stored only as a salted scrypt hash, and checked
 * in constant time. Server code only (it uses node:crypto). A wrong PIN counts against a short lockout so a PIN cannot be guessed.
 */
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

import { PIN_MAX, PIN_MIN, validatePin } from './pin-shape.ts'
export type { PinCheck } from './pin-shape.ts'
export { PIN_MAX, PIN_MIN, validatePin }

export const MAX_PIN_FAILS = 5
export const PIN_LOCK_MS = 5 * 60_000

const KEYLEN = 32

export function hashPin(pin: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(pin, salt, KEYLEN)
  return `s1$${salt.toString('hex')}$${hash.toString('hex')}`
}

export function verifyPin(pin: string, stored: string | null | undefined): boolean {
  const parts = String(stored || '').split('$')
  if (parts.length !== 3 || parts[0] !== 's1') return false
  try {
    const salt = Buffer.from(parts[1], 'hex')
    const want = Buffer.from(parts[2], 'hex')
    if (salt.length === 0 || want.length !== KEYLEN) return false
    const got = scryptSync(String(pin ?? ''), salt, KEYLEN)
    return timingSafeEqual(got, want)
  } catch {
    return false
  }
}

export interface PinState { failed: number; lockedUntil: number | null }

/** Locked right now? Returns the minutes left, or 0. */
export function lockMinutesLeft(lockedUntilIso: string | null | undefined, nowMs: number): number {
  const until = lockedUntilIso ? Date.parse(lockedUntilIso) : NaN
  if (!Number.isFinite(until) || until <= nowMs) return 0
  return Math.max(1, Math.ceil((until - nowMs) / 60_000))
}

/** The count after one more wrong PIN, and the lock time when it reaches the limit. */
export function afterWrongPin(failed: number, nowMs: number): PinState {
  const next = Math.max(0, Math.floor(failed)) + 1
  return next >= MAX_PIN_FAILS ? { failed: 0, lockedUntil: nowMs + PIN_LOCK_MS } : { failed: next, lockedUntil: null }
}
