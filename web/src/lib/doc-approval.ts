// What happens when a customer answers an estimate: which jobs they accept, which option they pick,
// what the document looks like afterwards, and the fingerprint that proves what they saw.
//
// Pure functions only. The routes load data, call these, and write the result. Totals always come from
// calculateDocumentTotals (document-money.ts), applied to the lines that are left, so a partly
// approved estimate is priced by exactly the same rules as any other document.

import { calculateDocumentTotals } from '@/lib/document-money'
import { cleanJobName, groupJobs, jobKeyOf } from '@/lib/doc-lines'
import type { JobGroup, Line } from '@/lib/doc-lines'
import { suppliesAfterChange, suppliesBase } from '@/lib/doc-pricing'
import type { SuppliesRule } from '@/lib/doc-pricing'

type DocLike = Record<string, unknown>
const asLines = (v: unknown): Line[] =>
  Array.isArray(v) ? v.filter((line): line is Line => Boolean(line && typeof line === 'object')) : []
const text = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v))

/* ───────────────────────── Dates and link state ───────────────────────── */

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

export function isIsoDay(v: unknown): v is string {
  if (typeof v !== 'string' || !ISO_DAY.test(v)) return false
  const d = new Date(`${v}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + Math.round(days))
  return d.toISOString().slice(0, 10)
}

export function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(`${toIso}T00:00:00Z`).getTime() - new Date(`${fromIso}T00:00:00Z`).getTime()) / 86400000)
}

export type ExpiryState = 'none' | 'ok' | 'soon' | 'today' | 'expired'

/** An estimate is good through its expiry date. "Soon" means within three days. */
export function expiryState(expiresDate: unknown, todayIso: string): { state: ExpiryState; daysLeft: number | null } {
  const raw = typeof expiresDate === 'string' ? expiresDate.slice(0, 10) : ''
  if (!isIsoDay(raw)) return { state: 'none', daysLeft: null }
  const left = daysBetween(todayIso, raw)
  if (left < 0) return { state: 'expired', daysLeft: left }
  if (left === 0) return { state: 'today', daysLeft: 0 }
  return { state: left <= 3 ? 'soon' : 'ok', daysLeft: left }
}

export function expiryWords(expiresDate: unknown, todayIso: string): string {
  const { state, daysLeft } = expiryState(expiresDate, todayIso)
  if (state === 'none') return ''
  if (state === 'expired') return `Expired ${Math.abs(daysLeft ?? 0)} ${Math.abs(daysLeft ?? 0) === 1 ? 'day' : 'days'} ago`
  if (state === 'today') return 'Good through today'
  return `Good for ${daysLeft} more ${daysLeft === 1 ? 'day' : 'days'}`
}

export interface LinkLike { expires_at?: string | null; revoked_at?: string | null; completed_at?: string | null }
export type LinkState = 'active' | 'expired' | 'revoked' | 'done'

export function linkState(link: LinkLike, nowMs: number): LinkState {
  if (link.revoked_at) return 'revoked'
  if (link.completed_at) return 'done'
  if (link.expires_at && new Date(link.expires_at).getTime() < nowMs) return 'expired'
  return 'active'
}

/* ───────────────────────── Fingerprints ───────────────────────── */

/** JSON with sorted keys and no undefined, so the same content always gives the same text. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value === undefined ? null : value)
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v)).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort()
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

const LINE_FIELDS = [
  'name', 'description', 'brand', 'part_number', 'partNumber', 'qty', 'unitPrice', 'taxable', 'core', 'warranty', 'kind', 'job', 'note',
  'operation', 'hours', 'rate', 'amount', 'flat_amount', 'flatAmount', 'total', 'pricing', 'listPrice', 'listRate', 'listAmount', 'discountPct', 'approved',
]

function pickLine(line: Line): Line {
  const out: Line = {}
  for (const k of LINE_FIELDS) if (line[k] !== undefined && line[k] !== null && line[k] !== '') out[k] = line[k]
  return out
}

/**
 * The part of a document a customer agrees to: who, what vehicle, every line, tax, fees, notes, terms
 * and the totals. Private fields (your cost, internal notes, phone numbers) are left out.
 */
export function canonicalDocument(doc: DocLike): Record<string, unknown> {
  const t = calculateDocumentTotals(doc)
  return {
    type: text(doc.type),
    doc_number: text(doc.doc_number),
    doc_date: text(doc.doc_date).slice(0, 10),
    expires_date: text(doc.expires_date).slice(0, 10),
    customer_name: text(doc.customer_name),
    vehicle: [doc.vehicle_year, doc.vehicle_make, doc.vehicle_model, doc.vehicle_vin].map(text).join('|'),
    parts: asLines(doc.parts).map(pickLine),
    labors: asLines(doc.labors).map(pickLine),
    tax_rate: t.taxRate,
    apply_tax: t.applyTax,
    shop_supplies: t.shopSupplies,
    sublet: t.sublet,
    deposit: t.deposit,
    notes: text(doc.notes),
    warranty_type: text(doc.warranty_type),
    warranty_months: doc.warranty_months ?? null,
    warranty_mileage: doc.warranty_mileage ?? null,
    warranty_exclusions: text(doc.warranty_exclusions),
    totals: { subtotal: t.subtotal, tax: t.taxAmount, total: t.total },
  }
}

export const contentHash = (doc: DocLike): Promise<string> => sha256Hex(stableStringify(canonicalDocument(doc)))

/* ───────────────────────── Options (good, better, best) ───────────────────────── */

export interface OptionChoice { id: string; label: string; description: string; recommended: boolean; parts: Line[]; labors: Line[] }
export type OptionStatus = 'open' | 'chosen' | 'declined' | 'void'
export interface OptionGroup { id: string; name: string; position: number; status: OptionStatus; choices: OptionChoice[]; chosenChoiceId: string | null }

export function normalizeOptionGroup(row: unknown): OptionGroup | null {
  if (!row || typeof row !== 'object') return null
  const r = row as Record<string, unknown>
  const id = text(r.id)
  const name = cleanJobName(r.name)
  if (!id || !name) return null
  const rawChoices = Array.isArray(r.choices) ? r.choices : []
  const choices = rawChoices
    .map((c): OptionChoice | null => {
      if (!c || typeof c !== 'object') return null
      const o = c as Record<string, unknown>
      const cid = text(o.id)
      const label = text(o.label).replace(/\s+/g, ' ').trim().slice(0, 40)
      if (!cid || !label) return null
      return {
        id: cid, label, description: text(o.description).slice(0, 400), recommended: o.recommended === true,
        parts: asLines(o.parts), labors: asLines(o.labors),
      }
    })
    .filter((c): c is OptionChoice => c !== null)
    .slice(0, 5)
  const status: OptionStatus = r.status === 'chosen' || r.status === 'declined' || r.status === 'void' ? r.status : 'open'
  return { id, name, position: Number(r.position) || 0, status, choices, chosenChoiceId: r.chosen_choice_id ? text(r.chosen_choice_id) : null }
}

export function choiceTotals(choice: Pick<OptionChoice, 'parts' | 'labors'>, doc: DocLike) {
  return calculateDocumentTotals({
    parts: choice.parts, labors: choice.labors, tax_rate: doc.tax_rate, apply_tax: doc.apply_tax, shop_supplies: 0, sublet: 0,
  })
}

/* ───────────────────────── Planning a response ───────────────────────── */

export type Decision = 'approve' | 'decline'
export type Outcome = 'approved' | 'partial' | 'declined'

export interface DeclinedItem { job: string; jobKey: string; amount: number; lines: { description: string; total: number }[] }

export interface ResponsePlan {
  parts: Line[]
  labors: Line[]
  shop_supplies: number
  status: string
  outcome: Outcome
  approvedKeys: string[]
  declinedKeys: string[]
  chosen: { optionId: string; name: string; choiceId: string | null; label: string }[]
  declined: DeclinedItem[]
  totalBefore: number
  totalAfter: number
  /** True when there was nothing to decide (everything already approved). */
  nothingToDecide: boolean
}

export type PlanResult = { ok: true; plan: ResponsePlan } | { ok: false; error: string }

export interface PlanInput {
  doc: DocLike
  options: OptionGroup[]
  decisions: Record<string, unknown>
  optionChoices: Record<string, unknown>
  supplies: SuppliesRule
}

const lineDescription = (l: Line): string => text(l.operation || l.name || l.description).trim() || 'Line'

function totalOfLine(l: Line, isLabor: boolean): number {
  return calculateDocumentTotals({
    parts: isLabor ? [] : [l], labors: isLabor ? [l] : [], tax_rate: 0, apply_tax: false, shop_supplies: 0, sublet: 0,
  }).subtotal
}

export function planResponse(input: PlanInput): PlanResult {
  const { doc, supplies } = input
  const decisions = input.decisions && typeof input.decisions === 'object' ? input.decisions : {}
  const optionChoices = input.optionChoices && typeof input.optionChoices === 'object' ? input.optionChoices : {}
  const groups = groupJobs(doc)
  const pending = groups.filter((g) => !g.approved)
  const openOptions = input.options.filter((o) => o.status === 'open' && o.choices.length > 0)

  const pendingKeys = new Set(pending.map((g) => g.key))
  for (const key of Object.keys(decisions)) {
    if (!pendingKeys.has(key)) return { ok: false, error: 'That answer does not match this estimate. Reload the page and try again.' }
  }
  const verdicts = new Map<string, Decision>()
  for (const g of pending) {
    const v = decisions[g.key]
    if (v !== 'approve' && v !== 'decline') return { ok: false, error: `Choose approve or decline for ${g.name}.` }
    verdicts.set(g.key, v)
  }
  const openIds = new Set(openOptions.map((o) => o.id))
  for (const id of Object.keys(optionChoices)) {
    if (!openIds.has(id)) return { ok: false, error: 'That option is no longer available. Reload the page and try again.' }
  }
  const chosen: ResponsePlan['chosen'] = []
  for (const o of openOptions) {
    const pick = optionChoices[o.id]
    if (pick === 'none') {
      chosen.push({ optionId: o.id, name: o.name, choiceId: null, label: 'No thanks' })
      continue
    }
    const hit = o.choices.find((c) => c.id === pick)
    if (typeof pick !== 'string' || !hit) return { ok: false, error: `Choose an option for ${o.name}, or say no thanks.` }
    chosen.push({ optionId: o.id, name: o.name, choiceId: hit.id, label: hit.label })
  }

  const before = calculateDocumentTotals(doc)
  const baseline = groups.some((g) => g.approved)
  const approvedKeys = groups.filter((g) => g.approved).map((g) => g.key).concat(pending.filter((g) => verdicts.get(g.key) === 'approve').map((g) => g.key))
  const declinedKeys = pending.filter((g) => verdicts.get(g.key) === 'decline').map((g) => g.key)
  const takenOptions = chosen.filter((c) => c.choiceId)
  const nothingToDecide = pending.length === 0 && openOptions.length === 0

  const acceptedAny = pending.some((g) => verdicts.get(g.key) === 'approve') || takenOptions.length > 0
  const outcome: Outcome = !acceptedAny && (pending.length > 0 || openOptions.length > 0)
    ? 'declined'
    : declinedKeys.length > 0 || chosen.some((c) => !c.choiceId) ? 'partial' : 'approved'

  const declinedItems: DeclinedItem[] = declinedKeys.map((key) => {
    const g = groups.find((x) => x.key === key) as JobGroup
    const labors = asLines(doc.labors)
    const parts = asLines(doc.parts)
    return {
      job: g.name, jobKey: key, amount: g.total,
      lines: [
        ...g.laborIdx.map((i) => ({ description: lineDescription(labors[i]), total: totalOfLine(labors[i], true) })),
        ...g.partIdx.map((i) => ({ description: lineDescription(parts[i]), total: totalOfLine(parts[i], false) })),
      ],
    }
  })

  // Everything declined and nothing was approved before: keep the quote as written and mark it declined.
  if (outcome === 'declined' && !baseline) {
    return {
      ok: true,
      plan: {
        parts: asLines(doc.parts), labors: asLines(doc.labors), shop_supplies: before.shopSupplies, status: 'Declined', outcome,
        approvedKeys: [], declinedKeys, chosen, declined: declinedItems, totalBefore: before.total, totalAfter: before.total, nothingToDecide,
      },
    }
  }

  const keep = new Set(approvedKeys)
  const stamp = (l: Line): Line => (l.approved === true ? l : { ...l, approved: true })
  const keptParts = asLines(doc.parts).filter((l) => keep.has(jobKeyOf(l.job))).map(stamp)
  const keptLabors = asLines(doc.labors).filter((l) => keep.has(jobKeyOf(l.job))).map(stamp)

  const optionParts: Line[] = []
  const optionLabors: Line[] = []
  for (const c of takenOptions) {
    const group = openOptions.find((o) => o.id === c.optionId) as OptionGroup
    const choice = group.choices.find((x) => x.id === c.choiceId) as OptionChoice
    const tag = (l: Line): Line => ({ ...l, job: group.name, option: choice.label, approved: true })
    optionParts.push(...choice.parts.map(tag))
    optionLabors.push(...choice.labors.map(tag))
  }

  const parts = [...keptParts, ...optionParts]
  const labors = [...keptLabors, ...optionLabors]

  const removedAny = declinedKeys.length > 0
  let supply = before.shopSupplies
  if (removedAny || takenOptions.length > 0) {
    const afterBase = suppliesBase({ ...doc, parts, labors })
    supply = suppliesAfterChange(supplies, doc.shop_supplies, suppliesBase(doc), afterBase)
  }
  const after = calculateDocumentTotals({ ...doc, parts, labors, shop_supplies: supply })
  const isEstimate = text(doc.type) === 'Estimate'

  return {
    ok: true,
    plan: {
      parts, labors, shop_supplies: supply,
      status: isEstimate ? 'Approved' : text(doc.status) || 'Draft',
      outcome, approvedKeys, declinedKeys, chosen, declined: declinedItems,
      totalBefore: before.total, totalAfter: after.total, nothingToDecide,
    },
  }
}

/** What the page shows while the customer taps: the total if they confirmed right now. */
export function previewTotals(input: PlanInput): { total: number; subtotal: number; tax: number } | null {
  const planned = planResponse({
    ...input,
    decisions: { ...defaultDecisions(input.doc, 'approve'), ...input.decisions },
    optionChoices: { ...defaultOptionChoices(input.options), ...input.optionChoices },
  })
  if (!planned.ok) return null
  const t = calculateDocumentTotals({ ...input.doc, parts: planned.plan.parts, labors: planned.plan.labors, shop_supplies: planned.plan.shop_supplies })
  if (planned.plan.outcome === 'declined' && !groupJobs(input.doc).some((g) => g.approved)) return { total: 0, subtotal: 0, tax: 0 }
  return { total: t.total, subtotal: t.subtotal, tax: t.taxAmount }
}

export function defaultDecisions(doc: DocLike, value: Decision): Record<string, Decision> {
  const out: Record<string, Decision> = {}
  for (const g of groupJobs(doc)) if (!g.approved) out[g.key] = value
  return out
}

export function defaultOptionChoices(options: OptionGroup[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const o of options) {
    if (o.status !== 'open' || o.choices.length === 0) continue
    out[o.id] = (o.choices.find((c) => c.recommended) ?? o.choices[0]).id
  }
  return out
}

export const jobsNeedingAnswer = (doc: DocLike): JobGroup[] => groupJobs(doc).filter((g) => !g.approved)

export function outcomeWords(outcome: Outcome, approved: number, declined: number): string {
  if (outcome === 'approved') return approved === 1 ? 'Approved' : 'Approved all work'
  if (outcome === 'declined') return 'Declined'
  return `Approved ${approved}, declined ${declined}`
}

/* ───────────────────────── Signature record (tamper evident) ───────────────────────── */

export interface SignatureRecordInput {
  documentId: string
  docNumber: string
  contentHash: string
  signerName: string
  signedAt: string
  ip: string
  userAgent: string
  decisions: Record<string, string>
  options: Record<string, string>
  note: string
  signatureHash: string
  method: 'drawn' | 'typed' | 'click'
}

/** The text that is hashed. Changing any stored field changes the hash. */
export function signatureRecordText(r: SignatureRecordInput): string {
  return stableStringify({
    v: 1,
    documentId: r.documentId,
    docNumber: r.docNumber,
    contentHash: r.contentHash,
    signerName: r.signerName,
    signedAt: r.signedAt,
    ip: r.ip,
    userAgent: r.userAgent,
    decisions: r.decisions,
    options: r.options,
    note: r.note,
    signatureHash: r.signatureHash,
    method: r.method,
  })
}

export const signatureRecordHash = (r: SignatureRecordInput): Promise<string> => sha256Hex(signatureRecordText(r))

export async function verifySignatureRecord(r: SignatureRecordInput, storedHash: string, signatureImage: string | null): Promise<{ ok: boolean; reason: string }> {
  if (!storedHash) return { ok: false, reason: 'No record fingerprint was saved.' }
  const imageHash = signatureImage ? await sha256Hex(signatureImage) : ''
  if ((r.signatureHash || '') !== imageHash) return { ok: false, reason: 'The signature image does not match the saved fingerprint.' }
  const again = await signatureRecordHash(r)
  return again === storedHash ? { ok: true, reason: 'The record matches its saved fingerprint.' } : { ok: false, reason: 'The record was changed after it was saved.' }
}

