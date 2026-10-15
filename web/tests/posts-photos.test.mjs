import test from 'node:test'
import assert from 'node:assert/strict'
import * as p from '../src/lib/posts-photos.ts'

/* ---------- tiny picture builders ---------- */

const bytes = (...parts) => Uint8Array.from(parts.flatMap(x => (typeof x === 'number' ? [x] : Array.from(x))))
const text = s => Array.from(s).map(c => c.charCodeAt(0))
const u16 = n => [(n >> 8) & 255, n & 255]
const u32 = n => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]

/** An EXIF block (big-endian) with an orientation tag and a GPS pointer tag. */
const exif = orientation => bytes(0xff, 0xe1, u16(46), text('Exif'), 0, 0, text('MM'), 0, 42, u32(8), u16(2), u16(0x0112), u16(3), u32(1), u16(orientation), 0, 0, u16(0x8825), u16(4), u32(1), u32(0x1234), u32(0))
const jfif = () => bytes(0xff, 0xe0, u16(16), text('JFIF'), 0, 1, 1, 0, u16(1), u16(1), 0, 0)
const comment = () => bytes(0xff, 0xfe, u16(8), text('secret'))
const sof = (w, h) => bytes(0xff, 0xc0, u16(17), 8, u16(h), u16(w), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1)
const sos = () => bytes(0xff, 0xda, u16(12), 3, 1, 0, 2, 0x11, 3, 0x11, 0, 63, 0, 0x12, 0x34, 0x56)

const jpeg = ({ w = 1200, h = 900, orientation = 0, extra = [], trailer = [] } = {}) =>
  bytes(0xff, 0xd8, jfif(), ...(orientation ? [exif(orientation)] : []), ...extra, sof(w, h), sos(), 0xff, 0xd9, trailer)

const chunk = (type, data = []) => bytes(u32(data.length), text(type), data, 0, 0, 0, 0)
const png = ({ w = 640, h = 480, withText = true, trailer = [] } = {}) =>
  bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, chunk('IHDR', [...u32(w), ...u32(h), 8, 2, 0, 0, 0]), ...(withText ? [chunk('tEXt', text('Author\0Dana')), chunk('tIME', [0, 0, 0, 0, 0, 0, 0])] : []), chunk('IDAT', [1, 2, 3, 4]), chunk('IEND'), trailer)

const has = (b, ...needle) => { for (let i = 0; i + needle.length <= b.length; i++) if (needle.every((v, k) => b[i + k] === v)) return true; return false }

/* ---------- reading and cleaning picture bytes ---------- */

test('size is read from a JPEG or PNG header, and nothing else', () => {
  assert.deepEqual(p.imageInfo(jpeg({ w: 1200, h: 900, orientation: 6 })), { type: 'jpeg', width: 1200, height: 900 })
  assert.deepEqual(p.imageInfo(png({ w: 640, h: 480 })), { type: 'png', width: 640, height: 480 })
  assert.equal(p.imageInfo(bytes(text('GIF89a'), 1, 0, 1, 0)), null)
  assert.equal(p.imageInfo(new Uint8Array(0)), null)
})

test('a JPEG loses its location, camera, comment and other hidden data, and keeps the picture', () => {
  const src = jpeg({ orientation: 1, extra: [comment()], trailer: [9, 9, 9] })
  assert.ok(has(src, ...text('Exif')) && has(src, ...text('secret')), 'the sample really has hidden data')
  const out = p.stripImageMetadata(src)
  assert.equal(out.ok, true)
  assert.equal(out.type, 'jpeg')
  assert.equal(out.changed, true)
  assert.deepEqual([...out.removed].sort(), ['comment', 'exif', 'trailer'])
  assert.equal(has(out.bytes, ...text('Exif')), false)
  assert.equal(has(out.bytes, ...text('secret')), false)
  assert.equal(has(out.bytes, 0x88, 0x25), false, 'the GPS pointer is gone')
  assert.deepEqual(p.imageInfo(out.bytes), { type: 'jpeg', width: 1200, height: 900 })
  assert.equal(out.bytes[out.bytes.length - 2], 0xff)
  assert.equal(out.bytes[out.bytes.length - 1], 0xd9)
  // The scan data is untouched.
  assert.ok(has(out.bytes, 0x12, 0x34, 0x56, 0xff, 0xd9))
})

test('a sideways phone photo keeps only its orientation, and cleaning twice gives the same bytes', () => {
  const first = p.stripImageMetadata(jpeg({ orientation: 6 }))
  assert.equal(first.ok, true)
  assert.equal(has(first.bytes, 0x88, 0x25), false, 'no GPS pointer')
  assert.ok(has(first.bytes, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, 0x06), 'orientation 6 is kept')
  const second = p.stripImageMetadata(first.bytes)
  assert.equal(second.ok, true)
  assert.deepEqual([...second.bytes], [...first.bytes])
})

test('a JPEG with nothing hidden is reported as unchanged', () => {
  const out = p.stripImageMetadata(jpeg())
  assert.equal(out.ok, true)
  assert.equal(out.changed, false)
  assert.deepEqual(out.removed, [])
})

test('a PNG loses its text and time chunks', () => {
  const out = p.stripImageMetadata(png({ trailer: [7, 7] }))
  assert.equal(out.ok, true)
  assert.equal(out.type, 'png')
  assert.deepEqual([...out.removed].sort(), ['text', 'time', 'trailer'])
  assert.equal(has(out.bytes, ...text('Dana')), false)
  assert.equal(has(out.bytes, ...text('tEXt')), false)
  assert.ok(has(out.bytes, ...text('IDAT')) && has(out.bytes, ...text('IEND')))
})

test('other file types and damaged files are refused rather than posted as they are', () => {
  assert.deepEqual(p.stripImageMetadata(bytes(text('GIF89a'), 1, 0, 1, 0)), { ok: false, reason: 'type' })
  assert.deepEqual(p.stripImageMetadata(bytes(text('RIFF'), 0, 0, 0, 0, text('WEBP'))), { ok: false, reason: 'type' })
  assert.deepEqual(p.stripImageMetadata(new Uint8Array(0)), { ok: false, reason: 'type' })
  const cut = jpeg().slice(0, 40)
  assert.equal(p.stripImageMetadata(cut).ok, false)
  assert.equal(p.stripImageMetadata(png().slice(0, 30)).ok, false)
})

/* ---------- scoring ---------- */

const cand = (i, over = {}) => ({ ref: `storage:d1/${i}.jpg`, dviId: 'd1', jobId: 'j1', section: 'Brakes', itemName: `Part ${i}`, rating: 'red', note: '', bytes: 150_000 + i * 1000, width: 1200, height: 900, order: i, inRow: false, ...over })

test('a soft or dark photo scores lower than a sharp one of the same size', () => {
  const sharp = p.qualityScore({ bytes: 220_000, width: 1200, height: 900 })
  const soft = p.qualityScore({ bytes: 15_000, width: 1200, height: 900 })
  assert.ok(sharp > soft + 0.3, `${sharp} vs ${soft}`)
  assert.ok(p.qualityScore({ bytes: 220_000, width: 1200, height: 900 }) > p.qualityScore({ bytes: 220_000, width: 400, height: 300 }) - 1)
  for (const s of [sharp, soft]) assert.ok(s >= 0 && s <= 1)
})

test('with no size information the score is neutral instead of zero', () => {
  assert.equal(p.detailScore({ bytes: 0, width: null, height: null }), 0.5)
  assert.equal(p.sizeScore({ width: null, height: null }), 0.6)
})

test('words are reduced to stems without filler', () => {
  assert.deepEqual(p.stems('Replace front brake pads and rotors'), ['brake', 'pad', 'rotor'])
  assert.deepEqual(p.stems('Spark plugs'), ['spark', 'plug'])
  assert.deepEqual(p.stems(''), [])
})

test('relevance is neutral when the repair is unknown and rises with matching words', () => {
  const c = { itemName: 'Front brake pads', section: 'Brakes', note: '' }
  assert.equal(p.relevance(c, new Set()), 0.5)
  assert.equal(p.relevance(c, new Set(['brake', 'pad'])), 1)
  assert.equal(p.relevance({ itemName: 'Wiper blades', section: 'Exterior', note: '' }, new Set(['brake', 'pad'])), 0)
})

test('the label under a photo names the part and the rating in words', () => {
  assert.equal(p.photoLabel({ itemName: 'Front brake pads', rating: 'red' }), 'Front brake pads, needs work')
  assert.equal(p.photoLabel({ itemName: '', rating: null }), 'Photo')
})

/* ---------- grouping ---------- */

test('photos are grouped by job, and pictures from an inspection with no job are left out', () => {
  const g = p.groupByJob([cand(1, { jobId: 'a' }), cand(2, { jobId: 'b' }), cand(3, { jobId: 'a' }), cand(4, { jobId: null })])
  assert.deepEqual([...g.keys()], ['a', 'b'])
  assert.equal(g.get('a').length, 2)
  assert.equal(g.has(null), false)
})

/* ---------- choosing three to six ---------- */

test('three to six photos are proposed, in the order the car was checked', () => {
  const list = Array.from({ length: 10 }, (_, i) => cand(i + 1))
  const out = p.proposePhotos(list)
  assert.ok(out.picks.length >= 3 && out.picks.length <= 6, String(out.picks.length))
  const orders = out.picks.map(ref => list.find(c => c.ref === ref).order)
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b))
  for (const ref of out.picks) assert.ok(out.reasons[ref], 'every pick has a reason')
  for (const c of list) if (!out.picks.includes(c.ref)) assert.ok(out.leftOut[c.ref], 'every other photo has a reason')
})

test('the photos that match the repair are the ones chosen', () => {
  const list = [
    cand(1, { itemName: 'Front brake pads', bytes: 200_000 }),
    cand(2, { itemName: 'Front brake pads', bytes: 201_000 }),
    cand(3, { itemName: 'Front rotors', bytes: 202_000 }),
    cand(4, { itemName: 'Wiper blades', rating: 'green', bytes: 203_000 }),
    cand(5, { itemName: 'Cabin filter', rating: 'green', bytes: 204_000 }),
    cand(6, { itemName: 'Washer fluid', rating: 'green', bytes: 205_000 }),
  ]
  const out = p.proposePhotos(list, { repairWords: p.stems('Replace front brake pads and rotors') })
  for (const c of list.slice(0, 3)) assert.ok(out.picks.includes(c.ref), c.itemName)
  assert.ok(!out.picks.includes(list[3].ref) || out.picks.length > 3)
})

test('no part is shown more than twice when there are other photos', () => {
  const list = [1, 2, 3, 4, 5].map(i => cand(i, { itemName: 'Front brake pads', bytes: 200_000 + i })).concat([cand(6, { itemName: 'Rotors' }), cand(7, { itemName: 'Calipers' })])
  const out = p.proposePhotos(list)
  assert.ok(out.picks.filter(r => list.find(c => c.ref === r).itemName === 'Front brake pads').length <= 2)
  assert.ok(out.picks.length >= 3)
})

test('tiny pictures and copies are left out with a reason', () => {
  const list = [cand(1), cand(2, { width: 200, height: 150 }), cand(3, { itemName: 'Part 1', bytes: cand(1).bytes }), cand(4), cand(5), cand(6)]
  const out = p.proposePhotos(list)
  assert.equal(out.picks.includes(list[1].ref), false)
  assert.match(out.leftOut[list[1].ref], /small/i)
  assert.equal(out.picks.includes(list[2].ref), false)
  assert.match(out.leftOut[list[2].ref], /copy/i)
})

test('a very soft photo is not chosen while sharp ones are available', () => {
  const list = [1, 2, 3, 4, 5, 6, 7].map(i => cand(i)).concat([cand(8, { bytes: 9_000, itemName: 'Soft one' })])
  const out = p.proposePhotos(list)
  assert.equal(out.picks.includes(list[7].ref), false)
  assert.ok(out.leftOut[list[7].ref])
})

test('a job with too few photos still gets what exists, with a note', () => {
  const out = p.proposePhotos([cand(1), cand(2)])
  assert.equal(out.picks.length, 2)
  assert.match(out.note, /Only 2 usable photos/)
  assert.deepEqual(p.proposePhotos([]), { picks: [], reasons: {}, leftOut: {}, unusable: [], note: 'This job has no photos yet.' })
})

/* ---------- asking the AI to choose ---------- */

test('the AI prompt carries part names and ratings only, never a picture or a technician’s note', () => {
  const pr = p.aiPickPrompt([cand(1, { itemName: 'Front brake pads', note: 'Dana’s car, plate ABC1234' }), cand(2, { itemName: 'Rotors' })], ['Replace front brake pads'])
  assert.match(pr.user, /1\. Front brake pads, needs work\n/)
  assert.doesNotMatch(pr.user, /Dana|ABC1234/)
  assert.match(pr.user, /Replace front brake pads/)
  assert.match(pr.system, /JSON only/)
  assert.doesNotMatch(pr.user, /storage:|data:image/)
})

test('the AI answer is only trusted when it is a clean list of numbers in range', () => {
  assert.deepEqual(p.parseAiPick('{"picks":[2,5,1]}', 6), [2, 5, 1])
  assert.deepEqual(p.parseAiPick('Sure! ```json\n{"picks":["3","1"]}\n```', 4), [3, 1])
  assert.equal(p.parseAiPick('{"picks":[2,2]}', 6), null)
  assert.equal(p.parseAiPick('{"picks":[7]}', 6), null)
  assert.equal(p.parseAiPick('{"picks":[0]}', 6), null)
  assert.equal(p.parseAiPick('{"picks":[1,2,3,4,5,6,7]}', 9), null)
  assert.equal(p.parseAiPick('{"picks":[]}', 6), null)
  assert.equal(p.parseAiPick('pick the first three', 6), null)
  assert.equal(p.parseAiPick('{"picks":"1,2"}', 6), null)
  assert.equal(p.parseAiPick('', 6), null)
})

/* ---------- the AI's choice, checked ---------- */

test('the AI’s choice is used, in car order, with unusable photos kept out', () => {
  const list = [1, 2, 3, 4, 5, 6, 7, 8].map(i => cand(i)).map((c, i) => (i === 3 ? { ...c, width: 200, height: 100 } : c))
  const base = p.proposePhotos(list)
  assert.ok(base.unusable.includes(list[3].ref))
  const out = p.applyAiPick(base, list, [7, 4, 2, 5])
  assert.deepEqual(out.picks, [list[1].ref, list[4].ref, list[6].ref], 'the tiny photo number 4 is dropped, order is car order')
  for (const ref of out.picks) assert.match(out.reasons[ref], /tell the story/)
  assert.ok(list.every(c => out.picks.includes(c.ref) || out.leftOut[c.ref]))
})

test('a short AI answer is topped up from the heuristic picks, and a useless one changes nothing', () => {
  const list = [1, 2, 3, 4, 5, 6].map(i => cand(i))
  const base = p.proposePhotos(list)
  const out = p.applyAiPick(base, list, [2])
  assert.ok(out.picks.length >= 3 && out.picks.includes(list[1].ref))
  assert.equal(p.applyAiPick(base, list, null), base)
  assert.equal(p.applyAiPick(base, list, [99]), base)
})
