import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeStop } from '../src/lib/ai/stop-summary.ts'

test('stop summary: stopping before anything ran says so', () => {
  const summary = summarizeStop([{ tool: 'agentRouter', status: 'ok', detail: 'chat' }])
  assert.equal(summary.text, 'Stopped by you. Nothing was sent or changed. Nothing had been started yet.')
  assert.equal(summary.changedSomething, false)
})

test('stop summary: finished look-ups are listed and the rest is marked not done', () => {
  const summary = summarizeStop([
    { tool: 'agentRouter', status: 'ok' },
    { tool: 'searchCustomers', status: 'running' },
    { tool: 'searchCustomers', status: 'ok' },
    { tool: 'webSearch', status: 'running' },
  ])
  assert.match(summary.text, /^Stopped by you\. Nothing was sent or changed\./)
  assert.match(summary.text, /Already looked up: Searched customers\./)
  assert.match(summary.text, /Cut off before it finished: Search the web\./)
  assert.match(summary.text, /Not done: the rest of your request\.$/)
  assert.deepEqual(summary.looked, ['Searched customers'])
  assert.equal(summary.changedSomething, false)
})

test('stop summary: a change that already finished is never hidden behind "nothing changed"', () => {
  const summary = summarizeStop([
    { tool: 'action.createCustomer', status: 'ok' },
    { tool: 'connector.facebook.post', status: 'running' },
  ])
  assert.equal(summary.changedSomething, true)
  assert.doesNotMatch(summary.text, /Nothing was sent or changed/)
  assert.match(summary.text, /Part of it had already been done and was not undone/)
  assert.match(summary.text, /Already done: Added a customer\. Find it in Activity to undo it\./)
  assert.match(summary.text, /Cut off before it finished: /)
})

test('stop summary: the saved text still reads as a stopped request', () => {
  const summary = summarizeStop([{ tool: 'lookupParts', status: 'ok' }])
  assert.match(summary.text, /^Stopped by you\.\s/)
})

test('stop summary: failed steps are neither done nor cut off', () => {
  const summary = summarizeStop([{ tool: 'getInventory', status: 'error', detail: 'down' }])
  assert.deepEqual([summary.done, summary.looked, summary.cutOff], [[], [], []])
  assert.match(summary.text, /Nothing had been started yet/)
})
