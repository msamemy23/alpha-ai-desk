'use client'
import Icon from '@/components/Icon'
import { Switch } from '@/components/ScreenParts'
import type { Lamp } from './types'

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** How long ago, in words. */
export function ago(iso: string | null | undefined): string {
  if (!iso) return 'never'
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return 'a while ago'
  const mins = Math.floor((Date.now() - t) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  if (mins < 1440) return `${Math.floor(mins / 60)} hr ago`
  const days = Math.floor(mins / 1440)
  if (days < 7) return days === 1 ? 'yesterday' : `${days} days ago`
  return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** "Daily at 6pm" is only a label: the server looks once a day. Say what actually happens. */
export function cadence(schedule: string): string {
  const weekly = schedule.match(/^weekly on (\w+)/i)
  if (weekly) return `Once a week, on ${weekly[1]}s`
  if (/^daily/i.test(schedule)) return 'Once a day'
  return schedule
}

export function OnOff({ enabled, name, onChange, disabled }: { enabled: boolean; name: string; onChange: (next: boolean) => void; disabled?: boolean }) {
  return (
    <div className="-mr-1 flex shrink-0 flex-col items-center">
      <Switch checked={enabled} onChange={onChange} label={name} disabled={disabled} />
      <span className="-mt-1 text-[0.8125rem] font-bold text-text-secondary" aria-hidden="true">{enabled ? 'On' : 'Paused'}</span>
    </div>
  )
}

export function Fact({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2 text-text-secondary">
      <Icon name={icon} className="mt-[0.2rem] h-4 w-4 shrink-0" />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  )
}

export function Status({ lamp, children }: { lamp: Lamp; children: React.ReactNode }) {
  return (
    <p className="flex items-start gap-2">
      <span className={`lamp lamp-${lamp} mt-[0.4rem]`} aria-hidden="true" />
      <span className="min-w-0 break-words">{children}</span>
    </p>
  )
}
