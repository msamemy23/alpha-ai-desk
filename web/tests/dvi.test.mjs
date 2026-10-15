import test from 'node:test'
import assert from 'node:assert/strict'
import * as d from '../src/lib/dvi.ts'

const rate = (secs, id, status, extra = {}) => { for (const s of secs) for (const i of s.items) if (i.id === id) Object.assign(i, { status }, extra); return secs }

test('every template builds a checklist with unique ids and nothing rated', () => {
  for (const t of d.TEMPLATES) {
    const secs = d.makeSections(t.key)
    const ids = secs.flatMap(s => s.items.map(i => i.id))
    assert.equal(new Set(ids).size, ids.length, t.key)
    assert.equal(d.counts(secs).rated, 0)
    assert.equal(d.overallOf(secs), 'pending')
    // the blurb on the start screen tells the truth about the size of the checklist
    assert.ok(t.blurb.startsWith(String(ids.length)), `${t.key}: blurb says ${t.blurb}, list has ${ids.length}`)
  }
  assert.equal(d.templateOf('nope').key, 'full')
})

test('counts and the overall light follow the worst rating', () => {
  const s = d.makeSections('brakes-tires')
  rate(s, 'brakes-tires-0-0', 'green'); rate(s, 'brakes-tires-0-1', 'yellow'); rate(s, 'brakes-tires-1-0', 'green')
  assert.deepEqual([d.counts(s).green, d.counts(s).yellow, d.counts(s).red, d.counts(s).rated], [2, 1, 0, 3])
  assert.equal(d.overallOf(s), 'yellow')
  rate(s, 'brakes-tires-0-2', 'red')
  assert.equal(d.overallOf(s), 'red')
  assert.equal(d.summaryWords(d.counts(s)), '1 needs work, 1 to watch')
  assert.equal(d.summaryWords({ red: 3, yellow: 0, green: 5, rated: 8 }), '3 need work')
  assert.equal(d.summaryWords({ red: 0, yellow: 0, green: 5, rated: 5 }), 'Everything checked is good')
  assert.equal(d.summaryWords({ red: 0, yellow: 0, green: 0, rated: 0 }), 'Nothing checked yet')
})

test('findings list needs-work first and leave out good and unchecked items', () => {
  const s = d.makeSections('brakes-tires')
  rate(s, 'brakes-tires-0-0', 'yellow', { note: 'Pads at 4mm' })
  rate(s, 'brakes-tires-0-1', 'red', { note: 'Pads at 1mm', price: 289.5 })
  rate(s, 'brakes-tires-1-0', 'green')
  const f = d.findings(s)
  assert.deepEqual(f.map(x => [x.id, x.status]), [['brakes-tires-0-1', 'red'], ['brakes-tires-0-0', 'yellow']])
  assert.equal(f[0].section, 'Brakes')
  assert.equal(d.estimateTotal(f), 289.5)
})

test('old or damaged data is made safe before it is used', () => {
  const raw = [
    { title: '  Brakes  ', items: [
      { name: 'Front pads', status: 'red', note: 'x'.repeat(900), photo: 'data:image/jpeg;base64,AAAA', price: '$1,200.555' },
      { name: '', status: 'purple', price: -5, photos: ['javascript:alert(1)', 'data:text/html;base64,AAAA', 'https://example.com/a.jpg', 'data:image/png;base64,iVBOR=='] },
      null,
    ] },
    'junk',
  ]
  const out = d.normalizeSections(raw)
  assert.equal(out.length, 2)
  assert.equal(out[0].title, 'Brakes')
  const [a, b, c] = out[0].items
  assert.equal(a.note.length, d.MAX_NOTE)
  assert.ok(a.price === 1200.55 || a.price === 1200.56) // cents only
  assert.equal(a.photos.length, 1)
  assert.equal(b.status, null); assert.equal(b.price, null); assert.equal(b.name, 'Item')
  assert.deepEqual(b.photos, ['https://example.com/a.jpg', 'data:image/png;base64,iVBOR=='])
  assert.equal(c.name, 'Item')
  assert.equal(out[1].items.length, 0)
  assert.deepEqual(d.normalizeSections('nope'), [])
  assert.deepEqual(d.normalizeSections(null), [])
  // ids exist and are unique per list
  assert.equal(new Set(out[0].items.map(i => i.id)).size, 3)
})

test('only real images are accepted, and only a few per item', () => {
  assert.equal(d.isSafeImage('data:image/jpeg;base64,/9j/4AAQ'), true)
  assert.equal(d.isSafeImage('data:image/svg+xml;base64,PHN2Zz4='), false)
  assert.equal(d.isSafeImage('http://example.com/a.jpg'), false)
  assert.equal(d.isSafeImage('https://example.com/a b.jpg'), false)
  assert.equal(d.isSafeImage(42), false)
  const many = Array.from({ length: 9 }, () => 'data:image/jpeg;base64,AAAA')
  assert.equal(d.normalizeSections([{ title: 'T', items: [{ id: 'a', name: 'A', photos: many }] }])[0].items[0].photos.length, d.MAX_PHOTOS_PER_ITEM)
})

test('prices are whole cents, never negative or absurd', () => {
  assert.equal(d.cleanPrice('289.5'), 289.5)
  assert.equal(d.cleanPrice('$1,000'), 1000)
  assert.equal(d.cleanPrice(''), null)
  assert.equal(d.cleanPrice('abc'), null)
  assert.equal(d.cleanPrice(-1), null)
  assert.equal(d.cleanPrice(5_000_000), null)
  assert.equal(d.cleanPrice(0.1 + 0.2), 0.3)
  assert.equal(d.fmtMoney(1234.5), '$1,234.50')
})

test('a customer can only answer about real findings, with real answers', () => {
  const ids = ['a', 'b']
  assert.deepEqual(d.cleanDecisions({ a: 'approved', b: 'declined', c: 'approved', d: 'maybe' }, ids), { a: 'approved', b: 'declined' })
  assert.deepEqual(d.cleanDecisions([1, 2], ids), {})
  assert.deepEqual(d.cleanDecisions(null, ids), {})
  assert.deepEqual(d.cleanDecisions({ __proto__: 'approved', constructor: 'approved' }, ['__proto__']), {})
})

test('what the customer approved becomes estimate lines and a total', () => {
  const list = [
    { id: 'a', section: 'Brakes', name: 'Front brake pads', status: 'red', note: 'Pads at 1mm', photos: [], price: 289.5 },
    { id: 'b', section: 'Tires', name: 'Left rear tire', status: 'yellow', note: '', photos: [], price: 140 },
    { id: 'c', section: 'Lights', name: 'Wipers', status: 'yellow', note: 'Streaking', photos: [], price: null },
  ]
  const dec = { a: 'approved', b: 'declined', c: 'approved' }
  assert.deepEqual(d.decisionSummary(list, dec), { approved: 2, declined: 1, waiting: 0, approvedTotal: 289.5, answered: true })
  assert.deepEqual(d.decisionSummary(list, {}), { approved: 0, declined: 0, waiting: 3, approvedTotal: 0, answered: false })
  assert.deepEqual(d.estimateLines(list, dec), [{ operation: 'Front brake pads: Pads at 1mm', amount: 289.5 }, { operation: 'Wipers: Streaking', amount: 0 }])
})

test('where an inspection stands', () => {
  const s = d.makeSections('courtesy')
  assert.equal(d.stateOf({ sections: s }), 'new')
  rate(s, 'courtesy-0-0', 'green')
  assert.equal(d.stateOf({ sections: s }), 'checking')
  assert.equal(d.stateOf({ sections: s, sent_to_customer: true }), 'sent')
  assert.equal(d.stateOf({ sections: s, sent_to_customer: true, customer_decisions: { a: 'approved' } }), 'answered')
  assert.equal(d.stateOf({ sections: s, sent_to_customer: true, customer_decisions: {} }), 'sent')
  assert.equal(d.stateOf({ sections: s, sent_to_customer: true, customer_approved: true }), 'answered')
})

test('the text message is short, plain, has no emoji, and falls back to a list without a link', () => {
  const list = [
    { id: 'a', section: 'Brakes', name: 'Front brake pads', status: 'red', note: '', photos: [], price: null },
    { id: 'b', section: 'Tires', name: 'Left rear tire', status: 'yellow', note: '', photos: [], price: null },
  ]
  const withLink = d.smsText({ customer: 'Sam Ortiz', vehicle: '2018 Honda Civic', shop: 'Southline Auto', phone: '713-555-0100', url: 'https://x.test/inspection/abc', list, goodCount: 10 })
  assert.match(withLink, /^Hi Sam, the inspection on your 2018 Honda Civic at Southline Auto is done\./)
  assert.match(withLink, /1 item needs attention and 1 to keep an eye on\./)
  assert.match(withLink, /https:\/\/x\.test\/inspection\/abc/)
  assert.match(withLink, /Call 713-555-0100/)
  const noLink = d.smsText({ customer: 'Walk-in: Eddie', vehicle: '', shop: '', phone: '', url: null, list, goodCount: 0 })
  assert.match(noLink, /^Hi Eddie, the inspection on your vehicle at our shop is done\./)
  assert.match(noLink, /Needs attention: Front brake pads\./)
  assert.match(noLink, /Worth watching: Left rear tire\./)
  assert.match(noLink, /Reply to this text/)
  const allGood = d.smsText({ customer: 'Sam', vehicle: 'Civic', shop: 'S', phone: '', url: 'https://x.test/i/1', list: [], goodCount: 12 })
  assert.match(allGood, /Everything we checked looks good\./)
  assert.doesNotMatch(allGood, /https:/) // nothing to answer, so no link
  for (const m of [withLink, noLink, allGood]) assert.doesNotMatch(m, /[\u{1F300}-\u{1FAFF}✅⚠❌]/u)
})
