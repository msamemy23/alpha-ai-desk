// What a customer is allowed to see when they open a document link.
//
// The signing page gets this object and nothing else. It is built from the stored document with an
// allow-list, so private fields (your cost on parts, private notes, phone and email on file, the
// shop's provider settings) can never reach the customer page by accident.

import { calculateDocumentTotals } from '@/lib/document-money'
import { displayLines, groupJobs } from '@/lib/doc-lines'
import type { DisplayLine } from '@/lib/doc-lines'
import { canonicalDocument, choiceTotals, expiryState, expiryWords, sha256Hex, stableStringify } from '@/lib/doc-approval'
import type { ExpiryState, OptionGroup } from '@/lib/doc-approval'
import { discountSummary } from '@/lib/doc-pricing'
import { renderWarrantyText, warrantyHeadline } from '@/lib/doc-warranty'
import type { DocPrefs } from '@/lib/doc-prefs'

type DocLike = Record<string, unknown>
const text = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v))

export interface PublicShop { name: string; address: string; phone: string; email: string; hasLogo: boolean }

export interface PublicGroup {
  key: string
  name: string
  approved: boolean
  lines: DisplayLine[]
  subtotal: number
  tax: number
  total: number
}

export interface PublicChoice {
  id: string
  label: string
  description: string
  recommended: boolean
  lines: DisplayLine[]
  subtotal: number
  tax: number
  total: number
}

export interface PublicOption { id: string; name: string; status: string; chosenChoiceId: string | null; choices: PublicChoice[] }

export interface PublicTotals {
  laborTotal: number
  partsTotal: number
  coreTotal: number
  shopSupplies: number
  sublet: number
  taxRate: number
  applyTax: boolean
  taxAmount: number
  subtotal: number
  total: number
  amountPaid: number
  balanceDue: number
  deposit: number
  discount: number
}

export interface PublicDocument {
  kind: 'estimate' | 'invoice' | 'receipt'
  docType: string
  docNumber: string
  docDate: string
  expiresDate: string
  dueDate: string
  status: string
  customerName: string
  vehicle: string
  mileage: string
  groups: PublicGroup[]
  options: PublicOption[]
  totals: PublicTotals
  notes: string
  warranty: { headline: string; text: string }
  terms: string
  intro: string
  footer: string
  accent: string
  expiry: { state: ExpiryState; daysLeft: number | null; words: string }
  contentHash: string
  requireSignature: boolean
  /** The customer has jobs or options to answer. */
  needsAnswer: boolean
  /** The customer can still act on this link. */
  canRespond: boolean
  /** Reason the customer cannot answer, in plain words, or empty. */
  closedReason: string
  signedAt: string
  signerName: string
  /** Where a later payment feature mounts. balanceDue is what would be paid. */
  pay: { available: boolean; balanceDue: number; deposit: number }
}

/** What the signed copy shows: who answered, how, when, and the fingerprint of the saved record. */
export interface PublicSigned {
  name: string
  at: string
  method: string
  device: string
  outcome: string
  recordId: string
  signatureData: string | null
  note: string
  declined: { job: string; amount: number }[]
  totalBefore: number
  totalAfter: number
}

/** The whole answer to a customer opening their link. */
export interface PublicPage {
  ok: true
  mode: 'link' | 'legacy'
  link: { state: 'active' | 'done'; expiresAt: string; purpose: string }
  shop: PublicShop
  doc: PublicDocument
  signed: PublicSigned | null
  canDecideByJob: boolean
}

export interface BuildPublicInput {
  doc: DocLike
  options: OptionGroup[]
  prefs: DocPrefs
  shop: PublicShop
  todayIso: string
  signedAt?: string | null
  signerName?: string | null
}

function groupLines(lines: DisplayLine[], key: string): DisplayLine[] {
  return lines.filter((l) => l.jobKey === key)
}

export async function buildPublicDocument(input: BuildPublicInput): Promise<PublicDocument> {
  const { doc, options, prefs, shop, todayIso } = input
  const t = calculateDocumentTotals(doc)
  const lines = displayLines(doc)
  const groups: PublicGroup[] = groupJobs(doc).map((g) => ({
    key: g.key, name: g.name, approved: g.approved, lines: groupLines(lines, g.key),
    subtotal: g.subtotal, tax: g.tax, total: g.total,
  }))
  const openOptions: PublicOption[] = options
    .filter((o) => o.status !== 'void' && o.choices.length > 0)
    .map((o) => ({
      id: o.id, name: o.name, status: o.status, chosenChoiceId: o.chosenChoiceId,
      choices: o.choices.map((c) => {
        const ct = choiceTotals(c, doc)
        return {
          id: c.id, label: c.label, description: c.description, recommended: c.recommended,
          lines: displayLines({ parts: c.parts, labors: c.labors }), subtotal: ct.subtotal, tax: ct.taxAmount, total: ct.total,
        }
      }),
    }))

  const type = text(doc.type) || 'Estimate'
  const kind: PublicDocument['kind'] = type === 'Invoice' ? 'invoice' : type === 'Receipt' ? 'receipt' : 'estimate'
  const status = text(doc.status)
  const expiry = expiryState(doc.expires_date, todayIso)
  const pendingJobs = groups.some((g) => !g.approved)
  const openOptionCount = openOptions.filter((o) => o.status === 'open').length
  const needsAnswer = kind === 'estimate' && (pendingJobs || openOptionCount > 0) && status !== 'Void' && status !== 'Declined'

  let closedReason = ''
  if (status === 'Void') closedReason = 'This document was cancelled by the shop. Call the shop if you have questions.'
  else if (kind === 'estimate' && expiry.state === 'expired' && needsAnswer) closedReason = 'This estimate has expired, so prices may have changed. Call the shop and we will update it.'
  else if (status === 'Declined') closedReason = 'You declined this estimate. Call the shop if you change your mind.'

  // The fingerprint covers the document and the open options, so a change to either after the customer
  // opened the page is caught when they answer.
  const optionCanon = openOptions
    .filter((o) => o.status === 'open')
    .map((o) => ({ id: o.id, name: o.name, choices: o.choices.map((c) => ({ id: c.id, label: c.label, total: c.total, lines: c.lines.map((l) => [l.kind, l.description, l.total]) })) }))
  const hash = await sha256Hex(stableStringify([canonicalDocument(doc), optionCanon]))
  const saved = discountSummary(doc).total

  return {
    kind,
    docType: type,
    docNumber: text(doc.doc_number),
    docDate: text(doc.doc_date).slice(0, 10),
    expiresDate: text(doc.expires_date).slice(0, 10),
    dueDate: text(doc.due_date).slice(0, 10),
    status,
    customerName: text(doc.customer_name),
    vehicle: [doc.vehicle_year, doc.vehicle_make, doc.vehicle_model].map(text).filter(Boolean).join(' '),
    mileage: text(doc.vehicle_mileage),
    groups,
    options: openOptions,
    totals: {
      laborTotal: t.laborTotal, partsTotal: t.partsTotal, coreTotal: t.coreTotal, shopSupplies: t.shopSupplies, sublet: t.sublet,
      taxRate: t.taxRate, applyTax: t.applyTax, taxAmount: t.taxAmount, subtotal: t.subtotal, total: t.total,
      amountPaid: t.amountPaid, balanceDue: t.balanceDue, deposit: t.deposit, discount: saved,
    },
    notes: text(doc.notes),
    warranty: {
      headline: warrantyHeadline(doc.warranty_months, doc.warranty_mileage),
      text: renderWarrantyText(doc.warranty_exclusions, shop.name),
    },
    terms: prefs.terms,
    intro: prefs.intro,
    footer: prefs.footer,
    accent: prefs.accent,
    expiry: { state: expiry.state, daysLeft: expiry.daysLeft, words: expiryWords(doc.expires_date, todayIso) },
    contentHash: hash,
    requireSignature: prefs.requireSignature,
    needsAnswer,
    canRespond: closedReason === '',
    closedReason,
    signedAt: input.signedAt || '',
    signerName: input.signerName || '',
    pay: { available: false, balanceDue: t.balanceDue, deposit: t.deposit },
  }
}
