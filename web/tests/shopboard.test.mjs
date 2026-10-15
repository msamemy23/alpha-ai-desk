import test from 'node:test'
import assert from 'node:assert/strict'
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
