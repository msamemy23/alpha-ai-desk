'use client'
import { useId } from 'react'
import { PLATFORM_LABEL, POST_PLATFORMS } from '@/lib/posts-rules'
import type { Connection, PostPlatform } from '@/lib/posts-rules'

const WORD: Record<Connection, { lamp: 'green' | 'amber' | 'off'; word: string }> = {
  connected: { lamp: 'green', word: 'Connected' },
  not_connected: { lamp: 'amber', word: 'Not connected' },
  unknown: { lamp: 'off', word: 'Could not check' },
}

interface Props {
  value: PostPlatform[]
  onChange: (next: PostPlatform[]) => void
  connections: Record<PostPlatform, Connection>
  disabled?: boolean
  legend?: string
}

/** Where a post goes. Every place says in words whether it is connected, and an unconnected one links to Connected apps. */
export default function PlacesPicker({ value, onChange, connections, disabled = false, legend = 'Where posts go' }: Props) {
  const base = useId()
  const toggle = (p: PostPlatform, on: boolean) => onChange(POST_PLATFORMS.filter(x => (x === p ? on : value.includes(x))))
  return (
    <fieldset disabled={disabled} className="min-w-0 border-0 p-0">
      <legend className="form-label">{legend}</legend>
      <ul className="border-t border-border">
        {POST_PLATFORMS.map(p => {
          const c = WORD[connections[p] ?? 'unknown']
          return (
            <li key={p} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0 border-b border-border">
              <label htmlFor={`${base}-${p}`} className="flex min-h-[44px] items-center gap-2.5">
                <input id={`${base}-${p}`} type="checkbox" className="h-5 w-5 shrink-0 accent-[rgb(var(--c-blue))]" checked={value.includes(p)} onChange={e => toggle(p, e.target.checked)} />
                <span className="font-bold">{PLATFORM_LABEL[p]}</span>
              </label>
              <span className="flex min-h-[44px] items-center gap-2 text-[0.875rem] text-text-secondary">
                <span className={`lamp lamp-${c.lamp}`} aria-hidden="true" />
                {c.word}
                {connections[p] === 'not_connected' && <a href="/connectors" className="inline-flex min-h-[44px] items-center font-bold text-blue">Open Connected apps</a>}
              </span>
            </li>
          )
        })}
      </ul>
    </fieldset>
  )
}
