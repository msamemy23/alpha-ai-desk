import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { checkRateLimit } from '@/lib/rate-limit'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://alpha-ai-desk.vercel.app'

export async function POST(req: NextRequest) {
  try {
    const { email, redirectTo } = await req.json()
    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    // Best-effort abuse brake: cap resets per IP and per email address. The
    // response shape never changes, so nothing is revealed either way.
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local'
    const ipLimit = checkRateLimit(`reset-pw:ip:${ip}`, 5, 15 * 60_000)
    const emailLimit = checkRateLimit(`reset-pw:email:${String(email).toLowerCase()}`, 3, 15 * 60_000)
    if (!ipLimit.ok || !emailLimit.ok) {
      return NextResponse.json({ ok: true })
    }

    // Only ever send users back to our own app.
    const safeRedirect = typeof redirectTo === 'string' && redirectTo.startsWith(APP_URL) ? redirectTo : undefined

    const sb = getServiceClient()
    const { error: resetError } = await sb.auth.resetPasswordForEmail(String(email).trim(), {
      redirectTo: safeRedirect,
    })

    if (resetError) {
      // Don't expose the error — prevents email enumeration.
      console.error('Reset email error:', resetError.message)
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Password reset error:', err)
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 })
  }
}
