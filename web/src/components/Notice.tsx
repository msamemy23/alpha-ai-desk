import type { ReactNode } from 'react'
import Icon from '@/components/Icon'

type Kind = 'error' | 'success' | 'info' | 'warn'

// An inline message: an icon and words on a soft fill, so colour is never the only signal.
const KINDS: Record<Kind, { icon: string; box: string; tint: string; role: 'alert' | 'status' }> = {
  error: { icon: 'alert', box: 'border-red/50 bg-red/[0.08]', tint: 'text-red', role: 'alert' },
  success: { icon: 'check', box: 'border-green/50 bg-green/[0.10]', tint: 'text-green', role: 'status' },
  info: { icon: 'info', box: 'border-blue/40 bg-blue/[0.08]', tint: 'text-blue', role: 'status' },
  warn: { icon: 'alert', box: 'border-amber/50 bg-amber/[0.10]', tint: 'text-amber', role: 'status' },
}

export default function Notice({
  kind = 'info', children, className = '', id,
}: { kind?: Kind; children: ReactNode; className?: string; id?: string }) {
  const k = KINDS[kind]
  return (
    <div id={id} role={k.role} className={`flex items-start gap-2.5 rounded-md border px-3 py-2.5 text-[0.9375rem] leading-snug text-text-primary ${k.box} ${className}`}>
      <Icon name={k.icon} className={`mt-0.5 h-5 w-5 shrink-0 ${k.tint}`} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
