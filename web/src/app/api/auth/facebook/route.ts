import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop } from '@/lib/api-auth'
import { createOAuthState } from '@/lib/oauth-state'

export const dynamic = 'force-dynamic'

const APP_ID = process.env.FACEBOOK_APP_ID || ''

const SCOPES = [
  'public_profile',
  'pages_show_list',
  'pages_read_engagement',
  'pages_manage_posts',
  'pages_manage_engagement',
  'pages_read_user_content',
  'instagram_basic',
  'instagram_manage_comments',
  'instagram_content_publish',
].join(',')

export async function GET(req: NextRequest) {
  const auth = await getAuthedShop()
  const base = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, '')
  if (!auth) return NextResponse.redirect(`${base}/login?error=facebook_auth_required`)
  if (!APP_ID) return NextResponse.redirect(`${base}/connectors?error=facebook_not_configured&detail=${encodeURIComponent('Set FACEBOOK_APP_ID in Vercel env')}`)

  try {
    const state = createOAuthState('facebook', auth.shopId)
    const url =
      `https://www.facebook.com/v21.0/dialog/oauth` +
      `?client_id=${encodeURIComponent(APP_ID)}` +
      `&redirect_uri=${encodeURIComponent(`${base}/api/auth/facebook/callback`)}` +
      `&scope=${encodeURIComponent(SCOPES)}` +
      `&response_type=code` +
      `&state=${encodeURIComponent(state)}`
    return NextResponse.redirect(url)
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'OAuth state is not configured'
    return NextResponse.redirect(`${base}/connectors?error=facebook_not_configured&detail=${encodeURIComponent(detail)}`)
  }
}
