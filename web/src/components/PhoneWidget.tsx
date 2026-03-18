'use client'
import { useEffect, useState, useRef, useCallback } from 'react'

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

function fmt(secs: number) {
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function PhoneWidget() {
  const [status, setStatus] = useState<'idle'|'connecting'|'ready'|'calling'|'ringing'|'active'|'error'>('idle')
  const [num, setNum] = useState('')
  const [dialVal, setDialVal] = useState('')
  const [name, setName] = useState('')
  const [muted, setMuted] = useState(false)
  const [timer, setTimer] = useState(0)
  const [err, setErr] = useState('')
  const [show, setShow] = useState(false)
  const client = useRef<TelnyxClient | null>(null)
  const call = useRef<TelnyxCall | null>(null)
  const tmr = useRef<ReturnType<typeof setInterval> | null>(null)

  // Clear error whenever status changes to non-error
  useEffect(() => {
    if (status !== 'error') setErr('')
  }, [status])

  const stopTmr = useCallback(() => {
    if (tmr.current) { clearInterval(tmr.current); tmr.current = null }
  }, [])

  const hangup = useCallback(() => {
    try { call.current?.hangup() } catch {}
    call.current = null
    stopTmr()
    setStatus(client.current ? 'ready' : 'idle')
    setMuted(false)
    setNum('')
    setName('')
  }, [stopTmr])

  const close = useCallback(() => {
    if (call.current) hangup()
    try { client.current?.disconnect() } catch {}
    client.current = null
    setShow(false)
    setStatus('idle')
    setDialVal('')
    setErr('')
  }, [hangup])

  const init = useCallback(async (): Promise<boolean> => {
    if (client.current) return true
    setStatus('connecting')
    setErr('')
    try {
      const res = await fetch('/api/webrtc-token')
      const data = await res.json()
      if (!data.token) throw new Error(data.error || 'No WebRTC token')

      if (!(window as any).TelnyxWebRTC) {
        await new Promise<void>((ok, fail) => {
          const s = document.createElement('script')
          s.src = 'https://unpkg.com/@telnyx/webrtc@2/lib/bundle.js'
          s.onload = () => ok()
          s.onerror = () => fail(new Error('SDK load failed'))
          document.head.appendChild(s)
        })
      }

      const w = window as any
      const Ctor = w.TelnyxWebRTC?.TelnyxRTC || w.TelnyxWebRTC?.default || w.TelnyxWebRTC
      if (!Ctor) throw new Error('TelnyxRTC not found on window')

      const c = new Ctor({ login_token: data.token }) as TelnyxClient

      await new Promise<void>((ok, fail) => {
        const timeout = setTimeout(() => fail(new Error('WebRTC connection timeout')), 15000)
        c.on('telnyx.ready', () => { clearTimeout(timeout); ok() })
        c.on('telnyx.error', (e: any) => { clearTimeout(timeout); fail(new Error(e?.message || 'WebRTC error')) })
        c.connect()
      })

      // Attach notification handler for call state updates
      c.on('telnyx.notification', (n: any) => {
        const cl = n.call as TelnyxCall
        if (!cl || n.type !== 'callUpdate') return
        if (cl.state === 'ringing') {
          call.current = cl
          setStatus('ringing')
          setNum(cl.options?.destinationNumber || '')
        } else if (cl.state === 'active') {
          call.current = cl
          setStatus('active')
          setTimer(0)
          tmr.current = setInterval(() => setTimer(t => t + 1), 1000)
          // Attach remote audio
          const el = document.getElementById('telnyx-remote-audio') as HTMLAudioElement
          if (el && (cl as any).remoteStream) {
            el.srcObject = (cl as any).remoteStream
            el.play().catch(() => {})
          }
        } else if (cl.state === 'hangup' || cl.state === 'destroy') {
          hangup()
        }
      })

      // Also listen for late errors
      c.on('telnyx.error', (e: any) => {
        console.error('[Phone] error:', e)
        setErr(e?.message || 'Connection lost')
        setStatus('error')
      })

      client.current = c
      setStatus('ready')
      console.log('[Phone] WebRTC ready')
      return true
    } catch (e: any) {
      console.error('[Phone] init failed:', e)
      setErr(e.message || 'Connection failed')
      setStatus('error')
      return false
    }
  }, [hangup])

  const dial = useCallback(async (number: string, callerName?: string) => {
    setShow(true)
    setErr('')
    const ok = await init()
    if (!ok || !client.current) return

    const digits = number.replace(/\D/g, '')
    const dest = digits.length === 10 ? '+1' + digits : digits.startsWith('1') ? '+' + digits : '+' + digits
    setNum(number)
    setName(callerName || '')
    setStatus('calling')

    try {
      // Request mic permission first
      await navigator.mediaDevices.getUserMedia({ audio: true })
      call.current = client.current.newCall({
        destinationNumber: dest,
        callerName: 'Alpha Auto Center',
        callerNumber: '+17136636979',
      })
    } catch (e: any) {
      setErr(e.message || 'Call failed')
      setStatus('error')
    }
  }, [init])

  const toggleMute = useCallback(() => {
    if (!call.current) return
    if (muted) { call.current.unmuteAudio(); setMuted(false) }
    else { call.current.muteAudio(); setMuted(true) }
  }, [muted])

  // Listen for phone:call events from AI
  useEffect(() => {
    const h = (e: CustomEvent) => {
      const { number, name } = e.detail || {}
      if (number) dial(number, name)
    }
    window.addEventListener('phone:call', h as EventListener)
    return () => window.removeEventListener('phone:call', h as EventListener)
  }, [dial])

  // Cleanup
  useEffect(() => () => {
    stopTmr()
    try { client.current?.disconnect() } catch {}
  }, [stopTmr])

  const onDial = () => {
    const v = dialVal.trim()
    if (!v) return
    dial(v)
    setDialVal('')
  }

  const onCall = status === 'calling' || status === 'ringing' || status === 'active'

  if (!show) return <audio id="telnyx-remote-audio" autoPlay playsInline />

  const badge = {
    active: { bg: '#10b981', text: 'Active' },
    calling: { bg: '#f59e0b', text: 'Calling...' },
    ringing: { bg: '#f59e0b', text: 'Ringing...' },
    ready: { bg: '#3b82f6', text: 'Ready' },
    connecting: { bg: '#6b7280', text: 'Connecting...' },
    error: { bg: '#ef4444', text: 'Error' },
    idle: { bg: '#6b7280', text: 'Idle' },
  }[status]

  return (
    <>
      <audio id="telnyx-remote-audio" autoPlay playsInline />
      <div style={{
        position: 'fixed', bottom: 20, left: 20, width: 280,
        background: '#1a1a2e', border: '1px solid #333', borderRadius: 12,
        padding: 16, zIndex: 9999, color: '#fff',
        fontFamily: 'system-ui, sans-serif',
        boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontSize: 18 }}>📞</span>
            <span style={{ fontWeight: 600, fontSize: 14 }}>Phone</span>
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 10, background: badge.bg, color: '#fff' }}>
              {badge.text}
            </span>
          </div>
          <button onClick={close} style={{ background: 'none', border: 'none', color: '#999', cursor: 'pointer', fontSize: 18, padding: 0 }}>&times;</button>
        </div>

        {err && <div style={{ fontSize: 11, color: '#ef4444', marginBottom: 8 }}>{err}</div>}

        {onCall && (
          <div style={{ marginBottom: 12, padding: 10, background: '#111', borderRadius: 8 }}>
            <div style={{ fontSize: 13, fontWeight: 500 }}>{name || num}</div>
            {name && <div style={{ fontSize: 11, color: '#aaa' }}>{num}</div>}
            {status === 'active' && <div style={{ fontSize: 20, fontWeight: 700, marginTop: 4, color: '#10b981' }}>{fmt(timer)}</div>}
          </div>
        )}

        {!onCall && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
            <input type="tel" placeholder="Enter number..." value={dialVal}
              onChange={e => setDialVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') onDial() }}
              style={{ flex: 1, background: '#111', border: '1px solid #444', borderRadius: 8, padding: '8px 10px', color: '#fff', fontSize: 14, outline: 'none' }}
            />
            <button onClick={onDial} disabled={status === 'connecting'}
              style={{ background: status === 'connecting' ? '#555' : '#3b82f6', border: 'none', borderRadius: 8, padding: '8px 14px', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
              {status === 'connecting' ? '...' : 'Dial'}
            </button>
          </div>
        )}

        {onCall && (
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={toggleMute} style={{ flex: 1, background: muted ? '#f59e0b' : '#333', border: 'none', borderRadius: 8, padding: '10px 0', color: '#fff', cursor: 'pointer', fontWeight: 500, fontSize: 13 }}>
              {muted ? '🔇 Unmute' : '🎙 Mute'}
            </button>
            <button onClick={hangup} style={{ flex: 1, background: '#ef4444', border: 'none', borderRadius: 8, padding: '10px 0', color: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}>
              End Call
            </button>
          </div>
        )}

        {status === 'error' && (
          <button onClick={() => { setErr(''); init() }} style={{ width: '100%', marginTop: 8, background: '#333', border: 'none', borderRadius: 8, padding: '8px 0', color: '#fff', cursor: 'pointer', fontSize: 12 }}>
            Retry Connection
          </button>
        )}
      </div>
    </>
  )
}
