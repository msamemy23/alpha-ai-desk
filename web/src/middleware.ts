import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://fztnsqrhjesqcnsszqdb.supabase.co'
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_EwRdKR6toaGlqbtoqQVbzw_nhXJwa8h'

const PUBLIC_API_PREFIXES = [
  '/api/auth/',
  '/api/calls/webhook',
  '/api/growth/capture',
  '/api/reset-password',
  '/api/sign',
  '/api/signature',
  '/api/sms',
  '/api/sms-inbound',
  '/api/telnyx-voice-webhook',
  '/api/voice-join/',
]

function hasInternalApiSecret(req: NextRequest) {
  const secret = process.env.CRON_SECRET || process.env.INTERNAL_API_SECRET
  return !!secret && req.headers.get('authorization') === `Bearer ${secret}`
}

function isPublicApiPath(pathname: string) {
  return PUBLIC_API_PREFIXES.some(prefix => pathname === prefix || pathname.startsWith(prefix))
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (
    pathname.startsWith('/login') ||
    pathname.startsWith('/auth/') ||
    pathname.startsWith('/sign/') ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico'
  ) {
    return NextResponse.next()
  }

  const res = NextResponse.next({ request: req })
  const supabase = createServerClient(SUPABASE_URL, SUPABASE_ANON, {
    cookies: {
      getAll() {
        return req.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value, options }) => res.cookies.set(name, value, options))
      },
    },
  })

  const { data: { user } } = await supabase.auth.getUser()

  if (pathname.startsWith('/api/')) {
    if (isPublicApiPath(pathname) || hasInternalApiSecret(req)) return res
    if (!user) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
    }
    return res
  }

  if (!user) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  return res
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
