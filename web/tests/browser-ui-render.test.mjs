import './helpers/browser-ui-render.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import React from 'react'
import server from 'react-dom/server'

// The Browser screen cannot be opened here (it needs a signed-in session and a database), so these draw each part of it on
// the server with made-up data in every state and read the words that come out. They catch a part that throws, a state with
// no words, database text leaking through, and anything from a website being drawn as code.
const { renderToStaticMarkup } = server
const h = React.createElement
const dir = name => import(new URL(`../src/components/browser/${name}`, import.meta.url).href).then(m => m.default ?? m)
const mod = name => import(new URL(`../src/components/browser/${name}`, import.meta.url).href)
const draw = el => renderToStaticMarkup(el)

const live = await mod('live.ts')
const settingsMod = await mod('settings.ts')
const agentMod = await mod('agent-state.ts')
const tabsMod = await mod('tabs.ts')
const approvalMod = await mod('approval.ts')
const ApprovalCard = await dir('ApprovalCard.tsx')
const LivePanel = await dir('LivePanel.tsx')
const ReaderView = await dir('ReaderView.tsx')
const LoadProblem = await dir('LoadProblem.tsx')
const SearchResults = await dir('SearchResults.tsx')
const AskPanel = await dir('AskPanel.tsx')
const SettingsSheet = await dir('SettingsSheet.tsx')
const ActivitySheet = await dir('ActivitySheet.tsx')
const StartPage = await dir('StartPage.tsx')
const TabStrip = await dir('TabStrip.tsx')
const AddressBar = await dir('AddressBar.tsx')
const PageTools = await dir('PageTools.tsx')
const BrowserScreen = await dir('BrowserScreen.tsx')
const BrowserPage = await import(new URL('../src/app/(app)/browser/page.tsx', import.meta.url).href).then(m => m.default)

const DATABASE_WORDS = /relation "|schema cache|pgrst|postgres|sqlstate|migration|\b058\b|\b059\b|browser_(settings|site_rules|bookmarks|approvals)|undefined|\[object|NaN/i

const ref = n => ({ loc: `body > :nth-child(${n})`, fp: `fp${n}` })
const control = (over = {}) => ({ n: 1, ref: ref(1), kind: 'button', label: 'Search', rect: { x: 20, y: 40, w: 100, h: 40 }, inView: true, value: '', checked: false, disabled: false, options: [], risk: 'safe', sensitive: null, href: '', ...over })
const snap = (over = {}) => ({
  url: 'https://shop.example.com/parts', host: 'shop.example.com', title: 'Parts', status: 200, scrollY: 0, scrollHeight: 2400, viewport: { w: 390, h: 844 },
  image: 'data:image/jpeg;base64,AAAA',
  controls: [
    control(), control({ n: 2, ref: ref(2), kind: 'text', label: 'Part number', value: 'abc' }), control({ n: 3, ref: ref(3), kind: 'submit', label: 'Send', risk: 'approve' }),
    control({ n: 4, ref: ref(4), kind: 'text', label: 'Password', risk: 'handoff', sensitive: 'password', value: '••••••' }), control({ n: 5, ref: ref(5), kind: 'select', label: 'Make', options: ['Honda', 'Ford'] }),
    control({ n: 6, ref: ref(6), kind: 'link', label: 'Brakes', href: 'https://shop.example.com/brakes', inView: false }),
  ],
  text: 'Brake pads\nPart 123', injection: { suspected: false, hits: [], hiddenText: false }, signInRequired: false, captcha: false, downloads: [], blocked: [], prepared: [], notes: [], ...over,
})
const details = (over = {}) => ({ kind: 'submit', title: 'Send a form', summary: 'Press "Send" on shop.example.com with the 1 entry below. This sends information to the website.', host: 'shop.example.com', url: 'https://shop.example.com/contact', fields: [{ label: 'Name', value: 'Dana' }], why: 'It sends what you filled in.', ...over })
const liveState = (over = {}) => ({ ...live.initialLive('https://shop.example.com/parts', 'phone'), snapshot: snap(), busy: false, ...over })
const fail = over => ({ message: 'x', code: '', status: 500, setup: false, blocked: false, offline: false, forbidden: false, retryAfter: 0, ...over })

const payload = settingsMod.cleanSettingsPayload({
  ok: true, settings: { mode: 'open', aiEnabled: true, readerImages: true },
  rules: [{ id: 'a0000000-0000-4000-8000-000000000001', host: 'bad.example.com', rule: 'block', note: 'Spam' }, { id: 'b0000000-0000-4000-8000-000000000002', host: 'good.example.com', rule: 'allow' }],
  bookmarks: [
    { id: 'builtin-recalls', title: 'Recall check', url: 'https://www.nhtsa.gov/recalls', kind: 'quick', position: 0, builtin: true },
    { id: 'c0000000-0000-4000-8000-000000000003', title: 'My saved page', url: 'https://x.example.com/p', kind: 'saved', position: 100 },
  ],
  missing: { settings: false, rules: false, bookmarks: false }, perms: { canAct: true, canManage: true }, aiReady: true,
  defaultBlocked: [{ host: 'chase.com', why: 'Banking and cards. Alpha never handles bank sign-ins.' }, { host: 'paypal.com', why: 'Payments and investing. Alpha never handles payment sign-ins.' }],
})
const settingsApi = (p, status = 'ready') => ({ status, payload: p, error: status === 'error' ? 'The settings could not be loaded.' : '', reload() {}, patch() {} })

/* ---------- approval card ---------- */

test('every approval card shows the exact action, who wants it, how long it lasts, and two plain buttons', () => {
  for (const kind of ['submit', 'purchase', 'send', 'download', 'delete', 'terms', 'open_site']) {
    for (const actor of ['user', 'ai']) {
      const html = draw(h(ApprovalCard, { pending: { details: details({ kind }), approvalId: 'a1', action: null, phase: 'asking', error: '', actor }, onApprove() {}, onDeny() {} }))
      assert.match(html, /Waiting for your OK/, kind)
      assert.match(html, /Press &quot;Send&quot; on shop\.example\.com/, kind)
      assert.match(html, /https:\/\/shop\.example\.com\/contact/)
      assert.match(html, /Do not do this/)
      assert.match(html, new RegExp(approvalMod.approveLabel(kind)))
      assert.match(html, /This request lasts 10 minutes\./)
      assert.match(html, actor === 'ai' ? /Alpha wants to do this\./ : /You asked for this\./)
      assert.doesNotMatch(html, DATABASE_WORDS)
    }
  }
})

test('the card lists every entry that will be sent, and says when one was left empty', () => {
  const html = draw(h(ApprovalCard, { pending: { details: details({ fields: [{ label: 'Name', value: 'Dana' }, { label: 'Phone', value: '' }] }), approvalId: 'a1', action: null, phase: 'asking', error: '', actor: 'user' }, onApprove() {}, onDeny() {} }))
  assert.match(html, /What will be sent/)
  assert.match(html, /Dana/)
  assert.match(html, /Left empty/)
})

test('both buttons are turned off while the answer is on its way, and a lost connection says so with a Try again button', () => {
  const busy = draw(h(ApprovalCard, { pending: { details: details(), approvalId: 'a1', action: null, phase: 'deciding', error: '', actor: 'user' }, onApprove() {}, onDeny() {} }))
  assert.equal((busy.match(/disabled=""/g) || []).length, 2)
  assert.match(busy, /Approving…/)
  const sending = draw(h(ApprovalCard, { pending: { details: details(), approvalId: 'a1', action: null, phase: 'sending', error: '', actor: 'user' }, onApprove() {}, onDeny() {} }))
  assert.match(sending, /Sending…/)
  const retry = draw(h(ApprovalCard, { pending: { details: details(), approvalId: 'a1', action: null, phase: 'retry', error: 'No connection. Check your internet and try again.', actor: 'user' }, onApprove() {}, onDeny() {} }))
  assert.match(retry, /No connection/)
  assert.match(retry, />Try again</)
  assert.doesNotMatch(retry, /disabled=""/)
})

test('a download card says which files are ever saved', () => {
  const html = draw(h(ApprovalCard, { pending: { details: details({ kind: 'download', url: 'https://shop.example.com/catalog.pdf' }), approvalId: 'a1', action: null, phase: 'asking', error: '', actor: 'user' }, onApprove() {}, onDeny() {} }))
  assert.match(html, /Approve and download/)
  assert.match(html, /Alpha only saves PDFs, pictures and text files\./)
})

/* ---------- Live view ---------- */

const livePanel = (state, extra = {}) => draw(h(LivePanel, { live: state, canAct: true, canManage: true, payload, onOpenSettings() {}, onTap() {}, onSelect() {}, onRefresh() {}, onAnswer() {}, onDismiss() {}, ...extra }))

test('Live view says who is driving, shows the picture, and lists what can be used with a word for how risky each is', () => {
  const html = livePanel(liveState())
  assert.match(html, /You are driving/)
  assert.match(html, /One tap does one thing/)
  assert.match(html, /data:image\/jpeg;base64,AAAA/)
  assert.match(html, /On the page/)
  assert.match(html, /Safe to tap/)
  assert.match(html, /Asks you first/)
  assert.match(html, /You do this on the website/)
  assert.match(html, /Further down the page \(1\)/)
  assert.match(html, /Scroll down/)
  assert.doesNotMatch(html, DATABASE_WORDS)
})

test('while it works, Live view says so and the buttons that act are off', () => {
  const html = livePanel(liveState({ busy: true }))
  assert.match(html, /Working on the page/)
  assert.match(html, /Working…/)
  assert.doesNotMatch(html, /You are driving/)
})

test('the first load, a failed load and a blocked load each have their own words', () => {
  assert.match(livePanel({ ...live.initialLive('https://a.example.com/', 'phone') }), /Opening the page/)
  const failed = livePanel({ ...live.initialLive('https://a.example.com/', 'phone'), busy: false, error: { message: 'The page took too long. Try again.', setup: false, blocked: false } })
  assert.match(failed, /The page took too long/)
  assert.match(failed, />Try again</)
  const blocked = livePanel({ ...live.initialLive('https://www.paypal.com/', 'phone'), busy: false, error: { message: 'Payments.', setup: false, blocked: true } })
  assert.match(blocked, /Which rule:/)
  assert.match(blocked, /Alpha’s built-in block list \(paypal\.com\)/)
})

test('Live view stops at an approval card, and nothing else on the page can be tapped meanwhile', () => {
  const html = livePanel(liveState({ approval: { details: details(), approvalId: 'a1', action: { kind: 'click', ref: ref(3) }, phase: 'asking', error: '', actor: 'user' } }))
  assert.match(html, /Waiting for your OK/)
  assert.match(html, /Approve and send/)
  assert.match(html, /Scroll down/)
  assert.ok((html.match(/disabled=""/g) || []).length >= 3, 'scroll up, scroll down and look again are off')
})

test('a sign-in, a card number field and a human check are handed to the person, with the server’s words', () => {
  const hand = livePanel(liveState({ handoff: { reason: 'sign_in', message: 'This form signs in. Alpha does not sign in to websites.' } }))
  assert.match(hand, /This step is a sign-in/)
  assert.match(hand, /Alpha does not sign in to websites\./)
  assert.match(hand, /Open in your own browser/)
  const page = livePanel(liveState({ snapshot: snap({ signInRequired: true }) }))
  assert.match(page, /This site asks for a sign-in/)
  assert.match(page, /never types passwords|does not sign in to websites or type passwords/i)
  const field = livePanel(liveState({ selected: 4 }))
  assert.match(field, /Selected: Password/)
  assert.match(field, /Alpha never types passwords, card numbers, security codes or one-time codes/)
  assert.doesNotMatch(field, /What to type/)
})

test('a tapped control shows only what that kind of control can do', () => {
  assert.match(livePanel(liveState({ selected: 2 })), /What to type/)
  assert.match(livePanel(liveState({ selected: 2 })), /Press Enter in this box/)
  assert.match(livePanel(liveState({ selected: 3 })), /show you exactly what this does and wait for your OK/)
  assert.match(livePanel(liveState({ selected: 5 })), /Choose one/)
  assert.match(livePanel(liveState({ selected: 6 })), /Goes to shop\.example\.com\/brakes/)
  assert.match(livePanel(liveState({ selected: 1 })), /Tap button/)
})

test('someone who can only look is told so and cannot act', () => {
  const html = livePanel(liveState({ selected: 2 }), { canAct: false })
  assert.match(html, /Your role can look at pages but not fill in or send anything\./)
  assert.doesNotMatch(html, /What to type/)
})

test('a page with no picture or no controls says what to do next', () => {
  const html = livePanel(liveState({ snapshot: snap({ image: '', controls: [] }) }))
  assert.match(html, /There is no picture of this page right now/)
  assert.match(html, /No buttons or boxes found/)
})

test('notices from the page, the server and a saved file are shown in words', () => {
  const html = livePanel(liveState({
    notice: { kind: 'warn', text: 'The page changed, so Alpha did not click.' }, saved: 'Saved catalog.pdf (1.2 MB) to your device.', did: 'Tapped "Search"',
    snapshot: snap({ injection: { suspected: true, hits: ['x'], hiddenText: false }, blocked: [{ url: 'https://ads.example.com/x', reason: 'Your shop blocked this site.' }] }),
  }))
  assert.match(html, /The page changed, so Alpha did not click\./)
  assert.match(html, /Saved catalog\.pdf/)
  assert.match(html, /reads like instructions to an AI/)
  assert.match(html, /Parts of this page were not loaded because of site rules\./)
})

/* ---------- Reader view ---------- */

const readerDoc = (blocks, over = {}) => ({
  url: 'https://x.example.com/a', title: 'Brake pads', siteName: 'X', description: '', lang: 'en', blocks, links: [], forms: [], text: 'x', truncated: false,
  signInRequired: false, hasFields: false, injection: { suspected: false, hits: [], hiddenText: false }, chars: 10, ...over,
})
const reader = (doc, images = true) => draw(h(ReaderView, { doc, finalUrl: doc.url, images, onOpen() {}, onLive() {} }))

test('Reader view draws every kind of block as plain text on the page', () => {
  const html = reader(readerDoc([
    { k: 'h', level: 1, runs: [{ t: 'Brake pads' }] }, { k: 'p', runs: [{ t: 'Fits ' }, { t: 'Civic', b: true }] },
    { k: 'li', depth: 0, ordered: true, index: 1, runs: [{ t: 'Remove wheel' }] }, { k: 'li', depth: 0, ordered: true, index: 2, runs: [{ t: 'Fit pads' }] },
    { k: 'quote', runs: [{ t: 'Check torque' }] }, { k: 'pre', text: 'P0420' }, { k: 'table', rows: [['Part', 'Price'], ['A123', '$40']], header: true },
    { k: 'facts', title: 'Specs', rows: [['Position', 'Front']] }, { k: 'form', summary: 'A search form.' }, { k: 'hr' },
  ]))
  for (const word of ['Brake pads', 'Civic', 'Remove wheel', 'Fit pads', 'Check torque', 'P0420', 'A123', '\\$40', 'Position', 'Front', 'This page has a form\\.']) assert.match(html, new RegExp(word))
  assert.match(html, /<th scope="col">Part<\/th>/)
  assert.doesNotMatch(html, DATABASE_WORDS)
})

test('text from a website is never drawn as code, and only web and phone links become links', () => {
  const html = reader(readerDoc([
    { k: 'p', runs: [{ t: '<script>alert(1)</script><img src=x onerror=alert(2)>' }] },
    { k: 'p', runs: [{ t: 'bad', href: 'javascript:alert(1)' }, { t: 'data', href: 'data:text/html,<b>x</b>' }, { t: 'web', href: 'https://x.example.com/b' }, { t: '713 555 0142', href: 'tel:+17135550142' }] },
  ]))
  assert.doesNotMatch(html, /<script/i)
  assert.doesNotMatch(html, /<img src=x/i)
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/)
  assert.doesNotMatch(html, /href="javascript:/i)
  assert.doesNotMatch(html, /href="data:/i)
  assert.match(html, /href="https:\/\/x\.example\.com\/b"/)
  assert.match(html, /rel="nofollow noopener noreferrer"/)
  assert.match(html, /href="tel:\+17135550142"/)
})

test('pictures load only through Alpha, and show their description when pictures are off', () => {
  const blocks = [{ k: 'img', src: 'https://x.example.com/i.png?a=1&b=2', alt: 'Pads' }, { k: 'img', src: 'data:image/svg+xml;base64,AAAA', alt: 'Odd' }, { k: 'img', src: 'javascript:alert(1)', alt: '' }]
  const on = reader(readerDoc(blocks), true)
  assert.match(on, /src="\/api\/browser\/image\?u=https%3A%2F%2Fx\.example\.com%2Fi\.png%3Fa%3D1%26amp;b%3D2"|src="\/api\/browser\/image\?u=https%3A%2F%2Fx\.example\.com%2Fi\.png%3Fa%3D1%26b%3D2"/)
  assert.doesNotMatch(on, /src="https?:/)
  assert.doesNotMatch(on, /src="data:/)
  assert.match(on, /referrerPolicy="no-referrer"|referrerpolicy="no-referrer"/i)
  const off = reader(readerDoc(blocks), false)
  assert.doesNotMatch(off, /<img/)
  assert.match(off, /Picture: Pads/)
})

test('Reader view warns about a sign-in, hidden instructions, a long page and boxes to fill in', () => {
  const html = reader(readerDoc([{ k: 'p', runs: [{ t: 'Hello' }] }], {
    signInRequired: true, truncated: true, hasFields: true,
    injection: { suspected: true, hiddenText: true, hits: [{ id: 'override', label: 'x', where: 'hidden', excerpt: '' }] },
  }))
  assert.match(html, /asks for a sign-in/)
  assert.match(html, /hidden text that reads like instructions to an AI/)
  assert.match(html, /Only the first part is shown here/)
  assert.match(html, /Fill them in with Live view/)
})

test('a page with nothing to read offers Live view', () => {
  const html = reader(readerDoc([]))
  assert.match(html, /Nothing to read on this page/)
  assert.match(html, /Try Live view/)
})

/* ---------- when a page cannot be shown ---------- */

const problem = (failure, o = {}) => draw(h(LoadProblem, { failure, url: 'https://www.paypal.com/x', isSearch: false, payload, canManage: true, onOpenSettings() {}, onRetry() {}, ...o }))

test('a blocked site says which rule and why, and only people who can change the rules are sent to the settings', () => {
  const blocked = fail({ blocked: true, code: 'blocked', status: 403, message: 'Payments and investing.' })
  const manager = problem(blocked)
  assert.match(manager, /Alpha blocks this kind of site/)
  assert.match(manager, /Which rule:/)
  assert.match(manager, /Why:/)
  assert.match(manager, /Open browser settings/)
  const staff = problem(blocked, { canManage: false })
  assert.match(staff, /Ask an owner or manager/)
  assert.doesNotMatch(staff, /Open browser settings/)
  const shop = problem(blocked, { url: 'https://www.bad.example.com/x' })
  assert.match(shop, /Your shop blocked this site/)
  assert.match(shop, /bad\.example\.com is on your shop’s block list \(note: Spam\)/)
  assert.match(problem(blocked, { payload: null, url: 'https://www.fine.example.com/' }), /Payments and investing\./)
})

test('a file address, a failed page and a failed search each say what happened and what to do', () => {
  const file = problem(fail({ code: 'type', status: 502, message: 'That address is a PDF, not a web page, so there is nothing to read.' }), { url: 'https://x.example.com/a.pdf' })
  assert.match(file, /This address is a file, not a web page/)
  assert.match(file, /tap the download link/)
  assert.match(file, /Alpha only saves PDFs, pictures and text files\./)
  assert.doesNotMatch(file, /Open in Live view/)
  const page = problem(fail({ message: 'The page took too long. Try again.' }))
  assert.match(page, /This page could not be opened/)
  assert.match(page, />Try again</)
  const search = problem(fail({ message: 'The search site did not answer. Try again in a moment.' }), { isSearch: true, url: '' })
  assert.match(search, /The search did not work/)
  assert.match(search, />Try again</)
})

test('search results are text, only real web addresses are links, and leftovers from the shop’s rules are counted', () => {
  const html = draw(h(SearchResults, { query: 'brake pads', hits: [
    { title: 'RockAuto', url: 'https://www.rockauto.com/', snippet: 'Parts for every car', host: 'rockauto.com' },
    { title: 'Odd', url: 'javascript:alert(1)', snippet: '', host: '' },
  ], hidden: 1, onOpen() {}, onSearchAgain() {} }))
  assert.match(html, /Search: brake pads/)
  assert.match(html, /RockAuto/)
  assert.doesNotMatch(html, /javascript:/)
  assert.match(html, /1 result was left out because of your shop’s site rules/)
  const none = draw(h(SearchResults, { query: 'zzz', hits: [], hidden: 0, onOpen() {}, onSearchAgain() {} }))
  assert.match(none, /No results/)
  assert.match(none, />Search again</)
})

/* ---------- Ask Alpha ---------- */

const baseRun = agentMod.startRun(1, 'find brake pads for a 2016 civic', 'https://shop.example.com/parts', 'phone')
const ask = (run, over = {}) => draw(h(AskPanel, {
  agent: { run, start() {}, stop() {}, retry() {}, answer() {}, clear() {}, liveState: () => null },
  aiEnabled: true, canAct: true, canManage: true, aiReady: true, current: { url: 'https://shop.example.com/parts', label: 'Parts' }, quick: [{ title: 'RockAuto', url: 'https://rockauto.com/' }],
  onOpenSettings() {}, onOpenAiSettings() {}, onOpenPage() {}, onTakeOver() {}, onCopy() {}, onAskAlpha() {}, ...over,
}))

test('Ask Alpha starts with a box for the question, where to start, and what it will and will not do', () => {
  const html = ask(null)
  assert.match(html, /What should Alpha look up\?/)
  assert.match(html, /Start from/)
  assert.match(html, /This page: Parts/)
  assert.match(html, /Search the web/)
  assert.match(html, /RockAuto/)
  assert.match(html, /up to 12 steps/)
  assert.match(html, /Anything that sends, buys or saves a file asks you first/)
  assert.doesNotMatch(html, /Stop/)
})

test('Ask Alpha says why it cannot start: switched off, a role that cannot act, or no AI key yet', () => {
  assert.match(ask(null, { aiEnabled: false }), /switched off for your shop/)
  assert.match(ask(null, { aiEnabled: false, canManage: false }), /switched off/)
  assert.match(ask(null, { canAct: false }), /Your role can look at pages but not fill in or send anything\./)
  const noKey = ask(null, { aiReady: false })
  assert.match(noKey, /needs an AI key/)
  assert.match(noKey, /Open Settings/)
  assert.doesNotMatch(ask(null, { aiReady: true }), /needs an AI key/)
  assert.doesNotMatch(ask(null, { aiReady: null }), /needs an AI key/)
})

test('while Alpha works every step is listed, the picture of what it sees is open, and Stop is on screen', () => {
  const html = ask({ ...baseRun, working: true, steps: [{ n: 1, did: 'Filled in "Search"', result: 'Done.' }], snapshot: snap() })
  assert.match(html, /Alpha is working on step 2 of 12/)
  assert.match(html, /What Alpha has done/)
  assert.match(html, /1\.<\/span> Filled in/)
  assert.match(html, /Working on this step…/)
  assert.match(html, />Stop</)
  assert.match(html, /<details open=""/)
  assert.match(html, /Hide what Alpha sees/)
  assert.doesNotMatch(html, /What should Alpha look up\?/)
})

test('a send, a purchase or a download stops at the approval card with Stop still there', () => {
  const html = ask({ ...baseRun, status: 'approval', steps: [{ n: 1, did: 'Tapped "Send"', result: 'Waiting for your OK' }], snapshot: snap(), approval: { details: details(), approvalId: 'a1', action: null, phase: 'asking', error: '', actor: 'ai' } })
  assert.match(html, /Alpha wants to do this\./)
  assert.match(html, /Approve and send/)
  assert.match(html, /Do not do this/)
  assert.match(html, />Stop</)
})

test('when Alpha needs the person it says what and offers Take over', () => {
  const html = ask({ ...baseRun, status: 'needs_you', message: 'Sign in on the site first.', snapshot: snap({ signInRequired: true }) })
  assert.match(html, /Alpha needs you/)
  assert.match(html, /Sign in on the site first\./)
  assert.match(html, />Take over</)
  assert.match(html, /Open in your own browser/)
  assert.match(html, />Stop</)
})

test('an answer shows the words Alpha quoted, where they came from, and how to use it', () => {
  const html = ask({ ...baseRun, status: 'done', steps: [{ n: 1, did: 'Finished', result: 'Answer matches the page' }], visited: ['https://shop.example.com/parts', 'https://shop.example.com/brakes'], snapshot: snap(),
    answer: { text: 'Part A123', evidence: 'Front pads A123', verified: true, sourceUrl: 'https://shop.example.com/parts', sourceTitle: 'Parts' } })
  assert.match(html, /Alpha found this/)
  assert.match(html, /Part A123/)
  assert.match(html, /What the page says/)
  assert.match(html, /Front pads A123/)
  assert.match(html, /The words Alpha quoted are on the page/)
  assert.match(html, /Sources/)
  assert.match(html, /shop\.example\.com\/brakes/)
  assert.match(html, /Copy/)
  assert.match(html, /Ask Alpha about this/)
  assert.match(html, />Take over</)
  assert.match(html, /Ask something else/)
  assert.doesNotMatch(html, />Stop</)
})

test('an answer that does not match the page is flagged', () => {
  const html = ask({ ...baseRun, status: 'done', visited: [], answer: { text: 'Part A999', evidence: 'x', verified: false, sourceUrl: 'https://shop.example.com/parts', sourceTitle: '' } })
  assert.match(html, /Alpha could not match this answer to the page\. Check it on the page before you rely on it\./)
  assert.doesNotMatch(html, /The words Alpha quoted are on the page/)
})

test('a stopped or failed run says why, and a failed one can be tried again', () => {
  assert.match(ask({ ...baseRun, status: 'stopped', message: agentMod.STOPPED_WORDS, snapshot: snap() }), /Stopped\. A step that was already running may have finished\./)
  const failed = ask({ ...baseRun, status: 'failed', message: 'Add your AI key in Settings so Alpha can look things up for you.' })
  assert.match(failed, /Alpha could not continue/)
  assert.match(failed, /Add your AI key in Settings/)
  assert.match(failed, />Try again</)
})

/* ---------- settings, activity, start page ---------- */

const settingsSheet = (api, canManage = true) => draw(h(SettingsSheet, { open: true, onClose() {}, settings: api, canManage }))

test('the settings sheet has the master switch, both lists, the built-in list, quick sites and saved pages', () => {
  const html = settingsSheet(settingsApi(payload))
  for (const text of ['Let Alpha look things up', 'Which sites can be opened', 'Allow list', 'Block list', 'Sites Alpha blocks by default', 'Quick sites', 'Saved pages', 'Built in', 'bad\\.example\\.com', 'good\\.example\\.com', 'Add to allow list', 'Add to block list', 'Add quick site']) {
    assert.match(html, new RegExp(text), text)
  }
  assert.match(html, /role="switch"/)
  assert.match(html, /Show the list \(2 sites\)/)
  assert.match(html, /You cannot change this list/)
  assert.doesNotMatch(html, DATABASE_WORDS)
})

test('someone who cannot manage sees the settings but has nothing to change them with', () => {
  const html = settingsSheet(settingsApi({ ...payload, perms: { canAct: true, canManage: false } }), false)
  assert.match(html, /Only an owner, admin or manager can change these settings/)
  assert.doesNotMatch(html, /Add to allow list|Add to block list|Add quick site/)
  assert.doesNotMatch(html, />Remove</)
  assert.match(html, /disabled=""/)
})

test('saved parts that need the one-time setup say so in plain words and never show database text', () => {
  const html = settingsSheet(settingsApi({ ...payload, missing: { settings: true, rules: true, bookmarks: true } }))
  assert.match(html, /Saving these settings needs a one-time setup\./)
  assert.match(html, /Saving site rules needs a one-time setup\./)
  assert.match(html, /Saving your own quick sites needs a one-time setup\./)
  assert.match(html, /built-in block list/i)
  assert.doesNotMatch(html, DATABASE_WORDS)
  assert.doesNotMatch(html, /Add to allow list|Add to block list|Add quick site/)
})

test('the settings sheet has a loading state and an error state with Try again', () => {
  assert.match(settingsSheet(settingsApi(null, 'loading')), /Loading settings/)
  const error = settingsSheet(settingsApi(null, 'error'))
  assert.match(error, /Settings could not be loaded/)
  assert.match(error, />Try again</)
})

test('the activity sheet opens on a loading state', () => {
  const html = draw(h(ActivitySheet, { open: true, onClose() {} }))
  assert.match(html, /Browser activity/)
  assert.match(html, /Loading activity/)
  assert.equal(draw(h(ActivitySheet, { open: false, onClose() {} })), '')
})

test('the start page shows quick sites, saved pages, and each of its other states in words', () => {
  const start = api => draw(h(StartPage, { settings: api, aiEnabled: true, onOpen() {}, onAsk() {}, onOpenSettings() {} }))
  const full = start(settingsApi(payload))
  assert.match(full, /Ask Alpha to look this up/)
  assert.match(full, /Recall check/)
  assert.match(full, /nhtsa\.gov\/recalls/)
  assert.match(full, /Saved pages/)
  assert.match(full, /My saved page/)
  assert.match(start(settingsApi(null, 'loading')), /Loading quick sites/)
  const error = start(settingsApi(null, 'error'))
  assert.match(error, /Quick sites could not be loaded/)
  assert.match(error, /You can still type an address or search above/)
  assert.match(error, />Try again</)
  const empty = start(settingsApi({ ...payload, bookmarks: [] }))
  assert.match(empty, /No quick sites yet/)
  assert.match(empty, /Open browser settings/)
  const off = draw(h(StartPage, { settings: settingsApi(payload), aiEnabled: false, onOpen() {}, onAsk() {}, onOpenSettings() {} }))
  assert.match(off, /Alpha lookups are switched off for your shop/)
})

/* ---------- tabs, address bar, page tools, the whole screen ---------- */

test('tabs are named, can be closed, and a new one can be opened', () => {
  let state = tabsMod.initialTabs()
  state = tabsMod.tabsReducer(state, { type: 'new' })
  state = tabsMod.tabsReducer(state, { type: 'go', tabId: state.activeId, target: { kind: 'page', url: 'https://www.rockauto.com/' }, mode: 'reader', viewport: 'phone' })
  const html = draw(h(TabStrip, { tabs: state.tabs, activeId: state.activeId, onSelect() {}, onClose() {}, onNew() {} }))
  assert.match(html, /role="tablist"/)
  assert.match(html, /New tab/)
  assert.match(html, /rockauto\.com/)
  assert.match(html, /aria-label="Close tab: New tab"/)
  assert.match(html, /aria-label="New tab"/)
})

test('the address bar takes a web address or words, and has Back, Forward and Reload', () => {
  const html = draw(h(AddressBar, { shown: 'rockauto.com', onSubmit: () => null, canBack: true, canForward: false, canReload: true, onBack() {}, onForward() {}, onReload() {} }))
  assert.match(html, /Type a web address or search/)
  assert.match(html, /value="rockauto\.com"/)
  assert.match(html, /aria-label="Back"/)
  assert.match(html, /aria-label="Forward"/)
  assert.match(html, /aria-label="Reload this page"/)
  assert.match(html, /font-size|form-input/)
})

test('the tools for a page: Copy, Ask Alpha about this, Look up with Alpha, Save page, and a way out to the real site', () => {
  const html = draw(h(PageTools, { hasText: true, url: 'https://x.example.com/a', canSave: true, saving: false, aiEnabled: true, onCopy() {}, onAskAbout() {}, onLookUp() {}, onSave() {} }))
  for (const text of ['Copy', 'Ask Alpha about this', 'Look up with Alpha', 'Save page', 'Open in your own browser']) assert.match(html, new RegExp(text))
  const idle = draw(h(PageTools, { hasText: false, url: 'https://x.example.com/a', canSave: false, saving: false, aiEnabled: false, onCopy() {}, onAskAbout() {}, onLookUp() {}, onSave() {} }))
  assert.ok((idle.match(/disabled=""/g) || []).length === 4)
  assert.equal(draw(h(PageTools, { hasText: true, url: 'javascript:alert(1)', canSave: true, saving: false, aiEnabled: true, onCopy() {}, onAskAbout() {}, onLookUp() {}, onSave() {} })).includes('javascript:'), false)
})

test('the Browser screen draws as a new tab with everything reachable, with no sign of a crash', () => {
  const html = draw(h(BrowserScreen))
  assert.match(html, /<h1[^>]*>Browser<\/h1>/)
  assert.match(html, /Activity/)
  assert.match(html, /Settings/)
  assert.match(html, /Browse/)
  assert.match(html, /Ask Alpha/)
  assert.match(html, /Type a web address or search/)
  assert.match(html, /Look things up on public websites/)
  assert.doesNotMatch(html, DATABASE_WORDS)
  const page = draw(h(BrowserPage))
  assert.match(page, /Browser/)
})

/* ---------- house rules and where it is reachable from ---------- */

const browserDir = new URL('../src/components/browser/', import.meta.url)
const sources = [
  ...readdirSync(browserDir).filter(f => /\.tsx?$/.test(f)).map(f => [f, readFileSync(new URL(f, browserDir), 'utf8')]),
  ['page.tsx', readFileSync(new URL('../src/app/(app)/browser/page.tsx', import.meta.url), 'utf8')],
]

test('the screen follows the house design rules: tokens only, no emoji, no uppercase, no shadows, no gradients', () => {
  for (const [name, text] of sources) {
    assert.doesNotMatch(text, /\buppercase\b|tracking-wide|tracking-wider|\bshadow\b|shadow-|gradient|backdrop-blur/, name)
    assert.doesNotMatch(text, /\btext-white\b|\bbg-white\b|\btext-gray-|\bbg-gray-|\bborder-gray-|\bbg-black\b|\btext-black\b/, name)
    assert.doesNotMatch(text, /(?:text|bg|border|ring|fill|stroke)-\[#[0-9a-fA-F]{3,8}\]/, name)
    assert.doesNotMatch(text, /#[0-9a-fA-F]{6}\b/, name)
    assert.doesNotMatch(text, /\p{Extended_Pictographic}/u, name)
  }
})

test('nothing from a website is ever put into the page as markup, and only the one api file talks to the server', () => {
  for (const [name, text] of sources) {
    assert.doesNotMatch(text, /dangerouslySetInnerHTML|\.innerHTML\b|document\.write|\beval\(|new Function\(|<iframe/, name)
    if (name !== 'api.ts') assert.doesNotMatch(text, /\bfetch\(/, name)
  }
})

test('the Browser is in the menu under "In the shop"', async () => {
  const nav = await import(new URL('../src/components/shell/nav.ts', import.meta.url).href)
  const group = nav.MORE_GROUPS.find(g => g.label === 'In the shop')
  assert.ok(group)
  assert.deepEqual(group.items.filter(i => i.href === '/browser'), [{ href: '/browser', label: 'Browser', icon: 'globe' }])
  assert.equal(nav.MORE_GROUPS.flatMap(g => g.items).filter(i => i.href === '/browser').length, 1)
})
