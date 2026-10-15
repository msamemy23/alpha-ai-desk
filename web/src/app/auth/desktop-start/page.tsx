'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { supabaseBrowserAnonKey, supabaseBrowserUrl } from '@/lib/supabase'
import Notice from '@/components/Notice'
import { Spinner, StatusScreen } from '@/components/PublicChrome'

// Keep route-module evaluation safe when a local build intentionally omits
// deployment secrets. OAuth still fails closed at runtime until real values
// are supplied through the deployment environment.
const desktopOAuthClient = createClient(
  supabaseBrowserUrl || 'https://placeholder.invalid',
  supabaseBrowserAnonKey || 'placeholder-anon-key',
  {
  auth: {
    autoRefreshToken: false,
    detectSessionInUrl: false,
    flowType: 'implicit',
    persistSession: false,
  },
  }
)

function validPort(value: string | null) {
  if (!value || !/^\d{2,5}$/.test(value)) return null
  const port = Number(value)
  return port >= 1024 && port <= 65535 ? String(port) : null
}

function validState(value: string | null) {
  return value && /^[a-f0-9]{48}$/i.test(value) ? value : null
}

export default function DesktopOAuthStart() {
  const [status, setStatus] = useState('Opening Google sign-in…')
  const [error, setError] = useState('')

  useEffect(() => {
    const run = async () => {
      const params = new URLSearchParams(window.location.search)
      const port = validPort(params.get('port'))
      const state = validState(params.get('state'))

      if (!port || !state) {
        setStatus('Desktop sign-in link is invalid.')
        setError('Close this tab and try Google sign-in from Alpha Desk again.')
        return
      }

      const redirectTo = `${window.location.origin}/auth/callback?desktop_port=${encodeURIComponent(port)}&desktop_state=${encodeURIComponent(state)}`
      const { error: oauthError } = await desktopOAuthClient.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          queryParams: {
            prompt: 'select_account',
          },
        },
      })

      if (oauthError) {
        setStatus('Google sign-in failed.')
        setError(oauthError.message)
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
        {!error && <p className="mt-2 text-[0.9375rem] text-text-secondary">Finish in this browser. The desktop app will update automatically.</p>}
      </div>
      {error && <Notice kind="error" className="mt-5 text-left">{error}</Notice>}
    </StatusScreen>
  )
}
