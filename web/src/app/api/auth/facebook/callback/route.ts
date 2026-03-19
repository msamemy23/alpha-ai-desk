import { NextRequest, NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'

const APP_ID     = process.env.FACEBOOK_APP_ID     || '1379263117302106'
const APP_SECRET = process.env.FACEBOOK_APP_SECRET || 'f7c21374d2d0b34fc00f9061dae5d286'
const CALLBACK   = 'https://alpha-ai-desk.vercel.app/api/auth/facebook/callback'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://fztnsqrhjesqcnsszqdb.supabase.co'
const SUPABASE_KEY = (
  process.env.SUPABASE_SERVICE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_SERVICE_KEY ||
  'sb_secret_mWF8aie41hs0Kf-BzAU2mA_zE25LCHT'
)
const BASE = 'https://alpha-ai-desk.vercel.app'

async function updateConnector(service: string, data: Record<string, unknown>) {
  const url = `${SUPABASE_URL}/rest/v1/connectors?service=eq.${service}`
  const r = await fetch(url, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(data),
  })
  if (!r.ok) {
    const text = await r.text()
    console.error(`[updateConnector ${service}] ${r.status}: ${text}`)
    throw new Error(`Supabase update failed: ${r.status} ${text}`)
  }
  return r
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code        = searchParams.get('code')
  const error       = searchParams.get('error')
  const errorReason = searchParams.get('error_reason') || ''
  const errorDesc   = searchParams.get('error_description') || ''

  if (error || !code) {
    const msg = errorDesc || errorReason || error || 'no_code'
    return NextResponse.redirect(`${BASE}/connectors?error=facebook_denied&detail=${encodeURIComponent(msg)}`)
  }

  try {
    // 1. Exchange code for short-lived user access token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token` +
      `?client_id=${APP_ID}` +
      `&client_secret=${APP_SECRET}` +
      `&redirect_uri=${encodeURIComponent(CALLBACK)}` +
      `&code=${encodeURIComponent(code)}`
    )
    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) {
      const detail = tokenData.error?.message || JSON.stringify(tokenData)
      return NextResponse.redirect(`${BASE}/connectors?error=facebook_token_failed&detail=${encodeURIComponent(detail)}`)
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

    // Find our target page
    const page = pages.find(
      p => p.name.toLowerCase().includes('alpha') || p.name.toLowerCase().includes('international')
    ) || pages[0]

    if (!page) {
      await updateConnector('facebook', {
        enabled: true,
        access_token: userToken,
        token_expires_at: tokenExpiresAt,
        metadata: { note: 'no_pages_found' },
        updated_at: new Date().toISOString(),
      })
      return NextResponse.redirect(`${BASE}/connectors?success=facebook&note=no_pages`)
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
    })

    // 6. Save Instagram connector
    if (igAccountId) {
      await updateConnector('instagram', {
        enabled: true,
        access_token: page.access_token,
        page_id: igAccountId,
        metadata: { page_name: page.name, facebook_page_id: page.id },
        updated_at: new Date().toISOString(),
      })
    }

    return NextResponse.redirect(`${BASE}/connectors?success=facebook`)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[facebook-callback]', msg)
    return NextResponse.redirect(`${BASE}/connectors?error=facebook_internal&detail=${encodeURIComponent(msg)}`)
  }
}
