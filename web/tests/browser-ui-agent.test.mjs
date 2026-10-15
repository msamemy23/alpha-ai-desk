import test from 'node:test'
import assert from 'node:assert/strict'
import * as ag from '../src/components/browser/agent-state.ts'

const ref = n => ({ loc: `body > :nth-child(${n})`, fp: `fp${n}` })
const snap = (over = {}) => ({
  url: 'https://shop.example.com/parts', host: 'shop.example.com', title: 'Parts', status: 200, scrollY: 300, scrollHeight: 2400, viewport: { w: 390, h: 844 },
  image: 'data:image/jpeg;base64,AAAA', controls: [], text: 'Brake pads part 123', injection: { suspected: false, hits: [], hiddenText: false },
  signInRequired: false, captcha: false, downloads: [], blocked: [], prepared: [{ kind: 'fill', ref: ref(2), value: 'civic' }], notes: [], ...over,
})
const details = (over = {}) => ({ kind: 'submit', title: 'Send a form', summary: 'Press "Send" on shop.example.com.', host: 'shop.example.com', url: 'https://shop.example.com/contact', fields: [], why: 'It sends.', ...over })
const step = (n, did = 'Looked', result = 'Done.') => ({ n, did, result })
const cont = (n, over = {}) => ({ status: 'continue', step: step(n), snapshot: snap(), ...over })

const start = () => ag.agentReduce(null, { type: 'start', id: 7, goal: '  find the part number  ', startUrl: 'https://shop.example.com/', viewport: 'phone' })

/* ---------- starting ---------- */

test('a run starts running, with the goal tidied and nothing done yet', () => {
  const run = start()
  assert.equal(run.id, 7)
  assert.equal(run.status, 'running')
  assert.equal(run.goal, 'find the part number')
  assert.equal(run.url, 'https://shop.example.com/')
  assert.deepEqual(run.steps, [])
  assert.equal(run.snapshot, null)
  assert.equal(run.working, false)
  assert.ok(ag.canAskNext(run))
  assert.ok(ag.isActive(run))
})

test('a goal longer than the server takes is cut to what it takes', () => {
  assert.equal(ag.startRun(1, 'a'.repeat(2000), 'https://a.example.com/', 'phone').goal.length, 1200)
})

test('asking for a step marks the run as working, and nothing else is asked for while it works', () => {
  let run = ag.agentReduce(start(), { type: 'asking' })
  assert.equal(run.working, true)
  assert.ok(!ag.canAskNext(run))
  assert.match(ag.runStatus(run).word, /step 1 of 12/)
  assert.equal(ag.runStatus(run).lamp, 'blue')
})

/* ---------- one step at a time ---------- */

test('a finished step is added to the list and the page it ended on is remembered for the next step', () => {
  let run = ag.agentReduce(start(), { type: 'asking' })
  run = ag.agentReduce(run, { type: 'result', result: cont(1) })
  assert.equal(run.status, 'running')
  assert.equal(run.working, false)
  assert.deepEqual(run.steps, [step(1)])
  assert.equal(run.url, 'https://shop.example.com/parts')
  assert.equal(run.scrollY, 300)
  assert.deepEqual(run.prepared, [{ kind: 'fill', ref: ref(2), value: 'civic' }])
  assert.deepEqual(run.visited, ['https://shop.example.com/parts'])
  assert.ok(ag.canAskNext(run))
})

test('opening a new address starts that page fresh: no entries carried over', () => {
  let run = ag.agentReduce(start(), { type: 'result', result: cont(1) })
  run = ag.agentReduce(run, { type: 'result', result: cont(2, { snapshot: null, navigateTo: 'https://other.example.com/x' }) })
  assert.equal(run.url, 'https://other.example.com/x')
  assert.deepEqual(run.prepared, [])
  assert.equal(run.scrollY, 0)
  assert.deepEqual(run.visited, ['https://shop.example.com/parts', 'https://other.example.com/x'])
  const body = ag.agentBody(run)
  assert.equal(body.url, 'https://other.example.com/x')
  assert.deepEqual(body.prepared, [])
})

test('Alpha stops at 12 steps and says so, keeping where it got to', () => {
  let run = start()
  for (let n = 1; n <= 11; n++) run = ag.agentReduce(run, { type: 'result', result: cont(n) })
  assert.equal(run.status, 'running')
  assert.ok(ag.canAskNext(run))
  run = ag.agentReduce(run, { type: 'result', result: cont(12) })
  assert.equal(run.status, 'stopped')
  assert.match(run.message, /all 12 steps/)
  assert.ok(!ag.canAskNext(run))
  assert.ok(!ag.isActive(run))
  assert.equal(run.steps.length, 12)
  assert.equal(run.snapshot.url, 'https://shop.example.com/parts')
})

test('a finished lookup keeps the answer, the words it quoted, whether they matched, and the page it came from', () => {
  let run = ag.agentReduce(start(), { type: 'result', result: cont(1) })
  run = ag.agentReduce(run, { type: 'result', result: { status: 'done', answer: 'Part 123', evidence: 'part 123', verified: true, step: step(2, 'Finished', 'Answer matches the page'), snapshot: snap({ title: 'Parts page' }) } })
  assert.equal(run.status, 'done')
  assert.deepEqual(run.answer, { text: 'Part 123', evidence: 'part 123', verified: true, sourceUrl: 'https://shop.example.com/parts', sourceTitle: 'Parts page' })
  assert.ok(!ag.isActive(run))
  assert.deepEqual(ag.runStatus(run), { lamp: 'green', word: 'Done' })
  const loose = ag.agentReduce(start(), { type: 'result', result: { status: 'done', answer: 'x', evidence: '', verified: false, step: step(1), snapshot: snap() } })
  assert.equal(loose.answer.verified, false)
})

test('something that needs the person stops the loop and says what', () => {
  const run = ag.agentReduce(start(), { type: 'result', result: { status: 'needs_user', message: 'Sign in on the site first.', step: step(1, 'Looked', 'Needs you'), snapshot: snap({ signInRequired: true }) } })
  assert.equal(run.status, 'needs_you')
  assert.equal(run.message, 'Sign in on the site first.')
  assert.ok(!ag.canAskNext(run))
  assert.ok(ag.isActive(run))
  assert.equal(ag.runStatus(run).lamp, 'red')
})

test('an error from the server fails the run with its words, and a missing database part is marked as setup', () => {
  const run = ag.agentReduce(start(), { type: 'result', result: { status: 'error', message: 'Alpha could not reach its AI.' } })
  assert.equal(run.status, 'failed')
  assert.equal(run.message, 'Alpha could not reach its AI.')
  assert.equal(run.failure.setup, false)
  const setup = ag.agentReduce(start(), { type: 'result', result: { status: 'error', message: 'Approvals need a database update before Alpha can open a new site.' } })
  assert.equal(setup.failure.setup, true)
  assert.ok(!ag.isActive(run))
  assert.deepEqual(ag.runStatus(run), { lamp: 'red', word: 'Could not continue' })
})

test('a failed run can be tried again from where it was, and only a failed run', () => {
  let run = ag.agentReduce(start(), { type: 'result', result: cont(1) })
  run = ag.agentReduce(run, { type: 'failed', failure: { message: 'No connection. Check your internet and try again.', code: 'offline', status: 0, setup: false, blocked: false, offline: true, forbidden: false, retryAfter: 0 } })
  assert.equal(run.status, 'failed')
  assert.equal(run.message, 'No connection. Check your internet and try again.')
  const again = ag.agentReduce(run, { type: 'retry' })
  assert.equal(again.status, 'running')
  assert.equal(again.message, '')
  assert.equal(again.steps.length, 1)
  assert.ok(ag.canAskNext(again))
  const running = ag.agentReduce(start(), { type: 'retry' })
  assert.equal(running.status, 'running')
  assert.equal(ag.agentReduce(ag.agentReduce(start(), { type: 'stop' }), { type: 'retry' }).status, 'stopped')
})

/* ---------- Stop ---------- */

test('Stop ends the run at once, and says a step already on its way may still have finished', () => {
  const working = ag.agentReduce(start(), { type: 'asking' })
  const stopped = ag.agentReduce(working, { type: 'stop' })
  assert.equal(stopped.status, 'stopped')
  assert.equal(stopped.working, false)
  assert.equal(stopped.message, ag.STOPPED_WORDS)
  assert.ok(!ag.canAskNext(stopped))
  assert.equal(ag.agentReduce(start(), { type: 'stop' }).message, 'Stopped.')
})

test('Stop also clears a waiting approval, and does not undo a finished lookup', () => {
  const waiting = ag.agentReduce(start(), { type: 'result', result: { status: 'needs_approval', step: step(1, 'Tapped "Send"', 'Waiting for your OK'), snapshot: snap(), approval: details(), approvalId: 'a1', resume: { kind: 'live', action: { kind: 'click', ref: ref(3) } } } })
  assert.equal(waiting.status, 'approval')
  const stopped = ag.agentReduce(waiting, { type: 'stop' })
  assert.equal(stopped.approval, null)
  const done = ag.agentReduce(start(), { type: 'result', result: { status: 'done', answer: 'x', evidence: 'x', verified: true, step: step(1), snapshot: snap() } })
  assert.equal(ag.agentReduce(done, { type: 'stop' }).status, 'done')
})

test('an answer that arrives after Stop is thrown away', () => {
  const stopped = ag.agentReduce(ag.agentReduce(start(), { type: 'asking' }), { type: 'stop' })
  assert.equal(ag.agentReduce(stopped, { type: 'result', result: cont(1) }), stopped)
  assert.equal(ag.agentReduce(stopped, { type: 'failed', failure: { message: 'x', code: '', status: 500, setup: false, blocked: false, offline: false, forbidden: false, retryAfter: 0 } }).status, 'stopped')
})

test('a new run replaces the old one completely', () => {
  let run = ag.agentReduce(start(), { type: 'result', result: cont(1) })
  run = ag.agentReduce(run, { type: 'start', id: 8, goal: 'second', startUrl: 'https://b.example.com/', viewport: 'desktop' })
  assert.equal(run.id, 8)
  assert.deepEqual(run.steps, [])
  assert.equal(run.snapshot, null)
  assert.equal(run.viewport, 'desktop')
})

/* ---------- approvals ---------- */

const approvalRun = (resume = { kind: 'live', action: { kind: 'click', ref: ref(3) } }, kind = 'submit') =>
  ag.agentReduce(start(), { type: 'result', result: { status: 'needs_approval', step: step(1, 'Tapped "Send"', 'Waiting for your OK'), snapshot: snap(), approval: details({ kind }), approvalId: 'a1', resume } })

test('anything that sends stops at an approval card that says Alpha wants it, and waits', () => {
  const run = approvalRun()
  assert.equal(run.status, 'approval')
  assert.equal(run.approval.phase, 'asking')
  assert.equal(run.approval.actor, 'ai')
  assert.equal(run.approval.approvalId, 'a1')
  assert.deepEqual(run.approval.action, { kind: 'click', ref: ref(3) })
  assert.ok(!ag.canAskNext(run))
  assert.ok(ag.isActive(run))
  assert.deepEqual(ag.runStatus(run), { lamp: 'amber', word: 'Waiting for your OK' })
})

test('an approval to open a site, or to save a file, has no action to send again', () => {
  assert.equal(approvalRun({ kind: 'open', url: 'https://new.example.com/' }, 'open_site').approval.action, null)
  assert.equal(approvalRun({ kind: 'live', action: { kind: 'click', ref: ref(3) } }, 'download').approval.action.kind, 'click')
})

test('the phases of the card follow the buttons, and a retry keeps the words of what went wrong', () => {
  let run = approvalRun()
  run = ag.agentReduce(run, { type: 'approvalPhase', phase: 'deciding' })
  assert.equal(run.approval.phase, 'deciding')
  assert.equal(run.working, true)
  run = ag.agentReduce(run, { type: 'approvalPhase', phase: 'retry', error: 'No connection.' })
  assert.equal(run.approval.error, 'No connection.')
  assert.equal(run.working, false)
  assert.equal(ag.agentReduce(start(), { type: 'approvalPhase', phase: 'sending' }).approval, null)
})

test('saying no stops the run and nothing is sent', () => {
  const run = ag.agentReduce(approvalRun(), { type: 'denied' })
  assert.equal(run.status, 'stopped')
  assert.equal(run.approval, null)
  assert.match(run.message, /said no/)
  assert.equal(run.steps[0].result, 'You said no')
})

test('a request that ran out of time ends the run with the reason and no card', () => {
  const run = ag.agentReduce(approvalRun(), { type: 'gone', message: 'That request ran out of time. Ask again.' })
  assert.equal(run.status, 'failed')
  assert.equal(run.approval, null)
  assert.equal(run.message, 'That request ran out of time. Ask again.')
  assert.equal(run.steps[0].result, 'The request ran out of time')
})

test('an approved site opening is remembered for exactly the next step, then forgotten', () => {
  let run = approvalRun({ kind: 'open', url: 'https://new.example.com/' }, 'open_site')
  run = ag.agentReduce(run, { type: 'approvedOpen' })
  assert.equal(run.status, 'running')
  assert.equal(run.approval, null)
  assert.deepEqual(run.openApproval, { id: 'a1', url: 'https://shop.example.com/contact' })
  assert.equal(run.steps[0].result, 'Approved by you')
  assert.deepEqual(ag.agentBody(run).openApproval, { id: 'a1', url: 'https://shop.example.com/contact' })
  run = ag.agentReduce(run, { type: 'result', result: cont(2, { navigateTo: 'https://shop.example.com/contact' }) })
  assert.equal(run.openApproval, null)
  assert.equal('openApproval' in ag.agentBody(run), false)
  assert.equal(ag.agentReduce(start(), { type: 'approvedOpen' }).status, 'running')
})

test('an approved file that was saved goes back to work with a line saying so', () => {
  const run = ag.agentReduce(approvalRun({ kind: 'live', action: { kind: 'click', ref: ref(3) } }, 'download'), { type: 'saved', name: 'catalog.pdf' })
  assert.equal(run.status, 'running')
  assert.equal(run.approval, null)
  assert.equal(run.steps[0].result, 'Approved. Saved catalog.pdf to your device')
})

test('after an approved action, the run carries on from the new page, or stops again if it needs to', () => {
  const sent = ag.agentReduce(approvalRun(), { type: 'resumed', outcome: { status: 'ok', snapshot: snap({ url: 'https://shop.example.com/thanks', scrollY: 0, prepared: [] }), did: 'Approved: pressed "Send"' } })
  assert.equal(sent.status, 'running')
  assert.equal(sent.url, 'https://shop.example.com/thanks')
  assert.equal(sent.steps[0].result, 'Approved by you. Approved: pressed "Send"')
  assert.ok(ag.canAskNext(sent))

  const again = ag.agentReduce(approvalRun(), { type: 'resumed', outcome: { status: 'approval', snapshot: snap(), approval: details({ kind: 'terms' }), approvalId: 'a2', canonical: '' } })
  assert.equal(again.status, 'approval')
  assert.equal(again.approval.approvalId, 'a2')
  assert.equal(again.approval.phase, 'asking')

  const hand = ag.agentReduce(approvalRun(), { type: 'resumed', outcome: { status: 'handoff', snapshot: snap(), reason: 'sign_in', message: 'This form signs in.' } })
  assert.equal(hand.status, 'needs_you')
  assert.equal(hand.message, 'This form signs in.')

  const refused = ag.agentReduce(approvalRun(), { type: 'resumed', outcome: { status: 'refused', snapshot: snap(), message: 'The page changed.' } })
  assert.equal(refused.status, 'running')
  assert.equal(refused.steps[0].result, 'The page changed.')

  const failed = ag.agentReduce(approvalRun(), { type: 'resumed', outcome: { status: 'error', code: 'needs_update', message: 'Approvals need a database update.' } })
  assert.equal(failed.status, 'failed')
  assert.equal(failed.failure.setup, true)
})

/* ---------- what is sent ---------- */

test('each step sends the goal, the page, the entries, the scroll position and the short history, capped to what the server takes', () => {
  let run = start()
  const many = Array.from({ length: 45 }, (_, i) => step(i + 1, 'd'.repeat(300), 'r'.repeat(300)))
  run = { ...run, steps: many, prepared: Array.from({ length: 40 }, (_, i) => ({ kind: 'fill', ref: ref(i), value: String(i) })), scrollY: 120.7 }
  const body = ag.agentBody(run)
  assert.equal(body.goal, 'find the part number')
  assert.equal(body.url, 'https://shop.example.com/')
  assert.equal(body.viewport, 'phone')
  assert.equal(body.scrollY, 121)
  assert.equal(body.prepared.length, 30)
  assert.equal(body.prepared[0].value, '10')
  assert.equal(body.steps.length, 40)
  assert.equal(body.steps[0].n, 6)
  assert.equal(body.steps[0].did.length, 200)
  assert.equal(body.steps[0].result.length, 200)
})

/* ---------- where Alpha starts ---------- */

test('Alpha can start from the page you are on, a web search, or a quick site', () => {
  const list = ag.startChoices({ url: 'https://shop.example.com/parts', label: 'Parts' }, [
    { title: 'RockAuto', url: 'https://www.rockauto.com/' }, { title: 'Odd', url: 'javascript:alert(1)' }, { title: 'NAPA', url: 'https://www.napaonline.com/' },
  ])
  assert.deepEqual(list.map(c => c.key), ['here', 'web', 'quick-0', 'quick-2'])
  assert.equal(list[0].label, 'This page: Parts')
  assert.equal(ag.startUrlFor(list[0], 'x'), 'https://shop.example.com/parts')
  assert.equal(ag.startUrlFor(list[2], 'x'), 'https://www.rockauto.com/')
  assert.deepEqual(ag.startChoices(null, []).map(c => c.key), ['web'])
  assert.deepEqual(ag.startChoices({ url: 'about:blank', label: 'x' }, []).map(c => c.key), ['web'])
  assert.equal(ag.startChoices(null, Array.from({ length: 30 }, (_, i) => ({ title: `S${i}`, url: `https://s${i}.example.com/` }))).length, 13)
})

test('a web search starts at the search page for the words asked', () => {
  const web = ag.startChoices(null, [])[0]
  assert.equal(ag.startUrlFor(web, '  brake pads   civic & rotors '), 'https://html.duckduckgo.com/html/?q=brake%20pads%20civic%20%26%20rotors')
})

test('the sources are the pages Alpha looked at, each once, in order', () => {
  const run = { ...start(), visited: ['https://a.example.com/', 'https://b.example.com/', 'https://a.example.com/', '', 'https://b.example.com/'] }
  assert.deepEqual(ag.sourceList(run), ['https://a.example.com/', 'https://b.example.com/'])
  let tracked = start()
  for (let i = 0; i < 25; i++) {
    tracked = ag.agentReduce({ ...tracked, steps: [] }, { type: 'result', result: cont(1, { snapshot: snap({ url: `https://s.example.com/${i}` }) }) })
  }
  assert.equal(tracked.visited.length, 20)
  assert.equal(tracked.visited[19], 'https://s.example.com/24')
})
