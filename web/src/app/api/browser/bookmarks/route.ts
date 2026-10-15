import { addBookmark, removeBookmark } from '@/lib/browser/store'
import { audit, forgetShopRules, openRoute, problem, readJson, reply } from '@/lib/browser/server'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  const body = await readJson(req) as { title?: unknown; url?: unknown; kind?: unknown } | null
  if (!body || typeof body.url !== 'string') return problem('Type a web address.', 400)
  const gate = await openRoute(req, { scope: 'write', need: 'act', write: true })
  if (!gate.ok) return gate.response
  const { caller } = gate
  // Quick sites are shown to everyone in the shop and count as trusted, so only managers add them. Anyone can save a page.
  const kind = body.kind === 'saved' ? 'saved' : 'quick'
  if (kind === 'quick' && !caller.canManage) return problem('Only an owner, admin or manager can add quick sites.', 403)
  const result = await addBookmark(caller.db, caller.auth.shopId, caller.auth.userId, { title: typeof body.title === 'string' ? body.title : '', url: body.url, kind })
  if (!result.ok) return problem(result.error, result.missing ? 409 : 400, { needsUpdate: result.missing })
  forgetShopRules(caller.auth.shopId)
  await audit(caller, 'browser.bookmark', { url: result.value.url, detail: `Saved ${kind === 'quick' ? 'quick site' : 'page'}` })
  return reply({ ok: true, bookmark: result.value })
}

export async function DELETE(req: Request) {
  const body = await readJson(req) as { id?: unknown } | null
  if (!body || typeof body.id !== 'string') return problem('That one was not found.', 400)
  const gate = await openRoute(req, { scope: 'write', need: 'manage', write: true })
  if (!gate.ok) return gate.response
  const { caller } = gate
  const result = await removeBookmark(caller.db, caller.auth.shopId, body.id)
  if (!result.ok) return problem(result.error, result.missing ? 409 : 400, { needsUpdate: result.missing })
  forgetShopRules(caller.auth.shopId)
  await audit(caller, 'browser.bookmark', { detail: 'Removed a saved site' })
  return reply({ ok: true })
}
