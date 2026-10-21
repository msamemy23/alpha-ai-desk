'use client'
import type { JumpChip } from '@/lib/shopboard'
import { scrollToTopOfArea } from '@/lib/scroll-area'

/**
 * On a phone the technician columns stack into one long scroll. These chips sit above them, one per column,
 * and a tap takes you straight to that person's cars.
 */
export default function JumpChips({ chips }: { chips: JumpChip[] }) {
  if (chips.length < 2) return null
  const go = (id: string) => {
    const el = document.getElementById(id)
    if (!el) return
    const calm = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // Only the page's own scroll area moves, so the top bar stays where it is.
    scrollToTopOfArea(el, { behavior: calm ? 'auto' : 'smooth' })
    el.focus({ preventScroll: true })
  }
  return (
    <nav aria-label="Jump to a technician" className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1 lg:hidden">
      {chips.map(c => (
        <button
          key={c.id}
          type="button"
          onClick={() => go(c.id)}
          aria-label={`${c.label}, ${c.count} ${c.count === 1 ? 'car' : 'cars'}. Go to this column`}
          className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-[rgb(var(--c-line))] bg-bg-card px-4 text-[0.9375rem] font-bold leading-tight text-text-primary transition-colors hover:bg-bg-hover"
        >
          {c.label}
          <span className="num font-normal text-text-secondary">{c.count}</span>
        </button>
      ))}
    </nav>
  )
}
