import { readPage } from '@/lib/browser/read-page'
import { PROXY_CSP, renderProxyMessage, renderProxyPage } from '@/lib/browser/proxy-page'
import { audit, loadShopRules, openRoute } from '@/lib/browser/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

/**
 * The older "open this address" route. It used to pass a site's HTML straight through from the app's own address, which let
 * any page run next to the app. It now reads the page and writes a fresh plain one (headings, text, lists, tables, links),
 * under a policy that lets nothing run or load. The checks are the Browser page's: sign-in, rate limit, public sites only,
 * the shop's allow and block lists, size and time limits, and a line in the audit log.
 */
const HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'private, no-store',
  'content-security-policy': PROXY_CSP,
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'SAMEORIGIN',
  'referrer-policy': 'no-referrer',
  'cross-origin-resource-policy': 'same-origin',
}

function page(title: string, message: string, status: number): Response {
  return new Response(renderProxyMessage(title, message), { status, headers: HEADERS })
}

export async function GET(req: Request) {
  const gate = await openRoute(req, { scope: 'read', need: 'browse', write: true })
  if (!gate.ok) return gate.response
  const { caller } = gate
  const raw = new URL(req.url).searchParams.get('url') || ''
  if (!raw) return page('No address', 'Add a web address to open.', 400)

  const rules = await loadShopRules(caller, req)
  const result = await readPage(raw, rules.ctx, 'user')
  if (!result.ok) {
    if (result.code === 'blocked') await audit(caller, 'browser.blocked', { url: raw, detail: result.message })
    const status = result.code === 'blocked' ? 403 : result.code === 'bad_url' ? 400 : result.code === 'not_found' ? 404 : result.code === 'too_large' ? 413 : result.code === 'type' ? 415 : result.code === 'timeout' ? 504 : 502
    return page('That page was not opened', result.message, status)
  }
  await audit(caller, 'browser.read', { url: result.finalUrl, detail: result.doc.title })
  return new Response(renderProxyPage(result.doc, { note: 'Read-only copy' }), { status: 200, headers: HEADERS })
}
