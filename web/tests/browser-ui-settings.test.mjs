import test from 'node:test'
import assert from 'node:assert/strict'
import * as s from '../src/components/browser/settings.ts'
import * as act from '../src/components/browser/activity.ts'

const RULE_A = 'a0000000-0000-4000-8000-000000000001'
const RULE_B = 'b0000000-0000-4000-8000-000000000002'

const payload = (over = {}) => s.cleanSettingsPayload({
  ok: true,
  settings: { mode: 'open', aiEnabled: true, readerImages: true },
  rules: [{ id: RULE_A, host: 'bad.example.com', rule: 'block', note: 'Spam' }, { id: RULE_B, host: 'good.example.com', rule: 'allow' }],
  bookmarks: [
    { id: 'builtin-recalls', title: 'Recall check', url: 'https://www.nhtsa.gov/recalls', kind: 'quick', position: 0, builtin: true },
    { id: 'c0000000-0000-4000-8000-000000000003', title: 'Our supplier', url: 'https://supplier.example.com/', kind: 'quick', position: 50 },
    { id: 'd0000000-0000-4000-8000-000000000004', title: 'Saved brake page', url: 'https://x.example.com/brakes', kind: 'saved', position: 100 },
  ],
  missing: { settings: false, rules: false, bookmarks: false },
  perms: { canAct: true, canManage: true },
  aiReady: true,
  defaultBlocked: [
    { host: 'chase.com', why: 'Banking and cards. Alpha never handles bank sign-ins.' },
    { host: 'wellsfargo.com', why: 'Banking and cards. Alpha never handles bank sign-ins.' },
    { host: 'paypal.com', why: 'Payments and investing. Alpha never handles payment sign-ins.' },
    { host: 'accounts.google.com', why: 'Account sign-in or email. Open these in your own browser.' },
  ],
  ...over,
})

/* ---------- reading the settings answer ---------- */

test('an answer that is missing, empty or the wrong shape becomes safe defaults and never throws', () => {
  for (const bad of [null, undefined, '', 'text', 7, [], [1, 2], { ok: true }, { settings: 'x', rules: 'x', bookmarks: 5, missing: 3, perms: [], defaultBlocked: {} }]) {
    const p = s.cleanSettingsPayload(bad)
    assert.deepEqual(p.settings, { mode: 'open', aiEnabled: true, readerImages: true })
    assert.deepEqual(p.rules, [])
    assert.deepEqual(p.bookmarks, [])
    assert.deepEqual(p.defaultBlocked, [])
    assert.deepEqual(p.missing, { settings: false, rules: false, bookmarks: false })
    assert.equal(p.aiReady, false)
    assert.deepEqual(p.perms, { canAct: true, canManage: false })
  }
  assert.deepEqual(s.defaultPayload().perms, s.UNKNOWN_PERMS)
})

test('who may change things comes only from the server, and someone not listed cannot', () => {
  assert.deepEqual(payload().perms, { canAct: true, canManage: true })
  assert.deepEqual(payload({ perms: { canAct: true, canManage: false } }).perms, { canAct: true, canManage: false })
  assert.deepEqual(payload({ perms: { canAct: false, canManage: false } }).perms, { canAct: false, canManage: false })
  assert.equal(payload({ perms: { canManage: 'yes' } }).perms.canManage, false)
})

test('settings that are off or odd are read the way the server reads them', () => {
  const p = payload({ settings: { mode: 'allowlist', aiEnabled: false, readerImages: false } })
  assert.deepEqual(p.settings, { mode: 'allowlist', aiEnabled: false, readerImages: false })
  assert.equal(payload({ settings: { mode: 'weird' } }).settings.mode, 'open')
  assert.equal(payload({ settings: {} }).settings.aiEnabled, true)
})

test('rules and saved sites that cannot be understood are dropped, not shown', () => {
  const p = payload({
    rules: [{ id: RULE_A, host: 'ok.example.com', rule: 'allow' }, { host: '', rule: 'block' }, { host: 'x.com', rule: 'maybe' }, 'nope', null],
    bookmarks: [
      { id: 'builtin-x', title: 'A', url: 'https://a.example.com/', kind: 'quick', position: 1 },
      { id: 'e', title: 'Bad', url: 'javascript:alert(1)', kind: 'quick' },
      { id: 'f', title: '', url: 'https://b.example.com/', kind: 'weird' },
      7,
    ],
  })
  assert.deepEqual(p.rules, [{ id: RULE_A, host: 'ok.example.com', rule: 'allow', note: '' }])
  assert.equal(p.bookmarks.length, 2)
  assert.equal(p.bookmarks[0].builtin, true)
  assert.equal(p.bookmarks[1].title, 'https://b.example.com/')
  assert.equal(p.bookmarks[1].kind, 'quick')
  assert.equal(p.bookmarks[1].builtin, false)
})

test('the parts of the database that are not set up yet are carried through so the screen can say so', () => {
  assert.deepEqual(payload({ missing: { settings: true, rules: true, bookmarks: false } }).missing, { settings: true, rules: true, bookmarks: false })
  assert.deepEqual(payload({ missing: { settings: 'true' } }).missing, { settings: false, rules: false, bookmarks: false })
})

test('quick sites and saved pages are listed in their own order', () => {
  const p = payload()
  assert.deepEqual(s.quickSites(p).map(b => b.title), ['Recall check', 'Our supplier'])
  assert.deepEqual(s.savedPages(p).map(b => b.title), ['Saved brake page'])
  assert.deepEqual(s.quickSites(null), [])
  assert.deepEqual(s.savedPages(null), [])
  assert.deepEqual(s.sortRules(p.rules, 'block').map(r => r.host), ['bad.example.com'])
  assert.deepEqual(s.sortRules(p.rules, 'allow').map(r => r.host), ['good.example.com'])
})

/* ---------- which rule stopped a page ---------- */

test('a page on the shop’s block list says which rule, with its note, and that the shop can change it', () => {
  const why = s.explainBlock('https://www.bad.example.com/page', payload(), 'Your shop blocked this site.')
  assert.equal(why.code, 'shop_blocked')
  assert.equal(why.title, 'Your shop blocked this site')
  assert.equal(why.rule.host, 'bad.example.com')
  assert.ok(why.overridable)
  assert.match(why.lines[0], /^Which rule: bad\.example\.com is on your shop’s block list \(note: Spam\)\./)
  assert.match(why.lines[1], /^Why: /)
})

test('a site that is not on the allow list says so when the shop only opens listed sites', () => {
  const why = s.explainBlock('https://random.example.org/', payload({ settings: { mode: 'allowlist', aiEnabled: true, readerImages: true } }), '')
  assert.equal(why.code, 'not_allowed')
  assert.match(why.lines[0], /^Which rule: your shop is set to open only sites on its allow list/)
  assert.match(why.lines[1], /^Why: this site is on neither list/)
  const ok = s.explainBlock('https://supplier.example.com/x', payload({ settings: { mode: 'allowlist', aiEnabled: true, readerImages: true } }), 'The server said something')
  assert.equal(ok.code, 'unknown')
  assert.deepEqual(ok.lines, ['The server said something'])
})

test('a site on the built-in list names the list, the entry and the reason', () => {
  const why = s.explainBlock('https://www.paypal.com/signin', payload(), '')
  assert.equal(why.code, 'default_blocked')
  assert.equal(why.builtin.host, 'paypal.com')
  assert.match(why.lines[0], /^Which rule: Alpha’s built-in block list \(paypal\.com\)\./)
  assert.match(why.lines[1], /^Why: Payments and investing/)
  assert.match(why.lines[2], /allow this site in the browser settings/)
  assert.ok(why.overridable)
})

test('a site the shop allowed is opened even though the built-in list blocks it', () => {
  const p = payload({ rules: [{ id: RULE_B, host: 'paypal.com', rule: 'allow' }] })
  assert.equal(s.explainBlock('https://paypal.com/', p, 'The server said no').code, 'unknown')
})

test('when the screen’s copy of the rules does not explain it, the server’s own sentence is shown', () => {
  const fromRedirect = s.explainBlock('https://fine.example.com/', payload(), 'Your shop blocked this site.')
  assert.deepEqual(fromRedirect.lines, ['Your shop blocked this site.'])
  assert.equal(fromRedirect.overridable, false)
  const none = s.explainBlock('https://fine.example.com/', null, 'Payments.')
  assert.equal(none.title, 'This site is blocked')
  assert.deepEqual(none.lines, ['Payments.'])
  assert.deepEqual(s.explainBlock('https://fine.example.com/', null, '').lines, ['A rule stopped this page.'])
})

test('an address that could never be opened is explained as that, not as a rule', () => {
  const why = s.explainBlock('http://192.168.1.5/admin', payload(), 'x')
  assert.equal(why.code, 'invalid')
  assert.equal(why.title, 'That address cannot be opened')
  assert.match(why.lines[0], /numbers are not allowed|private/i)
  assert.equal(s.explainBlock('', payload(), '').code, 'invalid')
})

test('the more specific rule wins, the same way the server decides', () => {
  const p = payload({ rules: [{ id: RULE_A, host: 'example.com', rule: 'block' }, { id: RULE_B, host: 'shop.example.com', rule: 'allow' }] })
  assert.equal(s.explainBlock('https://shop.example.com/', p, 'server').code, 'unknown')
  assert.equal(s.explainBlock('https://other.example.com/', p, 'server').code, 'shop_blocked')
})

/* ---------- the lists in the settings sheet ---------- */

test('the built-in list is grouped by its reason, without the repeated advice', () => {
  const groups = s.groupDefaultBlocked(payload().defaultBlocked)
  assert.deepEqual(groups.map(g => g.why), ['Banking and cards', 'Payments and investing', 'Account sign-in or email'])
  assert.deepEqual(groups[0].hosts, ['chase.com', 'wellsfargo.com'])
  assert.deepEqual(s.groupDefaultBlocked([]), [])
  assert.deepEqual(s.groupDefaultBlocked([{ host: 'x.com', why: '' }]), [{ why: 'Blocked', hosts: ['x.com'] }])
})

test('a typed site name is checked before it is sent, and a site on the other list is moved', () => {
  const rules = payload().rules
  assert.deepEqual(s.checkRuleInput('https://www.New-Site.com/path', 'block', rules), { ok: true, host: 'new-site.com', replaces: null })
  assert.deepEqual(s.checkRuleInput('bad.example.com', 'allow', rules), { ok: true, host: 'bad.example.com', replaces: 'block' })
  const dup = s.checkRuleInput('bad.example.com', 'block', rules)
  assert.equal(dup.ok, false)
  assert.match(dup.message, /already on the block list/)
  for (const bad of ['', '   ', 'localhost', '192.168.0.1', 'not a site']) {
    const r = s.checkRuleInput(bad, 'block', rules)
    assert.equal(r.ok, false, bad)
    assert.equal(r.message, 'Type a site name such as example.com.')
  }
})

test('a quick site needs an address the browser could open, and a missing name becomes the site name', () => {
  assert.deepEqual(s.checkQuickSite('', 'www.napaonline.com'), { ok: true, title: 'napaonline.com', url: 'https://www.napaonline.com/' })
  assert.deepEqual(s.checkQuickSite('  Parts   supplier ', 'https://supplier.example.com/catalog'), { ok: true, title: 'Parts supplier', url: 'https://supplier.example.com/catalog' })
  assert.equal(s.checkQuickSite('x', '').message, 'Type the web address.')
  assert.equal(s.checkQuickSite('x', 'ftp://files.example.com').ok, false)
  assert.equal(s.checkQuickSite('x', 'http://localhost:3000').ok, false)
  assert.equal(s.checkQuickSite('n'.repeat(200), 'a.example.com').title.length, 80)
})

/* ---------- the activity log ---------- */

const item = (over = {}) => ({ id: '1', action: 'browser.visit', at: '2026-10-15T12:00:00Z', who: 'you', host: 'a.example.com', url: 'https://a.example.com/', detail: '', ...over })

test('each kind of entry has its own plain words, and an unknown kind still has some', () => {
  assert.equal(act.activityWord('browser.visit'), 'Opened a page')
  assert.equal(act.activityWord('browser.sent'), 'Sent after an OK')
  assert.equal(act.activityWord('browser.download'), 'Saved a file')
  assert.equal(act.activityWord('browser.blocked'), 'Stopped by a rule')
  assert.equal(act.activityWord('browser.something_new'), 'Browser activity')
  assert.equal(act.whoWord('alpha'), 'Alpha')
  assert.equal(act.whoWord('you'), 'You')
  assert.equal(act.whoWord('teammate'), 'A teammate')
  assert.equal(act.whoWord('???'), 'A teammate')
})

test('every lamp in the log has a word beside it: sent and saved are green, waiting amber, stopped red', () => {
  assert.equal(act.activityLamp(item({ action: 'browser.sent' })), 'green')
  assert.equal(act.activityLamp(item({ action: 'browser.download' })), 'green')
  assert.equal(act.activityLamp(item({ action: 'browser.approval_asked' })), 'amber')
  assert.equal(act.activityLamp(item({ action: 'browser.handoff' })), 'amber')
  assert.equal(act.activityLamp(item({ action: 'browser.blocked' })), 'red')
  assert.equal(act.activityLamp(item({ action: 'browser.ai_step' })), 'blue')
  assert.equal(act.activityLamp(item({ action: 'browser.approval_decided', detail: 'Approved: Press "Send"' })), 'green')
  assert.equal(act.activityLamp(item({ action: 'browser.approval_decided', detail: 'Denied: Press "Send"' })), 'off')
  assert.equal(act.activityLamp(item()), 'off')
})

test('the log can be narrowed to Alpha’s steps, what was sent or saved, or what was stopped', () => {
  const all = [
    item({ id: 'a', who: 'alpha', action: 'browser.ai_step' }), item({ id: 'b', action: 'browser.sent' }), item({ id: 'c', action: 'browser.download' }),
    item({ id: 'd', action: 'browser.blocked' }), item({ id: 'e', action: 'browser.handoff', who: 'alpha' }), item({ id: 'f' }),
  ]
  const ids = f => act.filterActivity(all, f).map(i => i.id)
  assert.deepEqual(ids('all'), ['a', 'b', 'c', 'd', 'e', 'f'])
  assert.deepEqual(ids('alpha'), ['a', 'e'])
  assert.deepEqual(ids('sent'), ['b', 'c'])
  assert.deepEqual(ids('stopped'), ['d', 'e'])
  assert.deepEqual(act.ACTIVITY_FILTERS.map(f => f.key), ['all', 'alpha', 'sent', 'stopped'])
})

test('the activity answer is read without trusting it', () => {
  assert.deepEqual(act.cleanActivity(null), [])
  assert.deepEqual(act.cleanActivity({ items: 'x' }), [])
  const rows = act.cleanActivity({ items: [
    { id: 7, action: 'browser.visit', at: '2026-10-15T12:00:00Z', who: 'alpha', host: 'a.example.com', url: 'https://a.example.com/', detail: 'x'.repeat(500) },
    { action: 'browser.read', who: 'nobody' }, { action: '' }, 'nope', null,
  ] })
  assert.equal(rows.length, 2)
  assert.equal(rows[0].id, 'row-0')
  assert.equal(rows[0].who, 'alpha')
  assert.equal(rows[0].detail.length, 300)
  assert.equal(rows[1].who, 'teammate')
  assert.equal(rows[1].at, '')
})

test('times are said the way a person would say them', () => {
  const now = Date.parse('2026-10-15T12:00:00Z')
  assert.equal(act.agoText('2026-10-15T11:59:40Z', now), 'just now')
  assert.equal(act.agoText('2026-10-15T11:59:00Z', now), '1 minute ago')
  assert.equal(act.agoText('2026-10-15T11:15:00Z', now), '45 minutes ago')
  assert.equal(act.agoText('2026-10-15T11:00:00Z', now), '1 hour ago')
  assert.equal(act.agoText('2026-10-15T07:00:00Z', now), '5 hours ago')
  assert.equal(act.agoText('2026-10-14T11:00:00Z', now), 'yesterday')
  assert.equal(act.agoText('2026-10-12T12:00:00Z', now), '3 days ago')
  assert.match(act.agoText('2026-09-01T12:00:00Z', now), /Sep/)
  assert.equal(act.agoText('not a date', now), '')
  assert.equal(act.agoText('', now), '')
  assert.equal(act.agoText('2026-10-15T13:00:00Z', now), 'just now')
})

test('requests waiting for an OK are read with their own words and safe defaults', () => {
  assert.deepEqual(act.cleanWaiting(null), { items: [], missing: false })
  assert.deepEqual(act.cleanWaiting({ items: [], missing: true }), { items: [], missing: true })
  const w = act.cleanWaiting({ items: [
    { id: 'a1', kind: 'submit', actor: 'ai', summary: 'Press "Send".', host: 'shop.example.com', url: 'https://shop.example.com/', details: { title: 'Send a form' }, expiresAt: '2026-10-15T12:10:00Z' },
    { id: 'a2', kind: 'download' }, { kind: 'x' }, 7,
  ] })
  assert.equal(w.items.length, 2)
  assert.equal(w.items[0].title, 'Send a form')
  assert.equal(w.items[0].actor, 'ai')
  assert.equal(w.items[1].title, 'Needs your OK')
  assert.equal(w.items[1].actor, 'user')
})
