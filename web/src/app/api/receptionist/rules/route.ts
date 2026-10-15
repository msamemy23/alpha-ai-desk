export const dynamic = 'force-dynamic'
import { authed, fail, ok, readBody, shopSettings } from '@/lib/receptionist-api'
import { loadRules, saveRules } from '@/lib/voice/store'
import { normalizeRules, validateRules } from '@/lib/voice/rules'
import { shopFromSettings } from '@/lib/voice/prompt'
import { hasAiKey } from '@/lib/voice/model'

/** The shop's receptionist rules, plus the few facts the rules screen needs (name, number, whether an AI key is saved). */
export async function GET() {
  const a = await authed()
  if (!a.ok) return a.res
  const { auth, db } = a
  const loaded = await loadRules(db, auth.shopId)
  const row = await shopSettings(db, auth.shopId, 'shop_name,shop_phone,telnyx_phone_number,shop_address,shop_email,timezone,ai_api_key,telnyx_api_key')
  return ok({
    rules: loaded.rules,
    saved: loaded.saved,
    unavailable: loaded.unavailable,
    failed: loaded.failed,
    shop: shopFromSettings(row),
    hasAiKey: hasAiKey(row),
    hasTelnyx: Boolean(row?.telnyx_api_key && (row?.telnyx_phone_number || row?.shop_phone)),
    canEdit: ['owner', 'admin', 'manager'].includes(auth.role),
  })
}

/** Saves the rules. Anything out of range is corrected; problems that need the owner's attention are returned in plain words. */
export async function PUT(req: Request) {
  const a = await authed({ manage: true })
  if (!a.ok) return a.res
  const { auth, db } = a
  const body = await readBody(req)
  if (!body || typeof body.rules !== 'object') return fail('Send the rules to save.')
  const rules = { ...normalizeRules(body.rules), reviewed: true }
  const problems = validateRules(rules, body.rules)
  if (problems.length) return fail(problems[0].message, 422, { problems })
  const saved = await saveRules(db, auth.shopId, rules, auth.userId)
  if (!saved.ok) return fail(saved.message, saved.unavailable ? 503 : 500, { unavailable: saved.unavailable })
  return ok({ rules })
}
