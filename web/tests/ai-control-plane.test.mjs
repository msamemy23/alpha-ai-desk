import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const capabilities = readFileSync(new URL('../src/lib/ai/capabilities.ts', import.meta.url), 'utf8')
const router = readFileSync(new URL('../src/lib/ai/router.ts', import.meta.url), 'utf8')
const aiPage = readFileSync(new URL('../src/app/(app)/ai/page.tsx', import.meta.url), 'utf8')
const toolsPage = readFileSync(new URL('../src/app/(app)/tools/page.tsx', import.meta.url), 'utf8')

test('registers the required specialist agents and reusable skills', () => {
  for (const id of ['shop_ops', 'parts', 'desktop', 'browser', 'communications', 'reports', 'safety']) {
    assert.match(capabilities, new RegExp(`id: '${id}'`))
  }

  for (const skill of [
    'verified_parts_search',
    'build_estimate_from_verified_parts',
    'browser_tab_inspection_kapture',
    'desktop_file_workflow',
    'invoice_estimate_send',
  ]) {
    assert.match(capabilities, new RegExp(`id: '${skill}'`))
  }
})

test('router classifies parts, desktop, Kapture, and communications requests before model fallback', () => {
  assert.match(router, /parts_lookup/)
  assert.match(router, /browser_kapture/)
  assert.match(router, /desktop_browser/)
  assert.match(router, /communications/)
  assert.match(aiPage, /classifyRequest\(text\)/)
  assert.match(aiPage, /agentRouter/)
})

test('Kapture no-tab state is handled honestly in chat and status UI', () => {
  assert.match(aiPage, /No connected Kapture tab|no Chrome tab is connected/i)
  assert.match(aiPage, /kapture\.list_tabs/)
  assert.match(toolsPage, /Chrome tabs Alpha can use/)
  assert.match(toolsPage, /connectedTabs/)
})

test('send, call, delete, and MCP action paths require confirmation gates', () => {
  assert.match(aiPage, /confirmationActions/)
  // Calls are no longer refused outright: every call, typed or proposed by the assistant, waits on an approval card.
  assert.doesNotMatch(aiPage, /Blocked until call confirmation/)
  assert.match(aiPage, /requestCall\(\{ kind: 'assistant'/)
  assert.match(aiPage, /Nothing is dialled until you approve it/)
  assert.match(aiPage, /testId="call-review"/)
  // The only way the chat starts a call is the approval handler, through the server route that re-checks the rules.
  assert.match(aiPage, /fetch\('\/api\/ai-call\/start'[\s\S]{0,260}confirm: true/)
  assert.doesNotMatch(aiPage, /fetch\('\/api\/(?:make-call|ai-voice-call)'/)
  assert.match(capabilities, /requiresConfirmation: true/)
})
