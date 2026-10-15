'use client'

import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import Icon from '@/components/Icon'

/**
 * A bottom sheet on phones and a centered dialog on larger screens (the look
 * comes from .modal-overlay / .modal-box in globals.css). Closes on Escape or
 * a tap outside, locks page scroll while open, and returns focus afterward.
 */
export default function Sheet({
  open, onClose, title, children, wide = false, hideTitle = false,
}: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; hideTitle?: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null)
  // Kept in a ref so a page that passes a new onClose on every render does not re-run the effect below,
  // which would pull focus out of whatever field the person is typing in.
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current() }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    boxRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [open])

  if (!open) return null
  return (
    <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div
        ref={boxRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="modal-box outline-none"
        style={wide ? { maxWidth: 720 } : undefined}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h2 className={`display text-[1.25rem] font-bold leading-7 ${hideTitle ? 'sr-only' : ''}`}>{title}</h2>
          <button type="button" className="btn-close -mr-2 -mt-1 shrink-0" onClick={onClose} aria-label="Close">
            <Icon name="close" className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
