import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as m from '../src/lib/my-cars.ts'

const stage = status => ({
  New: 'new', Approved: 'approved', 'In Progress': 'working', 'Waiting on Parts': 'waiting',
  'Ready for Pickup': 'ready', Completed: 'ready', Paid: 'done', Closed: 'done',
})[status] || 'new'

const job = (id, tech, status, promise_date = null) => ({ id, tech, status, promise_date })

test('each stage goes to the right group, and paid or closed work is on nobody\'s list', () => {
  assert.equal(m.groupKeyOf('working'), 'working')
  assert.equal(m.groupKeyOf('new'), 'next')
  assert.equal(m.groupKeyOf('approved'), 'next')
  assert.equal(m.groupKeyOf('waiting'), 'waiting')
  assert.equal(m.groupKeyOf('ready'), 'ready')
  assert.equal(m.groupKeyOf('done'), null)
  assert.equal(m.groupKeyOf('something else'), null)
  assert.deepEqual(m.MY_GROUPS.map(g => g.key), ['working', 'next', 'waiting', 'ready'])
})

test('only the cars with my name on them are mine, whatever the capitals or spaces', () => {
  const jobs = [
    job(1, 'Marco Reyes', 'In Progress'),
    job(2, ' marco reyes ', 'Approved'),
    job(3, 'Dwayne Cole', 'In Progress'),
    job(4, '', 'In Progress'),
    job(5, 'Unassigned', 'New'),
    job(6, null, 'New'),
    job(7, 'MARCO REYES', 'Waiting on Parts'),
    job(8, 'Marco Reyes', 'Ready for Pickup'),
  ]
  const r = m.splitMine(jobs, 'Marco Reyes', stage)
  assert.deepEqual(r.groups.working.map(j => j.id), [1])
  assert.deepEqual(r.groups.next.map(j => j.id), [2])
  assert.deepEqual(r.groups.waiting.map(j => j.id), [7])
  assert.deepEqual(r.groups.ready.map(j => j.id), [8])
  assert.equal(r.total, 4)
  assert.equal(r.active, 3, 'a finished car is waiting for its owner, not for the technician')
})

test('a paid or closed car never shows, and nobody sees someone else\'s or an unassigned car', () => {
  const jobs = [job(1, 'Marco Reyes', 'Paid'), job(2, 'Marco Reyes', 'Closed'), job(3, 'Dwayne Cole', 'In Progress'), job(4, '', 'New')]
  const r = m.splitMine(jobs, 'Marco Reyes', stage)
  assert.equal(r.total, 0)
  assert.equal(r.active, 0)
})

test('no name means no cars, so an unpicked phone never shows the unassigned ones', () => {
  const jobs = [job(1, '', 'New'), job(2, 'Unassigned', 'New'), job(3, 'Marco Reyes', 'New')]
  for (const name of ['', '   ']) assert.equal(m.splitMine(jobs, name, stage).total, 0, JSON.stringify(name))
})

test('each group is put in the order the caller asks for, and the input list is not changed', () => {
  const jobs = [job(1, 'Marco', 'In Progress', '2026-10-20'), job(2, 'Marco', 'In Progress', '2026-10-15'), job(3, 'Marco', 'In Progress', '2026-10-18')]
  const copy = JSON.stringify(jobs)
  const byDate = (a, b) => a.promise_date.localeCompare(b.promise_date)
  assert.deepEqual(m.splitMine(jobs, 'Marco', stage, byDate).groups.working.map(j => j.id), [2, 3, 1])
  assert.equal(JSON.stringify(jobs), copy)
})

test('the line under the title says how many cars and how many are late', () => {
  assert.equal(m.carsWord(1), '1 car')
  assert.equal(m.carsWord(0), '0 cars')
  assert.equal(m.carsWord(3), '3 cars')
  assert.equal(m.summaryLine(0, 0), 'Nothing on your list right now')
  assert.equal(m.summaryLine(1, 0), '1 car to work on')
  assert.equal(m.summaryLine(4, 0), '4 cars to work on')
  assert.equal(m.summaryLine(4, 2), '4 cars to work on, 2 late')
})

test('who this phone belongs to is kept as an id and nothing else', () => {
  const data = new Map()
  const store = { getItem: k => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) }
  assert.equal(m.readSaved(store), null)
  m.writeSaved(store, 42)
  assert.equal(m.readSaved(store), '42')
  assert.deepEqual([...data.entries()], [[m.MY_CARS_KEY, '42']])
  m.writeSaved(store, null)
  assert.equal(m.readSaved(store), null)
  assert.equal(data.size, 0)
})

test('a browser that refuses storage never breaks the page', () => {
  const broken = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } }
  assert.equal(m.readSaved(broken), null)
  assert.doesNotThrow(() => m.writeSaved(broken, 7))
  assert.doesNotThrow(() => m.writeSaved(broken, null))
  assert.equal(m.readSaved(null), null)
  assert.equal(m.readSaved(undefined), null)
  assert.doesNotThrow(() => m.writeSaved(null, 7))
})

test('a remembered person who has left the team, or never existed, is not shown', () => {
  const people = [{ id: 1, name: 'Marco Reyes' }, { id: 2, name: 'Dwayne Cole' }]
  assert.equal(m.pickSaved(people, '2').name, 'Dwayne Cole')
  assert.equal(m.pickSaved(people, '9'), null)
  assert.equal(m.pickSaved(people, null), null)
  assert.equal(m.pickSaved(people, ''), null)
  assert.equal(m.pickSaved([], '1'), null)
})

/* ---------- the screen itself ---------- */

const page = readFileSync(new URL('../src/app/(app)/my-cars/page.tsx', import.meta.url), 'utf8')

test('My cars only reads cars. It never writes to jobs, documents or customers', () => {
  assert.doesNotMatch(page, /\.(insert|update|upsert|delete)\(/)
  assert.doesNotMatch(page, /method:\s*['"](POST|PUT|PATCH|DELETE)['"]/)
  // The one thing it saves is a punch, through the same time clock route the Shop board uses.
  assert.match(page, /clock\.act\(/)
})

test('My cars opens a car on the Jobs screen and says plainly that the list is not a lock', () => {
  assert.match(page, /\/jobs\?job=/)
  assert.match(page, /not a lock|only picks which cars you see/i)
})

test('My cars draws nothing that depends on the browser until the page has mounted', () => {
  assert.match(page, /useState<string \| null \| undefined>\(undefined\)/)
  assert.match(page, /const ready = savedId !== undefined/)
})

test('My cars is in the menu, the search words and the Work tab', () => {
  const nav = readFileSync(new URL('../src/components/shell/nav.ts', import.meta.url), 'utf8')
  assert.match(nav, /href: '\/my-cars', label: 'My cars'/)
  assert.match(nav, /'\/shopboard', '\/my-cars'/)
  const cmd = readFileSync(new URL('../src/components/shell/commands.ts', import.meta.url), 'utf8')
  assert.match(cmd, /'\/my-cars': \[/)
})
