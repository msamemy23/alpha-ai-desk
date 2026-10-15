import { searchWeb } from '@/lib/browser/read-page'
import { audit, loadShopRules, openRoute, problem, readJson, reply } from '@/lib/browser/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

export async function POST(req: Request) {
  const body = await readJson(req) as { q?: unknown } | null
  if (!body || typeof body.q !== 'string') return problem('Type what to look for.', 400)
  const gate = await openRoute(req, { scope: 'search', need: 'browse', write: true })
  if (!gate.ok) return gate.response
  const { caller } = gate
  const rules = await loadShopRules(caller, req)
  const result = await searchWeb(body.q, rules.ctx, 'user')
  if (!result.ok) return problem(result.message, result.code === 'empty_query' ? 400 : 502, { code: result.code })
  await audit(caller, 'browser.search', { detail: result.query.slice(0, 120), meta: { results: result.hits.length, hidden: result.hidden } })
  return reply({ ok: true, query: result.query, hits: result.hits, hidden: result.hidden })
}
