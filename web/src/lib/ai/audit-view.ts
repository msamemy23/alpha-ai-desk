/**
 * Turns raw audit rows into the plain-language entries the Activity screen shows,
 * and into a spreadsheet export. One place that understands every kind of row
 * audit-log.ts records: the assistant (ai.*), automations, texts, research.
 *
 * Pure module: no imports from '@/'.
 */
import { getActionInfo, humanize, type PermissionClass } from './action-risk.ts'
import { parseUndo, type UndoDescriptor } from './undo.ts'

export type AuditRow = {
  id: string
  created_at: string
  user_id: string | null
  action: string
  target_type: string | null
  target_id: string | null
  permission: string | null
  approved: boolean | null
  idempotency_key?: string | null
  metadata: Record<string, unknown> | null
}

/** A failed or uncertain assistant action (these never reach the audit log). */
export type OperationRow = {
  id: string
  user_id: string | null
  action: string
  status: string
  error: string | null
  created_at: string
  updated_at?: string | null
}

export type Source = 'assistant' | 'automation' | 'text' | 'research' | 'you' | 'system'
export type Outcome = 'done' | 'failed' | 'uncertain' | 'declined' | 'stopped'
export type ApprovedBy = 'you' | 'rule' | 'not_required' | 'declined' | 'none'
export type UndoState = 'available' | 'undone' | 'unavailable' | 'cannot' | 'none'

export type ActivityEntry = {
  id: string
  at: string
  source: Source
  sourceLabel: string
  title: string
  detail: string
  kind: PermissionClass | 'other'
  userId: string | null
  who: string
  approvedBy: ApprovedBy
  approvedLabel: string
  outcome: Outcome
  outcomeLabel: string
  error: string
  target: string
  action: string
  undo: { state: UndoState; summary: string; reason: string; undoneAt: string; undoneBy: string }
}

export const SOURCE_LABELS: Record<Source, string> = {
  assistant: 'Ask assistant',
  automation: 'Automation',
  text: 'Text message',
  research: 'Research',
  you: 'You',
  system: 'System',
}

export const OUTCOME_LABELS: Record<Outcome, string> = {
  done: 'Done',
  failed: 'Did not happen',
  uncertain: 'Needs checking',
  declined: 'Declined',
  stopped: 'Stopped',
}

const KIND_LABELS: Record<PermissionClass | 'other', string> = {
  read: 'Look-up', draft: 'Draft', save: 'Change', send: 'Message', charge: 'Payment', other: 'Other',
}
export const kindLabel = (kind: PermissionClass | 'other') => KIND_LABELS[kind]

function text(value: unknown, max = 120): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  if (typeof value !== 'string') return ''
  const clean = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim()
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function detailFor(action: string, payload: Record<string, unknown>, meta: Record<string, unknown>): string {
  const summary = text(meta.summary, 200)
  if (summary) return summary
  const who = text(payload.customer_name) || text(payload.name)
  switch (action) {
    case 'updateJobStatus': return text(payload.status) ? `Status set to "${text(payload.status)}"` : ''
    case 'createCustomer': return text(payload.name)
    case 'createJob': return [text(payload.customer_name), [payload.vehicle_year, payload.vehicle_make, payload.vehicle_model].map(v => text(v)).filter(Boolean).join(' ')].filter(Boolean).join(' - ')
    case 'createInvoice': return [text(payload.type) || 'Invoice', who && `for ${who}`].filter(Boolean).join(' ')
    case 'sendEstimateEmail': return [text(payload.doc_number) && `Document #${text(payload.doc_number)}`, text(payload.email) && `to ${text(payload.email)}`].filter(Boolean).join(' ')
    case 'scheduleFollowUp': return [text(payload.channel) || 'sms', text(payload.scheduled_for) && `on ${text(payload.scheduled_for, 30)}`, who && `for ${who}`].filter(Boolean).join(' ')
    case 'createAppointment': return [who, text(payload.scheduled_date) || text(payload.date), text(payload.scheduled_time) || text(payload.time)].filter(Boolean).join(' ')
    case 'searchCustomers': case 'searchWeb': case 'getInventory': case 'lookupParts': return text(payload.query) ? `Looked for "${text(payload.query)}"` : ''
    case 'getCustomerHistory': return who ? `For ${who}` : ''
    default: return who
  }
}

function userLabel(userId: string | null, names: Record<string, string>, ownerId: string | null): string {
  if (!userId) return 'The system'
  if (names[userId]) return names[userId]
  if (ownerId && userId === ownerId) return 'Shop owner'
  return 'Someone on your team'
}

/** Entries about the assistant itself, not an action it took on shop data. They have no Undo. */
const META_ACTIONS = new Set(['ai.undo', 'ai.review.declined', 'ai.run.stopped', 'ai.rules.updated', 'ai.key.cleared'])

function classify(action: string, permission: string | null): { source: Source; title: string; kind: PermissionClass | 'other'; id: string } {
  if (action === 'ai.undo') return { source: 'assistant', title: 'Undid an assistant change', kind: 'save', id: 'undo' }
  if (action === 'ai.rules.updated') return { source: 'you', title: 'Changed the assistant rules', kind: 'save', id: 'rules' }
  if (action === 'ai.key.cleared') return { source: 'you', title: 'Removed the saved AI key', kind: 'save', id: 'key' }
  if (action === 'ai.review.declined') return { source: 'assistant', title: 'You declined a review', kind: 'other', id: 'declined' }
  if (action === 'ai.run.stopped') return { source: 'assistant', title: 'You stopped the assistant', kind: 'other', id: 'stopped' }
  if (action.startsWith('ai.')) {
    const id = action.slice(3)
    const info = getActionInfo(id)
    return { source: 'assistant', title: info.past, kind: info.permission, id }
  }
  if (action.startsWith('system_automation.')) return { source: 'automation', title: `Built-in automation ${humanize(action.slice(18)).toLowerCase()}`, kind: 'save', id: action }
  if (action.startsWith('automation.')) return { source: 'automation', title: `Automation ${humanize(action.slice(11)).toLowerCase()}`, kind: 'save', id: action }
  if (action === 'sms.send') return { source: 'text', title: 'Sent a text message', kind: 'send', id: action }
  if (action.startsWith('repair.') || action.startsWith('parts.')) {
    return { source: 'research', title: action === 'parts.lookup' ? 'Looked up parts' : action === 'repair.search' ? 'Searched repair information' : `Repair research: ${humanize(action.split('.').slice(1).join(' ')).toLowerCase()}`, kind: 'read', id: action }
  }
  return { source: 'system', title: humanize(action), kind: permission === 'read' ? 'read' : 'other', id: action }
}

function approvedFor(source: Source, row: AuditRow, kind: PermissionClass | 'other'): ApprovedBy {
  if (row.approved === false) return 'declined'
  if (kind === 'read' || kind === 'draft') return 'not_required'
  if (source === 'automation') return 'rule'
  if (row.approved === true) return 'you'
  return 'none'
}

const APPROVED_LABELS: Record<ApprovedBy, string> = {
  you: 'Approved by you',
  rule: 'Ran from your automation settings',
  not_required: 'No approval needed',
  declined: 'Not approved',
  none: 'No approval recorded',
}

/**
 * Build the entries. `names` maps a user id to a display name; `ownerId` is the
 * shop owner's user id. Rows that undo another row mark it as undone.
 */
export function buildEntries(args: {
  rows: AuditRow[]
  operations?: OperationRow[]
  names?: Record<string, string>
  ownerId?: string | null
  now?: number
}): ActivityEntry[] {
  const names = args.names || {}
  const ownerId = args.ownerId ?? null
  const undone = new Map<string, { at: string; by: string }>()
  for (const row of args.rows) {
    if (row.action !== 'ai.undo') continue
    const meta = asObject(row.metadata)
    const target = text(meta.undoOf, 80)
    if (target) undone.set(target, { at: row.created_at, by: userLabel(row.user_id, names, ownerId) })
  }

  const entries: ActivityEntry[] = []
  for (const row of args.rows) {
    const meta = asObject(row.metadata)
    const payload = asObject(meta.payload)
    const kindInfo = classify(row.action, row.permission)
    const approvedBy = approvedFor(kindInfo.source, row, kindInfo.kind)
    const failed = meta.success === false
    const outcome: Outcome = approvedBy === 'declined'
      ? (row.action === 'ai.run.stopped' ? 'stopped' : 'declined')
      : row.action === 'ai.run.stopped' ? 'stopped' : failed ? 'failed' : 'done'

    let detail = ''
    if (row.action === 'ai.undo') detail = text(meta.summary, 200)
    else if (row.action === 'sms.send') detail = [text(meta.to, 40) && `To ${text(meta.to, 40)}`, typeof meta.length === 'number' ? `${meta.length} characters` : ''].filter(Boolean).join(', ')
    else if (META_ACTIONS.has(row.action)) detail = text(meta.summary, 200)
    else if (kindInfo.source === 'research') detail = text(meta.query, 160) || text(meta.title, 160) || text(meta.url, 160)
    else if (kindInfo.source === 'automation') detail = text(meta.summary, 200)
    else detail = detailFor(kindInfo.id, payload, meta)

    const descriptor: UndoDescriptor | null = row.action.startsWith('ai.') && !META_ACTIONS.has(row.action) ? parseUndo(meta.undo) : null
    const undoneInfo = undone.get(row.id)
    const info = row.action.startsWith('ai.') && !META_ACTIONS.has(row.action) ? getActionInfo(kindInfo.id) : null
    let undo: ActivityEntry['undo'] = { state: 'none', summary: '', reason: '', undoneAt: '', undoneBy: '' }
    if (undoneInfo) {
      undo = { state: 'undone', summary: descriptor?.summary || '', reason: '', undoneAt: undoneInfo.at, undoneBy: undoneInfo.by }
    } else if (descriptor && outcome === 'done') {
      undo = { state: 'available', summary: descriptor.summary, reason: '', undoneAt: '', undoneBy: '' }
    } else if (info && outcome === 'done' && info.permission !== 'read' && info.permission !== 'draft') {
      if (info.reversibility === 'irreversible') undo = { state: 'cannot', summary: '', reason: info.undoNote || 'This cannot be undone.', undoneAt: '', undoneBy: '' }
      else if (info.reversibility === 'manual') undo = { state: 'unavailable', summary: '', reason: info.undoNote, undoneAt: '', undoneBy: '' }
      else undo = { state: 'unavailable', summary: '', reason: text(meta.undoReason, 160) || 'No undo copy was saved for this one.', undoneAt: '', undoneBy: '' }
    } else if (row.action === 'sms.send') {
      undo = { state: 'cannot', summary: '', reason: 'A text cannot be taken back once it is sent.', undoneAt: '', undoneBy: '' }
    }

    const sourceLabel = SOURCE_LABELS[kindInfo.source]
    const who = kindInfo.source === 'assistant' && row.user_id
      ? userLabel(row.user_id, names, ownerId)
      : kindInfo.source === 'automation' ? 'Automation' : userLabel(row.user_id, names, ownerId)

    entries.push({
      id: row.id,
      at: row.created_at,
      source: kindInfo.source,
      sourceLabel,
      title: kindInfo.title,
      detail,
      kind: kindInfo.kind,
      userId: row.user_id,
      who,
      approvedBy,
      approvedLabel: APPROVED_LABELS[approvedBy],
      outcome,
      outcomeLabel: OUTCOME_LABELS[outcome],
      error: failed ? text(meta.error, 200) : '',
      target: text(meta.subject, 120) || (row.target_type ? humanize(row.target_type) : ''),
      action: row.action,
      undo,
    })
  }

  const now = args.now ?? Date.now()
  for (const op of args.operations || []) {
    const stale = op.status === 'running' && now - new Date(op.created_at).getTime() > 10 * 60_000
    if (op.status !== 'failed' && op.status !== 'unknown' && !stale) continue
    const info = getActionInfo(op.action)
    const outcome: Outcome = op.status === 'failed' ? 'failed' : 'uncertain'
    entries.push({
      id: `op:${op.id}`,
      at: op.updated_at || op.created_at,
      source: 'assistant',
      sourceLabel: SOURCE_LABELS.assistant,
      title: info.past,
      detail: '',
      kind: info.permission,
      userId: op.user_id,
      who: userLabel(op.user_id, names, ownerId),
      approvedBy: 'you',
      approvedLabel: APPROVED_LABELS.you,
      outcome,
      outcomeLabel: OUTCOME_LABELS[outcome],
      error: text(op.error, 200),
      target: '',
      action: `ai.${op.action}`,
      undo: { state: 'none', summary: '', reason: '', undoneAt: '', undoneBy: '' },
    })
  }

  entries.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
  return entries
}

export type ActivityFilters = {
  from?: string
  to?: string
  source?: Source | 'all'
  kind?: PermissionClass | 'other' | 'all' | 'changes'
  outcome?: Outcome | 'all' | 'problems'
  undo?: UndoState | 'all'
  q?: string
}

/** Apply the screen's filters. `changes` means everything except look-ups. */
export function filterEntries(entries: ActivityEntry[], filters: ActivityFilters): ActivityEntry[] {
  const q = (filters.q || '').trim().toLowerCase()
  return entries.filter(entry => {
    if (filters.from && entry.at < filters.from) return false
    if (filters.to && entry.at > filters.to) return false
    if (filters.source && filters.source !== 'all' && entry.source !== filters.source) return false
    if (filters.kind === 'changes' && (entry.kind === 'read' || entry.kind === 'draft')) return false
    if (filters.kind && filters.kind !== 'all' && filters.kind !== 'changes' && entry.kind !== filters.kind) return false
    if (filters.outcome === 'problems' && !['failed', 'uncertain'].includes(entry.outcome)) return false
    if (filters.outcome && filters.outcome !== 'all' && filters.outcome !== 'problems' && entry.outcome !== filters.outcome) return false
    if (filters.undo && filters.undo !== 'all' && entry.undo.state !== filters.undo) return false
    if (q) {
      const haystack = `${entry.title} ${entry.detail} ${entry.who} ${entry.sourceLabel} ${entry.target} ${entry.error}`.toLowerCase()
      if (!haystack.includes(q)) return false
    }
    return true
  })
}

export function summarizeEntries(entries: ActivityEntry[]) {
  let changes = 0, messages = 0, lookups = 0, problems = 0, undone = 0
  for (const entry of entries) {
    if (entry.undo.state === 'undone') undone += 1
    if (entry.outcome === 'failed' || entry.outcome === 'uncertain') { problems += 1; continue }
    if (entry.outcome !== 'done') continue
    if (entry.kind === 'read' || entry.kind === 'draft') lookups += 1
    else if (entry.kind === 'send') messages += 1
    else changes += 1
  }
  return { changes, messages, lookups, problems, undone, total: entries.length }
}

const CSV_COLUMNS: [string, (entry: ActivityEntry) => string][] = [
  ['When (UTC)', e => e.at],
  ['Who', e => e.who],
  ['Source', e => e.sourceLabel],
  ['What', e => e.title],
  ['Details', e => e.detail],
  ['Type', e => kindLabel(e.kind)],
  ['Approval', e => e.approvedLabel],
  ['Outcome', e => e.outcomeLabel],
  ['Problem', e => e.error],
  ['Undo', e => (e.undo.state === 'undone' ? 'Undone' : e.undo.state === 'available' ? 'Can be undone' : e.undo.state === 'cannot' ? 'Cannot be undone' : e.undo.state === 'unavailable' ? 'Not available' : '')],
  ['Undone at (UTC)', e => e.undo.undoneAt],
  ['Undone by', e => e.undo.undoneBy],
  ['Record', e => e.target],
]

/** A cell that a spreadsheet could read as a formula gets a leading apostrophe. */
export function csvCell(value: string): string {
  let cell = String(value ?? '')
  if (/^[=+\-@\t\r]/.test(cell)) cell = `'${cell}`
  return /[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell
}

export function entriesToCsv(entries: ActivityEntry[]): string {
  const lines = [CSV_COLUMNS.map(([name]) => csvCell(name)).join(',')]
  for (const entry of entries) lines.push(CSV_COLUMNS.map(([, get]) => csvCell(get(entry))).join(','))
  return `﻿${lines.join('\r\n')}\r\n`
}
