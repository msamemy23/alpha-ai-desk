import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createDb } from './helpers/reports-fake-db.mjs'
import * as health from '../src/lib/health.ts'
import * as csp from '../src/lib/csp.ts'
import * as problems from '../src/lib/problems.ts'
import { dayKey, listProblems, problemsLastDay, recordProblem } from '../src/lib/problems-store.ts'

const read = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')

/* ---------- uptime check ---------- */

test('health: a commit is shown short or not at all, and the answer says up or down and nothing else', () => {
  assert.equal(health.shortVersion('91b4a02f3c8d9e0a1b2c3d4e5f60718293a4b5c6'), '91b4a02')
  assert.equal(health.shortVersion('ABCDEF1234'), 'abcdef1')
  assert.equal(health.shortVersion('main'), '')
  assert.equal(health.shortVersion(undefined), '')
  assert.equal(health.shortVersion('abc'), '')
  const up = health.healthBody(true, new Date('2026-10-16T18:00:00Z'), '91b4a02f')
  assert.deepEqual({ ...up }, { ok: true, database: 'up', checked_at: '2026-10-16T18:00:00.000Z', version: '91b4a02' })
  const down = health.healthBody(false, new Date('2026-10-16T18:00:00Z'), undefined)
  assert.equal(down.ok, false)
  assert.equal(down.database, 'down')
  assert.deepEqual(Object.keys(down).sort(), ['checked_at', 'database', 'ok', 'version'])
  assert.equal(health.healthBody(true, new Date('nope'), '').checked_at, '')
})

test('health: a database that is down answers 503 so a monitor sees an outage', () => {
  assert.equal(health.healthStatus({ ok: true }), 200)
  assert.equal(health.healthStatus({ ok: false }), 503)
})

test('health: waiting gives up after the limit and leaves no timer running', async () => {
  const fast = await health.withTimeout(Promise.resolve(7), 1000)
  assert.deepEqual({ ...fast }, { timedOut: false, value: 7 })
  const slow = await health.withTimeout(new Promise(r => setTimeout(() => r('late'), 200)), 20)
  assert.equal(slow.timedOut, true)
  await assert.rejects(health.withTimeout(Promise.reject(new Error('boom')), 1000), /boom/)
})

test('health route: open, limited, never cached, GET and HEAD, and the reason for a failure stays in the log', () => {
  assert.match(read('middleware.ts'), /'\/api\/health'/)
  const r = read('app/api/health/route.ts')
  assert.match(r, /checkRateLimit\(`health:\$\{ip\}`, 60, 60_000\)/)
  assert.match(r, /checkRateLimit\('health:all', 600, 60_000\)/)
  assert.match(r, /status: 429/)
  assert.match(r, /no-store/)
  assert.match(r, /export async function GET/)
  assert.match(r, /export async function HEAD/)
  assert.match(r, /withTimeout\(db\.from\('shop_profiles'\)\.select\('id'\)\.limit\(1\), DB_TIMEOUT_MS\)/)
  assert.match(r, /console\.error\(JSON\.stringify\(\{ event: 'health_check_failed', reason \}\)\)/)
  // The body is built only by healthBody: no error text, table name or setting is added.
  assert.match(r, /healthBody\(up, new Date\(\), process\.env\.VERCEL_GIT_COMMIT_SHA\)/)
  const body = r.slice(r.indexOf('const body = healthBody'))
  assert.ok(!/reason|error\.message/.test(body.replace(/\/\*[\s\S]*?\*\//g, '')))
})

/* ---------- report-only security policy ---------- */

test('csp: every directive is there, nothing is allowed that a page does not need, and the browser reports instead of blocking', () => {
  const p = csp.buildCsp({ databaseUrl: 'https://abcd1234.supabase.co' })
  for (const d of ["default-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'", "manifest-src 'self'", 'report-uri /api/csp-report']) assert.ok(p.includes(d), d)
  assert.match(p, /connect-src 'self' https:\/\/abcd1234\.supabase\.co wss:\/\/abcd1234\.supabase\.co https:\/\/\*\.telnyx\.com wss:\/\/\*\.telnyx\.com/)
  assert.match(p, /script-src 'self' 'unsafe-inline'(;|$)/)
  assert.ok(!/unsafe-eval/.test(p), 'eval is only allowed while developing')
  assert.match(csp.buildCsp({ development: true }), /script-src 'self' 'unsafe-inline' 'unsafe-eval'/)
  assert.ok(!/\*(;| )/.test(p.replace(/\*\.telnyx\.com/g, '')), 'no wildcard host beyond the phone service')
  assert.equal(csp.CSP_HEADER, 'Content-Security-Policy-Report-Only')
})

test('csp: a missing or odd database address leaves it out instead of breaking the policy', () => {
  assert.equal(csp.databaseOrigins(''), null)
  assert.equal(csp.databaseOrigins('not a url'), null)
  assert.equal(csp.databaseOrigins('ftp://x.test'), null)
  assert.deepEqual({ ...csp.databaseOrigins('http://localhost:54321') }, { http: 'http://localhost:54321', socket: 'ws://localhost:54321' })
  assert.ok(!/undefined|null|\[object/.test(csp.buildCsp({ databaseUrl: undefined })))
})

test('csp: a violation note is cut down to a rule, a site name and a page name with no ids', () => {
  const r = csp.cleanCspReport({
    'csp-report': {
      'document-uri': 'https://alpha-ai-desk.vercel.app/sign/9f2c1a7b8d3e4f5a6b7c8d9e0f1a2b3c?token=SECRET#frag',
      'effective-directive': 'script-src-elem', 'violated-directive': 'script-src-elem',
      'blocked-uri': 'https://cdn.evil.test/steal.js?x=customer@example.com', 'source-file': 'https://cdn.evil.test/a.js', 'line-number': 42, disposition: 'report',
    },
  })
  assert.deepEqual({ ...r }, { directive: 'script-src-elem', blocked: 'cdn.evil.test', page: '/sign/:id', source: 'cdn.evil.test', line: 42, disposition: 'report' })
  assert.ok(!JSON.stringify(r).match(/SECRET|customer|steal|9f2c/))
})

test('csp: the plain words, the newer report shape, and rejected input', () => {
  assert.equal(csp.cleanCspReport({ 'csp-report': { 'effective-directive': 'script-src', 'blocked-uri': 'inline', 'document-uri': 'https://x.test/jobs' } }).blocked, 'inline')
  assert.equal(csp.cleanCspReport({ 'csp-report': { 'violated-directive': "img-src 'self' data:", 'blocked-uri': 'data:image/png;base64,AAAA' } }).blocked, 'data')
  assert.equal(csp.cleanCspReport({ 'csp-report': { 'violated-directive': "img-src 'self' data:", 'blocked-uri': 'data:image/png;base64,AAAA' } }).directive, 'img-src')
  const newer = csp.cleanCspReport([{ type: 'csp-violation', body: { effectiveDirective: 'connect-src', blockedURL: 'https://api.other.test/v1', documentURL: 'https://x.test/inventory?x=1', lineNumber: 3, disposition: 'enforce' } }])
  assert.deepEqual({ ...newer }, { directive: 'connect-src', blocked: 'api.other.test', page: '/inventory', source: '', line: 3, disposition: 'enforce' })
  // Browser add-ons trigger notes on every page; they are dropped.
  assert.equal(csp.cleanCspReport({ 'csp-report': { 'effective-directive': 'script-src', 'blocked-uri': 'chrome-extension://abcdef/x.js' } }), null)
  assert.equal(csp.cleanCspReport({ 'csp-report': { 'effective-directive': 'script-src', 'source-file': 'moz-extension://abc/x.js' } }), null)
  for (const bad of [null, undefined, 'x', 5, [], {}, { 'csp-report': 'x' }, { 'csp-report': {} }, { 'csp-report': { 'effective-directive': '<script>' } }, [{ type: 'other' }]]) assert.equal(csp.cleanCspReport(bad), null)
  // A silly line number or a missing page does not make a bad note.
  const odd = csp.cleanCspReport({ 'csp-report': { 'effective-directive': 'img-src', 'line-number': -5, 'document-uri': 'garbage' } })
  assert.equal(odd.line, 0)
  assert.equal(odd.page, '')
})

test('csp: the policy is on pages but not on data answers, and the report route is public, small, limited and silent', () => {
  const m = read('middleware.ts')
  assert.match(m, /import \{ buildCsp, CSP_HEADER \} from '@\/lib\/csp'/)
  assert.match(m, /if \(page\) res\.headers\.set\(CSP_HEADER, REPORT_ONLY_POLICY\)/)
  assert.match(m, /withSecurityHeaders\(res, !pathname\.startsWith\('\/api\/'\)\)/)
  assert.match(m, /'\/api\/csp-report'/)
  // Report-only: the enforcing header is never set.
  assert.ok(!/['"]Content-Security-Policy['"]/.test(m))
  const r = read('app/api/csp-report/route.ts')
  assert.match(r, /CSP_MAX_BODY_BYTES/)
  assert.match(r, /checkRateLimit\(`csp-report:\$\{ip\}`, 20, 60_000\)/)
  assert.match(r, /checkRateLimit\('csp-report:all', 300, 60_000\)/)
  assert.match(r, /cleanCspReport\(/)
  assert.match(r, /console\.warn\(JSON\.stringify\(\{ event: 'csp_violation', \.\.\.report \}\)\)/)
  assert.ok(!/status: (4|5)\d\d/.test(r))
  assert.ok(!/supabase|getServiceClient|fetch\(|resend|telnyx/i.test(r.replace(/\/\*[\s\S]*?\*\//g, '')))
})

/* ---------- problems reported ---------- */

const row = (o = {}) => ({ day: '2026-10-16', kind: 'screen', path: '/inventory', reference: 'abc123', message: 'Cannot read properties of undefined', count: 1, first_seen: '2026-10-16T10:00:00Z', last_seen: '2026-10-16T10:00:00Z', ...o })

test('problems: the same problem on different days is one line with the counts added, newest first', () => {
  const list = problems.groupProblems([
    row({ day: '2026-10-15', count: 2, first_seen: '2026-10-15T09:00:00Z', last_seen: '2026-10-15T17:00:00Z' }),
    row({ day: '2026-10-16', count: 3, first_seen: '2026-10-16T08:00:00Z', last_seen: '2026-10-16T12:00:00Z' }),
    row({ path: '/jobs', message: 'Other', count: 1, last_seen: '2026-10-16T15:00:00Z', first_seen: '2026-10-16T15:00:00Z' }),
  ])
  assert.equal(list.length, 2)
  assert.equal(list[0].path, '/jobs')
  assert.equal(list[1].count, 5)
  assert.equal(list[1].first_seen, '2026-10-15T09:00:00Z')
  assert.equal(list[1].last_seen, '2026-10-16T12:00:00Z')
  assert.equal(problems.totalCount(list), 6)
  assert.deepEqual(problems.groupProblems([]), [])
  // A broken count never makes a negative or missing total.
  assert.equal(problems.groupProblems([row({ count: 'x' }), row({ count: -4 })])[0].count, 2)
})

test('problems: the words are plain and the screen is named for a person', () => {
  assert.equal(problems.screenName('/inventory'), 'Inventory')
  assert.equal(problems.screenName('/jobs/:id'), 'Jobs')
  assert.equal(problems.screenName('/purchase-orders'), 'Purchase orders')
  assert.equal(problems.screenName('/'), 'Today')
  assert.equal(problems.screenName(''), 'An unknown screen')
  assert.equal(problems.kindWords('screen'), 'A screen stopped working')
  assert.equal(problems.kindWords('promise'), 'Something failed in the background')
  assert.equal(problems.kindWords('weird'), 'Something went wrong')
  assert.equal(problems.timesWords(1), 'Happened once')
  assert.equal(problems.timesWords(4), 'Happened 4 times')
  assert.equal(problems.summaryWords([]), 'No problems reported in the last 7 days.')
  assert.equal(problems.summaryWords([{ count: 1 }]), '1 problem, 1 time in the last 7 days.')
  assert.equal(problems.summaryWords([{ count: 3 }, { count: 14 }]), '2 problems, 17 times in the last 7 days.')
  assert.equal(problems.headsUp(1).title, '1 screen problem was reported in the last day')
  assert.equal(problems.headsUp(5).title, '5 screen problems were reported in the last day')
})

test('problems: only the owner and admins may see them', () => {
  for (const r of ['owner', 'admin']) assert.equal(problems.mayViewProblems(r), true)
  for (const r of ['manager', 'member', 'viewer', 'service', '', undefined, null]) assert.equal(problems.mayViewProblems(r), false)
})

const SHOP = 'shop-a'
const OTHER = 'shop-b'
const NOW = new Date('2026-10-16T18:00:00Z')

/** What migration 062's function does, in the same order, so the store is tested against its rules. */
const recordRpc = (a, db) => {
  const rows = (db.tables.client_error_counts ||= [])
  const same = r => r.shop_id === a.p_shop && r.day === a.p_day && r.kind === a.p_kind && r.path === a.p_path && r.reference === a.p_reference && r.message === a.p_message
  const hit = rows.find(same)
  if (hit) { hit.count += 1; hit.last_seen = NOW.toISOString(); return 'counted' }
  if (rows.filter(r => r.shop_id === a.p_shop && r.day === a.p_day).length >= a.p_max_rows) return 'capped'
  rows.push({ shop_id: a.p_shop, day: a.p_day, kind: a.p_kind, path: a.p_path, reference: a.p_reference, message: a.p_message, count: 1, first_seen: NOW.toISOString(), last_seen: NOW.toISOString() })
  return 'recorded'
}
const makeDb = (options = {}) => createDb({ client_error_counts: [] }, { rpc: { record_client_error: recordRpc }, ...options })
const report = (o = {}) => ({ kind: 'screen', message: 'Cannot read properties of undefined', stack: '', path: '/inventory', digest: '1234567890abcdef', ...o })

test('problems store: the first report makes a row, the same one again adds to it, and one shop never sees another\'s', async () => {
  const db = makeDb()
  assert.equal(await recordProblem(db, SHOP, report(), NOW), 'recorded')
  assert.equal(await recordProblem(db, SHOP, report(), NOW), 'counted')
  assert.equal(await recordProblem(db, OTHER, report(), NOW), 'recorded')
  assert.equal(db.tables.client_error_counts.length, 2)
  assert.equal(db.tables.client_error_counts.find(r => r.shop_id === SHOP).count, 2)
  const call = db.log.find(l => l.op === 'rpc').values
  assert.equal(call.p_day, '2026-10-16')
  assert.equal(call.p_reference, '1234567890abcdef')
  assert.equal(call.p_max_rows, 200)
  assert.equal(call.p_keep_days, 30)
  const mine = await listProblems(db, SHOP, NOW)
  assert.equal(mine.state, 'ok')
  assert.equal(mine.problems.length, 1)
  assert.equal(mine.problems[0].count, 2)
})

test('problems store: a loop of different errors stops at the daily limit, and the answer says so', async () => {
  const db = makeDb()
  for (let i = 0; i < 200; i++) assert.equal(await recordProblem(db, SHOP, report({ message: `Error number ${i}` }), NOW), 'recorded')
  assert.equal(await recordProblem(db, SHOP, report({ message: 'One more' }), NOW), 'capped')
  // One that already has a row still counts.
  assert.equal(await recordProblem(db, SHOP, report({ message: 'Error number 3' }), NOW), 'counted')
})

test('problems store: before the database update, or when it fails, nothing throws and nothing is counted', async () => {
  assert.equal(await recordProblem(makeDb({ missingFunctions: ['record_client_error'] }), SHOP, report(), NOW), 'skipped')
  assert.equal(await recordProblem(createDb({}, {}), SHOP, report(), NOW), 'skipped')
  assert.equal(await recordProblem(makeDb({ failures: { 'rpc:record_client_error': { code: '57014', message: 'timeout' } } }), SHOP, report(), NOW), 'skipped')
  const broken = { rpc: () => { throw new Error('socket closed') }, from: () => { throw new Error('socket closed') } }
  assert.equal(await recordProblem(broken, SHOP, report(), NOW), 'skipped')
  assert.deepEqual({ ...(await listProblems(broken, SHOP, NOW)) }, { state: 'failed', problems: [] })
  assert.equal(await problemsLastDay(broken, SHOP, NOW), 0)
})

test('problems store: the list says "needs an update" before the table exists, and reads only the last 7 days of this shop', async () => {
  const none = await listProblems(createDb({}, { missingTables: ['client_error_counts'] }), SHOP, NOW)
  assert.deepEqual({ ...none }, { state: 'needs-update', problems: [] })
  const db = makeDb()
  db.tables.client_error_counts.push(
    { shop_id: SHOP, ...row({ message: 'Old', day: '2026-10-01', last_seen: '2026-10-01T10:00:00Z', first_seen: '2026-10-01T10:00:00Z' }) },
    { shop_id: SHOP, ...row({ message: 'Recent', day: '2026-10-14', last_seen: '2026-10-14T10:00:00Z', first_seen: '2026-10-14T10:00:00Z', count: 4 }) },
    { shop_id: SHOP, ...row({ message: 'Today', last_seen: '2026-10-16T17:00:00Z', first_seen: '2026-10-16T17:00:00Z', count: 2 }) },
    { shop_id: OTHER, ...row({ message: 'Theirs', last_seen: '2026-10-16T17:00:00Z' }) },
  )
  const list = await listProblems(db, SHOP, NOW)
  assert.deepEqual(list.problems.map(p => p.message), ['Today', 'Recent'])
  assert.equal(await problemsLastDay(db, SHOP, NOW), 2)
  assert.equal(await problemsLastDay(db, 'nobody', NOW), 0)
  assert.equal(dayKey(new Date('2026-10-16T23:59:59Z')), '2026-10-16')
})

test('problems routes: counted only for signed-in staff, read only by the owner and admins, and the heads-up goes to the same people', () => {
  const c = read('app/api/client-errors/route.ts')
  assert.match(c, /const auth = await getAuthedShop\(\)\s*if \(auth\) await recordProblem\(/)
  assert.ok(c.indexOf("console.error(JSON.stringify({ event: 'client_error'") < c.indexOf('await getAuthedShop()'), 'the log line comes first')
  assert.match(c, /catch \{[^}]*\}\s*return NO_CONTENT\(\)/)
  const p = read('app/api/problems/route.ts')
  assert.match(p, /if \(!auth\) return unauthorized\(\)\s*if \(!mayViewProblems\(auth\.role\)\) return forbidden\(\)/)
  assert.match(p, /listProblems\(getServiceClient\(\) as unknown as Db, auth\.shopId\)/)
  assert.ok(!/\.insert\(|\.update\(|\.delete\(|\.rpc\(/.test(p))
  const n = read('app/api/notifications/route.ts')
  assert.match(n, /mayViewProblems\(auth\.role\) \? await problemsLastDay\(db as unknown as Db, auth\.shopId\) : 0/)
  assert.match(read('lib/today.ts'), /href: '\/settings#problems'/)
  assert.match(read('app/(app)/dashboard/page.tsx'), /setProblems\(Math\.floor\(d\.problems\)\)/)
})

test('problems screen: every state has words, it is read only, and it is in the Settings list', () => {
  const s = read('components/settings/ProblemsSection.tsx')
  for (const w of ['RowsSkeleton', 'ErrorCard', 'EmptyBlock', 'Only the owner and admins can see this list', 'needs a one-time update', 'No problems reported in the last 7 days']) assert.ok(s.includes(w), w)
  assert.ok(!/method:\s*'(POST|PUT|PATCH|DELETE)'/.test(s))
  assert.ok(!/<form/.test(s))
  assert.ok(!/\p{Extended_Pictographic}/u.test(s))
  const page = read('app/(app)/settings/page.tsx')
  assert.match(page, /id: 'problems', label: 'Problems reported'/)
  assert.match(page, /\{s\.id === 'problems' && <ProblemsSection \/>\}/)
})

test('migration 062: server only, nothing existing touched, and safe to run twice', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/062_client_error_counts.sql', import.meta.url), 'utf8')
  assert.match(sql, /create table if not exists public\.client_error_counts/)
  assert.match(sql, /alter table public\.client_error_counts enable row level security/)
  assert.match(sql, /revoke all on table public\.client_error_counts from public, anon, authenticated/)
  assert.match(sql, /grant execute on function public\.record_client_error\([^)]*\) to service_role/)
  assert.match(sql, /revoke all on function public\.record_client_error\([^)]*\) from public, anon, authenticated/)
  assert.match(sql, /create or replace function public\.record_client_error/)
  assert.ok(!/create policy/i.test(sql))
  // The only statements that change existing rows are on its own table.
  const writes = sql.replace(/--.*$/gm, '').match(/(?<!do )\b(update|delete from|insert into|alter table|drop)\s+(\w+\.)?\w+/gi) || []
  for (const w of writes) assert.match(w, /client_error_counts/i, w)
})

/* ---------- the uptime check that runs on GitHub ---------- */

test('uptime workflow: every 5 minutes, no secrets, only issue permission, and one official action', () => {
  const root = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
  const w = root('.github/workflows/uptime.yml')
  assert.match(w, /cron: '\*\/5 \* \* \* \*'/)
  assert.match(w, /workflow_dispatch:/)
  assert.match(w, /permissions:\s+contents: read\s+issues: write/)
  assert.ok(!/secrets\./.test(w), 'no secret is needed or used')
  assert.match(w, /HEALTH_URL: https:\/\/alpha-ai-desk\.vercel\.app\/api\/health/)
  const uses = [...w.matchAll(/uses:\s*(\S+)/g)].map(m => m[1])
  assert.deepEqual(uses, ['actions/checkout@v4'])
  assert.match(w, /cancel-in-progress: false/)
})

test('uptime scripts: three tries before an alarm, one issue at a time, closed when the site answers, and nothing about customers', () => {
  const root = (p) => readFileSync(new URL(`../../${p}`, import.meta.url), 'utf8')
  const check = root('.github/scripts/uptime-check.sh')
  assert.match(check, /tries="\$\{TRIES:-3\}"/)
  assert.match(check, /wait_s="\$\{WAIT:-20\}"/)
  assert.match(check, /--max-time 15/)
  const alert = root('.github/scripts/uptime-alert.sh')
  assert.match(alert, /gh issue list --repo "\$repo" --label uptime --state open/)
  assert.match(alert, /gh issue close "\$open"/)
  assert.match(alert, /if \[ -z "\$open" \]; then/)
  assert.match(alert, /gh issue create/)
  assert.ok(!/gh issue (edit|delete|transfer)|gh (repo|secret|workflow|api)/.test(alert), 'it can only list, create, comment and close issues')
})
