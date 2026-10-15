// A shop's paperwork settings: how long estimates stay good, the terms printed on them, the markup
// matrix, labor rates, supplies rule, fee presets, accent color and warranty wording.
//
// Stored in one row per shop in document_settings (migration 047), as a single JSON object. This file
// turns whatever is stored (or nothing, when the migration has not been applied) into a safe,
// complete object, so the screens never have to guess.

import { addDaysIso, isIsoDay } from '@/lib/doc-approval'
import { DEFAULT_MATRIX, DEFAULT_SUPPLIES, normalizeMatrix, normalizeRates, normalizeSupplies } from '@/lib/doc-pricing'
import type { LaborRates, MarkupMatrix, SuppliesRule } from '@/lib/doc-pricing'
import type { WarrantyOverride } from '@/lib/doc-warranty'

export interface FeePreset { id: string; name: string; amount: number; taxable: boolean; kind: 'fee' | 'sublet' }

export interface DocPrefs {
  /** Days an estimate stays good after its date. 0 means it does not expire. */
  estimateExpiryDays: number
  /** Days after the invoice date that payment is due. 0 means due on receipt. */
  invoiceDueDays: number
  /** Shown above the lines on the customer page and in the email. */
  intro: string
  /** Terms printed at the bottom of every estimate and invoice. */
  terms: string
  /** Last line of the paper and the email, below the shop details. */
  footer: string
  /** A #rrggbb color for headings and the main button on customer pages. Empty uses the app color. */
  accent: string
  /** The customer must draw or type a signature to approve. If off, tapping approve is enough. */
  requireSignature: boolean
  matrix: MarkupMatrix
  rates: LaborRates
  supplies: SuppliesRule
  fees: FeePreset[]
  warranty: WarrantyOverride[]
  /** Text message when sending an estimate or invoice. {shop} {name} {type} {number} {total} {link} are replaced. */
  smsTemplate: string
}

export const DEFAULT_SMS_TEMPLATE = 'Hi {name}, your {type} {number} from {shop} is ready. Total {total}. Review it here: {link}'

export const DEFAULT_PREFS: DocPrefs = {
  estimateExpiryDays: 30,
  invoiceDueDays: 0,
  intro: '',
  terms: '',
  footer: '',
  accent: '',
  requireSignature: true,
  matrix: DEFAULT_MATRIX,
  rates: { defaultRate: null, types: [], techs: [] },
  supplies: DEFAULT_SUPPLIES,
  fees: [],
  warranty: [],
  smsTemplate: DEFAULT_SMS_TEMPLATE,
}

const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\r\n/g, '\n').slice(0, max) : '')
const intIn = (v: unknown, lo: number, hi: number, fallback: number): number => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback
}

export const isHexColor = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v)

export function normalizeFees(raw: unknown): FeePreset[] {
  return (Array.isArray(raw) ? raw : [])
    .map((f, i): FeePreset | null => {
      if (!f || typeof f !== 'object') return null
      const o = f as Record<string, unknown>
      const name = text(o.name, 60).replace(/\s+/g, ' ').trim()
      const amount = Number(o.amount)
      if (!name || !Number.isFinite(amount) || amount < 0 || amount > 100000) return null
      return {
        id: text(o.id, 40) || `fee${i}`,
        name,
        amount: Math.round(amount * 100) / 100,
        taxable: o.taxable !== false,
        kind: o.kind === 'sublet' ? 'sublet' : 'fee',
      }
    })
    .filter((f): f is FeePreset => f !== null)
    .slice(0, 20)
}

function normalizeWarranty(raw: unknown): WarrantyOverride[] {
  return (Array.isArray(raw) ? raw : [])
    .map((w): WarrantyOverride | null => {
      if (!w || typeof w !== 'object') return null
      const o = w as Record<string, unknown>
      const label = text(o.label, 120).trim()
      if (!label) return null
      const out: WarrantyOverride = { label, exclusions: text(o.exclusions, 12000) }
      if (o.months !== undefined && o.months !== null && o.months !== '') out.months = intIn(o.months, 0, 600, 0)
      if (o.mileage !== undefined && o.mileage !== null && o.mileage !== '') out.mileage = intIn(o.mileage, 0, 1000000, 0)
      return out
    })
    .filter((w): w is WarrantyOverride => w !== null)
    .slice(0, 30)
}

/** Whatever was stored becomes a complete, bounded settings object. Unknown keys are dropped. */
export function normalizePrefs(raw: unknown): DocPrefs {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    estimateExpiryDays: intIn(r.estimateExpiryDays, 0, 365, DEFAULT_PREFS.estimateExpiryDays),
    invoiceDueDays: intIn(r.invoiceDueDays, 0, 365, DEFAULT_PREFS.invoiceDueDays),
    intro: text(r.intro, 1000),
    terms: text(r.terms, 6000),
    footer: text(r.footer, 300),
    accent: isHexColor(r.accent) ? r.accent.toLowerCase() : '',
    requireSignature: r.requireSignature !== false,
    matrix: normalizeMatrix(r.matrix),
    rates: normalizeRates(r.rates),
    supplies: normalizeSupplies(r.supplies),
    fees: normalizeFees(r.fees),
    warranty: normalizeWarranty(r.warranty),
    smsTemplate: text(r.smsTemplate, 480).trim() || DEFAULT_SMS_TEMPLATE,
  }
}

/** Black or white, whichever reads better on the given #rrggbb background. */
export function readableOn(hex: string): '#000000' | '#ffffff' {
  if (!isHexColor(hex)) return '#ffffff'
  const n = parseInt(hex.slice(1), 16)
  const lin = (c: number) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  const lum = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
  return lum > 0.4 ? '#000000' : '#ffffff'
}

export interface SmsFields { shop: string; name: string; type: string; number: string; total: string; link: string }

/** Fills the text message template. Unknown {words} are left out rather than printed. */
export function renderSms(template: string, f: SmsFields): string {
  const map: Record<string, string> = { shop: f.shop, name: f.name, type: f.type, number: f.number, total: f.total, link: f.link }
  const out = (template || DEFAULT_SMS_TEMPLATE).replace(/\{(\w+)\}/g, (_m, k: string) => (k in map ? map[k] : ''))
  return out.replace(/ {2,}/g, ' ').replace(/ ([.,!?])/g, '$1').trim()
}

/** Due date for an invoice, or the expiry date for an estimate, from the document date. */
export function dueFrom(dateIso: string, days: number): string | null {
  return days > 0 && isIsoDay(dateIso) ? addDaysIso(dateIso, days) : null
}
