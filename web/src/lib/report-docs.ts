/**
 * Turns a row of the documents table into what the reports read, and builds the pieces other report code shares
 * (the columns to ask for, a day from a timestamp, a car key). The browser screen and the server (scheduled emails) use the same
 * conversion, so an emailed number can never disagree with the number on the screen.
 *
 * Money comes from calculateDocumentTotals, the one calculation the editor, the signing page and the emails use. Nothing here
 * re-does that arithmetic.
 */
import { calculateDocumentTotals, getLaborFlatAmount, laborLineTotal, nonNegativeMoney, partLineTotal, quantityFromUnknown } from './document-money.ts'
import { balanceFor, keyOf, round2 } from './reports.ts'
import type { ReportDoc, ReportLine } from './reports.ts'

type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : v == null ? '' : String(v))

/** The columns every report has always read. */
export const DOC_COLUMNS = 'id,type,doc_number,status,doc_date,created_at,customer_id,customer_name,parts,labors,shop_supplies,sublet,tax_rate,apply_tax,amount_paid,payment_method'
/**
 * Extra columns for advisor, car, due date and online approval. They are asked for together and dropped together: a database
 * that lacks any of them (an older copy) answers "column does not exist" and the caller retries with DOC_COLUMNS.
 */
export const DOC_COLUMNS_EXTRA = `${DOC_COLUMNS},cashier,job_id,due_date,customer_phone,customer_email,vehicle_year,vehicle_make,vehicle_model,vehicle_vin,vehicle_plate,signature_requested_at,signature_signed_at`

/** A timestamp as the shop's calendar day; a plain date stays as it is. */
export const dayOfStamp = (v: unknown): string => {
  const s = str(v)
  if (!s) return ''
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const d = new Date(s)
  return isNaN(d.getTime()) ? '' : keyOf(d)
}

/** True when a database error means "that column or table is not there yet" (so the caller should fall back). */
export function isMissingSchemaError(e: unknown): boolean {
  const code = String((e as { code?: unknown })?.code ?? '')
  const msg = String((e as { message?: unknown })?.message ?? e ?? '').toLowerCase()
  return code === '42703' || code === '42P01' || code === 'PGRST204' || code === 'PGRST205'
    || /does not exist|schema cache|could not find the|undefined column|undefined table/.test(msg)
}

/** The same car always gets the same key: VIN first, then plate, then year make model for the same customer. */
export function vehicleKeyOf(raw: Row, customerKey: string): string {
  const vin = str(raw.vehicle_vin).replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (vin.length >= 11) return `vin:${vin}`
  const plate = str(raw.vehicle_plate).replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (plate.length >= 2) return `plate:${plate}`
  const car = [raw.vehicle_year, raw.vehicle_make, raw.vehicle_model].map(v => str(v).trim().toLowerCase()).filter(Boolean).join(' ')
  // A make and model alone ("honda civic") is shared by many customers, so it is only a key together with the customer.
  if (car && customerKey) return `car:${customerKey}:${car}`
  return ''
}

export function docFrom(raw: Row): ReportDoc {
  const t = calculateDocumentTotals(raw)
  const labors = (Array.isArray(raw.labors) ? raw.labors : []).filter((l): l is Row => !!l && typeof l === 'object')
  const parts = (Array.isArray(raw.parts) ? raw.parts : []).filter((l): l is Row => !!l && typeof l === 'object')
  const ops = labors.map(l => ({ name: str(l.operation ?? l.description ?? l.name).trim(), amount: laborLineTotal(l) })).filter(o => o.name || o.amount > 0)
  const hours = labors.filter(l => str(l.tech).trim()).map(l => ({
    tech: str(l.tech).trim(),
    // Only lines priced by the hour have hours to count. A flat-priced line still counts as money.
    hours: getLaborFlatAmount(l) === null ? quantityFromUnknown(l.hours, 0) : 0,
    amount: laborLineTotal(l),
  }))
  const lines: ReportLine[] = labors.map(l => {
    const flat = getLaborFlatAmount(l) !== null
    return { name: str(l.operation ?? l.description ?? l.name).trim(), hours: flat ? 0 : quantityFromUnknown(l.hours, 0), amount: laborLineTotal(l), tech: str(l.tech).trim(), flat }
  }).filter(l => l.name || l.amount > 0 || l.hours > 0)
  const items = parts.map(p => ({
    name: str(p.name).trim(), qty: quantityFromUnknown(p.qty, 1), amount: partLineTotal(p),
    cost: round2(nonNegativeMoney(p.cost) * quantityFromUnknown(p.qty, 1)), taxable: p.taxable !== false,
  })).filter(i => i.name)
  const status = str(raw.status)
  const customerId = raw.customer_id ? str(raw.customer_id) : null
  const customer = str(raw.customer_name).trim()
  const ckey = customerId || customer.toLowerCase().replace(/\s+/g, ' ')
  const car = [raw.vehicle_year, raw.vehicle_make, raw.vehicle_model].map(v => str(v).trim()).filter(Boolean).join(' ')
  return {
    id: str(raw.id), type: str(raw.type), number: str(raw.doc_number).trim(), status,
    date: dayOfStamp(raw.doc_date) || dayOfStamp(raw.created_at),
    customerId, customer,
    total: t.total, labor: t.laborTotal, parts: t.partsTotal, fees: round2(t.shopSupplies + t.sublet + t.coreTotal), tax: t.taxAmount,
    paid: t.amountPaid, balance: balanceFor(status, t.balanceDue), method: str(raw.payment_method),
    ops, items, hours,
    lines, advisor: str(raw.cashier).trim(), vehicle: car, vehicleKey: vehicleKeyOf(raw, ckey),
    taxable: t.taxableBase, taxRate: t.applyTax ? t.taxRate : 0,
    supplies: t.shopSupplies, sublet: t.sublet, core: t.coreTotal,
    jobId: raw.job_id ? str(raw.job_id) : null, dueDate: dayOfStamp(raw.due_date),
    phone: str(raw.customer_phone).trim(), email: str(raw.customer_email).trim(),
    signatureRequestedAt: dayOfStamp(raw.signature_requested_at), signedAt: dayOfStamp(raw.signature_signed_at),
  }
}
