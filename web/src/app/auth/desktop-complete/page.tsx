'use client'

import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, supabaseAuthStorageKey } from '@/lib/supabase'

const COOKIE_MAX_AGE = 400 * 24 * 60 * 60
const MAX_COOKIE_CHUNK_SIZE = 3180
const AUTH_COOKIE_PREFIX = 'base64-'

function toBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  bytes.forEach(byte => {
    binary += String.fromCharCode(byte)
  })

  return window
    .btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function createCookieChunks(name: string, value: string) {
  let encodedValue = encodeURIComponent(value)

  if (encodedValue.length <= MAX_COOKIE_CHUNK_SIZE) {
    return [{ name, value }]
  }

  const values: string[] = []
  while (encodedValue.length > 0) {
    let encodedHead = encodedValue.slice(0, MAX_COOKIE_CHUNK_SIZE)
    const lastEscapePos = encodedHead.lastIndexOf('%')

    if (lastEscapePos > MAX_COOKIE_CHUNK_SIZE - 3) {
      encodedHead = encodedHead.slice(0, lastEscapePos)
    }

    values.push(decodeURIComponent(encodedHead))
    encodedValue = encodedValue.slice(encodedHead.length)
  }

  return values.map((chunk, index) => ({ name: `${name}.${index}`, value: chunk }))
}

function setCookie(name: string, value: string, maxAge: number) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : ''
  document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=/; SameSite=Lax${secure}`
}

function removeCookie(name: string) {
  setCookie(name, '', 0)
}

function persistSupabaseSessionCookie(session: Session) {
  for (let index = 0; index < 10; index += 1) {
    removeCookie(`${supabaseAuthStorageKey}.${index}`)
  }
  removeCookie(supabaseAuthStorageKey)

  const encodedSession = `${AUTH_COOKIE_PREFIX}${toBase64Url(JSON.stringify(session))}`
  createCookieChunks(supabaseAuthStorageKey, encodedSession).forEach(({ name, value }) => {
    setCookie(name, value, COOKIE_MAX_AGE)
  })
}

async function ensureShopProfileAndRedirect(session: Session) {
  const userId = session.user.id
  const { data: profile, error: profileError } = await supabase
    .from('shop_profiles')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle()

  if (profileError) throw profileError

  if (!profile) {
    const email = session.user.email || ''
    const name = session.user.user_metadata?.full_name || email.split('@')[0] || 'My Shop'
    const { error: upsertError } = await supabase.from('shop_profiles').upsert(
      {
        user_id: userId,
        shop_name: `${name}'s Shop`,
        phone: '',
        address: '',
        city_state_zip: '',
        services: [],
      },
      { onConflict: 'user_id' }
    )
    if (upsertError) throw upsertError
    window.location.replace('/onboarding')
    return
  }

  window.location.replace('/dashboard')
}

export default function DesktopOAuthComplete() {
  const [status, setStatus] = useState('Finishing desktop sign-in...')
  const [error, setError] = useState('')

  useEffect(() => {
    const run = async () => {
      try {
        const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
        const accessToken = hash.get('access_token')
        const refreshToken = hash.get('refresh_token')
        window.history.replaceState(null, '', '/auth/desktop-complete')

        if (!accessToken || !refreshToken) {
          throw new Error('Missing desktop sign-in tokens. Try Google sign-in again.')
        }

        const { data, error: sessionError } = await supabase.auth.setSession({
          access_token: accessToken,
          refresh_token: refreshToken,
        })

        if (sessionError) throw sessionError
        if (!data.session) throw new Error('No desktop session was created.')

        persistSupabaseSessionCookie(data.session)
        setStatus('Opening your dashboard...')
        await new Promise(resolve => window.setTimeout(resolve, 100))
        await ensureShopProfileAndRedirect(data.session)
      } catch (err) {
        setStatus('Desktop sign-in failed.')
        setError(err instanceof Error ? err.message : 'Could not finish Google sign-in.')
      }
    }

    void run()
  }, [])

  return (
    <main className="desktop-auth-screen">
      <section>
        <div className="mark">A</div>
        <p>Alpha AI Desk</p>
        <h1>{status}</h1>
        {!error && <span>Keep this window open while the session is saved.</span>}
        {error && <div role="alert">{error}</div>}
      </section>

      <style jsx>{`
        .desktop-auth-screen {
          min-height: 100vh;
          display: grid;
          place-items: center;
          padding: 24px;
          background: linear-gradient(135deg, #08111f, #101827);
          color: #f8fafc;
          font-family: Inter, system-ui, sans-serif;
        }

        section {
          width: min(420px, 100%);
          text-align: center;
          border: 1px solid rgba(226, 232, 240, 0.16);
          border-radius: 18px;
          padding: 32px;
          background: rgba(15, 23, 42, 0.9);
          box-shadow: 0 28px 90px rgba(0, 0, 0, 0.4);
        }

        .mark {
          width: 54px;
          height: 54px;
          margin: 0 auto 18px;
          display: grid;
          place-items: center;
          border-radius: 14px;
          background: #f8fafc;
          color: #0f172a;
          font-weight: 900;
          font-size: 28px;
        }

        p {
          margin: 0 0 10px;
          color: #7dd3fc;
          font-size: 12px;
          font-weight: 850;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }

        h1 {
          margin: 0;
          font-size: 25px;
          line-height: 1.18;
          font-weight: 850;
        }

        span {
          display: block;
          margin-top: 12px;
          color: #94a3b8;
          font-size: 14px;
          line-height: 1.5;
        }

        div[role='alert'] {
          margin-top: 16px;
          border: 1px solid rgba(248, 113, 113, 0.36);
          border-radius: 12px;
          padding: 12px 14px;
          background: rgba(127, 29, 29, 0.24);
          color: #fecaca;
          font-size: 13px;
          line-height: 1.45;
        }
      `}</style>
    </main>
  )
}
