'use client'
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'

// The signature pad is a sheet of paper with dark ink in every theme, so the saved image looks the same on the
// phone, in the signed copy and in the confirmation email. These are the only fixed colours on the page.
const PAD_INK = '#1a1a2e'
export const PAD_PAPER = '#fffffd'
const PAD_RULE = '#a3a8a1'
const PAD_HINT = '#5a6169'
const PAD_WIDTH = 600
const PAD_HEIGHT = 240

export interface SignPadHandle {
  clear: () => void
  /** The drawing as a PNG data address, or an empty string when nothing is drawn. */
  toDataUrl: () => string
  isEmpty: () => boolean
  focus: () => void
}

interface Props {
  invalid?: boolean
  disabled?: boolean
  describedBy?: string
  onInk?: (hasInk: boolean) => void
}

const SignPad = forwardRef<SignPadHandle, Props>(function SignPad({ invalid, disabled, describedBy, onInk }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const drawing = useRef(false)
  const last = useRef<{ x: number; y: number } | null>(null)
  const inked = useRef(false)
  const [hasInk, setHasInk] = useState(false)

  const setInk = (value: boolean) => {
    inked.current = value
    setHasInk(value)
    onInk?.(value)
  }

  useImperativeHandle(ref, () => ({
    clear: () => {
      const canvas = canvasRef.current
      const ctx = canvas?.getContext('2d')
      if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
      setInk(false)
    },
    toDataUrl: () => (inked.current ? canvasRef.current?.toDataURL('image/png') || '' : ''),
    isEmpty: () => !inked.current,
    focus: () => wrapRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
  }))

  const pos = (e: React.PointerEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement) => {
    const rect = canvas.getBoundingClientRect()
    return { x: (e.clientX - rect.left) * (canvas.width / rect.width), y: (e.clientY - rect.top) * (canvas.height / rect.height) }
  }

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas || disabled) return
    e.preventDefault()
    try { canvas.setPointerCapture(e.pointerId) } catch { /* older browsers: drawing still works inside the pad */ }
    drawing.current = true
    last.current = pos(e, canvas)
  }

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    e.preventDefault()
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const p = pos(e, canvas)
    ctx.beginPath()
    ctx.moveTo(last.current?.x ?? p.x, last.current?.y ?? p.y)
    ctx.lineTo(p.x, p.y)
    ctx.strokeStyle = PAD_INK
    ctx.lineWidth = 4
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.stroke()
    last.current = p
    if (!inked.current) setInk(true)
  }

  const end = () => {
    drawing.current = false
    last.current = null
  }

  const clear = () => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    setInk(false)
  }

  return (
    <div ref={wrapRef}>
      <div className="mb-1 flex items-center justify-between gap-3">
        <span id="pad-label" className="text-[0.8125rem] font-bold text-text-secondary">Your signature</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={clear} disabled={!hasInk || disabled}>Clear</button>
      </div>
      <div className={`relative overflow-hidden rounded-md border-2 ${invalid ? 'border-red' : 'border-line'}`} style={{ background: PAD_PAPER }}>
        <canvas
          ref={canvasRef}
          width={PAD_WIDTH}
          height={PAD_HEIGHT}
          role="img"
          aria-labelledby="pad-label"
          aria-describedby={describedBy}
          data-testid="sign-pad"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          className="relative z-10 block w-full cursor-crosshair"
          style={{ aspectRatio: `${PAD_WIDTH} / ${PAD_HEIGHT}`, touchAction: 'none' }}
        />
        {/* The signing line, drawn behind the ink. */}
        <div className="pointer-events-none absolute inset-x-5 bottom-8 border-b-2 border-dashed" style={{ borderColor: PAD_RULE }} aria-hidden="true" />
        {!hasInk && (
          <span className="pointer-events-none absolute inset-x-0 bottom-10 text-center text-[0.9375rem]" aria-hidden="true" style={{ color: PAD_HINT }}>
            Sign here
          </span>
        )}
      </div>
    </div>
  )
})

export default SignPad
