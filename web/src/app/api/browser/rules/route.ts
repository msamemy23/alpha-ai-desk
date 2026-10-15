import { addRule, removeRule } from '@/lib/browser/store'
import { audit, forgetShopRules, openRoute, problem, readJson, reply } from '@/lib/browser/server'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const body = await readJson(req) as { host?: unknown; rule?: unknown; note?: unknown } | null
  if (!body || typeof body.host !== 'string') return problem('Type a site name such as example.com.', 400)
  const gate = await openRoute(req, { scope: 'write', need: 'manage', write: true })
  if (!gate.ok) return gate.response
  const { caller } = gate
  const result = await addRule(caller.db, caller.auth.shopId, caller.auth.userId, body.host, body.rule as 'allow' | 'block', typeof body.note === 'string' ? body.note : undefined)
  if (!result.ok) return problem(result.error, result.missing ? 409 : 400, { needsUpdate: result.missing })
  forgetShopRules(caller.auth.shopId)
  await audit(caller, 'browser.rule', { detail: `${result.value.rule === 'allow' ? 'Allowed' : 'Blocked'} ${result.value.host}` })
  return reply({ ok: true, rule: result.value })
}

export async function DELETE(req: Request) {
  const body = await readJson(req) as { id?: unknown } | null
  if (!body || typeof body.id !== 'string') return problem('That rule was not found.', 400)
  const gate = await openRoute(req, { scope: 'write', need: 'manage', write: true })
  if (!gate.ok) return gate.response
  const { caller } = gate
  const result = await removeRule(caller.db, caller.auth.shopId, body.id)
  if (!result.ok) return problem(result.error, result.missing ? 409 : 400, { needsUpdate: result.missing })
  forgetShopRules(caller.auth.shopId)
  await audit(caller, 'browser.rule', { detail: 'Removed a site rule' })
  return reply({ ok: true })
}
