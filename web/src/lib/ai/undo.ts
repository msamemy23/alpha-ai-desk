/**
 * Undo for assistant actions, done the professional way: a compensating action,
 * never a rewind of the database.
 *
 * When the assistant changes something, ai-action records an "undo descriptor"
 * next to the audit entry: what the record looked like before, and what it looked
 * like right after. Undo later checks the record is STILL as the assistant left it.
 * If someone changed it again, Undo refuses rather than overwrite newer work.
 *
 * Three kinds of compensating action cover everything that can be undone:
 *   restore   put the old values back (changes, status moves, staff on/off,
 *             voiding a draft the assistant created, cancelling a follow-up)
 *   remove    delete a record the assistant created, only if untouched and unused
 *   reinsert  put back a record from the saved copy taken before it was deleted
 *
 * Messages that were sent, and deleted records with attachments, are NOT here:
 * they are labelled "Cannot be undone" before the owner approves them.
 *
 * The descriptor is stored as a JSON STRING so the audit redactor (which blanks
 * anything nested deeper than four levels) cannot damage it.
 * Pure module: no imports from '@/'.
 */

export type UndoTable = 'customers' | 'jobs' | 'documents' | 'appointments' | 'inventory' | 'staff' | 'scheduled_messages'
export type UndoKind = 'restore' | 'remove' | 'reinsert'
type Row = Record<string, unknown>

export type UndoDescriptor = {
  v: 1
  kind: UndoKind
  table: UndoTable
  id: string
  /** restore: the values to put back */
  set?: Row
  /** restore: what those fields hold right now, as the assistant left them */
  expect?: Row
  /** reinsert: the full saved copy */
  row?: Row
  /** compare-and-swap column, usually updated_at */
  guard?: { column: string; value: unknown }
  /** What Undo will do, in plain words. */
  summary: string
  /** What the assistant did, in plain words. */
  label: string
  at: string
}

/** Fields Undo may write, per table. Mirrors what ai-action itself may write. */
export const UNDO_FIELDS: Record<UndoTable, readonly string[]> = {
  customers: ['name', 'phone', 'email', 'address', 'preferred_contact', 'vehicle_year', 'vehicle_make', 'vehicle_model', 'vehicle_vin', 'vehicle_plate', 'vehicle_mileage', 'notes', 'tags', 'sentiment', 'last_contact', 'review_requested', 'vehicle_color', 'vehicle_engine', 'sms_opted_out'],
  jobs: ['status'],
  documents: ['type', 'status', 'doc_date', 'due_date', 'expires_date', 'customer_id', 'customer_name', 'customer_phone', 'customer_email', 'job_id', 'vehicle_year', 'vehicle_make', 'vehicle_model', 'vehicle_vin', 'vehicle_plate', 'vehicle_mileage', 'parts', 'labors', 'shop_supplies', 'sublet', 'tax_rate', 'apply_tax', 'deposit', 'payment_method', 'cashier', 'payment_terms', 'payment_methods', 'warranty_type', 'warranty_months', 'warranty_mileage', 'warranty_start', 'warranty_exclusions', 'warranty_claim', 'notes', 'locked', 'sent_at', 'signature_signed_at', 'signature_signer_name', 'signature_requested_at', 'line_items', 'payment_plan', 'internal_notes'],
  appointments: ['customer_name', 'customer_id', 'phone', 'email', 'vehicle', 'service', 'tech', 'date', 'time', 'scheduled_date', 'scheduled_time', 'duration', 'status', 'notes', 'reminder_sent_at'],
  inventory: ['part_number', 'name', 'category', 'brand', 'description', 'cost', 'retail_price', 'qty_on_hand', 'qty_reorder', 'qty_on_order', 'location', 'supplier', 'supplier_part_number', 'notes', 'last_ordered'],
  staff: ['active'],
  scheduled_messages: ['status'],
}

/** Tables a "remove" or "reinsert" may touch. */
export const REMOVABLE: readonly UndoTable[] = ['customers', 'jobs', 'appointments']
export const REINSERTABLE: readonly UndoTable[] = ['appointments']

export const MAX_DESCRIPTOR_CHARS = 20000
const PROTECTED_STATUSES = ['Paid', 'Partial']

function canonical(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  const entries = Object.entries(value as Row).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(',')}}`
}

/** Same JSON value, ignoring key order. null and a missing value are the same. */
export function sameValue(a: unknown, b: unknown): boolean {
  return canonical(a) === canonical(b)
}

function short(value: unknown, max = 40): string {
  if (value === null || value === undefined || value === '') return 'blank'
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value)
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

const FIELD_NAMES: Record<string, string> = {
  customer_name: 'customer name', customer_phone: 'phone', customer_email: 'email', vehicle_year: 'vehicle year',
  vehicle_make: 'vehicle make', vehicle_model: 'vehicle model', qty_on_hand: 'quantity on hand', retail_price: 'retail price',
  scheduled_date: 'date', scheduled_time: 'time', doc_date: 'document date', due_date: 'due date', tax_rate: 'tax rate',
  apply_tax: 'tax', shop_supplies: 'shop supplies', internal_notes: 'internal notes',
}
export const fieldName = (key: string) => FIELD_NAMES[key] || key.replaceAll('_', ' ')

/** A short human name for a record, used in labels and on the Activity screen. */
export function subjectOf(table: UndoTable | string, row: Row | null | undefined): string {
  if (!row) return ''
  const text = (key: string) => (typeof row[key] === 'string' ? String(row[key]).trim() : '')
  switch (table) {
    case 'customers': return text('name') || 'a customer'
    case 'jobs': return [text('customer_name'), [row.vehicle_year, row.vehicle_make, row.vehicle_model].filter(Boolean).join(' ')].filter(Boolean).join(' - ') || 'a job'
    case 'documents': return `${text('type') || 'Document'}${text('doc_number') ? ` #${text('doc_number')}` : ''}${text('customer_name') ? ` for ${text('customer_name')}` : ''}`
    case 'appointments': return [text('customer_name'), text('date') || text('scheduled_date'), text('time') || text('scheduled_time')].filter(Boolean).join(' ') || 'an appointment'
    case 'inventory': return text('name') || text('part_number') || 'an inventory item'
    case 'staff': return text('name') || 'a staff member'
    case 'scheduled_messages': return text('customer_name') ? `follow-up for ${text('customer_name')}` : 'a follow-up'
    default: return ''
  }
}

/** "status: Pending -> In Progress; phone: blank -> 713..." for up to three fields. */
export function describeChange(fields: string[], before: Row, after: Row): string {
  const parts = fields
    .filter(key => !sameValue(before[key], after[key]))
    .slice(0, 3)
    .map(key => `${fieldName(key)} ${short(before[key])} to ${short(after[key])}`)
  return parts.join('; ')
}

export type BuildResult = { undo: string | null; reason?: string }

function finish(descriptor: UndoDescriptor): BuildResult {
  const text = JSON.stringify(descriptor)
  if (text.length > MAX_DESCRIPTOR_CHARS) return { undo: null, reason: 'Too large to save an undo copy.' }
  return { undo: text }
}

function guardFor(after: Row | null | undefined): UndoDescriptor['guard'] {
  const stamp = after?.updated_at
  return typeof stamp === 'string' && stamp ? { column: 'updated_at', value: stamp } : undefined
}

/**
 * The record was changed from `before` to `after` by writing `fields`.
 * Undo puts the same fields back.
 */
export function undoForUpdate(args: {
  table: UndoTable; id: string; fields: string[]; before: Row | null | undefined; after: Row | null | undefined; label: string; at?: string
}): BuildResult {
  const { table, id, fields, before, after } = args
  if (!before || !after) return { undo: null, reason: 'The record was not saved before the change.' }
  const allowed = UNDO_FIELDS[table]
  const set: Row = {}
  const expect: Row = {}
  for (const key of fields) {
    if (!allowed.includes(key) || key === 'updated_at') continue
    if (!(key in before) && !(key in after)) continue
    if (sameValue(before[key], after[key])) continue
    set[key] = before[key] === undefined ? null : before[key]
    expect[key] = after[key] === undefined ? null : after[key]
  }
  const keys = Object.keys(set)
  if (!keys.length) return { undo: null, reason: 'Nothing changed.' }
  if (table === 'documents' && PROTECTED_STATUSES.includes(String(set.status ?? ''))) {
    return { undo: null, reason: 'A paid document cannot be restored this way.' }
  }
  if (table === 'customers' && 'sms_opted_out' in set && set.sms_opted_out !== true) {
    return { undo: null, reason: 'A text opt-out is never reversed from here. The customer has to opt back in.' }
  }
  return finish({
    v: 1, kind: 'restore', table, id, set, expect, guard: guardFor(after),
    label: args.label,
    summary: `Put ${keys.slice(0, 3).map(key => `${fieldName(key)} back to ${short(set[key])}`).join(', ')}${keys.length > 3 ? ' and more' : ''}.`,
    at: args.at || new Date().toISOString(),
  })
}

/** The assistant created `row`. Undo deletes it, but only while it is untouched and unused. */
export function undoForCreate(args: { table: UndoTable; row: Row | null | undefined; label: string; at?: string }): BuildResult {
  const { table, row } = args
  if (!row || typeof row.id !== 'string' || !REMOVABLE.includes(table)) return { undo: null, reason: 'This cannot be undone by removing it.' }
  return finish({
    v: 1, kind: 'remove', table, id: row.id, guard: guardFor(row),
    label: args.label,
    summary: `Remove ${subjectOf(table, row)}. This only works while nothing has been added to it.`,
    at: args.at || new Date().toISOString(),
  })
}

/** The assistant created a draft document. Undo voids it so the number stays on record. */
export function undoForCreatedDocument(args: { row: Row | null | undefined; label: string; at?: string }): BuildResult {
  const { row } = args
  if (!row || typeof row.id !== 'string') return { undo: null, reason: 'The document was not returned.' }
  if (String(row.status ?? '') !== 'Draft') return { undo: null, reason: 'Only a draft can be undone.' }
  return finish({
    v: 1, kind: 'restore', table: 'documents', id: row.id,
    set: { status: 'Void' }, expect: { status: 'Draft' }, guard: guardFor(row),
    label: args.label,
    summary: `Void ${subjectOf('documents', row)}. Its number stays on record.`,
    at: args.at || new Date().toISOString(),
  })
}

/** The assistant scheduled a follow-up. Undo cancels it while it is still waiting. */
export function undoForScheduledMessage(args: { row: Row | null | undefined; label: string; at?: string }): BuildResult {
  const { row } = args
  if (!row || typeof row.id !== 'string') return { undo: null, reason: 'The follow-up was not returned.' }
  return finish({
    v: 1, kind: 'restore', table: 'scheduled_messages', id: row.id,
    set: { status: 'cancelled' }, expect: { status: 'pending' }, guard: undefined,
    label: args.label,
    summary: `Cancel the ${subjectOf('scheduled_messages', row)} while it is still waiting to go out.`,
    at: args.at || new Date().toISOString(),
  })
}

/** The assistant deleted `row`. Undo puts it back from this saved copy. */
export function undoForDelete(args: { table: UndoTable; row: Row | null | undefined; label: string; at?: string }): BuildResult {
  const { table, row } = args
  if (!row || typeof row.id !== 'string' || !REINSERTABLE.includes(table)) return { undo: null, reason: 'A deleted record of this kind cannot be put back.' }
  return finish({
    v: 1, kind: 'reinsert', table, id: row.id, row,
    label: args.label,
    summary: `Put back ${subjectOf(table, row)} from the copy saved before it was deleted.`,
    at: args.at || new Date().toISOString(),
  })
}

/** Read a stored descriptor back. Anything malformed is treated as "no undo". */
export function parseUndo(value: unknown): UndoDescriptor | null {
  let data: unknown = value
  if (typeof value === 'string') {
    try { data = JSON.parse(value) } catch { return null }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  const d = data as Row
  if (d.v !== 1 || !['restore', 'remove', 'reinsert'].includes(String(d.kind))) return null
  if (typeof d.table !== 'string' || !(d.table in UNDO_FIELDS) || typeof d.id !== 'string' || !d.id) return null
  if (typeof d.summary !== 'string' || typeof d.label !== 'string') return null
  const kind = d.kind as UndoKind
  const table = d.table as UndoTable
  if (kind === 'restore') {
    if (!d.set || typeof d.set !== 'object' || !d.expect || typeof d.expect !== 'object') return null
    const keys = Object.keys(d.set as Row)
    if (!keys.length || keys.some(key => !UNDO_FIELDS[table].includes(key))) return null
  }
  if (kind === 'remove' && !REMOVABLE.includes(table)) return null
  if (kind === 'reinsert' && (!REINSERTABLE.includes(table) || !d.row || typeof d.row !== 'object')) return null
  return {
    v: 1, kind, table, id: d.id,
    ...(d.set ? { set: d.set as Row } : {}),
    ...(d.expect ? { expect: d.expect as Row } : {}),
    ...(d.row ? { row: d.row as Row } : {}),
    ...(d.guard && typeof d.guard === 'object' && typeof (d.guard as Row).column === 'string' ? { guard: d.guard as UndoDescriptor['guard'] } : {}),
    summary: d.summary, label: d.label, at: typeof d.at === 'string' ? d.at : '',
  }
}

export type UndoPlan =
  | { ok: true; op: 'update'; table: UndoTable; id: string; values: Row; guard?: UndoDescriptor['guard'] }
  | { ok: true; op: 'delete'; table: UndoTable; id: string; guard?: UndoDescriptor['guard'] }
  | { ok: true; op: 'insert'; table: UndoTable; id: string; row: Row }
  | { ok: false; code: 'already' | 'changed' | 'missing' | 'blocked'; message: string; fields?: string[] }

/**
 * Decide, from the record as it is RIGHT NOW, whether Undo may run.
 * `current` is the row read fresh from the database (or null when it is gone).
 * Pure so every refusal is tested without a database.
 */
export function planUndo(descriptor: UndoDescriptor, current: Row | null): UndoPlan {
  const { kind, table, id } = descriptor
  if (kind === 'reinsert') {
    if (current) return { ok: false, code: 'already', message: 'It is already back.' }
    const row = descriptor.row || {}
    return { ok: true, op: 'insert', table, id, row }
  }
  if (!current) {
    return kind === 'remove'
      ? { ok: false, code: 'already', message: 'It is already gone.' }
      : { ok: false, code: 'missing', message: 'That record no longer exists, so there is nothing to put back.' }
  }
  if (kind === 'remove') {
    const g = descriptor.guard
    if (g && !sameValue(current[g.column], g.value)) {
      return { ok: false, code: 'changed', message: 'It was changed after the assistant added it, so Undo will not remove it.', fields: [g.column] }
    }
    return { ok: true, op: 'delete', table, id, guard: g }
  }

  const set = descriptor.set || {}
  const expect = descriptor.expect || {}
  const keys = Object.keys(set)
  if (keys.every(key => sameValue(current[key], set[key]))) {
    return { ok: false, code: 'already', message: 'It is already back to how it was.' }
  }
  const drifted = Object.keys(expect).filter(key => !sameValue(current[key], expect[key]))
  if (drifted.length) {
    return {
      ok: false, code: 'changed', fields: drifted,
      message: `${drifted.map(fieldName).join(', ')} ${drifted.length === 1 ? 'was' : 'were'} changed again after the assistant's change, so Undo will not overwrite newer work.`,
    }
  }
  if (table === 'customers' && 'sms_opted_out' in set && set.sms_opted_out !== true) {
    return { ok: false, code: 'blocked', message: 'A text opt-out is never reversed from here. The customer has to opt back in.' }
  }
  if (table === 'documents') {
    if (PROTECTED_STATUSES.includes(String(current.status ?? ''))) {
      return { ok: false, code: 'blocked', message: 'This document has payments on it. Undo will not change it.' }
    }
    if (PROTECTED_STATUSES.includes(String(set.status ?? ''))) {
      return { ok: false, code: 'blocked', message: 'A paid document cannot be restored this way.' }
    }
    if (current.locked === true && !('locked' in set)) {
      return { ok: false, code: 'blocked', message: 'This document is locked, so Undo will not change it.' }
    }
  }
  return { ok: true, op: 'update', table, id, values: set, guard: descriptor.guard }
}

/** Dependent tables that must be empty before a created record can be removed. */
export const DEPENDENTS: Record<string, { table: string; column: string }[]> = {
  customers: [
    { table: 'jobs', column: 'customer_id' },
    { table: 'documents', column: 'customer_id' },
    { table: 'appointments', column: 'customer_id' },
    { table: 'messages', column: 'customer_id' },
    { table: 'scheduled_messages', column: 'customer_id' },
    { table: 'vehicles', column: 'customer_id' },
    { table: 'dvi', column: 'customer_id' },
  ],
  jobs: [
    { table: 'documents', column: 'job_id' },
    { table: 'dvi', column: 'job_id' },
  ],
  appointments: [],
}
