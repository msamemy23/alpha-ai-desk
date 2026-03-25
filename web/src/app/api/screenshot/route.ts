import { NextRequest, NextResponse } from 'next/server'

export const maxDuration = 30

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) return new NextResponse('Missing url', { status: 400 })

  // Try multiple screenshot services in order
  const services = [
    `https://image.thum.io/get/width/1280/noanimate/${encodeURIComponent(url)}`,
    `https://image.thum.io/get/width/1280/${encodeURIComponent(url)}`,
  ]

  for (const screenshotUrl of services) {
    try {
      const res = await fetch(screenshotUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'image/webp,image/png,image/*,*/*',
        },
        signal: AbortSignal.timeout(20000),
      })

      if (res.ok) {
        const imageBuffer = await res.arrayBuffer()
        const contentType = res.headers.get('content-type') || 'image/png'
        return new NextResponse(imageBuffer, {
          status: 200,
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=600, stale-while-revalidate=60',
            'Access-Control-Allow-Origin': '*',
          },
        })
      }
    } catch {
      // try next service
    }
  }

  return new NextResponse('Screenshot unavailable', { status: 502 })
}