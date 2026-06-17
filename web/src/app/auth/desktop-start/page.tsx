'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

function validPort(value: string | null) {
  if (!value || !/^\d{2,5}$/.test(value)) return null
  const port = Number(value)
  return port >= 1024 && port <= 65535 ? String(port) : null
}

function validState(value: string | null) {
  return value && /^[a-f0-9]{48}$/i.test(value) ? value : null
}

export default function DesktopOAuthStart() {
  const [status, setStatus] = useState('Opening Google sign-in...')
  const [error, setError] = useState('')

  useEffect(() => {
    const run = async () => {
      const params = new URLSearchParams(window.location.search)
      const port = validPort(params.get('port'))
      const state = validState(params.get('state'))

      if (!port || !state) {
        setStatus('Desktop sign-in link is invalid.')
        setError('Close this tab and try Google sign-in from Alpha AI Desk again.')
        return
      }

      const redirectTo = `${window.location.origin}/auth/callback?desktop_port=${encodeURIComponent(port)}&desktop_state=${encodeURIComponent(state)}`
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
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
    <main className="desktop-auth-screen">
      <section>
        <div className="mark">A</div>
        <p>Alpha AI Desk</p>
        <h1>{status}</h1>
        <span>Finish in this browser. The desktop app will update automatically.</span>
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
