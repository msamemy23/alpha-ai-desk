'use client'

/**
 * PhoneWidget — Browser WebRTC Softphone (v4.1)
 *
 * Fixes vs v4.0:
 * - Widget appears IMMEDIATELY on call trigger (no waiting for token)
 * - Phone numbers normalized to E.164 (+1XXXXXXXXXX) so calls actually ring
 * - Error state shown if token fetch fails instead of silent dismiss
 */

import React, {
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import {
  TelnyxRTCProvider,
  TelnyxRTCContext,
  useNotification,
  useCallbacks,
} from '@telnyx/react-client'

type CallStatus = 'connecting' | 'calling' | 'active' | 'ended' | 'error'

interface PhoneCallDetail {
  number: string
  name?: string
}

const STATUS_COLOR: Record<CallStatus, string> = {
  connecting: '#f59e0b',
  calling:    '#8b5cf6',
  active:     '#10b981',
  ended:      '#6b7280',
  error:      '#ef4444',
}

const STATUS_LABEL: Record<CallStatus, string> = {
  connecting: 'Connecting...',
  calling:    'Calling...',
  active:     'Active',
  ended:      'Call Ended',
  error:      'Connection Error',
}

/** Normalize any US number to E.164: +12819008141 */
function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (raw.startsWith('+')) return raw  // already E.164
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length === 10) return `+1${digits}`
  return raw  // leave as-is if we can't normalize
}

function RemoteAudio() {
  const notification = useNotification()
  const activeCall = (notification?.call) as any
  const audioRef = useRef<HTMLAudioElement>(null)

  useEffect(() => {
    try {
      if (audioRef.current && activeCall?.remoteStream) {
        audioRef.current.srcObject = activeCall.remoteStream
      }
    } catch (err) {
      console.error('[PhoneWidget] RemoteAudio error:', err)
    }
  }, [activeCall?.remoteStream])

  return <audio ref={audioRef} autoPlay playsInline style={{ display: 'none' }} />
}

function PhoneWidgetInner({ number, name, onClose }: { number: string; name?: string; onClose: () => void }) {
  const client       = useContext(TelnyxRTCContext) as any
  const notification = useNotification()
  const activeCall   = (notification?.call) as any

  const [status,  setStatus]  = useState<CallStatus>('connecting')
  const [elapsed, setElapsed] = useState(0)
  const [isMuted, setIsMuted] = useState(false)
  const callMadeRef = useRef(false)

  useCallbacks({
    onReady: () => {
      if (callMadeRef.current) return
      callMadeRef.current = true
      try {
        client?.newCall({
          destinationNumber: number,
          callerNumber:      '+17136636979',
          callerName:        'Alpha Auto Center',
        })
        setStatus('calling')
      } catch (err) {
        console.error('[PhoneWidget] newCall error:', err)
        setStatus('error')
      }
    },
    onError:       (e: unknown) => { console.error('[PhoneWidget] error:', e);       setStatus('error') },
    onSocketError: (e: unknown) => { console.error('[PhoneWidget] socket error:', e); setStatus('error') },
  })

  useEffect(() => {
    try {
      if (!activeCall) return
      const state: string = activeCall.state ?? ''
      if (state === 'active') {
        setStatus('active')
      } else if (['hangup','destroy','done','purge'].includes(state)) {
        setStatus('ended')
        setTimeout(onClose, 1500)
      }
    } catch (err) {
      console.error('[PhoneWidget] state error:', err)
    }
  }, [activeCall?.state])

  useEffect(() => {
    if (status !== 'active') return
    const id = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(id)
  }, [status])

  const fmt = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

  const handleMute = () => {
    try {
      isMuted ? activeCall?.unmuteAudio() : activeCall?.muteAudio()
      setIsMuted(m => !m)
    } catch (err) { console.error('[PhoneWidget] mute error:', err) }
  }

  const handleHangup = () => {
    try { activeCall?.hangup() } catch (err) { console.error('[PhoneWidget] hangup error:', err) }
    setStatus('ended')
    setTimeout(onClose, 1200)
  }

  const dotColor = STATUS_COLOR[status]
  const label    = status === 'active' ? `Active  ${fmt(elapsed)}` : STATUS_LABEL[status]

  return (
    <WidgetShell dotColor={dotColor} label={label} number={number} name={name}>
      {status !== 'ended' && status !== 'error' && (
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={handleMute}
            disabled={status === 'connecting' || status === 'calling'}
            style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: 'none',
              background: isMuted ? '#2563eb' : '#374151', color: '#fff',
              cursor: (status === 'connecting' || status === 'calling') ? 'not-allowed' : 'pointer',
              fontSize: 13, fontWeight: 600,
              opacity: (status === 'connecting' || status === 'calling') ? 0.5 : 1 }}>
            {isMuted ? '🔇 Unmute' : '🎤 Mute'}
          </button>
          <button onClick={handleHangup}
            style={{ flex: 1, padding: '9px 0', borderRadius: 8, border: 'none',
              background: '#dc2626', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            ✕ End Call
          </button>
        </div>
      )}
      {status === 'error' && (
        <div>
          <p style={{ fontSize: 13, color: '#f87171', marginBottom: 10 }}>
            Could not connect. Check microphone permissions.
          </p>
          <button onClick={onClose}
            style={{ width: '100%', padding: '9px 0', borderRadius: 8, border: 'none',
              background: '#374151', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
            Dismiss
          </button>
        </div>
      )}
    </WidgetShell>
  )
}

/** Shared popup shell — used for both loading and active states */
function WidgetShell({
  dotColor, label, number, name, children,
}: {
  dotColor: string; label: string; number: string; name?: string; children?: React.ReactNode
}) {
  return (
    <div style={{
      position: 'fixed', bottom: 24, left: 24, zIndex: 9999,
      background: '#111827', border: '1px solid #374151', borderRadius: 14,
      padding: '18px 22px', minWidth: 250, boxShadow: '0 10px 40px rgba(0,0,0,0.5)',
      fontFamily: 'system-ui, sans-serif', color: '#f9fafb', userSelect: 'none',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <span style={{ width: 10, height: 10, borderRadius: '50%', background: dotColor, boxShadow: `0 0 6px ${dotColor}` }} />
        <span style={{ fontSize: 13, color: dotColor, fontWeight: 600 }}>{label}</span>
      </div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 20, fontWeight: 700 }}>{name || number}</div>
        {name && <div style={{ fontSize: 13, color: '#9ca3af', marginTop: 4 }}>{number}</div>}
      </div>
      {children}
    </div>
  )
}

export default function PhoneWidget() {
  const [token,       setToken]       = useState<string | null>(null)
  const [callDetails, setCallDetails] = useState<PhoneCallDetail | null>(null)
  const [visible,     setVisible]     = useState(false)
  const [tokenError,  setTokenError]  = useState(false)

  useEffect(() => {
    const handler = async (e: Event) => {
      try {
        const { number, name } = (e as CustomEvent<PhoneCallDetail>).detail
        if (!number) return

        // Normalize to E.164 so Telnyx routes the call correctly
        const normalized = toE164(number)

        // Show the widget IMMEDIATELY — don't wait for token
        setVisible(true)
        setCallDetails({ number: normalized, name })
        setToken(null)
        setTokenError(false)

        const res = await fetch('/api/webrtc-token')
        if (!res.ok) throw new Error(`Token fetch failed: ${res.status}`)
        const data = await res.json()
        if (!data.token) throw new Error('No token in response')
        setToken(data.token)
      } catch (err) {
        console.error('[PhoneWidget] startup error:', err)
        setTokenError(true)
      }
    }
    window.addEventListener('phone:call', handler)
    return () => window.removeEventListener('phone:call', handler)
  }, [])

  const handleClose = () => {
    setVisible(false)
    setToken(null)
    setCallDetails(null)
    setTokenError(false)
  }

  // Not triggered yet
  if (!visible || !callDetails) return null

  // Token failed — show error with dismiss
  if (tokenError) {
    return (
      <WidgetShell dotColor={STATUS_COLOR.error} label={STATUS_LABEL.error}
        number={callDetails.number} name={callDetails.name}>
        <p style={{ fontSize: 13, color: '#f87171', marginBottom: 10 }}>
          Could not fetch WebRTC token. Check your connection.
        </p>
        <button onClick={handleClose}
          style={{ width: '100%', padding: '9px 0', borderRadius: 8, border: 'none',
            background: '#374151', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>
          Dismiss
        </button>
      </WidgetShell>
    )
  }

  // Token loading — show "Connecting..." shell immediately
  if (!token) {
    return (
      <WidgetShell dotColor={STATUS_COLOR.connecting} label={STATUS_LABEL.connecting}
        number={callDetails.number} name={callDetails.name}>
        <div style={{ fontSize: 12, color: '#6b7280' }}>Setting up connection…</div>
      </WidgetShell>
    )
  }

  // Token ready — mount Telnyx provider and make the call
  return (
    <TelnyxRTCProvider credential={{ login_token: token }}>
      <PhoneWidgetInner number={callDetails.number} name={callDetails.name} onClose={handleClose} />
      <RemoteAudio />
    </TelnyxRTCProvider>
  )
}
