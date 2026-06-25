import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Only proxy images from the manual sources we use. Anything else is rejected
// so this can't be turned into an open SSRF proxy.
const ALLOWED_HOST = /(?:^|\.)charm\.li$|(?:^|\.)lemon-manuals\.(?:la|org\.ua|gy)$/i
const MAX_BYTES = 12 * 1024 * 1024

/**
 * Streams a manual diagram/image from charm.li / lemon-manuals through our own
 * origin so it renders inline in Alpha AI (those sites can block hot-linking).
 * Auth-gated by middleware; same-origin <img> requests carry the session cookie.
 */
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url') || ''
  let target: URL
  try { target = new URL(raw) } catch { return new NextResponse('Bad URL', { status: 400 }) }
  if (!['http:', 'https:'].includes(target.protocol) || !ALLOWED_HOST.test(target.hostname)) {
    return new NextResponse('Forbidden host', { status: 403 })
  }
  try {
    const upstream = await fetch(target.toString(), {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'referer': `${target.protocol}//${target.hostname}/`,
        'accept': 'image/avif,image/webp,image/png,image/*,*/*;q=0.8',
      },
      signal: AbortSignal.timeout(15000),
    })
    if (!upstream.ok) return new NextResponse('Upstream fetch failed', { status: 502 })
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
