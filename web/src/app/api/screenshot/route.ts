import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 30

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) return new NextResponse('Missing url', { status: 400 })

  const encoded = encodeURIComponent(url)
  const services = [
    `https://api.microlink.io/?url=${encoded}&screenshot=true&meta=false&embed=screenshot.url`,
    `https://s.wordpress.com/mshots/v1/${encoded}?w=1280`,
  ]

  for (const screenshotUrl of services) {
    try {
      const res = await fetch(screenshotUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(20000),
        redirect: 'follow',
      })

      if (res.ok) {
        const ct = res.headers.get('content-type') || ''
        if (ct.includes('image')) {
          const imageBuffer = await res.arrayBuffer()
          return new NextResponse(imageBuffer, {
            status: 200,
            headers: {
              'Content-Type': ct,
              'Cache-Control': 'public, max-age=600, stale-while-revalidate=60',
              'Access-Control-Allow-Origin': '*',
            },
          })
        }
      }
    } catch {
      // try next service
    }
  }

  return new NextResponse('Screenshot unavailable', { status: 502 })
}