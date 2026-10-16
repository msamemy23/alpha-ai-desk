import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as f from '../src/lib/jobflow.ts'

const src = (p) => readFileSync(new URL(`../src/${p}`, import.meta.url), 'utf8')
const saved = (over = {}) => ({ ...f.emptyFlow('j1'), version: 3, ...over })

test('the form starts from the saved copy, every field as the text in its box', () => {
  const d = f.draftFrom(saved({ parts: 'ordered', parts_note: 'Pads', parts_eta: '2026-10-19', labels: ['Rush'], est_hours: 2.5, promise_time: '15:30', public_note: 'Back by 3' }))
  assert.deepEqual(d, { parts: 'ordered', parts_note: 'Pads', parts_eta: '2026-10-19', labels: ['Rush'], est_hours: '2.5', promise_time: '15:30', public_note: 'Back by 3' })
  const empty = f.draftFrom(saved())
  assert.deepEqual([empty.est_hours, empty.parts_eta, empty.promise_time, empty.parts], ['', '', '', 'none'])
  // the draft owns its own list: changing it never changes the saved copy
  const s = saved({ labels: ['Rush'] })
  f.draftFrom(s).labels.push('X')
  assert.deepEqual(s.labels, ['Rush'])
})

test('nothing typed means nothing to save', () => {
  const s = saved({ parts: 'ordered', parts_eta: '2026-10-19', labels: ['Rush'], est_hours: 2, promise_time: '09:00', public_note: 'Hi' })
  assert.deepEqual(f.patchFrom(s, f.draftFrom(s)), {})
})

test('only the fields that changed are saved, cleaned the way the server cleans them', () => {
  const s = saved({ parts: 'needed', labels: ['Rush'], est_hours: 2 })
  const d = { ...f.draftFrom(s), parts: 'ordered', parts_eta: '2026-10-19', est_hours: '2,5', public_note: ' We  will text <b>you</b> ' }
  assert.deepEqual(f.patchFrom(s, d), { parts: 'ordered', parts_eta: '2026-10-19', est_hours: 2.5, public_note: 'We will text byou/b' })
  // hours a quarter apart are the same estimate once rounded
  assert.deepEqual(f.patchFrom(saved({ est_hours: 2.25 }), { ...f.draftFrom(saved()), est_hours: '2.3' }), {})
})

test('emptying a box saves nothing in its place, and a part that is here has no due date', () => {
  const s = saved({ parts: 'ordered', parts_eta: '2026-10-19', est_hours: 2, promise_time: '15:30' })
  assert.deepEqual(f.patchFrom(s, { ...f.draftFrom(s), est_hours: '', promise_time: '' }), { est_hours: null, promise_time: null })
  assert.deepEqual(f.patchFrom(s, { ...f.draftFrom(s), parts: 'in' }), { parts: 'in', parts_eta: null })
  assert.deepEqual(f.patchFrom(s, { ...f.draftFrom(s), parts: 'none' }), { parts: 'none', parts_eta: null })
  // a bad time or date is dropped rather than sent
  assert.deepEqual(f.patchFrom(saved(), { ...f.draftFrom(saved()), promise_time: '25:99' }), {})
})

test('labels change as a list, in order, and a change of order alone is a change', () => {
  const s = saved({ labels: ['Rush', 'Fleet'] })
  assert.deepEqual(f.patchFrom(s, { ...f.draftFrom(s), labels: ['Fleet', 'Rush'] }), { labels: ['Fleet', 'Rush'] })
  assert.deepEqual(f.patchFrom(s, { ...f.draftFrom(s), labels: ['Rush'] }), { labels: ['Rush'] })
})

test('a label goes on or comes off whatever the capitals, up to five', () => {
  assert.deepEqual(f.toggleLabel([], 'Rush'), ['Rush'])
  assert.deepEqual(f.toggleLabel(['Rush'], 'rush'), [])
  assert.deepEqual(f.toggleLabel(['Rush'], '  '), ['Rush'])
  const five = ['a', 'b', 'c', 'd', 'e']
  assert.deepEqual(f.toggleLabel(five, 'f'), five)
  assert.deepEqual(f.toggleLabel(five, 'A'), ['b', 'c', 'd', 'e'])
})

test('a box filled in wrong gets a plain word, and an empty hours box is fine', () => {
  assert.equal(f.hoursProblem(''), '')
  assert.equal(f.hoursProblem(' 2.5 '), '')
  assert.equal(f.hoursProblem('2,5'), '')
  assert.match(f.hoursProblem('abc'), /number above zero/)
  assert.match(f.hoursProblem('0'), /above zero/)
  assert.match(f.hoursProblem('-3'), /above zero/)
  assert.match(f.hoursProblem('100'), /99/)
  assert.match(f.hoursProblem('0.1'), /quarter/)
})

test('parts need a look when nobody ordered them or they are overdue, never on a finished car', () => {
  const A = (parts, parts_eta, finished = false, today = '2026-10-16') => f.partsAttention(parts === undefined ? undefined : { parts, parts_eta }, finished, today)
  assert.equal(A(undefined), null)
  assert.equal(A('none', null), null)
  assert.equal(A('needed', null), 'order')
  assert.equal(A('ordered', '2026-10-15'), 'late')
  assert.equal(A('partial', '2026-10-15'), 'late')
  assert.equal(A('ordered', '2026-10-16'), null) // due today is not late yet
  assert.equal(A('ordered', '2026-10-20'), null)
  assert.equal(A('ordered', null), null)
  assert.equal(A('in', '2026-10-01'), null)
  assert.equal(A('needed', null, true), null)
  assert.equal(A('ordered', '2026-10-15', false, ''), null) // no date known yet: say nothing
})

test('a technician column says what is assigned and what is left, and owns up to cars with no hours', () => {
  const S = (rows) => f.hoursWords(f.hoursSummary(rows, null), rows.length)
  assert.equal(S([]), '')
  assert.equal(S([{ hours: null, ready: false }, { hours: null, ready: false }]), 'No hours entered yet')
  assert.equal(S([{ hours: 2.5, ready: false }, { hours: 1, ready: true }]), '3.5 h assigned, 2.5 h left')
  assert.equal(S([{ hours: 2, ready: false }, { hours: null, ready: false }]), '2 h assigned, 2 h left, 1 car without hours')
  assert.equal(S([{ hours: 1, ready: true }, { hours: null, ready: false }, { hours: null, ready: false }]), '1 h assigned, 0 h left, 2 cars without hours')
})

test('the board card shows the extras and the sheet saves them through the one route, with the version it last saw', () => {
  const card = src('components/shopboard/BoardCard.tsx')
  for (const w of ['PARTS_SHORT', 'partsAttention', 'promiseInfo', 'hoursLabel', 'flow.labels']) assert.ok(card.includes(w), `the card uses ${w}`)
  assert.ok(!/fetch\(|supabase/.test(card), 'a card only looks')
  const form = src('components/jobs/JobFlowCard.tsx')
  assert.ok(/fetch\('\/api\/jobflow', \{\s*method: 'PATCH'/.test(form), 'saves with PATCH to /api/jobflow')
  assert.ok(/base_version: saved\.version/.test(form), 'sends the version it last saw')
  assert.ok(/patchFrom\(baseline, draft\)/.test(form), 'sends only what changed against where the typing started')
  assert.ok(/Somebody else just changed this car/.test(form), 'says so when somebody saved first')
  assert.ok(!/\.from\('job_flow'\)|supabase/.test(form), 'the form never touches the database directly')
})

test('the board page loads the extras, filters on them, and flags parts that need a look', () => {
  const page = src('app/(app)/shopboard/page.tsx')
  assert.ok(/useJobFlows\(/.test(page), 'loads every car\'s extras')
  assert.ok(/key: 'parts', label: 'Waiting on parts'/.test(page), 'a Waiting on parts filter')
  assert.ok(/Which label to show/.test(page), 'a label filter')
  assert.ok(/hoursWords\(hoursSummary\(/.test(page), 'hours on each column')
  assert.ok(/partsAttention\(/.test(page), 'parts that need a look')
  assert.ok(/<CarSheet/.test(page) && /dirty=\{flowDirty\}/.test(page), 'unsaved typing keeps the sheet from closing on a stray tap')
  const mine = src('app/(app)/my-cars/page.tsx')
  assert.ok(/useJobFlows\(/.test(mine) && /flow=\{flows\.get\(j\.id\)\}/.test(mine), 'a technician sees the same parts line on their own cars')
  const detail = src('components/jobs/JobDetail.tsx')
  assert.ok(/<JobFlowCardWithSettings/.test(detail), 'the job sheet has the same editor')
})

test('the hours and parts refresh never lands on top of a save in progress', () => {
  const hook = src('components/shopboard/useJobFlows.ts')
  assert.ok(/busy\.current > 0\) return/.test(hook), 'a refresh waits while a save is running')
  assert.ok(/missing|available !== false/.test(hook), 'knows when the database holds no extras')
})
