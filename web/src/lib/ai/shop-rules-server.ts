/**
 * Reads and writes the shop's AI rules from the shared settings table.
 * The shape and the keys are documented at the top of shop-rules.ts.
 *
 * Fails safe in both directions:
 *   - column missing (migration 043 not run): the built-in defaults apply, which
 *     ask before changing anything or contacting anyone. status 'missing_column'.
 *   - any other read error: status 'error'. Callers that gate an action treat
 *     this as "could not check the rules" and do NOT run the action.
 *
 * The database client is passed in so this stays testable without a database.
 */
import { defaultRules, normalizeRules, type AiRules } from './shop-rules.ts'

type QueryError = { code?: string; message?: string } | null
type Db = { from: (table: string) => any }

export type RulesStatus = 'ok' | 'missing_column' | 'error'

/** Postgres undefined column / undefined table, or PostgREST schema-cache misses. */
export function isMissingRulesColumn(error: QueryError): boolean {
  if (!error) return false
  return error.code === '42703' || error.code === '42P01' || error.code === 'PGRST204' || error.code === 'PGRST205'
    || /ai_rules|schema cache/i.test(error.message || '')
}

export async function loadShopRules(db: Db, shopId: string): Promise<{ rules: AiRules; status: RulesStatus; settingsId: string | null }> {
  try {
    const { data, error } = await db.from('settings')
      .select('id,ai_rules')
      .eq('shop_id', shopId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) {
      if (isMissingRulesColumn(error)) return { rules: defaultRules(), status: 'missing_column', settingsId: null }
      return { rules: defaultRules(), status: 'error', settingsId: null }
    }
    return { rules: normalizeRules(data?.ai_rules), status: 'ok', settingsId: typeof data?.id === 'string' ? data.id : null }
  } catch {
    return { rules: defaultRules(), status: 'error', settingsId: null }
  }
}

export type SaveRulesResult =
  | { ok: true; rules: AiRules }
  | { ok: false; status: number; error: string; needsDatabaseUpdate?: boolean }

export async function saveShopRules(db: Db, shopId: string, input: unknown): Promise<SaveRulesResult> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ok: false, status: 400, error: 'Send the rules as an object.' }
  const rules = normalizeRules(input)
  const loaded = await loadShopRules(db, shopId)
  if (loaded.status === 'missing_column') {
    return { ok: false, status: 409, needsDatabaseUpdate: true, error: 'Shop rules need a database update before they can be saved. Nothing was changed.' }
  }
  if (loaded.status === 'error') return { ok: false, status: 500, error: 'Your current rules could not be checked, so nothing was changed. Try again.' }
  if (!loaded.settingsId) return { ok: false, status: 409, error: 'Save your shop details in Settings first, then set the assistant rules.' }

  const { error } = await db.from('settings')
    .update({ ai_rules: rules, updated_at: new Date().toISOString() })
    .eq('id', loaded.settingsId)
    .eq('shop_id', shopId)
  if (error) {
    if (isMissingRulesColumn(error)) return { ok: false, status: 409, needsDatabaseUpdate: true, error: 'Shop rules need a database update before they can be saved. Nothing was changed.' }
    return { ok: false, status: 500, error: 'The rules could not be saved. Nothing was changed.' }
  }
  return { ok: true, rules }
}
