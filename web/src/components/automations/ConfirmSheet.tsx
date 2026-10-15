'use client'
import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import Sheet from '@/components/Sheet'
import Notice from '@/components/Notice'

interface Props {
  title: string
  children: ReactNode
  confirmLabel: string
  busyLabel: string
  danger?: boolean
  onClose: () => void
  /** Returns an empty string when it worked, or the reason it did not. */
  onConfirm: () => Promise<string>
}

/** A yes-or-no question that says what will happen, and keeps the answer on screen if it fails. */
export default function ConfirmSheet({ title, children, confirmLabel, busyLabel, danger, onClose, onConfirm }: Props) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const go = async () => {
    if (busy.current) return
    busy.current = true
    setWorking(true)
    const reason = await onConfirm()
    busy.current = false
    setWorking(false)
    if (reason) setError(reason)
    else onClose()
  }
  return (
    <Sheet open onClose={() => { if (!working) onClose() }} title={title}>
      <div className="space-y-3 text-[0.9375rem]">{children}</div>
      {error && <Notice kind="error" className="mt-3">{error}</Notice>}
      <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={working}>Cancel</button>
        <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={go} disabled={working} aria-busy={working}>{working ? busyLabel : confirmLabel}</button>
      </div>
    </Sheet>
  )
}
