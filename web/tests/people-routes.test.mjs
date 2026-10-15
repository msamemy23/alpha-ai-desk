// The people and records routes: sign-in, who may do what, and that every read and write is limited to the signed-in shop.
// These read the files as text, like team-routes.test.mjs, so a careless edit is caught without a database.
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname

function walk(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) out.push(...walk(p))
    else if (name === 'route.ts') out.push(p)
  }
  return out
}

const ROUTE_DIRS = ['timeclock', 'staff', 'customers', 'vehicles'].map(d => join(root, 'src/app/api', d))
const routes = ROUTE_DIRS.flatMap(walk).map(p => ({ path: p.slice(root.length), src: readFileSync(p, 'utf8').replace(/\r/g, '') }))
// Server modules the routes call. Their queries get the same scan.
const SERVER_LIBS = ['src/lib/timeclock-server.ts', 'src/lib/customers/store.ts', 'src/lib/vehicles/store.ts']
  .filter(p => existsSync(join(root, p))).map(p => ({ path: p, src: readFileSync(join(root, p), 'utf8').replace(/\r/g, '') }))

const lines = src => src.split('\n').map((text, i) => ({ text, n: i + 1 }))
const LIKE_FIXED = /^\s*(\/\/|\*|\/\*)/

test('there are routes to check', () => {
  assert.ok(routes.length >= 6, `found ${routes.length} routes`)
})

test('every route needs a signed-in user and refuses viewers for writes', () => {
  for (const { path, src } of routes) {
    assert.match(src, /const auth = await getAuthedShop\(\)/, `${path} checks the session`)
    assert.match(src, /if \(!auth\) return unauthorized\(\)/, `${path} refuses when not signed in`)
    if (/export async function POST/.test(src)) assert.match(src, /auth\.role === 'viewer'\) return forbidden\(\)|!CAN_[A-Z]+\.has\(auth\.role\)\) return fail\(403/, `${path} blocks viewers from writing`)
  }
})

test('every query names the shop', () => {
  for (const { path, src } of [...routes, ...SERVER_LIBS]) {
    const all = lines(src)
    for (const { text, n } of all) {
      if (LIKE_FIXED.test(text) || !/\.from\('[a-z_]+'\)/.test(text)) continue
      // The one exception only asks whether break columns exist yet. No row is read out of it.
      if (/select\('break_minutes'\)\.limit\(1\)/.test(text)) continue
      // A statement can span lines: look from here to the end of the statement (up to eight lines on).
      const window = all.slice(n - 1, n + 8).map(l => l.text).join('\n')
      assert.match(window, /shop_id/, `${path}:${n} names the shop`)
    }
  }
})

test('people see a plain message, never the database error', () => {
  for (const { path, src } of [...routes, ...SERVER_LIBS]) {
    assert.doesNotMatch(src, /error\.message\s*[,}]/, `${path} does not send error.message`)
    assert.doesNotMatch(src, /NextResponse\.json\([^)]*(e|err|error)\.message/, `${path} does not send a caught error's message`)
  }
})

test('pay, PINs and approvals are for managers; pay rates are for owners and admins only', () => {
  const find = suffix => routes.find(r => r.path.endsWith(suffix))
  const pay = find('staff/pay/route.ts')
  assert.ok(pay, 'pay route exists')
  assert.match(pay.src, /CAN_SEE_PAY = new Set\(\['owner', 'admin'\]\)/)
  assert.ok((pay.src.match(/CAN_SEE_PAY\.has\(auth\.role\)/g) || []).length >= 2, 'both reading and writing pay check the role')
  const pin = find('staff/pin/route.ts')
  assert.match(pin.src, /CAN_MANAGE = new Set\(\['owner', 'admin', 'manager'\]\)/)
  assert.ok((pin.src.match(/CAN_MANAGE\.has\(auth\.role\)/g) || []).length >= 2, 'both reading and setting PINs check the role')
  const rules = find('timeclock/rules/route.ts')
  assert.match(rules.src, /!CAN_CHANGE\.has\(auth\.role\)/)
  const changes = find('timeclock/changes/route.ts')
  assert.match(changes.src, /CAN_SEE\.has\(auth\.role\)/)
})

test('a PIN is never sent back, logged or stored in the clear', () => {
  const pin = routes.find(r => r.path.endsWith('staff/pin/route.ts'))
  assert.match(pin.src, /hashPin\(/)
  assert.doesNotMatch(pin.src, /select\([^)]*pin_hash/, 'the route never reads the hash back')
  const kiosk = routes.find(r => r.path.endsWith('timeclock/kiosk/route.ts'))
  assert.doesNotMatch(kiosk.src, /console\.\w+\([^)]*pin/i, 'the kiosk route does not log a PIN')
  assert.doesNotMatch(kiosk.src, /pin_hash/)
})

test('the tablet cannot edit, approve or see pay', () => {
  const kiosk = routes.find(r => r.path.endsWith('timeclock/kiosk/route.ts'))
  assert.match(kiosk.src, /const ACTIONS = new Set\(\[/)
  for (const bad of ['add_entry', 'update_entry', 'delete_entry', 'restore_entry', 'approve', 'unapprove']) assert.doesNotMatch(kiosk.src, new RegExp(`'${bad}'`), `${bad} is not offered on the tablet`)
  assert.doesNotMatch(kiosk.src, /staff_pay|hourly_rate|pay_rate/)
  assert.match(kiosk.src, /checkRateLimit\(/)
  assert.match(kiosk.src, /source: 'kiosk'/)
})
