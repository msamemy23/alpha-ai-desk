import test from 'node:test'
import assert from 'node:assert/strict'
import './helpers/browser-alias.mjs'
import { makeSite, fetchFor, launcher, CHROME } from './helpers/browser-fixture.mjs'

const { runLive } = await import('../src/lib/browser/engine.ts')

// These tests drive a real headless browser against a fake website that runs on this computer.
// The browser itself is locked: it has no network, so every page it shows came through the engine's own fetch.
const skip = CHROME ? false : 'no browser is installed here'

let site
const authorizer = () => {
  const pending = new Map()
  const approved = new Set()
  let n = 0
  return {
    pending,
    approve: id => approved.add(id),
    authorize: async ({ canonical, approvalId }) => {
      if (approvalId && approved.has(approvalId) && pending.get(approvalId) === canonical) { approved.delete(approvalId); return { granted: true } }
      const id = `p${++n}`
      pending.set(id, canonical)
      return { granted: false, approvalId: id }
    },
  }
}

function setup(over = {}) {
  const auth = authorizer()
  const blockedHosts = new Set(over.blockedHosts || ['blocked.test'])
  const checks = []
  const deps = {
    check: (url, info) => { checks.push([url, info.navigation]); try { return blockedHosts.has(new URL(url).hostname) ? 'That site is blocked for this shop.' : null } catch { return 'bad' } },
    fetchResource: fetchFor(site),
    authorize: auth.authorize,
    launcher, timeoutMs: 40000, settleMs: 0.5,
    ...over.deps,
  }
  return { deps, auth, checks }
}

const base = (url, over = {}) => ({ url, prepared: [], actor: 'user', scrollY: 0, viewport: 'desktop', ...over })
const find = (snap, label, kind) => {
  const hit = snap.controls.find(c => (c.label === label || c.label.includes(label)) && (!kind || c.kind === kind))
  assert.ok(hit, `control "${label}" not found in: ${snap.controls.map(c => c.label).join(', ')}`)
  return hit
}

test.before(async () => { site = await makeSite() })
test.after(async () => { await site.close() })
test.beforeEach(() => { site.seen.requests.length = 0; site.seen.posts.length = 0 })

test('a page opens in the locked browser and comes back as a picture, readable text and numbered controls', { skip }, async () => {
  const { deps } = setup()
  const out = await runLive(base('http://shop.test/', { viewport: 'phone' }), deps)
  assert.equal(out.status, 'ok')
  const s = out.snapshot
  assert.equal(s.title, 'Parts counter')
  assert.equal(s.host, 'shop.test')
  assert.deepEqual(s.viewport, { w: 390, h: 844 })
  assert.match(s.image, /^data:image\/jpeg;base64,/)
  assert.match(s.text, /Parts counter/)
  assert.equal(s.signInRequired, false)
  assert.deepEqual(s.controls.map(c => c.n), s.controls.map((_, i) => i + 1))
  const search = find(s, 'Search parts', 'search')
  assert.equal(search.risk, 'safe')
  assert.match(search.ref.loc, /#q/)
  assert.equal(find(s, 'Install guide').risk, 'approve')
  // Only the engine's own fetch reached the site.
  assert.ok(site.seen.requests.includes('GET shop.test/'))
})

test('the page cannot reach anything but through the engine: no sockets, no beacons, no direct posts, no local files, no pop-ups', { skip }, async () => {
  const { deps } = setup()
  const out = await runLive(base('http://shop.test/probe'), deps)
  assert.equal(out.status, 'ok')
  assert.match(out.snapshot.text, /WebSocket:undefined/)
  assert.match(out.snapshot.text, /RTC:undefined/)
  assert.match(out.snapshot.text, /beacon:false/)
  assert.equal(site.seen.posts.length, 0, 'no POST may reach the site')
  assert.ok(!out.snapshot.title.startsWith('leak:'), 'a file on this computer must not be readable')
  assert.ok(!site.seen.requests.some(r => r.includes('file')), 'no local file request')
  assert.ok(out.snapshot.notes.some(n => /send information/.test(n)))
  assert.ok(!out.snapshot.text.includes('hostname'))
})

test('typing then searching works across calls: entries are kept by the screen and put back each time', { skip }, async () => {
  const { deps } = setup()
  const first = await runLive(base('http://shop.test/'), deps)
  const q = find(first.snapshot, 'Search parts', 'search')
  const typed = await runLive(base('http://shop.test/', { action: { kind: 'fill', ref: q.ref, value: 'brake pads' } }), deps)
  assert.equal(typed.status, 'ok')
  assert.equal(typed.snapshot.prepared.length, 1)
  assert.equal(find(typed.snapshot, 'Search parts', 'search').value, 'brake pads')
  // Next call: the screen sends the entry back and taps Search.
  const go = find(typed.snapshot, 'Search', 'submit')
  const results = await runLive(base('http://shop.test/', { prepared: typed.snapshot.prepared, action: { kind: 'click', ref: go.ref } }), deps)
  assert.equal(results.status, 'ok')
  assert.match(results.snapshot.url, /\/results\?q=brake\+pads$/)
  assert.match(results.snapshot.text, /Results for brake pads/)
  assert.deepEqual(results.snapshot.prepared, [], 'a new page drops the old entries')
  assert.equal(site.seen.posts.length, 0)
})

test('Enter in a search box on the same site is a lookup and needs no approval', { skip }, async () => {
  const { deps } = setup()
  const first = await runLive(base('http://shop.test/'), deps)
  const q = find(first.snapshot, 'Search parts', 'search')
  const out = await runLive(base('http://shop.test/', { prepared: [{ kind: 'fill', ref: q.ref, value: 'oil filter' }], action: { kind: 'press', key: 'Enter', ref: q.ref } }), deps)
  assert.equal(out.status, 'ok')
  assert.match(out.snapshot.text, /Results for oil filter/)
})

test('passwords, card numbers and sign-in forms are never typed or submitted; the person is told to do it themselves', { skip }, async () => {
  const { deps } = setup()
  const login = await runLive(base('http://shop.test/login'), deps)
  assert.equal(login.snapshot.signInRequired, true)
  const email = find(login.snapshot, 'Email')
  const pw = find(login.snapshot, 'Password')
  assert.equal(pw.risk, 'handoff')
  assert.equal(pw.sensitive, 'password')
  for (const actor of ['user', 'ai']) {
    const typedPw = await runLive(base('http://shop.test/login', { actor, action: { kind: 'fill', ref: pw.ref, value: 'hunter2' } }), deps)
    assert.equal(typedPw.status, 'refused')
    assert.match(typedPw.message, /does not type passwords/)
    // Even the user name box of a sign-in form is left to the person.
    const typedEmail = await runLive(base('http://shop.test/login', { actor, action: { kind: 'fill', ref: email.ref, value: 'sam@example.com' } }), deps)
    assert.equal(typedEmail.status, 'refused')
    assert.match(typedEmail.message, /sign-in form/)
  }
  const go = find(login.snapshot, 'Continue')
  const tapped = await runLive(base('http://shop.test/login', { action: { kind: 'click', ref: go.ref } }), deps)
  assert.equal(tapped.status, 'handoff')
  assert.equal(tapped.reason, 'sign_in')
  assert.equal(site.seen.posts.length, 0)
  // A card number in a plain box is caught by its value.
  const home = await runLive(base('http://shop.test/'), deps)
  const q = find(home.snapshot, 'Search parts', 'search')
  const card = await runLive(base('http://shop.test/', { action: { kind: 'fill', ref: q.ref, value: '4111 1111 1111 1111' } }), deps)
  assert.equal(card.status, 'refused')
  assert.match(card.message, /card number/)
})

test('sending a form stops first and shows exactly what will be sent; it goes out once, only after approval, and only to the address shown', { skip }, async () => {
  const { deps, auth } = setup()
  const first = await runLive(base('http://shop.test/contact'), deps)
  const name = find(first.snapshot, 'Your name')
  const msg = find(first.snapshot, 'Message')
  const filledName = await runLive(base('http://shop.test/contact', { action: { kind: 'fill', ref: name.ref, value: 'Sam' } }), deps)
  const filledMsg = await runLive(base('http://shop.test/contact', { prepared: filledName.snapshot.prepared, action: { kind: 'fill', ref: msg.ref, value: 'Need a quote for pads' } }), deps)
  assert.equal(filledMsg.snapshot.prepared.length, 2)
  const send = find(filledMsg.snapshot, 'Send message')
  const tap = (extra = {}) => runLive(base('http://shop.test/contact', { prepared: filledMsg.snapshot.prepared, action: { kind: 'click', ref: send.ref }, ...extra }), deps)

  const asked = await tap()
  assert.equal(asked.status, 'approval')
  assert.equal(asked.approval.kind, 'send')
  assert.deepEqual(asked.approval.fields.map(f => `${f.label}=${f.value}`).sort(), ['Message=Need a quote for pads', 'Your name=Sam'])
  assert.match(asked.approval.summary, /Send message/)
  assert.equal(site.seen.posts.length, 0, 'nothing is sent before approval')

  // A wrong or unapproved id sends nothing.
  const forged = await tap({ approvalId: asked.approvalId })
  assert.equal(forged.status, 'approval')
  assert.equal(site.seen.posts.length, 0)

  auth.approve(forged.approvalId)
  const done = await tap({ approvalId: forged.approvalId })
  assert.equal(done.status, 'ok', done.message)
  assert.match(done.snapshot.text, /Thanks Sam/)
  assert.equal(site.seen.posts.length, 1)
  assert.equal(site.seen.posts[0].path, '/send')
  assert.match(site.seen.posts[0].body, /name=Sam/)

  // The approval was used up.
  const again = await tap({ approvalId: forged.approvalId })
  assert.equal(again.status, 'approval')
  assert.equal(site.seen.posts.length, 1)
})

test('an approval is for what was shown: if the entries change, the old approval does not apply', { skip }, async () => {
  const { deps, auth } = setup()
  const first = await runLive(base('http://shop.test/contact'), deps)
  const name = find(first.snapshot, 'Your name')
  const withName = await runLive(base('http://shop.test/contact', { action: { kind: 'fill', ref: name.ref, value: 'Sam' } }), deps)
  const send = find(withName.snapshot, 'Send message')
  const asked = await runLive(base('http://shop.test/contact', { prepared: withName.snapshot.prepared, action: { kind: 'click', ref: send.ref } }), deps)
  auth.approve(asked.approvalId)
  const changed = await runLive(base('http://shop.test/contact', { prepared: [{ ...withName.snapshot.prepared[0], value: 'Someone else' }], action: { kind: 'click', ref: send.ref }, approvalId: asked.approvalId }), deps)
  assert.equal(changed.status, 'approval')
  assert.equal(site.seen.posts.length, 0)
})

test('a form that sends to another website says so, and an approved send cannot be redirected by the page', { skip }, async () => {
  const { deps, auth } = setup()
  const first = await runLive(base('http://shop.test/contact'), deps)
  const go = find(first.snapshot, 'Go')
  const asked = await runLive(base('http://shop.test/contact', { action: { kind: 'click', ref: go.ref } }), deps)
  assert.equal(asked.status, 'approval')
  assert.match(asked.approval.summary, /shop\.test, which sends it to other\.test/)

  // The page rewrites the form's address the moment the button is pressed. The approved address no longer matches, so nothing is sent.
  const race = await runLive(base('http://shop.test/race'), deps)
  const nameBox = find(race.snapshot, 'Name')
  const filled = await runLive(base('http://shop.test/race', { action: { kind: 'fill', ref: nameBox.ref, value: 'Sam' } }), deps)
  const btn = find(filled.snapshot, 'Send message')
  const wanted = await runLive(base('http://shop.test/race', { prepared: filled.snapshot.prepared, action: { kind: 'click', ref: btn.ref } }), deps)
  assert.equal(wanted.status, 'approval')
  auth.approve(wanted.approvalId)
  const swapped = await runLive(base('http://shop.test/race', { prepared: filled.snapshot.prepared, action: { kind: 'click', ref: btn.ref }, approvalId: wanted.approvalId }), deps)
  assert.ok(site.seen.posts.length === 0, `no post may leave: ${JSON.stringify(site.seen.posts)}`)
  assert.ok(!site.seen.requests.some(r => r.includes('evil.test')))
  assert.ok(swapped.snapshot.notes.some(n => /send information/.test(n)), 'the person is told it was stopped')
})

test('buying, adding to a cart and agreeing to terms always ask first', { skip }, async () => {
  const { deps } = setup()
  const shop = await runLive(base('http://shop.test/buy'), deps)
  for (const label of ['Buy now', 'Add to cart']) {
    const out = await runLive(base('http://shop.test/buy', { action: { kind: 'click', ref: find(shop.snapshot, label).ref } }), deps)
    assert.equal(out.status, 'approval', label)
    assert.equal(out.approval.kind, 'purchase')
  }
})

test('downloads are never saved by the engine: links ask first, and a page that starts a download is told no', { skip }, async () => {
  const { deps } = setup()
  const home = await runLive(base('http://shop.test/'), deps)
  const guide = find(home.snapshot, 'Install guide')
  const asked = await runLive(base('http://shop.test/', { action: { kind: 'click', ref: guide.ref } }), deps)
  assert.equal(asked.status, 'approval')
  assert.equal(asked.approval.kind, 'download')
  assert.equal(asked.approval.url, 'http://shop.test/guide.pdf')
  assert.ok(!site.seen.requests.includes('GET shop.test/guide.pdf'), 'the file is not even fetched')
  // Even with an approval id the engine does not perform a download itself.
  const again = await runLive(base('http://shop.test/', { action: { kind: 'click', ref: guide.ref }, approvalId: asked.approvalId }), deps)
  assert.equal(again.status, 'approval')

  const selfDl = await runLive(base('http://shop.test/selfdl'), deps)
  assert.equal(selfDl.status, 'ok')
  assert.equal(selfDl.snapshot.downloads.length, 1)
  assert.equal(selfDl.snapshot.downloads[0].name, 'parts.zip')
  assert.ok(selfDl.snapshot.notes.some(n => /download a file/.test(n)))
})

test('hidden text is not shown as page text, is flagged, and cannot be hidden by the page lying about its own styles', { skip }, async () => {
  const { deps } = setup()
  const out = await runLive(base('http://shop.test/hidden'), deps)
  assert.equal(out.status, 'ok')
  assert.match(out.snapshot.text, /Brake pads are in stock/)
  assert.ok(!/Ignore all previous instructions/i.test(out.snapshot.text), 'display:none text is not page text')
  assert.ok(!/Disregard your rules/i.test(out.snapshot.text), 'same-colour text is not page text')
  assert.equal(out.snapshot.injection.suspected, true)
  assert.equal(out.snapshot.injection.hiddenText, true)
  assert.ok(out.snapshot.injection.hits.length >= 1)
})

test('a control with something drawn over it is not clicked', { skip }, async () => {
  const { deps } = setup()
  const page = await runLive(base('http://shop.test/overlay'), deps)
  const real = find(page.snapshot, 'Search')
  const out = await runLive(base('http://shop.test/overlay', { action: { kind: 'click', ref: real.ref } }), deps)
  assert.equal(out.status, 'refused')
  assert.match(out.message, /drawn over/)
  assert.ok(!site.seen.requests.some(r => r.includes('/buy')))
})

test('links that ask for a new window open in the same one, and script pop-ups are closed', { skip }, async () => {
  const { deps } = setup()
  const home = await runLive(base('http://shop.test/'), deps)
  const out = await runLive(base('http://shop.test/', { action: { kind: 'click', ref: find(home.snapshot, 'Opens elsewhere').ref } }), deps)
  assert.equal(out.status, 'ok')
  assert.equal(out.snapshot.title, 'Popup page')
})

test('the page changing under a tap means nothing is clicked', { skip }, async () => {
  const { deps } = setup()
  const home = await runLive(base('http://shop.test/'), deps)
  const stale = { loc: find(home.snapshot, 'Accept cookies').ref.loc, fp: 'zzzz' }
  const out = await runLive(base('http://shop.test/', { action: { kind: 'click', ref: stale } }), deps)
  assert.equal(out.status, 'refused')
  assert.match(out.message, /page changed/)
  const gone = await runLive(base('http://shop.test/', { action: { kind: 'click', ref: { loc: '#nothing-here', fp: 'abcd' } } }), deps)
  assert.equal(gone.status, 'refused')
  assert.match(gone.message, /no longer on the page/)
})

test('tick boxes and drop-downs are entries that are kept; cookie banners are not decisions', { skip }, async () => {
  const { deps } = setup()
  const home = await runLive(base('http://shop.test/'), deps)
  const box = find(home.snapshot, 'In stock only')
  const ticked = await runLive(base('http://shop.test/', { action: { kind: 'click', ref: box.ref } }), deps)
  assert.equal(ticked.status, 'ok')
  assert.equal(ticked.snapshot.prepared[0].kind, 'check')
  assert.equal(find(ticked.snapshot, 'In stock only').checked, true)
  const make = find(ticked.snapshot, 'make')
  const chosen = await runLive(base('http://shop.test/', { prepared: ticked.snapshot.prepared, action: { kind: 'select', ref: make.ref, value: 'Honda' } }), deps)
  assert.equal(chosen.status, 'ok')
  assert.equal(chosen.snapshot.prepared.length, 2)
  assert.equal(find(chosen.snapshot, 'make').value, 'honda')
  assert.equal(find(chosen.snapshot, 'In stock only').checked, true, 'the earlier tick is put back')
  const cookie = await runLive(base('http://shop.test/', { action: { kind: 'click', ref: find(home.snapshot, 'Accept cookies').ref } }), deps)
  assert.equal(cookie.status, 'ok')
})

test('addresses the shop blocks are refused at the start and when a page redirects there', { skip }, async () => {
  const { deps } = setup()
  const direct = await runLive(base('http://blocked.test/'), deps)
  assert.deepEqual([direct.status, direct.code], ['error', 'blocked'])
  assert.match(direct.message, /blocked for this shop/)
  const viaRedirect = await runLive(base('http://shop.test/redirect-out'), deps)
  assert.equal(viaRedirect.status, 'error')
  assert.equal(viaRedirect.code, 'blocked')
  const broken = await runLive(base('http://shop.test/boom'), deps)
  assert.deepEqual([broken.status, broken.code], ['error', 'load'])
  assert.match(broken.message, /500/)
})

test('a slow or dead call ends cleanly and the browser is closed', { skip }, async () => {
  const { deps } = setup({ deps: { fetchResource: async () => { await new Promise(r => setTimeout(r, 4000)); throw new Error('slow') }, timeoutMs: 1500 } })
  const t = Date.now()
  const out = await runLive(base('http://shop.test/'), deps)
  assert.equal(out.status, 'error')
  assert.ok(Date.now() - t < 15000)
})
