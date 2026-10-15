import { canonicalAction } from '@/lib/browser/actions'
import { cleanDownloadName, downloadType, makeCheck } from '@/lib/browser/guard'
import { safeFetchFollow } from '@/lib/browser/safe-fetch'
import { consumeApproval, hashAction } from '@/lib/browser/store'
import { audit, loadShopRules, openRoute, problem, readJson } from '@/lib/browser/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_DOWNLOAD = 25 * 1024 * 1024

/**
 * Save a file from a website to the person's own device, after they approved exactly that address.
 * The file is passed straight through: Alpha never opens, unpacks, previews or runs it, and programs are refused outright.
 */
export async function POST(req: Request) {
  const body = await readJson(req) as { url?: unknown; approvalId?: unknown; name?: unknown } | null
  if (!body || typeof body.url !== 'string' || typeof body.approvalId !== 'string') return problem('That request was not understood.', 400)
  const gate = await openRoute(req, { scope: 'download', need: 'act', strictOrigin: true })
  if (!gate.ok) return gate.response
  const { caller } = gate
  const rules = await loadShopRules(caller, req)
  const check = makeCheck(rules.ctx, 'user')
  const first = check(body.url, { navigation: true })
  if (first) return problem(first, 403)

  const hash = hashAction(canonicalAction({ kind: 'download', url: body.url, fp: '', method: 'get', actionUrl: body.url, fields: [] }))
  if (!(await consumeApproval(caller.db, caller.auth.shopId, caller.auth.userId, body.approvalId, hash))) {
    return problem('This download was not approved, or the approval ran out of time. Ask again.', 403)
  }
  try {
    const { response, finalUrl } = await safeFetchFollow(body.url, { headers: { accept: '*/*' }, maxBytes: MAX_DOWNLOAD, timeoutMs: 40_000 }, { maxRedirects: 4, check: u => check(u.toString(), { navigation: true }) })
    if (!response.ok) return problem(`The website answered with an error (${response.status}).`, 502)
    const disposition = response.headers.get('content-disposition') || ''
    const named = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(disposition)?.[1]
    const fromPath = decodeURIComponent(finalUrl.pathname.split('/').pop() || '') || 'file'
    const { name, program } = cleanDownloadName(named ? decodeURIComponent(named) : typeof body.name === 'string' && body.name ? body.name : fromPath)
    if (program) {
      await audit(caller, 'browser.blocked', { url: finalUrl.toString(), detail: `Refused to download a program: ${name}` })
      return problem('That file is a program or script. Alpha does not download those.', 415)
    }
    const bytes = await response.arrayBuffer()
    await audit(caller, 'browser.download', { url: finalUrl.toString(), detail: `${name} (${Math.round(bytes.byteLength / 1024)} KB)`, approvalId: body.approvalId })
    return new Response(bytes, {
      status: 200,
      headers: {
        'content-type': downloadType(name),
        'content-disposition': `attachment; filename="${name.replace(/[^\x20-\x7e]/g, '_').replace(/"/g, '')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
        'cache-control': 'private, no-store',
      },
    })
  } catch {
    return problem('The file could not be downloaded.', 502)
  }
}
