import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { loadLib } from './estimates-helper.mjs'

const send = loadLib('doc-send')
const email = loadLib('doc-email')
const links = loadLib('doc-links')
const publicDoc = loadLib('doc-public')
const prefs = loadLib('doc-prefs')

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
const base = { channel: 'email', status: 'Draft', email: 'a@b.co', phone: '713-555-0101', emailReady: true, smsReady: true, optedOut: false }

test('send: a good document can go out by every way, and the reasons it cannot are in plain words', () => {
  for (const channel of ['email', 'sms', 'copy', 'phone']) assert.equal(send.sendBlockReason({ ...base, channel }), '')
  assert.match(send.sendBlockReason({ ...base, status: 'Void' }), /void/)
  assert.match(send.sendBlockReason({ ...base, email: '' }), /no email address/i)
  assert.match(send.sendBlockReason({ ...base, email: 'nope' }), /does not look right/)
  assert.match(send.sendBlockReason({ ...base, emailReady: false }), /not set up/)
  assert.match(send.sendBlockReason({ ...base, channel: 'sms', phone: '' }), /no phone number/i)
  assert.match(send.sendBlockReason({ ...base, channel: 'sms', optedOut: true }), /asked not to get texts/)
  assert.match(send.sendBlockReason({ ...base, channel: 'sms', smsReady: false }), /not set up/)
  // A link that is only copied needs no address, number or provider, only a document that is not void.
  assert.equal(send.sendBlockReason({ ...base, channel: 'copy', email: '', phone: '', emailReady: false, smsReady: false }), '')
  assert.match(send.sendBlockReason({ ...base, channel: 'copy', status: 'Void' }), /void/)
})

test('send: the status the route answers with matches the reason', () => {
  assert.equal(send.sendBlockStatus(''), 200)
  assert.equal(send.sendBlockStatus(send.sendBlockReason({ ...base, emailReady: false })), 503)
  assert.equal(send.sendBlockStatus('We could not check whether this customer asked not to get texts. Try again in a minute.'), 503)
  assert.equal(send.sendBlockStatus(send.sendBlockReason({ ...base, status: 'Void' })), 409)
  assert.equal(send.sendBlockStatus(send.sendBlockReason({ ...base, channel: 'sms', optedOut: true })), 409)
  assert.equal(send.sendBlockStatus(send.sendBlockReason({ ...base, email: '' })), 400)
})

test('send: the good-through date is written in the shop time zone, not UTC', () => {
  // 2026-11-16 02:00 UTC is still the evening of the 15th in Houston.
  assert.equal(send.goodThroughWords('2026-11-16T02:00:00.000Z', 'America/Chicago'), 'November 15, 2026')
  assert.equal(send.goodThroughWords('not a date'), '')
})

const doc = async () => publicDoc.buildPublicDocument({
  doc: { type: 'Estimate', status: 'Draft', doc_number: 'EST-1', customer_name: 'Dana Ruiz', vehicle_year: '2018', vehicle_make: 'Toyota', vehicle_model: 'Camry', tax_rate: 8.25, apply_tax: true,
    parts: [{ name: 'Pads', qty: 1, unitPrice: 80, job: 'Brakes' }], labors: [{ operation: 'Install', hours: 1, rate: 100, job: 'Brakes' }] },
  options: [], prefs: prefs.normalizePrefs(null), shop: { name: 'Alpha', address: '', phone: '(713) 555-0100', email: '', hasLogo: false }, todayIso: '2026-10-16',
})

test('send: the text names the shop, the car and the total, carries the private link and asks for the jobs to be chosen', async () => {
  const d = await doc()
  const text = email.buildSendText({ doc: d, shop: { name: 'Alpha', address: '', phone: '(713) 555-0100', email: '', hasLogo: false }, link: 'https://x.test/sign/abc' })
  assert.match(text, /^Alpha: Hi Dana, your estimate EST-1 for your 2018 Toyota Camry is ready\./)
  assert.match(text, /Total \$\d/)
  assert.match(text, /which jobs to do: https:\/\/x\.test\/sign\/abc/)
  assert.match(text, /Call \(713\) 555-0100\./)
  const invoice = email.buildSendText({ doc: { ...d, kind: 'invoice' }, shop: { name: '', address: '', phone: '', email: '', hasLogo: false }, link: 'https://x.test/sign/abc' })
  assert.doesNotMatch(invoice, /which jobs/)
  assert.doesNotMatch(invoice, /Call/)
})

test('links: an unknown device is said plainly', () => {
  assert.equal(links.deviceLabel('python-urllib/3.13'), 'Unknown device')
  assert.equal(links.deviceLabel('Mozilla/5.0 (Windows NT 10.0) Chrome/120 Safari/537'), 'Chrome on Windows')
})

test('send route: a preview writes nothing, and a blocked send is refused for the same reason the preview showed', () => {
  const route = read('app/api/send-document/route.ts')
  const previewBlock = route.slice(route.indexOf('if (preview) {'), route.indexOf("if (blocked) return NextResponse.json({ error: blocked }"))
  assert.ok(previewBlock.length > 200)
  assert.doesNotMatch(previewBlock, /ensureLink|\.insert\(|\.update\(|sendDurable|logEvent/)
  assert.match(route, /if \(blocked\) return NextResponse\.json\(\{ error: blocked \}, \{ status: sendBlockStatus\(blocked\) \}\)/)
  // The link is made only after the block check, and the document is marked sent only after the message was accepted.
  assert.ok(route.indexOf('if (blocked) return') < route.indexOf('ensureLink('))
  assert.ok(route.indexOf('sendDurableSms({') < route.lastIndexOf("update({ sent_at: nowIso })"))
  assert.ok(route.indexOf('sendDurableEmail({') < route.lastIndexOf("update({ sent_at: nowIso })"))
  // A text from the owner's own phone sends nothing: the document is marked sent only after the owner says they pressed Send.
  const phoneBlock = route.slice(route.indexOf("if (channel === 'phone') {"), route.indexOf("if (channel === 'copy') {"))
  assert.ok(phoneBlock.length > 300)
  assert.doesNotMatch(phoneBlock, /sendDurable/)
  assert.ok(phoneBlock.indexOf('if (!confirmSent) {') < phoneBlock.indexOf("update({ sent_at: nowIso })"))
  assert.match(phoneBlock.slice(phoneBlock.indexOf('if (!confirmSent) {'), phoneBlock.indexOf("update({ sent_at: nowIso })")), /return NextResponse\.json/)
  // A copied link tells nobody and does not mark the document sent.
  const copy = route.slice(route.indexOf("if (channel === 'copy') {"), route.indexOf('A deliberate second send'))
  assert.doesNotMatch(copy, /sent_at|sendDurable/)
  // Both providers are only reached through the durable senders with a key, and the texting list failing stops a text.
  assert.match(route, /consentUnknown = true/)
  assert.match(route, /Idempotency-Key/)
  // Viewers cannot send.
  assert.match(route, /auth\.role === 'viewer'\) return forbidden\(\)/)
})

test('customer page: reading the link never counts a view, and the view is counted only by the page after it has drawn', () => {
  const respond = read('lib/doc-respond.ts')
  const page = respond.slice(respond.indexOf('export async function handlePage'), respond.indexOf('export async function handleView'))
  assert.ok(page.length > 500)
  assert.doesNotMatch(page, /recordView|\.update\(|\.insert\(|logEvent/)
  assert.match(respond, /export async function handleView/)
  const route = read('app/api/sign/route.ts')
  assert.match(route, /body\.action === 'view'\) return handleView/)
  assert.match(route, /body\.action === 'respond'\) return handleRespond/)
  // The new links answer first and the older sign-only links fall through unchanged.
  assert.match(route, /const page = await handlePage\(req, token, db\)\s*if \(page\) return page/)
})

test('customer page: an answer sends the page fingerprint and every job decision, and the total shown comes from the server', () => {
  const view = read('app/sign/[token]/LinkView.tsx')
  assert.match(view, /viewHash: doc\.contentHash/)
  assert.match(view, /action: 'respond'/)
  assert.match(view, /action: 'preview'/)
  assert.match(view, /action: 'view'/)
  // Nothing is approved on the customer's behalf without a visible choice per job, and declining everything needs no signature.
  assert.match(view, /pending\.map\(g => \[g\.key, 'approve'/)
  assert.match(view, /if \(acceptsAny\) \{/)
  assert.match(view, /doc\.requireSignature/)
})

test('signed record route: the seal is checked against the stored row, with the time spelled the way it was sealed', () => {
  const route = read('app/api/signature/route.ts')
  assert.match(route, /verifySignatureRecord\(/)
  assert.match(route, /signedAt: isoOf\(row\.signed_at\)/)
  assert.match(route, /source: 'legacy'/)
  assert.match(route, /\.eq\('shop_id', auth\.shopId\)/)
})
