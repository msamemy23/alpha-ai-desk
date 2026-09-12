import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const aiAction = read('../src/app/api/ai-action/route.ts')
const automations = read('../src/app/api/automations/route.ts')
const systemAutomations = read('../src/app/api/system-automations/route.ts')
const documents = read('../src/components/DocumentsPage.tsx')
const oauthServer = read('../src/lib/openai-oauth-server.ts')
const socialOperation = read('../src/lib/social-operation.ts')
const facebook = read('../src/app/api/connectors/facebook/route.ts')
const instagram = read('../src/app/api/connectors/instagram/route.ts')
const aiPage = read('../src/app/(app)/ai/page.tsx')
const paymentMigration = read('../supabase/migrations/039_payment_idempotency_required.sql')
const automationMigration = read('../supabase/migrations/040_durable_automation_leases.sql')
const serviceOnlyMigration = read('../supabase/migrations/041_service_only_rls_policies.sql')
const socialMigration = read('../supabase/migrations/049_durable_social_publishing.sql')
const triggerPrivilegeMigration = read('../supabase/migrations/050_restrict_membership_trigger.sql')

test('AI mutations claim durable operations and do not use a process-local idempotency map', () => {
  assert.match(aiAction, /claim_ai_action_operation/)
  assert.match(aiAction, /payload_hash/)
  assert.match(aiAction, /operationFinalized/)
  assert.doesNotMatch(aiAction, /new Map\(/)
})

test('automation execution uses leased fenced claims and records missing configuration as failure', () => {
  assert.doesNotMatch(automations, /claim_automation_run'/)
  assert.match(automations, /claim_automation_run_v2/)
  assert.match(automations, /fencing_token/)
  assert.match(automations, /throw new Error\('No AI API key configured'\)/)
  assert.doesNotMatch(systemAutomations, /claim_automation_run'/)
  assert.match(systemAutomations, /claim_automation_run_v2/)
  assert.match(systemAutomations, /fencing_token/)
})

test('payment writes require durable idempotency keys in the UI and database', () => {
  assert.match(documents, /Payment idempotency key is required/)
  assert.match(documents, /p_idempotency_key: idempotencyKey\.trim\(\)/)
  assert.match(paymentMigration, /payments_idempotency_key_required/)
  assert.match(paymentMigration, /idempotency_key IS NOT NULL/)
})

test('ChatGPT OAuth stays request-bound and never replaces Alpha tenant auth', () => {
  assert.match(oauthServer, /x-openai-oauth-authorization/)
  assert.match(oauthServer, /x-openai-oauth-account-id/)
  assert.match(oauthServer, /createOpenAIOAuthTransport/)
  assert.match(oauthServer, /\/responses/)
  assert.match(oauthServer, /responsesToChatCompletion/)
  assert.match(oauthServer, /return null/)
})

test('operational tables retain explicit service-role-only RLS policies', () => {
  for (const table of ['ai_action_operations', 'automation_runs', 'message_send_operations', 'sms_consents']) {
    assert.match(serviceOnlyMigration, new RegExp(`'${table}'`))
  }
  assert.match(serviceOnlyMigration, /TO service_role USING \(true\) WITH CHECK \(true\)/)
  assert.match(automationMigration, /lease_expires_at/)
  assert.match(automationMigration, /fencing_token bigint NOT NULL/)
})

test('social publishing is durable, idempotent, and never reports provider errors as success', () => {
  assert.match(socialOperation, /startSocialPublishingOperation/)
  assert.match(socialOperation, /outcome is uncertain/)
  assert.match(facebook, /finishSocialPublishingOperation/)
  assert.match(facebook, /result\.ok === true/)
  assert.match(instagram, /finishSocialPublishingOperation/)
  assert.match(instagram, /publishData\?\.id/)
  assert.match(aiPage, /idempotency_key: crypto\.randomUUID\(\)/)
  assert.match(socialMigration, /social_publishing_operations/)
  assert.match(socialMigration, /TO service_role[\s\S]*USING \(true\)[\s\S]*WITH CHECK \(true\)/)
})

test('signup membership trigger is not exposed as a public RPC', () => {
  assert.match(triggerPrivilegeMigration, /REVOKE ALL ON FUNCTION public\.bootstrap_shop_membership\(\) FROM anon/)
  assert.match(triggerPrivilegeMigration, /REVOKE ALL ON FUNCTION public\.bootstrap_shop_membership\(\) FROM authenticated/)
})

test('AI instructions expose inventory lookup and disclose result limits', () => {
  assert.match(aiPage, /"tool":"action","action":"getInventory","payload":\{\}/)
  assert.match(aiAction, /case 'getInventory'/)
  assert.match(aiPage, /returns at most 50 matching items/)
  assert.match(aiPage, /List active staff \(inactive records are excluded\)/)
})

test('AI instructions route payments to the ledger form, never a status-only update', () => {
  assert.doesNotMatch(aiPage, /"action":"updateDocument","payload":\{[^}]*"status":"Paid"/)
  assert.match(aiPage, /payment recording is still pending until the payment form confirms it/)
})
