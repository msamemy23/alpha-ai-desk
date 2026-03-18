'use client'
import { useEffect, useState, useRef, useCallback } from 'react'

// Types for Telnyx WebRTC (loaded via CDN)
interface TelnyxCall {
  hangup: () => void
  muteAudio: () => void
  unmuteAudio: () => void
  answer: () => void
  state: string
  id: string
  options: { destinationNumber?: string; callerName?: string }
}

interface TelnyxClient {
  connect: () => void
  disconnect: () => void
  newCall: (opts: { destinationNumber: string; callerName?: string; callerNumber?: string }) => TelnyxCall
  on: (event: string, handler: (...args: any[]) => void) => void
  off: (event: string, handler: (...args: any[]) => void) => void
}

function formatTimer(secs: number) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function PhoneWidget() {
  const [status, setStatus] = useState<'idle'|'connecting'|'ready'|'calling'|'ringing'|'active'|'error'>('idle')
  const [callNumber, setCallNumber] = useState('')
  const [dialInput, setDialInput] = useState('')
  const [callName, setCallName] = useState('')
  const [muted, setMuted] = useState(false)
  const [timer, setTimer] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [visible, setVisible] = useState(false)

  const clientRef = useRef<TelnyxClient | null>(null)
  const callRef = useRef<TelnyxCall | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const startTimer = useCallback(() => {
    setTimer(0)
    timerRef.current = setInterval(() => setTimer(t => t + 1), 1000)
  }, [])

  const stopTimer = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
  }, [])

  const endCall = useCallback(() => {
    try { callRef.current?.hangup() } catch {}
    callRef.current = null
    stopTimer()
    setStatus('ready')
    setMuted(false)
    setCallNumber('')
    setCallName('')
  }, [stopTimer])

  const hideWidget = useCallback(() => {
    if (callRef.current) endCall()
    try { clientRef.current?.disconnect() } catch {}
    clientRef.current = null
    setVisible(false)
    setStatus('idle')
    setDialInput('')
    setErrorMsg('')
  }, [endCall])

  // Initialize Telnyx WebRTC client — only called on demand
  const initClient = useCallback(async () => {
    if (clientRef.current) return
    setStatus('connecting')
    try {
      const res = await fetch('/api/webrtc-token')
      const data = await res.json()
      if (!data.token) throw new Error(data.error || 'No token')

      // Load SDK from CDN if not already loaded
      if (!(window as any).TelnyxWebRTC) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement('script')
          s.src = 'https://unpkg.com/@telnyx/webrtc@2/lib/bundle.js'
          s.onload = () => resolve()
          s.onerror = () => reject(new Error('Failed to load WebRTC SDK'))
          document.head.appendChild(s)
        })
      }

      const w = window as any
      const TelnyxRTC = w.TelnyxWebRTC?.TelnyxRTC || w.TelnyxWebRTC?.default || w.TelnyxWebRTC
      const client = new TelnyxRTC({ login_token: data.token }) as TelnyxClient

      client.on('telnyx.ready', () => {
        console.log('[PhoneWidget] WebRTC ready')
        setStatus('ready')
      })

      client.on('telnyx.error', (err: any) => {
        console.error('[PhoneWidget] error:', err)
        setErrorMsg(err?.message || 'Connection error')
        setStatus('error')
      })

      client.on('telnyx.notification', (notification: any) => {
        const call = notification.call as TelnyxCall
        if (!call) return
        console.log('[PhoneWidget] notification:', notification.type, call.state)

        if (notification.type === 'callUpdate') {
          if (call.state === 'ringing') {
            callRef.current = call
            setStatus('ringing')
            setCallNumber(call.options?.destinationNumber || '')
          } else if (call.state === 'active') {
            callRef.current = call
            setStatus('active')
            startTimer()
            // Attach remote audio
            const remoteAudio = document.getElementById('telnyx-remote-audio') as HTMLAudioElement
            if (remoteAudio && (call as any).remoteStream) {
              remoteAudio.srcObject = (call as any).remoteStream
              remoteAudio.play().catch(() => {})
            }
          } else if (call.state === 'hangup' || call.state === 'destroy') {
            endCall()
          }
        }
      })

      client.connect()
      clientRef.current = client
    } catch (e: any) {
      console.error('[PhoneWidget] init error:', e)
      setErrorMsg(e.message)
      setStatus('error')
    }
  }, [startTimer, endCall])

  const makeCall = useCallback(async (number: string, name?: string) => {
    // Show widget and init if needed
    setVisible(true)
    if (!clientRef.current) await initClient()

    // Small delay to wait for ready
    const waitForReady = () => new Promise<void>(resolve => {
      if (clientRef.current) { resolve(); return }
      setTimeout(resolve, 1500)
    })
    await waitForReady()

    if (!clientRef.current) {
      setErrorMsg('Phone not connected yet, try again')
      setStatus('error')
      return
    }

    const digits = number.replace(/\D/g, '')
    const dest = digits.length === 10 ? '+1' + digits : digits.startsWith('1') ? '+' + digits : '+' + digits

    setCallNumber(number)
    setCallName(name || '')
    setStatus('calling')

    try {
      const call = clientRef.current!.newCall({
        destinationNumber: dest,
        callerName: 'Alpha Auto Center',
        callerNumber: '+17136636979',
      })
      callRef.current = call
    } catch (e: any) {
      setErrorMsg(e.message)
      setStatus('error')
    }
  }, [initClient])

  const toggleMute = useCallback(() => {
    if (!callRef.current) return
    if (muted) { callRef.current.unmuteAudio(); setMuted(false) }
    else { callRef.current.muteAudio(); setMuted(true) }
  }, [muted])

  // Listen for phone:call custom events from AI chat
  useEffect(() => {
    const handler = (e: CustomEvent) => {
      const { number, name } = e.detail || {}
      if (number) makeCall(number, name)
    }
    window.addEventListener('phone:call', handler as EventListener)
    return () => window.removeEventListener('phone:call', handler as EventListener)
  }, [makeCall])

  // NO auto-init — only init when phone:call event fires or user dials

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTimer()
      try { clientRef.current?.disconnect() } catch {}
    }
  }, [stopTimer])

  const handleDial = () => {
    const num = dialInput.trim()
    if (!num) return
    makeCall(num)
    setDialInput('')
  }

  const isOnCall = status === 'calling' || status === 'ringing' || status === 'active'

  // Don't render anything if not visible
  if (!visible) return <audio id="telnyx-remote-audio" autoPlay playsInline />

  return (
    <>
      <audio id="telnyx-remote-audio" autoPlay playsInline />
      {/* Square phone panel — bottom-left to not block AI button */}
      <div style={{
        position: 'fixed',
        bottom: 20,
        left: 20,
        width: 280,
        background: '#1a1a2e',
        border: '1px solid #333',
        borderRadius: 12,
        padding: 16,
        zIndex: 9999,
        color: '#fff',
        fontFamily: 'system-ui, sans-serif',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}>
        {/* Header with close button */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18 }}>📞</span>
            <span style={{ fontWeight: 600, fontSize: 14 }}>Phone</span>
            <span style={{
              fontSize: 10,
              padding: '2px 8px',
              borderRadius: 10,
              background: status === 'active' ? '#10b981' : status === 'calling' || status === 'ringing' ? '#f59e0b' : status === 'ready' ? '#3b82f6' : status === 'error' ? '#ef4444' : '#666',
              color: '#fff',
            }}>
              {status === 'active' ? 'Active' : status === 'calling' ? 'Calling...' : status === 'ringing' ? 'Ringing...' : status === 'ready' ? 'Ready' : status === 'connecting' ? 'Connecting...' : status === 'error' ? 'Error' : 'Idle'}
            </span>
          </div>
          <button onClick={hideWidget} style={{
            background: 'none', border: 'none', color: '#999', cursor: 'pointer', fontSize: 18, padding: 0,
          }}>&times;</button>
        </div>

        {/* Error message */}
        {errorMsg && <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 8 }}>{errorMsg}</div>}

        {/* Call info when on call */}
        {isOnCall && (
          <div style={{ marginBottom: 12, padding: 10, background: '#111', borderRadius: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{callName || callNumber}</div>
            {callName && <div style={{ fontSize: 11, color: '#aaa' }}>{callNumber}</div>}
            {status === 'active' && <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color: '#10b981' }}>{formatTimer(timer)}</div>}
          </div>
        )}

        {/* Dialer input — show when not on call */}
        {!isOnCall && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <input
              type="tel"
              placeholder="Enter number..."
              value={dialInput}
              onChange={e => setDialInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleDial() }}
              style={{
                flex: 1,
                background: '#111',
                border: '1px solid #444',
                borderRadius: 8,
                padding: '8px 10px',
                color: '#fff',
                fontSize: 14,
                outline: 'none',
              }}
            />
            <button onClick={handleDial} style={{
              background: '#3b82f6',
              border: 'none',
              borderRadius: 8,
              padding: '8px 14px',
              color: '#fff',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 13,
            }}>Dial</button>
          </div>
        )}

        {/* Call controls when on call */}
        {isOnCall && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={toggleMute} style={{
              flex: 1,
              background: muted ? '#f59e0b' : '#333',
              border: 'none',
              borderRadius: 8,
              padding: '10px 0',
              color: '#fff',
              cursor: 'pointer',
              fontWeight: 500,
              fontSize: 13,
            }}>{muted ? '🔇 Unmute' : '🎙 Mute'}</button>
            <button onClick={endCall} style={{
              flex: 1,
              background: '#ef4444',
              border: 'none',
              borderRadius: 8,
              padding: '10px 0',
              color: '#fff',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 13,
            }}>End Call</button>
          </div>
        )}
      </div>
    </>
  )
}
