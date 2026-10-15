/**
 * Merging two customer cards into one, as a previewed, confirmed, logged and reversible action.
 *
 * Nothing happens until a person has seen the preview and confirmed it. The merge moves the other customer's estimates,
 * invoices, repair orders, appointments, messages and the rest onto the card being kept, by id, and records every id it
 * moved. Only after it has checked that nothing still points at the other card does it remove that card, and a full copy
 * of that card is kept in the merge log. Undo puts the card back and moves exactly those records back.
 *
 * The database is passed in (MergeStore), so the whole sequence runs under `node --test` with an in-memory fake.
 * Imports nothing, keeps to plain TypeScript.
 */

export type Row = Record<string, unknown>

export interface RefSpec { table: string; col: string; label: string }

/**
 * Every table that holds a customer id and should follow the customer. Tables that do not exist yet in a shop's database
 * are skipped. Payment records are left out on purpose: the payments ledger is append-only, and each payment stays tied
 * to its invoice, which does move.
 */
export const MERGE_TABLES: RefSpec[] = [
  { table: 'documents', col: 'customer_id', label: 'Estimates and invoices' },
  { table: 'jobs', col: 'customer_id', label: 'Repair orders' },
  { table: 'appointments', col: 'customer_id', label: 'Appointments' },
  { table: 'dvi', col: 'customer_id', label: 'Inspections' },
  { table: 'vehicles', col: 'customer_id', label: 'Saved vehicles' },
  { table: 'vehicle_records', col: 'customer_id', label: 'Vehicle records' },
  { table: 'messages', col: 'customer_id', label: 'Text messages' },
  { table: 'call_history', col: 'customer_id', label: 'Calls' },
  { table: 'scheduled_messages', col: 'customer_id', label: 'Scheduled messages' },
  { table: 'customer_notes', col: 'customer_id', label: 'Notes' },
  { table: 'growth_followups', col: 'customer_id', label: 'Follow-up texts' },
  { table: 'growth_review_requests', col: 'customer_id', label: 'Review requests' },
  { table: 'growth_referrals', col: 'customer_id', label: 'Referral codes' },
  { table: 'automation_messages', col: 'customer_id', label: 'Automation messages' },
]

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v)).trim()

const SIMPLE: { field: string; label: string }[] = [
  { field: 'name', label: 'Name' },
  { field: 'phone', label: 'Phone' },
  { field: 'email', label: 'Email' },
  { field: 'address', label: 'Address' },
  { field: 'preferred_contact', label: 'Preferred contact' },
]
const CAR: { field: string; label: string }[] = [
  { field: 'vehicle_year', label: 'Year' },
  { field: 'vehicle_make', label: 'Make' },
  { field: 'vehicle_model', label: 'Model' },
  { field: 'vehicle_vin', label: 'VIN' },
  { field: 'vehicle_plate', label: 'Plate' },
  { field: 'vehicle_mileage', label: 'Mileage' },
  { field: 'vehicle_color', label: 'Color' },
  { field: 'vehicle_engine', label: 'Engine' },
]

export interface FieldPlan {
  field: string
  label: string
  keepValue: string
  otherValue: string
  result: string
  /** same: both agree or the other is empty. filled: the kept card was empty, so the other's value fills it. keep/other: they differ and this one wins. */
  source: 'same' | 'filled' | 'keep' | 'other'
  /** True when both cards have a different value and the person gets to pick. */
  choice: boolean
}

export interface MergePlan {
  blocks: string[]
  fields: FieldPlan[]
  /** Only the fields that change on the kept card. */
  patch: Record<string, string>
  /** The other card's car, when it is a different car from the kept card's. It becomes a vehicle record on the kept customer. */
  carry: Record<string, string> | null
  moves: { table: string; label: string; count: number }[]
  totalMoves: number
  warnings: string[]
  /** Changes if anything the person previewed changes, so a confirm can only apply exactly what was shown. */
  fingerprint: string
}

function fnv(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}

const hasCar = (r: Row): boolean => !!(str(r.vehicle_make) || str(r.vehicle_model))
const sameCar = (a: Row, b: Row): boolean => {
  const va = str(a.vehicle_vin).toUpperCase()
  const vb = str(b.vehicle_vin).toUpperCase()
  if (va && vb) return va === vb
  const k = (r: Row) => [r.vehicle_year, r.vehicle_make, r.vehicle_model].map(x => str(x).toLowerCase()).join('|')
  return k(a) === k(b)
}

export interface PlanInput {
  keep: Row
  other: Row
  /** For each field where both cards differ: which card's value to keep. Missing means the kept card's. */
  choices?: Record<string, 'keep' | 'other'>
  /** Ids that would move, by table. null means the table is not in this shop's database. */
  refs: Record<string, string[] | null>
  /** Today as yyyy-mm-dd, written into the notes. */
  today: string
}

export function planMerge(input: PlanInput): MergePlan {
  const { keep, other } = input
  const choices = input.choices || {}
  const blocks: string[] = []
  const warnings: string[] = []
  if (!str(keep.id) || !str(other.id)) blocks.push('Pick two customers to merge.')
  else if (str(keep.id) === str(other.id)) blocks.push('These are the same customer. Pick two different cards.')

  const fields: FieldPlan[] = []
  const patch: Record<string, string> = {}
  const unchosen: string[] = []

  const decide = (field: string, label: string, isCar: boolean) => {
    const present = field in keep || field in other
    if (!present) return
    const k = str(keep[field])
    const o = str(other[field])
    if (!o || k === o) { fields.push({ field, label, keepValue: k, otherValue: o, result: k, source: 'same', choice: false }); return }
    if (!k) { fields.push({ field, label, keepValue: k, otherValue: o, result: o, source: 'filled', choice: false }); patch[field] = o; return }
    // Both have a different value.
    if (isCar) { fields.push({ field, label, keepValue: k, otherValue: o, result: k, source: 'keep', choice: false }); return }
    const pick = choices[field] === 'other' ? 'other' : 'keep'
    fields.push({ field, label, keepValue: k, otherValue: o, result: pick === 'other' ? o : k, source: pick, choice: true })
    if (pick === 'other') { patch[field] = o; unchosen.push(`${label.toLowerCase()} ${k}`) } else unchosen.push(`${label.toLowerCase()} ${o}`)
  }
  for (const f of SIMPLE) decide(f.field, f.label, false)

  // The car: fill an empty card, or carry a different car over as its own record. Never overwrite one car with another.
  let carry: Record<string, string> | null = null
  if (hasCar(other)) {
    if (!hasCar(keep)) {
      for (const f of CAR) decide(f.field, f.label, true)
    } else if (sameCar(keep, other)) {
      for (const f of CAR) decide(f.field, f.label, true)
    } else {
      carry = {}
      for (const f of CAR) carry[f.field.replace('vehicle_', '')] = str(other[f.field])
      warnings.push(`${[other.vehicle_year, other.vehicle_make, other.vehicle_model].map(str).filter(Boolean).join(' ') || 'The other card\'s car'} is a different car, so it is added to the kept customer as a second vehicle.`)
    }
  }

  const notes: string[] = []
  const keepNotes = str(keep.notes)
  const otherNotes = str(other.notes)
  if (otherNotes && !keepNotes.includes(otherNotes)) notes.push(`Notes from the merged card: ${otherNotes}`)
  if (unchosen.length) notes.push(`Also on the merged card: ${unchosen.join(', ')}.`)
  if (notes.length) {
    const head = `Merged with ${str(other.name) || 'another card'} on ${input.today}.`
    const next = [keepNotes, [head, ...notes].join('\n')].filter(Boolean).join('\n\n')
    patch.notes = next
    fields.push({ field: 'notes', label: 'Notes', keepValue: keepNotes, otherValue: otherNotes, result: next, source: otherNotes ? 'filled' : 'same', choice: false })
  }

  const moves = MERGE_TABLES.flatMap(spec => {
    const ids = input.refs[spec.table]
    return ids && ids.length ? [{ table: spec.table, label: spec.label, count: ids.length }] : []
  })
  const totalMoves = moves.reduce((s, m) => s + m.count, 0)
  if (input.refs.vehicle_records === null && carry) warnings.push('Vehicle records are not set up yet, so the second car will only show through its repair orders. Its details are saved in the merge record.')

  const fingerprint = fnv(JSON.stringify({
    k: str(keep.id), o: str(other.id), p: Object.keys(patch).sort().map(f => [f, patch[f]]),
    m: moves.map(m => [m.table, m.count]), c: carry,
  }))
  return { blocks, fields, patch, carry, moves, totalMoves, warnings, fingerprint }
}

/* ---------- the log ---------- */

export type MergeStatus = 'started' | 'done' | 'failed' | 'undone'

export interface MergeLog {
  id: string
  keep_id: string
  remove_id: string
  status: MergeStatus
  keep_before: Row
  remove_snapshot: Row
  patch: Record<string, string>
  moved: Record<string, string[]>
  carry_record_id: string | null
  meta_before: Row | null
  error: string | null
  created_by: string | null
  created_at: string
  undone_at: string | null
}

export type NewMergeLog = Omit<MergeLog, 'id' | 'created_at' | 'undone_at'>

/** Everything the merge needs from the database. Each method is scoped to one shop by whoever builds the store. */
export interface MergeStore {
  loadCustomer(id: string): Promise<Row | null>
  /** Ids of the rows in the table that point at the customer. null when the table or column does not exist. */
  refIds(spec: RefSpec, customerId: string): Promise<string[] | null>
  /** Points these rows (and only these, and only while they still point at `from`) at `to`. */
  repoint(spec: RefSpec, ids: string[], from: string, to: string): Promise<void>
  updateCustomer(id: string, patch: Row): Promise<void>
  deleteCustomer(id: string): Promise<void>
  insertCustomer(row: Row): Promise<void>
  createLog(entry: NewMergeLog): Promise<string>
  updateLog(id: string, patch: Partial<MergeLog>): Promise<void>
  getLog(id: string): Promise<MergeLog | null>
  /** Folds the other card's tags and contact choices into the kept card. Returns the kept card's meta before, or undefined if meta is not set up. */
  foldMeta(keepId: string, removeId: string): Promise<{ before: Row | null } | undefined>
  restoreMeta(keepId: string, before: Row | null): Promise<void>
  /** Adds a second vehicle record to the kept customer. Returns its id, or null if vehicle records are not set up. */
  addCarriedVehicle(keepId: string, car: Record<string, string>): Promise<string | null>
  repointRecord(recordId: string, from: string, to: string): Promise<void>
}

const CHUNK = 200
const chunks = <T,>(list: T[]): T[][] => { const out: T[][] = []; for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK)); return out }
const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** The ids that would move, for the preview and for the confirm. */
export async function collectRefs(store: MergeStore, removeId: string): Promise<Record<string, string[] | null>> {
  const out: Record<string, string[] | null> = {}
  for (const spec of MERGE_TABLES) out[spec.table] = await store.refIds(spec, removeId)
  return out
}

export type MergeResult =
  | { ok: true; logId: string; moved: { table: string; label: string; count: number }[] }
  | { ok: false; code: 'invalid' | 'changed' | 'failed' | 'rolled_back' | 'stuck'; error: string; logId?: string }

export interface MergeArgs {
  keepId: string
  removeId: string
  choices?: Record<string, 'keep' | 'other'>
  /** The fingerprint the person saw in the preview. */
  expect: string
  today: string
  actor: string | null
}

async function rollback(store: MergeStore, log: MergeLog): Promise<string | null> {
  try {
    // Put the card back first if it was already removed, so the records have somewhere to go.
    const there = await store.loadCustomer(log.remove_id)
    if (!there) await store.insertCustomer(log.remove_snapshot)
    for (const spec of MERGE_TABLES) {
      const ids = log.moved[spec.table]
      if (!ids || !ids.length) continue
      for (const part of chunks(ids)) await store.repoint(spec, part, log.keep_id, log.remove_id)
    }
    if (log.carry_record_id) await store.repointRecord(log.carry_record_id, log.keep_id, log.remove_id)
    // Give the kept card back its old values, but only where nobody has edited the field since the merge.
    const now = await store.loadCustomer(log.keep_id)
    if (now) {
      const undo: Row = {}
      for (const [field, value] of Object.entries(log.patch)) {
        if (str(now[field]) === str(value)) undo[field] = log.keep_before[field] ?? null
      }
      if (Object.keys(undo).length) await store.updateCustomer(log.keep_id, undo)
    }
    await store.restoreMeta(log.keep_id, log.meta_before)
    return null
  } catch (e) {
    return message(e)
  }
}

export async function executeMerge(store: MergeStore, args: MergeArgs): Promise<MergeResult> {
  if (!args.keepId || !args.removeId || args.keepId === args.removeId) return { ok: false, code: 'invalid', error: 'Pick two different customers.' }
  const keep = await store.loadCustomer(args.keepId)
  const other = await store.loadCustomer(args.removeId)
  if (!keep || !other) return { ok: false, code: 'invalid', error: 'One of these customers is no longer here. Reload and try again.' }

  const refs = await collectRefs(store, args.removeId)
  const plan = planMerge({ keep, other, choices: args.choices, refs, today: args.today })
  if (plan.blocks.length) return { ok: false, code: 'invalid', error: plan.blocks[0] }
  if (plan.fingerprint !== args.expect) return { ok: false, code: 'changed', error: 'Something changed since you looked at the preview. Review it again before merging.' }

  let logId: string
  const draft: NewMergeLog = {
    keep_id: args.keepId, remove_id: args.removeId, status: 'started', keep_before: keep, remove_snapshot: other,
    patch: plan.patch, moved: {}, carry_record_id: null, meta_before: null, error: null, created_by: args.actor,
  }
  try {
    logId = await store.createLog(draft)
  } catch (e) {
    // Without a place to write the log there is no way back, so nothing is touched.
    return { ok: false, code: 'failed', error: `The merge record could not be saved, so nothing was changed. ${message(e)}`.trim() }
  }
  const log: MergeLog = { ...draft, id: logId, created_at: '', undone_at: null }

  const fail = async (text: string): Promise<MergeResult> => {
    await store.updateLog(logId, { moved: log.moved, carry_record_id: log.carry_record_id, meta_before: log.meta_before }).catch(() => undefined)
    const problem = await rollback(store, log)
    if (problem) {
      await store.updateLog(logId, { status: 'failed', error: `${text} Undo also failed: ${problem}` }).catch(() => undefined)
      return { ok: false, code: 'stuck', error: 'The merge stopped part way and could not be put back automatically. Open Merge history and press Undo.', logId }
    }
    await store.updateLog(logId, { status: 'undone', error: text }).catch(() => undefined)
    return { ok: false, code: 'rolled_back', error: `${text} Everything was put back the way it was.`, logId }
  }

  try {
    for (const spec of MERGE_TABLES) {
      const ids = refs[spec.table]
      if (!ids || !ids.length) continue
      // Record the ids before moving them, so a crash in the middle can still be undone.
      await store.updateLog(logId, { moved: { ...log.moved, [spec.table]: ids } })
      log.moved[spec.table] = ids
      for (const part of chunks(ids)) await store.repoint(spec, part, args.removeId, args.keepId)
    }
    if (Object.keys(plan.patch).length) await store.updateCustomer(args.keepId, plan.patch)
    const folded = await store.foldMeta(args.keepId, args.removeId)
    if (folded) { log.meta_before = folded.before; await store.updateLog(logId, { meta_before: folded.before }) }
    if (plan.carry) {
      const rid = await store.addCarriedVehicle(args.keepId, plan.carry)
      if (rid) { log.carry_record_id = rid; await store.updateLog(logId, { carry_record_id: rid }) }
    }
    // Nothing may still point at the old card before it goes.
    for (const spec of MERGE_TABLES) {
      if (!log.moved[spec.table]) continue
      const left = await store.refIds(spec, args.removeId)
      if (left && left.length) return await fail(`${left.length} ${spec.label.toLowerCase()} still point at the old card.`)
    }
    await store.deleteCustomer(args.removeId)
  } catch (e) {
    return await fail(`The merge hit a problem: ${message(e)}.`)
  }
  await store.updateLog(logId, { status: 'done', moved: log.moved }).catch(() => undefined)
  return { ok: true, logId, moved: plan.moves }
}

export type UndoResult = { ok: true; restoredId: string } | { ok: false; error: string }

export async function undoMerge(store: MergeStore, logId: string): Promise<UndoResult> {
  const log = await store.getLog(logId)
  if (!log) return { ok: false, error: 'That merge record was not found.' }
  if (log.status === 'undone') return { ok: false, error: 'This merge was already undone.' }
  if (log.status === 'started') return { ok: false, error: 'This merge is still running.' }
  const problem = await rollback(store, log)
  if (problem) return { ok: false, error: `Undo could not finish: ${problem}. Nothing else was changed.` }
  await store.updateLog(logId, { status: 'undone', error: null })
  return { ok: true, restoredId: log.remove_id }
}
