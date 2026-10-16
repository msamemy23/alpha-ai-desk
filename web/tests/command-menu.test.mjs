import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as c from '../src/components/shell/commands.ts'

const pages = [
  { href: '/dashboard', label: 'Today', icon: 'today' },
  { href: '/customers', label: 'Customers', icon: 'customers' },
  { href: '/messages', label: 'Inbox', icon: 'inbox' },
  { href: '/jobs', label: 'Jobs', icon: 'wrench' },
  { href: '/estimates', label: 'Estimates', icon: 'doc' },
  { href: '/invoices', label: 'Invoices', icon: 'invoice' },
  { href: '/staff', label: 'Team', icon: 'staff' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
]
const all = c.buildCommands(pages, false)
const labels = list => list.map(x => x.label)

test('every page in the navigation is a command, and the theme switch says what it will do', () => {
  for (const p of pages) assert.ok(all.some(x => x.href === p.href && x.group === 'Go to' && x.label === p.label), p.href)
  assert.equal(all.find(x => x.id === 'theme').label, 'Switch to dark mode')
  assert.equal(c.buildCommands(pages, true).find(x => x.id === 'theme').label, 'Switch to light mode')
  assert.equal(new Set(all.map(x => x.id)).size, all.length, 'ids are unique')
})

test('a typed word finds the page or action, by name or by what people call it', () => {
  assert.equal(c.matchCommands(all, 'est')[0].label, 'Estimates')
  assert.ok(labels(c.matchCommands(all, 'est')).includes('New estimate'))
  assert.equal(labels(c.matchCommands(all, 'check in'))[0], 'Write up a car')
  assert.equal(c.matchCommands(all, 'payroll')[0].href, '/staff')
  assert.ok(labels(c.matchCommands(all, 'dark')).includes('Switch to dark mode'))
  assert.equal(c.matchCommands(all, 'clock in')[0].href, '/staff')
  assert.equal(c.matchCommands(all, 'texts')[0].href, '/messages')
})

test('matching is from the start of a word, needs every word, and ignores capitals and symbols', () => {
  assert.deepEqual(c.matchCommands(all, 'stim'), [])
  assert.deepEqual(c.matchCommands(all, 'zzzz'), [])
  assert.deepEqual(c.matchCommands(all, 'new invoice xyz'), [])
  assert.equal(labels(c.matchCommands(all, 'NEW  Invoice'))[0], 'New invoice')
  assert.equal(labels(c.matchCommands(all, '  new,invoice! '))[0], 'New invoice')
  assert.deepEqual(c.matchCommands(all, ''), [])
  assert.deepEqual(c.matchCommands(all, '   '), [])
  assert.ok(c.matchCommands(all, 'e', 3).length <= 3)
})

test('a name match ranks above a keyword match', () => {
  const r = c.matchCommands(all, 'jobs')
  assert.equal(r[0].label, 'Jobs')
  // "quote" is only a keyword for estimates; no label starts with it.
  assert.equal(c.matchCommands(all, 'quote')[0].label, 'New estimate')
})

test('the starting list leads with the things people write most, then the main pages', () => {
  const s = c.startingCommands(all)
  assert.deepEqual(labels(s).slice(0, 3), ['Write up a car', 'New estimate', 'New invoice'])
  assert.ok(s.some(x => x.href === '/customers'))
  assert.ok(!s.some(x => x.href === '/settings'), 'less used pages are found by typing')
  assert.equal(s.at(-1).id, 'theme')
})

test('shortcut hints on the pages match the letters that actually work', () => {
  for (const [k, href] of Object.entries(c.GO_KEYS)) {
    const cmd = all.find(x => x.href === href)
    if (cmd) assert.equal(cmd.keys, `G then ${k.toUpperCase()}`, href)
  }
  assert.equal(new Set(Object.keys(c.GO_KEYS)).size, Object.keys(c.GO_KEYS).length)
})

test('Ctrl+K and Cmd+K open the menu; nothing else does', () => {
  assert.equal(c.isOpenKey({ key: 'k', ctrlKey: true }), true)
  assert.equal(c.isOpenKey({ key: 'K', metaKey: true }), true)
  assert.equal(c.isOpenKey({ key: 'k' }), false)
  assert.equal(c.isOpenKey({ key: 'k', ctrlKey: true, shiftKey: true }), false)
  assert.equal(c.isOpenKey({ key: 'k', ctrlKey: true, altKey: true }), false)
  assert.equal(c.isOpenKey({ key: 'j', ctrlKey: true }), false)
})

test('typing in a field is never a shortcut', () => {
  for (const tag of ['input', 'TEXTAREA', 'select']) assert.equal(c.isEditableTarget({ tagName: tag }), true, tag)
  assert.equal(c.isEditableTarget({ tagName: 'DIV', isContentEditable: true }), true)
  assert.equal(c.isEditableTarget({ tagName: 'BUTTON' }), false)
  assert.equal(c.isEditableTarget({ tagName: 'BODY' }), false)
  assert.equal(c.isEditableTarget(null), false)
})

test('G then a letter goes to the page; anything else cancels it', () => {
  const a = c.chordStep(null, { key: 'g' }, 1000, false)
  assert.deepEqual(a, { armedAt: 1000 })
  assert.deepEqual(c.chordStep(a.armedAt, { key: 'c' }, 1500, false), { armedAt: null, go: '/customers' })
  assert.deepEqual(c.chordStep(a.armedAt, { key: 'J', shiftKey: true }, 1500, false), { armedAt: null }, 'Shift+J is not J')
  assert.deepEqual(c.chordStep(a.armedAt, { key: 'J' }, 1500, false), { armedAt: null, go: '/jobs' }, 'Caps Lock still works')
  assert.deepEqual(c.chordStep(a.armedAt, { key: 'x' }, 1500, false), { armedAt: null }, 'an unknown letter just cancels')
  assert.deepEqual(c.chordStep(a.armedAt, { key: 'c' }, 1000 + c.CHORD_MS + 1, false), { armedAt: null }, 'too slow')
  assert.deepEqual(c.chordStep(a.armedAt, { key: 'g' }, 1500, false), { armedAt: 1500 }, 'G again re-arms')
  assert.deepEqual(c.chordStep(a.armedAt, { key: 'Escape' }, 1500, false), { armedAt: null })
})

test('shortcuts stay quiet while typing, in a dialog, with a modifier, or when a key is held', () => {
  assert.deepEqual(c.chordStep(null, { key: 'g' }, 1, true), { armedAt: null })
  assert.deepEqual(c.chordStep(1, { key: 'c' }, 2, true), { armedAt: null })
  assert.deepEqual(c.chordStep(1, { key: 'c', ctrlKey: true }, 2, false), { armedAt: null })
  assert.deepEqual(c.chordStep(1, { key: 'c', metaKey: true }, 2, false), { armedAt: null })
  assert.deepEqual(c.chordStep(null, { key: 'g', altKey: true }, 2, false), { armedAt: null })
  assert.deepEqual(c.chordStep(1, { key: 'c', repeat: true }, 2, false), { armedAt: null })
  assert.deepEqual(c.chordStep(null, { key: 'G', shiftKey: true }, 2, false), { armedAt: null })
})

test('every shortcut target and ?new=1 command is a page that exists', () => {
  const dirs = new Set(['dashboard', 'customers', 'work', 'messages', 'ai', 'jobs', 'shopboard', 'appointments', 'estimates', 'vehicles', 'parts', 'reports', 'staff', 'invoices', 'dvi'])
  for (const href of Object.values(c.GO_KEYS)) assert.ok(dirs.has(href.slice(1)), href)
  for (const x of all.filter(x => x.group === 'Write')) {
    const dir = x.href.slice(1, x.href.indexOf('?'))
    const page = readFileSync(new URL(`../src/app/(app)/${dir}/page.tsx`, import.meta.url), 'utf8')
    // The page reads ?new itself, or hands off to the shared documents page that does.
    const reads = /get\('new'\)|params\.get\('new'\)|newParam/.test(page) || /DocumentsPage/.test(page)
    assert.ok(reads, `${x.href} must open the new-item form`)
  }
})

test('the app shell opens the menu with Ctrl or Cmd+K, passes in the pages, and leaves other dialogs alone', () => {
  const layout = readFileSync(new URL('../src/app/(app)/layout.tsx', import.meta.url), 'utf8')
  assert.match(layout, /isOpenKey\(e\)/)
  assert.match(layout, /buildCommands\(ALL_ITEMS, dark\)/)
  assert.match(layout, /<SearchPanel autoFocus onNavigate=\{closeSearch\} commands=\{commands\} onTheme=\{toggleTheme\} \/>/)
  // A shortcut never fires over another dialog, and the letters never fire while typing.
  assert.match(layout, /otherDialog\(\)\) return/)
  assert.match(layout, /isEditableTarget\(e\.target as HTMLElement \| null\)/)
  assert.match(layout, /aria-modal="true"\]'\) !== null/)
})

test('the menu rows are all reachable by the arrow keys, and the theme row asks nothing of the server', () => {
  const panel = readFileSync(new URL('../src/components/shell/SearchPanel.tsx', import.meta.url), 'utf8')
  const rows = (panel.match(/data-result/g) || []).length
  assert.ok(rows >= 4, 'commands (link and button), customers and documents each carry data-result')
  assert.match(panel, /e\.key === 'ArrowDown' \|\| e\.key === 'ArrowUp'/)
  assert.match(panel, /e\.key === 'Enter' && e\.target === input\.current/)
  const commands = readFileSync(new URL('../src/components/shell/commands.ts', import.meta.url), 'utf8')
  assert.ok(!/fetch\(|supabase/.test(commands), 'the command list is plain data')
})

test('slash and question mark open the menu, but only when you are not typing', () => {
  assert.deepEqual(c.chordStep(null, { key: '/' }, 1, false), { armedAt: null, open: true })
  assert.deepEqual(c.chordStep(null, { key: '?', shiftKey: true }, 1, false), { armedAt: null, open: true })
  assert.deepEqual(c.chordStep(1, { key: '/' }, 2, false), { armedAt: null, open: true }, 'also in the middle of a G shortcut')
  assert.deepEqual(c.chordStep(null, { key: '/' }, 1, true), { armedAt: null }, 'typing a slash in a field is just typing')
  assert.deepEqual(c.chordStep(null, { key: '/', ctrlKey: true }, 1, false), { armedAt: null })
  assert.deepEqual(c.chordStep(null, { key: '/', repeat: true }, 1, false), { armedAt: null })
})

test('opening a sheet leaves focus in a field that already took it, so you can type at once', () => {
  const sheet = readFileSync(new URL('../src/components/Sheet.tsx', import.meta.url), 'utf8')
  assert.match(sheet, /if \(!boxRef\.current\?\.contains\(document\.activeElement\)\) boxRef\.current\?\.focus\(\)/)
  assert.ok(!/^\s*boxRef\.current\?\.focus\(\)\s*$/m.test(sheet), 'the sheet must not grab focus unconditionally')
})

test('closing a sheet returns focus to the button that opened it, even when a field inside took focus first', () => {
  const sheet = readFileSync(new URL('../src/components/Sheet.tsx', import.meta.url), 'utf8')
  assert.match(sheet, /setOpener\(open && typeof document/)
  assert.match(sheet, /const previous = opener/)
  assert.ok(!/const previous = document\.activeElement/.test(sheet), 'read the opener while rendering, not after autoFocus')
})
