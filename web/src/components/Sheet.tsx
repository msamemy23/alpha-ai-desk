'use client'

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Icon from '@/components/Icon'

/**
 * A bottom sheet on phones and a centered dialog on larger screens (the look
 * comes from .modal-overlay / .modal-box in globals.css). Closes on Escape or
 * a tap outside, locks page scroll while open, and returns focus afterward.
 * While `dirty` is true (typed changes not saved) a tap outside does nothing, so a stray touch cannot throw the work away;
 * Escape and the close button still call onClose, where the page asks before discarding.
 */
export default function Sheet({
  open, onClose, title, children, wide = false, hideTitle = false, dirty = false,
}: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean; hideTitle?: boolean; dirty?: boolean }) {
  const boxRef = useRef<HTMLDivElement>(null)
  // Who had focus when the sheet opened, read in the render that opens it: by the time effects run, a field with
  // autoFocus has already taken it, and closing would "return" focus to that field instead of the button that opened the sheet.
  const [wasOpen, setWasOpen] = useState(false)
  const [opener, setOpener] = useState<HTMLElement | null>(null)
  if (open !== wasOpen) {
    setWasOpen(open)
    setOpener(open && typeof document !== 'undefined' ? (document.activeElement as HTMLElement | null) : null)
  }
  // Kept in a ref so a page that passes a new onClose on every render does not re-run the effect below,
  // which would pull focus out of whatever field the person is typing in.
  const closeRef = useRef(onClose)
  useEffect(() => { closeRef.current = onClose })

  useEffect(() => {
    if (!open) return
    const previous = opener
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRef.current() }
    document.addEventListener('keydown', onKey)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // Put focus in the sheet, unless a field inside it already took it (autoFocus runs first), so typing lands in that field.
    if (!boxRef.current?.contains(document.activeElement)) boxRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [open, opener])

  if (!open) return null
  return (
    <div className="modal-overlay" onMouseDown={e => { if (e.target === e.currentTarget && !dirty) onClose() }}>
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
