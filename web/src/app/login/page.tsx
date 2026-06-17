'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

type AuthMode = 'login' | 'signup' | 'reset'
type LoadingAction = 'email' | 'google' | null

type DesktopOAuthResult = { ok?: boolean; error?: string }
type DesktopElectronAPI = {
  isElectron?: boolean
  auth?: {
    openOAuth?: (url: string) => Promise<DesktopOAuthResult>
  }
}

declare global {
  interface Window {
    electronAPI?: DesktopElectronAPI
  }
}

const LAST_EMAIL_KEY = 'alpha-ai-desk:last-email'

function GoogleIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function EyeIcon({ hidden }: { hidden: boolean }) {
  return hidden ? (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.5 5.4A10.7 10.7 0 0 1 12 5c5 0 8.5 4 10 7a16.7 16.7 0 0 1-3 4.2M6.2 6.2A15.3 15.3 0 0 0 2 12c1.5 3 5 7 10 7 1.4 0 2.8-.3 4-.9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [shopName, setShopName] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState<LoadingAction>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [mode, setMode] = useState<AuthMode>('login')
  const [isDesktop, setIsDesktop] = useState(false)

  const cleanEmail = useMemo(() => email.trim().toLowerCase(), [email])

  useEffect(() => {
    setIsDesktop(Boolean(window.electronAPI?.isElectron))
    const rememberedEmail = window.localStorage.getItem(LAST_EMAIL_KEY)
    if (rememberedEmail) setEmail(rememberedEmail)
  }, [])

  const resetFeedback = () => {
    setError('')
    setMessage('')
  }

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode)
    resetFeedback()
  }

  const handleEmailAuth = async (event: React.FormEvent) => {
    event.preventDefault()
    resetFeedback()

    if (!cleanEmail) {
      setError('Enter the email address for your Alpha AI Desk account.')
      return
    }

    if (mode !== 'reset' && !password) {
      setError('Enter your password.')
      return
    }

    if (mode === 'signup' && password.length < 8) {
      setError('Use at least 8 characters for the password.')
      return
    }

    setLoading('email')
    try {
      if (mode === 'login') {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password,
        })

        if (signInError) {
          if (
            signInError.message.includes('Invalid login credentials') ||
            signInError.message.includes('invalid_credentials')
          ) {
            throw new Error('Incorrect email or password. Use Google if this account was created with Google, or reset the password below.')
          }
          if (signInError.message.includes('Email not confirmed')) {
            throw new Error('Confirm your email first, then sign in again.')
          }
          throw signInError
        }

        window.localStorage.setItem(LAST_EMAIL_KEY, cleanEmail)
        window.location.assign('/dashboard')
        return
      }

      if (mode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: cleanEmail,
          password,
        })

        if (signUpError) throw signUpError

        if (!data.session) {
          setMessage('Account created. Check your email for the confirmation link, then sign in.')
          setMode('login')
          setPassword('')
          return
        }

        if (data.user) {
          const { error: profileError } = await supabase.from('shop_profiles').upsert(
            {
              user_id: data.user.id,
              shop_name: shopName.trim() || 'My Shop',
              phone: '',
              address: '',
              city_state_zip: '',
              services: [],
            },
            { onConflict: 'user_id' }
          )
          if (profileError) throw profileError
        }

        window.localStorage.setItem(LAST_EMAIL_KEY, cleanEmail)
        window.location.assign('/onboarding')
        return
      }

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
      })

      if (resetError) throw resetError
      setMessage('If that email is registered, a secure reset link is on the way.')
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed. Try again.')
    } finally {
      setLoading(null)
    }
  }

  const handleGoogle = async () => {
    resetFeedback()
    setLoading('google')

    try {
      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          skipBrowserRedirect: true,
          queryParams: {
            prompt: 'select_account',
          },
        },
      })

      if (oauthError) throw oauthError
      if (!data?.url) throw new Error('Google did not return a sign-in URL.')

      if (window.electronAPI?.isElectron && window.electronAPI.auth?.openOAuth) {
        const result = await window.electronAPI.auth.openOAuth(data.url)
        if (result?.ok === false) throw new Error(result.error || 'Desktop Google sign-in could not open.')
        setMessage('Finish Google sign-in in your browser. Alpha AI Desk will update automatically.')
        setLoading(null)
        return
      }

      window.location.assign(data.url)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed. Try again.')
      setLoading(null)
    }
  }

  const title =
    mode === 'login' ? 'Welcome back' : mode === 'signup' ? 'Create your workspace' : 'Reset your password'
  const subtitle =
    mode === 'login'
      ? 'Sign in to Alpha AI Desk.'
      : mode === 'signup'
        ? 'Set up the account that owns this shop.'
        : 'Enter your email and use the secure link to choose a new password.'

  return (
    <main className="auth-screen">
      <section className="auth-stage" aria-label="Alpha AI Desk sign in">
        <div className="brand-panel" aria-hidden="true">
          <div className="brand-mark">A</div>
          <div>
            <p className="eyebrow">Alpha AI Desk</p>
            <h1>Built for the front counter.</h1>
          </div>

          <div className="desk-preview">
            <div className="preview-toolbar">
              <span />
              <span />
              <span />
            </div>
            <div className="preview-grid">
              <div className="preview-lane wide">
                <div className="preview-line strong" />
                <div className="preview-line" />
                <div className="preview-line short" />
              </div>
              <div className="preview-lane">
                <div className="preview-pill green" />
                <div className="preview-line" />
                <div className="preview-line short" />
              </div>
              <div className="preview-lane">
                <div className="preview-pill amber" />
                <div className="preview-line" />
                <div className="preview-line short" />
              </div>
              <div className="preview-lane wide accent">
                <div className="preview-pulse" />
                <div>
                  <div className="preview-line strong" />
                  <div className="preview-line short" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <form className="auth-panel" onSubmit={handleEmailAuth}>
          <div className="panel-header">
            <div>
              <p className="panel-kicker">{isDesktop ? 'Desktop app' : 'Secure sign in'}</p>
              <h2>{title}</h2>
              <p>{subtitle}</p>
            </div>
          </div>

          {mode !== 'reset' && (
            <>
              <button
                type="button"
                className="google-button"
                onClick={handleGoogle}
                disabled={Boolean(loading)}
              >
                <GoogleIcon />
                <span>{loading === 'google' ? 'Opening Google...' : 'Continue with Google'}</span>
              </button>

              <div className="divider" role="presentation">
                <span />
                <b>or</b>
                <span />
              </div>
            </>
          )}

          {mode === 'signup' && (
            <label className="field">
              <span>Shop name</span>
              <input
                type="text"
                value={shopName}
                onChange={(event) => setShopName(event.target.value)}
                placeholder="Your Auto Shop"
                autoComplete="organization"
                required
              />
            </label>
          )}

          <label className="field">
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </label>

          {mode !== 'reset' && (
            <label className="field">
              <span>Password</span>
              <div className="password-wrap">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Password"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  required
                />
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <EyeIcon hidden={showPassword} />
                </button>
              </div>
            </label>
          )}

          {error && (
            <div className="auth-alert error" role="alert">
              {error}
            </div>
          )}

          {message && (
            <div className="auth-alert success" role="status">
              {message}
            </div>
          )}

          <button type="submit" className="primary-button" disabled={Boolean(loading)}>
            <span>
              {loading === 'email'
                ? 'Working...'
                : mode === 'login'
                  ? 'Sign in'
                  : mode === 'signup'
                    ? 'Create account'
                    : 'Send reset link'}
            </span>
            <ArrowIcon />
          </button>

          <div className="mode-row">
            {mode === 'login' ? (
              <>
                <button type="button" onClick={() => switchMode('reset')}>
                  Forgot password?
                </button>
                <button type="button" onClick={() => switchMode('signup')}>
                  Create account
                </button>
              </>
            ) : (
              <button type="button" onClick={() => switchMode('login')}>
                Back to sign in
              </button>
            )}
          </div>
        </form>
      </section>

      <style jsx>{`
        .auth-screen {
          min-height: 100vh;
          padding: 32px;
          display: grid;
          place-items: center;
          background:
            linear-gradient(120deg, rgba(74, 158, 255, 0.12), transparent 34%),
            linear-gradient(240deg, rgba(63, 185, 80, 0.12), transparent 34%),
            linear-gradient(180deg, #08111f 0%, #0b0f17 46%, #10141c 100%);
          color: #f8fafc;
          font-family: Inter, system-ui, sans-serif;
        }

        .auth-screen::before {
          content: '';
          position: fixed;
          inset: 0;
          pointer-events: none;
          background-image:
            linear-gradient(rgba(255, 255, 255, 0.045) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255, 255, 255, 0.045) 1px, transparent 1px);
          background-size: 56px 56px;
          mask-image: linear-gradient(to bottom, rgba(0, 0, 0, 0.9), transparent 82%);
        }

        .auth-stage {
          width: min(1080px, 100%);
          min-height: 680px;
          display: grid;
          grid-template-columns: minmax(0, 1.1fr) 440px;
          gap: 24px;
          position: relative;
        }

        .brand-panel {
          min-height: 100%;
          border: 1px solid rgba(148, 163, 184, 0.18);
          border-radius: 18px;
          padding: 34px;
          display: flex;
          flex-direction: column;
          justify-content: space-between;
          overflow: hidden;
          background:
            linear-gradient(145deg, rgba(15, 23, 42, 0.92), rgba(15, 23, 42, 0.58)),
            repeating-linear-gradient(135deg, rgba(255, 255, 255, 0.06) 0 1px, transparent 1px 16px);
          box-shadow: 0 28px 90px rgba(0, 0, 0, 0.36);
        }

        .brand-mark {
          width: 54px;
          height: 54px;
          display: grid;
          place-items: center;
          border-radius: 14px;
          background: #f8fafc;
          color: #0f172a;
          font-weight: 900;
          font-size: 28px;
          box-shadow: 0 16px 40px rgba(248, 250, 252, 0.14);
        }

        .eyebrow,
        .panel-kicker {
          margin: 0 0 12px;
          color: #7dd3fc;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }

        .brand-panel h1 {
          max-width: 560px;
          margin: 0;
          font-size: clamp(42px, 7vw, 72px);
          line-height: 0.95;
          font-weight: 900;
          letter-spacing: 0;
        }

        .desk-preview {
          border: 1px solid rgba(148, 163, 184, 0.18);
          border-radius: 16px;
          overflow: hidden;
          background: rgba(2, 6, 23, 0.62);
          box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
        }

        .preview-toolbar {
          height: 42px;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 16px;
          border-bottom: 1px solid rgba(148, 163, 184, 0.14);
        }

        .preview-toolbar span {
          width: 9px;
          height: 9px;
          border-radius: 50%;
          background: #64748b;
        }

        .preview-grid {
          padding: 18px;
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
        }

        .preview-lane {
          min-height: 118px;
          border: 1px solid rgba(148, 163, 184, 0.15);
          border-radius: 12px;
          padding: 16px;
          background: rgba(15, 23, 42, 0.7);
        }

        .preview-lane.wide {
          grid-column: span 2;
        }

        .preview-lane.accent {
          display: flex;
          align-items: center;
          gap: 14px;
          background: linear-gradient(90deg, rgba(74, 158, 255, 0.16), rgba(63, 185, 80, 0.12));
        }

        .preview-line {
          height: 9px;
          margin-top: 13px;
          border-radius: 999px;
          background: rgba(148, 163, 184, 0.22);
        }

        .preview-line.strong {
          height: 12px;
          margin-top: 0;
          background: rgba(226, 232, 240, 0.52);
        }

        .preview-line.short {
          width: 58%;
        }

        .preview-pill {
          width: 48px;
          height: 20px;
          border-radius: 999px;
          margin-bottom: 20px;
        }

        .preview-pill.green {
          background: rgba(34, 197, 94, 0.7);
        }

        .preview-pill.amber {
          background: rgba(245, 158, 11, 0.78);
        }

        .preview-pulse {
          width: 42px;
          height: 42px;
          flex: 0 0 auto;
          border-radius: 12px;
          background: #7dd3fc;
          box-shadow: 0 0 0 8px rgba(125, 211, 252, 0.12);
        }

        .auth-panel {
          align-self: center;
          border: 1px solid rgba(226, 232, 240, 0.16);
          border-radius: 18px;
          padding: 30px;
          background: rgba(15, 23, 42, 0.92);
          box-shadow: 0 28px 90px rgba(0, 0, 0, 0.42);
          backdrop-filter: blur(24px);
        }

        .panel-header {
          margin-bottom: 24px;
        }

        .panel-header h2 {
          margin: 0;
          font-size: 30px;
          line-height: 1.05;
          font-weight: 850;
          letter-spacing: 0;
        }

        .panel-header p:not(.panel-kicker) {
          margin: 10px 0 0;
          color: #94a3b8;
          font-size: 14px;
          line-height: 1.55;
        }

        .google-button,
        .primary-button,
        .mode-row button,
        .icon-button {
          font: inherit;
        }

        .google-button,
        .primary-button {
          width: 100%;
          min-height: 48px;
          border-radius: 12px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
          cursor: pointer;
          transition: transform 140ms ease, border-color 140ms ease, background 140ms ease, box-shadow 140ms ease;
        }

        .google-button {
          border: 1px solid rgba(226, 232, 240, 0.14);
          background: rgba(255, 255, 255, 0.06);
          color: #f8fafc;
          font-weight: 750;
        }

        .google-button:hover:not(:disabled) {
          transform: translateY(-1px);
          border-color: rgba(125, 211, 252, 0.44);
          background: rgba(255, 255, 255, 0.09);
        }

        .divider {
          display: grid;
          grid-template-columns: 1fr auto 1fr;
          align-items: center;
          gap: 12px;
          margin: 18px 0;
          color: #64748b;
          font-size: 12px;
          font-weight: 800;
          text-transform: uppercase;
          letter-spacing: 0.12em;
        }

        .divider span {
          height: 1px;
          background: rgba(148, 163, 184, 0.18);
        }

        .field {
          display: grid;
          gap: 8px;
          margin-bottom: 16px;
        }

        .field span {
          color: #cbd5e1;
          font-size: 13px;
          font-weight: 760;
        }

        .field input {
          width: 100%;
          min-height: 48px;
          border: 1px solid rgba(148, 163, 184, 0.2);
          border-radius: 12px;
          padding: 0 14px;
          outline: none;
          background: rgba(2, 6, 23, 0.42);
          color: #f8fafc;
          font-size: 15px;
          transition: border-color 140ms ease, box-shadow 140ms ease, background 140ms ease;
        }

        .field input::placeholder {
          color: #64748b;
        }

        .field input:focus {
          border-color: rgba(125, 211, 252, 0.72);
          background: rgba(2, 6, 23, 0.62);
          box-shadow: 0 0 0 4px rgba(125, 211, 252, 0.1);
        }

        .password-wrap {
          position: relative;
        }

        .password-wrap input {
          padding-right: 52px;
        }

        .icon-button {
          position: absolute;
          right: 6px;
          top: 50%;
          transform: translateY(-50%);
          width: 38px;
          height: 38px;
          border: 0;
          border-radius: 10px;
          display: grid;
          place-items: center;
          background: transparent;
          color: #94a3b8;
          cursor: pointer;
        }

        .icon-button:hover {
          background: rgba(148, 163, 184, 0.12);
          color: #f8fafc;
        }

        .auth-alert {
          margin-bottom: 16px;
          border-radius: 12px;
          padding: 12px 14px;
          font-size: 13px;
          line-height: 1.45;
        }

        .auth-alert.error {
          border: 1px solid rgba(248, 113, 113, 0.36);
          background: rgba(127, 29, 29, 0.24);
          color: #fecaca;
        }

        .auth-alert.success {
          border: 1px solid rgba(74, 222, 128, 0.32);
          background: rgba(20, 83, 45, 0.24);
          color: #bbf7d0;
        }

        .primary-button {
          border: 0;
          background: linear-gradient(135deg, #7dd3fc, #22c55e);
          color: #06121f;
          font-weight: 850;
          box-shadow: 0 16px 38px rgba(34, 197, 94, 0.18);
        }

        .primary-button:hover:not(:disabled) {
          transform: translateY(-1px);
          box-shadow: 0 20px 46px rgba(125, 211, 252, 0.16), 0 18px 40px rgba(34, 197, 94, 0.16);
        }

        button:disabled {
          cursor: not-allowed;
          opacity: 0.68;
        }

        .mode-row {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          margin-top: 18px;
          flex-wrap: wrap;
        }

        .mode-row button {
          border: 0;
          background: transparent;
          color: #7dd3fc;
          font-size: 13px;
          font-weight: 800;
          cursor: pointer;
        }

        .mode-row button:hover {
          color: #bae6fd;
        }

        @media (max-width: 920px) {
          .auth-screen {
            padding: 18px;
          }

          .auth-stage {
            min-height: auto;
            grid-template-columns: 1fr;
          }

          .brand-panel {
            min-height: 280px;
          }

          .brand-panel h1 {
            font-size: 42px;
          }

          .desk-preview {
            display: none;
          }
        }

        @media (max-width: 520px) {
          .auth-screen {
            padding: 0;
            align-items: stretch;
          }

          .auth-stage {
            width: 100%;
            gap: 0;
          }

          .brand-panel {
            border-radius: 0;
            border-left: 0;
            border-right: 0;
            min-height: 220px;
            padding: 24px;
          }

          .auth-panel {
            align-self: stretch;
            border-radius: 0;
            border-left: 0;
            border-right: 0;
            padding: 24px;
          }

          .panel-header h2 {
            font-size: 26px;
          }
        }
      `}</style>
    </main>
  )
}
