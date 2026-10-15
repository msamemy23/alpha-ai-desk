/**
 * Runs one Undo: reads the record fresh, asks planUndo whether it is still safe,
 * then makes ONE shop-scoped, single-row change guarded by the record's own
 * updated_at stamp. Never bulk, never unscoped, never more than one row.
 *
 * The database client is passed in so this is tested without a database.
 */
import { DEPENDENTS, planUndo, UNDO_FIELDS, type UndoDescriptor } from './undo.ts'

type Db = { from: (table: string) => any }
type QueryError = { code?: string; message?: string } | null

export type UndoRun =
  | { ok: true; outcome: 'undone'; message: string; subject: string }
  | { ok: false; outcome: 'already' | 'changed' | 'missing' | 'blocked' | 'error'; status: number; message: string }

const missingSchema = (error: QueryError) => Boolean(error) && (error?.code === '42P01' || error?.code === '42703' || error?.code === 'PGRST204' || error?.code === 'PGRST205' || /schema cache/i.test(error?.message || ''))

async function dependentsFound(db: Db, shopId: string, descriptor: UndoDescriptor): Promise<{ found: string[]; failed: boolean }> {
  const found: string[] = []
  for (const dep of DEPENDENTS[descriptor.table] || []) {
    const { count, error } = await db.from(dep.table).select('id', { count: 'exact', head: true }).eq(dep.column, descriptor.id).eq('shop_id', shopId)
    if (error) {
      // A table or column this shop's database does not have cannot hold dependents.
      if (missingSchema(error)) continue
      return { found, failed: true }
    }
    if ((count || 0) > 0) found.push(dep.table.replaceAll('_', ' '))
  }
  return { found, failed: false }
}

export async function runUndo(db: Db, shopId: string, descriptor: UndoDescriptor): Promise<UndoRun> {
  const table = descriptor.table
  const { data: current, error: readError } = await db.from(table).select('*').eq('id', descriptor.id).eq('shop_id', shopId).maybeSingle()
  if (readError) return { ok: false, outcome: 'error', status: 500, message: 'The record could not be checked, so nothing was changed.' }

  const plan = planUndo(descriptor, current || null)
  if (!plan.ok) {
    const status = plan.code === 'already' ? 200 : 409
    return { ok: false, outcome: plan.code, status, message: plan.message }
  }

  if (plan.op === 'update') {
    const values: Record<string, unknown> = {}
    for (const key of Object.keys(plan.values)) if (UNDO_FIELDS[table].includes(key)) values[key] = plan.values[key]
    if (!Object.keys(values).length) return { ok: false, outcome: 'blocked', status: 409, message: 'There is nothing Undo is allowed to change here.' }
    if (current && 'updated_at' in current) values.updated_at = new Date().toISOString()
    let query = db.from(table).update(values).eq('id', plan.id).eq('shop_id', shopId)
    if (plan.guard) query = query.eq(plan.guard.column, plan.guard.value)
    const { data, error } = await query.select('id').maybeSingle()
    if (error) return { ok: false, outcome: 'error', status: 500, message: 'The change could not be put back. Nothing was changed.' }
    if (!data) return { ok: false, outcome: 'changed', status: 409, message: 'It was changed again while Undo was running, so Undo stopped. Nothing was overwritten.' }
    return { ok: true, outcome: 'undone', message: descriptor.summary, subject: descriptor.label }
  }

  if (plan.op === 'delete') {
    const deps = await dependentsFound(db, shopId, descriptor)
    if (deps.failed) return { ok: false, outcome: 'error', status: 500, message: 'Undo could not check what is attached to this record, so nothing was removed.' }
    if (deps.found.length) return { ok: false, outcome: 'blocked', status: 409, message: `Something has been added to it (${deps.found.join(', ')}), so Undo will not remove it.` }
    let query = db.from(table).delete().eq('id', plan.id).eq('shop_id', shopId)
    if (plan.guard) query = query.eq(plan.guard.column, plan.guard.value)
    const { data, error } = await query.select('id').maybeSingle()
    if (error) return { ok: false, outcome: 'error', status: 500, message: 'It could not be removed. Nothing was changed.' }
    if (!data) return { ok: false, outcome: 'changed', status: 409, message: 'It was changed while Undo was running, so Undo stopped. Nothing was removed.' }
    return { ok: true, outcome: 'undone', message: descriptor.summary, subject: descriptor.label }
  }

  // insert: the saved copy goes back with this shop's id, whatever the copy says.
  const { error } = await db.from(table).insert({ ...plan.row, id: plan.id, shop_id: shopId })
  if (error) {
    if (error.code === '23505') return { ok: false, outcome: 'already', status: 200, message: 'It is already back.' }
    return { ok: false, outcome: 'error', status: 500, message: 'It could not be put back. Nothing was changed.' }
  }
  return { ok: true, outcome: 'undone', message: descriptor.summary, subject: descriptor.label }
}
