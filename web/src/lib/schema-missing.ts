/** Postgres or PostgREST saying a table or column is not there yet: a migration has not been applied. */
export function missingSchema(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false
  const code = String(error.code || '')
  if (code === '42703' || code === '42P01' || code === 'PGRST204' || code === 'PGRST205') return true
  return /does not exist|schema cache|could not find the/i.test(String(error.message || ''))
}
