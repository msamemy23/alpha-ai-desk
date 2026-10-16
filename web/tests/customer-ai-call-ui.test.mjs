import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CALL_REASONS } from '../src/lib/ai-call.ts'
import { fetchJson, asText, asTextList } from '../src/components/customers/http.ts'

// Source assertions for the "Call with Alpha" review card, the contact choices and the customer card that hosts them.
// The components are React and need a browser, so these tests read the files and check the rules that must not drift.

const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8')
const sheet = read('../src/components/customers/AiCallSheet.tsx')
const perms = read('../src/components/customers/ContactPermissions.tsx')
const history = read('../src/components/customers/AlphaCalls.tsx')
const detail = read('../src/components/customers/CustomerDetail.tsx')

const count = (src, re) => (src.match(re) || []).length
/** The text between two markers, so a rule can be checked inside one function only. */
const between = (src, from, to) => {
  const a = src.indexOf(from)
  const b = src.indexOf(to, a + from.length)
  assert.ok(a >= 0 && b > a, `markers not found: ${from} .. ${to}`)
  return src.slice(a, b)
}

/* ---------- the review card ---------- */

test('the review card is a Sheet titled Call with Alpha and uses the shared call rules', () => {
  assert.match(sheet, /import Sheet from '@\/components\/Sheet'/)
  assert.match(sheet, /<Sheet open=\{open\} onClose=\{requestClose\} title="Call with Alpha"/)
  assert.match(sheet, /import Notice from '@\/components\/Notice'/)
  for (const name of ['CALL_REASONS', 'MAX_FIELD', 'askedNotToBeCalled', 'callStateWords']) {
    assert.match(sheet, new RegExp(`\\b${name}\\b`), `${name} is used`)
  }
  assert.match(sheet, /from '@\/lib\/ai-call'/)
})

test('every box a reason uses has plain words, a 16px input and the length limit', () => {
  const used = new Set(CALL_REASONS.flatMap(r => r.fields))
  for (const f of used) assert.match(sheet, new RegExp(`\\b${f}: \\{ label:`), `${f} has a label`)
  for (const label of ['Vehicle', 'Day and time', 'Estimate total', 'What Alpha should say']) assert.match(sheet, new RegExp(`label: '${label}'`))
  assert.match(sheet, /Only spoken if you type it/)
  assert.match(sheet, /maxLength=\{MAX_FIELD\}/)
  assert.match(sheet, /className="form-input"/)
  assert.match(sheet, /className="form-textarea"/)
  assert.match(sheet, /\? 'Required' : 'Optional'/)
  assert.match(sheet, /CALL_REASONS\.map/)
  assert.match(sheet, /type="radio"/)
  assert.match(sheet, /min-h-\[52px\]/)
})

test('the review card asks the server to preview on open and after typing, with the documented body', () => {
  assert.match(sheet, /fetchJson\('\/api\/ai-call\/preview', \{\s*method: 'POST',\s*headers: JSON_HEADERS,\s*body: JSON\.stringify\(\{ customer_id: customer\.id, request \}\)/)
  assert.match(sheet, /const TYPING_DELAY_MS = 350/)
  // the request carries all five keys, and only the boxes the reason uses are filled
  assert.match(sheet, /return \{ reason, vehicle: pick\('vehicle'\), when: pick\('when'\), amount: pick\('amount'\), note: pick\('note'\) \}/)
  // a slow answer to an older request can never replace a newer one
  assert.match(sheet, /const mine = \+\+seq\.current/)
  assert.equal(count(sheet, /if \(mine !== seq\.current\) return/g), 2)
  assert.match(sheet, /ctl\.abort\(\)/)
})

test('the review card shows what the customer hears, what Alpha will and will not do, and the calling hours', () => {
  for (const heading of ['What the customer hears first', 'What Alpha will do', 'What Alpha will not do', 'Calling hours']) assert.ok(sheet.includes(heading), heading)
  for (const field of ['plan.disclosure', 'plan.goals', 'plan.limits', 'plan.problems', 'preview.hours']) assert.ok(sheet.includes(field), field)
  // problems go in an info notice; a blocked call is an error, or a warning for quiet hours
  assert.match(sheet, /<Notice kind="info">/)
  assert.match(sheet, /check\.code === 'quiet_hours' \? 'warn' : 'error'/)
  assert.match(sheet, /preview\.check\.reason/)
})

test('a failed check says nothing was dialled and offers a retry', () => {
  assert.ok(sheet.includes('Could not check this call. Nothing was dialled.'))
  assert.match(sheet, /onClick=\{\(\) => setRetryTick\(t => t \+ 1\)\}>Try again</)
})

test('Approve is disabled unless the plan and the check both pass for what is on screen', () => {
  assert.match(sheet, /const canApprove = current && preview!\.plan\.ok && preview!\.check\.ok && !approving && !uncertain/)
  assert.match(sheet, /disabled=\{!canApprove\}/)
  assert.ok(sheet.includes('Approve and call now'))
  assert.ok(sheet.includes('>{uncertain ? \'Close\' : \'Cancel\'}<'))
  // "current" means the answer belongs to the request on screen and no check is running
  assert.match(sheet, /const current = Boolean\(preview\) && preview\?\.key === requestKey && !checking/)
  // approve re-checks the same things, so a stale tap does nothing
  assert.match(sheet, /if \(approvingRef\.current \|\| !canApprove \|\| !preview\) return/)
})

test('one approve sends one start request, with confirm true and the request that was previewed', () => {
  assert.equal(count(sheet, /\/api\/ai-call\/start/g), 1)
  assert.match(sheet, /body: JSON\.stringify\(\{ customer_id: customer\.id, request: preview\.request, confirm: true \}\)/)
  assert.equal(count(sheet, /confirm: true/g), 1)
  const approve = between(sheet, 'const approve = async () => {', 'const name = preview?.name')
  assert.match(approve, /approvingRef\.current = true/)
  assert.match(approve, /finally \{\s*approvingRef\.current = false/)
  // the sheet cannot be closed while the answer is on its way
  assert.match(sheet, /if \(busy\.current\) return/)
})

test('an unconfirmed start is never retried for the owner', () => {
  const approve = between(sheet, 'const approve = async () => {', 'const name = preview?.name')
  assert.ok(sheet.includes("We could not confirm the call started. Check Alpha&apos;s calls on this customer before trying again."))
  assert.match(approve, /d\.uncertain === true/)
  assert.match(approve, /setUncertain\(\{ callId \}\)/)
  // a network failure or an unreadable answer is treated the same way, because the call may have been placed
  assert.match(approve, /\} catch \{\s*setUncertain\(\{ callId: '' \}\)/)
  // nothing in the approve path schedules or loops another start
  assert.doesNotMatch(approve, /setTimeout|setInterval|approve\(\)/)
  // and the button stays off until the sheet is opened again
  assert.match(sheet, /!approving && !uncertain/)
  // a definite refusal shows the server's reason and refreshes the preview instead
  assert.match(approve, /setStartError\(asText\(d\.error\) \|\| 'The call did not start\. Nothing was dialled\.'\)/)
})

/* ---------- the live call ---------- */

test('the live step polls the call every 2.5 seconds and stops when it ends or the sheet closes', () => {
  assert.match(sheet, /const POLL_MS = 2500/)
  assert.match(sheet, /fetchJson\(`\/api\/call-summary\/\$\{encodeURIComponent\(callId\)\}`/)
  assert.match(sheet, /if \(callStateWords\(next\.status\)\.state === 'ended'\) \{\s*again = false/)
  assert.match(sheet, /return \(\) => \{ alive = false; clearTimeout\(timer\); ctl\?\.abort\(\) \}/)
  // one request at a time: the next read is scheduled only after the last one finished
  assert.match(sheet, /if \(alive && again\) timer = setTimeout\(tick, POLL_MS\)/)
  assert.doesNotMatch(sheet, /setInterval/)
})

test('the transcript is a bounded live log and says who spoke in words', () => {
  assert.match(sheet, /role="log"/)
  assert.match(sheet, /aria-live="polite"/)
  assert.match(sheet, /max-h-64 overflow-y-auto/)
  assert.ok(sheet.includes("l.speaker === 'ai' ? 'Alpha' : 'Customer'"))
  assert.match(sheet, /el\.scrollTop = el\.scrollHeight/)
  // the call state is a lamp beside words, and the three lamps match the rest of the app
  assert.match(sheet, /calling: 'lamp-amber', live: 'lamp-green', ended: 'lamp-off'/)
  assert.match(sheet, /className=\{`lamp \$\{lampClass\}`\} aria-hidden="true"/)
  assert.match(sheet, /\{label\}/)
})

test('Stop the call posts to the stop route, shows Stopping and leaves the call running if the window closes', () => {
  assert.ok(sheet.includes('Stop the call'))
  assert.match(sheet, /fetchJson\('\/api\/ai-call\/stop', \{ method: 'POST', headers: JSON_HEADERS, body: JSON\.stringify\(\{ callId \}\) \}\)/)
  assert.match(sheet, /btn btn-danger btn-lg w-full/)
  assert.ok(sheet.includes("'Stopping…' : 'Stop the call'"))
  assert.match(sheet, /if \(stopBusy\.current \|\| ended\) return/)
  assert.ok(sheet.includes('Closing this window does not hang up the call. Use Stop the call.'))
  // closing the sheet must not call the stop route: the only stop request is inside stop()
  assert.equal(count(sheet, /\/api\/ai-call\/stop/g), 1)
  const stop = between(sheet, 'const stop = async () => {', 'const asked = useMemo')
  assert.match(stop, /\/api\/ai-call\/stop/)
})

test('a finished call shows its summary and offers to mark do not call when the customer asked', () => {
  assert.ok(sheet.includes('No summary was written for this call.'))
  assert.match(sheet, /askedNotToBeCalled\(\(data\?\.transcript \?\? \[\]\)\.map\(l => \(\{ speaker: l\.speaker, text: l\.text \}\)\)\)/)
  assert.ok(sheet.includes('The customer asked not to be called again.'))
  assert.ok(sheet.includes('Mark do not call'))
  assert.match(sheet, /fetchJson\('\/api\/customers\/contact-prefs', \{\s*method: 'PUT',\s*headers: JSON_HEADERS,\s*body: JSON\.stringify\(\{ customer_id: customer\.id, do_not_call: true \}\)/)
  assert.match(sheet, /<Notice kind="warn">/)
})

test('the sheet sits on top of the customer sheet without closing it, and a running call survives a close', () => {
  assert.match(sheet, /window\.addEventListener\('keydown', onKey, true\)/)
  assert.match(sheet, /e\.stopPropagation\(\)/)
  assert.match(sheet, /const startAt = resumeCallId \|\| activeCallId/)
  assert.match(sheet, /onChanged\?: \(\) => void/)
  assert.match(sheet, /dirty=\{dirty\}/)
})

/* ---------- who can contact them ---------- */

test('contact choices are read with consentView and shown as lamp, word and sentence', () => {
  assert.match(perms, /import \{ consentView \} from '@\/lib\/customers\/consent'/)
  assert.match(perms, /\/api\/customers\/contact-prefs\?customer_id=\$\{encodeURIComponent\(customerId\)\}/)
  assert.match(perms, /cardOptedOut: false/)
  assert.match(perms, /record: data\.smsCheckFailed \? undefined : \(data\.sms \? \{ optedOut: data\.sms\.optedOut, source: data\.sms\.source, updatedAt: data\.sms\.updatedAt \} : null\)/)
  assert.match(perms, /doNotText: false/)
  for (const row of ['name="Text"', 'name="Call"', 'name="Email"']) assert.ok(perms.includes(row), row)
  assert.match(perms, /view\.label/)
  assert.match(perms, /view\.detail/)
  assert.match(perms, /className=\{`lamp \$\{LAMP\[view\.state\]\}`\} aria-hidden="true"/)
})

test('the two switches are real switches with visible words and roll back when saving fails', () => {
  assert.equal(count(perms, /role="switch"/g), 1)
  assert.match(perms, /aria-checked=\{on\}/)
  assert.match(perms, /min-h-\[52px\]/)
  assert.ok(perms.includes("{on ? 'On' : 'Off'}"))
  assert.ok(perms.includes('Do not call this customer'))
  assert.ok(perms.includes('Do not email this customer'))
  assert.match(perms, /method: 'PUT'/)
  assert.match(perms, /body: JSON\.stringify\(\{ customer_id: customerId, \[choice\.field\]: next \}\)/)
  // optimistic, then undone with a visible message
  assert.match(perms, /set\(next\)/)
  assert.match(perms, /set\(before\)/)
  assert.ok(perms.includes('That change was not saved.'))
  assert.match(perms, /role="alert"/)
  // a second tap while one is saving does nothing
  assert.match(perms, /savingRef\.current\[choice\.key\]\) return/)
})

test('text consent cannot be switched back on from the app', () => {
  assert.doesNotMatch(perms, /do_not_text|opted_out:\s*false|optedOut:\s*false/)
  assert.deepEqual([...perms.matchAll(/\{ key: '\w+', field: '(\w+)'/g)].map(m => m[1]), ['do_not_call', 'do_not_email'])
  assert.ok(perms.includes('Only the customer can turn texts back on, by replying START.'))
})

test('contact choices have loading, error and loaded states, and a notice when the table is missing', () => {
  assert.match(perms, /aria-busy="true" aria-label="Loading contact choices"/)
  assert.ok(perms.includes('Contact choices could not be loaded.'))
  assert.match(perms, /onClick=\{\(\) => void load\(false\)\}>Try again</)
  assert.ok(perms.includes('Contact choices need a database update. Everything else still works.'))
  // with no table there are no switches
  assert.match(perms, /!data\.available \? \(\s*<Notice kind="info">/)
})

/* ---------- Alpha's calls ---------- */

test("Alpha's calls has four states and reads the history route", () => {
  assert.match(history, /\/api\/ai-call\/history\?customer_id=\$\{encodeURIComponent\(customerId\)\}/)
  assert.match(history, /aria-busy="true" aria-label="Loading Alpha's calls"/)
  assert.ok(history.includes('Alpha has not called this customer yet.'))
  assert.ok(history.includes('could not be loaded.'))
  assert.match(history, />Try again</)
  assert.ok(history.includes('They asked not to be called again'))
  assert.match(history, /fmtDayTime\(c\.startedAt\)/)
  assert.match(history, /<details>/)
  // newest first
  assert.match(history, /\(b\.startedAt \|\| ''\)\.localeCompare\(a\.startedAt \|\| ''\)/)
  assert.match(history, /break-words/)
})

/* ---------- the customer card ---------- */

test('the customer card keeps Call, Text and Email exactly as they were and adds Call with Alpha', () => {
  assert.match(detail, /onClick=\{\(\) => dialCustomer\(customer\)\} disabled=\{!customer\.phone\}>\s*<Icon name="phone" className="h-5 w-5" \/>Call\s*</)
  assert.match(detail, /onClick=\{onText\} disabled=\{!customer\.phone\}>\s*<Icon name="inbox" className="h-5 w-5" \/>Text\s*</)
  assert.match(detail, /onClick=\{onEmail\} disabled=\{!customer\.email\}>\s*<Icon name="mail" className="h-5 w-5" \/>Email\s*</)
  assert.match(detail, /grid grid-cols-2 gap-2 sm:grid-cols-4/)
  assert.match(detail, /onClick=\{\(\) => \{ setWatchCallId\(''\); setCallOpen\(true\) \}\} disabled=\{!customer\.phone\}>\s*<Icon name="alpha" className="h-5 w-5" \/>Call with Alpha/)
  assert.match(detail, /export function dialCustomer/)
})

test('the customer card renders the review sheet, the contact choices and the call list in the right places', () => {
  assert.match(detail, /import AiCallSheet from '\.\/AiCallSheet'/)
  assert.match(detail, /import ContactPermissions from '\.\/ContactPermissions'/)
  assert.match(detail, /import AlphaCalls from '\.\/AlphaCalls'/)
  assert.match(detail, /<AiCallSheet\s+key=\{customer\.id\}/)
  assert.match(detail, /onChanged=\{\(\) => setCallTick\(t => t \+ 1\)\}/)
  assert.match(detail, /vehicle=\{callVehicle\}/)
  assert.match(detail, /<Section id="cd-permissions" title="Who can contact them">/)
  assert.match(detail, /<Section id="cd-alpha-calls" title="Alpha's calls">/)
  const at = s => detail.indexOf(s)
  assert.ok(at('id="cd-docs"') < at('id="cd-permissions"'), 'contact choices come after the paperwork')
  assert.ok(at('id="cd-permissions"') < at('id="cd-touch"'), 'and above recent texts and calls')
  assert.ok(at('id="cd-touch"') < at('id="cd-alpha-calls"'), "Alpha's calls follow the texts and calls")
  // every section id on the card is still unique, since each one labels its own heading
  const ids = [...detail.matchAll(/<Section\s+id="([^"]+)"/g)].map(m => m[1])
  assert.equal(new Set(ids).size, ids.length, ids.join(','))
})

test('the customer card still computes money, documents and queries the same way', () => {
  for (const line of [
    "supabase.from('documents').select('*').eq('shop_id', shopId).eq('customer_id', customer.id)",
    'const t = calcTotals(d)',
    'return { owed: owedOn(rows), paid: paidOn(rows), owing }',
    "['Unpaid', 'Partial', 'Sent'].includes(d.status) && d.balance > 0.005",
    'const DOC_LIMIT = 200',
  ]) assert.ok(detail.includes(line), line)
})

/* ---------- the house rules ---------- */

const files = {
  'AiCallSheet.tsx': sheet,
  'ContactPermissions.tsx': perms,
  'AlphaCalls.tsx': history,
  'CustomerDetail.tsx': detail,
}

test('the new screens follow the design rules: tokens only, no emoji, no gradients, no shadows, no capitals', () => {
  for (const [name, src] of Object.entries(files)) {
    assert.doesNotMatch(src, /#[0-9a-fA-F]{3,8}\b/, `${name} has a hard-coded hex colour`)
    assert.doesNotMatch(src, /\b(?:rgb|rgba|hsl|hsla)\(\s*\d/, `${name} has a hard-coded colour function`)
    assert.doesNotMatch(src, /\p{Extended_Pictographic}/u, `${name} has an emoji`)
    assert.doesNotMatch(src, /gradient/i, `${name} has a gradient`)
    assert.doesNotMatch(src, /shadow-/, `${name} has a shadow class`)
    assert.doesNotMatch(src, /uppercase/i, `${name} has uppercase text`)
    assert.doesNotMatch(src, /tracking-wider|backdrop-blur/, `${name} has a banned class`)
    assert.doesNotMatch(src, /\b(?:text|bg|border)-(?:white|black|gray|slate|zinc|neutral)(?:-\d+)?\b/, `${name} uses a raw palette colour`)
  }
})

test('the new screens meet the touch and text-size rules', () => {
  // inputs use the shared 16px classes, never a smaller text size
  for (const src of [sheet]) {
    assert.doesNotMatch(src, /<input[^>]*text-\[(?:0\.\d+|1[0-5]px)/)
    assert.doesNotMatch(src, /<textarea[^>]*text-\[(?:0\.\d+|1[0-5]px)/)
  }
  // long names and summaries wrap instead of widening the page
  for (const src of [sheet, perms, history]) assert.match(src, /break-words/)
  // every button names its action and is at least the shared 44px size
  for (const src of [sheet, perms, history]) assert.doesNotMatch(src, /<button[^>]*className="[^"]*\bh-(?:6|7|8|9|10)\b/)
})

/* ---------- the shared fetch helper ---------- */

test('fetchJson returns the parsed object, null for anything else, and throws only when nothing came back', async () => {
  const real = globalThis.fetch
  try {
    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ ok: true, callId: 'c1' }) })
    assert.deepEqual(await fetchJson('/x'), { ok: true, status: 200, data: { ok: true, callId: 'c1' } })

    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => { throw new Error('not json') } })
    assert.deepEqual(await fetchJson('/x'), { ok: false, status: 500, data: null })

    globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => [1, 2] })
    assert.equal((await fetchJson('/x')).data, null)

    globalThis.fetch = async () => { throw new TypeError('network down') }
    await assert.rejects(fetchJson('/x'), /network down/)

    // gives up after the timeout instead of hanging, and a cancel from the caller also ends it
    globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))))
    await assert.rejects(fetchJson('/x', {}, 20), /aborted/)
    const ctl = new AbortController()
    const pending = fetchJson('/x', { signal: ctl.signal }, 5000)
    ctl.abort()
    await assert.rejects(pending, /aborted/)
  } finally {
    globalThis.fetch = real
  }
})

test('the response readers ignore anything that is not text', () => {
  assert.equal(asText('hi'), 'hi')
  assert.equal(asText(5), '')
  assert.equal(asText(null), '')
  assert.deepEqual(asTextList(['a', '', '  ', 3, 'b']), ['a', 'b'])
  assert.deepEqual(asTextList('nope'), [])
})
