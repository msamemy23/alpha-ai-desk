import test from 'node:test'
import assert from 'node:assert/strict'
import * as f from '../src/lib/posts-facts.ts'
import { copyFlags, POST_LIMITS } from '../src/lib/posts-checks.ts'

const facts = (over = {}) => ({ ...f.emptyFacts({ shopName: 'Joe’s Auto', shopPhone: '(713) 555-0100', city: 'Houston' }), car: '2018 Toyota Camry', engine: '2.5L 4-cylinder', engineSource: 'vin', repairs: ['Replace front brake pads and rotors'], finished: true, ...over })

/* ---------- the vehicle and the engine ---------- */

test('the vehicle is named as the job has it, tidied, and nothing else gets in', () => {
  assert.equal(f.carLine({ vehicle_year: 2018, vehicle_make: 'Toyota', vehicle_model: 'Camry' }), '2018 Toyota Camry')
  assert.equal(f.carLine({ vehicle_year: '2018', vehicle_make: 'TOYOTA', vehicle_model: 'CAMRY SE' }), '2018 Toyota Camry Se')
  assert.equal(f.carLine({ vehicle_year: 'abc', vehicle_make: 'Ford', vehicle_model: 'F-150' }), 'Ford F-150')
  assert.equal(f.carLine({ vehicle_make: 'Ford<script>', vehicle_model: 'F-150' }), 'Fordscript F-150')
  assert.equal(f.carLine({ vehicle_year: 2018 }), '')
  assert.equal(f.carLine(null), '')
})

test('the inspection’s vehicle text is the fallback, and only when it reads like a car', () => {
  assert.equal(f.carLine({}, '2015 Honda Accord'), '2015 Honda Accord')
  assert.equal(f.carLine({}, '12'), '')
})

test('the engine comes from the VIN decode first, then the job, otherwise nothing is said', () => {
  assert.deepEqual(f.pickEngine('2.5L 4-cylinder', '2.0 turbo'), { engine: '2.5L 4-cylinder', source: 'vin' })
  assert.deepEqual(f.pickEngine('', '2.0 turbo'), { engine: '2.0 turbo', source: 'job' })
  assert.deepEqual(f.pickEngine(null, undefined), { engine: '', source: '' })
  assert.deepEqual(f.pickEngine('   ', '  '), { engine: '', source: '' })
})

test('horsepower and odd characters come out of an engine description', () => {
  assert.equal(f.cleanEngine('3.5L V6, 301 hp <b>'), '3.5L V6')
  assert.equal(f.cleanEngine('2.4L 4-cylinder 185hp'), '2.4L 4-cylinder')
})

test('a VIN that decodes to a different car than the job is not trusted for the engine', () => {
  assert.equal(f.vinMatchesJob({ make: 'Toyota', year: '2018' }, { vehicle_make: 'toyota', vehicle_year: '2018' }), true)
  assert.equal(f.vinMatchesJob({ make: 'Toyota', year: '2018' }, { vehicle_make: 'Honda', vehicle_year: '2018' }), false)
  assert.equal(f.vinMatchesJob({ make: 'Toyota', year: '2015' }, { vehicle_make: 'Toyota', vehicle_year: '2018' }), false)
  assert.equal(f.vinMatchesJob({ make: 'Ford', year: '' }, { vehicle_make: 'Ford Motor', vehicle_year: '' }), true)
  assert.equal(f.vinMatchesJob({ make: '', year: '' }, { vehicle_make: '', vehicle_year: '' }), true)
})

test('a job counts as finished only in the four finished states', () => {
  for (const s of ['Completed', 'Ready for Pickup', 'Paid', 'Closed']) assert.equal(f.jobFinished(s), true, s)
  for (const s of ['In Progress', 'Waiting for Parts', 'Estimate', '', null]) assert.equal(f.jobFinished(s), false, String(s))
})

/* ---------- the work done ---------- */

test('a repair line is kept when it is plain work, and dropped when it carries money, promises or private details', () => {
  assert.equal(f.cleanRepairLine('replace front brake pads and rotors'), 'Replace front brake pads and rotors')
  assert.equal(f.cleanRepairLine('- Replace serpentine belt.'), 'Replace serpentine belt')
  assert.equal(f.cleanRepairLine('4 tires mounted and balanced'), '4 tires mounted and balanced')
  for (const bad of ['Brake job $450', 'Free alignment', 'Lifetime warranty brake pads', '20% off oil change', 'Shop supplies', 'Environmental fee', 'Labor', 'Call Dana at 713-555-0142', 'VIN 1HGCM82633A004352 checked', 'email me@x.com', 'Same day brake repair', 'ab', 'x'.repeat(120)]) {
    assert.equal(f.cleanRepairLine(bad), null, bad)
  }
})

test('a line that names the customer or the plate is dropped', () => {
  assert.equal(f.cleanRepairLine('Brakes for Dana Ruiz', ['Dana Ruiz']), null)
  assert.equal(f.cleanRepairLine('Brakes plate ABC1234', ['ABC1234']), null)
  assert.equal(f.cleanRepairLine('Replace brake pads', ['Dana Ruiz']), 'Replace brake pads')
})

test('the work is taken from the invoice or estimate first, at most four lines, no repeats', () => {
  const lines = f.repairLinesFrom({
    docLabors: [{ operation: 'Replace front brake pads and rotors', price: 380 }, { description: 'Brake fluid flush' }],
    jobLabors: [{ operation: 'Front brake pads' }, { operation: 'Replace front brake pads and rotors' }, { operation: 'Alignment' }],
    approvedFindings: ['Serpentine belt cracked', 'Wiper blades torn'],
    docParts: [{ name: 'Ceramic brake pads' }],
  })
  assert.deepEqual(lines, ['Replace front brake pads and rotors', 'Brake fluid flush', 'Alignment', 'Serpentine belt cracked'])
})

test('part names are used only when nothing else says what was done, and prices never appear', () => {
  const lines = f.repairLinesFrom({ jobParts: [{ name: 'Oil filter', price: 9.99 }, { name: '$12 coupon' }] })
  assert.deepEqual(lines, ['Oil filter'])
  assert.deepEqual(f.repairLinesFrom({}), [])
  assert.deepEqual(f.repairLinesFrom({ docLabors: 'nope', jobLabors: [null, 3, 'x'] }), [])
})

/* ---------- the caption ---------- */

test('a job without a vehicle or without any work line cannot make a post', () => {
  assert.deepEqual(f.factsProblems(facts()), [])
  assert.equal(f.factsProblems(facts({ car: '' })).length, 1)
  assert.equal(f.factsProblems(facts({ repairs: [] })).length, 1)
  assert.equal(f.factsProblems(facts({ car: '', repairs: [] })).length, 2)
})

test('the caption states the vehicle, the engine when known, the work, and the shop phone, and nothing else', () => {
  const c = f.buildCaption(facts())
  assert.match(c, /2018 Toyota Camry \(2\.5L 4-cylinder\) finished at Joe’s Auto\./)
  assert.match(c, /- Replace front brake pads and rotors/)
  assert.match(c, /Call \(713\) 555-0100/)
  assert.doesNotMatch(c, /\$|warrant|guarantee|free|%/i)
})

test('with no engine the caption says nothing about an engine', () => {
  const c = f.buildCaption(facts({ engine: '', engineSource: '' }))
  assert.doesNotMatch(c, /Camry \(/)
  assert.match(c, /2018 Toyota Camry finished at/)
})

test('a job still in progress is described as being in the shop, not as finished', () => {
  assert.match(f.buildCaption(facts({ finished: false })), /in the shop at Joe’s Auto/)
})

test('a caption built from the facts always passes its own checks', () => {
  const v = f.vetCaption(f.buildCaption(facts()), facts(), ['facebook', 'instagram', 'google'])
  assert.deepEqual(v.flags, [])
  assert.equal(v.ok, true)
})

test('words from an AI are flagged for emoji, money, promises, new numbers, hashtags and a missing vehicle', () => {
  const fx = facts()
  const platforms = ['facebook']
  const cases = [
    ['Fresh brakes on this 2018 Toyota Camry 🚗', /emoji/],
    ['2018 Toyota Camry brakes done for $199.', /dollar/],
    ['2018 Toyota Camry with a lifetime warranty on brakes.', /guarantee/],
    ['2018 Toyota Camry, brakes done in 3 hours.', /number/],
    ['2018 Toyota Camry brakes done #brakes', /hashtag/],
    ['Fresh brakes at Joe’s Auto.', /name the vehicle/],
    ['2018 Toyota Camry ' + 'a'.repeat(2100), /characters/],
    ['', /empty/],
  ]
  for (const [text, re] of cases) {
    const v = f.vetCaption(text, fx, platforms)
    assert.equal(v.ok, false, text.slice(0, 40))
    assert.ok(v.flags.some(x => re.test(x)), `${text.slice(0, 40)} -> ${v.flags.join(' | ')}`)
  }
})

test('numbers that are on the job are allowed, and code fences and quotes around the answer are removed', () => {
  const fx = facts({ engine: '3.5L V6' })
  const v = f.vetCaption('```\n"This 2018 Toyota Camry with the 3.5L V6 got new front brake pads and rotors."\n```', fx, ['facebook'])
  assert.equal(v.text, 'This 2018 Toyota Camry with the 3.5L V6 got new front brake pads and rotors.')
  assert.deepEqual(v.flags, [])
})

test('the length limit is the smallest among the chosen places', () => {
  assert.equal(f.captionLimit(['facebook', 'google']), POST_LIMITS.google)
  assert.equal(f.captionLimit(['instagram']), POST_LIMITS.instagram)
  assert.equal(f.captionLimit([]), POST_LIMITS.google)
})

test('the prompt gives the AI only the facts, and tells it what it must never add', () => {
  const pr = f.captionPrompt(facts({ engine: '' }), ['facebook'])
  assert.match(pr.user, /Vehicle: 2018 Toyota Camry/)
  assert.match(pr.user, /Engine: not given/)
  assert.match(pr.user, /- Replace front brake pads and rotors/)
  assert.match(pr.system, /Never add or change prices/)
  assert.match(pr.system, /Do not state anything about the engine unless an engine is given/)
})

test('the shared checker is the one the Write a post sheet uses', () => {
  assert.deepEqual(copyFlags('Plain words about brakes.', []), [])
  assert.ok(copyFlags('Brakes for $99', []).length > 0)
})
