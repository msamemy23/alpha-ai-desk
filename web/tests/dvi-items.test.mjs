import test from 'node:test'
import assert from 'node:assert/strict'
import * as d from '../src/lib/dvi.ts'

const item = (id, status, extra = {}) => ({ id, name: id.toUpperCase(), status, note: '', photos: [], price: null, ...extra })
const sec = (...items) => [{ title: 'Brakes', items }]

test('urgency follows the rating until the technician chooses one', () => {
  assert.equal(d.urgencyOf({ status: 'red' }), 'now')
  assert.equal(d.urgencyOf({ status: 'yellow' }), 'soon')
  assert.equal(d.urgencyOf({ status: 'yellow', urgency: 'later' }), 'later')
  assert.equal(d.urgencyOf({ status: 'red', urgency: 'bogus' }), 'now')
  for (const u of d.URGENCIES) assert.ok(d.URGENCY_WORD[u] && d.URGENCY_HELP[u])
})

test('findings come fix-now first, then recommended, then can-wait, keeping checklist order inside a group', () => {
  const s = sec(item('a', 'yellow'), item('b', 'red', { urgency: 'later' }), item('c', 'red'), item('d', 'yellow', { urgency: 'now' }), item('e', 'yellow'), item('f', 'green'), item('g', null))
  const f = d.findings(s)
  assert.deepEqual(f.map(x => x.id), ['c', 'd', 'a', 'e', 'b'])
  assert.deepEqual(f.map(x => x.urgency), ['now', 'now', 'soon', 'soon', 'later'])
  assert.deepEqual(d.urgencyCounts(f), { now: 2, soon: 2, later: 1 })
})

test('the technician note stays with the shop: it is never part of a finding', () => {
  const s = sec(item('a', 'red', { techNote: 'Customer was rude about the last bill' }))
  assert.equal(JSON.stringify(d.findings(s)).includes('rude'), false)
  assert.equal(d.normalizeSections(s)[0].items[0].techNote, 'Customer was rude about the last bill')
  assert.equal(d.normalizeSections([{ title: 'T', items: [{ id: 'a', name: 'A', techNote: 'x'.repeat(900) }] }])[0].items[0].techNote.length, d.MAX_TECH_NOTE)
  assert.equal('techNote' in d.normalizeSections([{ title: 'T', items: [{ id: 'a', name: 'A', techNote: '   ' }] }])[0].items[0], false)
})

test('a measurement travels with the finding, written out with its warning', () => {
  const s = sec(item('lf', 'red', { measure: { kind: 'tread', value: 3 } }), item('rf', 'yellow', { measure: { kind: 'pad', value: 4.5 } }))
  const f = d.findings(s)
  assert.deepEqual(f[0].measure, { kind: 'tread', text: '3/32 in', word: 'Replace soon', rating: 'red' })
  assert.equal(f[1].measure.word, 'Getting thin')
  // junk measurements are dropped when a row is read back
  const n = d.normalizeSections([{ title: 'T', items: [{ id: 'a', name: 'A', measure: { kind: 'tread', value: 'x' } }, { id: 'b', name: 'B', measure: { kind: 'tread', value: '5' } }] }])
  assert.equal(n[0].items[0].measure, undefined)
  assert.deepEqual(n[0].items[1].measure, { kind: 'tread', value: 5 })
  // the estimate line says what was measured
  const lines = d.estimateLines(f, { lf: 'approved', rf: 'approved' })
  assert.equal(lines[0].operation, 'LF (3/32 in)')
})

test('pictures kept in storage are accepted only in the exact shape the server writes', () => {
  const ok = 'storage:3f2a9c10-1111-4222-8333-444455556666/abcdefghij0123456789.jpg'
  assert.equal(d.isSafeImage(ok), true)
  assert.equal(d.isStorageRef(ok), true)
  assert.equal(d.isSafeImage('storage:../../etc/passwd'), false)
  assert.equal(d.isSafeImage('storage:abc/abcdefgh.exe'), false)
  assert.equal(d.isSafeImage('storage:abc/abcdefgh.mp4'), false) // a clip is not a picture
  assert.equal(d.isSafeImage('storage:' + 'a'.repeat(200) + '/abcdefgh.jpg'), false)
  const parts = d.storageRefParts(ok)
  assert.deepEqual([parts.folder, parts.ext, parts.path], ['3f2a9c10-1111-4222-8333-444455556666', 'jpg', '3f2a9c10-1111-4222-8333-444455556666/abcdefghij0123456789.jpg'])
  assert.equal(d.makeStorageRef('f1', 'name123456', 'webp'), 'storage:f1/name123456.webp')
  // the photo list keeps storage refs next to the old in-row pictures
  const n = d.normalizeSections([{ title: 'T', items: [{ id: 'a', name: 'A', photos: [ok, 'data:image/jpeg;base64,AAAA', 'storage:bad'] }] }])
  assert.deepEqual(n[0].items[0].photos, [ok, 'data:image/jpeg;base64,AAAA'])
})

test('clips must be real storage files of a video or audio type, and few', () => {
  const v = 'storage:f1/abcdefgh12.mp4', a = 'storage:f1/abcdefgh34.m4a', p = 'storage:f1/abcdefgh56.jpg'
  const n = d.cleanClips([{ ref: v, kind: 'video', secs: 12.4 }, { ref: p, kind: 'video', secs: 3 }, { ref: a, secs: 999 }, { ref: 'https://x/y.mp4' }, { ref: a, kind: 'audio', secs: 5 }, null])
  assert.deepEqual(n, [{ ref: v, kind: 'video', secs: 12 }, { ref: a, kind: 'audio', secs: d.MAX_CLIP_SECS }])
  assert.equal(d.cleanClips('nope').length, 0)
  assert.equal(d.cleanClips(Array.from({ length: 6 }, () => ({ ref: v, kind: 'video', secs: 1 }))).length, d.MAX_CLIPS_PER_ITEM)
  const out = d.normalizeSections([{ title: 'T', items: [{ id: 'a', name: 'A', status: 'red', clips: [{ ref: v, kind: 'video', secs: 4 }] }] }])
  assert.equal(d.findings(out)[0].clips.length, 1)
})

test('a canned job link and a price survive a save and a read', () => {
  const n = d.normalizeSections([{ title: 'T', items: [{ id: 'a', name: 'A', price: 120, canned: { id: 'cj-1', name: 'Front brake pads' } }, { id: 'b', name: 'B', canned: { id: 5 } }] }])
  assert.deepEqual(n[0].items[0].canned, { id: 'cj-1', name: 'Front brake pads' })
  assert.equal(n[0].items[1].canned, undefined)
})

test('a shop checklist is cleaned: blanks and repeats go, sizes are capped, empty ones are refused', () => {
  const t = d.cleanTemplate({ label: '  Pre-trip   check ', blurb: 'x'.repeat(300), sections: [
    { title: ' Fluids ', items: ['Oil', ' oil ', '', 'Coolant', 7] },
    { title: '', items: ['Wipers'] },
    { title: 'Empty', items: [] },
    'junk',
  ] })
  assert.equal(t.label, 'Pre-trip check')
  assert.equal(t.blurb.length, d.MAX_TEMPLATE_BLURB)
  assert.deepEqual(t.sections, [{ title: 'Fluids', items: ['Oil', 'Coolant'] }, { title: 'Checks', items: ['Wipers'] }])
  assert.equal(d.cleanTemplate({ label: '', sections: [{ title: 'A', items: ['x'] }] }), null)
  assert.equal(d.cleanTemplate({ label: 'A', sections: [] }), null)
  assert.equal(d.cleanTemplate(null), null)
  const big = d.cleanTemplate({ label: 'Big', sections: Array.from({ length: 30 }, (_, i) => ({ title: `S${i}`, items: Array.from({ length: 60 }, (_, j) => `Item ${i}-${j}`) })) })
  assert.ok(big.sections.length <= d.MAX_TEMPLATE_SECTIONS && big.sections.length >= 3)
  assert.ok(big.sections.every(s => s.items.length <= d.MAX_TEMPLATE_ITEMS_PER_SECTION))
  assert.ok(big.sections.reduce((n, s) => n + s.items.length, 0) <= d.MAX_TEMPLATE_ITEMS)
  assert.equal(d.templateBlurb(t.sections), '3 checks in 2 groups')
  assert.equal(d.templateBlurb([{ items: ['a'] }]), '1 check in 1 group')
})

test('a shop checklist makes a fresh list with its own unique ids', () => {
  const key = d.customKeyFor('9F8E7D6C-1234-4567-89AB-CDEF01234567')
  assert.match(key, d.CUSTOM_KEY)
  assert.equal(key, 't-9f8e7d6c')
  const secs = d.sectionsFromTemplate({ key, sections: [{ title: 'A', items: ['One', 'Two'] }, { title: 'B', items: ['Three'] }] })
  assert.deepEqual(secs.flatMap(s => s.items.map(i => i.id)), ['t-9f8e7d6c-0-0', 't-9f8e7d6c-0-1', 't-9f8e7d6c-1-0'])
  assert.equal(d.counts(secs).rated, 0)
  assert.ok(d.customKeyFor('').startsWith('t-'))
})

test('the digest kept beside a row has every rated line and nothing private', () => {
  const s = sec(item('a', 'green'), item('b', 'red', { note: 'Pads at 1 mm', price: 289.5, techNote: 'secret', measure: { kind: 'pad', value: 1 } }), item('c', null), item('d', 'yellow', { note: 'y'.repeat(300) }))
  const g = d.digestOf(s)
  assert.equal(g.length, 3)
  assert.deepEqual(g[1], { i: 'b', s: 'Brakes', n: 'B', r: 'r', m: { kind: 'pad', value: 1 }, t: 'Pads at 1 mm', p: 289.5 })
  assert.equal(g[2].t.length, 100)
  assert.equal(JSON.stringify(g).includes('secret'), false)
  assert.deepEqual(d.digestFromRaw(JSON.parse(JSON.stringify(g))), g)
  assert.deepEqual(d.digestFromRaw('nope'), [])
  assert.deepEqual(d.digestFromRaw([{ r: 'x' }, null, { r: 'g', s: 'S', n: 'N', m: { kind: 'tread', value: 'zz' } }]), [{ s: 'S', n: 'N', r: 'g' }])
  const sum = d.summaryOf(s)
  assert.equal(sum.red, 1); assert.equal(sum.digest.length, 3)
  assert.deepEqual(d.mediaCounts(sec(item('a', 'red', { photos: ['data:image/jpeg;base64,AAAA'], measure: { kind: 'tread', value: 3 }, clips: [{ ref: 'storage:f/abcdefgh.mp4', kind: 'video', secs: 3 }] }))), { photos: 1, clips: 1, measured: 1 })
})

test('the email lists findings under their urgency words, with prices and the link', () => {
  const s = sec(item('a', 'red', { name: 'x', price: 289.5 }), item('b', 'yellow'), item('c', 'yellow', { urgency: 'later' }))
  s[0].items[0].name = 'Front brake pads'; s[0].items[1].name = 'Wipers'; s[0].items[2].name = 'Battery'
  const e = d.emailParts({ customer: 'Dana Ruiz', vehicle: '2018 Camry', shop: 'Test Auto', phone: '(713) 555-0100', url: 'https://e.test/inspection/t', list: d.findings(s), goodCount: 5 })
  assert.equal(e.subject, 'Your inspection results from Test Auto')
  assert.match(e.body, /^Hi Dana,\n\nThe inspection on your 2018 Camry at Test Auto is done\./)
  assert.match(e.body, /Fix now:\n- Front brake pads \(about \$289\.50\)/)
  assert.match(e.body, /Recommended:\n- Wipers/)
  assert.match(e.body, /Can wait:\n- Battery/)
  assert.match(e.body, /https:\/\/e\.test\/inspection\/t/)
  assert.match(e.body, /Questions\? Call \(713\) 555-0100\.\n\nTest Auto$/)
  const clean = d.emailParts({ customer: '', vehicle: '', shop: '', phone: '', url: null, list: [], goodCount: 3 })
  assert.match(clean.body, /Everything we checked looks good\./)
  assert.match(clean.body, /Reply to this email/)
  assert.equal(/\p{Extended_Pictographic}/u.test(e.body + clean.body), false)
})

test('photos kept in storage do not count against the in-row limits', () => {
  const stored = 'storage:f1/abcdefgh12.jpg'
  const s = sec(item('a', 'red', { photos: [stored, stored, 'data:image/jpeg;base64,AAAA'] }))
  assert.equal(d.inRowPhotos(s), 1)
  assert.equal(d.counts(s).photos, 3)
  assert.ok(d.MAX_STORED_TOTAL > d.MAX_PHOTOS_TOTAL && d.MAX_PHOTOS_PER_ITEM > d.MAX_INROW_PER_ITEM)
})
