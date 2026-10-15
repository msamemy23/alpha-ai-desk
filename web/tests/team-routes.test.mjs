import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const timeclock = readFileSync(new URL('../src/app/api/timeclock/route.ts', import.meta.url), 'utf8')
const staff = readFileSync(new URL('../src/app/api/staff/route.ts', import.meta.url), 'utf8')
const board = readFileSync(new URL('../src/app/(app)/shopboard/page.tsx', import.meta.url), 'utf8')

const lines = src => src.split('\n').map((text, i) => ({ text, n: i + 1 }))

test('both routes refuse people who are not signed in, and viewers cannot change anything', () => {
  for (const [name, src] of [['timeclock', timeclock], ['staff', staff]]) {
    assert.equal((src.match(/getAuthedShop\(\)/g) || []).length >= 2, true, `${name}: GET and POST both check the session`)
    assert.match(src, /if \(!auth\) return unauthorized\(\)/, name)
    assert.match(src, /auth\.role === 'viewer'\) return forbidden\(\)/, name)
  }
})

test('only an owner, admin or manager can edit time entries or change the team', () => {
  assert.match(timeclock, /CAN_EDIT = new Set\(\['owner', 'admin', 'manager'\]\)/)
  assert.match(staff, /CAN_MANAGE = new Set\(\['owner', 'admin', 'manager'\]\)/)
  assert.match(staff, /if \(!CAN_MANAGE\.has\(auth\.role\)\) return fail\(403/)
  // add, fix and delete a punch all sit behind the same check
  const gate = timeclock.indexOf('!CAN_EDIT.has(auth.role)')
  for (const action of ["'add_entry'", "'update_entry'", "'delete_entry'"]) {
    const at = timeclock.indexOf(`action === ${action}`)
    assert.ok(at > -1, `${action} is handled`)
  }
  assert.ok(gate > -1)
})

test('every read and write of the clock and the team is limited to the signed-in shop', () => {
  for (const [name, src] of [['timeclock', timeclock], ['staff', staff]]) {
    const all = lines(src)
    for (const { text, n } of all) {
      if (!/sb\.from\('(timeclock|staff|jobs|appointments)'\)/.test(text)) continue
      // The one exception only asks whether the break columns exist yet. No row is read out of it.
      if (/select\('break_minutes'\)\.limit\(1\)/.test(text)) continue
      if (/\.insert\(/.test(text)) { assert.match(all.slice(n - 1, n + 4).map(l => l.text).join('\n'), /shop_id/, `${name}:${n} insert names the shop`); continue }
      assert.match(text, /\.eq\('shop_id', (shopId|auth\.shopId)\)/, `${name}:${n} is limited to the shop`)
    }
  }
})

test('people see a plain message, never the database error', () => {
  assert.doesNotMatch(timeclock, /error\.message\s*[,}]/)
  assert.doesNotMatch(staff, /error\.message\s*[,}]/)
})

test('the shop board saves a car for its own shop only, and puts the old name back if the save fails', () => {
  assert.match(board, /\.update\(\{ tech: next, updated_at/)
  assert.match(board, /\.eq\('id', job\.id\)\s*\.eq\('shop_id', shopId\)/)
  assert.match(board, /setJobs\(js => js\.map\(j => \(j\.id === job\.id \? \{ \.\.\.j, tech: before \} : j\)\)\)/)
  // a save that touched no rows (the car was removed, or access was denied) is a failure, not a success
  assert.match(board, /data\.length === 0/)
})
