'use client'
import { useState } from 'react'
import { supabase } from '@/lib/supabase'

function setCookie(name: string, value: string, days = 30) {
  const expires = new Date(Date.now() + days * 864e5).toUTCString()
  document.cookie = `${name}=${value}; expires=${expires}; path=/; SameSite=Lax`
}

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [shopName, setShopName] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [mode, setMode] = useState<'login' | 'signup' | 'reset'>('login')

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setMessage('')
    try {
      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password,
        })
        if (error) {
          if (error.message.includes('Invalid login credentials') || error.message.includes('invalid_credentials')) {
            throw new Error('Incorrect email or password. If you signed up with Google, use the "Continue with Google" button instead.')
          }
          if (error.message.includes('Email not confirmed')) {
            throw new Error('Please confirm your email before signing in. Check your inbox for a confirmation link.')
          }
          throw error
        }
        setCookie('alpha_authed', 'true')
        window.location.href = '/dashboard'
      } else if (mode === 'signup') {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password,
        })
        if (error) throw error
        // If email confirmation is required, session will be null — tell user to confirm first.
        if (!data.session) {
          setMessage('Account created! Check your email for a confirmation link, then sign in.')
          setMode('login')
          setLoading(false)
          return
        }
        // Session exists → create shop_profiles row (RLS allows it now)
        if (data.user) {
          await supabase.from('shop_profiles').insert({
            user_id: data.user.id,
            shop_name: shopName || 'My Shop',
            phone: '',
            address: '',
            city_state_zip: '',
            services: [],
          })
        }
        setCookie('alpha_authed', 'true')
        window.location.href = '/onboarding'
      } else if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback`,
        })
        if (error) throw error
        setMessage('Password reset email sent! Check your inbox.')
        setLoading(false)
        return
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  const handleGoogle = async () => {
    const isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI?.isElectron
    if (isElectron) {
      // In Electron: navigate main window directly to OAuth URL - avoids Google blocking embedded browsers
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth/callback`, skipBrowserRedirect: true }
      })
      if (error) { setError(error.message); return }
      if (data?.url) window.location.href = data.url
    } else {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: `${window.location.origin}/auth/callback` }
      })
      if (error) setError(error.message)
    }
  }

  const inputStyle: React.CSSProperties = {
    width: '100%', padding: '11px 14px',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: '10px', color: '#fff',
    fontSize: '14px', outline: 'none',
    boxSizing: 'border-box', transition: 'border-color 0.2s'
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0a0a0a 0%, #111827 50%, #0a0a0a 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'Inter, system-ui, sans-serif', padding: '20px'
    }}>
      <div style={{ position: 'fixed', top: '20%', left: '50%', transform: 'translateX(-50%)',
        width: '600px', height: '300px',
        background: 'radial-gradient(ellipse, rgba(245,158,11,0.08) 0%, transparent 70%)',
        pointerEvents: 'none' }} />
      <div style={{
        width: '100%', maxWidth: '420px',
        background: 'rgba(17,24,39,0.95)',
        border: '1px solid rgba(245,158,11,0.2)',
        borderRadius: '20px', padding: '40px',
        backdropFilter: 'blur(20px)',
        boxShadow: '0 25px 60px rgba(0,0,0,0.5)'
      }}>
        <div style={{ textAlign: 'center', marginBottom: '32px' }}>
          <div style={{
            width: '60px', height: '60px', borderRadius: '16px',
            background: 'linear-gradient(135deg, rgba(245,158,11,0.2), rgba(245,158,11,0.05))',
            border: '1px solid rgba(245,158,11,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '28px', margin: '0 auto 16px'
          }}>ðŸ”§</div>
          <h1 style={{ color: '#f59e0b', fontSize: '22px', fontWeight: '700', margin: '0 0 6px', letterSpacing: '-0.3px' }}>
            Alpha Desktop AI
          </h1>
          <p style={{ color: '#6b7280', fontSize: '14px', margin: 0 }}>
            {mode === 'login' ? 'Sign in to your shop dashboard' : mode === 'signup' ? 'Create your shop account' : 'Reset your password'}
          </p>
        </div>

        {mode !== 'reset' && (
          <>
            <button onClick={handleGoogle} style={{
              width: '100%', padding: '12px',
              background: 'rgba(255,255,255,0.05)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '10px', color: '#fff',
              fontSize: '14px', fontWeight: '500', cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
              marginBottom: '16px', transition: 'all 0.2s'
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Continue with Google
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.08)' }} />
              <span style={{ color: '#4b5563', fontSize: '12px' }}>or</span>
              <div style={{ flex: 1, height: '1px', background: 'rgba(255,255,255,0.08)' }} />
            </div>
          </>
        )}

        <form onSubmit={handleEmailAuth}>
          {mode === 'signup' && (
            <div style={{ marginBottom: '14px' }}>
              <label style={{ display: 'block', color: '#9ca3af', fontSize: '13px', fontWeight: '500', marginBottom: '6px' }}>Shop Name</label>
              <input type="text" value={shopName} onChange={e => setShopName(e.target.value)}
                placeholder="Your Auto Shop" required style={inputStyle}
                onFocus={e => (e.target.style.borderColor = 'rgba(245,158,11,0.5)')}
                onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')} />
            </div>
          )}
          <div style={{ marginBottom: '14px' }}>
            <label style={{ display: 'block', color: '#9ca3af', fontSize: '13px', fontWeight: '500', marginBottom: '6px' }}>Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)}
              placeholder="your@email.com" required style={inputStyle}
              onFocus={e => (e.target.style.borderColor = 'rgba(245,158,11,0.5)')}
              onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')} />
          </div>
          {mode !== 'reset' && (
            <div style={{ marginBottom: '20px' }}>
              <label style={{ display: 'block', color: '#9ca3af', fontSize: '13px', fontWeight: '500', marginBottom: '6px' }}>Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="â€¢â€¢â€¢â€¢â€¢â€¢â€¢â€¢" required style={inputStyle}
                onFocus={e => (e.target.style.borderColor = 'rgba(245,158,11,0.5)')}
                onBlur={e => (e.target.style.borderColor = 'rgba(255,255,255,0.1)')} />
            </div>
          )}
          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: '8px', padding: '10px 14px', marginBottom: '16px',
              color: '#f87171', fontSize: '13px'
            }}>{error}</div>
          )}
          {message && (
            <div style={{
              background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)',
              borderRadius: '8px', padding: '10px 14px', marginBottom: '16px',
              color: '#4ade80', fontSize: '13px'
            }}>{message}</div>
          )}
          <button type="submit" disabled={loading} style={{
            width: '100%', padding: '13px',
            background: loading ? 'rgba(245,158,11,0.4)' : 'linear-gradient(135deg, #f59e0b, #d97706)',
            border: 'none', borderRadius: '10px', color: '#000',
            fontSize: '15px', fontWeight: '700',
            cursor: loading ? 'not-allowed' : 'pointer', transition: 'all 0.2s'
          }}>
            {loading ? 'Please waitâ€¦' : mode === 'login' ? 'Sign In' : mode === 'signup' ? 'Create Account' : 'Send Reset Link'}
          </button>
        </form>

        {mode === 'login' && (
          <div style={{ textAlign: 'center', marginTop: '16px' }}>
            <button onClick={() => { setMode('reset'); setError(''); setMessage('') }}
              style={{ background: 'none', border: 'none', color: '#6b7280', fontSize: '12px', cursor: 'pointer' }}>
              Forgot password?
            </button>
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: '20px' }}>
          <span style={{ color: '#6b7280', fontSize: '13px' }}>
            {mode === 'login' ? "Don't have an account? " : mode === 'signup' ? 'Already have an account? ' : 'Remember your password? '}
          </span>
          <button onClick={() => { setMode(mode === 'signup' ? 'login' : mode === 'reset' ? 'login' : 'signup'); setError(''); setMessage('') }}
            style={{ background: 'none', border: 'none', color: '#f59e0b', fontSize: '13px', fontWeight: '600', cursor: 'pointer' }}>
            {mode === 'login' ? 'Sign up' : 'Sign in'}
          </button>
        </div>

        <p style={{ color: '#374151', fontSize: '11px', textAlign: 'center', marginTop: '24px', lineHeight: '1.5' }}>
          AI-powered automotive shop management
        </p>
      </div>
    </div>
  )
}
