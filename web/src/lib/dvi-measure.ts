/**
 * Measurements a technician takes during an inspection (tire tread, brake pads, rotors, tire pressure),
 * the warning each one earns, and how fast a part is wearing between two visits.
 * No imports, so the browser, the server and `node --test` all run the same code.
 *
 * A rating always comes with a word, never a colour alone: "Good tread", "Wearing", "Replace soon".
 */

export type MeasureKind = 'tread' | 'pad' | 'rotor' | 'pressure'
export type MeasureRating = 'green' | 'yellow' | 'red'

export interface Measure {
  kind: MeasureKind
  /** Tread in 32nds of an inch, pads and rotors in millimetres, pressure in psi. For tread this is the lowest reading. */
  value: number
  /** Tread only: inner, center and outer readings, when the tech took all three. */
  readings?: number[]
  /** Rotor: the minimum thickness stamped on the rotor. Pressure: the pressure on the door sticker. */
  spec?: number
}

export const MEASURE_LABEL: Record<MeasureKind, string> = {
  tread: 'Tire tread',
  pad: 'Brake pad thickness',
  rotor: 'Rotor thickness',
  pressure: 'Tire pressure',
}

export const MEASURE_UNIT: Record<MeasureKind, string> = { tread: '/32 in', pad: 'mm', rotor: 'mm', pressure: 'psi' }

/** Where the tread and pad lines sit. A shop could move these; the defaults are common shop practice. */
export const TREAD_LIMITS = { good: 6, watch: 4, replaceAt: 3, legalMin: 2 }
export const PAD_LIMITS = { good: 6, watch: 4, replaceAt: 3, metal: 2 }

export interface MeasureResult {
  /** null when there is not enough to judge (a rotor with no minimum, a tire with no spec). */
  rating: MeasureRating | null
  /** The warning in words. */
  word: string
  /** The reading, written out: "4/32 in", "5.5 mm". */
  text: string
}

const round1 = (n: number) => Math.round(n * 10) / 10

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const cleaned = String(v).replace(/[^\d.\-]/g, '')
  if (!/\d/.test(cleaned)) return null // "abc" is not a zero
  const n = Number(cleaned)
  return Number.isFinite(n) ? n : null
}

/** Clean up a measurement from the database or the browser. Anything that is not a sane reading is dropped. */
export function cleanMeasure(raw: unknown): Measure | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const o = raw as Record<string, unknown>
  const kind = o.kind
  if (kind !== 'tread' && kind !== 'pad' && kind !== 'rotor' && kind !== 'pressure') return undefined
  const max = kind === 'tread' ? 20 : kind === 'pad' ? 30 : kind === 'rotor' ? 60 : 120
  const ok = (n: number | null): n is number => n !== null && n >= 0 && n <= max
  let readings: number[] | undefined
  if (kind === 'tread' && Array.isArray(o.readings)) {
    const list = o.readings.slice(0, 3).map(num)
    if (list.length > 0 && list.every(ok)) readings = list.map(n => round1(n as number))
  }
  let value = num(o.value)
  if (readings) value = Math.min(...readings)
  if (!ok(value)) return undefined
  const out: Measure = { kind, value: round1(value) }
  if (readings && readings.length > 1) out.readings = readings
  if (kind === 'rotor' || kind === 'pressure') {
    const spec = num(o.spec)
    if (spec !== null && spec > 0 && spec <= max) out.spec = round1(spec)
  }
  return out
}

/** Which measurement fits a checklist line, from its name. "Left front tire" gets tread, "Front brake pads" gets pad thickness. */
export function measureKindFor(name: string): MeasureKind | null {
  const n = String(name || '').toLowerCase()
  if (/\b(tire|tyre)\s*(pressure|psi)\b|\bpressure\b.*\btire/.test(n)) return null // one line for all four: no single reading
  if (/\b(rotor|rotors|disc|discs)\b/.test(n)) return 'rotor'
  if (/\bbrake pads?\b|\bpads?\b/.test(n)) return 'pad'
  if (/\b(tire|tyre|tires|tyres)\b/.test(n) && !/\bspare\b/.test(n)) return 'tread'
  return null
}

const fmtNum = (n: number) => (Number.isInteger(n) ? String(n) : String(round1(n)))

export function measureText(m: Measure): string {
  switch (m.kind) {
    case 'tread': return `${fmtNum(m.value)}/32 in`
    case 'pad': return `${fmtNum(m.value)} mm`
    case 'rotor': return m.spec ? `${fmtNum(m.value)} mm (minimum ${fmtNum(m.spec)})` : `${fmtNum(m.value)} mm`
    case 'pressure': return m.spec ? `${fmtNum(m.value)} psi (should be ${fmtNum(m.spec)})` : `${fmtNum(m.value)} psi`
  }
}

/** Uneven wear across a tire: the outside and the inside differ by 3/32 or more. A hint to check alignment. */
export function unevenWear(m: Measure): boolean {
  if (m.kind !== 'tread' || !m.readings || m.readings.length < 2) return false
  return Math.max(...m.readings) - Math.min(...m.readings) >= 3
}

export function rateMeasure(m: Measure): MeasureResult {
  const text = measureText(m)
  const v = m.value
  switch (m.kind) {
    case 'tread': {
      if (v <= TREAD_LIMITS.legalMin) return { rating: 'red', word: 'Below the legal minimum: replace', text }
      if (v <= TREAD_LIMITS.replaceAt) return { rating: 'red', word: 'Replace soon', text }
      if (v < TREAD_LIMITS.good) return { rating: 'yellow', word: 'Wearing: plan to replace', text }
      return { rating: 'green', word: 'Good tread', text }
    }
    case 'pad': {
      if (v < PAD_LIMITS.metal) return { rating: 'red', word: 'Replace now: metal contact risk', text }
      if (v < PAD_LIMITS.good - 2) return { rating: 'red', word: 'Replace pads', text }
      if (v < PAD_LIMITS.good) return { rating: 'yellow', word: 'Getting thin', text }
      return { rating: 'green', word: 'Good', text }
    }
    case 'rotor': {
      if (!m.spec) return { rating: null, word: 'Enter the minimum stamped on the rotor to rate it', text }
      if (v < m.spec) return { rating: 'red', word: 'Below the minimum: replace', text }
      if (v - m.spec < 0.8) return { rating: 'yellow', word: 'Close to the minimum', text }
      return { rating: 'green', word: 'Good', text }
    }
    case 'pressure': {
      if (!m.spec) return { rating: null, word: 'Enter the pressure on the door sticker to rate it', text }
      const diff = v - m.spec
      const abs = Math.abs(diff)
      if (abs <= 3) return { rating: 'green', word: 'Correct', text }
      const how = diff < 0 ? 'low' : 'high'
      if (abs <= 7) return { rating: 'yellow', word: `${abs.toFixed(abs % 1 ? 1 : 0)} psi ${how}`, text }
      return { rating: 'red', word: `${abs.toFixed(abs % 1 ? 1 : 0)} psi ${how}: fix now`, text }
    }
  }
}

const RANK: Record<MeasureRating, number> = { green: 0, yellow: 1, red: 2 }

/**
 * What the rating on the line should become after a measurement. A measurement can only make a rating worse on its own
 * (a good rating the tech chose is never lowered by a reading that is not as bad, and a worse choice is kept).
 * Returns null when the rating should stay as it is.
 */
export function ratingAfterMeasure(current: MeasureRating | null, m: Measure): MeasureRating | null {
  const r = rateMeasure(m).rating
  if (!r) return null
  if (current === null) return r
  return RANK[r] > RANK[current] ? r : null
}

/* ---------- wear between two visits ---------- */

export interface WearInput { value: number; miles: number | null }
export interface WearPlan {
  /** How much was lost, in the measurement's own unit. Positive means worn. */
  lost: number
  /** Miles driven between the two readings, or null when a mileage is missing. */
  miles: number | null
  /** Loss per 1,000 miles, or null when it cannot be told. */
  per1000: number | null
  /** Miles until the reading reaches the "replace" line at this rate, or null when it cannot be told. */
  milesLeft: number | null
}

/** How fast tread or pads are wearing, and about how many miles are left. Honest: says nothing it cannot work out. */
export function wearPlan(kind: MeasureKind, before: WearInput, now: WearInput): WearPlan {
  const lost = round1(before.value - now.value)
  const miles = before.miles !== null && now.miles !== null ? now.miles - before.miles : null
  let per1000: number | null = null
  let milesLeft: number | null = null
  if (miles !== null && miles >= 1000 && lost > 0 && (kind === 'tread' || kind === 'pad')) {
    per1000 = round1((lost / miles) * 1000)
    const line = kind === 'tread' ? TREAD_LIMITS.replaceAt : PAD_LIMITS.replaceAt
    const left = now.value - line
    milesLeft = left <= 0 ? 0 : Math.round(((left / lost) * miles) / 500) * 500
  }
  return { lost, miles, per1000, milesLeft }
}

/** "Lost 2/32 in 8,000 miles. About 4,000 miles until the replace line." */
export function wearWords(kind: MeasureKind, plan: WearPlan): string {
  if (kind !== 'tread' && kind !== 'pad') return ''
  const unit = kind === 'tread' ? '/32 in' : ' mm'
  if (plan.lost <= 0) return plan.miles !== null ? 'No measurable wear since the last visit.' : ''
  const parts = [`Down ${fmtNum(plan.lost)}${unit}${plan.miles !== null ? ` in ${plan.miles.toLocaleString('en-US')} miles` : ' since the last visit'}.`]
  if (plan.milesLeft !== null) parts.push(plan.milesLeft === 0 ? 'Already at the replace line.' : `About ${plan.milesLeft.toLocaleString('en-US')} miles until the replace line.`)
  return parts.join(' ')
}
