import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

// Web proxy — fetches HTML from any URL and serves it with relaxed headers
// so it can be displayed in an iframe inside the app.
// Also rewrites relative URLs to absolute.

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) return new NextResponse('Missing url param', { status: 400 })

  try {
    const target = url.startsWith('http') ? url : `https://${url}`
    const r = await fetch(target, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,*/*',
      },
      redirect: 'follow',
    })

    const contentType = r.headers.get('content-type') || 'text/html'

    // For non-HTML (images, etc), just pass through
    if (!contentType.includes('text/html')) {
      const body = await r.arrayBuffer()
      return new NextResponse(body, {
        headers: {
          'Content-Type': contentType,
          'Access-Control-Allow-Origin': '*',
        },
      })
    }

    let html = await r.text()

    // Extract base URL for rewriting relative paths
    const baseUrl = new URL(target)
    const origin = baseUrl.origin
    const basePath = baseUrl.pathname.replace(/\/[^\/]*$/, '/')

    // Inject <base> tag so relative URLs resolve correctly
    if (!html.includes('<base')) {
      html = html.replace(
        /<head([^>]*)>/i,
        `<head$1><base href="${origin}${basePath}">`
      )
    }

    // Remove X-Frame-Options and CSP frame-ancestors that would block embedding
    // Add a small overlay bar showing the URL
    const overlay = `
      <div id="__proxy_bar" style="position:fixed;top:0;left:0;right:0;height:32px;background:#1a1a2e;color:#8b8ba7;font:12px/32px system-ui;padding:0 12px;z-index:999999;display:flex;align-items:center;gap:8px;border-bottom:1px solid #2a2a4a;">
        <span style="color:#4ade80;">&#9679;</span>
        <span style="color:#e2e2f0;font-weight:500;">Alpha Browser</span>
        <span style="flex:1;background:#0d0d1a;border-radius:4px;padding:2px 8px;color:#8b8ba7;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${target}</span>
      </div>
      <div style="height:32px;"></div>
    `
    html = html.replace(/<body([^>]*)>/i, `<body$1>${overlay}`)

    return new NextResponse(html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Access-Control-Allow-Origin': '*',
        'X-Frame-Options': 'ALLOWALL',
      },
    })
  } catch (err) {
    return new NextResponse(
      `<html><body style="background:#0d0d1a;color:#e2e2f0;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;"><div style="text-align:center;"><h2>Failed to load page</h2><p style="color:#8b8ba7;">${err instanceof Error ? err.message : 'Unknown error'}</p><p style="color:#4a4a6a;font-size:13px;">${url}</p></div></body></html>`,
      {
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Frame-Options': 'ALLOWALL',
        },
      }
    )
  }
}
