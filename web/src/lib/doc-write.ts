// Rules for writing estimates, invoices and receipts from the browser screens, kept free of the database so they can be tested.
// The route in app/api/documents uses these. The service client does the writing, so every check that RLS used to do for
// the browser (right shop, right owner of the customer and job, no edits to money once it is taken) happens here and there.

/** The columns a screen may set on a document. Anything else (shop_id, amount_paid, id) is dropped. */
export const DOC_FIELDS = [
  'type', 'doc_number', 'status', 'doc_date', 'due_date', 'expires_date', 'customer_id', 'customer_name', 'job_id',
  'vehicle_year', 'vehicle_make', 'vehicle_model', 'vehicle_vin', 'vehicle_plate', 'vehicle_mileage',
  'parts', 'labors', 'shop_supplies', 'sublet', 'tax_rate', 'apply_tax', 'deposit', 'payment_method', 'cashier',
  'payment_terms', 'payment_methods', 'warranty_type', 'warranty_months', 'warranty_mileage', 'warranty_start',
  'warranty_exclusions', 'warranty_claim', 'notes', 'internal_notes', 'locked', 'sent_at', 'created_at', 'updated_at',
  'customer_phone', 'customer_email', 'signature_signed_at', 'signature_signer_name', 'signature_requested_at',
  'line_items', 'payment_plan',
] as const

export const DOC_TYPES = ['Estimate', 'Invoice', 'Receipt'] as const
export type DocKind = (typeof DOC_TYPES)[number]

export function isDocType(value: unknown): value is DocKind {
  return typeof value === 'string' && (DOC_TYPES as readonly string[]).includes(value)
}

/** Only these statuses may be set when a document is created. Paid and Partial come only from a recorded payment. */
const CREATE_STATUSES = new Set(['Draft', 'Sent', 'Approved', 'Declined', 'Unpaid'])

const PAID = new Set(['Paid', 'Partial'])

export function pickDocFields(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
  const source = data as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const key of DOC_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(source, key)) out[key] = source[key]
  }
  return out
}

export type CreateCheck = { ok: true; fields: Record<string, unknown> } | { ok: false; error: string }

/** A new document: a known type, a status that is not a paid one, and no money already taken. */
export function checkNewDocument(data: unknown): CreateCheck {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'Document data must be an object.' }
  const fields = pickDocFields(data)
  if (!isDocType(fields.type)) return { ok: false, error: 'Choose a document type: estimate, invoice or receipt.' }
  const status = fields.status === undefined || fields.status === null || fields.status === '' ? 'Draft' : String(fields.status)
  if (PAID.has(status)) return { ok: false, error: 'A document becomes Paid or Partial only when a payment is recorded.' }
  if (!CREATE_STATUSES.has(status)) return { ok: false, error: 'That status cannot be used on a new document.' }
  fields.status = status
  if ((data as Record<string, unknown>).amount_paid !== undefined && Number((data as Record<string, unknown>).amount_paid) > 0) {
    return { ok: false, error: 'A new document cannot start with money already paid. Record the payment instead.' }
  }
  return { ok: true, fields }
}

export interface PaymentInput { amount: number; method: string; note: string; key: string }
export type PaymentCheck = { ok: true; input: PaymentInput } | { ok: false; error: string }

const METHOD_OK = /^[A-Za-z0-9 _./+&()-]{1,40}$/

/** One payment as the server will record it: cents, a plain method name, a short note and the retry key. */
export function checkPayment(body: { amount?: unknown; method?: unknown; note?: unknown; idempotencyKey?: unknown }): PaymentCheck {
  const raw = typeof body.amount === 'number' ? body.amount : Number.parseFloat(String(body.amount ?? ''))
  if (!Number.isFinite(raw) || raw <= 0) return { ok: false, error: 'Enter a payment greater than zero.' }
  if (raw > 1_000_000) return { ok: false, error: 'That payment is larger than this screen accepts.' }
  const amount = Math.round(raw * 100) / 100
  if (!(amount > 0)) return { ok: false, error: 'Enter a payment greater than zero.' }
  const methodRaw = typeof body.method === 'string' ? body.method.trim() : ''
  const method = methodRaw || 'unspecified'
  if (!METHOD_OK.test(method)) return { ok: false, error: 'That payment method name is not valid.' }
  const note = (typeof body.note === 'string' ? body.note : '').replace(/\s+/g, ' ').trim().slice(0, 300)
  const key = typeof body.idempotencyKey === 'string' ? body.idempotencyKey.trim() : ''
  if (key.length < 8 || key.length > 200) return { ok: false, error: 'This payment is missing its retry key. Reload the page and try again.' }
  return { ok: true, input: { amount, method, note, key } }
}

export type ConvertCheck = { ok: true } | { ok: false; error: string; status: number }

/** Only an open estimate with no money on it can become an invoice. */
export function checkConvert(doc: Record<string, unknown>): ConvertCheck {
  if (String(doc.type) !== 'Estimate') return { ok: false, status: 409, error: 'Only an estimate can be turned into an invoice.' }
  const status = String(doc.status || '')
  if (status === 'Void') return { ok: false, status: 409, error: 'This estimate is void. Restore it first.' }
  if (PAID.has(status) || Number(doc.amount_paid) > 0) return { ok: false, status: 409, error: 'This has payments on it, so it cannot be converted.' }
  return { ok: true }
}

/** The text a person should read when the database refuses a payment. Database wording is kept short and never shows internals. */
export function paymentErrorText(message: unknown): string {
  const text = String(message || '').toLowerCase()
  if (text.includes('exceed') || text.includes('balance')) return 'That is more than the balance still owed. Check the amount.'
  if (text.includes('void')) return 'This document is void, so a payment cannot be recorded.'
  if (text.includes('not found') || text.includes('access')) return 'That document could not be found.'
  return 'The payment could not be recorded. Nothing was charged twice. Try again.'
}
