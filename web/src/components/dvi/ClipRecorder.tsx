'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import { MAX_SECONDS, baseType, clockText, pickRecorderType } from '@/lib/dvi-media'

type Phase = 'asking' | 'ready' | 'recording' | 'review' | 'nodevice'

/**
 * Record a short video (30 seconds) or voice note (60 seconds) on the phone, review it, and keep it or retake it.
 * Where the browser cannot record, the phone's own camera or voice recorder is offered instead through a file picker.
 */
export default function ClipRecorder({ kind, onUse, onCancel }: {
  kind: 'video' | 'audio'
  onUse: (blob: Blob, secs: number) => Promise<void>
  onCancel: () => void
}) {
  const [phase, setPhase] = useState<Phase>('asking')
  const [secs, setSecs] = useState(0)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [clip, setClip] = useState<{ blob: Blob; url: string; secs: number } | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const rec = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const started = useRef(0)
  const preview = useRef<HTMLVideoElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const max = MAX_SECONDS[kind]

  const release = useCallback(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null }
    stream.current?.getTracks().forEach(t => t.stop())
    stream.current = null
  }, [])

  const open = useCallback(async () => {
    setError(''); setPhase('asking')
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) { setPhase('nodevice'); return }
    try {
      const s = await navigator.mediaDevices.getUserMedia(kind === 'video' ? { video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: true } : { audio: true })
      stream.current = s
      if (kind === 'video' && preview.current) { preview.current.srcObject = s; void preview.current.play().catch(() => undefined) }
      setPhase('ready')
    } catch {
      setError(kind === 'video' ? 'The camera or microphone is blocked. Allow it in the browser, or use the phone’s own camera below.' : 'The microphone is blocked. Allow it in the browser, or use the phone’s own recorder below.')
      setPhase('nodevice')
    }
  }, [kind])

  useEffect(() => { void open(); return () => { release() } }, [open, release])
  useEffect(() => () => { if (clip) URL.revokeObjectURL(clip.url) }, [clip])

  const stop = useCallback(() => {
    if (rec.current && rec.current.state !== 'inactive') rec.current.stop()
  }, [])

  const start = () => {
    if (!stream.current) return
    const type = pickRecorderType(kind, t => MediaRecorder.isTypeSupported(t))
    chunks.current = []
    const r = new MediaRecorder(stream.current, { ...(type ? { mimeType: type } : {}), ...(kind === 'video' ? { videoBitsPerSecond: 1_500_000 } : { audioBitsPerSecond: 64_000 }) })
    rec.current = r
    r.ondataavailable = e => { if (e.data.size > 0) chunks.current.push(e.data) }
    r.onstop = () => {
      const took = Math.max(1, Math.round((Date.now() - started.current) / 1000))
      const blob = new Blob(chunks.current, { type: baseType(r.mimeType || type) || (kind === 'video' ? 'video/webm' : 'audio/webm') })
      release()
      setClip({ blob, url: URL.createObjectURL(blob), secs: Math.min(took, max) })
      setPhase('review')
    }
    started.current = Date.now(); setSecs(0)
    r.start(1000)
    setPhase('recording')
    timer.current = setInterval(() => {
      const n = Math.round((Date.now() - started.current) / 1000)
      setSecs(n)
      if (n >= max) stop()
    }, 250)
  }

  const retake = () => { if (clip) URL.revokeObjectURL(clip.url); setClip(null); void open() }

  const keep = async (blob: Blob, length: number) => {
    setBusy(true); setError('')
    try { await onUse(blob, length) } catch (e) { setError(e instanceof Error ? e.message : 'That did not save. Try again.') } finally { setBusy(false) }
  }

  const fromFile = (f: File | undefined) => {
    if (!f) return
    // The length of a file from the phone's own recorder is not known here, so it is stored as short and checked by size.
    void keep(f, 0)
  }

  const label = kind === 'video' ? 'video' : 'voice note'
  return (
    <div>
      {kind === 'video' && phase !== 'review' && phase !== 'nodevice' && (
        <video ref={preview} muted playsInline className="aspect-video w-full rounded-md border border-border bg-bg-hover object-cover" aria-label="What the camera sees" />
      )}
      {kind === 'audio' && (phase === 'ready' || phase === 'recording' || phase === 'asking') && (
        <div className="grid h-24 place-items-center rounded-md border border-border bg-bg-base">
          <span className={`inline-grid h-14 w-14 place-items-center rounded-full ${phase === 'recording' ? 'bg-red/[0.14] text-red' : 'bg-bg-hover text-text-secondary'}`}><Icon name="mic" className="h-7 w-7" /></span>
        </div>
      )}

      {phase === 'asking' && <p className="mt-3 text-[0.9375rem] text-text-secondary" role="status">Waiting for the {kind === 'video' ? 'camera' : 'microphone'}…</p>}

      {(phase === 'ready' || phase === 'recording') && (
        <div className="mt-3">
          <p className="num text-center text-[1.5rem] font-bold" role="timer" aria-live="off">{clockText(secs)} <span className="text-[1rem] font-normal text-text-secondary">of {clockText(max)}</span></p>
          {phase === 'ready'
            ? <button type="button" className="btn btn-primary mt-2 w-full" onClick={start}><span className="lamp lamp-red" aria-hidden="true" />Start recording</button>
            : <button type="button" className="btn btn-danger mt-2 w-full" onClick={stop}><Icon name="pause" className="h-5 w-5" />Stop</button>}
          {phase === 'recording' && <p className="mt-2 text-center text-[0.875rem] text-text-secondary">Recording stops by itself at {clockText(max)}.</p>}
        </div>
      )}

      {phase === 'review' && clip && (
        <div>
          {kind === 'video'
            ? <video src={clip.url} controls playsInline className="aspect-video w-full rounded-md border border-border bg-bg-hover" aria-label="Your video" />
            : <audio src={clip.url} controls className="w-full" aria-label="Your voice note" />}
          <p className="num mt-1 text-[0.875rem] text-text-secondary">{clockText(clip.secs)}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-secondary" onClick={retake} disabled={busy}><Icon name="refresh" className="h-5 w-5" />Retake</button>
            <button type="button" className="btn btn-primary" onClick={() => void keep(clip.blob, clip.secs)} disabled={busy}>{busy ? 'Saving…' : `Keep this ${label}`}</button>
          </div>
        </div>
      )}

      {phase === 'nodevice' && (
        <div>
          {error ? <p role="alert" className="form-error">{error}</p> : <p className="text-[0.9375rem] text-text-secondary">This browser cannot record here. Use the phone’s own {kind === 'video' ? 'camera' : 'voice recorder'} instead.</p>}
          <button type="button" className="btn btn-secondary mt-3 w-full" disabled={busy} onClick={() => file.current?.click()}>
            <Icon name={kind === 'video' ? 'video' : 'mic'} className="h-5 w-5" />{busy ? 'Saving…' : kind === 'video' ? 'Open the camera app' : 'Choose a voice recording'}
          </button>
          <input ref={file} type="file" accept={kind === 'video' ? 'video/*' : 'audio/*'} {...(kind === 'video' ? { capture: 'environment' as const } : {})} className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; fromFile(f) }} />
        </div>
      )}

      {error && phase !== 'nodevice' && <p role="alert" className="form-error">{error}</p>}
      <button type="button" className="btn btn-ghost mt-3 w-full" onClick={() => { release(); onCancel() }} disabled={busy}>Cancel</button>
    </div>
  )
}
