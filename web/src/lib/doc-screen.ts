// Small decisions the estimate and invoice screen makes, kept free of React so they can be tested on their own.
//
// Nothing here prices anything. Totals, tax and locking stay in document-money.ts and doc-write.ts; this file only
// decides which menu entries to offer, builds the text of a note, and turns an earlier version into form fields.

import { REVISION_FIELDS } from '@/lib/doc-history'
import { cleanJobName } from '@/lib/doc-lines'
import { roundMoney } from '@/lib/document-money'

type Rec = Record<string, unknown>
const text = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v))

/** Money has been taken on this document. It stays on the books, so it can be neither voided nor deleted. */
export function hasMoneyTaken(doc: { status?: unknown; amount_paid?: unknown }): boolean {
  const status = text(doc.status)
  return status === 'Paid' || status === 'Partial' || Number(doc.amount_paid) > 0
}

export type RemoveOffer = 'delete' | 'void' | 'blocked'

/**
 * Which way out the document menu offers. A draft nobody saw, or a document that is already void, can be deleted.
 * Anything that was sent or worked on is voided instead (it stays on record with a reason). Anything with payments on
 * it can be neither. The server enforces all of this again; this only decides what to show.
 */
export function removeOffer(doc: { status?: unknown; amount_paid?: unknown }): RemoveOffer {
  if (hasMoneyTaken(doc)) return 'blocked'
  const status = text(doc.status)
  return status === '' || status === 'Draft' || status === 'Void' ? 'delete' : 'void'
}

export const isVoid = (doc: { status?: unknown }): boolean => text(doc.status) === 'Void'

/** A document with a customer link out: it was sent, or a signature was asked for. Used only to word the void sheet. */
export function mayHaveLinks(doc: { sent_at?: unknown; signature_requested_at?: unknown }): boolean {
  return Boolean(text(doc.sent_at) || text(doc.signature_requested_at))
}

/** "Oct 15, 2026" for a note line, in the shop's own clock. */
export function noteDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function voidNoteLine(kind: 'voided' | 'restored', date: string, reason = ''): string {
  return kind === 'voided' ? `Voided ${date}: ${reason.replace(/\s+/g, ' ').trim()}` : `Restored ${date}`
}

/** Adds one line to the end of the private shop notes, keeping everything already written. */
export function appendNote(existing: unknown, line: string): string {
  const base = text(existing).replace(/\s+$/, '')
  return base ? `${base}\n${line}` : line
}

/**
 * An earlier version as fields for the open form. Only the fields a version is meant to hold are taken (lines, fees,
 * tax, dates, notes, customer and car, warranty). The status, the number and anything about payments are never copied,
 * even when an old version happens to carry them, so putting a version back cannot change money already taken.
 */
export function snapshotToFormPatch(snapshot: unknown): Rec {
  const out: Rec = {}
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return out
  const source = snapshot as Rec
  for (const key of REVISION_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined) out[key] = source[key]
  }
  return out
}

/* ───────────────────────── Declined work to a new draft ───────────────────────── */

export interface DeclinedLike {
  job: string
  amount: number | string
  customer_id?: string | null
  customer_name?: string | null
  vehicle?: string | null
  lines?: { description?: string; total?: number | string }[] | null
}
export interface OwnerLike {
  id: string; name?: string; phone?: string; email?: string
  vehicle_year?: string; vehicle_make?: string; vehicle_model?: string; vehicle_vin?: string; vehicle_plate?: string; vehicle_mileage?: string
}

const norm = (v: unknown): string => text(v).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** "2018 Honda Civic" as year, make and model. A first word that is not a year is part of the make. Null for nothing. */
export function vehicleFromText(value: unknown): { vehicle_year: string; vehicle_make: string; vehicle_model: string } | null {
  const words = text(value).trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return null
  const year = /^(19|20)\d{2}$/.test(words[0]) ? (words.shift() as string) : ''
  const make = words.shift() || ''
  if (!make) return null
  return { vehicle_year: year, vehicle_make: make, vehicle_model: words.join(' ') }
}

/**
 * The fields for a new DRAFT estimate started from work a customer declined. It is only a form to look over and save:
 * nothing is sent, and nothing is stored until Save. The lines are what the customer was quoted, as flat prices,
 * because a declined line keeps its words and its price but not whether it was a part or labor. The draft says so, and
 * lists the original lines in the private notes, so the writer sets parts and labor right before the estimate goes out.
 */
export function declinedDraft(work: DeclinedLike, owner: OwnerLike | null, declinedOn: string): { fields: Rec; lineCount: number } {
  const job = cleanJobName(work.job) || 'Declined work'
  const rows = (Array.isArray(work.lines) ? work.lines : [])
    .map((l) => ({ description: text(l?.description).replace(/\s+/g, ' ').trim().slice(0, 120), total: roundMoney(Math.max(0, Number(l?.total) || 0)) }))
    .filter((r) => r.description)
    .slice(0, 40)
  const labors = (rows.length ? rows : [{ description: job, total: roundMoney(Math.max(0, Number(work.amount) || 0)) }])
    .map((r) => ({ operation: r.description, tech: '', pricing: 'flat', amount: r.total, job }))

  const fields: Rec = { labors }
  const name = text(work.customer_name).trim()
  if (owner) {
    Object.assign(fields, { customer_id: owner.id, customer_name: owner.name || name, customer_phone: owner.phone ?? '', customer_email: owner.email ?? '' })
  } else if (name) fields.customer_name = name

  // The car on the declined estimate. The customer's own record is used when it is the same car, because it keeps a
  // make like "Land Rover" in one piece; otherwise the words are split.
  const carText = text(work.vehicle).trim()
  const ownerCar = owner ? [owner.vehicle_year, owner.vehicle_make, owner.vehicle_model].filter(Boolean).join(' ') : ''
  if (owner && ownerCar && (!carText || norm(carText) === norm(ownerCar))) {
    Object.assign(fields, { vehicle_year: owner.vehicle_year ?? '', vehicle_make: owner.vehicle_make ?? '', vehicle_model: owner.vehicle_model ?? '', vehicle_vin: owner.vehicle_vin ?? '', vehicle_plate: owner.vehicle_plate ?? '', vehicle_mileage: owner.vehicle_mileage ?? '' })
  } else {
    const parsed = vehicleFromText(carText)
    if (parsed) Object.assign(fields, parsed)
  }

  const quoted = rows.map((r) => `${r.description} $${r.total.toFixed(2)}`).join('; ')
  fields.internal_notes = `Started from work declined ${declinedOn}: ${job}, quoted at $${roundMoney(Math.max(0, Number(work.amount) || 0)).toFixed(2)}.${quoted ? ` Lines: ${quoted}.` : ''}`
  return { fields, lineCount: labors.length }
}

/** The days a declined job waits before it is brought up again. */
export const SNOOZE_DAYS = 30

/* ───────────────────────── Canned jobs ───────────────────────── */

/**
 * A canned job with a version for some cars, a fee or a note for the customer has something to choose or read before it
 * goes on a document. One without any of those adds in one tap, exactly as a canned job always has.
 */
export function cannedNeedsChoice(extras: { variants?: unknown[]; fees?: unknown[]; note?: unknown } | null | undefined): boolean {
  if (!extras) return false
  return (Array.isArray(extras.variants) && extras.variants.length > 0) || (Array.isArray(extras.fees) && extras.fees.length > 0) || text(extras.note).trim() !== ''
}

/* ───────────────────────── Templates ───────────────────────── */

export interface TemplateLike {
  parts?: unknown
  labors?: unknown
  shop_supplies?: unknown
  notes?: unknown
  warranty_type?: unknown
}

const asRecords = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter((l): l is Rec => Boolean(l && typeof l === 'object' && !Array.isArray(l))) : [])

/** A template line as a fresh line on a new document: not approved, and a part starts out as ordered. */
function freshLine(line: Rec, isPart: boolean): Rec {
  const { approved, ...rest } = line
  void approved
  if (isPart && typeof rest.status === 'string') rest.status = 'Ordered'
  return rest
}

export interface TemplateUse {
  /** Fields to put on the open form: the document's lines plus the template's, and notes and supplies only if it had none. */
  patch: Rec
  addedParts: number
  addedLabors: number
  /** The warranty label to apply with the usual warranty preset, or '' when the document keeps its own. */
  warranty: string
}

/**
 * What starting from a template does to the open document. Its lines are added after the lines already there; its notes,
 * shop supplies and warranty are used only where the document has none of its own, so nothing already written is lost.
 * A document with money taken on it, or a void one, gets nothing (null). The customer, the car and the number are never
 * touched, and nothing is saved here: the result is only a change to the open form.
 */
export function applyTemplate(doc: Rec, template: TemplateLike): TemplateUse | null {
  if (hasMoneyTaken(doc) || isVoid(doc)) return null
  const newParts = asRecords(template.parts).map((l) => freshLine(l, true))
  const newLabors = asRecords(template.labors).map((l) => freshLine(l, false))
  const patch: Rec = {}
  if (newParts.length) patch.parts = [...asRecords(doc.parts), ...newParts]
  if (newLabors.length) patch.labors = [...asRecords(doc.labors), ...newLabors]
  const supplies = roundMoney(Math.max(0, Number(template.shop_supplies) || 0))
  if (supplies > 0 && !(Number(doc.shop_supplies) > 0)) patch.shop_supplies = supplies
  const notes = text(template.notes).trim()
  if (notes && !text(doc.notes).trim()) patch.notes = notes
  const label = text(template.warranty_type).trim()
  const has = text(doc.warranty_type).trim()
  const warranty = label && label !== 'No Warranty' && (!has || has === 'No Warranty') ? label : ''
  return { patch, addedParts: newParts.length, addedLabors: newLabors.length, warranty }
}

/** A starting name for a new template: the first job on the document, else its first labor line or part. */
export function templateName(doc: Rec): string {
  const lines = [...asRecords(doc.labors), ...asRecords(doc.parts)]
  for (const l of lines) {
    const job = cleanJobName(l.job)
    if (job) return job.slice(0, 80)
  }
  const first = text(asRecords(doc.labors)[0]?.operation).trim() || text(asRecords(doc.parts)[0]?.name).trim()
  return first.replace(/\s+/g, ' ').slice(0, 80)
}
