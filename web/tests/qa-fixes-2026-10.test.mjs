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

test('B14: a model typed in lowercase is shown capitalised; CR-V and F-150 stay as they are', async () => {
  const { displayModel, vehicleLabel } = await import('../src/lib/repair/sources.ts')
  assert.equal(displayModel('civic'), 'Civic')
  assert.equal(displayModel('grand cherokee'), 'Grand Cherokee')
  assert.equal(displayModel('CR-V'), 'CR-V')
  assert.equal(displayModel('iA'), 'iA')
  assert.equal(vehicleLabel({ year: '2004', make: 'honda', model: 'civic' }), '2004 Honda Civic')
})

test('B14: the Repair info screen label capitalises a lowercase model too', async () => {
  const { vehicleLabel } = await import('../src/lib/repair-ui.ts')
  assert.equal(vehicleLabel({ year: '2004', make: 'Honda', model: 'civic' }), '2004 Honda Civic')
  assert.equal(vehicleLabel({ year: '2019', make: 'Honda', model: 'CR-V' }), '2019 Honda CR-V')
})
