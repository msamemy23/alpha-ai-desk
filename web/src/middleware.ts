import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://fztnsqrhjesqcnsszqdb.supabase.co'
const SUPABASE_ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'sb_publishable_EwRdKR6toaGlqbtoqQVbzw_nhXJwa8h'
const FALLBACK_SUPABASE_URL = 'https://fztnsqrhjesqcnsszqdb.supabase.co'
const FALLBACK_SUPABASE_ANON = 'sb_publishable_EwRdKR6toaGlqbtoqQVbzw_nhXJwa8h'
const SUPABASE_AUTH_COOKIES = Array.from(
  new Set(
    [SUPABASE_URL, FALLBACK_SUPABASE_URL].map(url => `sb-${new URL(url).hostname.split('.')[0]}-auth-token`)
  )
)
const SUPABASE_AUTH_TARGETS = Array.from(
  new Map(
    [
      [SUPABASE_URL, SUPABASE_ANON],
      [FALLBACK_SUPABASE_URL, FALLBACK_SUPABASE_ANON],
    ].map(([url, key]) => [url, { url, key }])
  ).values()
)

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

function decodeBase64Url(value: string) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

function getCookieValue(req: NextRequest, key: string) {
  const direct = req.cookies.get(key)?.value
  if (direct) return direct

  const chunks: string[] = []
  for (let index = 0; ; index += 1) {
    const chunk = req.cookies.get(`${key}.${index}`)?.value
    if (!chunk) break
    chunks.push(chunk)
  }

  return chunks.length ? chunks.join('') : null
}

function getAccessTokenFromCookie(req: NextRequest) {
  const cookieValue = SUPABASE_AUTH_COOKIES
    .map(cookieName => getCookieValue(req, cookieName))
    .find(Boolean)

  if (!cookieValue) return null

  try {
    const sessionJson = cookieValue.startsWith('base64-')
      ? decodeBase64Url(cookieValue.slice('base64-'.length))
      : cookieValue
    const session = JSON.parse(sessionJson) as { access_token?: unknown }
    return typeof session.access_token === 'string' ? session.access_token : null
  } catch {
    return null
  }
}

async function verifyUserFromCookie(req: NextRequest) {
  const accessToken = getAccessTokenFromCookie(req)
  if (!accessToken) return null

  try {
    for (const target of SUPABASE_AUTH_TARGETS) {
      const response = await fetch(`${target.url}/auth/v1/user`, {
        headers: {
          apikey: target.key,
          authorization: `Bearer ${accessToken}`,
        },
        cache: 'no-store',
      })

      if (response.ok) return await response.json()
    }

    return null
  } catch {
    return null
  }
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

  const { data: { user: supabaseUser } } = await supabase.auth.getUser()
  const user = supabaseUser || await verifyUserFromCookie(req)

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
