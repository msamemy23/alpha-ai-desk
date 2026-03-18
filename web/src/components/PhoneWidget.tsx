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
  const [callName, setCallName] = useState('')
  const [muted, setMuted] = useState(false)
  const [timer, setTimer] = useState(0)
  const [errorMsg, setErrorMsg] = useState('')
  const [minimized, setMinimized] = useState(true)
  const clientRef = useRef<TelnyxClient | null>(null)
  const callRef = useRef<TelnyxCall | null>(null)
  const timerRef = useRef<NodeJS.Timeout | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

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

  // Initialize Telnyx WebRTC client
  const initClient = useCallback(async () => {
    if (clientRef.current) return
    setStatus('connecting')
    try {
      const res = await fetch('/api/webrtc-token')
      const data = await res.json()
      if (!data.token) throw new Error(data.error || 'No token')
      // Load SDK from CDN if not already loaded
      if (!(window as any).TelnyxRTC) {
        await new Promise<void>((resolve, reject) => {
          const s = document.createElement('script')
          s.src = 'https://unpkg.com/@telnyx/webrtc@2/lib/bundle.js'
          s.onload = () => resolve()
          s.onerror = () => reject(new Error('Failed to load WebRTC SDK'))
          document.head.appendChild(s)
        })
      }
      const TelnyxRTC = (window as any).TelnyxRTC
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
            setMinimized(false)
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
    if (!clientRef.current) await initClient()
    // Wait for ready
    if (status !== 'ready' && !clientRef.current) {
      setErrorMsg('Phone not connected yet, try again in a moment')
      return
    }
    const digits = number.replace(/\D/g, '')
    const dest = digits.length === 10 ? '+1' + digits : digits.startsWith('1') ? '+' + digits : '+' + digits
    setCallNumber(number)
    setCallName(name || '')
    setStatus('calling')
    setMinimized(false)
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
  }, [status, initClient])

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

  // Auto-init on mount
  useEffect(() => { initClient() }, [initClient])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopTimer()
      try { clientRef.current?.disconnect() } catch {}
    }
  }, [stopTimer])

  const isOnCall = status === 'calling' || status === 'ringing' || status === 'active'

  return (
    <>
      <audio id="telnyx-remote-audio" autoPlay />
      {/* Floating phone widget */}
      <div style={{
        position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
        display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8,
      }}>
        {/* Expanded call panel */}
        {!minimized && (
          <div style={{
            background: '#1a1a2e', border: '1px solid #333', borderRadius: 16,
            padding: 20, width: 300, color: '#fff', boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <span style={{ fontSize: 14, color: '#888' }}>
                {status === 'connecting' ? 'Connecting...' :
                 status === 'ready' ? 'Phone Ready' :
                 status === 'calling' ? 'Calling...' :
                 status === 'ringing' ? 'Ringing...' :
                 status === 'active' ? 'On Call' :
                 status === 'error' ? 'Error' : 'Initializing...'}
              </span>
              <button onClick={() => setMinimized(true)} style={{
                background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 18,
              }}>_</button>
            </div>

            {/* Call info */}
            {(callName || callNumber) && (
              <div style={{ textAlign: 'center', marginBottom: 16 }}>
                {callName && <div style={{ fontSize: 18, fontWeight: 600 }}>{callName}</div>}
                <div style={{ fontSize: 14, color: '#aaa' }}>{callNumber}</div>
                {status === 'active' && (
                  <div style={{ fontSize: 24, fontWeight: 700, color: '#4ade80', marginTop: 8 }}>
                    {formatTimer(timer)}
                  </div>
                )}
              </div>
            )}

            {/* Error message */}
            {errorMsg && <div style={{ color: '#f87171', fontSize: 12, marginBottom: 8 }}>{errorMsg}</div>}

            {/* Call controls */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: 16 }}>
              {isOnCall && (
                <>
                  <button onClick={toggleMute} style={{
                    width: 48, height: 48, borderRadius: '50%',
                    background: muted ? '#f59e0b' : '#374151', border: 'none',
                    color: '#fff', fontSize: 20, cursor: 'pointer',
                  }} title={muted ? 'Unmute' : 'Mute'}>
                    {muted ? '\uD83D\uDD07' : '\uD83C\uDF99\uFE0F'}
                  </button>
                  <button onClick={endCall} style={{
                    width: 48, height: 48, borderRadius: '50%',
                    background: '#ef4444', border: 'none',
                    color: '#fff', fontSize: 20, cursor: 'pointer',
                  }} title="End Call">
                    \uD83D\uDCF5
                  </button>
                </>
              )}
              {status === 'ready' && !isOnCall && (
                <div style={{ color: '#888', fontSize: 13 }}>
                  Ready. Ask AI to call someone or use the dialer.
                </div>
              )}
              {status === 'error' && (
                <button onClick={() => { setStatus('idle'); setErrorMsg(''); initClient() }} style={{
                  background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8,
                  padding: '8px 16px', cursor: 'pointer',
                }}>Retry</button>
              )}
            </div>
          </div>
        )}

        {/* Floating phone button */}
        <button
          onClick={() => setMinimized(!minimized)}
          style={{
            width: 56, height: 56, borderRadius: '50%',
            background: isOnCall ? '#ef4444' : status === 'ready' ? '#22c55e' : '#3b82f6',
            border: 'none', color: '#fff', fontSize: 24, cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: isOnCall ? 'pulse 2s infinite' : 'none',
          }}
          title={isOnCall ? 'On Call - Click to expand' : 'Phone'}
        >
          {isOnCall ? (status === 'active' ? formatTimer(timer) : '...') : '\uD83D\uDCDE'}
        </button>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.1); }
        }
      `}</style>
    </>
  )
}
