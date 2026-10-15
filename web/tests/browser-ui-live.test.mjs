import test from 'node:test'
import assert from 'node:assert/strict'
import * as l from '../src/components/browser/live.ts'
import * as ap from '../src/components/browser/approval.ts'
import { answerApproval, requestIsOver } from '../src/components/browser/approval-flow.ts'
import { describeFailure } from '../src/components/browser/failure.ts'

const ref = n => ({ loc: `body > :nth-child(${n})`, fp: `fp${n}` })
const control = (over = {}) => ({
  n: 1, ref: ref(1), kind: 'button', label: 'Search', rect: { x: 20, y: 40, w: 100, h: 40 }, inView: true, value: '', checked: false, disabled: false,
  options: [], risk: 'safe', sensitive: null, href: '', ...over,
})
const snap = (over = {}) => ({
  url: 'https://shop.example.com/parts', host: 'shop.example.com', title: 'Parts', status: 200, scrollY: 0, scrollHeight: 2400, viewport: { w: 390, h: 800 },
  image: 'data:image/jpeg;base64,AAAA', controls: [control()], text: 'Brake pads', injection: { suspected: false, hits: [], hiddenText: false },
  signInRequired: false, captcha: false, downloads: [], blocked: [], prepared: [], notes: [], ...over,
})
const details = (over = {}) => ({ kind: 'submit', title: 'Send a form', summary: 'Press "Send" on shop.example.com with the 1 entry below. This sends information to the website.', host: 'shop.example.com', url: 'https://shop.example.com/contact', fields: [{ label: 'Name', value: 'Dana' }], why: 'It sends what you filled in.', ...over })

/* ---------- what one tap means ---------- */

test('a tap on each kind of control is one clear thing, and the button says what it is', () => {
  assert.deepEqual(l.planTap(control({ kind: 'link' }), true), { mode: 'open', enabled: true, reason: '', asks: false, word: 'Open link' })
  assert.equal(l.planTap(control({ kind: 'button' }), true).mode, 'press')
  assert.equal(l.planTap(control({ kind: 'submit', risk: 'approve' }), true).asks, true)
  for (const kind of ['text', 'search', 'email', 'tel', 'number', 'url', 'textarea']) {
    const plan = l.planTap(control({ kind }), true)
    assert.equal(plan.mode, 'type', kind)
    assert.equal(plan.word, 'Fill in')
  }
  assert.equal(l.planTap(control({ kind: 'select' }), true).mode, 'choose')
  assert.equal(l.planTap(control({ kind: 'checkbox', checked: true }), true).word, 'Clear the tick')
  assert.equal(l.planTap(control({ kind: 'checkbox', checked: false }), true).word, 'Tick')
  assert.equal(l.planTap(control({ kind: 'radio', checked: true }), true).word, 'Tick')
  assert.equal(l.planTap(control({ kind: 'file' }), true).enabled, false)
})

test('someone who can only look cannot act, a turned-off control is left alone, and a sign-in step is always the person’s', () => {
  const viewer = l.planTap(control({ kind: 'text' }), false)
  assert.equal(viewer.enabled, false)
  assert.equal(viewer.reason, l.ROLE_WORDS)
  assert.equal(l.planTap(control({ disabled: true }), true).enabled, false)
  const step = l.planTap(control({ kind: 'submit', risk: 'handoff' }), true)
  assert.equal(step.enabled, false)
  assert.equal(step.reason, l.HANDOFF_STEP_WORDS)
  const secret = l.planTap(control({ kind: 'text', risk: 'handoff', sensitive: 'password' }), true)
  assert.equal(secret.enabled, false)
  assert.equal(secret.reason, l.HANDOFF_FIELD_WORDS)
  assert.match(secret.reason, /passwords, card numbers, security codes or one-time codes/)
})

test('risk is a lamp with words, never a colour alone', () => {
  assert.deepEqual(l.riskWord(control()), { lamp: 'green', word: 'Safe to tap' })
  assert.deepEqual(l.riskWord(control({ risk: 'approve' })), { lamp: 'amber', word: 'Asks you first' })
  assert.deepEqual(l.riskWord(control({ risk: 'handoff' })), { lamp: 'red', word: 'You do this on the website' })
  assert.equal(l.controlTitle(control({ label: '  Zip code ' })), 'Zip code')
  assert.equal(l.controlTitle(control({ label: '', kind: 'search' })), 'Search box')
})

test('what the person types is checked before it is sent: no card numbers, no social security numbers, no keys, and not too long', () => {
  assert.equal(l.vetTyped('P0420'), null)
  assert.equal(l.vetTyped('2016 Honda Civic'), null)
  assert.match(l.vetTyped('4111 1111 1111 1111'), /card number/)
  assert.match(l.vetTyped('123-45-6789'), /social security/)
  assert.match(l.vetTyped(['sk', 'live', 'abcdefghijklmnopqrstuvwx'].join('_')), /password or secret key/)
  assert.match(l.vetTyped('x'.repeat(l.MAX_TYPED + 1)), /too long/)
})

test('each action names the control by its reference and nothing else', () => {
  const c = control({ ref: ref(7) })
  assert.deepEqual(l.clickAction(c), { kind: 'click', ref: ref(7) })
  assert.deepEqual(l.fillAction(c, 'P0420'), { kind: 'fill', ref: ref(7), value: 'P0420' })
  assert.deepEqual(l.selectAction(c, 'Front'), { kind: 'select', ref: ref(7), value: 'Front' })
  assert.deepEqual(l.pressAction(c), { kind: 'press', key: 'Enter', ref: ref(7) })
  const s = { ...l.initialLive('https://a.com/', 'phone'), snapshot: snap() }
  assert.deepEqual(l.scrollAction(s, 'down'), { kind: 'scroll', dy: 640 })
  assert.deepEqual(l.scrollAction(s, 'up'), { kind: 'scroll', dy: -640 })
  const tiny = { ...s, snapshot: snap({ viewport: { w: 100, h: 50 } }) }
  assert.equal(l.scrollAction(tiny, 'down').dy, 200)
})

/* ---------- the picture ---------- */

test('a control sits on the picture in percent, and one that cannot be placed is left out', () => {
  const s = snap()
  assert.deepEqual(l.hitBox(control({ rect: { x: 39, y: 80, w: 195, h: 160 } }), s), { left: 10, top: 10, width: 50, height: 20 })
  assert.equal(l.hitBox(control({ inView: false }), s), null)
  assert.equal(l.hitBox(control({ rect: { x: 0, y: 0, w: 0, h: 10 } }), s), null)
  assert.equal(l.hitBox(control(), snap({ viewport: { w: 0, h: 0 } })), null)
  const spill = l.hitBox(control({ rect: { x: 350, y: 760, w: 200, h: 200 } }), s)
  assert.ok(spill.left + spill.width <= 100 && spill.top + spill.height <= 100)
})

test('controls are split into what is on the screen and what is further down', () => {
  const s = snap({ controls: [control({ n: 1 }), control({ n: 2, inView: false }), control({ n: 3 })] })
  const g = l.groupControls(s)
  assert.deepEqual(g.shown.map(c => c.n), [1, 3])
  assert.deepEqual(g.below.map(c => c.n), [2])
  assert.deepEqual(l.groupControls(null), { shown: [], below: [] })
})

/* ---------- the live state ---------- */

test('a new live page is busy until the first picture arrives, and says so', () => {
  const s = l.initialLive('https://a.com/', 'phone')
  assert.equal(s.busy, true)
  assert.deepEqual(l.liveStatus(s), { lamp: 'blue', word: 'Opening the page' })
})

test('a picture arrives: the page address, the entries and the scroll position are kept for the next tap', () => {
  const prepared = [{ kind: 'fill', ref: ref(2), value: 'P0420' }]
  const s = l.liveReduce(l.initialLive('https://a.com/', 'phone'), { type: 'ok', snapshot: snap({ prepared, scrollY: 120 }), did: 'Filled in "Code"' })
  assert.equal(s.busy, false)
  assert.equal(s.url, 'https://shop.example.com/parts')
  assert.deepEqual(s.prepared, prepared)
  assert.equal(s.scrollY, 120)
  assert.equal(s.did, 'Filled in "Code"')
  assert.deepEqual(l.liveStatus(s), { lamp: 'blue', word: 'You are driving' })
  const body = l.liveBody(s, { action: l.clickAction(control()) })
  assert.equal(body.url, 'https://shop.example.com/parts')
  assert.equal(body.actor, 'user')
  assert.equal(body.scrollY, 120)
  assert.deepEqual(body.prepared, prepared)
  assert.equal(body.approvalId, undefined)
})

test('what is sent is capped: only the newest 30 entries and a whole-number scroll position', () => {
  const many = Array.from({ length: 45 }, (_, i) => ({ kind: 'fill', ref: ref(i + 1), value: String(i) }))
  const s = { ...l.initialLive('https://a.com/', 'desktop'), prepared: many, scrollY: 99.6 }
  const body = l.liveBody(s, { approvalId: 'ap1', actor: 'ai' })
  assert.equal(body.prepared.length, 30)
  assert.equal(body.prepared[29].value, '44')
  assert.equal(body.scrollY, 100)
  assert.equal(body.approvalId, 'ap1')
  assert.equal(body.actor, 'ai')
  assert.equal(body.viewport, 'desktop')
})

test('anything that sends stops at an approval card, and the card is cleared by a plain answer', () => {
  let s = l.liveReduce(l.initialLive('https://a.com/', 'phone'), { type: 'ok', snapshot: snap(), did: '' })
  s = l.liveReduce(s, { type: 'busy' })
  const action = l.clickAction(control({ risk: 'approve' }))
  s = l.liveReduce(s, { type: 'approval', snapshot: snap(), details: details(), approvalId: 'ap1', action, actor: 'user' })
  assert.equal(s.busy, false)
  assert.equal(s.approval.approvalId, 'ap1')
  assert.equal(s.approval.phase, 'asking')
  assert.deepEqual(s.approval.action, action)
  assert.deepEqual(l.liveStatus(s), { lamp: 'amber', word: 'Waiting for your OK' })
  s = l.liveReduce(s, { type: 'approvalPhase', phase: 'deciding' })
  assert.equal(s.busy, true)
  s = l.liveReduce(s, { type: 'approvalCleared', notice: { kind: 'info', text: 'You said no. Nothing was sent.' } })
  assert.equal(s.approval, null)
  assert.equal(s.busy, false)
  assert.equal(s.notice.text, 'You said no. Nothing was sent.')
})

test('an approved action that does not get through can be sent again with the same approval', () => {
  let s = l.liveReduce(l.initialLive('https://a.com/', 'phone'), { type: 'approval', snapshot: snap(), details: details(), approvalId: 'ap1', action: l.clickAction(control()), actor: 'user' })
  s = l.liveReduce(s, { type: 'approvalPhase', phase: 'sending' })
  s = l.liveReduce(s, { type: 'failed', message: 'No connection. Check your internet and try again.', setup: false })
  assert.equal(s.approval.phase, 'retry')
  assert.equal(s.approval.error, 'No connection. Check your internet and try again.')
  assert.equal(s.busy, false)
  assert.equal(s.error, null)
})

test('a failure with no picture is an error screen; with a picture it is a message above it', () => {
  const noPicture = l.liveReduce(l.initialLive('https://a.com/', 'phone'), { type: 'failed', message: 'Your shop blocked this site.', setup: false, blocked: true })
  assert.deepEqual(noPicture.error, { message: 'Your shop blocked this site.', setup: false, blocked: true })
  assert.equal(noPicture.busy, false)
  assert.deepEqual(l.liveStatus(noPicture), { lamp: 'red', word: 'Could not open the page' })
  const withPicture = l.liveReduce(l.liveReduce(l.initialLive('https://a.com/', 'phone'), { type: 'ok', snapshot: snap(), did: '' }), { type: 'failed', message: 'The page took too long. Try again.', setup: false })
  assert.equal(withPicture.error, null)
  assert.deepEqual(withPicture.notice, { kind: 'error', text: 'The page took too long. Try again.' })
})

test('the server’s refusal is shown in its own words', () => {
  const s = l.liveReduce(l.liveReduce(l.initialLive('https://a.com/', 'phone'), { type: 'ok', snapshot: snap(), did: '' }), { type: 'refused', snapshot: snap({ scrollY: 50 }), message: 'Something is drawn over that control, so Alpha did not click it.' })
  assert.deepEqual(s.notice, { kind: 'warn', text: 'Something is drawn over that control, so Alpha did not click it.' })
  assert.equal(s.scrollY, 50)
  assert.equal(l.liveReduce(s, { type: 'dismiss' }).notice, null)
})

test('a sign-in or human check is handed to the person with the server’s words', () => {
  const s = l.liveReduce(l.initialLive('https://a.com/', 'phone'), { type: 'handoff', snapshot: snap(), reason: 'sign_in', message: 'This is a sign-in. Do this step on the website yourself.' })
  assert.deepEqual(l.handoffText(s), { title: 'This step is a sign-in', body: 'This is a sign-in. Do this step on the website yourself.' })
  assert.deepEqual(l.liveStatus(s), { lamp: 'amber', word: 'This step is for you' })
  const captcha = l.liveReduce(s, { type: 'handoff', snapshot: snap(), reason: 'captcha', message: 'Prove you are a person.' })
  assert.equal(l.handoffText(captcha).title, 'This site wants you to prove you are a person')
  const credential = l.liveReduce(s, { type: 'handoff', snapshot: snap(), reason: 'credential', message: 'Card number.' })
  assert.equal(l.handoffText(credential).title, 'This step needs private details')
})

test('a page that asks for a sign-in says so even before a tap, and never offers to sign in', () => {
  const s = l.liveReduce(l.initialLive('https://a.com/', 'phone'), { type: 'ok', snapshot: snap({ signInRequired: true }), did: '' })
  const h = l.handoffText(s)
  assert.equal(h.title, 'This site asks for a sign-in')
  assert.equal(h.body, l.SIGN_IN_WORDS)
  assert.match(h.body, /does not sign in to websites/)
  assert.equal(l.handoffText(l.liveReduce(l.initialLive('https://a.com/', 'phone'), { type: 'ok', snapshot: snap(), did: '' })), null)
})

test('reloading starts again from the address, selecting stays on the page, and a saved file is announced', () => {
  let s = l.liveReduce(l.initialLive('https://a.com/', 'phone'), { type: 'ok', snapshot: snap({ prepared: [{ kind: 'fill', ref: ref(1), value: 'x' }], scrollY: 300 }), did: '' })
  s = l.liveReduce(s, { type: 'select', n: 3 })
  assert.equal(s.selected, 3)
  s = l.liveReduce(s, { type: 'saved', text: 'Saved recall.pdf (120 KB) to your device.' })
  assert.equal(s.saved, 'Saved recall.pdf (120 KB) to your device.')
  s = l.liveReduce(s, { type: 'reload' })
  assert.deepEqual(s.prepared, [])
  assert.equal(s.scrollY, 0)
  assert.equal(s.busy, true)
  assert.equal(s.selected, null)
  assert.equal(s.saved, '')
})

/* ---------- approval cards ---------- */

test('the approval card says exactly what will happen, in the server’s words, and lists what will be sent', () => {
  const v = ap.viewApproval(details(), 'user')
  assert.equal(v.title, 'Send a form')
  assert.match(v.headline, /Press "Send" on shop\.example\.com/)
  assert.equal(v.host, 'shop.example.com')
  assert.equal(v.address, 'https://shop.example.com/contact')
  assert.deepEqual(v.fields, [{ label: 'Name', value: 'Dana' }])
  assert.equal(v.approve, 'Approve and send')
  assert.equal(v.deny, 'Do not do this')
  assert.equal(v.asker, 'You asked for this.')
  assert.equal(v.lasts, 'This request lasts 10 minutes.')
  assert.equal(ap.viewApproval(details(), 'ai').asker, 'Alpha wants to do this.')
})

test('every kind of approval has its own button words and none of them is just OK', () => {
  const words = ['submit', 'send', 'purchase', 'download', 'delete', 'terms', 'open_site'].map(ap.approveLabel)
  assert.deepEqual(words, ['Approve and send', 'Approve and send', 'Approve and continue', 'Approve and download', 'Approve and go ahead', 'Approve and agree', 'Approve and open the site'])
  assert.equal(ap.approveLabel('something-new'), 'Approve')
})

test('the card shows at most 12 entries, each shortened, and never fails on odd data', () => {
  const many = Array.from({ length: 20 }, (_, i) => ({ label: `Field ${i}`, value: 'v'.repeat(500) }))
  const v = ap.viewApproval(details({ fields: many, summary: 's'.repeat(2000) }), 'user')
  assert.equal(v.fields.length, 12)
  assert.ok(v.fields[0].value.length <= 200)
  assert.ok(v.headline.length <= 800)
  const odd = ap.viewApproval({ kind: 'submit', title: '', summary: '', host: '', url: '', fields: null, why: '' }, 'user')
  assert.equal(odd.title, 'Needs your OK')
  assert.deepEqual(odd.fields, [])
})

/* ---------- downloads: PDF, pictures and text only ---------- */

const bytes = (...n) => Uint8Array.from(n)
const PDF = Uint8Array.from(Buffer.from('%PDF-1.7\n1 0 obj\n'))
const PNG = bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0)
const JPG = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0x10)
const text = s => Uint8Array.from(Buffer.from(s))

test('an address that names a program, an archive or another kind of document is never offered for download', () => {
  assert.equal(ap.downloadVerdict('https://a.com/files/recall.pdf').allowed, true)
  assert.equal(ap.downloadVerdict('https://a.com/photo.JPG').allowed, true)
  assert.equal(ap.downloadVerdict('https://a.com/notes.txt').allowed, true)
  assert.equal(ap.downloadVerdict('https://a.com/download').allowed, true) // no ending: checked when it arrives
  const exe = ap.downloadVerdict('https://a.com/setup.exe')
  assert.equal(exe.allowed, false)
  assert.match(exe.reason, /program or script/)
  const zip = ap.downloadVerdict('https://a.com/parts.zip')
  assert.equal(zip.allowed, false)
  assert.match(zip.reason, /only saves PDFs, pictures and text files/)
  assert.equal(ap.downloadVerdict('https://a.com/sheet.xlsx').allowed, false)
})

test('a file is recognised by its first bytes, not by what it is called', () => {
  assert.equal(ap.sniffFile(PDF), 'pdf')
  assert.equal(ap.sniffFile(PNG), 'png')
  assert.equal(ap.sniffFile(JPG), 'jpg')
  assert.equal(ap.sniffFile(text('GIF89a....')), 'gif')
  assert.equal(ap.sniffFile(text('Part,Price\nPad,40\n')), 'text')
  assert.equal(ap.sniffFile(bytes(0x4d, 0x5a, 0x90, 0x00, 0x03)), null) // a Windows program
  assert.equal(ap.sniffFile(bytes(0x50, 0x4b, 0x03, 0x04, 0x14)), null) // a zip
  assert.equal(ap.sniffFile(text('<!DOCTYPE html><html><script>alert(1)</script>')), null)
  assert.equal(ap.sniffFile(text('<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>')), null)
  assert.equal(ap.sniffFile(bytes(1, 2)), null)
})

test('a downloaded file is only handed to the device if it is what it says it is', () => {
  const ok = ap.checkDownloaded({ name: 'recall.pdf', bytes: PDF })
  assert.deepEqual(ok, { ok: true, name: 'recall.pdf', mime: 'application/pdf', kind: 'pdf' })
  assert.equal(ap.checkDownloaded({ name: 'photo.jpeg', bytes: JPG }).mime, 'image/jpeg')
  assert.equal(ap.checkDownloaded({ name: 'download', bytes: PNG }).name, 'download.png')
  assert.equal(ap.checkDownloaded({ name: 'x.pdf', bytes: PNG }).ok, false) // wrong name for the contents
  assert.match(ap.checkDownloaded({ name: 'setup.exe', bytes: PDF }).message, /program or script/)
  assert.match(ap.checkDownloaded({ name: 'update.pdf.exe', bytes: PDF }).message, /program or script/)
  assert.match(ap.checkDownloaded({ name: 'x.dat', bytes: bytes(0x4d, 0x5a, 0x90, 0) }).message, /only saves PDFs, pictures and text files/)
  assert.equal(ap.checkDownloaded({ name: 'page.txt', bytes: text('<html><body>hi</body></html>') }).ok, false)
})

test('a saved file name cannot climb out of a folder or carry odd characters', () => {
  assert.equal(ap.cleanSaveName('../../etc/passwd'), 'passwd')
  assert.equal(ap.cleanSaveName('..\\..\\evil.pdf'), 'evil.pdf')
  assert.equal(ap.cleanSaveName('.hidden.pdf'), 'hidden.pdf')
  assert.equal(ap.cleanSaveName('a<b>c:d|e?.pdf'), 'abcde.pdf')
  assert.equal(ap.cleanSaveName(''), 'file')
  assert.equal(ap.nameFromDisposition('attachment; filename="recall report.pdf"'), 'recall report.pdf')
  assert.equal(ap.nameFromDisposition("attachment; filename*=UTF-8''r%C3%A9sum%C3%A9.pdf"), 'résumé.pdf')
  assert.equal(ap.nameFromDisposition(null), '')
  assert.equal(ap.sizeText(512), '512 bytes')
  assert.equal(ap.sizeText(120 * 1024), '120 KB')
  assert.equal(ap.sizeText(3.5 * 1024 * 1024), '3.5 MB')
  assert.equal(ap.sizeText(-1), '')
})

/* ---------- pressing Approve or Do not do this ---------- */

function harness(over = {}) {
  const calls = []
  const phases = []
  const deps = {
    decide: async (id, decision) => { calls.push(['decide', id, decision]); return over.decide ? over.decide(id, decision) : { ok: true, data: true } },
    fetchFile: async (url, id) => { calls.push(['fetch', url, id]); return over.fetchFile ? over.fetchFile(url, id) : { ok: true, data: { bytes: PDF, name: 'recall.pdf', contentType: 'application/pdf' } } },
    save: file => { calls.push(['save', file.name, file.mime]); if (over.saveThrows) throw new Error('blocked') },
  }
  const io = {
    setPhase: (phase, error) => { phases.push([phase, error]) },
    denied: () => calls.push(['denied']),
    gone: m => calls.push(['gone', m]),
    resend: p => { calls.push(['resend', p.approvalId]) },
    openApproved: () => calls.push(['open']),
    saved: (name, size) => calls.push(['saved', name, size]),
    fileProblem: m => calls.push(['fileProblem', m]),
  }
  return { calls, phases, deps, io }
}
const pending = (over = {}) => ({ details: details(), approvalId: 'ap1', action: l.clickAction(control()), phase: 'asking', error: '', actor: 'user', ...over })
const fail = (status, body, extra = {}) => ({ ok: false, failure: describeFailure({ status, body, ...extra }), aborted: false })

test('Do not do this tells the server no and sends nothing', async () => {
  const h = harness()
  await answerApproval(pending(), 'denied', h.deps, h.io)
  assert.deepEqual(h.calls, [['decide', 'ap1', 'denied'], ['denied']])
})

test('Do not do this still ends the card when the connection is down, because the request runs out by itself', async () => {
  const h = harness({ decide: () => { throw new Error('offline') } })
  await answerApproval(pending(), 'denied', h.deps, h.io)
  assert.deepEqual(h.calls.map(c => c[0]), ['decide', 'denied'])
})

test('Approve asks the server first and only then sends the same action again with the approval', async () => {
  const h = harness()
  await answerApproval(pending(), 'approved', h.deps, h.io)
  assert.deepEqual(h.calls, [['decide', 'ap1', 'approved'], ['resend', 'ap1']])
  assert.deepEqual(h.phases.map(p => p[0]), ['deciding', 'sending'])
})

test('a double tap does nothing the second time', async () => {
  for (const phase of ['deciding', 'sending']) {
    const h = harness()
    await answerApproval(pending({ phase }), 'approved', h.deps, h.io)
    await answerApproval(pending({ phase }), 'denied', h.deps, h.io)
    assert.deepEqual(h.calls, [])
    assert.deepEqual(h.phases, [])
  }
})

test('a request that ran out of time, was already answered or is not found is cleared, never retried', async () => {
  for (const status of [404, 403, 409]) {
    const h = harness({ decide: () => fail(status, { error: 'That request ran out of time. Ask again.' }) })
    await answerApproval(pending(), 'approved', h.deps, h.io)
    assert.deepEqual(h.calls, [['decide', 'ap1', 'approved'], ['gone', 'That request ran out of time. Ask again.']], String(status))
  }
  assert.equal(requestIsOver(describeFailure({ status: 500 })), false)
})

test('a lost connection keeps the card so Approve can be pressed again', async () => {
  const h = harness({ decide: () => fail(0, null, { offline: true }) })
  await answerApproval(pending(), 'approved', h.deps, h.io)
  assert.deepEqual(h.calls, [['decide', 'ap1', 'approved']])
  const last = h.phases[h.phases.length - 1]
  assert.equal(last[0], 'asking')
  assert.match(last[1], /No connection/)
})

test('an approved send that did not get through is sent again without asking the server again', async () => {
  const h = harness()
  await answerApproval(pending({ phase: 'retry' }), 'approved', h.deps, h.io)
  assert.deepEqual(h.calls, [['resend', 'ap1']])
})

test('an approval with no id cannot be approved from here', async () => {
  const h = harness()
  await answerApproval(pending({ approvalId: '' }), 'approved', h.deps, h.io)
  assert.deepEqual(h.calls, [])
  assert.equal(h.phases[0][0], 'asking')
})

test('an approved site opening is handed back, not resent as an action', async () => {
  const h = harness()
  await answerApproval(pending({ details: details({ kind: 'open_site', url: 'https://new.example.com/' }), action: null }), 'approved', h.deps, h.io)
  assert.deepEqual(h.calls, [['decide', 'ap1', 'approved'], ['open']])
})

test('an approved download is fetched through the download route, checked, and then saved', async () => {
  const h = harness()
  await answerApproval(pending({ details: details({ kind: 'download', url: 'https://a.com/files/recall.pdf' }), action: null }), 'approved', h.deps, h.io)
  assert.deepEqual(h.calls, [
    ['decide', 'ap1', 'approved'],
    ['fetch', 'https://a.com/files/recall.pdf', 'ap1'],
    ['save', 'recall.pdf', 'application/pdf'],
    ['saved', 'recall.pdf', '17 bytes'],
  ])
})

test('a download of a program is refused before the server is even asked', async () => {
  const h = harness()
  await answerApproval(pending({ details: details({ kind: 'download', url: 'https://a.com/setup.exe' }), action: null }), 'approved', h.deps, h.io)
  assert.deepEqual(h.calls, [])
  assert.equal(h.phases[0][0], 'asking')
  assert.match(h.phases[0][1], /program or script/)
})

test('a download that turns out to be something else is not saved, and the card says why', async () => {
  const h = harness({ fetchFile: () => ({ ok: true, data: { bytes: Uint8Array.from([0x4d, 0x5a, 0x90, 0], (x) => x), name: 'recall.pdf', contentType: 'application/pdf' } }) })
  await answerApproval(pending({ details: details({ kind: 'download', url: 'https://a.com/files/recall.pdf' }), action: null }), 'approved', h.deps, h.io)
  assert.equal(h.calls.some(c => c[0] === 'save'), false)
  assert.equal(h.calls[h.calls.length - 1][0], 'fileProblem')
})

test('a download the device will not save is reported, and a lost connection mid-download can be tried again', async () => {
  const h = harness({ saveThrows: true })
  await answerApproval(pending({ details: details({ kind: 'download', url: 'https://a.com/files/recall.pdf' }), action: null }), 'approved', h.deps, h.io)
  assert.match(h.calls[h.calls.length - 1][1], /would not save the file/)
  const g = harness({ fetchFile: () => fail(0, null, { offline: true }) })
  await answerApproval(pending({ details: details({ kind: 'download', url: 'https://a.com/files/recall.pdf' }), action: null }), 'approved', g.deps, g.io)
  assert.equal(g.phases[g.phases.length - 1][0], 'retry')
  const again = harness()
  await answerApproval(pending({ phase: 'retry', details: details({ kind: 'download', url: 'https://a.com/files/recall.pdf' }), action: null }), 'approved', again.deps, again.io)
  assert.equal(again.calls.some(c => c[0] === 'decide'), false)
  assert.equal(again.calls.some(c => c[0] === 'saved'), true)
})
