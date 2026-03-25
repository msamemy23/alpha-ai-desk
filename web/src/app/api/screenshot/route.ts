import { NextRequest, NextResponse } from 'next/server'

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url')
  if (!url) return new NextResponse('Missing url', { status: 400 })

  try {
    const screenshotUrl = `https://image.thum.io/get/width/1280/${encodeURIComponent(url)}`
    const res = await fetch(screenshotUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(12000),
    })

    if (!res.ok) {
      return new NextResponse('Screenshot failed', { status: 502 })
    }

    const imageBuffer = await res.arrayBuffer()
    const contentType = res.headers.get('content-type') || 'image/png'

    return new NextResponse(imageBuffer, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
        'Access-Control-Allow-Origin': '*',
      },
    })
  } catch {
    return new NextResponse('Screenshot error', { status: 500 })
  }
}