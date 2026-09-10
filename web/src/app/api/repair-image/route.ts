import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { assertPublicUrl } from '@/lib/public-url'

export const dynamic = 'force-dynamic'

// Only proxy images from the manual sources we use. Exact-match hostnames so
// this can't be turned into an open SSRF proxy.
const ALLOWED_HOSTS = new Set([
  'charm.li',
  'www.charm.li',
  'lemon-manuals.la',
  'www.lemon-manuals.la',
  'lemon-manuals.org.ua',
  'www.lemon-manuals.org.ua',
  'lemon-manuals.gy',
  'www.lemon-manuals.gy',
])
const MAX_BYTES = 12 * 1024 * 1024
const MAX_REDIRECTS = 3

function isAllowedHost(hostname: string) {
  return ALLOWED_HOSTS.has(hostname.toLowerCase())
}

async function fetchAllowedImage(target: URL): Promise<{ response: Response; url: URL } | null> {
  let current = target
  for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt += 1) {
    const response = await fetch(current.toString(), {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'referer': `${current.protocol}//${current.hostname}/`,
        'accept': 'image/avif,image/webp,image/png,image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(15000),
      redirect: 'manual',
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      if (!location || attempt === MAX_REDIRECTS) return null
      let next: URL
      try { next = await assertPublicUrl(location, current) } catch { return null }
      if (!isAllowedHost(next.hostname)) return null
      current = next
      continue
    }
    return { response, url: current }
  }
  return null
}

/**
 * Streams a manual diagram/image from charm.li / lemon-manuals through our own
 * origin so it renders inline in Alpha AI (those sites can block hot-linking).
 * Auth-gated by middleware; same-origin <img> requests carry the session cookie.
 */
export async function GET(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  const raw = req.nextUrl.searchParams.get('url') || ''
  let target: URL
  try { target = new URL(raw) } catch { return new NextResponse('Bad URL', { status: 400 }) }
  if (!['http:', 'https:'].includes(target.protocol) || !isAllowedHost(target.hostname)) {
    return new NextResponse('Forbidden host', { status: 403 })
  }
  try {
    target = await assertPublicUrl(target.toString())
  } catch {
    return new NextResponse('Forbidden host', { status: 403 })
  }
  try {
    const fetched = await fetchAllowedImage(target)
    if (!fetched || !fetched.response.ok) return new NextResponse('Upstream fetch failed', { status: 502 })
    const { response: upstream } = fetched
    const contentType = upstream.headers.get('content-type') || 'image/jpeg'
    if (!contentType.startsWith('image/')) return new NextResponse('Not an image', { status: 415 })
    const buf = Buffer.from(await upstream.arrayBuffer())
    if (buf.length > MAX_BYTES) return new NextResponse('Image too large', { status: 413 })
    return new NextResponse(buf, {
      headers: {
        'content-type': contentType,
        'cache-control': 'public, max-age=86400',
      },
    })
  } catch {
    return new NextResponse('Proxy error', { status: 502 })
  }
}
