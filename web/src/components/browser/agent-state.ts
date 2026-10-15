// "Ask Alpha to look this up": what the screen remembers about one run, one step at a time.
// The server keeps nothing between steps. The screen sends the goal, the page it is on, what is filled in and the short
// history with every step, and shows what comes back. Stop is simply not asking for the next step.
import type { PreparedStep } from '../../lib/browser/actions.ts'
import type { AgentStepRecord } from '../../lib/browser/agent.ts'
import type { AgentStepResult } from '../../lib/browser/agent-run.ts'
import type { LiveOutcome, Snapshot } from '../../lib/browser/engine.ts'
import type { FailureInfo } from './failure.ts'
import type { Lamp, PendingApproval, Viewport } from './live.ts'

/** The most steps one lookup takes. The server stops at the same number. */
export const MAX_STEPS = 12

export type RunStatus = 'running' | 'approval' | 'needs_you' | 'done' | 'stopped' | 'failed'

export interface RunAnswer {
  text: string
  evidence: string
  /** The words Alpha quoted were found on the page. */
  verified: boolean
  sourceUrl: string
  sourceTitle: string
}

export interface AgentRun {
  id: number
  status: RunStatus
  goal: string
  startUrl: string
  viewport: Viewport
  url: string
  prepared: PreparedStep[]
  scrollY: number
  steps: AgentStepRecord[]
  snapshot: Snapshot | null
  /** Addresses Alpha looked at, in order. */
  visited: string[]
  /** A step is on its way to the server. */
  working: boolean
  approval: PendingApproval | null
  message: string
  failure: { setup: boolean; code: string } | null
  answer: RunAnswer | null
  /** The person said yes to opening a new site. The next step opens it. */
  openApproval: { id: string; url: string } | null
}

export type AgentEvent =
  | { type: 'start'; id: number; goal: string; startUrl: string; viewport: Viewport }
  | { type: 'asking' }
  | { type: 'result'; result: AgentStepResult }
  | { type: 'failed'; failure: FailureInfo }
  | { type: 'stop' }
  | { type: 'retry' }
  | { type: 'approvalPhase'; phase: PendingApproval['phase']; error?: string }
  | { type: 'approvedOpen' }
  | { type: 'resumed'; outcome: LiveOutcome }
  | { type: 'denied' }
  | { type: 'gone'; message: string }
  | { type: 'saved'; name: string }

export function startRun(id: number, goal: string, startUrl: string, viewport: Viewport): AgentRun {
  return {
    id, status: 'running', goal: goal.trim().slice(0, 1200), startUrl, viewport, url: startUrl, prepared: [], scrollY: 0, steps: [], snapshot: null,
    visited: [], working: false, approval: null, message: '', failure: null, answer: null, openApproval: null,
  }
}

function addVisited(list: string[], url: string): string[] {
  if (!url || list[list.length - 1] === url) return list
  return [...list, url].slice(-20)
}

function withSnapshot(run: AgentRun, snap: Snapshot | null): AgentRun {
  if (!snap) return run
  return {
    ...run, snapshot: snap, url: snap.url, prepared: Array.isArray(snap.prepared) ? snap.prepared : [],
    scrollY: Number.isFinite(snap.scrollY) ? snap.scrollY : 0, visited: addVisited(run.visited, snap.url),
  }
}

function replaceLast(steps: AgentStepRecord[], result: string): AgentStepRecord[] {
  if (!steps.length) return steps
  const last = steps[steps.length - 1]
  return [...steps.slice(0, -1), { ...last, result: result.slice(0, 200) }]
}

const OUT_OF_STEPS = `Alpha used all ${MAX_STEPS} steps without finishing. Here is where it got to. You can take over from here.`
export const STOPPED_WORDS = 'Stopped. A step that was already running may have finished.'

export function agentReduce(run: AgentRun, e: AgentEvent): AgentRun {
  if (e.type === 'start') return startRun(e.id, e.goal, e.startUrl, e.viewport)
  switch (e.type) {
    case 'asking':
      return { ...run, working: true, message: '', failure: null }
    case 'retry':
      return run.status === 'failed' ? { ...run, status: 'running', working: false, message: '', failure: null } : run
    case 'stop':
      if (run.status === 'done' || run.status === 'stopped') return run
      return { ...run, status: 'stopped', working: false, approval: null, message: run.working ? STOPPED_WORDS : 'Stopped.' }
    case 'failed':
      if (run.status === 'stopped') return run
      return { ...run, status: 'failed', working: false, message: e.failure.message, failure: { setup: e.failure.setup, code: e.failure.code } }
    case 'approvalPhase':
      return run.approval ? { ...run, working: e.phase === 'deciding' || e.phase === 'sending', approval: { ...run.approval, phase: e.phase, error: e.error ?? '' } } : run
    case 'approvedOpen':
      if (!run.approval) return run
      return {
        ...run, status: 'running', working: false, steps: replaceLast(run.steps, 'Approved by you'),
        openApproval: { id: run.approval.approvalId, url: run.approval.details.url }, approval: null,
      }
    case 'gone':
      return { ...run, status: 'failed', working: false, approval: null, steps: replaceLast(run.steps, 'The request ran out of time'), message: e.message, failure: { setup: false, code: 'gone' } }
    case 'denied':
      return { ...run, status: 'stopped', working: false, approval: null, steps: replaceLast(run.steps, 'You said no'), message: 'You said no, so Alpha stopped. Nothing was sent.' }
    case 'saved':
      return { ...run, status: 'running', working: false, approval: null, steps: replaceLast(run.steps, `Approved. Saved ${e.name} to your device`) }
    case 'resumed': {
      const o = e.outcome
      if (o.status === 'ok') {
        const base = withSnapshot({ ...run, status: 'running', working: false, approval: null, steps: replaceLast(run.steps, `Approved by you. ${o.did || 'Done'}`) }, o.snapshot)
        return base
      }
      if (o.status === 'approval') {
        return {
          ...withSnapshot(run, o.snapshot), status: 'approval', working: false,
          approval: { details: o.approval, approvalId: o.approvalId, action: run.approval?.action ?? null, phase: 'asking', error: '', actor: 'ai' },
        }
      }
      if (o.status === 'handoff') {
        return { ...withSnapshot(run, o.snapshot), status: 'needs_you', working: false, approval: null, message: o.message, steps: replaceLast(run.steps, 'Needs you') }
      }
      if (o.status === 'refused') {
        return { ...withSnapshot(run, o.snapshot), status: 'running', working: false, approval: null, steps: replaceLast(run.steps, o.message) }
      }
      return { ...run, status: 'failed', working: false, approval: null, message: o.message, failure: { setup: o.code === 'needs_update', code: o.code } }
    }
    case 'result': {
      if (run.status === 'stopped') return run
      const r = e.result
      if (r.status === 'error') {
        return { ...run, status: 'failed', working: false, message: r.message, failure: { setup: /database update|one-time setup/i.test(r.message), code: '' } }
      }
      const steps = [...run.steps, r.step]
      const base: AgentRun = { ...run, steps, working: false, openApproval: null, failure: null, message: '' }
      switch (r.status) {
        case 'continue': {
          let next = withSnapshot(base, r.snapshot)
          if (r.navigateTo) next = { ...next, url: r.navigateTo, prepared: [], scrollY: 0, visited: addVisited(next.visited, r.navigateTo) }
          if (steps.length >= MAX_STEPS) return { ...next, status: 'stopped', message: OUT_OF_STEPS }
          return { ...next, status: 'running' }
        }
        case 'done': {
          const next = withSnapshot(base, r.snapshot)
          return {
            ...next, status: 'done',
            answer: { text: r.answer, evidence: r.evidence, verified: r.verified, sourceUrl: r.snapshot?.url || next.url, sourceTitle: r.snapshot?.title || '' },
          }
        }
        case 'needs_approval': {
          const next = withSnapshot(base, r.snapshot)
          return {
            ...next, status: 'approval',
            approval: { details: r.approval, approvalId: r.approvalId, action: r.resume.kind === 'live' ? r.resume.action : null, phase: 'asking', error: '', actor: 'ai' },
          }
        }
        case 'needs_user': {
          const next = withSnapshot(base, r.snapshot)
          return { ...next, status: 'needs_you', message: r.message }
        }
      }
    }
  }
}

/** Is the run ready for the next step to be asked for? */
export function canAskNext(run: AgentRun): boolean {
  return run.status === 'running' && !run.working && run.steps.length < MAX_STEPS
}

export interface AgentBody {
  goal: string
  url: string
  prepared: PreparedStep[]
  scrollY: number
  viewport: Viewport
  steps: AgentStepRecord[]
  openApproval?: { id: string; url: string }
}

export function agentBody(run: AgentRun): AgentBody {
  const body: AgentBody = {
    goal: run.goal, url: run.url, prepared: run.prepared.slice(-30), scrollY: Math.max(0, Math.round(run.scrollY || 0)), viewport: run.viewport,
    steps: run.steps.slice(-40).map(s => ({ n: s.n, did: String(s.did || '').slice(0, 200), result: String(s.result || '').slice(0, 200) })),
  }
  if (run.openApproval) body.openApproval = run.openApproval
  return body
}

export function runStatus(run: AgentRun): { lamp: Lamp; word: string } {
  switch (run.status) {
    case 'running': return { lamp: 'blue', word: run.working ? `Alpha is working on step ${Math.min(MAX_STEPS, run.steps.length + 1)} of ${MAX_STEPS}` : 'Alpha is working' }
    case 'approval': return { lamp: 'amber', word: 'Waiting for your OK' }
    case 'needs_you': return { lamp: 'red', word: 'Alpha needs you' }
    case 'done': return { lamp: 'green', word: 'Done' }
    case 'stopped': return { lamp: 'off', word: 'Stopped' }
    case 'failed': return { lamp: 'red', word: 'Could not continue' }
  }
}

export function isActive(run: AgentRun | null): boolean {
  return !!run && (run.status === 'running' || run.status === 'approval' || run.status === 'needs_you')
}

/* ---------- where Alpha starts ---------- */

export interface StartChoice { key: string; label: string; url: string }

export function searchStartUrl(goal: string): string {
  return `https://html.duckduckgo.com/html/?q=${encodeURIComponent(goal.replace(/\s+/g, ' ').trim().slice(0, 200))}`
}

/** The places Alpha can start from: the page you are on, a web search, or one of the shop's quick sites. */
export function startChoices(current: { url: string; label: string } | null, quick: Array<{ title: string; url: string }>): StartChoice[] {
  const list: StartChoice[] = []
  if (current && /^https?:\/\//i.test(current.url)) list.push({ key: 'here', label: `This page: ${current.label}`, url: current.url })
  list.push({ key: 'web', label: 'Search the web', url: '' })
  quick.slice(0, 12).forEach((q, i) => { if (/^https?:\/\//i.test(q.url)) list.push({ key: `quick-${i}`, label: q.title, url: q.url }) })
  return list
}

export function startUrlFor(choice: StartChoice, goal: string): string {
  return choice.url || searchStartUrl(goal)
}

/** Every address Alpha used, each once, as host names for a short "Sources" line. */
export function sourceList(run: AgentRun): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const u of run.visited) {
    if (!u || seen.has(u)) continue
    seen.add(u)
    out.push(u)
  }
  return out
}
