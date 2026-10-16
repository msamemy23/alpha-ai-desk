// The parts markup rules as the Settings screen edits them, kept free of React so they can be tested on their own.
//
// A shop writes rules by part cost ("up to $50: 100%, up to $200: 60%, above that: 40%"). This file turns what was typed into
// the stored rules (checking every row first) and decides when the editor may suggest a price from them. The price itself is
// always worked out by matrixPrice in doc-pricing.ts. Nothing here reads or writes a document.

import { matrixPrice, normalizeMatrix } from '@/lib/doc-pricing'
import type { MarkupMatrix, MarkupTier, RoundTo } from '@/lib/doc-pricing'

export interface RuleRow { key: string; upTo: string; pct: string }
export interface RuleDraft { enabled: boolean; mode: 'markup' | 'margin'; roundTo: RoundTo; rows: RuleRow[] }

export const MAX_RULES = 12

export function matrixToDraft(m: MarkupMatrix): RuleDraft {
  return {
    enabled: m.enabled === true,
    mode: m.mode,
    roundTo: m.roundTo,
    rows: m.tiers.map((t, i) => ({ key: `r${i}`, upTo: t.upTo === null ? '' : String(t.upTo), pct: String(t.pct) })),
  }
}

/** The same rules, ignoring the keys rows were given on screen. Used to tell whether anything was changed. */
export function sameDraft(a: RuleDraft, b: RuleDraft): boolean {
  const flat = (d: RuleDraft) => JSON.stringify([d.enabled, d.mode, d.roundTo, d.rows.map((r) => [r.upTo.trim(), r.pct.trim()])])
  return flat(a) === flat(b)
}

const number = (s: string): number => {
  const t = s.replace(/[$,%\s]/g, '')
  return t === '' ? NaN : Number(t)
}

export interface DraftResult {
  /** The rules the valid rows make, in the form they are stored. */
  matrix: MarkupMatrix
  /** A problem with one row, by the row's key. Saving is blocked while there are any. */
  rowErrors: Record<string, string>
  /** A problem with the rules as a whole, or an empty string. */
  problem: string
}

/** Checks what was typed and builds the stored rules from it. A row left completely empty is ignored. */
export function draftToMatrix(d: RuleDraft): DraftResult {
  const rowErrors: Record<string, string> = {}
  const tiers: MarkupTier[] = []
  const top = d.mode === 'margin' ? 95 : 1000
  const seen = new Set<string>()
  let unlimited = 0

  for (const row of d.rows) {
    const upToText = row.upTo.trim()
    const pctText = row.pct.trim()
    if (!upToText && !pctText) continue

    const pct = number(pctText)
    if (!Number.isFinite(pct) || pct < 0) { rowErrors[row.key] = 'Enter a percent, like 30.'; continue }
    if (pct > top) { rowErrors[row.key] = d.mode === 'margin' ? 'A margin can be at most 95%.' : 'A markup can be at most 1000%.'; continue }

    if (!upToText) {
      unlimited += 1
      if (unlimited > 1) { rowErrors[row.key] = 'Only one rule can have no upper limit.'; continue }
      tiers.push({ upTo: null, pct })
      continue
    }
    const upTo = number(upToText)
    if (!Number.isFinite(upTo) || upTo < 0) { rowErrors[row.key] = 'Enter a cost like 50.00, or leave it empty for no limit.'; continue }
    const key = upTo.toFixed(2)
    if (seen.has(key)) { rowErrors[row.key] = 'Two rules end at the same cost.'; continue }
    seen.add(key)
    tiers.push({ upTo, pct })
  }

  const matrix = { ...normalizeMatrix({ mode: d.mode, roundTo: d.roundTo, tiers }), enabled: d.enabled }
  const problem = d.enabled && matrix.tiers.length === 0 && Object.keys(rowErrors).length === 0 ? 'Add at least one rule before you turn suggestions on.' : ''
  return { matrix, rowErrors, problem }
}

/** True when the rules cannot price a part above the highest limit, so the screen can say so. */
export function topIsCapped(m: MarkupMatrix): number | null {
  const last = m.tiers[m.tiers.length - 1]
  return last && last.upTo !== null ? last.upTo : null
}

/**
 * The price the editor may suggest for a part cost, or null. Only when the shop turned the rules on and there is at least
 * one rule. With the switch off (how every shop starts) there is no suggestion, so nothing about pricing a part changes.
 * The suggestion is shown beside the part with a button; it is never applied on its own.
 */
export function markupSuggestion(matrix: MarkupMatrix | null | undefined, cost: unknown): number | null {
  if (!matrix || matrix.enabled !== true || matrix.tiers.length === 0) return null
  return matrixPrice(matrix, cost)
}
