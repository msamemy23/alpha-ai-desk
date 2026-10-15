import { DEFAULT_BLOCKED } from '@/lib/browser/policy'
import { saveSettings } from '@/lib/browser/store'
import { audit, forgetShopRules, loadShopRules, openRoute, problem, readJson, reply } from '@/lib/browser/server'
import { hasAiKey } from '@/lib/browser/model'

export const dynamic = 'force-dynamic'

/** Everything the Browser page needs to start: the shop's settings, rules, quick sites, and what this person may do. */
export async function GET(req: Request) {
  const gate = await openRoute(req, { scope: 'read', need: 'browse' })
  if (!gate.ok) return gate.response
  const { caller } = gate
  const rules = await loadShopRules(caller, req, { fresh: true })
  let aiReady = false
  try {
    const { data } = await caller.db.from('settings').select('ai_api_key').eq('shop_id', caller.auth.shopId).order('updated_at', { ascending: false }).limit(1).maybeSingle()
    aiReady = hasAiKey(data)
  } catch { aiReady = false }
  return reply({
    ok: true,
    settings: rules.ctx.settings,
    rules: rules.rules,
    bookmarks: rules.bookmarks,
    missing: rules.missing,
    perms: { canAct: caller.canAct, canManage: caller.canManage },
    aiReady,
    defaultBlocked: DEFAULT_BLOCKED.map(d => ({ host: d.host, why: d.why })),
  })
}

export async function PUT(req: Request) {
  const body = await readJson(req) as { mode?: unknown; aiEnabled?: unknown; readerImages?: unknown } | null
  if (!body || typeof body !== 'object') return problem('That request was not understood.', 400)
  const gate = await openRoute(req, { scope: 'write', need: 'manage', write: true })
  if (!gate.ok) return gate.response
  const { caller } = gate
  const result = await saveSettings(caller.db, caller.auth.shopId, caller.auth.userId, {
    mode: body.mode === 'allowlist' ? 'allowlist' : body.mode === 'open' ? 'open' : undefined,
    aiEnabled: typeof body.aiEnabled === 'boolean' ? body.aiEnabled : undefined,
    readerImages: typeof body.readerImages === 'boolean' ? body.readerImages : undefined,
  })
  if (!result.ok) return problem(result.error, result.missing ? 409 : 500, { needsUpdate: result.missing })
  forgetShopRules(caller.auth.shopId)
  await audit(caller, 'browser.settings', { detail: `Mode ${result.value.mode}; Alpha ${result.value.aiEnabled ? 'on' : 'off'}; pictures ${result.value.readerImages ? 'on' : 'off'}` })
  return reply({ ok: true, settings: result.value })
}
