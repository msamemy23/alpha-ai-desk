/**
 * The rules around a customer import that the preview and the save must agree on: the 500 row cap, what counts as a usable
 * file, which rows are added, and a fingerprint of exactly what would be added. The save runs this same code again against
 * the book as it is at that moment, so it can only ever add what the owner was shown. Nothing here reads or writes a database.
 * Imports only the CSV and import helpers; plain TypeScript so it runs in the browser, on the server and under `node --test`.
 */
import { parseCsv } from '../csv.ts'
import { IMPORT_FIELDS, MAX_IMPORT_BYTES, detectMapping, duplicateText, parseImport } from './import.ts'
import type { ImportPreview, ImportRow } from './import.ts'
import type { DupInput } from './duplicates.ts'

/** The most customers one import may carry. A bigger file is refused whole, never cut short. */
export const COMMIT_ROW_CAP = 500
/** The most rows the preview sends back to the screen. Equal to the cap, so every row can be looked at. */
export const PREVIEW_ROW_CAP = COMMIT_ROW_CAP
export const MAX_NOTE_CHARS = 2000

export type ImportRead =
  | { ok: true; preview: ImportPreview; used: { field: string; label: string; header: string }[]; ignored: string[] }
  | { ok: false; status: number; error: string }

const byteLength = (text: string): number => new TextEncoder().encode(text).length

/** Reads pasted or uploaded CSV text into a preview against the customers already in the book. Never writes anything. */
export function readImport(text: unknown, existing: DupInput[], now: number): ImportRead {
  if (typeof text !== 'string' || text.trim() === '') return { ok: false, status: 400, error: 'Choose a file or paste your list first.' }
  if (byteLength(text) > MAX_IMPORT_BYTES) return { ok: false, status: 413, error: 'That list is bigger than 1.5 MB. Split it into smaller files of 500 customers or fewer.' }

  // One row more than the header and the cap, so a list that is too long is seen as too long.
  const parsed = parseCsv(text, { maxRows: COMMIT_ROW_CAP + 2 })
  if (parsed.rows.length === 0) return { ok: false, status: 400, error: 'There is nothing in that list. Choose a file or paste your list first.' }
  const body = parsed.rows.length - 1
  if (parsed.truncated || body > COMMIT_ROW_CAP) {
    return { ok: false, status: 413, error: `This list has more than ${COMMIT_ROW_CAP} customers. Split it into files of ${COMMIT_ROW_CAP} or fewer and import them one at a time.` }
  }
  if (body === 0) return { ok: false, status: 400, error: 'The first row is the column names, and there are no customers under it.' }

  const headers = parsed.rows[0]
  const mapping = detectMapping(headers)
  if (mapping.name < 0 && mapping.first_name < 0 && mapping.last_name < 0) {
    return { ok: false, status: 400, error: 'No column is named Name. Name the first column Name (or First name and Last name), then try again.' }
  }
  const preview = parseImport(parsed.rows, existing, { headerRow: true, mapping, today: now })
  const used = IMPORT_FIELDS.filter(f => mapping[f.field] >= 0).map(f => ({ field: f.field, label: f.label, header: headers[mapping[f.field]] || '' }))
  const usedIdx = new Set(IMPORT_FIELDS.map(f => mapping[f.field]).filter(i => i >= 0))
  const ignored = headers.map((h, i) => ({ h: h.trim(), i })).filter(x => x.h && !usedIdx.has(x.i)).map(x => x.h)
  return { ok: true, preview, used, ignored }
}

/** The rows an import would add. Duplicates and rows with problems are never in this list. */
export const rowsToAdd = (preview: ImportPreview): ImportRow[] => preview.rows.filter(r => r.status === 'new')

function fnv(text: string, seed: number): string {
  let h = seed >>> 0
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}

/**
 * Changes if anything about the rows that would be added changes (one more customer in the book that now matches a row, an
 * edited file). The preview hands it to the screen; the save refuses to run unless it still matches what it works out itself.
 */
export function importFingerprint(preview: ImportPreview): string {
  const text = rowsToAdd(preview).map(r => [r.line, r.values.name, r.values.phone, r.values.email, r.values.address, r.values.vehicle_year, r.values.vehicle_make, r.values.vehicle_model, r.values.vehicle_vin, r.values.vehicle_plate, r.values.vehicle_mileage, r.values.vehicle_color, r.values.notes, r.tags.join(';')].join('\u001f')).join('\u001e')
  return `${fnv(text, 0x811c9dc5)}${fnv(text, 0x01000193)}`
}

/** One id per import, so the same list cannot be recorded twice. 8 to 80 characters, as the table requires. */
export const importBatchKey = (fingerprint: string): string => `imp-${fingerprint}`

const orNull = (v: string | undefined): string | null => (v && v.trim() ? v.trim() : null)

/**
 * The row saved for one customer. The shop id and the new id are passed in (the shop from the signed-in session on the
 * server, never from the file). Everything else comes from the cleaned row. Fields the file did not have are left empty.
 */
export function customerInsertRow(row: ImportRow, shopId: string, id: string, nowIso: string): Record<string, unknown> {
  const v = row.values
  return {
    id,
    shop_id: shopId,
    name: v.name,
    phone: orNull(v.phone),
    email: orNull(v.email),
    address: orNull(v.address),
    notes: v.notes && v.notes.trim() ? v.notes.trim().slice(0, MAX_NOTE_CHARS) : null,
    preferred_contact: 'Call',
    vehicle_year: orNull(v.vehicle_year),
    vehicle_make: orNull(v.vehicle_make),
    vehicle_model: orNull(v.vehicle_model),
    vehicle_vin: orNull(v.vehicle_vin),
    vehicle_plate: orNull(v.vehicle_plate),
    vehicle_mileage: orNull(v.vehicle_mileage),
    vehicle_color: orNull(v.vehicle_color),
    created_at: nowIso,
    updated_at: nowIso,
  }
}

/** The row as the screen's preview table shows it. */
export interface SlimRow {
  line: number
  status: ImportRow['status']
  name: string
  phone: string
  email: string
  vehicle: string
  tags: string[]
  /** Why a row is skipped or cannot be added. Empty for a row that will be added. */
  reason: string
  /** Things that were cleaned up or left out of a row that still imports. */
  notes: string[]
}

export function slimRows(preview: ImportPreview, limit = PREVIEW_ROW_CAP): SlimRow[] {
  return preview.rows.slice(0, limit).map(r => ({
    line: r.line,
    status: r.status,
    name: r.values.name,
    phone: r.values.phone,
    email: r.values.email,
    vehicle: [r.values.vehicle_year, r.values.vehicle_make, r.values.vehicle_model].filter(Boolean).join(' '),
    tags: r.tags,
    reason: r.status === 'invalid' ? r.problems.join(' ') : r.status === 'duplicate' ? duplicateText(r) : '',
    notes: r.warnings,
  }))
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** One plain sentence for the counts, used above the preview and in the result. */
export function previewSentence(c: { new: number; duplicate: number; invalid: number }): string {
  const parts = [`${plural(c.new, 'customer', 'customers')} will be added`]
  if (c.duplicate > 0) parts.push(`${c.duplicate} skipped (already in your book, or repeated in the file)`)
  if (c.invalid > 0) parts.push(`${plural(c.invalid, 'row has a problem and will not be added', 'rows have problems and will not be added')}`)
  return `${parts.join(', ')}.`
}
