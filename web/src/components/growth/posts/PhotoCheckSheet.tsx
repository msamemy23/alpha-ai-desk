'use client'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { PointerEvent } from 'react'
import Icon from '@/components/Icon'
import { ErrorCard } from '@/components/ListKit'
import Notice from '@/components/Notice'
import Sheet from '@/components/Sheet'
import { boxFromDrag, fitSize, stripBox } from '@/lib/posts-cover'
import type { Box } from '@/lib/posts-cover'
import { uploadChecked } from './postsApi'
import type { Done } from './postsApi'

export interface CheckedPhoto { path: string; url: string; covered: boolean }

interface Props {
  title: string
  /** For a run of photos: "Photo 2 of 5". */
  progress?: string
  /** Gets the picture. Called once when the sheet opens. */
  load: () => Promise<Done<Blob>>
  /** Where the checked copy is recorded. A photo from a job carries the job and the inspection photo it came from. */
  meta: { jobId?: string; ref?: string; label: string }
  saveLabel?: string
  onSaved: (photo: CheckedPhoto) => void
  /** Leave this photo out of the post. */
  onSkip?: () => void
  onClose: () => void
}

// The boxes and the white behind a see-through picture are painted into the photo itself, so they are plain pixel values, not screen colours.
const COVER_FILL = 'rgb(0, 0, 0)'
const BACKDROP_FILL = 'rgb(255, 255, 255)'

/**
 * The owner looks at one photo, covers anything private with solid boxes, and confirms. The photo is redrawn on a canvas, which drops
 * location and camera details, and the canvas (boxes included) is what gets saved. Alpha cannot find plates or VINs by itself.
 */
export default function PhotoCheckSheet({ title, progress, load, meta, saveLabel = 'Save and use this photo', onSaved, onSkip, onClose }: Props) {
  const base = useId()
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const loader = useRef(load)
  const start = useRef<{ x: number; y: number } | null>(null)
  const saving = useRef(false)
  const [attempt, setAttempt] = useState(0)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [loadError, setLoadError] = useState('')
  const [boxes, setBoxes] = useState<Box[]>([])
  const [live, setLive] = useState<Box | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    let url = ''
    void (async () => {
      const got = await loader.current()
      if (cancelled) return
      if (!got.ok) { setLoadError(got.error); return }
      url = URL.createObjectURL(got.data)
      const el = new Image()
      el.onload = () => { if (!cancelled && el.naturalWidth > 0 && el.naturalHeight > 0) setImg(el); else if (!cancelled) setLoadError('That photo could not be read. Try a JPG or PNG, or take the photo again.') }
      el.onerror = () => { if (!cancelled) setLoadError('That photo could not be read. Try a JPG or PNG, or take the photo again.') }
      el.src = url
    })()
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [attempt])

  const size = img ? fitSize(img.naturalWidth, img.naturalHeight) : null

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !img) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingQuality = 'high'
    ctx.fillStyle = BACKDROP_FILL
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    ctx.fillStyle = COVER_FILL
    for (const b of live ? [...boxes, live] : boxes) ctx.fillRect(b.x, b.y, b.w, b.h)
  }, [img, boxes, live])

  const changed = useCallback((next: Box[]) => { setBoxes(next); setConfirmed(false); setError('') }, [])

  const point = (e: PointerEvent<HTMLCanvasElement>): { x: number; y: number } => {
    const c = e.currentTarget
    const r = c.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / Math.max(1, r.width)) * c.width, y: ((e.clientY - r.top) / Math.max(1, r.height)) * c.height }
  }
  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    if (saving.current) return
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* a pointer that cannot be captured still draws */ }
    const p = point(e)
    start.current = p
    setLive({ x: p.x, y: p.y, w: 0, h: 0 })
  }
  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const s = start.current
    if (!s) return
    const c = e.currentTarget
    const p = point(e)
    setLive(boxFromDrag(s.x, s.y, p.x, p.y, c.width, c.height, 0))
  }
  const up = (e: PointerEvent<HTMLCanvasElement>) => {
    const s = start.current
    start.current = null
    setLive(null)
    if (!s) return
    const c = e.currentTarget
    const p = point(e)
    const box = boxFromDrag(s.x, s.y, p.x, p.y, c.width, c.height)
    if (box) changed([...boxes, box])
  }
  const cancel = () => { start.current = null; setLive(null) }

  const save = async () => {
    if (saving.current || !img || !confirmed) return
    const canvas = canvasRef.current
    if (!canvas) return
    saving.current = true; setBusy(true); setError('')
    try {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85))
      if (!blob) { setError('This browser could not prepare the photo. Try again.'); return }
      const covered = boxes.length > 0
      const r = await uploadChecked(blob, { ...meta, covered })
      if (!r.ok) { setError(r.error); return }
      onSaved({ path: r.data.path, url: r.data.url, covered })
    } finally { saving.current = false; setBusy(false) }
  }

  const strips: Array<{ key: 'top' | 'middle' | 'bottom'; label: string }> = [{ key: 'top', label: 'Cover the top third' }, { key: 'middle', label: 'Cover the middle third' }, { key: 'bottom', label: 'Cover the bottom third' }]

  return (
    <Sheet open onClose={() => { if (!busy) onClose() }} title={title} wide dirty={boxes.length > 0 || confirmed}>
      <div className="space-y-4 text-[0.9375rem]">
        {progress && <p className="font-bold text-text-secondary">{progress}</p>}
        <h3 className="section-title">Cover plate or VIN</h3>
        <Notice kind="warn" id={`${base}-say`}>
          <p className="font-bold">Alpha cannot find license plates or VINs by itself. You have to look.</p>
          <p className="mt-1">Drag your finger or mouse across any plate, VIN, name, address or phone number to cover it with a solid box. Location and camera details are removed from the photo when it is saved.</p>
        </Notice>

        {loadError ? (
          <ErrorCard title="This photo did not load" message={loadError} onRetry={() => { setLoadError(''); setImg(null); setAttempt(a => a + 1) }} />
        ) : !img || !size ? (
          <div className="skeleton h-64" role="status" aria-busy="true" aria-label="Loading the photo" />
        ) : (
          <>
            <div className="overflow-hidden rounded-md border border-border bg-bg-hover">
              <canvas
                ref={canvasRef}
                width={size.width}
                height={size.height}
                role="img"
                aria-label={`The photo. ${boxes.length === 0 ? 'Nothing is covered.' : `${boxes.length} ${boxes.length === 1 ? 'box covers' : 'boxes cover'} part of it.`}`}
                aria-describedby={`${base}-say`}
                className="block h-auto w-full cursor-crosshair"
                style={{ touchAction: 'none' }}
                onPointerDown={down}
                onPointerMove={move}
                onPointerUp={up}
                onPointerCancel={cancel}
              />
            </div>
            <p className="form-hint" aria-live="polite">{boxes.length === 0 ? 'Nothing is covered yet.' : `${boxes.length} ${boxes.length === 1 ? 'box' : 'boxes'} on the photo.`}</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-secondary" disabled={boxes.length === 0 || busy} onClick={() => changed(boxes.slice(0, -1))}><Icon name="undo" className="h-5 w-5" />Undo last box</button>
              <button type="button" className="btn btn-secondary" disabled={boxes.length === 0 || busy} onClick={() => changed([])}>Remove all boxes</button>
            </div>
            <div>
              <p className="form-label">Cannot drag? Cover a band across the whole photo</p>
              <div className="flex flex-wrap gap-2">
                {strips.map(s => (
                  <button key={s.key} type="button" className="btn btn-secondary" disabled={busy} onClick={() => changed([...boxes, stripBox(s.key, size.width, size.height)])}>{s.label}</button>
                ))}
              </div>
            </div>
            <label className="flex min-h-[44px] items-start gap-2.5">
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--c-blue))]" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)} />
              <span>I looked at this photo myself. Any license plate, VIN, name, address or phone number is covered, or there is none in it.</span>
            </label>
          </>
        )}

        {error && <Notice kind="error">{error}</Notice>}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>Close</button>
          {onSkip && <button type="button" className="btn btn-secondary" onClick={onSkip} disabled={busy}>Leave this photo out</button>}
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || !img || !confirmed} aria-busy={busy}>
            <Icon name="check" className="h-5 w-5" />{busy ? 'Saving…' : saveLabel}
          </button>
        </div>
      </div>
    </Sheet>
  )
}
