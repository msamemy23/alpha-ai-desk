'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { ensureShopProfile, supabase } from '@/lib/supabase'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { BrandMark, PublicFooter } from '@/components/PublicChrome'

type AuthMode = 'login' | 'signup' | 'reset'
type LoadingAction = 'email' | 'google' | null
type FieldErrors = { shopName?: string; email?: string; password?: string }

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
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Only things the product does today.
const BENEFITS = [
  { icon: 'customers', title: 'Customers and vehicles', body: 'Every visit, estimate and message for a customer, in one place.' },
  { icon: 'invoice', title: 'Estimates and invoices', body: 'Write them quickly, send them for a signature, record payments.' },
  { icon: 'inbox', title: 'Texts and calls', body: 'Answer customers from one inbox and see the calls you missed.' },
  { icon: 'alpha', title: 'An assistant that does the paperwork', body: 'Ask Alpha who owes you money, or have it draft an estimate or a text.' },
]

function GoogleIcon() {
  // The Google "G" keeps its brand colours.
  return (
    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24">
      <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
      <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
      <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
    </svg>
  )
}

function ButtonSpinner() {
  return <span aria-hidden="true" className="spinner inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent" />
}

function BenefitList() {
  return (
    <ul className="space-y-4">
      {BENEFITS.map(item => (
        <li key={item.title} className="flex gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-border bg-bg-card text-text-secondary">
            <Icon name={item.icon} className="h-5 w-5" />
          </span>
          <span className="min-w-0">
            <span className="block font-bold leading-snug">{item.title}</span>
            <span className="block text-[0.9375rem] leading-snug text-text-secondary">{item.body}</span>
          </span>
        </li>
      ))}
    </ul>
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
  const [messageKind, setMessageKind] = useState<'success' | 'info'>('success')
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [mode, setMode] = useState<AuthMode>('login')
  const [isDesktop, setIsDesktop] = useState(false)

  const shopRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  const cleanEmail = useMemo(() => email.trim().toLowerCase(), [email])

  useEffect(() => {
    setIsDesktop(Boolean(window.electronAPI?.isElectron))
    const rememberedEmail = window.localStorage.getItem(LAST_EMAIL_KEY)
    if (rememberedEmail) setEmail(rememberedEmail)
  }, [])

  const resetFeedback = () => {
    setError('')
    setMessage('')
    setFieldErrors({})
  }

  const notify = (text: string, kind: 'success' | 'info' = 'success') => {
    setMessage(text)
    setMessageKind(kind)
  }

  const switchMode = (nextMode: AuthMode) => {
    setMode(nextMode)
    setShowPassword(false)
    resetFeedback()
  }

  const handleEmailAuth = async (event: React.FormEvent) => {
    event.preventDefault()
    resetFeedback()

    // Say exactly what to fix, next to the field, before anything is sent.
    const problems: FieldErrors = {}
    if (mode === 'signup' && !shopName.trim()) problems.shopName = 'Enter your shop name.'
    if (!cleanEmail) problems.email = 'Enter the email address for your Alpha Desk account.'
    else if (!EMAIL_PATTERN.test(cleanEmail)) problems.email = 'Enter a full email address, like you@example.com.'
    if (mode !== 'reset') {
      if (!password) problems.password = mode === 'signup' ? 'Choose a password.' : 'Enter your password.'
      else if (mode === 'signup' && password.length < 8) problems.password = 'Use at least 8 characters for the password.'
    }
    if (problems.shopName || problems.email || problems.password) {
      setFieldErrors(problems)
      const first = problems.shopName ? shopRef : problems.email ? emailRef : passwordRef
      first.current?.focus()
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
            throw new Error('Incorrect email or password. Use Google if this account was created with Google, or reset your password.')
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
          notify('Account created. Check your email for the confirmation link, then sign in.')
          setMode('login')
          setPassword('')
          return
        }

        if (data.user) {
          await ensureShopProfile(shopName.trim() || 'My Shop')
        }

        window.localStorage.setItem(LAST_EMAIL_KEY, cleanEmail)
        window.location.assign('/onboarding')
        return
      }

      const { error: resetError } = await supabase.auth.resetPasswordForEmail(cleanEmail, {
        redirectTo: `${window.location.origin}/auth/callback?type=recovery`,
      })

      if (resetError) throw resetError
      notify('If that email is registered, a secure reset link is on the way.')
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
        notify('Finish Google sign-in in your browser. Alpha Desk will update automatically.', 'info')
        setLoading(null)
        return
      }

      window.location.assign(data.url)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Google sign-in failed. Try again.')
      setLoading(null)
    }
  }

  const title = mode === 'login' ? 'Welcome back' : mode === 'signup' ? 'Create your account' : 'Reset your password'
  const subtitle =
    mode === 'login'
      ? 'Sign in with the account for your shop.'
      : mode === 'signup'
        ? 'This account will own your shop. You can invite your team later.'
        : 'Enter your email. We will send a link to choose a new password.'

  const submitLabel =
    loading === 'email'
      ? mode === 'login' ? 'Signing in…' : mode === 'signup' ? 'Creating account…' : 'Sending link…'
      : mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Send reset link'

  const busy = Boolean(loading)

  return (
    <div className="min-h-dvh bg-bg-base text-text-primary lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Concrete strip on a phone, concrete side panel on a desktop. */}
      <aside aria-label="About Alpha Desk" className="border-b border-border bg-bg-chrome lg:border-b-0 lg:border-r">
        <div className="mx-auto flex w-full max-w-[34rem] flex-col px-4 pb-4 pt-2 sm:px-6 lg:min-h-dvh lg:max-w-[32rem] lg:justify-between lg:px-10 lg:pb-10 lg:pt-8">
          <div className="flex min-h-[48px] items-center">
            <BrandMark large />
          </div>
          <p className="text-[0.9375rem] text-text-secondary lg:hidden">The office manager for your auto shop.</p>

          <div className="hidden lg:block">
            <p className="display text-[2.5rem] font-bold leading-[1.08]">The office manager for your auto shop.</p>
            <div className="mt-8">
              <BenefitList />
            </div>
            <div className="mt-8 flex items-start gap-3 border-t border-border pt-5 text-[0.9375rem] text-text-secondary">
              <span className="mt-1.5 flex shrink-0 gap-1.5" aria-hidden="true">
                <span className="lamp lamp-green" />
                <span className="lamp lamp-amber" />
                <span className="lamp lamp-red" />
              </span>
              <p>Lamps show what needs you: green is done, amber needs a look, red needs you now.</p>
            </div>
          </div>
          <div className="hidden lg:block" aria-hidden="true" />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <main className="flex flex-1 items-start justify-center px-4 py-6 sm:px-6 sm:py-10 lg:items-center lg:py-12">
          <div className="w-full max-w-[26rem]">
            <form onSubmit={handleEmailAuth} noValidate aria-labelledby="auth-title" className="panel p-5 sm:p-7">
              {mode !== 'reset' && (
                <div role="group" aria-label="Sign in or create an account" className="mb-6 grid grid-cols-2 gap-1 rounded-md bg-text-primary/[0.06] p-1">
                  {([['login', 'Sign in'], ['signup', 'Create account']] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={mode === value}
                      onClick={() => switchMode(value)}
                      disabled={busy}
                      className="min-h-[44px] rounded-[5px] px-1 text-[0.9375rem] font-bold text-text-secondary hover:text-text-primary aria-pressed:border aria-pressed:border-border aria-pressed:bg-bg-card aria-pressed:text-text-primary"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}

              <div className="mb-5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <h1 id="auth-title" className="display text-[1.75rem] font-bold leading-[1.1]">{title}</h1>
                  {isDesktop && <span className="tag tag-gray">Desktop app</span>}
                </div>
                <p className="mt-1.5 text-[0.9375rem] text-text-secondary">{subtitle}</p>
              </div>

              {mode !== 'reset' && (
                <>
                  <button type="button" className="btn btn-secondary btn-lg w-full" onClick={handleGoogle} disabled={busy}>
                    {loading === 'google' ? <ButtonSpinner /> : <GoogleIcon />}
                    <span>{loading === 'google' ? 'Opening Google…' : 'Continue with Google'}</span>
                  </button>
                  {isDesktop && <p className="form-hint">Google sign-in opens in your browser. Come back here when it finishes.</p>}

                  <div className="my-5 flex items-center gap-3 text-[0.875rem] text-text-muted" role="presentation">
                    <span className="h-px flex-1 bg-border" />
                    <span>or use your email</span>
                    <span className="h-px flex-1 bg-border" />
                  </div>
                </>
              )}

              <div className="space-y-4">
                {mode === 'signup' && (
                  <div>
                    <label htmlFor="auth-shop" className="form-label">Shop name</label>
                    <input
                      ref={shopRef}
                      id="auth-shop"
                      type="text"
                      className={`form-input ${fieldErrors.shopName ? 'border-red' : ''}`}
                      value={shopName}
                      onChange={event => setShopName(event.target.value)}
                      placeholder="Main Street Auto Repair"
                      autoComplete="organization"
                      aria-invalid={fieldErrors.shopName ? true : undefined}
                      aria-describedby={fieldErrors.shopName ? 'auth-shop-error' : 'auth-shop-hint'}
                    />
                    {fieldErrors.shopName
                      ? <p id="auth-shop-error" className="form-error">{fieldErrors.shopName}</p>
                      : <p id="auth-shop-hint" className="form-hint">Customers will see this on estimates and invoices.</p>}
                  </div>
                )}

                <div>
                  <label htmlFor="auth-email" className="form-label">Email</label>
                  <input
                    ref={emailRef}
                    id="auth-email"
                    type="email"
                    className={`form-input ${fieldErrors.email ? 'border-red' : ''}`}
                    value={email}
                    onChange={event => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    aria-invalid={fieldErrors.email ? true : undefined}
                    aria-describedby={fieldErrors.email ? 'auth-email-error' : undefined}
                  />
                  {fieldErrors.email && <p id="auth-email-error" className="form-error">{fieldErrors.email}</p>}
                </div>

                {mode !== 'reset' && (
                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-3">
                      <label htmlFor="auth-password" className="text-[0.8125rem] font-bold text-text-secondary">Password</label>
                      {mode === 'login' && (
                        <button
                          type="button"
                          onClick={() => switchMode('reset')}
                          disabled={busy}
                          className="-my-2 inline-flex min-h-[44px] items-center text-[0.875rem] font-bold text-blue underline-offset-4 hover:underline"
                        >
                          Forgot password?
                        </button>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        ref={passwordRef}
                        id="auth-password"
                        type={showPassword ? 'text' : 'password'}
                        className={`form-input pr-[4.5rem] ${fieldErrors.password ? 'border-red' : ''}`}
                        value={password}
                        onChange={event => setPassword(event.target.value)}
                        autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                        aria-invalid={fieldErrors.password ? true : undefined}
                        aria-describedby={fieldErrors.password ? 'auth-password-error' : mode === 'signup' ? 'auth-password-hint' : undefined}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(current => !current)}
                        aria-pressed={showPassword}
                        className="absolute right-0 top-0 inline-flex h-full min-h-[44px] items-center rounded-md px-3.5 text-[0.875rem] font-bold text-blue hover:bg-bg-hover"
                      >
                        {showPassword ? 'Hide' : 'Show'}
                        <span className="sr-only"> password</span>
                      </button>
                    </div>
                    {fieldErrors.password
                      ? <p id="auth-password-error" className="form-error">{fieldErrors.password}</p>
                      : mode === 'signup' && <p id="auth-password-hint" className="form-hint">At least 8 characters.</p>}
                  </div>
                )}
              </div>

              {error && <Notice kind="error" className="mt-5">{error}</Notice>}
              {message && <Notice kind={messageKind} className="mt-5">{message}</Notice>}

              <button type="submit" className="btn btn-primary btn-lg mt-5 w-full" disabled={busy} aria-busy={loading === 'email'}>
                {loading === 'email' && <ButtonSpinner />}
                {submitLabel}
              </button>

              {mode === 'reset' && (
                <button type="button" className="btn btn-ghost mt-2 w-full" onClick={() => switchMode('login')} disabled={busy}>
                  <Icon name="chevronLeft" className="h-5 w-5" />
                  Back to sign in
                </button>
              )}
            </form>

            {/* On a phone the list sits under the form so sign-in is the first thing you see. */}
            <section aria-labelledby="auth-what" className="mt-9 lg:hidden">
              <h2 id="auth-what" className="section-title mb-4">What Alpha Desk does</h2>
              <BenefitList />
            </section>
          </div>
        </main>
        <PublicFooter centered />
      </div>
    </div>
  )
}
