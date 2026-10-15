/**
 * VIN and plate handling: cleaning what was typed or scanned, the check digit, and the model year the 10th character names.
 * It imports nothing, so it runs in the browser, on the server and under `node --test`.
 */

/** A scanned or typed VIN, upper case with spaces and dashes removed. The letters I, O and Q never appear in a VIN, so they are read as 1, 0 and 0. */
export function cleanVin(v: unknown): string {
  return String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/I/g, '1').replace(/[OQ]/g, '0')
}

const TRANSLIT: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
}
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2]

export type VinState = 'empty' | 'short' | 'long' | 'valid' | 'check_digit'

/**
 * 'valid' is 17 characters with a check digit that works out. 'check_digit' is 17 characters that do not: a typo, or a
 * vehicle made outside North America (which does not use the check digit), so it is a warning, never a block.
 */
export function vinState(input: unknown): VinState {
  const vin = cleanVin(input)
  if (!vin) return 'empty'
  if (vin.length < 17) return 'short'
  if (vin.length > 17) return 'long'
  let sum = 0
  for (let i = 0; i < 17; i++) {
    const ch = vin[i]
    const val = /\d/.test(ch) ? Number(ch) : TRANSLIT[ch]
    if (val === undefined) return 'check_digit'
    sum += val * WEIGHTS[i]
  }
  const rem = sum % 11
  const expect = rem === 10 ? 'X' : String(rem)
  return vin[8] === expect ? 'valid' : 'check_digit'
}

export const isVin17 = (v: unknown): boolean => cleanVin(v).length === 17

export function vinMessage(state: VinState): string {
  switch (state) {
    case 'short': return 'A VIN has 17 characters.'
    case 'long': return 'That is more than 17 characters.'
    case 'check_digit': return 'The check digit does not match. Look for a typo, then decode again.'
    default: return ''
  }
}

const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789'

/**
 * The model year the 10th character names, as a hint only. The code repeats every 30 years, so the later year wins
 * unless it is more than a year ahead of today. Returns null when the character is not a year code.
 */
export function modelYearHint(input: unknown, nowYear: number = new Date().getFullYear()): number | null {
  const vin = cleanVin(input)
  if (vin.length !== 17) return null
  const idx = YEAR_CODES.indexOf(vin[9])
  if (idx < 0) return null
  const older = 1980 + idx
  const newer = older + 30
  return newer <= nowYear + 1 ? newer : older
}

/** Plate text as written on the plate: upper case, letters and numbers only. */
export const cleanPlate = (v: unknown): string => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10)

/** The last six characters, the part people read out over the phone. */
export const vinTail = (v: unknown): string => cleanVin(v).slice(-6)
