import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const { email, redirectTo } = await req.json()
    if (!email) {
      return NextResponse.json({ error: 'Email is required' }, { status: 400 })
    }

    const sb = getServiceClient()

    // Use admin API to generate recovery link
    const { data, error } = await sb.auth.admin.generateLink({
      type: 'recovery',
      email: email.trim(),
      options: { redirectTo: redirectTo || undefined }
    })

    if (error) {
      // If user not found, still return success to prevent email enumeration
      if (error.message?.includes('not found') || error.message?.includes('invalid')) {
        return NextResponse.json({ ok: true })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    // The admin generateLink returns the link but doesn't send email.
    // We need to use resetPasswordForEmail from the service client which has
    // higher rate limits than the anon key.
    const { error: resetError } = await sb.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: redirectTo || undefined
    })

    if (resetError) {
      // If service role also fails, try admin approach to still show success
      console.error('Reset email error:', resetError.message)
      // Don't expose error to prevent enumeration
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('Password reset error:', err)
    return NextResponse.json({ error: 'Failed to process request' }, { status: 500 })
  }
}
