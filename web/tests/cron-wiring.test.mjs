import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8')
const cron = read('../src/app/api/cron/route.ts')
const vercel = JSON.parse(read('../vercel.json'))

test('the daily job runs the owner\'s scheduled report emails once for every shop', () => {
  assert.match(cron, /results\.scheduled_reports = await callForEachShop\('\/api\/reports\/scheduled'\)/)
  const route = read('../src/app/api/reports/scheduled/route.ts')
  // only the server's own job may call it, and it claims each report and period once before sending
  assert.match(route, /if \(!hasInternalApiSecret\(req\)\) return unauthorized\(\)/)
})

test('the daily job is on the schedule and is closed to everyone without the secret', () => {
  assert.ok(vercel.crons.some(c => c.path === '/api/cron'))
  assert.match(cron, /req\.headers\.get\('authorization'\) !== `Bearer \$\{cronSecret\}`/)
})

test('the every-few-minutes scheduler is not switched on by the daily job, so no automation starts sending without the owner', () => {
  assert.doesNotMatch(cron, /\/api\/cron\/tick/)
})
