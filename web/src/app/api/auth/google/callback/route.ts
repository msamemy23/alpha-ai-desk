import { NextRequest, NextResponse } from 'next/server'

const CLIENT_ID     = process.env.GOOGLE_CLIENT_ID     || '1736123851-r05fmhp9eb9pv7cn3t7joihcdjf1tl0m.apps.googleusercontent.com'
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || 'G0CSPX-2soFaZ6hikFNv6HVB2RZ7Tx2cFRO'
const CALLBACK      = 'https://alpha-ai-desk.vercel.app/api/auth/google/callback'
const SUPABASE_URL  = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://fztnsqrhjesqcnsszqdb.supabase.co'
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || ''

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
  return r
}

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const code  = searchParams.get('code')
  const error = searchParams.get('error')

  if (error || !code) {
    return NextResponse.redirect('https://alpha-ai-desk.vercel.app/connectors?error=google_denied')
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: CALLBACK,
        grant_type: 'authorization_code',
      }),
    })
    const tokenData = await tokenRes.json()

    if (!tokenData.access_token) {
      console.error('[google-callback] token error:', tokenData)
      return NextResponse.redirect('https://alpha-ai-desk.vercel.app/connectors?error=google_token_failed')
    }

    const { access_token, refresh_token, expires_in } = tokenData
    const expiresAt = new Date(Date.now() + (expires_in || 3600) * 1000).toISOString()

    // Save google_business connector
    await upsertConnector('google_business', {
      enabled: true,
      access_token,
      refresh_token: refresh_token || null,
      token_expires_at: expiresAt,
      metadata: {},
      updated_at: new Date().toISOString(),
    })

    // Save google_calendar connector (same tokens, different service)
    await upsertConnector('google_calendar', {
      enabled: true,
      access_token,
      refresh_token: refresh_token || null,
      token_expires_at: expiresAt,
      metadata: {},
      updated_at: new Date().toISOString(),
    })

    return NextResponse.redirect('https://alpha-ai-desk.vercel.app/connectors?success=google')
  } catch (err) {
    console.error('[google-callback]', err)
    return NextResponse.redirect('https://alpha-ai-desk.vercel.app/connectors?error=google_internal')
  }
}
