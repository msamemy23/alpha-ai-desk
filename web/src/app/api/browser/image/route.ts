import { safeFetchFollow, isSafeImageType } from '@/lib/browser/safe-fetch'
import { makeCheck } from '@/lib/browser/guard'
import { loadShopRules, openRoute, problem } from '@/lib/browser/server'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

const MAX_IMAGE = 2.5 * 1024 * 1024

/** A picture for reader view, fetched by Alpha. Raster pictures only (never SVG), checked like any other page, never straight from the site. */
export async function GET(req: Request) {
  const gate = await openRoute(req, { scope: 'image', need: 'browse' })
  if (!gate.ok) return gate.response
  const { caller } = gate
  const target = new URL(req.url).searchParams.get('u') || ''
  const rules = await loadShopRules(caller, req)
  if (!rules.ctx.settings.readerImages) return problem('Pictures are turned off in the browser settings.', 403)
  const check = makeCheck(rules.ctx, 'user')
  // A picture is part of a page, so it follows the same rules as what a page loads.
  const first = check(target, { navigation: false })
  if (first) return problem(first, 403)
  try {
    const { response } = await safeFetchFollow(target, { headers: { accept: 'image/avif,image/webp,image/png,image/jpeg,image/gif,*/*;q=0.1' }, maxBytes: MAX_IMAGE, timeoutMs: 10_000 }, {
      maxRedirects: 3, check: u => check(u.toString(), { navigation: false }),
    })
    const type = response.headers.get('content-type') || ''
    if (!response.ok || !isSafeImageType(type)) return problem('That is not a picture Alpha can show.', 415)
    const bytes = await response.arrayBuffer()
    if (bytes.byteLength > MAX_IMAGE) return problem('That picture is too large.', 413)
    return new Response(bytes, {
      status: 200,
      headers: {
        'content-type': type.split(';')[0].trim().toLowerCase(),
        'cache-control': 'private, max-age=3600',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
        'cross-origin-resource-policy': 'same-origin',
      },
    })
  } catch {
    return problem('That picture could not be loaded.', 502)
  }
}
