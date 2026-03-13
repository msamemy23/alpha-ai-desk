import { NextRequest, NextResponse } from 'next/server'

const APP_ID     = process.env.FACEBOOK_APP_ID     || '1379263117302106'
const APP_SECRET = process.env.FACEBOOK_APP_SECRET || 'f7c21374d2d0b34fc00f9061dae5d286'
const CALLBACK   = 'https://alpha-ai-desk.vercel.app/api/auth/facebook/callback'
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://fztnsqrhjesqcnsszqdb.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const TARGET_PAGE = 'Alpha international auto center'

async function upsertConnector(service: string, data: Record<string, unknown>) {
  await fetch(`${SUPABASE_URL}/rest/v1/connectors`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=representation',
    },
    body: JSON.stringify({ service, ...data }),
  })
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code  = searchParams.get('code')
  const error = searchParams.get('error')

  if (error || !code) {
    return NextResponse.redirect('https://alpha-ai-desk.vercel.app/connectors?error=facebook_denied')
  }

  try {
    // 1. Exchange code for user access token
    const tokenRes = await fetch(
      `https://graph.facebook.com/v21.0/oauth/access_token` +
      `?client_id=${APP_ID}` +
      `&client_secret=${APP_SECRET}` +
      `&redirect_uri=${encodeURIComponent(CALLBACK)}` +
      `&code=${code}`
    )
    const tokenData = await tokenRes.json()
    if (!tokenData.access_token) {
      return NextResponse.redirect('https://alpha-ai-desk.vercel.app/connectors?error=facebook_token_failed')
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
        updated_at: new Date().toISOString(),
      })
      return NextResponse.redirect('https://alpha-ai-desk.vercel.app/connectors?success=facebook')
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

    return NextResponse.redirect('https://alpha-ai-desk.vercel.app/connectors?success=facebook')
  } catch (err) {
    console.error('[facebook-callback]', err)
    return NextResponse.redirect('https://alpha-ai-desk.vercel.app/connectors?error=facebook_internal')
  }
}
