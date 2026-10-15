'use client'

import { useEffect, useMemo, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { ensureShopProfile, supabase } from '@/lib/supabase'
import { getCallbackSession } from '@/lib/auth-callback'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { Spinner, StatusScreen } from '@/components/PublicChrome'

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
  const email = session.user.email || ''
  const name = session.user.user_metadata?.full_name || email.split('@')[0] || 'My Shop'
  const profile = await ensureShopProfile(`${name}'s Shop`)
  window.location.replace(profile.created ? '/onboarding' : '/dashboard')
}

export default function AuthCallback() {
  const [status, setStatus] = useState('Signing you in…')
  const [recovery, setRecovery] = useState(false)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [updating, setUpdating] = useState(false)

  const passwordsMatch = useMemo(() => password === confirmPassword, [password, confirmPassword])

  useEffect(() => {
    let cancelled = false
    let handled = false
    const recoveryFlow = isRecoveryUrl()

    const finish = async (session: Session) => {
      if (cancelled || handled) return
      handled = true

      if (recoveryFlow) {
        setRecovery(true)
        setStatus('Choose a new password')
        return
      }

      const desktopHandoff = getDesktopHandoff()
      if (desktopHandoff) {
        setStatus('Returning sign-in to the desktop app…')
        submitDesktopSession(desktopHandoff, session)
        return
      }

      setStatus('Opening Today…')
      await ensureShopProfileAndRedirect(session)
    }

    const processAuth = async () => {
      try {
        await finish(await getCallbackSession(supabase.auth))
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Authentication failed.')
        setStatus('Sign-in could not finish')
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

      setStatus('Password updated. Opening Today…')
      const { data } = await supabase.auth.getSession()
      if (!data.session) throw new Error('Your reset session expired. Request a new reset link.')
      await ensureShopProfileAndRedirect(data.session)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update the password.')
      setUpdating(false)
    }
  }

  return (
    <StatusScreen>
      <div aria-live="polite">
        <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-full border border-border bg-bg-base text-text-secondary">
          {recovery || error ? <Icon name="lock" className="h-6 w-6" /> : <Spinner className="h-6 w-6" />}
        </div>

        <h1 className="display text-[1.5rem] font-bold leading-tight">{status}</h1>

        {!recovery && !error && (
          <p className="mt-2 text-[0.9375rem] text-text-secondary">Keep this window open while the secure session finishes.</p>
        )}
      </div>

      {recovery && (
        <form className="mt-6 space-y-4 text-left" onSubmit={updatePassword} noValidate>
          <div>
            <label htmlFor="new-password" className="form-label">New password</label>
            <input
              id="new-password"
              type="password"
              className="form-input"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              aria-describedby="new-password-hint"
            />
            <p id="new-password-hint" className="form-hint">At least 8 characters.</p>
          </div>
          <div>
            <label htmlFor="confirm-password" className="form-label">Confirm new password</label>
            <input
              id="confirm-password"
              type="password"
              className={`form-input ${confirmPassword && !passwordsMatch ? 'border-red' : ''}`}
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              autoComplete="new-password"
              minLength={8}
              aria-invalid={confirmPassword && !passwordsMatch ? true : undefined}
              aria-describedby={confirmPassword && !passwordsMatch ? 'confirm-password-error' : undefined}
            />
            {confirmPassword && !passwordsMatch && <p id="confirm-password-error" className="form-error">The passwords do not match.</p>}
          </div>
          <button type="submit" className="btn btn-primary btn-lg w-full" disabled={updating} aria-busy={updating}>
            {updating && <span aria-hidden="true" className="spinner inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent" />}
            {updating ? 'Updating…' : 'Update password'}
          </button>
        </form>
      )}

      {error && (
        <Notice kind="error" className="mt-5 text-left">
          <p>{error}</p>
          {!recovery && <p className="mt-2"><a href="/login" className="font-bold text-blue underline underline-offset-4">Return to sign in</a></p>}
        </Notice>
      )}
    </StatusScreen>
  )
}
