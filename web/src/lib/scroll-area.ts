// Scrolls a page's own scroll area, never the browser window.
//
// In the app shell the top bar and the side rail stay put and `main#main` is the one box that scrolls.
// `element.scrollIntoView()` walks up and scrolls every scrollable ancestor it finds, so on a phone it can
// also slide the document under the top bar. These helpers move only the nearest scrolling ancestor.

type Box = { top: number }
type Style = { overflowY: string; scrollMarginTop?: string }
interface Scrollable { parentElement: Scrollable | null; scrollTop: number; scrollTo(options: { top: number; behavior?: ScrollBehavior }): void; getBoundingClientRect(): Box }

/** Where the scroller's scrollTop must be to put `target` at the top of the scroller, keeping `margin` px above it. */
export function scrollTopFor(scroller: Box, scrollTop: number, target: Box, margin = 0): number {
  return Math.max(0, Math.round(scrollTop + (target.top - scroller.top) - margin))
}

const SCROLLS = new Set(['auto', 'scroll', 'overlay'])

/** The nearest ancestor that scrolls up and down. `overflow: hidden` boxes (the shell root, a chat page) do not count. */
export function scrollerOf(el: Scrollable, styleOf: (e: Scrollable) => Style): Scrollable | null {
  for (let p = el.parentElement; p; p = p.parentElement) {
    if (SCROLLS.has(styleOf(p).overflowY)) return p
  }
  return null
}

/** Brings `el` to the top of its scroll area. Does nothing when no ancestor scrolls, so it can never move the window. */
export function scrollToTopOfArea(el: Element | null | undefined, options: { behavior?: ScrollBehavior } = {}, styleOf: (e: Scrollable) => Style = (e) => getComputedStyle(e as unknown as Element)): void {
  if (!el) return
  const target = el as unknown as Scrollable
  const area = scrollerOf(target, styleOf)
  if (!area) return
  const margin = parseFloat(styleOf(target).scrollMarginTop || '') || 0
  area.scrollTo({ top: scrollTopFor(area.getBoundingClientRect(), area.scrollTop, target.getBoundingClientRect(), margin), behavior: options.behavior })
}
