/**
 * What to tell the owner after they press Stop: what had already finished, what had not,
 * and whether anything was changed. Built from the steps recorded for the turn, never from
 * a guess. The first sentence stays exactly "Stopped by you." so a saved chat still shows
 * as a stopped request.
 *
 * Pure module: no imports from '@/' so node:test can load it directly.
 */
import { getActionInfo } from './action-risk.ts'

export type StopEvent = { tool: string; status: 'running' | 'ok' | 'error'; detail?: string }
export type StopSummary = { text: string; changedSomething: boolean; done: string[]; looked: string[]; cutOff: string[] }

const SKIP = /^(?:agentRouter|kapture\.)/

function toolId(tool: string): string {
  return tool.replace(/^action\./, '').replace(/^connector\./, '')
}

export function summarizeStop(events: StopEvent[]): StopSummary {
  // Newest status per step wins: a step logs "running" and then "ok" or "error".
  const last = new Map<string, StopEvent>()
  for (const event of events) {
    if (SKIP.test(event.tool)) continue
    last.set(event.tool, event)
  }
  const looked: string[] = []
  const done: string[] = []
  const cutOff: string[] = []
  for (const event of last.values()) {
    const info = getActionInfo(toolId(event.tool))
    if (event.status === 'ok') {
      if (info.permission === 'read' || info.permission === 'draft') looked.push(info.past)
      else done.push(info.past)
    } else if (event.status === 'running') {
      cutOff.push(info.title)
    }
  }
  const changedSomething = done.length > 0
  const parts = ['Stopped by you.']
  parts.push(changedSomething ? 'Part of it had already been done and was not undone.' : 'Nothing was sent or changed.')
  if (done.length) parts.push(`Already done: ${[...new Set(done)].join(', ')}. Find it in Activity to undo it.`)
  if (looked.length) parts.push(`Already looked up: ${[...new Set(looked)].join(', ')}.`)
  if (cutOff.length) parts.push(`Cut off before it finished: ${[...new Set(cutOff)].join(', ')}.`)
  parts.push(done.length || looked.length ? 'Not done: the rest of your request.' : 'Nothing had been started yet.')
  return { text: parts.join(' '), changedSomething, done, looked, cutOff }
}
