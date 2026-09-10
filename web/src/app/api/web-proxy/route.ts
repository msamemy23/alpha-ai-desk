import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { assertPublicUrl, fetchPublicUrl, tryPublicUrl } from '@/lib/public-url'

export const dynamic = 'force-dynamic'

const MAX_BYTES = 8 * 1024 * 1024
const MAX_REDIRECTS = 3

async function parsePublicUrl(raw: string, base?: URL): Promise<URL | null> {
  try {
    return await assertPublicUrl(raw, base)
  } catch {
    return null
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] || ch))
}

function sanitizeHtml(html: string): string {
  // This response is same-origin with the app. Remove active content and
  // enforce a restrictive CSP so a remote page cannot read app cookies/data.
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe\b[\s\S]*?<\/iframe>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/\b(href|src|action)\s*=\s*(['"])\s*javascript:[\s\S]*?\2/gi, '$1=$2$2')
    .replace(/<form\b/gi, '<div data-blocked-form="true"')
    .replace(/<\/form>/gi, '</div>')
}

async function fetchPublic(target: URL): Promise<{ response: Response; url: URL } | null> {
  let current = target
  for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt += 1) {
    const response = await fetchPublicUrl(current, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,image/*,text/plain;q=0.8,*/*;q=0.5',
      },
      signal: AbortSignal.timeout(20000),
      maxBytes: MAX_BYTES,
    })
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location')
      const next = location ? await tryPublicUrl(location, current) : null
      if (!next) return null
      current = next
      continue
    }
    return { response, url: current }
  }
  return null
}

export async function GET(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()

  const raw = req.nextUrl.searchParams.get('url') || ''
  const target = await parsePublicUrl(raw)
  if (!target) return new NextResponse('Forbidden or invalid URL', { status: 400 })

  try {
    const result = await fetchPublic(target)
    if (!result || !result.response.ok) return new NextResponse('Upstream fetch failed', { status: 502 })

    const { response, url: finalUrl } = result
    const contentType = response.headers.get('content-type') || ''
    const declaredLength = Number(response.headers.get('content-length') || 0)
    if (declaredLength > MAX_BYTES) return new NextResponse('Response too large', { status: 413 })

    const body = await response.arrayBuffer()
    if (body.byteLength > MAX_BYTES) return new NextResponse('Response too large', { status: 413 })

    if (!contentType.includes('text/html')) {
      // SVG can contain script/event content and would be served same-origin
      // by this proxy. Keep active vector documents out of the response path.
      if (contentType.toLowerCase().startsWith('image/svg+xml')) {
        return new NextResponse('Unsupported active image type', { status: 415 })
      }
      if (!contentType.startsWith('image/') && !contentType.startsWith('text/plain')) {
        return new NextResponse('Unsupported content type', { status: 415 })
      }
      return new NextResponse(body, {
        headers: {
          'Content-Type': contentType || 'application/octet-stream',
          'Cache-Control': 'private, max-age=300',
          'X-Content-Type-Options': 'nosniff',
        },
      })
    }

    const decoder = new TextDecoder()
    let html = sanitizeHtml(decoder.decode(body))
    const origin = finalUrl.origin
    const basePath = finalUrl.pathname.replace(/\/[^\/]*$/, '/')
    const baseHref = escapeHtml(`${origin}${basePath}`)
    if (!/<base\b/i.test(html)) {
      html = html.replace(/<head([^>]*)>/i, `<head$1><base href="${baseHref}">`)
    }

    const overlay = `
      <div id="__proxy_bar" style="position:fixed;top:0;left:0;right:0;height:32px;background:#1a1a2e;color:#8b8ba7;font:12px/32px system-ui;padding:0 12px;z-index:999999;display:flex;align-items:center;gap:8px;border-bottom:1px solid #2a2a4a;">
        <span style="color:#4ade80;">&#9679;</span>
        <span style="color:#e2e2f0;font-weight:500;">Alpha Browser</span>
        <span style="flex:1;background:#0d0d1a;border-radius:4px;padding:2px 8px;color:#8b8ba7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escapeHtml(finalUrl.toString())}</span>
      </div>
      <div style="height:32px;"></div>
    `
    html = html.replace(/<body([^>]*)>/i, `<body$1>${overlay}`)

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'private, no-store',
        'Content-Security-Policy': "default-src 'none'; base-uri 'none'; form-action 'none'; script-src 'none'; style-src 'unsafe-inline' https:; img-src https: data:; font-src https: data:; media-src https:; frame-src https:; connect-src 'none'",
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new NextResponse(
      `<html><body style="background:#0d0d1a;color:#e2e2f0;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"><div style="text-align:center;"><h2>Failed to load page</h2><p style="color:#8b8ba7;">${escapeHtml(message)}</p><p style="color:#4a4a6a;font-size:13px;">${escapeHtml(finalUrlForError(raw))}</p></div></body></html>`,
      { status: 502, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'private, no-store' } },
    )
  }
}

function finalUrlForError(raw: string): string {
  return raw.slice(0, 500)
}
