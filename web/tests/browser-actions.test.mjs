import test from 'node:test'
import assert from 'node:assert/strict'
import * as actions from '../src/lib/browser/actions.ts'

// Built from pieces so secret scanners do not mistake this test value for a real key.
const FAKE_SECRET_KEY = ['sk', 'live', 'abcdefghijklmnopqrstuvwx'].join('_')

function control(over = {}) {
  return {
    tag: 'input', type: 'text', name: '', id: '', label: '', placeholder: '', ariaLabel: '', title: '', autocomplete: '', text: '', href: '', value: '',
    disabled: false, checked: false, formIndex: -1, rect: { x: 0, y: 0, w: 100, h: 40 }, options: [], loc: 'form > input', consent: false, download: false, ...over,
  }
}
const getForm = (over = {}) => ({ index: 0, method: 'get', action: 'https://shop.example/search', sameOrigin: true, fieldCount: 1, ...over })
const postForm = (over = {}) => getForm({ method: 'post', action: 'https://shop.example/contact', ...over })
const ctx = (forms = []) => ({ pageUrl: 'https://shop.example/', forms })

/* ---------- which fields are credentials ---------- */

test('password, card, security code, one-time code, bank and identity fields are recognised however the page names them', () => {
  const cases = [
    [{ type: 'password' }, 'password'],
    [{ name: 'user_pwd' }, 'password'],
    [{ autocomplete: 'current-password' }, 'password'],
    [{ placeholder: 'Passphrase' }, 'password'],
    [{ autocomplete: 'cc-number' }, 'card'],
    [{ name: 'card_number' }, 'card'],
    [{ label: 'Credit card' }, 'card'],
    [{ name: 'expiry_date' }, 'card'],
    [{ autocomplete: 'cc-csc' }, 'security_code'],
    [{ name: 'cvv' }, 'security_code'],
    [{ label: 'Security code' }, 'security_code'],
    [{ autocomplete: 'one-time-code' }, 'otp'],
    [{ label: 'Verification code' }, 'otp'],
    [{ placeholder: 'Enter your 2FA token' }, 'otp'],
    [{ name: 'ssn' }, 'ssn'],
    [{ label: 'Social security number' }, 'ssn'],
    [{ name: 'routing_number' }, 'bank'],
    [{ label: 'Bank account' }, 'bank'],
    [{ label: 'Date of birth' }, 'identity'],
    [{ label: "Driver's licence number" }, 'identity'],
  ]
  for (const [over, expected] of cases) assert.equal(actions.sensitiveKind(control(over)), expected, JSON.stringify(over))
  for (const over of [{ name: 'q', placeholder: 'Search parts' }, { name: 'vin' }, { label: 'Part number' }, { name: 'zip' }, { label: 'Phone' }, { label: 'Pinterest' }]) {
    assert.equal(actions.sensitiveKind(control(over)), null, JSON.stringify(over))
  }
})

test('values that look like card numbers, social security numbers or secret keys are caught before they are typed', () => {
  assert.equal(actions.looksLikeSecretValue('4111 1111 1111 1111'), 'card')
  assert.equal(actions.looksLikeSecretValue('4111-1111-1111-1111'), 'card')
  assert.equal(actions.looksLikeSecretValue('my card is 5500005555555559 thanks'), 'card')
  assert.equal(actions.looksLikeSecretValue('123-45-6789'), 'ssn')
  assert.equal(actions.looksLikeSecretValue(FAKE_SECRET_KEY), 'secret')
  assert.equal(actions.looksLikeSecretValue('AKIAABCDEFGHIJKLMNOP'), 'secret')
  assert.equal(actions.looksLikeSecretValue('ghp_abcdefghijklmnopqrstuvwxyz0123456789'), 'secret')
  // A VIN, an order number, a part number and a phone number are not secrets.
  for (const v of ['1HGCM82633A004352', 'ORD-20260115-0042', 'MK1234-5678', '555-123-4567', '2024', 'brake pads front 2019 civic', '12345678901234']) {
    assert.equal(actions.looksLikeSecretValue(v), null, v)
  }
})

test('sensitive fields never show their value', () => {
  assert.equal(actions.maskValue(control({ type: 'password' }), 'hunter2'), '••••••')
  assert.equal(actions.maskValue(control({ name: 'cvv' }), '123'), '••••••')
  assert.equal(actions.maskValue(control({ name: 'q' }), 'brake pads'), 'brake pads')
  assert.equal(actions.maskValue(control({ name: 'q' }), ''), '')
})

/* ---------- what a click needs ---------- */

test('clicking in a credential field is handed to the person', () => {
  const r = actions.classifyClick(control({ type: 'password' }), ctx())
  assert.equal(r.level, 'handoff')
  assert.equal(r.reason, 'credential')
  assert.equal(actions.classifyClick(control({ autocomplete: 'cc-number' }), ctx()).level, 'handoff')
})

test('a sign-in button or any form with a password field is handed to the person, whatever the button says', () => {
  const login = actions.classifyClick(control({ tag: 'button', type: 'submit', text: 'Log in', formIndex: 0 }), ctx([postForm()]))
  assert.deepEqual([login.level, login.reason], ['handoff', 'sign_in'])
  const sneaky = actions.classifyClick(control({ tag: 'button', type: 'submit', text: 'Continue', formIndex: 0 }), ctx([postForm({ hasPassword: true })]))
  assert.deepEqual([sneaky.level, sneaky.reason], ['handoff', 'sign_in'])
  const enter = actions.classifyClick(control({ name: 'email', label: 'Email', formIndex: 0 }), ctx([postForm({ hasPassword: true })]), true)
  assert.deepEqual([enter.level, enter.reason], ['handoff', 'sign_in'])
  // Only opening the sign-in page is fine; typing in it is what stops.
  assert.equal(actions.classifyClick(control({ tag: 'a', text: 'Sign in', href: 'https://shop.example/login' }), ctx()).level, 'safe')
})

test('a captcha is handed to the person', () => {
  const r = actions.classifyClick(control({ tag: 'button', type: 'button', text: "I'm not a robot" }), { pageUrl: 'https://x.example/', forms: [], captcha: true })
  assert.deepEqual([r.level, r.reason], ['handoff', 'captcha'])
})

test('ordinary links and same-site searches go straight through', () => {
  assert.equal(actions.classifyClick(control({ tag: 'a', text: 'Brake pads', href: 'https://shop.example/pads' }), ctx()).level, 'safe')
  const search = actions.classifyClick(control({ tag: 'button', type: 'submit', text: 'Search', formIndex: 0 }), ctx([getForm()]))
  assert.equal(search.level, 'safe')
  const enter = actions.classifyClick(control({ name: 'q', placeholder: 'Search parts', formIndex: 0 }), ctx([getForm()]), true)
  assert.equal(enter.level, 'safe')
  assert.equal(actions.classifyClick(control({ tag: 'button', type: 'button', text: 'Next page' }), ctx()).level, 'safe')
  assert.equal(actions.classifyClick(control({ type: 'checkbox', label: 'In stock only', formIndex: 0 }), ctx([getForm()])).level, 'safe')
})

test('cookie banner buttons are not a decision about the shop, but agreeing to terms always is', () => {
  assert.equal(actions.classifyClick(control({ tag: 'button', type: 'button', text: 'Accept cookies', consent: true }), ctx()).level, 'safe')
  const terms = actions.classifyClick(control({ tag: 'button', type: 'button', text: 'I agree to the terms of service', consent: true }), ctx())
  assert.deepEqual([terms.level, terms.kind], ['approve', 'terms'])
  const box = actions.classifyClick(control({ type: 'checkbox', label: 'I agree to the terms and conditions', formIndex: 0 }), ctx([postForm()]))
  assert.deepEqual([box.level, box.kind], ['approve', 'terms'])
})

test('purchases, deletes, downloads and messages need approval and say what they are', () => {
  const kinds = (c, forms = [], enter = false) => { const r = actions.classifyClick(c, ctx(forms), enter); return r.level === 'approve' ? r.kind : r.level }
  assert.equal(kinds(control({ tag: 'button', type: 'button', text: 'Add to cart' })), 'purchase')
  assert.equal(kinds(control({ tag: 'button', type: 'submit', text: 'Place order', formIndex: 0 }), [postForm()]), 'purchase')
  assert.equal(kinds(control({ tag: 'button', type: 'submit', text: 'Continue', formIndex: 0 }), [postForm({ action: 'https://shop.example/checkout/pay' })]), 'purchase')
  assert.equal(kinds(control({ tag: 'button', type: 'button', text: 'Cancel my order' })), 'delete')
  assert.equal(kinds(control({ tag: 'a', text: 'Delete account', href: 'https://shop.example/delete' })), 'delete')
  assert.equal(kinds(control({ tag: 'a', text: 'Installation guide', href: 'https://shop.example/guide.pdf' })), 'download')
  assert.equal(kinds(control({ tag: 'a', text: 'Brochure', href: 'https://shop.example/get?id=2', download: true })), 'download')
  assert.equal(kinds(control({ tag: 'a', text: 'Download now', href: 'https://shop.example/get' })), 'download')
  assert.equal(kinds(control({ tag: 'button', type: 'submit', text: 'Send message', formIndex: 0 }), [postForm()]), 'send')
  assert.equal(kinds(control({ tag: 'button', type: 'submit', text: 'Request a quote', formIndex: 0 }), [postForm()]), 'send')
  assert.equal(kinds(control({ tag: 'button', type: 'submit', text: 'Go', formIndex: 0 }), [postForm()]), 'submit')
  assert.equal(kinds(control({ tag: 'button', type: 'submit', text: 'Go', formIndex: 0 }), [getForm({ sameOrigin: false, action: 'https://other.example/q' })]), 'submit')
  assert.equal(kinds(control({ tag: 'button', type: 'submit', text: 'Search', formIndex: -1 })), 'submit')
})

test('a cross-site or posting form is described with the site it goes to', () => {
  const d = actions.describeApproval('submit', { host: 'a.example', url: 'https://a.example/', label: 'Go', why: 'x', fields: [{ label: 'VIN', value: '1HGCM82633A004352' }], actionHost: 'b.example' })
  assert.match(d.summary, /a\.example, which sends it to b\.example/)
  assert.match(d.summary, /1 entry/)
  assert.equal(d.title, 'Send a form')
  const dl = actions.describeApproval('download', { host: 'a.example', url: 'https://a.example/', label: 'guide.pdf', why: 'x', fields: [] })
  assert.match(dl.summary, /never opens or runs it/)
  assert.equal(actions.approvalTitle('purchase'), 'Possible purchase')
  assert.equal(actions.describeApproval('submit', { host: 'a.example', url: 'u', label: 'Go', why: 'x', fields: Array.from({ length: 30 }, (_, i) => ({ label: 'f' + i, value: 'v' })) }).fields.length, 12)
})

/* ---------- approvals are bound to the exact action ---------- */

test('an approval is bound to the page, the control, the method, the destination and every entry shown', () => {
  const base = { kind: 'submit', url: 'https://a.example/form#x', fp: 'abc', method: 'POST', actionUrl: 'https://a.example/send', fields: [{ label: 'Name', value: 'Sam' }, { label: 'VIN', value: '1' }] }
  const same = actions.canonicalAction({ ...base, url: 'https://a.example/form#y', fields: [...base.fields].reverse(), method: 'post' })
  assert.equal(actions.canonicalAction(base), same)
  for (const change of [{ url: 'https://a.example/other' }, { fp: 'abd' }, { kind: 'purchase' }, { method: 'get' }, { actionUrl: 'https://evil.example/send' }, { fields: [{ label: 'Name', value: 'Sam' }, { label: 'VIN', value: '2' }] }, { fields: [{ label: 'Name', value: 'Sam' }] }]) {
    assert.notEqual(actions.canonicalAction({ ...base, ...change }), actions.canonicalAction(base), JSON.stringify(change))
  }
})

/* ---------- requests from the screen ---------- */

test('a live request is cleaned and bounded; anything odd is refused with plain words', () => {
  const ref = { loc: '#q', fp: 'abc123' }
  const ok = actions.parseLiveRequest({ url: 'https://a.example/', actor: 'ai', viewport: 'phone', scrollY: 1234.7, prepared: [{ kind: 'fill', ref, value: 'pads' }], action: { kind: 'click', ref }, approvalId: '123e4567-e89b-12d3-a456-426614174000', tabId: 't_1<script>' })
  assert.equal(ok.ok, true)
  assert.equal(ok.req.actor, 'ai')
  assert.equal(ok.req.viewport, 'phone')
  assert.equal(ok.req.scrollY, 1235)
  assert.equal(ok.req.tabId, 't_1script')
  assert.equal(ok.req.prepared.length, 1)
  assert.equal(ok.req.action.kind, 'click')
  assert.equal(ok.req.approvalId, '123e4567-e89b-12d3-a456-426614174000')

  // Defaults: a person, a desktop screen, no scroll.
  const min = actions.parseLiveRequest({ url: 'https://a.example/' })
  assert.deepEqual([min.ok, min.req.actor, min.req.viewport, min.req.scrollY, min.req.prepared.length], [true, 'user', 'desktop', 0, 0])
  // Only exactly 'ai' is the AI; a bad approval id is dropped.
  assert.equal(actions.parseLiveRequest({ url: 'https://a.example/', actor: 'AI', approvalId: 'x'.repeat(36) }).req.actor, 'user')
  assert.equal(actions.parseLiveRequest({ url: 'https://a.example/', approvalId: 'x'.repeat(36) }).req.approvalId, undefined)

  const refused = [
    null, 'x', {}, { url: 5 }, { url: 'x'.repeat(3000) },
    { url: 'https://a.example/', prepared: Array.from({ length: 31 }, () => ({ kind: 'fill', ref, value: 'a' })) },
    { url: 'https://a.example/', prepared: [{ kind: 'click', ref }] },
    { url: 'https://a.example/', prepared: [{ kind: 'fill', ref: { loc: '#q', fp: 'BAD FP' }, value: 'a' }] },
    { url: 'https://a.example/', action: { kind: 'fill', ref, value: 'a'.repeat(2001) } },
    { url: 'https://a.example/', action: { kind: 'press', key: 'Tab' } },
    { url: 'https://a.example/', action: { kind: 'eval', code: 'alert(1)' } },
    { url: 'https://a.example/', action: { kind: 'click', ref: { loc: 'a\u0000b', fp: 'abc' } } },
    { url: 'https://a.example/', action: { kind: 'click', ref: { loc: '<img>', fp: 'abc' } } },
  ]
  for (const body of refused) {
    const r = actions.parseLiveRequest(body)
    assert.equal(r.ok, false, JSON.stringify(body)?.slice(0, 80))
    assert.ok(r.error.length > 5)
  }
  assert.deepEqual(actions.parseAction({ kind: 'scroll', dy: 99999 }), { kind: 'scroll', dy: 4000 })
  assert.deepEqual(actions.parseAction({ kind: 'scroll', dy: -99999 }), { kind: 'scroll', dy: -4000 })
  assert.equal(actions.parseAction({ kind: 'scroll', dy: 'abc' }), null)
  assert.deepEqual(actions.parseAction({ kind: 'press', key: 'Enter' }), { kind: 'press', key: 'Enter' })
})

test('control kinds, labels and fingerprints', () => {
  assert.equal(actions.controlKind(control({ tag: 'a' })), 'link')
  assert.equal(actions.controlKind(control({ tag: 'button', type: '', formIndex: 0 })), 'submit')
  assert.equal(actions.controlKind(control({ tag: 'button', type: 'button', formIndex: 0 })), 'button')
  assert.equal(actions.controlKind(control({ tag: 'input', type: 'email' })), 'email')
  assert.equal(actions.controlKind(control({ tag: 'input', type: 'file' })), 'file')
  assert.equal(actions.controlKind(control({ tag: 'select' })), 'select')
  assert.equal(actions.isTypable('textarea'), true)
  assert.equal(actions.isTypable('checkbox'), false)
  assert.equal(actions.controlLabel(control({ ariaLabel: '  Search\n parts ' })), 'Search parts')
  assert.equal(actions.controlLabel(control({ tag: 'a' })), 'Link')
  assert.equal(actions.controlLabel(control({ text: 'x'.repeat(200) })).length, 80)
  const a = actions.fingerprint(control({ name: 'q', label: 'Search' }))
  assert.equal(a, actions.fingerprint(control({ name: 'Q', label: ' search ' })))
  assert.notEqual(a, actions.fingerprint(control({ name: 'q', label: 'Buy' })))
  assert.match(a, /^[a-z0-9]+$/)
  assert.ok(a.length <= 40)
})

test('nothing secret is ever typed, by a person or the AI; identity details are never typed by the AI', () => {
  const field = (over) => control({ tag: 'input', type: 'text', ...over })
  assert.equal(actions.vetFill(field({ name: 'q' }), 'brake pads', 'ai'), null)
  assert.equal(actions.vetFill(field({ name: 'vin' }), '1HGCM82633A004352', 'ai'), null)
  assert.equal(actions.vetFill(control({ tag: 'select', type: '' }), '2019', 'ai'), null)
  assert.equal(actions.vetFill(control({ tag: 'textarea', type: '' }), 'Need a quote for front pads', 'user'), null)
  for (const actor of ['user', 'ai']) {
    assert.match(actions.vetFill(field({ type: 'password' }), 'x', actor), /does not type passwords/)
    assert.match(actions.vetFill(field({ autocomplete: 'cc-number' }), '1', actor), /card numbers/)
    assert.match(actions.vetFill(field({ name: 'q' }), '4111 1111 1111 1111', actor), /card number/)
    assert.match(actions.vetFill(field({ name: 'notes' }), 'ssn 123-45-6789', actor), /social security/)
    assert.match(actions.vetFill(field({ name: 'q' }), FAKE_SECRET_KEY, actor), /secret key/)
    assert.match(actions.vetFill(control({ tag: 'input', type: 'file' }), '', actor), /attach files/)
    assert.match(actions.vetFill(field({ name: 'q', disabled: true }), 'x', actor), /turned off/)
  }
  assert.match(actions.vetFill(field({ label: 'Date of birth' }), '1990-01-01', 'ai'), /identity/)
  assert.equal(actions.vetFill(field({ label: 'Date of birth' }), '1990-01-01', 'user'), null)
})

test('what a person typed is never used as the name of a field', () => {
  assert.equal(actions.controlLabel(control({ tag: 'select', type: '', name: 'make', value: 'honda' })), 'make')
  assert.equal(actions.controlLabel(control({ tag: 'input', type: 'search', placeholder: 'Search parts', value: 'brake pads' })), 'Search parts')
  assert.equal(actions.controlLabel(control({ tag: 'input', type: 'submit', value: 'Search' })), 'Search')
})
