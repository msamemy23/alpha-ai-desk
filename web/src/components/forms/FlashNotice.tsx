'use client'
import Icon from '@/components/Icon'

export interface Flash {
  kind: 'success' | 'error'
  text: string
  /** One follow-up button, for example Undo. */
  action?: { label: string; run: () => void }
}

/** A message after something was saved, undone or failed. Says it in words and an icon, and goes away when dismissed. */
export default function FlashNotice({ flash, onDismiss, className = 'mb-4' }: { flash: Flash; onDismiss: () => void; className?: string }) {
  const bad = flash.kind === 'error'
  return (
    <div
      role={bad ? 'alert' : 'status'}
      className={`flex items-start gap-2 rounded-md border py-1.5 pl-4 pr-1 text-[0.9375rem] ${bad ? 'border-red/50 bg-red/[0.08]' : 'border-green/40 bg-bg-card'} ${className}`}
    >
      <Icon name={bad ? 'alert' : 'check'} className={`mt-[0.5625rem] h-5 w-5 shrink-0 ${bad ? 'text-red' : 'text-green'}`} />
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2 py-2">
        <p className="min-w-0 flex-1 basis-48 break-words">{flash.text}</p>
        {flash.action && <button type="button" className="btn btn-secondary" onClick={() => { const a = flash.action; onDismiss(); a?.run() }}>{flash.action.label}</button>}
      </div>
      <button type="button" className="btn-icon shrink-0" onClick={onDismiss} aria-label="Dismiss message"><Icon name="close" className="h-5 w-5" /></button>
    </div>
  )
}
