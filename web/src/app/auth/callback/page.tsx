'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

function isRecoveryUrl() {
  const params = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  return params.get('type') === 'recovery' || hash.get('type') === 'recovery'
}

function getDesktopHandoff() {
  const params = new URLSearchParams(window.location.search)
  const port = params.get('desktop_port')
  const state = params.get('desktop_state')
  if (!port || !/^\d{2,5}$/.test(port)) return null
  const portNumber = Number(port)
  if (portNumber < 1024 || portNumber > 65535) return null
  if (!state || !/^[a-f0-9]{48}$/i.test(state)) return null
  return { port: String(portNumber), state }
}

function submitDesktopSession({ port, state }: { port: string; state: string }, session: Session) {
  const form = document.createElement('form')
  form.method = 'POST'
  form.action = `http://127.0.0.1:${port}/auth/callback`

  const fields: Record<string, string> = {
    state,
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    session_json: JSON.stringify(session),
  }

  Object.entries(fields).forEach(([name, value]) => {
    const input = document.createElement('input')
    input.type = 'hidden'
    input.name = name
    input.value = value
    form.appendChild(input)
  })

  document.body.appendChild(form)
  form.submit()
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

function LockIcon() {
  return (
    <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none">
      <path d="M7 11V8a5 5 0 0 1 10 0v3M6 11h12v9H6v-9Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function AuthCallback() {
  const [status, setStatus] = useState('Signing you in...')
  const [recovery, setRecovery] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [updating, setUpdating] = useState(false)

  const passwordsMatch = useMemo(() => password === confirmPassword, [password, confirmPassword])

  useEffect(() => {
    let cancelled = false
    let handled = false

    const finish = async (session: Session) => {
      if (cancelled || handled) return
      handled = true

      if (isRecoveryUrl()) {
        setRecovery(true)
        setStatus('Choose a new password')
        return
      }

      const desktopHandoff = getDesktopHandoff()
      if (desktopHandoff) {
        setStatus('Returning sign-in to the desktop app...')
        submitDesktopSession(desktopHandoff, session)
        return
      }

      setStatus('Opening your dashboard...')
      await ensureShopProfileAndRedirect(session)
    }

    const processAuth = async () => {
      try {
        const params = new URLSearchParams(window.location.search)
        const code = params.get('code')

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchangeError) throw exchangeError
        }

        const { data } = await supabase.auth.getSession()
        if (data.session) {
          await finish(data.session)
          return
        }

        const {
          data: { subscription },
        } = supabase.auth.onAuthStateChange(async (_event, session) => {
          if (session) {
            subscription.unsubscribe()
            await finish(session)
          }
        })

        window.setTimeout(() => {
          if (cancelled || handled) return
          subscription.unsubscribe()
          setStatus('No session found. Redirecting...')
          window.setTimeout(() => window.location.replace('/login'), 1400)
        }, 1800)
      } catch (err) {
        console.error('Auth callback error:', err)
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Authentication failed.')
        setStatus('Authentication failed. Redirecting...')
        window.setTimeout(() => window.location.replace('/login'), 2200)
      }
    }

    void processAuth()

    return () => {
      cancelled = true
    }
  }, [])

  const updatePassword = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')

    if (password.length < 8) {
      setError('Use at least 8 characters for the new password.')
      return
    }

    if (!passwordsMatch) {
      setError('The passwords do not match.')
      return
    }

    setUpdating(true)
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError

      setStatus('Password updated. Opening your dashboard...')
      const { data } = await supabase.auth.getSession()
      if (!data.session) throw new Error('Your reset session expired. Request a new reset link.')
      await ensureShopProfileAndRedirect(data.session)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the password.')
      setUpdating(false)
    }
  }

  return (
    <main className="callback-screen">
      <section className="callback-panel" aria-live="polite">
        <div className="callback-icon">
          {recovery ? <LockIcon /> : <span className="spinner" />}
        </div>

        <p className="kicker">Alpha AI Desk</p>
        <h1>{status}</h1>

        {!recovery && <p className="helper">Keep this window open while the secure session finishes.</p>}

        {recovery && (
          <form className="password-form" onSubmit={updatePassword}>
            <label>
              <span>New password</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
            <label>
              <span>Confirm password</span>
              <input
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
            <button type="submit" disabled={updating}>
              {updating ? 'Updating...' : 'Update password'}
            </button>
          </form>
        )}

        {error && (
          <div className="callback-error" role="alert">
            {error}
          </div>
        )}
      </section>

      <style jsx>{`
        .callback-screen {
          min-height: 100vh;
          padding: 24px;
          display: grid;
          place-items: center;
          background:
            linear-gradient(120deg, rgba(74, 158, 255, 0.12), transparent 34%),
            linear-gradient(240deg, rgba(34, 197, 94, 0.12), transparent 34%),
            #080f1c;
          color: #f8fafc;
          font-family: Inter, system-ui, sans-serif;
        }

        .callback-panel {
          width: min(420px, 100%);
          border: 1px solid rgba(226, 232, 240, 0.16);
          border-radius: 18px;
          padding: 30px;
          background: rgba(15, 23, 42, 0.92);
          box-shadow: 0 28px 90px rgba(0, 0, 0, 0.42);
          text-align: center;
        }

        .callback-icon {
          width: 58px;
          height: 58px;
          margin: 0 auto 18px;
          border-radius: 16px;
          display: grid;
          place-items: center;
          color: #7dd3fc;
          background: rgba(125, 211, 252, 0.12);
          border: 1px solid rgba(125, 211, 252, 0.22);
        }

        .spinner {
          width: 26px;
          height: 26px;
          border: 3px solid rgba(125, 211, 252, 0.24);
          border-top-color: #7dd3fc;
          border-radius: 50%;
          animation: spin 800ms linear infinite;
        }

        .kicker {
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
          letter-spacing: 0;
        }

        .helper {
          margin: 12px 0 0;
          color: #94a3b8;
          font-size: 14px;
          line-height: 1.5;
        }

        .password-form {
          display: grid;
          gap: 14px;
          margin-top: 22px;
          text-align: left;
        }

        label {
          display: grid;
          gap: 8px;
        }

        label span {
          color: #cbd5e1;
          font-size: 13px;
          font-weight: 760;
        }

        input {
          width: 100%;
          min-height: 48px;
          border: 1px solid rgba(148, 163, 184, 0.2);
          border-radius: 12px;
          padding: 0 14px;
          outline: none;
          background: rgba(2, 6, 23, 0.42);
          color: #f8fafc;
          font-size: 15px;
        }

        input:focus {
          border-color: rgba(125, 211, 252, 0.72);
          box-shadow: 0 0 0 4px rgba(125, 211, 252, 0.1);
        }

        button {
          min-height: 48px;
          border: 0;
          border-radius: 12px;
          background: linear-gradient(135deg, #7dd3fc, #22c55e);
          color: #06121f;
          font-weight: 850;
          cursor: pointer;
        }

        button:disabled {
          cursor: not-allowed;
          opacity: 0.68;
        }

        .callback-error {
          margin-top: 16px;
          border: 1px solid rgba(248, 113, 113, 0.36);
          border-radius: 12px;
          padding: 12px 14px;
          background: rgba(127, 29, 29, 0.24);
          color: #fecaca;
          font-size: 13px;
          line-height: 1.45;
          text-align: left;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </main>
  )
}
