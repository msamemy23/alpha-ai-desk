import { NextRequest, NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const APP_ID     = process.env.FACEBOOK_APP_ID     || '1379263117302106'
const APP_SECRET = process.env.FACEBOOK_APP_SECRET || 'f7c21374d2d0b34fc00f9061dae5d286'
const CALLBACK   = 'https://alpha-ai-desk.vercel.app/api/auth/facebook/callback'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://fztnsqrhjesqcnsszqdb.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

const BASE = 'https://alpha-ai-desk.vercel.app'

async function upsertConnector(service: string, data: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/connectors`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify({ service, ...data }),
  })
  if (!r.ok) {
    const text = await r.text()
    console.error(`[upsert ${service}] ${r.status}: ${text}`)
  }
  return r
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code  = searchParams.get('code')
  const error = searchParams.get('error')
  const errorReason = searchParams.get('error_reason') || ''
  const errorDesc   = searchParams.get('error_description') || ''

  if (error || !code) {
    const msg = errorDesc || errorReason || error || 'no_code'
    return NextResponse.redirect(`${BASE}/connectors?error=facebook_denied&detail=${encodeURIComponent(msg)}`)
  }

  try {
    // 1. Exchange code for user access token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token` +
      `?client_id=${APP_ID}` +
      `&client_secret=${APP_SECRET}` +
      `&redirect_uri=${encodeURIComponent(CALLBACK)}` +
      `&code=${encodeURIComponent(code)}`
    )
    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) {
      const detail = tokenData.error?.message || tokenData.error?.type || JSON.stringify(tokenData)
      console.error('[facebook-callback] token error:', detail)
      return NextResponse.redirect(`${BASE}/connectors?error=facebook_token_failed&detail=${encodeURIComponent(detail)}`)
    }
    const userToken = tokenData.access_token as string

    // 2. Get page access tokens
    const pagesRes = await fetch(
      `https://graph.facebook.com/v21.0/me/accounts?access_token=${userToken}`
    )
    const pagesData = await pagesRes.json()
    const pages: Array<{ id: string; name: string; access_token: string }> = pagesData.data || []

    // Find our target page (case-insensitive match or first page)
    const page = pages.find(
      p => p.name.toLowerCase().includes('alpha') || p.name.toLowerCase().includes('international')
    ) || pages[0]

    if (!page) {
      // Save the user token at least
      await upsertConnector('facebook', {
        enabled: true,
        access_token: userToken,
        metadata: { note: 'no_pages_found' },
        updated_at: new Date().toISOString(),
      })
      return NextResponse.redirect(`${BASE}/connectors?success=facebook&note=no_pages`)
    }

    // 3. Get Instagram business account linked to this page
    let igAccountId: string | null = null
    try {
      const igRes = await fetch(
        `https://graph.facebook.com/v21.0/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`
      )
      const igData = await igRes.json()
      igAccountId = igData?.instagram_business_account?.id || null
    } catch { /* instagram not linked */ }

    // 4. Save Facebook connector
    await upsertConnector('facebook', {
      enabled: true,
      access_token: userToken,
      page_id: page.id,
      page_access_token: page.access_token,
      metadata: { page_name: page.name, instagram_account_id: igAccountId },
      updated_at: new Date().toISOString(),
    })

    // 5. Save Instagram connector (shares the same token flow)
    if (igAccountId) {
      await upsertConnector('instagram', {
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
