import test from 'node:test'
import assert from 'node:assert/strict'
import * as a from '../src/components/browser/address.ts'
import { describeFailure, setupText, SETUP_DEFAULT } from '../src/components/browser/failure.ts'
import * as t from '../src/components/browser/tabs.ts'

/* ---------- the address bar ---------- */

test('a typed address opens the page and anything else is a search', () => {
  assert.deepEqual(a.resolveTyped('rockauto.com/catalog'), { kind: 'page', url: 'https://rockauto.com/catalog' })
  assert.deepEqual(a.resolveTyped('https://www.autozone.com/'), { kind: 'page', url: 'https://www.autozone.com/' })
  assert.deepEqual(a.resolveTyped('brake pads civic 2016'), { kind: 'search', query: 'brake pads civic 2016' })
  assert.deepEqual(a.resolveTyped('Honda Civic P0420'), { kind: 'search', query: 'Honda Civic P0420' })
  assert.deepEqual(a.resolveTyped('example.com brake'), { kind: 'search', query: 'example.com brake' })
  assert.deepEqual(a.resolveTyped('javascript:alert(1)'), { kind: 'search', query: 'javascript:alert(1)' })
})

test('nothing typed is empty, and an address the browser could never open is refused before it goes anywhere', () => {
  assert.deepEqual(a.resolveTyped(''), { kind: 'empty' })
  assert.deepEqual(a.resolveTyped('   '), { kind: 'empty' })
  const local = a.resolveTyped('http://localhost:3000')
  assert.equal(local.kind, 'invalid')
  assert.match(local.message, /private or internal network/)
})

test('addresses are shown the short way, except pages that are not secure', () => {
  assert.equal(a.addressText('https://www.rockauto.com/en/catalog/honda?x=1'), 'rockauto.com/en/catalog/honda?x=1')
  assert.equal(a.shownAddress('https://www.example.com/'), 'example.com')
  assert.equal(a.shownAddress('http://example.com/a'), 'http://example.com/a')
})

test('two addresses that a person would call the same are the same', () => {
  assert.ok(a.sameAddress('https://a.com/x/#top', 'https://A.com/x'))
  assert.ok(!a.sameAddress('https://a.com/x?y=1', 'https://a.com/x'))
  assert.ok(a.sameTarget({ kind: 'search', query: 'Brakes' }, { kind: 'search', query: 'brakes' }))
  assert.ok(!a.sameTarget({ kind: 'search', query: 'a' }, { kind: 'page', url: 'https://a.com/' }))
})

test('only web addresses and phone numbers become links, and pictures only load through Alpha', () => {
  assert.equal(a.safeLink('javascript:alert(1)'), null)
  assert.equal(a.safeLink('//evil.example'), null)
  assert.equal(a.safeLink('https://x.com/a b'), null)
  assert.deepEqual(a.safeLink('https://x.com/a'), { kind: 'web', url: 'https://x.com/a' })
  assert.deepEqual(a.safeLink('tel:+17135550142'), { kind: 'tel', url: 'tel:+17135550142' })
  assert.equal(a.imageSrc('data:image/png;base64,AAAA'), null)
  assert.equal(a.imageSrc('tel:+17135550142'), null)
  assert.equal(a.imageSrc('https://img.example.com/a.png?x=1&y=2'), '/api/browser/image?u=https%3A%2F%2Fimg.example.com%2Fa.png%3Fx%3D1%26y%3D2')
})

test('tab names are short and always say something', () => {
  assert.equal(a.tabTitle(null, ''), 'New tab')
  assert.equal(a.tabTitle({ kind: 'search', query: 'brakes' }, ''), 'Search: brakes')
  assert.equal(a.tabTitle({ kind: 'page', url: 'https://www.autozone.com/x' }, ''), 'autozone.com')
  assert.equal(a.tabTitle({ kind: 'page', url: 'https://x.com' }, '  Hello   world  '), 'Hello world')
  assert.ok(a.tabTitle({ kind: 'page', url: 'https://x.com' }, 'x'.repeat(200)).length <= 60)
})

/* ---------- failures in plain words ---------- */

test('a part that is not set up yet says so in plain words, with no database text', () => {
  const f = describeFailure({ status: 409, body: { needsUpdate: true, error: 'relation "browser_rules" does not exist' } })
  assert.equal(f.setup, true)
  assert.equal(f.message, SETUP_DEFAULT)
  assert.doesNotMatch(f.message, /relation|schema|postgres/i)
  const live = describeFailure({ status: 502, body: { outcome: { code: 'needs_update', message: 'Approvals need a database update before anything can be sent.' } } })
  assert.equal(live.setup, true)
  assert.equal(setupText('Saving site rules'), 'Saving site rules needs a one-time setup. Ask Alpha’s owner to apply it.')
})

test('a site rule that stops a page is marked as blocked and keeps the server’s sentence', () => {
  const f = describeFailure({ status: 403, body: { error: 'Your shop blocked this site.', code: 'blocked' } })
  assert.equal(f.blocked, true)
  assert.equal(f.message, 'Your shop blocked this site.')
})

test('technical text is never shown, and each kind of trouble has its own words', () => {
  assert.equal(describeFailure({ status: 500, body: { error: 'column "x" violates something' } }).message, 'That did not work. Try again in a moment.')
  assert.match(describeFailure({ status: 0, offline: true }).message, /No connection/)
  assert.equal(describeFailure({ status: 0, offline: true }).offline, true)
  assert.match(describeFailure({ status: 401 }).message, /signed out/)
  assert.match(describeFailure({ status: 403 }).message, /Your role/)
  assert.equal(describeFailure({ status: 429, body: { retryAfter: 12 } }).retryAfter, 12)
  assert.match(describeFailure({ status: 504 }).message, /too long/)
  assert.match(describeFailure({ status: 200, timedOut: true }).message, /too long/)
  assert.equal(describeFailure({ status: 500, body: null }).message, 'That did not work. Try again in a moment.')
})

/* ---------- tabs ---------- */

const page = url => ({ kind: 'page', url })
const search = query => ({ kind: 'search', query })
const entryOf = (s, tabId = s.activeId) => t.currentEntry(t.tabById(s, tabId))
const read = (title, url) => ({ status: 'ready', content: { kind: 'read', doc: { title, blocks: [] }, finalUrl: url, images: true } })

test('a new screen has one empty tab', () => {
  const s = t.initialTabs()
  assert.equal(s.tabs.length, 1)
  assert.equal(t.activeTab(s).index, -1)
  assert.equal(t.currentEntry(t.activeTab(s)), null)
  assert.equal(t.canGoBack(t.activeTab(s)), false)
  assert.equal(t.canGoForward(t.activeTab(s)), false)
  assert.equal(t.tabName(t.activeTab(s)), 'New tab')
})

test('going to pages builds a history, and Back and Forward move within the tab', () => {
  let s = t.initialTabs()
  const id = s.activeId
  s = t.tabsReducer(s, { type: 'go', tabId: id, target: page('https://a.com/') })
  s = t.tabsReducer(s, { type: 'go', tabId: id, target: page('https://b.com/') })
  s = t.tabsReducer(s, { type: 'go', tabId: id, target: search('brakes') })
  assert.equal(t.activeTab(s).entries.length, 3)
  assert.equal(entryOf(s).target.query, 'brakes')
  assert.ok(t.canGoBack(t.activeTab(s)))
  assert.ok(!t.canGoForward(t.activeTab(s)))
  s = t.tabsReducer(s, { type: 'back', tabId: id })
  assert.equal(entryOf(s).target.url, 'https://b.com/')
  assert.ok(t.canGoForward(t.activeTab(s)))
  s = t.tabsReducer(s, { type: 'back', tabId: id })
  s = t.tabsReducer(s, { type: 'back', tabId: id })
  assert.equal(entryOf(s).target.url, 'https://a.com/')
  assert.ok(!t.canGoBack(t.activeTab(s)))
  s = t.tabsReducer(s, { type: 'forward', tabId: id })
  assert.equal(entryOf(s).target.url, 'https://b.com/')
})

test('going somewhere new after Back drops the pages that were ahead', () => {
  let s = t.initialTabs()
  const id = s.activeId
  for (const u of ['https://a.com/', 'https://b.com/', 'https://c.com/']) s = t.tabsReducer(s, { type: 'go', tabId: id, target: page(u) })
  s = t.tabsReducer(s, { type: 'back', tabId: id })
  s = t.tabsReducer(s, { type: 'go', tabId: id, target: page('https://d.com/') })
  assert.deepEqual(t.activeTab(s).entries.map(e => e.target.url), ['https://a.com/', 'https://b.com/', 'https://d.com/'])
  assert.ok(!t.canGoForward(t.activeTab(s)))
})

test('going to the page you are already on reloads it instead of adding a second copy', () => {
  let s = t.initialTabs()
  const id = s.activeId
  s = t.tabsReducer(s, { type: 'go', tabId: id, target: page('https://a.com/') })
  const first = entryOf(s).id
  s = t.tabsReducer(s, { type: 'loaded', tabId: id, entryId: first, load: read('A', 'https://a.com/') })
  s = t.tabsReducer(s, { type: 'go', tabId: id, target: page('https://a.com/') })
  assert.equal(t.activeTab(s).entries.length, 1)
  assert.equal(entryOf(s).load.status, 'loading')
})

test('a page that loads names its tab, and a failed one keeps the reason', () => {
  let s = t.initialTabs()
  const id = s.activeId
  s = t.tabsReducer(s, { type: 'go', tabId: id, target: page('https://a.com/') })
  const e = entryOf(s).id
  assert.equal(entryOf(s).load.status, 'loading')
  s = t.tabsReducer(s, { type: 'loaded', tabId: id, entryId: e, load: read('Brake pads', 'https://a.com/x') })
  assert.equal(t.tabName(t.activeTab(s)), 'Brake pads')
  assert.equal(t.entryUrl(entryOf(s)), 'https://a.com/x')
  const failure = describeFailure({ status: 403, body: { error: 'Your shop blocked this site.', code: 'blocked' } })
  s = t.tabsReducer(s, { type: 'loaded', tabId: id, entryId: e, load: { status: 'failed', failure } })
  assert.equal(entryOf(s).load.failure.blocked, true)
})

test('an answer for a page that is no longer there changes nothing', () => {
  let s = t.initialTabs()
  const id = s.activeId
  s = t.tabsReducer(s, { type: 'go', tabId: id, target: page('https://a.com/') })
  const before = s
  assert.equal(t.tabsReducer(s, { type: 'loaded', tabId: id, entryId: 'gone', load: read('X', 'https://x.com/') }), before)
  assert.equal(t.tabsReducer(s, { type: 'loaded', tabId: 'nope', entryId: 'gone', load: read('X', 'https://x.com/') }), before)
  assert.equal(t.tabsReducer(s, { type: 'back', tabId: id }), before)
})

test('tabs: new, switch, and close pick a sensible next tab; the last tab is replaced by a fresh one', () => {
  let s = t.initialTabs()
  const first = s.activeId
  s = t.tabsReducer(s, { type: 'new' })
  const second = s.activeId
  assert.notEqual(first, second)
  s = t.tabsReducer(s, { type: 'go', tabId: second, target: page('https://b.com/') })
  s = t.tabsReducer(s, { type: 'select', tabId: first })
  assert.equal(s.activeId, first)
  s = t.tabsReducer(s, { type: 'close', tabId: first })
  assert.equal(s.tabs.length, 1)
  assert.equal(s.activeId, second)
  s = t.tabsReducer(s, { type: 'close', tabId: second })
  assert.equal(s.tabs.length, 1)
  assert.equal(t.currentEntry(t.activeTab(s)), null)
  assert.notEqual(s.activeId, second)
})

test('there is a limit on open tabs', () => {
  let s = t.initialTabs()
  for (let i = 0; i < t.MAX_TABS + 4; i++) s = t.tabsReducer(s, { type: 'new' })
  assert.equal(s.tabs.length, t.MAX_TABS)
})

test('history is capped so a long session does not grow without end', () => {
  let s = t.initialTabs()
  const id = s.activeId
  for (let i = 0; i < t.MAX_ENTRIES + 12; i++) s = t.tabsReducer(s, { type: 'go', tabId: id, target: page(`https://site${i}.com/`) })
  assert.equal(t.activeTab(s).entries.length, t.MAX_ENTRIES)
  assert.equal(entryOf(s).target.url, `https://site${t.MAX_ENTRIES + 11}.com/`)
})

test('search results are always Reader view; Live view is only for pages', () => {
  let s = t.initialTabs()
  const id = s.activeId
  s = t.tabsReducer(s, { type: 'go', tabId: id, target: search('brakes'), mode: 'live' })
  assert.equal(t.activeTab(s).mode, 'reader')
  assert.equal(entryOf(s).live, null)
  s = t.tabsReducer(s, { type: 'mode', tabId: id, mode: 'live', viewport: 'phone' })
  assert.equal(t.activeTab(s).mode, 'reader')
})

test('switching a page to Live view makes its live state; switching back asks for the reader copy', () => {
  let s = t.initialTabs()
  const id = s.activeId
  s = t.tabsReducer(s, { type: 'go', tabId: id, target: page('https://a.com/') })
  assert.equal(entryOf(s).live, null)
  s = t.tabsReducer(s, { type: 'mode', tabId: id, mode: 'live', viewport: 'phone' })
  assert.equal(t.activeTab(s).mode, 'live')
  assert.equal(entryOf(s).live.busy, true)
  assert.equal(entryOf(s).live.viewport, 'phone')
  s = t.tabsReducer(s, { type: 'go', tabId: id, target: page('https://b.com/'), mode: 'live', viewport: 'desktop' })
  assert.equal(entryOf(s).live.viewport, 'desktop')
  assert.equal(entryOf(s).load, null)
})

test('a tap in Live view that lands on another page is a new place in the history, so Back comes back', () => {
  let s = t.initialTabs()
  const id = s.activeId
  s = t.tabsReducer(s, { type: 'go', tabId: id, target: page('https://a.com/'), mode: 'live', viewport: 'phone' })
  const e = entryOf(s).id
  const snap = (url, title) => ({ url, host: 'a.com', title, status: 200, scrollY: 0, scrollHeight: 1000, viewport: { w: 390, h: 800 }, image: '', controls: [], text: '', injection: { suspected: false, hits: [], hiddenText: false }, signInRequired: false, captcha: false, downloads: [], blocked: [], prepared: [], notes: [] })
  s = t.tabsReducer(s, { type: 'live', tabId: id, entryId: e, event: { type: 'ok', snapshot: snap('https://a.com/', 'Home'), did: '' } })
  assert.equal(t.activeTab(s).entries.length, 1)
  assert.equal(entryOf(s).title, 'Home')
  s = t.tabsReducer(s, { type: 'live', tabId: id, entryId: e, event: { type: 'ok', snapshot: snap('https://a.com/parts', 'Parts'), did: 'Tapped "Parts"' } })
  assert.equal(t.activeTab(s).entries.length, 2)
  assert.equal(entryOf(s).target.url, 'https://a.com/parts')
  assert.equal(entryOf(s).live.did, 'Tapped "Parts"')
  s = t.tabsReducer(s, { type: 'back', tabId: id })
  assert.equal(entryOf(s).target.url, 'https://a.com/')
  assert.equal(entryOf(s).live.busy, false)
})

test('Live view pictures far back in the history are let go to save memory', () => {
  let s = t.initialTabs()
  const id = s.activeId
  const snap = i => ({ url: `https://a.com/${i}`, host: 'a.com', title: `P${i}`, status: 200, scrollY: 0, scrollHeight: 1000, viewport: { w: 390, h: 800 }, image: 'data:image/jpeg;base64,AAAA', controls: [], text: '', injection: { suspected: false, hits: [], hiddenText: false }, signInRequired: false, captcha: false, downloads: [], blocked: [], prepared: [], notes: [] })
  for (let i = 0; i < 8; i++) {
    s = t.tabsReducer(s, { type: 'go', tabId: id, target: page(`https://a.com/${i}`), mode: 'live', viewport: 'phone' })
    s = t.tabsReducer(s, { type: 'live', tabId: id, entryId: entryOf(s).id, event: { type: 'ok', snapshot: snap(i), did: '' } })
  }
  const entries = t.activeTab(s).entries
  assert.equal(entries[0].live.snapshot.image, '')
  assert.equal(entries[entries.length - 1].live.snapshot.image, 'data:image/jpeg;base64,AAAA')
})
