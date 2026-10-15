/**
 * Reading a customer list from a spreadsheet (CSV): guessing which column is which, cleaning each row, spotting rows that
 * match a customer already in the book (or an earlier row in the file), and listing every row that cannot be imported with
 * a plain reason. Nothing here writes anything. The server runs the same code again before it saves, so the preview can
 * never promise something the save will not do. Imports only the CSV and duplicate helpers.
 */
import { csvLine } from '../csv.ts'
import { emailKey, nameKey, phoneKey } from './duplicates.ts'
import type { DupInput } from './duplicates.ts'

export const MAX_IMPORT_ROWS = 2000
export const MAX_IMPORT_BYTES = 1_500_000

export type ImportField =
  | 'name' | 'first_name' | 'last_name' | 'phone' | 'email' | 'address' | 'city' | 'state' | 'zip' | 'notes' | 'tags'
  | 'vehicle_year' | 'vehicle_make' | 'vehicle_model' | 'vehicle_vin' | 'vehicle_plate' | 'vehicle_mileage' | 'vehicle_color'

export const IMPORT_FIELDS: { field: ImportField; label: string }[] = [
  { field: 'name', label: 'Full name' },
  { field: 'first_name', label: 'First name' },
  { field: 'last_name', label: 'Last name' },
  { field: 'phone', label: 'Phone' },
  { field: 'email', label: 'Email' },
  { field: 'address', label: 'Address' },
  { field: 'city', label: 'City' },
  { field: 'state', label: 'State' },
  { field: 'zip', label: 'ZIP code' },
  { field: 'vehicle_year', label: 'Vehicle year' },
  { field: 'vehicle_make', label: 'Vehicle make' },
  { field: 'vehicle_model', label: 'Vehicle model' },
  { field: 'vehicle_vin', label: 'VIN' },
  { field: 'vehicle_plate', label: 'License plate' },
  { field: 'vehicle_mileage', label: 'Mileage' },
  { field: 'vehicle_color', label: 'Vehicle color' },
  { field: 'notes', label: 'Notes' },
  { field: 'tags', label: 'Tags' },
]

/** Header names that other shop systems and spreadsheets use for each field. Compared after lower-casing and dropping punctuation. */
const SYNONYMS: Record<ImportField, string[]> = {
  name: ['name', 'full name', 'customer', 'customer name', 'contact', 'contact name', 'client', 'client name'],
  first_name: ['first name', 'first', 'given name', 'firstname'],
  last_name: ['last name', 'last', 'surname', 'family name', 'lastname'],
  phone: ['phone', 'phone number', 'mobile', 'mobile phone', 'cell', 'cell phone', 'primary phone', 'telephone', 'tel', 'phone 1', 'mobile number'],
  email: ['email', 'e mail', 'email address', 'primary email', 'mail'],
  address: ['address', 'street', 'street address', 'address 1', 'address line 1', 'mailing address'],
  city: ['city', 'town'],
  state: ['state', 'province', 'region', 'st'],
  zip: ['zip', 'zip code', 'zipcode', 'postal code', 'postal', 'postcode'],
  notes: ['notes', 'note', 'comments', 'comment', 'customer notes', 'memo'],
  tags: ['tags', 'tag', 'labels', 'groups', 'segment'],
  vehicle_year: ['year', 'vehicle year', 'model year', 'veh year', 'car year'],
  vehicle_make: ['make', 'vehicle make', 'veh make', 'car make'],
  vehicle_model: ['model', 'vehicle model', 'veh model', 'car model'],
  vehicle_vin: ['vin', 'vehicle vin', 'vin number', 'vehicle identification number'],
  vehicle_plate: ['plate', 'license plate', 'licence plate', 'license', 'tag number', 'plate number', 'license plate number', 'lic plate'],
  vehicle_mileage: ['mileage', 'odometer', 'miles', 'vehicle mileage', 'current mileage'],
  vehicle_color: ['color', 'colour', 'vehicle color'],
}

const norm = (h: string): string => h.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** For each field, the index of the column that looks like it, or -1. A column is used for one field only. */
export function detectMapping(headers: string[]): Record<ImportField, number> {
  const out = {} as Record<ImportField, number>
  const taken = new Set<number>()
  const normalized = headers.map(norm)
  for (const { field } of IMPORT_FIELDS) {
    let idx = -1
    for (const syn of SYNONYMS[field]) {
      const at = normalized.findIndex((h, i) => h === syn && !taken.has(i))
      if (at >= 0) { idx = at; break }
    }
    if (idx >= 0) taken.add(idx)
    out[field] = idx
  }
  // A file with first and last name columns does not also need a full name column that matched by accident.
  if (out.first_name >= 0 && out.last_name >= 0 && out.name >= 0) out.name = -1
  return out
}

const s = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).replace(/\s+/g, ' ').trim()
const s_ = s
const US_STATE = /^[A-Za-z]{2}$/

/** Fixes names typed in all capitals or all lower case, word by word. A word that already mixes cases (McDonald, DeShawn) is left as it is. */
function tidyName(v: string): string {
  return s_(v).split(' ').map(word => {
    if (!/[a-z]/i.test(word)) return word
    const lowerOrUpper = word === word.toLowerCase() || word === word.toUpperCase()
    if (!lowerOrUpper || /^(ii|iii|iv)$/i.test(word)) return word
    return word.toLowerCase().replace(/(^|['-])([a-z])/g, (_m, a, b) => a + b.toUpperCase())
  }).join(' ')
}

export function formatPhone(v: unknown): { value: string; warning: string } {
  const raw = s(v)
  if (!raw) return { value: '', warning: '' }
  const key = phoneKey(raw)
  if (key) return { value: `(${key.slice(0, 3)}) ${key.slice(3, 6)}-${key.slice(6)}`, warning: '' }
  const digits = raw.replace(/\D/g, '')
  if (digits.length === 7) return { value: `${digits.slice(0, 3)}-${digits.slice(3)}`, warning: 'The phone number has no area code.' }
  return { value: '', warning: `The phone number "${raw}" was not usable and was left out.` }
}

export interface ImportRow {
  /** Line number in the file, counting the header as line 1. */
  line: number
  values: Record<string, string>
  tags: string[]
  /** new: will be added. duplicate: matches someone already there. invalid: cannot be added. */
  status: 'new' | 'duplicate' | 'invalid'
  /** Why a row is invalid. */
  problems: string[]
  /** Things that were cleaned up or left out of a row that still imports. */
  warnings: string[]
  match: { id: string; name: string; why: 'phone' | 'email' | 'name' } | null
  /** A duplicate of an earlier row in the same file. */
  fileMatch: number | null
}

export interface ImportPreview {
  rows: ImportRow[]
  counts: { total: number; new: number; duplicate: number; invalid: number }
  mapping: Record<ImportField, number>
  truncated: boolean
}

export interface ImportOptions {
  headerRow: boolean
  mapping: Record<ImportField, number>
  today: number
}

export function parseImport(table: string[][], existing: (DupInput & { name?: unknown })[], opts: ImportOptions, truncated = false): ImportPreview {
  const body = opts.headerRow ? table.slice(1) : table
  const first = opts.headerRow ? 2 : 1
  const m = opts.mapping
  const cell = (row: string[], f: ImportField): string => (m[f] >= 0 ? s(row[m[f]]) : '')

  const byPhone = new Map<string, { id: string; name: string }>()
  const byEmail = new Map<string, { id: string; name: string }>()
  const byName = new Map<string, { id: string; name: string }>()
  for (const c of existing) {
    const entry = { id: String(c.id), name: s(c.name) }
    const p = phoneKey(c.phone); if (p && !byPhone.has(p)) byPhone.set(p, entry)
    const e = emailKey(c.email); if (e && !byEmail.has(e)) byEmail.set(e, entry)
    const n = nameKey(c.name); if (n && !byName.has(n)) byName.set(n, entry)
  }
  const seenPhone = new Map<string, number>()
  const seenEmail = new Map<string, number>()
  const seenName = new Map<string, number>()

  const rows: ImportRow[] = []
  body.forEach((raw, i) => {
    const line = first + i
    const problems: string[] = []
    const warnings: string[] = []
    const values: Record<string, string> = {}

    let name = cell(raw, 'name')
    if (!name) name = [cell(raw, 'first_name'), cell(raw, 'last_name')].filter(Boolean).join(' ')
    name = tidyName(name)
    values.name = name
    const phone = formatPhone(cell(raw, 'phone'))
    if (phone.warning) warnings.push(phone.warning)
    values.phone = phone.value
    const emailRaw = cell(raw, 'email').toLowerCase()
    const email = emailKey(emailRaw)
    if (emailRaw && !email) warnings.push(`The email "${emailRaw}" did not look right and was left out.`)
    values.email = email

    const street = cell(raw, 'address')
    const city = cell(raw, 'city')
    const state = cell(raw, 'state')
    const zip = cell(raw, 'zip')
    const tail = [city, [US_STATE.test(state) ? state.toUpperCase() : state, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ')
    values.address = [street, tail].filter(Boolean).join(', ')

    const year = cell(raw, 'vehicle_year')
    if (year && !(/^\d{4}$/.test(year) && Number(year) >= 1900 && Number(year) <= new Date(opts.today).getFullYear() + 2)) {
      warnings.push(`The vehicle year "${year}" was left out.`)
      values.vehicle_year = ''
    } else values.vehicle_year = year
    const makeRaw = cell(raw, 'vehicle_make')
    values.vehicle_make = makeRaw.length <= 3 && makeRaw === makeRaw.toUpperCase() ? makeRaw : tidyName(makeRaw)
    values.vehicle_model = cell(raw, 'vehicle_model')
    const vinRaw = cell(raw, 'vehicle_vin').toUpperCase().replace(/[^A-Z0-9]/g, '')
    if (vinRaw && vinRaw.length !== 17) warnings.push(`The VIN "${vinRaw}" is not 17 characters and was left out.`)
    values.vehicle_vin = vinRaw.length === 17 ? vinRaw : ''
    values.vehicle_plate = cell(raw, 'vehicle_plate').toUpperCase()
    const miles = cell(raw, 'vehicle_mileage').replace(/[^\d]/g, '')
    values.vehicle_mileage = miles && Number(miles) > 0 && Number(miles) <= 2_000_000 ? miles : ''
    values.vehicle_color = cell(raw, 'vehicle_color')
    values.notes = m.notes >= 0 ? String(raw[m.notes] ?? '').trim() : ''
    const tags = cell(raw, 'tags').split(/[;|,]/).map(t => t.trim()).filter(Boolean).slice(0, 10)

    if (!name) problems.push('No name. Every customer needs a name.')
    if (name.length > 120) problems.push('The name is longer than 120 characters.')

    let status: ImportRow['status'] = problems.length ? 'invalid' : 'new'
    let match: ImportRow['match'] = null
    let fileMatch: number | null = null
    if (status === 'new') {
      const pk = phoneKey(values.phone)
      const ek = email
      const nk = nameKey(name)
      const hit = (pk && byPhone.get(pk) && { ...(byPhone.get(pk) as { id: string; name: string }), why: 'phone' as const })
        || (ek && byEmail.get(ek) && { ...(byEmail.get(ek) as { id: string; name: string }), why: 'email' as const })
        || (nk && byName.get(nk) && { ...(byName.get(nk) as { id: string; name: string }), why: 'name' as const })
        || null
      if (hit) { match = hit; status = 'duplicate' }
      const earlier = (pk && seenPhone.get(pk)) || (ek && seenEmail.get(ek)) || (nk && seenName.get(nk)) || null
      if (earlier) { fileMatch = earlier; status = 'duplicate' }
      if (pk && !seenPhone.has(pk)) seenPhone.set(pk, line)
      if (ek && !seenEmail.has(ek)) seenEmail.set(ek, line)
      if (nk && !seenName.has(nk)) seenName.set(nk, line)
    }
    rows.push({ line, values, tags, status, problems, warnings, match, fileMatch })
  })

  return {
    rows,
    counts: {
      total: rows.length,
      new: rows.filter(r => r.status === 'new').length,
      duplicate: rows.filter(r => r.status === 'duplicate').length,
      invalid: rows.filter(r => r.status === 'invalid').length,
    },
    mapping: m,
    truncated,
  }
}

export function duplicateText(r: ImportRow): string {
  if (r.match) return `Already a customer: ${r.match.name || 'unnamed'} (same ${r.match.why === 'phone' ? 'phone number' : r.match.why === 'email' ? 'email' : 'name'}).`
  if (r.fileMatch) return `Matches line ${r.fileMatch} of this file.`
  return ''
}

/** The rows that were not added, with the line number and the reason, so the owner can fix the file and try again. */
export function importProblemsCsv(rows: ImportRow[], added: Set<number>): string {
  const lines = [csvLine(['Line', 'Name', 'Phone', 'Email', 'Result', 'Reason'])]
  for (const r of rows) {
    if (added.has(r.line)) continue
    const result = r.status === 'invalid' ? 'Not added' : r.status === 'duplicate' ? 'Skipped as a duplicate' : 'Not added'
    const reason = r.status === 'invalid' ? r.problems.join(' ') : r.status === 'duplicate' ? duplicateText(r) : 'Not selected.'
    lines.push(csvLine([r.line, r.values.name, r.values.phone, r.values.email, result, reason]))
  }
  return lines.join('\r\n') + '\r\n'
}

/** A template the owner can fill in: the headers this importer reads, and one example row of made-up data. */
export function importTemplateCsv(): string {
  const head = ['Name', 'Phone', 'Email', 'Address', 'Year', 'Make', 'Model', 'VIN', 'Plate', 'Mileage', 'Notes', 'Tags']
  const row = ['Sample Customer', '(555) 010-0123', 'sample@example.com', '100 Main St, Anytown, ST 12345', '2018', 'Honda', 'Accord', '', 'ABC1234', '84000', 'Prefers text messages', 'fleet; vip']
  return [csvLine(head), csvLine(row)].join('\r\n') + '\r\n'
}
