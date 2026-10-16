import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CALL_REASONS, FIXED_LIMITS, askedNotToBeCalled, buildCallPlan, buildFreeCallPlan, callStateWords, callingHoursWords, checkAiCall, disclosureLine, hourWords, reasonById,
} from '../src/lib/ai-call.ts'

const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8')

const afternoon = new Date('2026-10-14T20:00:00Z') // Wednesday 3 pm in Houston
const lateNight = new Date('2026-10-15T03:30:00Z') // Wednesday 10:30 pm in Houston
const earlyMorning = new Date('2026-10-14T11:30:00Z') // Wednesday 6:30 am in Houston
const base = { phone: '(713) 555-0142', configured: true, doNotCall: false, optedOut: false, shopTimeZone: 'America/Chicago' }

test('a customer who may be called is allowed in the afternoon', () => {
  const r = checkAiCall({ ...base, now: afternoon })
  assert.equal(r.ok, true)
  assert.equal(r.code, '')
})

test('do not call and STOP each stop the call, and say why in plain words', () => {
  const dnc = checkAiCall({ ...base, doNotCall: true, now: afternoon })
  assert.equal(dnc.ok, false)
  assert.equal(dnc.code, 'do_not_call')
  assert.match(dnc.reason, /asked not to be called/)
  const stop = checkAiCall({ ...base, optedOut: true, now: afternoon })
  assert.equal(stop.ok, false)
  assert.equal(stop.code, 'opted_out')
  assert.match(stop.reason, /STOP/)
})

test('a check that could not be run never lets a call through', () => {
  const r = checkAiCall({ ...base, lookupFailed: true, now: afternoon })
  assert.equal(r.ok, false)
  assert.equal(r.code, 'could_not_check')
  assert.equal(r.status, 503)
})

test('nothing is dialled at night or before the morning, and the answer says when it may', () => {
  for (const now of [lateNight, earlyMorning]) {
    const r = checkAiCall({ ...base, now })
    assert.equal(r.ok, false)
    assert.equal(r.code, 'quiet_hours')
    assert.ok(r.retryAt instanceof Date && r.retryAt.getTime() > now.getTime())
    assert.match(r.reason, /outside your calling hours/)
  }
})

test('the customer\'s own clock counts too: a Los Angeles number is held when it is early there', () => {
  // 4 pm in Houston is 2 pm in Los Angeles, fine; 9:30 am in Houston is 7:30 am in Los Angeles, too early.
  const fine = checkAiCall({ ...base, phone: '(310) 555-0142', now: new Date('2026-10-14T21:00:00Z') })
  assert.equal(fine.ok, true)
  const early = checkAiCall({ ...base, phone: '(310) 555-0142', now: new Date('2026-10-14T14:30:00Z') })
  assert.equal(early.ok, false)
  assert.equal(early.code, 'quiet_hours')
})

test('the shop\'s own quiet hours are used, and Sundays can be skipped', () => {
  const sevenPm = new Date('2026-10-15T00:00:00Z') // Wednesday 7 pm in Houston
  assert.equal(checkAiCall({ ...base, now: sevenPm }).ok, true)
  assert.equal(checkAiCall({ ...base, rules: { quiet_start_hour: 18, quiet_end_hour: 9 }, now: sevenPm }).ok, false)
  const sunday = new Date('2026-10-18T19:00:00Z') // Sunday 2 pm in Houston
  assert.equal(checkAiCall({ ...base, now: sunday }).ok, true)
  assert.equal(checkAiCall({ ...base, rules: { skip_sundays: true }, now: sunday }).ok, false)
})

test('a phone line that is not set up, a missing number and a bad number are each refused', () => {
  assert.equal(checkAiCall({ ...base, configured: false, now: afternoon }).code, 'not_set_up')
  assert.equal(checkAiCall({ ...base, phone: '', now: afternoon }).code, 'no_phone')
  assert.equal(checkAiCall({ ...base, phone: '555-0142', now: afternoon }).code, 'bad_phone')
  assert.equal(checkAiCall({ ...base, phone: '+44 20 7946 0958', now: afternoon }).code, 'bad_phone')
})

test('the calling hours are shown the way an owner reads them', () => {
  assert.equal(hourWords(8), '8 AM')
  assert.equal(hourWords(21), '9 PM')
  assert.equal(hourWords(12), '12 PM')
  assert.equal(callingHoursWords(), '8 AM to 9 PM')
  assert.equal(callingHoursWords({ quiet_start_hour: 18, quiet_end_hour: 9, skip_sundays: true }), '9 AM to 6 PM, not on Sundays')
})

test('every reason is about the customer\'s own car or visit, and none of them sells anything', () => {
  assert.deepEqual(CALL_REASONS.map(r => r.id), ['ready', 'appointment', 'followup', 'estimate', 'due', 'custom'])
  for (const r of CALL_REASONS) assert.doesNotMatch(`${r.label} ${r.hint}`, /promo|discount|special offer|new customer|coupon/i, r.id)
  assert.equal(reasonById('ready')?.label, 'Your car is ready')
  assert.equal(reasonById('sales_pitch'), null)
})

test('a plan needs a reason and the boxes that reason requires', () => {
  assert.equal(buildCallPlan({ request: { reason: '' }, shopName: 'Alpha Auto', customerName: 'Dana' }).ok, false)
  const noWhen = buildCallPlan({ request: { reason: 'appointment' }, shopName: 'Alpha Auto', customerName: 'Dana' })
  assert.equal(noWhen.ok, false)
  assert.ok(noWhen.problems.some(p => /day and time/.test(p)))
  const noNote = buildCallPlan({ request: { reason: 'custom' }, shopName: 'Alpha Auto', customerName: 'Dana' })
  assert.equal(noNote.ok, false)
  const noShop = buildCallPlan({ request: { reason: 'followup' }, shopName: '', customerName: 'Dana' })
  assert.equal(noShop.ok, false)
  assert.ok(noShop.problems.some(p => /shop name/.test(p)))
  const ok = buildCallPlan({ request: { reason: 'ready', vehicle: '2014 Honda Accord' }, shopName: 'Alpha Auto', customerName: 'Dana Ruiz' })
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.problems, [])
})

test('the instruction names the shop, carries the rules and quotes no price the owner did not type', () => {
  const plan = buildCallPlan({ request: { reason: 'estimate', vehicle: '2014 Honda Accord' }, shopName: 'Alpha Auto', customerName: 'Dana Ruiz' })
  assert.equal(plan.ok, true)
  assert.match(plan.task, /calling for Alpha Auto/)
  assert.match(plan.task, /Never promise a time/)
  assert.match(plan.task, /Never take a payment/)
  assert.match(plan.task, /not to be called again/)
  assert.doesNotMatch(plan.task, /\$\s?\d/)
  assert.match(plan.goals.join(' '), /a person will go over it/)
  const priced = buildCallPlan({ request: { reason: 'estimate', vehicle: '2014 Honda Accord', amount: '$412.50' }, shopName: 'Alpha Auto', customerName: 'Dana Ruiz' })
  assert.match(priced.task, /\$412\.50/)
  const noNumber = buildCallPlan({ request: { reason: 'estimate', vehicle: 'Accord', amount: 'cheap' }, shopName: 'Alpha Auto', customerName: 'Dana' })
  assert.equal(noNumber.ok, false)
})

test('quotation marks and line breaks are cleaned out so the call engine reads the text as one instruction', () => {
  const plan = buildCallPlan({ request: { reason: 'custom', note: 'Say "hello"\n\nand ask about the car' }, shopName: 'Alpha "Auto"', customerName: 'Dana' })
  assert.equal(plan.ok, true)
  assert.doesNotMatch(plan.task, /["“”]/)
  assert.doesNotMatch(plan.task, /\n/)
  assert.ok(plan.task.length <= 1800)
})

test('the plan never trips the call engine\'s sales-call wording by itself', () => {
  for (const r of CALL_REASONS) {
    const plan = buildCallPlan({ request: { reason: r.id, vehicle: '2014 Honda Accord', when: 'Friday at 10 AM', note: 'We close at 6' }, shopName: 'Alpha Auto', customerName: 'Dana' })
    assert.equal(plan.ok, true, r.id)
    assert.doesNotMatch(plan.task, /oil.?change|brake|transmission|engine|state inspection/i, r.id)
  }
})

test('what the customer hears first says it is an AI and that the call may be recorded, whatever the shop is called', () => {
  assert.equal(disclosureLine('Alpha Auto'), 'Hi, this is an AI assistant calling for Alpha Auto. This call may be recorded.')
  assert.match(disclosureLine(''), /AI assistant calling\. This call may be recorded/)
  const engine = read('../src/app/api/telnyx-voice-webhook/route.ts')
  assert.match(engine, /Hi, this is an AI assistant calling\$\{shopName \? ` for \$\{shopName\}` : ''\}\. This call may be recorded\./)
  assert.ok(FIXED_LIMITS.some(l => /AI assistant/.test(l)))
  assert.ok(FIXED_LIMITS.some(l => /payment/.test(l)))
})

test('a customer asking not to be called again is noticed, and the assistant\'s own words are not', () => {
  assert.equal(askedNotToBeCalled([{ speaker: 'ai', text: 'Hi' }, { speaker: 'person', text: 'Please stop calling me.' }]), true)
  assert.equal(askedNotToBeCalled([{ speaker: 'person', text: "Don't call again" }]), true)
  assert.equal(askedNotToBeCalled([{ speaker: 'person', text: 'Take me off your list' }]), true)
  assert.equal(askedNotToBeCalled([{ speaker: 'ai', text: 'If you want, I can stop calling you.' }]), false)
  assert.equal(askedNotToBeCalled([{ speaker: 'person', text: 'Yes, tomorrow works. Call me then.' }]), false)
})

test('the call state is shown in words', () => {
  assert.deepEqual(callStateWords('calling'), { state: 'calling', label: 'Calling now' })
  assert.deepEqual(callStateWords('active'), { state: 'live', label: 'On the call' })
  assert.deepEqual(callStateWords('ended'), { state: 'ended', label: 'Call ended' })
  assert.equal(callStateWords(undefined).state, 'unknown')
})

test('the server runs the rules again on every assistant-placed call, whichever screen asked', () => {
  const makeCall = read('../src/app/api/make-call/route.ts')
  assert.match(makeCall, /if \(callTask\) \{\s*const context = await loadCallContext/)
  assert.match(makeCall, /checkCallContext\(context, e164\)/)
  assert.doesNotMatch(makeCall, /inQuietHours/)
  const start = read('../src/app/api/ai-call/start/route.ts')
  assert.match(start, /body\?\.confirm !== true/)
  assert.match(start, /idempotency-key/)
  assert.match(start, /resolveCall\(db, auth\.shopId, shop, body\)/)
  const server = read('../src/lib/ai-call-server.ts')
  assert.match(server, /buildCallPlan\(\{ request: readCallRequest\(body\?\.request\)/)
  assert.match(server, /buildFreeCallPlan\(\{ task:/)
  assert.match(start, /checkCallContext\(ctx, customer\.phone\)/)
  // the instruction comes from the plan built on the server, never from the browser
  assert.doesNotMatch(start, /body\?\.task/)
})

test('the browser cannot start a call without the approval key, and one approval uses one key', () => {
  const sheet = read('../src/components/customers/AiCallSheet.tsx')
  assert.match(sheet, /'Idempotency-Key': idemRef\.current\.key/)
  assert.match(sheet, /crypto\.randomUUID\(\)/)
})

test('stopping a call is only allowed on the shop\'s own call, and stopping an ended call is not an error', () => {
  const stop = read('../src/app/api/ai-call/stop/route.ts')
  assert.match(stop, /\.eq\('shop_id', auth\.shopId\)\.maybeSingle\(\)/)
  assert.match(stop, /status\) === 'ended'\) return NextResponse\.json\(\{ ok: true/)
  assert.match(stop, /response\.status === 404 \|\| response\.status === 422/)
})

test('contact choices are written for this shop only and leave the customer record and text consent alone', () => {
  const prefs = read('../src/app/api/customers/contact-prefs/route.ts')
  assert.match(prefs, /onConflict: 'shop_id,customer_id'/)
  assert.doesNotMatch(prefs, /from\('customers'\)\.(update|delete|insert)/)
  assert.doesNotMatch(prefs, /recordSmsOptIn|opted_out: false/)
  assert.match(prefs, /auth\.role === 'viewer'\) return forbidden/)
})

test('a call typed or proposed in Ask Alpha waits on a review card and cannot be approved while blocked', () => {
  const review = read('../src/lib/ai/review.ts')
  assert.match(review, /export function buildCallReview/)
  assert.match(review, /gate\(options\.rules, action,/)
  const page = read('../src/app/(app)/ai/page.tsx')
  // all three places that used to refuse now open the card, and the personal call only opens the owner's own phone after approval
  assert.equal((page.match(/requestCall\(/g) || []).length, 3)
  assert.match(page, /confirmPlaceCall/)
  assert.match(page, /callPreview\.blocked \|\| callPreview\.problems\.length > 0\) return/)
  assert.match(page, /busy=\{callPlacing \|\| \(pendingCall\.kind === 'assistant' && callChecking\)\}/)
  assert.match(page, /Declined: \$\{getActionInfo\(pendingCall\.kind === 'personal'/)
})

test('the free-text plan carries the same rules as the card plan and needs words and a shop name', () => {
  const plan = buildFreeCallPlan({ task: 'Ask if the alternator for the 2014 Accord is in stock.', shopName: 'Alpha Auto' })
  assert.equal(plan.ok, true)
  assert.match(plan.task, /alternator/)
  assert.match(plan.task, /Never take a payment/)
  assert.match(plan.task, /calling for Alpha Auto/)
  assert.equal(buildFreeCallPlan({ task: 'hi', shopName: 'Alpha Auto' }).ok, false)
  assert.equal(buildFreeCallPlan({ task: 'Ask about the part we ordered.', shopName: '' }).ok, false)
})
