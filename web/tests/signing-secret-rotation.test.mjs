import assert from 'node:assert/strict'
import { test } from 'node:test'

const fresh = async (file) => import(`${new URL(file, import.meta.url).href}?v=${Math.random()}`)

test('an unsubscribe link signed before CRON_SECRET existed still works after it is set', async () => {
  const saved = { ...process.env }
  try {
    delete process.env.UNSUBSCRIBE_SECRET; delete process.env.INTERNAL_API_SECRET; delete process.env.CRON_SECRET
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-test'
    const mod = await fresh('../src/lib/unsubscribe-token.ts')
    const oldLink = mod.createUnsubscribeToken('shop-a', 'Pat@Example.com')
    process.env.CRON_SECRET = 'new-cron-secret-test'
    assert.deepEqual(mod.verifyUnsubscribeToken(oldLink), { shopId: 'shop-a', email: 'pat@example.com' })
    const newLink = mod.createUnsubscribeToken('shop-a', 'pat@example.com')
    assert.notEqual(newLink, oldLink)
    assert.ok(mod.verifyUnsubscribeToken(newLink))
    const [payload] = oldLink.split('.')
    assert.equal(mod.verifyUnsubscribeToken(`${payload}.forged`), null)
    const tampered = Buffer.from(JSON.stringify({ s: 'shop-a', e: 'other@example.com' })).toString('base64url')
    assert.equal(mod.verifyUnsubscribeToken(`${tampered}.${oldLink.split('.')[1]}`), null)
  } finally { process.env = saved }
})

test('a voice call state signed with the old secret still verifies after a new one is set', async () => {
  const saved = { ...process.env }
  try {
    delete process.env.VOICE_STATE_SECRET; delete process.env.INTERNAL_API_SECRET; delete process.env.CRON_SECRET
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-test'
    const mod = await fresh('../src/lib/voice-state.ts')
    const state = mod.createVoiceClientState({ shopId: 'shop-a' })
    process.env.CRON_SECRET = 'new-cron-secret-test'
    assert.equal(mod.verifyVoiceClientState(state)?.shopId, 'shop-a')
    assert.equal(mod.verifyVoiceClientState(state.replace(/.$/, c => (c === 'A' ? 'B' : 'A'))), null)
  } finally { process.env = saved }
})
