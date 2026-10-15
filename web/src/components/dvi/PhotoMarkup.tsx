'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import Icon from '@/components/Icon'

type Tool = 'pen' | 'arrow' | 'circle'
type Pt = { x: number; y: number }
type Stroke = { tool: Tool; pts: Pt[] }

const TOOLS: { key: Tool; label: string; icon: string }[] = [
  { key: 'pen', label: 'Draw', icon: 'pen' },
  { key: 'arrow', label: 'Arrow', icon: 'arrowUpRight' },
  { key: 'circle', label: 'Circle', icon: 'circle' },
]

/** The marking colour follows the theme's red, so it reads on a dark or a bright photo. */
function markColor(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--c-red').trim().replace(/\s+/g, ',')
  return v ? `rgb(${v})` : 'rgb(176,34,28)'
}

function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, width: number, color: string) {
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'
  const a = s.pts[0], b = s.pts[s.pts.length - 1]
  if (!a || !b) return
  ctx.beginPath()
  if (s.tool === 'pen') {
    ctx.moveTo(a.x, a.y)
    for (const p of s.pts.slice(1)) ctx.lineTo(p.x, p.y)
    if (s.pts.length === 1) ctx.lineTo(a.x + 0.1, a.y)
    ctx.stroke()
  } else if (s.tool === 'circle') {
    const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2
    ctx.ellipse(cx, cy, Math.max(2, Math.abs(b.x - a.x) / 2), Math.max(2, Math.abs(b.y - a.y) / 2), 0, 0, Math.PI * 2)
    ctx.stroke()
  } else {
    const ang = Math.atan2(b.y - a.y, b.x - a.x)
    const head = width * 5
    ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(b.x, b.y)
    ctx.lineTo(b.x - head * Math.cos(ang - Math.PI / 6), b.y - head * Math.sin(ang - Math.PI / 6))
    ctx.lineTo(b.x - head * Math.cos(ang + Math.PI / 6), b.y - head * Math.sin(ang + Math.PI / 6))
    ctx.closePath(); ctx.fill()
  }
}

/** Draw on a photo: freehand, an arrow, or a circle around the problem. Undo removes the last mark. */
export default function PhotoMarkup({ src, onSave, onCancel }: { src: string; onSave: (blob: Blob) => Promise<void>; onCancel: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const img = useRef<HTMLImageElement | null>(null)
  const strokes = useRef<Stroke[]>([])
  const live = useRef<Stroke | null>(null)
  const [tool, setTool] = useState<Tool>('pen')
  const [marks, setMarks] = useState(0)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const paint = useCallback(() => {
    const c = canvas.current, im = img.current
    if (!c || !im) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.drawImage(im, 0, 0, c.width, c.height)
    const color = markColor()
    const width = Math.max(4, c.width / 140)
    for (const s of strokes.current) drawStroke(ctx, s, width, color)
    if (live.current) drawStroke(ctx, live.current, width, color)
  }, [])

  useEffect(() => {
    const el = new Image()
    el.crossOrigin = 'anonymous'
    el.onload = () => {
      img.current = el
      const c = canvas.current
      if (!c) return
      const scale = Math.min(1, 1600 / Math.max(el.naturalWidth, el.naturalHeight))
      c.width = Math.max(1, Math.round(el.naturalWidth * scale)); c.height = Math.max(1, Math.round(el.naturalHeight * scale))
      setState('ready'); paint()
    }
    el.onerror = () => setState('error')
    el.src = src
  }, [src, paint])

  const at = (e: React.PointerEvent<HTMLCanvasElement>): Pt => {
    const c = canvas.current as HTMLCanvasElement
    const r = c.getBoundingClientRect()
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height }
  }
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    live.current = { tool, pts: [at(e)] }; paint()
  }
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const s = live.current
    if (!s) return
    const p = at(e)
    s.pts = s.tool === 'pen' ? [...s.pts, p] : [s.pts[0], p]
    paint()
  }
  const up = () => {
    const s = live.current
    live.current = null
    if (s) { strokes.current = [...strokes.current, s]; setMarks(strokes.current.length) }
    paint()
  }
  const undo = () => { strokes.current = strokes.current.slice(0, -1); setMarks(strokes.current.length); paint() }

  const save = async () => {
    const c = canvas.current
    if (!c) return
    setBusy(true); setError('')
    try {
      const blob = await new Promise<Blob | null>((res, rej) => { try { c.toBlob(res, 'image/jpeg', 0.85) } catch (e) { rej(e) } })
      if (!blob) throw new Error('empty')
      await onSave(blob)
    } catch {
      setError('This photo could not be saved with the marks. Take the photo again, then mark it up.')
    } finally { setBusy(false) }
  }

  return (
    <div>
      <div role="group" aria-label="Marking tool" className="mb-2 grid grid-cols-3 gap-2">
        {TOOLS.map(t => (
          <button key={t.key} type="button" aria-pressed={tool === t.key} onClick={() => setTool(t.key)}
            className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-md border px-2 text-[0.9375rem] font-bold ${tool === t.key ? 'border-blue bg-blue/10 text-blue' : 'border-[rgb(var(--c-line))] bg-bg-card hover:bg-bg-hover'}`}>
            <Icon name={t.icon} className="h-5 w-5" />{t.label}
          </button>
        ))}
      </div>
      {state === 'error' ? (
        <p role="alert" className="form-error">This photo could not be opened for marking. Take it again, then mark it up.</p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-bg-hover">
          <canvas ref={canvas} className="block h-auto max-h-[60vh] w-full touch-none object-contain" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} aria-label="The photo. Draw on it with your finger." />
        </div>
      )}
      {state === 'loading' && <div className="skeleton mt-2 h-10" aria-label="Opening the photo" />}
      {error && <p role="alert" className="form-error">{error}</p>}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button type="button" className="btn btn-secondary" onClick={undo} disabled={marks === 0 || busy}><Icon name="undo" className="h-5 w-5" />Undo</button>
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={marks === 0 || busy || state !== 'ready'}>{busy ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  )
}
