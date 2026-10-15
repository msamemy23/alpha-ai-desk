'use client'

import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ensureShopProfile, supabase, supabaseAuthStorageKey } from '@/lib/supabase'
import Notice from '@/components/Notice'
import { Spinner, StatusScreen } from '@/components/PublicChrome'

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
  const email = session.user.email || ''
  const name = session.user.user_metadata?.full_name || email.split('@')[0] || 'My Shop'
  const profile = await ensureShopProfile(`${name}'s Shop`)
  window.location.replace(profile.created ? '/onboarding' : '/dashboard')
}

export default function DesktopOAuthComplete() {
  const [status, setStatus] = useState('Finishing desktop sign-in…')
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
        setStatus('Opening Today…')
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
    <StatusScreen>
      <div aria-live="polite">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full border border-border bg-bg-base">
          {error ? <span className="lamp lamp-red" aria-hidden="true" /> : <Spinner className="h-6 w-6" />}
        </div>
        <h1 className="display text-[1.5rem] font-bold leading-tight">{status}</h1>
        {!error && <p className="mt-2 text-[0.9375rem] text-text-secondary">Keep this window open while the session is saved.</p>}
      </div>
      {error && (
        <Notice kind="error" className="mt-5 text-left">
          <p>{error}</p>
          <p className="mt-2"><a href="/login" className="font-bold text-blue underline underline-offset-4">Return to sign in</a></p>
        </Notice>
      )}
    </StatusScreen>
  )
}
