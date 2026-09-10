import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop } from '@/lib/api-auth'
import { createOAuthState } from '@/lib/oauth-state'

export const dynamic = 'force-dynamic'

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''

const SCOPES = [
  'https://www.googleapis.com/auth/business.manage',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
].join(' ')

export async function GET(req: NextRequest) {
  const auth = await getAuthedShop()
  const base = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, '')
  if (!auth) return NextResponse.redirect(`${base}/login?error=google_auth_required`)
  if (!CLIENT_ID) {
    return NextResponse.redirect(
      `${base}/connectors?error=google_not_configured&detail=${encodeURIComponent('Set GOOGLE_CLIENT_ID in Vercel env')}`
    )
  }

  try {
    const state = createOAuthState('google', auth.shopId)
    const url =
      `https://accounts.google.com/o/oauth2/v2/auth` +
      `?client_id=${encodeURIComponent(CLIENT_ID)}` +
      `&redirect_uri=${encodeURIComponent(`${base}/api/auth/google/callback`)}` +
      `&response_type=code` +
      `&scope=${encodeURIComponent(SCOPES)}` +
      `&access_type=offline` +
      `&prompt=consent` +
      `&state=${encodeURIComponent(state)}`
    return NextResponse.redirect(url)
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'OAuth state is not configured'
    return NextResponse.redirect(`${base}/connectors?error=google_not_configured&detail=${encodeURIComponent(detail)}`)
  }
}
