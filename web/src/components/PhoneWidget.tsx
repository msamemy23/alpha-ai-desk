'use client'

/**
 * PhoneWidget — Browser WebRTC Softphone (v4.2)
 *
 * Call logic is unchanged from v4.1:
 * - Widget appears IMMEDIATELY on call trigger (no waiting for token)
 * - Phone numbers normalized to E.164 (+1XXXXXXXXXX) so calls actually ring
 * - Error state shown if token fetch fails instead of silent dismiss
 *
 * v4.2 is a restyle only: design tokens, status lamps with words, big
 * Mute / Hang up buttons, and a position that clears the phone tab bar.
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
import Icon from '@/components/Icon'

type CallStatus = 'connecting' | 'calling' | 'active' | 'ended' | 'error'

interface PhoneCallDetail {
  number: string
  name?: string
}

// Lamp colour for each call state: calling amber, active green, ended grey, error red.
const STATUS_LAMP: Record<CallStatus, string> = {
  connecting: 'lamp-amber',
  calling:    'lamp-amber',
  active:     'lamp-green',
  ended:      'lamp-off',
  error:      'lamp-red',
}

const STATUS_LABEL: Record<CallStatus, string> = {
  connecting: 'Connecting',
  calling:    'Calling',
  active:     'Active',
  ended:      'Call ended',
  error:      'Call failed',
}

/** Normalize any US number to E.164: +12819008141 */
function toE164(raw: string): string {
  const digits = raw.replace(/\D/g, '')
  if (raw.startsWith('+')) return raw  // already E.164
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  if (digits.length === 10) return `+1${digits}`
  return raw  // leave as-is if we can't normalize
}

/** Display only: +17135550142 becomes (713) 555-0142. Anything else is shown as given. */
function prettyNumber(raw: string): string {
  const m = raw.match(/^\+1(\d{3})(\d{3})(\d{4})$/)
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : raw
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

function PhoneWidgetInner({ number, name, callerNumber, callerName, onClose }: { number: string; name?: string; callerNumber: string; callerName?: string; onClose: () => void }) {
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
          callerNumber,
          callerName: callerName || 'AI Call',
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

  return (
    <CallPanel
      status={status}
      timer={status === 'active' ? fmt(elapsed) : undefined}
      muted={isMuted && status === 'active'}
      number={number}
      name={name}
      onMute={handleMute}
      onHangup={handleHangup}
      onDismiss={onClose}
    />
  )
}

/**
 * The floating call panel. Pure presentation: it only knows the call state it
 * is given and which handlers to run, so every state can be previewed on its own.
 */
export function CallPanel({
  status, timer, muted = false, number, name, detail, onMute, onHangup, onDismiss,
}: {
  status: CallStatus
  timer?: string
  muted?: boolean
  number: string
  name?: string
  detail?: string
  onMute?: () => void
  onHangup?: () => void
  onDismiss?: () => void
}) {
  const setup = status === 'connecting' || status === 'calling'
  return (
    <div
      role="region"
      aria-label="Phone call"
      aria-live="polite"
      className="no-print fixed inset-x-3 bottom-[calc(var(--tabbar-h)+env(safe-area-inset-bottom)+0.75rem)] z-[70] rounded-xl border border-line bg-bg-card p-4 text-text-primary shadow-[var(--shadow-pop)] sm:left-auto sm:right-4 sm:w-[22rem] lg:bottom-6 lg:right-6"
    >
      <div className="flex items-center gap-2.5">
        <span className={`lamp ${STATUS_LAMP[status]}`} aria-hidden="true" />
        <span className="font-bold">{STATUS_LABEL[status]}{setup ? '…' : ''}</span>
        {muted && <span className="tag tag-amber">Muted</span>}
        {timer && <span className="num ml-auto text-[1.125rem] font-bold">{timer}</span>}
      </div>

      <div className="mt-2.5 min-w-0">
        <div className="display truncate text-[1.375rem] font-bold leading-tight">{name || prettyNumber(number)}</div>
        {name && <div className="num text-[0.9375rem] text-text-secondary">{prettyNumber(number)}</div>}
      </div>

      {status === 'connecting' && !onHangup && (
        <p className="mt-3 text-[0.9375rem] text-text-secondary">{detail || 'Setting up the connection…'}</p>
      )}

      {status === 'error' && (
        <div className="mt-3">
          <p role="alert" className="text-[0.9375rem] text-red">{detail || 'Could not connect. Check that this browser can use your microphone, then try again.'}</p>
          <button type="button" className="btn btn-secondary btn-lg mt-3 w-full" onClick={onDismiss}>Dismiss</button>
        </div>
      )}

      {status !== 'ended' && status !== 'error' && onHangup && (
        <div className="mt-4 grid grid-cols-2 gap-3">
          <button
            type="button"
            className={`btn btn-lg ${muted ? 'border-blue bg-blue/10 text-blue' : 'btn-secondary'}`}
            onClick={onMute}
            disabled={setup}
            aria-pressed={muted}
          >
            <Icon name="mic" className="h-5 w-5" />
            {muted ? 'Unmute' : 'Mute'}
          </button>
          <button
            type="button"
            className="btn btn-lg bg-red text-[rgb(var(--c-card))] hover:brightness-110"
            onClick={onHangup}
          >
            <Icon name="phone" className="h-5 w-5" />
            Hang up
          </button>
        </div>
      )}
    </div>
  )
}

export default function PhoneWidget() {
  const [token,       setToken]       = useState<string | null>(null)
  const [callDetails, setCallDetails] = useState<PhoneCallDetail | null>(null)
  const [visible,     setVisible]     = useState(false)
  const [tokenError,  setTokenError]  = useState(false)
  const [callerNumber, setCallerNumber] = useState('')
  const [callerName, setCallerName] = useState('')

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
        setCallerNumber('')
        setCallerName('')
        setToken(null)
        setTokenError(false)

        const res = await fetch('/api/webrtc-token')
        if (!res.ok) throw new Error(`Token fetch failed: ${res.status}`)
        const data = await res.json()
        if (!data.token || !data.fromPhone) throw new Error('WebRTC setup is incomplete')
        setCallerNumber(data.fromPhone)
        setCallerName(data.shopName || 'AI Call')
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
    setCallerNumber('')
    setCallerName('')
    setCallDetails(null)
    setTokenError(false)
  }

  // Not triggered yet
  if (!visible || !callDetails) return null

  // Token failed — show error with dismiss
  if (tokenError) {
    return (
      <CallPanel
        status="error"
        number={callDetails.number}
        name={callDetails.name}
        detail="Could not set up the call. Check your connection and try again."
        onDismiss={handleClose}
      />
    )
  }

  // Token loading — show "Connecting..." shell immediately
  if (!token) {
    return (
      <CallPanel status="connecting" number={callDetails.number} name={callDetails.name} />
    )
  }

  // Token ready — mount Telnyx provider and make the call
  return (
    <TelnyxRTCProvider credential={{ login_token: token }}>
      <PhoneWidgetInner number={callDetails.number} name={callDetails.name} callerNumber={callerNumber} callerName={callerName} onClose={handleClose} />
      <RemoteAudio />
    </TelnyxRTCProvider>
  )
}
