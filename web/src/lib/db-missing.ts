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
