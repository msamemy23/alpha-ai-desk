import test from 'node:test'
import assert from 'node:assert/strict'
import { dropColumns, isMissingDbObject, readWithoutMissingColumns, writeWithoutMissingColumns } from '../src/lib/db-missing.ts'

const noColumn = { code: '42703', message: 'column jobs.ro_number does not exist' }

test('a read retries without the optional column when the database does not have it yet', async () => {
  const asked = []
  const result = await readWithoutMissingColumns('id,ro_number,status', ['ro_number'], async columns => {
    asked.push(columns)
    return columns.includes('ro_number') ? { data: null, error: noColumn } : { data: [{ id: 1, status: 'New' }], error: null }
  })
  assert.deepEqual(asked, ['id,ro_number,status', 'id,status'])
  assert.equal(result.error, null)
  assert.deepEqual(result.data, [{ id: 1, status: 'New' }])
})

test('a read that works is run once, and other errors are never hidden', async () => {
  let calls = 0
  const ok = await readWithoutMissingColumns('id,ro_number', ['ro_number'], async () => { calls++; return { data: [1], error: null } })
  assert.equal(calls, 1)
  assert.equal(ok.error, null)
  calls = 0
  const denied = { code: '42501', message: 'permission denied for table jobs' }
  const bad = await readWithoutMissingColumns('id,ro_number', ['ro_number'], async () => { calls++; return { data: null, error: denied } })
  assert.equal(calls, 1, 'a permission error is not retried')
  assert.equal(bad.error, denied)
})

test('a missing column that is not optional is reported, not papered over', async () => {
  let calls = 0
  const result = await readWithoutMissingColumns('id,status', ['ro_number'], async () => { calls++; return { data: null, error: { code: '42703', message: 'column jobs.status does not exist' } } })
  assert.equal(calls, 1)
  assert.equal(isMissingDbObject(result.error), true)
})

test('a save retries without the optional field and keeps everything else', async () => {
  const saved = []
  const result = await writeWithoutMissingColumns({ customer_name: 'Ana', status: 'New', ro_number: 'RO-2026-001' }, ['ro_number'], async row => {
    saved.push(row)
    return 'ro_number' in row ? { error: { code: 'PGRST204', message: "Could not find the 'ro_number' column of 'jobs' in the schema cache" } } : { error: null }
  })
  assert.equal(result.error, null)
  assert.deepEqual(saved[1], { customer_name: 'Ana', status: 'New' })
  assert.equal(saved.length, 2)
})

test('a save that fails for another reason is not retried', async () => {
  let calls = 0
  const result = await writeWithoutMissingColumns({ a: 1, ro_number: 'x' }, ['ro_number'], async () => { calls++; return { error: { code: '23505', message: 'duplicate key' } } })
  assert.equal(calls, 1)
  assert.equal(result.error.code, '23505')
})

test('dropColumns leaves the rest in order', () => {
  assert.equal(dropColumns('id, ro_number ,status', ['ro_number']), 'id,status')
  assert.equal(dropColumns('id,status', ['ro_number']), 'id,status')
})
