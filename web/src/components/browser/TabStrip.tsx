'use client'
import { useRef } from 'react'
import type { KeyboardEvent } from 'react'
import Icon from '@/components/Icon'
import { tabName } from './tabs'
import type { Tab } from './tabs'

/** The open tabs, kept in memory while this screen is open. One tab can be closed and replaced by a fresh one. */
export default function TabStrip({
  tabs, activeId, onSelect, onClose, onNew,
}: { tabs: Tab[]; activeId: string; onSelect: (id: string) => void; onClose: (id: string) => void; onNew: () => void }) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const move = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next = index
    if (e.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (e.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = tabs.length - 1
    else return
    e.preventDefault()
    const id = tabs[next].id
    onSelect(id)
    refs.current[id]?.focus()
  }
  return (
    <div className="flex items-center gap-1">
      <div role="tablist" aria-label="Open tabs" className="flex min-w-0 flex-1 gap-1 overflow-x-auto py-0.5">
        {tabs.map((t, i) => {
          const on = t.id === activeId
          const name = tabName(t)
          return (
            <div key={t.id} role="presentation" className={`flex shrink-0 items-center rounded-md border ${on ? 'border-blue bg-blue/10' : 'border-[rgb(var(--c-line))] bg-bg-card'}`}>
              <button
                ref={el => { refs.current[t.id] = el }}
                type="button"
                role="tab"
                id={`browser-tab-${t.id}`}
                aria-selected={on}
                aria-controls="browser-panel"
                tabIndex={on ? 0 : -1}
                title={name}
                onClick={() => onSelect(t.id)}
                onKeyDown={e => move(e, i)}
                className={`min-h-[44px] max-w-[9.5rem] truncate pl-3 pr-1 text-left text-[0.9375rem] font-bold sm:min-h-[40px] ${on ? 'text-blue' : 'text-text-primary'}`}
              >
                {name}
              </button>
              <button type="button" className="btn-icon shrink-0" aria-label={`Close tab: ${name}`} onClick={() => onClose(t.id)}>
                <Icon name="close" className="h-4 w-4" />
              </button>
            </div>
          )
        })}
      </div>
      <button type="button" className="btn-icon shrink-0 border-[rgb(var(--c-line))]" aria-label="New tab" onClick={onNew}>
        <Icon name="plus" className="h-5 w-5" />
      </button>
    </div>
  )
}
