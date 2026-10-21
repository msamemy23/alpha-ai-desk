import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { scrollTopFor, scrollerOf, scrollToTopOfArea } from '../src/lib/scroll-area.ts'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

// A tiny stand-in for the app shell: root (overflow hidden) > column > main (scrolls) > page > results.
function shell({ mainScrollTop = 0, mainTop = 56, resultsTop = 700, margin = '12px' } = {}) {
  const calls = []
  const make = (name, extra = {}) => ({ name, parentElement: null, scrollTop: 0, getBoundingClientRect: () => ({ top: 0 }), scrollTo: (o) => calls.push({ name, ...o }), ...extra })
  const root = make('root')
  const column = make('column', { parentElement: root })
  const main = make('main', { parentElement: column, scrollTop: mainScrollTop, getBoundingClientRect: () => ({ top: mainTop }) })
  const page = make('page', { parentElement: main })
  const results = make('results', { parentElement: page, getBoundingClientRect: () => ({ top: resultsTop }) })
  const styles = { root: { overflowY: 'hidden' }, column: { overflowY: 'visible' }, main: { overflowY: 'auto' }, page: { overflowY: 'visible' }, results: { overflowY: 'visible', scrollMarginTop: margin } }
  return { results, main, root, calls, styleOf: (e) => styles[e.name] }
}

test('scrollTopFor puts the target at the top of the scroller, minus the margin, never below zero', () => {
  assert.equal(scrollTopFor({ top: 56 }, 0, { top: 700 }, 0), 644)
  assert.equal(scrollTopFor({ top: 56 }, 300, { top: 400 }, 12), 632)
  assert.equal(scrollTopFor({ top: 56 }, 0, { top: 60 }, 40), 0)
  assert.equal(scrollTopFor({ top: 56 }, 10, { top: 56.4 }, 0), 10)
})

test('the scroller is the nearest ancestor that scrolls; an overflow-hidden shell root is skipped', () => {
  const s = shell()
  assert.equal(scrollerOf(s.results, s.styleOf).name, 'main')
  const noScroller = shell()
  assert.equal(scrollerOf(noScroller.main, noScroller.styleOf), null)
})

test('scrolling a result into view moves only the page scroll area, never the window or the shell root', () => {
  const s = shell({ mainScrollTop: 0, mainTop: 56, resultsTop: 700, margin: '12px' })
  const windowCalls = []
  globalThis.window = { scrollTo: (...a) => windowCalls.push(a), scrollBy: (...a) => windowCalls.push(a) }
  try {
    scrollToTopOfArea(s.results, { behavior: 'smooth' }, s.styleOf)
  } finally {
    delete globalThis.window
  }
  assert.deepEqual(s.calls, [{ name: 'main', top: 632, behavior: 'smooth' }])
  assert.deepEqual(windowCalls, [])
})

test('with no scrolling ancestor, or no element, nothing moves', () => {
  const s = shell()
  scrollToTopOfArea(s.main, {}, s.styleOf)
  scrollToTopOfArea(null, {}, s.styleOf)
  scrollToTopOfArea(undefined, {}, s.styleOf)
  assert.deepEqual(s.calls, [])
})

test('Parts lookup, the technician chips, repair tabs and onboarding steps no longer use scrollIntoView', () => {
  for (const file of [
    '../src/app/(app)/parts/page.tsx',
    '../src/components/shopboard/JumpChips.tsx',
    '../src/components/repair/Results.tsx',
    '../src/app/(app)/onboarding/page.tsx',
  ]) {
    const src = read(file)
    assert.doesNotMatch(src, /scrollIntoView/, file)
    assert.match(src, /scrollToTopOfArea/, file)
  }
  assert.match(read('../src/app/(app)/parts/page.tsx'), /scrollToTopOfArea\(resultsRef\.current, \{ behavior: 'smooth' \}\)/)
})
