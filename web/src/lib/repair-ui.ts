/**
 * Plain helpers for the Repair info screen. No imports, so the tests can load this file on its own.
 * The money rules here are the same ones the screen always used: a typed total is split into whole cents across the
 * labor lines, and nothing is invented when the total is missing.
 */

/** What a person typed as a dollar amount ("430", "$1,200.50", " 99 "). Null unless it is a number above zero. */
export function parseTotal(value: string): number | null {
  const cleaned = String(value ?? '').replace(/[$,\s]/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** Splits a total into `count` pieces that add up to the total exactly, to the cent. */
export function allocateTotal(total: number, count: number): number[] {
  const lineCount = Math.max(1, count)
  const cents = Math.round(total * 100)
  const base = Math.floor(cents / lineCount)
  const remainder = cents - base * lineCount
  return Array.from({ length: lineCount }, (_unused, index) => (base + (index < remainder ? 1 : 0)) / 100)
}

/** "Brake pads, rotors" or one item per line becomes a clean list. */
export function splitList(text: string): string[] {
  return String(text ?? '').split(/\r?\n|,/).map(item => item.trim()).filter(Boolean)
}

interface OperationLike { kind: string; label: string; sourceStatus: string; risk: string }
interface DraftLike { targetTotal: number | null; totalLocked: boolean; parts: unknown[]; labors: unknown[]; notes: string }

/**
 * The estimate draft with the typed total spread over the labor lines (or, when there are none, every line that is not a
 * part). A blank or unusable total leaves the draft exactly as the search returned it.
 */
export function draftForTotal<D extends DraftLike>(draft: D, lines: OperationLike[], totalText: string, fallbackLabel = 'Repair labor'): D {
  const total = parseTotal(totalText)
  if (total === null) return draft
  const priced = lines.filter(line => line.kind === 'labor')
  const estimateLines = priced.length ? priced : lines.filter(line => line.kind !== 'parts')
  const amounts = allocateTotal(total, estimateLines.length || 1)
  let amountIndex = 0
  // With nothing but parts to price, the whole total goes on one labor line so the estimate never saves empty.
  const labors = estimateLines.length
    ? estimateLines.map(line => ({
      operation: line.label,
      amount: amounts[amountIndex++],
      pricing: 'flat',
      source_status: line.sourceStatus,
      risk: line.risk,
    }))
    : [{ operation: fallbackLabel, amount: amounts[0], pricing: 'flat', source_status: 'needs_source', risk: 'standard' }]
  return {
    ...draft,
    targetTotal: total,
    totalLocked: true,
    parts: [],
    labors,
    notes: `${draft.notes}\nLocked total entered in Repair Workspace: $${total.toFixed(2)}.`,
  }
}

/** The vehicle as one line for a heading. */
export function vehicleLabel(vehicle: { year?: string; make?: string; model?: string; trim?: string; engine?: string } | null | undefined): string {
  if (!vehicle) return 'Vehicle not fully identified'
  return [vehicle.year, vehicle.make, vehicle.model, vehicle.trim, vehicle.engine].filter(Boolean).join(' ').trim() || 'Vehicle not fully identified'
}

const LABEL_OVERRIDES: Record<string, string> = {
  'Pick Engine First': 'Pick the engine first',
  'Open The Info': 'Open the info',
  'Build Estimate From This': 'Build an estimate from this',
  'Location To Check': 'Where to look',
  'What To Check First': 'What to check first',
}

/**
 * Wording that comes from the lookup in Title Case ("Open Fuse/Relay Info") shown in sentence case instead
 * ("Open fuse/relay info"). Words with digits or more than one capital (OEM1Stop, DTC) are left alone.
 */
export function plainLabel(text: string): string {
  const t = String(text ?? '')
  if (LABEL_OVERRIDES[t]) return LABEL_OVERRIDES[t]
  return t.replace(/\b[A-Z][a-z]+\b/g, (word, offset: number) => (offset === 0 ? word : word.toLowerCase()))
}

/** Manual diagrams load through our own address, because the manual sites can refuse other sites showing their images. */
export function proxiedImage(url: string): string {
  return `/api/repair-image?url=${encodeURIComponent(url)}`
}
