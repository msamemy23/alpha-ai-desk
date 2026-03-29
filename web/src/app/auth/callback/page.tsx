'use client'
import { useEffect } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://fztnsqrhjesqcnsszqdb.supabase.co',
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ6dG5zcXJoamVzcWNuc3N6cWRiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDMwMTM3MDIsImV4cCI6MjA1ODU4OTcwMn0.4_MNwSmqTU_dlPWtqY9HGqFlrxL_50y0_C1e3KeQ4Fo'
)

export default function AuthCallback() {
  useEffect(() => {
    const handleCallback = async () => {
      const { data } = await supabase.auth.getSession()
      if (data.session) {
        document.cookie = 'alpha_authed=true; max-age=2592000; path=/; SameSite=Lax'
        window.location.href = '/dashboard'
      } else {
        window.location.href = '/login'
      }
    }
    handleCallback()
  }, [])

  return (
    <div style={{
      minHeight: '100vh', background: '#0a0a0a',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#f59e0b', fontFamily: 'Inter, system-ui, sans-serif', fontSize: '16px'
    }}>
      Signing you in...
    </div>
  )
}
