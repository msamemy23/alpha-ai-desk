import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as sb from '../src/lib/shopboard.ts'

const job = (id, tech) => ({ id, tech })

test('cars with no technician, or the word Unassigned, are unassigned', () => {
  for (const t of ['', '  ', 'Unassigned', ' unassigned ', null, undefined]) assert.equal(sb.isUnassigned(t), true, String(t))
  assert.equal(sb.isUnassigned('Marco Reyes'), false)
})

test('cars are put on the right technician, whatever the capitals', () => {
  const g = sb.groupByTech([job(1, 'Marco Reyes'), job(2, ' marco reyes '), job(3, 'Dwayne Cole'), job(4, ''), job(5, 'Unassigned')], ['Dwayne Cole', 'Marco Reyes', 'Tasha Lee'])
  assert.deepEqual(g.unassigned.map(j => j.id), [4, 5])
  assert.deepEqual([...g.byTech.keys()], ['Dwayne Cole', 'Marco Reyes', 'Tasha Lee']) // order kept, empty techs kept
  assert.deepEqual(g.byTech.get('Marco Reyes').map(j => j.id), [1, 2])
  assert.deepEqual(g.byTech.get('Dwayne Cole').map(j => j.id), [3])
  assert.deepEqual(g.byTech.get('Tasha Lee'), [])
  assert.deepEqual(g.others, [])
})

test('names that are not on the team get their own column, grouped without regard to capitals', () => {
  const g = sb.groupByTech([job(1, 'Carlos'), job(2, 'carlos '), job(3, 'Zed'), job(4, 'Marco Reyes')], ['Marco Reyes'])
  assert.deepEqual(g.others.map(o => [o.name, o.jobs.map(j => j.id)]), [['Carlos', [1, 2]], ['Zed', [3]]])
  assert.deepEqual(g.byTech.get('Marco Reyes').map(j => j.id), [4])
})

test('an empty team puts every named car in other columns', () => {
  const g = sb.groupByTech([job(1, 'Marco Reyes'), job(2, '')], [])
  assert.equal(g.byTech.size, 0)
  assert.deepEqual(g.unassigned.map(j => j.id), [2])
  assert.equal(g.others.length, 1)
})

test('two team names that differ only by capitals do not double up', () => {
  const g = sb.groupByTech([job(1, 'sam')], ['Sam', 'SAM'])
  assert.deepEqual([...g.byTech.keys()], ['Sam'])
  assert.deepEqual(g.byTech.get('Sam').map(j => j.id), [1])
})

test('giving a car back saves an empty name', () => {
  assert.equal(sb.techValue('Unassigned'), '')
  assert.equal(sb.techValue(''), '')
  assert.equal(sb.techValue('  Marco Reyes '), 'Marco Reyes')
})

test('a column id is safe to put in a page address, whatever the name holds', () => {
  assert.equal(sb.columnId('tech:12'), 'col-tech-12')
  assert.equal(sb.columnId('__unassigned__'), 'col-unassigned')
  assert.equal(sb.columnId("other:o'brien, sam"), 'col-other-o-brien-sam')
  assert.equal(sb.columnId('   '), 'col-x')
  assert.equal(sb.columnId('###'), 'col-x')
})

test('jump chips follow the column order and never share an id', () => {
  const chips = sb.jumpChips([
    { key: '__unassigned__', label: 'Unassigned', count: 3 },
    { key: 'tech:1', label: 'Marco Reyes', count: 2 },
    { key: 'tech:2', label: 'Dwayne Cole', count: 0 },
    { key: 'other:a b', label: 'A B', count: 1 },
    { key: 'other:a-b', label: 'A-B', count: 4 },
  ])
  assert.deepEqual(chips.map(c => c.label), ['Unassigned', 'Marco Reyes', 'Dwayne Cole', 'A B', 'A-B'])
  assert.deepEqual(chips.map(c => c.count), [3, 2, 0, 1, 4])
  assert.equal(new Set(chips.map(c => c.id)).size, chips.length)
  assert.equal(chips[3].id, 'col-other-a-b')
  assert.equal(chips[4].id, 'col-other-a-b-2')
  assert.deepEqual(sb.jumpChips([]), [])
})

test('the wall keeps the customer off the screen unless the shop turned names on', () => {
  assert.equal(sb.wallCustomer('Sam Ortiz', false), '')
  assert.equal(sb.wallCustomer('Sam Ortiz', true), 'Sam')
  assert.equal(sb.wallCustomer('  maria  elena Gomez ', true), 'maria')
  assert.equal(sb.wallCustomer('Walk-in: Pat Lee', true), 'Pat')
  assert.equal(sb.wallCustomer('walk in - Pat Lee', true), 'Pat')
  assert.equal(sb.wallCustomer(null, true), '')
  assert.equal(sb.wallCustomer(undefined, false), '')
  // never the surname
  assert.ok(!sb.wallCustomer('Sam Ortiz', true).includes('Ortiz'))
})

test('the wall refresh stays within what the settings allow', () => {
  assert.equal(sb.wallSeconds(30), 30)
  assert.equal(sb.wallSeconds(1), 10)
  assert.equal(sb.wallSeconds(9999), 300)
  assert.equal(sb.wallSeconds('45'), 45)
  assert.equal(sb.wallSeconds(undefined), 30)
  assert.equal(sb.wallSeconds('soon'), 30)
  assert.equal(sb.wallSeconds(Infinity), 30)
})

test('the wall draws only columns that have cars and names the people who have none', () => {
  const w = sb.wallColumns([job(1, 'Marco Reyes'), job(2, ''), job(3, 'marco reyes'), job(4, 'Zed')], ['Dwayne Cole', 'Marco Reyes'])
  assert.deepEqual(w.columns.map(c => [c.name, c.jobs.map(j => j.id)]), [['Unassigned', [2]], ['Marco Reyes', [1, 3]], ['Zed', [4]]])
  assert.deepEqual(w.idle, ['Dwayne Cole'])
  assert.equal(new Set(w.columns.map(c => c.key)).size, w.columns.length)
})

test('an empty shop gives the wall nothing to draw and everyone idle', () => {
  const w = sb.wallColumns([], ['Dwayne Cole', 'Marco Reyes'])
  assert.deepEqual(w.columns, [])
  assert.deepEqual(w.idle, ['Dwayne Cole', 'Marco Reyes'])
})

test('the wall only looks: it has no way to save anything and no customer surname or plate', () => {
  const wall = readFileSync(new URL('../src/components/shopboard/ShopWall.tsx', import.meta.url), 'utf8')
  assert.ok(!/supabase|fetch\(|method:|\.update\(|\.insert\(|onDrop|draggable/.test(wall), 'the wall must not write or drag')
  assert.ok(!/vehicle_plate/.test(wall), 'the plate stays off a screen the waiting room can read')
  assert.ok(!/customer_name/.test(wall.replace(/wallCustomer\(j\.customer_name, showNames\)/, '')), 'customer_name goes only through wallCustomer')
  const page = readFileSync(new URL('../src/app/(app)/shopboard/page.tsx', import.meta.url), 'utf8')
  assert.ok(/showNames=\{board\.tvNames\}/.test(page), 'names follow the saved setting')
})
