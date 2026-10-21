import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')

test('B6: the repair-order number column has a migration, additive only', () => {
  const sql = read('../../supabase/migrations/064_jobs_ro_number.sql')
  assert.match(sql, /add column if not exists ro_number text/)
  assert.match(sql, /create unique index if not exists jobs_shop_ro_number_key/)
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ''), /\b(drop|delete|update|truncate)\b/i)
})

test('B9: the timezone grant is one column, never a secret column', () => {
  const sql = read('../../supabase/migrations/065_settings_timezone_browser_read.sql').replace(/^--.*$/gm, '')
  assert.match(sql, /grant select \(timezone\) on public\.settings to authenticated/)
  assert.doesNotMatch(sql, /api_key|token|secret/i)
})

test('B15: syncing calls never runs on a GET, and the Growth screen asks with POST', () => {
  const route = read('../src/app/api/telnyx/sync-calls/route.ts')
  assert.doesNotMatch(route, /export async function GET\(req: NextRequest\) \{ return POST\(req\) \}/)
  assert.match(route, /status: 405/)
  assert.match(read('../src/app/(app)/growth/page.tsx'), /sync-calls\?action=sync', \{ method: 'POST'/)
})
