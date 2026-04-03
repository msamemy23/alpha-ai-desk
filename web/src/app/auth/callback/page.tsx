'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://fztnsqrhjesqcnsszqdb.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6dG5zcXJoamVzcWNuc3N6cWRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMwMTM3MDIsImV4cCI6MjA1ODU4OTcwMn0.4_MNwSmqTU_dlPWtqY9HGqFlrxL_50y0_C1e3KeQ4Fo'
)

export default function AuthCallback() {
  const [status, setStatus] = useState('Signing you in...')

  useEffect(() => {
    // Handle PKCE code exchange if present in URL
    const params = new URLSearchParams(window.location.search)
    const code = params.get('code')

    const processAuth = async () => {
      try {
        // If there's a code param, exchange it for a session (PKCE flow)
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code)
          if (error) {
            console.error('Code exchange error:', error)
            setStatus('Authentication failed. Redirecting...')
            setTimeout(() => { window.location.href = '/login' }, 2000)
            return
          }
        }

        // Listen for auth state changes (handles hash fragment flow)
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
          if (session) {
            // Set auth cookie
            document.cookie = 'alpha_authed=true; max-age=2592000; path=/; SameSite=Lax'

            // Check if user has a shop_profiles record
            const userId = session.user.id
            const { data: profile } = await supabase
              .from('shop_profiles')
              .select('id')
              .eq('user_id', userId)
              .single()

            if (!profile) {
              const email = session.user.email || ''
              const name = session.user.user_metadata?.full_name || email.split('@')[0] || 'My Shop'
              await supabase.from('shop_profiles').insert({
                user_id: userId,
                shop_name: name + "'s Shop",
                phone: '',
                address: '',
                city_state_zip: ''
              })
              window.location.href = '/onboarding'
            } else {
              window.location.href = '/dashboard'
            }
            subscription.unsubscribe()
          }
        })

        // Also try getSession after a short delay as fallback
        setTimeout(async () => {
          const { data } = await supabase.auth.getSession()
          if (data.session) {
            document.cookie = 'alpha_authed=true; max-age=2592000; path=/; SameSite=Lax'
            const userId = data.session.user.id
            const { data: profile } = await supabase
              .from('shop_profiles')
              .select('id')
              .eq('user_id', userId)
              .single()

            if (!profile) {
              const email = data.session.user.email || ''
              const name = data.session.user.user_metadata?.full_name || email.split('@')[0] || 'My Shop'
              await supabase.from('shop_profiles').insert({
                user_id: userId,
                shop_name: name + "'s Shop",
                phone: '',
                address: '',
                city_state_zip: ''
              })
              window.location.href = '/onboarding'
            } else {
              window.location.href = '/dashboard'
            }
          } else if (!code) {
            // No session and no code - redirect to login
            setStatus('No session found. Redirecting...')
            setTimeout(() => { window.location.href = '/login' }, 2000)
          }
        }, 1000)

      } catch (err) {
        console.error('Auth callback error:', err)
        setStatus('Something went wrong. Redirecting...')
        setTimeout(() => { window.location.href = '/login' }, 2000)
      }
    }

    processAuth()
  }, [])

  return (
    <div style={{
      minHeight: '100vh', background: '#0a0a0a',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      flexDirection: 'column', gap: '16px',
      color: '#f59e0b', fontFamily: 'Inter, system-ui, sans-serif', fontSize: '16px'
    }}>
      <div style={{
        width: '40px', height: '40px', border: '3px solid rgba(245,158,11,0.3)',
        borderTopColor: '#f59e0b', borderRadius: '50%',
        animation: 'spin 1s linear infinite'
      }} />
      {status}
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}
