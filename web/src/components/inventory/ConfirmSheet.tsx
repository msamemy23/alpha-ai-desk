'use client'
import type { ReactNode } from 'react'
import Sheet from '@/components/Sheet'

/**
 * A plain "are you sure" step, used before anything is deleted or thrown away.
 * It names what will happen, offers the safe choice first on a phone, and shows why a delete failed.
 */
export default function ConfirmSheet({
  open, title, children, confirmLabel, busyLabel, cancelLabel = 'Keep it', danger = true, busy = false, error = '', onConfirm, onCancel,
}: {
  open: boolean
  title: string
  children: ReactNode
  confirmLabel: string
  busyLabel?: string
  cancelLabel?: string
  danger?: boolean
  busy?: boolean
  error?: string
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <Sheet open={open} onClose={() => { if (!busy) onCancel() }} title={title}>
      <div className="text-[0.9375rem] leading-relaxed text-text-primary">{children}</div>
      {error && <p role="alert" className="form-error !text-[0.875rem]">{error}</p>}
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>{cancelLabel}</button>
        <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>{busy ? busyLabel || 'Working…' : confirmLabel}</button>
      </div>
    </Sheet>
  )
}
