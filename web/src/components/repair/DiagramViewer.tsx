'use client'
import { useEffect, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import { proxiedImage } from '@/lib/repair-ui'
import { ExternalLink, imageMat } from './parts'

export interface DiagramImage { url: string; alt: string }

const alt = (image: DiagramImage) => image.alt?.trim() || 'Manual diagram'

/** A small preview of a manual diagram. Tap it to open the viewer. */
export function DiagramThumb({ image, onOpen, tall = false }: { image: DiagramImage; onOpen: (image: DiagramImage) => void; tall?: boolean }) {
  const [failed, setFailed] = useState(false)
  return (
    <button
      type="button"
      onClick={() => onOpen(image)}
      aria-label={`View diagram: ${alt(image)}`}
      className="block w-full overflow-hidden rounded-md border border-[rgb(var(--c-line))] bg-bg-card text-left transition-colors hover:border-blue"
    >
      <span className="block p-1" style={imageMat}>
        {failed ? (
          <span className="grid h-32 place-items-center px-2 text-center text-[0.875rem]">Preview did not load. Tap to try the viewer.</span>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- manual images come through our own proxy, so next/image has nothing to optimize
          <img src={proxiedImage(image.url)} alt="" loading="lazy" className={`w-full object-contain ${tall ? 'h-40' : 'h-32'}`} onError={() => setFailed(true)} />
        )}
      </span>
      <span className="block truncate border-t border-border px-2.5 py-2 text-[0.875rem] text-text-secondary">{alt(image)}</span>
    </button>
  )
}

const STEP = 0.25, MIN = 0.5, MAX = 4

/** A full-size diagram that can be zoomed and scrolled. Escape closes it, and focus returns to what opened it. */
export function DiagramViewer({ image, bookmarked, onToggleBookmark, onClose }: { image: DiagramImage; bookmarked: boolean; onToggleBookmark: () => void; onClose: () => void }) {
  const [scale, setScale] = useState(1)
  const [failed, setFailed] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })

  const zoom = (delta: number) => setScale(s => Math.min(MAX, Math.max(MIN, Math.round((s + delta) * 100) / 100)))

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current()
      else if (e.key === '+' || e.key === '=') setScale(s => Math.min(MAX, Math.round((s + STEP) * 100) / 100))
      else if (e.key === '-') setScale(s => Math.max(MIN, Math.round((s - STEP) * 100) / 100))
    }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    boxRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [])

  return (
    <div className="modal-overlay" style={{ zIndex: 70 }} onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div
        ref={boxRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Diagram viewer"
        className="modal-box flex flex-col outline-none"
        style={{ maxWidth: 1100, height: '92dvh', overflow: 'hidden' }}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="display text-[1.25rem] font-bold leading-7">Diagram</h2>
            <p className="break-words text-text-secondary">{alt(image)}</p>
          </div>
          <button type="button" className="btn-close -mr-2 -mt-1 shrink-0" onClick={onClose} aria-label="Close diagram viewer">
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>
        <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Diagram controls">
          <button type="button" className="btn btn-secondary" onClick={() => zoom(-STEP)} disabled={scale <= MIN}><Icon name="stepMinus" className="h-4 w-4" />Zoom out</button>
          <button type="button" className="btn btn-secondary" onClick={() => zoom(STEP)} disabled={scale >= MAX}><Icon name="plus" className="h-4 w-4" />Zoom in</button>
          <button type="button" className="btn btn-ghost num" onClick={() => setScale(1)} aria-label={`Zoom is ${Math.round(scale * 100)} percent. Fit to screen.`}>{Math.round(scale * 100)}%</button>
          <button type="button" className="btn btn-secondary" onClick={onToggleBookmark} aria-pressed={bookmarked}>
            <Icon name={bookmarked ? 'check' : 'star'} className="h-4 w-4" />{bookmarked ? 'Bookmarked' : 'Bookmark'}
          </button>
          <ExternalLink url={image.url}>Open original</ExternalLink>
        </div>
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border" style={imageMat} tabIndex={0} role="region" aria-label="Diagram. Scroll to move around when zoomed in.">
          {failed ? (
            <p className="grid h-full min-h-[10rem] place-items-center p-6 text-center">This diagram did not load. Use Open original to see it on the manual site.</p>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- manual images come through our own proxy, so next/image has nothing to optimize
            <img src={proxiedImage(image.url)} alt={alt(image)} className="block h-auto" style={{ width: `${scale * 100}%`, maxWidth: 'none' }} onError={() => setFailed(true)} />
          )}
        </div>
      </div>
    </div>
  )
}
