/**
 * True when a database error means "this table or column is not there yet" (a migration the shop has not had applied).
 * Screens use it to fall back to the old behaviour or show a "needs a database update" note for that one feature,
 * instead of showing an error that looks like an empty list. Imports nothing, so it runs anywhere.
 */
export function isMissingDbObject(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown }
  const code = String(e.code ?? '')
  if (code === '42703' || code === '42P01' || code === 'PGRST204' || code === 'PGRST205') return true
  const msg = `${e.message ?? ''} ${e.details ?? ''} ${e.hint ?? ''}`.toLowerCase()
  return msg.includes('schema cache') || msg.includes('does not exist') || msg.includes('could not find the table') || msg.includes('could not find the')
}

/** The same column list with some columns left out. */
export function dropColumns(columns: string, drop: readonly string[]): string {
  return columns.split(',').map(c => c.trim()).filter(c => c && !drop.includes(c)).join(',')
}

/**
 * Run a read with the full column list. If the database says a column is not there yet (a migration that has not been
 * applied), run it once more without the columns that are allowed to be missing. Any other error is returned untouched.
 */
export async function readWithoutMissingColumns<R extends { error: unknown }>(
  columns: string, optional: readonly string[], run: (columns: string) => PromiseLike<R>,
): Promise<R> {
  const first = await run(columns)
  if (!first.error || !isMissingDbObject(first.error)) return first
  const fewer = dropColumns(columns, optional)
  return fewer === columns ? first : run(fewer)
}

/** Save a row. If the database says a column is not there yet, save it once more without the optional columns. */
export async function writeWithoutMissingColumns<R extends { error: unknown }>(
  row: Record<string, unknown>, optional: readonly string[], run: (row: Record<string, unknown>) => PromiseLike<R>,
): Promise<R> {
  const first = await run(row)
  if (!first.error || !isMissingDbObject(first.error)) return first
  const rest = Object.fromEntries(Object.entries(row).filter(([key]) => !optional.includes(key)))
  return Object.keys(rest).length === Object.keys(row).length ? first : run(rest)
}
