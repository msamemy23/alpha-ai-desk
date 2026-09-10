import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop } from '@/lib/api-auth'
import { updateConnector } from '@/lib/connectors'
import { verifyOAuthState } from '@/lib/oauth-state'
import { getServiceClient } from '@/lib/supabase'
export const dynamic = 'force-dynamic'

const APP_ID = process.env.FACEBOOK_APP_ID || ''
const APP_SECRET = process.env.FACEBOOK_APP_SECRET || ''

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const base = (process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin).replace(/\/$/, '')
  const callback = `${base}/api/auth/facebook/callback`
  const code = searchParams.get('code')
  const error = searchParams.get('error')
  const state = searchParams.get('state')
  const errorReason = searchParams.get('error_reason') || ''
  const errorDesc = searchParams.get('error_description') || ''
  const auth = await getAuthedShop()

  if (error || !code) {
    const msg = errorDesc || errorReason || error || 'no_code'
    return NextResponse.redirect(`${base}/connectors?error=facebook_denied&detail=${encodeURIComponent(msg)}`)
  }
  if (!auth) return NextResponse.redirect(`${base}/login?error=facebook_auth_required`)
  if (!APP_ID || !APP_SECRET) {
    return NextResponse.redirect(`${base}/connectors?error=facebook_not_configured&detail=${encodeURIComponent('Missing FACEBOOK_APP_ID or FACEBOOK_APP_SECRET in Vercel env')}`)
  }
  if (!verifyOAuthState(state, 'facebook', auth.shopId)) {
    return NextResponse.redirect(`${base}/connectors?error=facebook_invalid_state`)
  }

  try {
    // 1. Exchange code for short-lived user access token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token` +
      `?client_id=${APP_ID}` +
      `&client_secret=${APP_SECRET}` +
      `&redirect_uri=${encodeURIComponent(callback)}` +
      `&code=${encodeURIComponent(code)}`
    )
    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) {
      const detail = tokenData.error?.message || JSON.stringify(tokenData)
      return NextResponse.redirect(`${base}/connectors?error=facebook_token_failed&detail=${encodeURIComponent(detail)}`)
    }
    const shortLivedToken = tokenData.access_token as string

    // 2. Exchange short-lived token for long-lived token (60 days)
    //    Page tokens obtained from a long-lived user token are PERMANENT (never expire)
    let userToken = shortLivedToken
    let tokenExpiresAt: string | null = null
    try {
      const llRes = await fetch(
        `https://graph.facebook.com/v21.0/oauth/access_token` +
        `?grant_type=fb_exchange_token` +
        `&client_id=${APP_ID}` +
        `&client_secret=${APP_SECRET}` +
        `&fb_exchange_token=${shortLivedToken}`
      )
      const llData = await llRes.json()
      if (llData.access_token) {
        userToken = llData.access_token as string
        // expires_in is in seconds (~5184000 = 60 days)
        tokenExpiresAt = llData.expires_in
          ? new Date(Date.now() + (llData.expires_in as number) * 1000).toISOString()
          : new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString()
      }
    } catch (e) {
      console.warn('[facebook-callback] long-lived token exchange failed, using short-lived:', e)
    }

    // 3. Get page access tokens (using long-lived user token → page tokens are permanent)
    const pagesRes  = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${userToken}`)
    const pagesData = await pagesRes.json()
    const pages: Array<{ id: string; name: string; access_token: string }> = pagesData.data || []

    // Prefer the page configured for this shop. Never select another tenant's
    // branded page just because it contains a hardcoded legacy name.
    const { data: shopSettings } = await getServiceClient()
      .from('settings')
      .select('shop_name')
      .eq('shop_id', auth.shopId)
      .maybeSingle()
    const configuredName = String(shopSettings?.shop_name || '').trim().toLowerCase()
    const matchingPages = configuredName
      ? pages.filter(p => p.name.toLowerCase() === configuredName || p.name.toLowerCase().includes(configuredName))
      : []
    const page = matchingPages.length === 1
      ? matchingPages[0]
      : pages.length === 1
        ? pages[0]
        : null

    if (!page) {
      await updateConnector('facebook', {
        enabled: false,
        access_token: userToken,
        token_expires_at: tokenExpiresAt,
        metadata: {
          note: pages.length > 1 ? 'multiple_pages_found_choose_one' : 'no_pages_found',
          available_pages: pages.map(({ id, name }) => ({ id, name })),
        },
        updated_at: new Date().toISOString(),
      }, auth.shopId)
      const errorCode = pages.length > 1 ? 'facebook_multiple_pages' : 'facebook_no_pages'
      return NextResponse.redirect(`${base}/connectors?error=${errorCode}`)
    }

    // 4. Get Instagram business account
    let igAccountId: string | null = null
    try {
      const igRes  = await fetch(`https://graph.facebook.com/v21.0/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`)
      const igData = await igRes.json()
      igAccountId  = igData?.instagram_business_account?.id || null
    } catch { /* not linked */ }

    // 5. Save Facebook connector (page tokens from long-lived user token never expire)
    await updateConnector('facebook', {
      enabled: true,
      access_token: userToken,
      token_expires_at: tokenExpiresAt,
      page_id: page.id,
      page_access_token: page.access_token,
      metadata: { page_name: page.name, instagram_account_id: igAccountId },
      updated_at: new Date().toISOString(),
      }, auth.shopId)

    // 6. Save Instagram connector
    if (igAccountId) {
      await updateConnector('instagram', {
        enabled: true,
        access_token: page.access_token,
        page_id: igAccountId,
        metadata: { page_name: page.name, facebook_page_id: page.id },
        updated_at: new Date().toISOString(),
      }, auth.shopId)
    }

    return NextResponse.redirect(`${base}/connectors?success=facebook`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[facebook-callback]', msg)
    return NextResponse.redirect(`${base}/connectors?error=facebook_internal&detail=${encodeURIComponent(msg)}`)
  }
}
