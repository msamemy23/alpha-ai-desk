'use client'
import { URGENCIES, URGENCY_HELP, URGENCY_WORD, urgencyOf } from '@/lib/dvi'
import type { DviItem, Urgency } from '@/lib/dvi'

/** How soon it should be fixed: three plain choices. The customer sees these words on their page. */
export default function UrgencyPicker({ item, onChange }: { item: DviItem; onChange: (u: Urgency) => void }) {
  const current = urgencyOf(item)
  return (
    <div className="mt-2.5">
      <p className="form-label !mb-1" id={`urg-${item.id}`}>How soon?</p>
      <div role="group" aria-labelledby={`urg-${item.id}`} className="grid grid-cols-3 gap-2 sm:max-w-lg">
        {URGENCIES.map(u => {
          const on = current === u
          return (
            <button key={u} type="button" aria-pressed={on} onClick={() => onChange(u)}
              className={`min-h-[44px] rounded-md border px-1 text-[0.875rem] font-bold leading-tight transition-colors sm:min-h-[40px] ${on ? 'border-blue bg-blue/10 text-blue' : 'border-[rgb(var(--c-line))] bg-bg-card text-text-secondary hover:bg-bg-hover'}`}>
              {URGENCY_WORD[u]}
            </button>
          )
        })}
      </div>
      <p className="mt-1 text-[0.8125rem] text-text-secondary">{URGENCY_HELP[current]}</p>
    </div>
  )
}
