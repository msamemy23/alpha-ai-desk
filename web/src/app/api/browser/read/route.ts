import { readPage } from '@/lib/browser/read-page'
import { audit, loadShopRules, openRoute, problem, readJson, reply } from '@/lib/browser/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/** Reader view: the page as plain blocks Alpha draws itself. The site's own HTML is never sent to the screen. */
export async function POST(req: Request) {
  const body = await readJson(req) as { url?: unknown } | null
  if (!body || typeof body.url !== 'string') return problem('Type a web address or a search.', 400)
  const gate = await openRoute(req, { scope: 'read', need: 'browse', write: true })
  if (!gate.ok) return gate.response
  const { caller } = gate
  const rules = await loadShopRules(caller, req)
  const result = await readPage(body.url, rules.ctx, 'user')
  if (!result.ok) {
    if (result.code === 'blocked') await audit(caller, 'browser.blocked', { url: body.url, detail: result.message })
    const status = result.code === 'blocked' ? 403 : result.code === 'bad_url' ? 400 : result.code === 'not_found' ? 404 : result.code === 'timeout' ? 504 : 502
    return problem(result.message, status, { code: result.code })
  }
  await audit(caller, 'browser.read', { url: result.finalUrl, detail: result.doc.title })
  return reply({ ok: true, doc: result.doc, finalUrl: result.finalUrl, images: rules.ctx.settings.readerImages })
}
