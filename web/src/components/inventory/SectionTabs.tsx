'use client'

export interface SectionTab<T extends string> { value: T; label: string; count?: number }

/** The sections of the Inventory screen as underlined tabs. Arrow keys, Home and End move between them, as a screen reader user expects. */
export default function SectionTabs<T extends string>({ label, tabs, value, onChange }: { label: string; tabs: SectionTab<T>[]; value: T; onChange: (v: T) => void }) {
  const move = (to: number) => {
    const next = tabs[(to + tabs.length) % tabs.length]
    onChange(next.value)
    requestAnimationFrame(() => document.getElementById(`inv-tab-${next.value}`)?.focus())
  }
  return (
    <div role="tablist" aria-label={label} className="-mx-4 mb-4 flex overflow-x-auto border-b border-border pl-2 pr-4 sm:mx-0 sm:gap-1 sm:px-0">
      {tabs.map((t, i) => {
        const on = t.value === value
        return (
          <button
            key={t.value}
            id={`inv-tab-${t.value}`}
            type="button"
            role="tab"
            aria-selected={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.value)}
            onKeyDown={e => {
              if (e.key === 'ArrowRight') { e.preventDefault(); move(i + 1) }
              else if (e.key === 'ArrowLeft') { e.preventDefault(); move(i - 1) }
              else if (e.key === 'Home') { e.preventDefault(); move(0) }
              else if (e.key === 'End') { e.preventDefault(); move(tabs.length - 1) }
            }}
            className={`-mb-px inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap border-b-[3px] px-2 text-[1rem] font-bold transition-colors sm:px-5 ${on ? 'border-blue text-blue' : 'border-transparent text-text-secondary hover:text-text-primary'}`}
          >
            {t.label}
            {t.count !== undefined && <span className={`num text-[0.875rem] font-normal ${on ? 'text-blue' : 'text-text-secondary'}`}>{t.count}</span>}
          </button>
        )
      })}
    </div>
  )
}
