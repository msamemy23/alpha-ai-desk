import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop } from '@/lib/api-auth'
import { updateConnector } from '@/lib/connectors'
import { verifyOAuthState } from '@/lib/oauth-state'

export const dynamic = 'force-dynamic'

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || ''
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET_V2 || process.env.GOOGLE_CLIENT_SECRET || ''

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const base = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, '')
  const code = searchParams.get('code')
  const oauthError = searchParams.get('error')
  const state = searchParams.get('state')
  const auth = await getAuthedShop()

  if (oauthError || !code) {
    const msg = oauthError || 'no_code'
    return NextResponse.redirect(`${base}/connectors?error=google_denied&detail=${encodeURIComponent(msg)}`)
  }
  if (!auth) return NextResponse.redirect(`${base}/login?error=google_auth_required`)
  if (!verifyOAuthState(state, 'google', auth.shopId)) {
    return NextResponse.redirect(`${base}/connectors?error=google_invalid_state`)
  }
  if (!CLIENT_ID || !CLIENT_SECRET) {
    return NextResponse.redirect(`${base}/connectors?error=google_not_configured&detail=${encodeURIComponent('Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in Vercel env')}`)
  }

  try {
    const callback = `${base}/api/auth/google/callback`
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: callback,
        grant_type: 'authorization_code',
      }),
    })
    const tokenData = await tokenRes.json().catch(() => ({}))
    if (!tokenRes.ok || !tokenData.access_token) {
      const detail = tokenData.error_description || tokenData.error || `Google token exchange failed with HTTP ${tokenRes.status}`
      return NextResponse.redirect(`${base}/connectors?error=google_token_failed&detail=${encodeURIComponent(detail)}`)
    }

    const expiresAt = new Date(Date.now() + (tokenData.expires_in || 3600) * 1000).toISOString()
    const connectorData = {
      enabled: true,
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || null,
      token_expires_at: expiresAt,
      metadata: {},
    }
    await updateConnector('google_business', connectorData, auth.shopId)
    await updateConnector('google_calendar', connectorData, auth.shopId)
    return NextResponse.redirect(`${base}/connectors?success=google`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[google-callback]', msg)
    return NextResponse.redirect(`${base}/connectors?error=google_internal&detail=${encodeURIComponent(msg.slice(0, 200))}`)
  }
}
