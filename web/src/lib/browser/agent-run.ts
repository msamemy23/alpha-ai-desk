/**
 * One step of the browsing assistant: open the page, let the model choose one action, check it, do it, report.
 *
 * Nothing is kept between steps on the server. The screen sends the goal, the page it is on, what is filled in and the
 * short history with every step, and shows the result. Stopping is the screen no longer asking for the next step.
 *
 * Server only. The model, the page engine and the approvals are passed in so the whole loop can be tested with a
 * scripted model and a fake website.
 */
import { runLive } from './engine.ts'
import type { AuthorizeInput, AuthorizeResult, EngineDeps, Snapshot } from './engine.ts'
import { AGENT_MAX_STEPS, buildMessages, describeAction, evidenceHolds, numbersSupported, openNeedsApproval, parseAgentAction, vetAgentAction } from './agent.ts'
import type { AgentAction, AgentControl, AgentStepRecord, AgentView } from './agent.ts'
import { canonicalAction, describeApproval } from './actions.ts'
import type { ApprovalDetails, LiveAction, PreparedStep } from './actions.ts'
import { displayHost, parseTarget } from './url.ts'

export interface AgentStepRequest {
  goal: string
  url: string
  prepared: PreparedStep[]
  scrollY: number
  viewport: 'phone' | 'desktop'
  steps: AgentStepRecord[]
  /** An 'open a new site' approval the person gave, for the address it was given for. */
  openApproval?: { id: string; url: string }
}

export type AgentStepResult =
  | { status: 'continue'; step: AgentStepRecord; snapshot: Snapshot | null; navigateTo?: string }
  | { status: 'done'; answer: string; evidence: string; verified: boolean; step: AgentStepRecord; snapshot: Snapshot }
  | { status: 'needs_approval'; step: AgentStepRecord; snapshot: Snapshot | null; approval: ApprovalDetails; approvalId: string; resume: { kind: 'live'; action: LiveAction } | { kind: 'open'; url: string } }
  | { status: 'needs_user'; message: string; step: AgentStepRecord; snapshot: Snapshot | null }
  | { status: 'error'; message: string; step?: AgentStepRecord }

export interface AgentDeps {
  engine: EngineDeps
  /** Sends the messages to the model and returns what it said, or null if it could not answer. */
  askModel: (messages: Array<{ role: 'system' | 'user'; content: string }>) => Promise<string | null>
  /** Is this address one the shop already trusts (a quick site or an allow rule)? */
  isTrusted: (url: string) => boolean
  /** The shop's rule for opening an address as the assistant. Returns a reason to refuse, or null. */
  checkOpen: (url: string) => string | null
  authorize: (input: AuthorizeInput) => Promise<AuthorizeResult>
}

function viewOf(snap: Snapshot): AgentView {
  const controls: AgentControl[] = snap.controls.map(c => ({
    n: c.n, kind: c.kind, label: c.label, risk: c.risk, value: c.value, inView: c.inView, href: c.href, sensitive: c.sensitive, options: c.options, checked: c.checked,
  }))
  return { url: snap.url, host: snap.host, title: snap.title, text: snap.text, controls, injection: snap.injection, signInRequired: snap.signInRequired, scrollY: snap.scrollY, scrollHeight: snap.scrollHeight }
}

function openCanonical(url: string): string {
  return canonicalAction({ kind: 'open_site', url, fp: '', method: 'get', actionUrl: url, fields: [] })
}

type Decision =
  | { t: 'none' }
  | { t: 'act'; action: LiveAction; did: string }
  | { t: 'finish'; action: Extract<AgentAction, { kind: 'finish' }>; snap: Snapshot }
  | { t: 'ask'; message: string; did: string }
  | { t: 'refuse'; message: string; did: string }
  | { t: 'open'; url: string; did: string }
  | { t: 'model_failed' }

export async function runAgentStep(req: AgentStepRequest, deps: AgentDeps): Promise<AgentStepResult> {
  const n = req.steps.length + 1
  const goal = String(req.goal || '').slice(0, 1200)
  if (!goal.trim()) return { status: 'error', message: 'Tell Alpha what to look up.' }
  const recent = req.steps.slice(-4).map(s => s.did)

  // The person approved opening a new site for the assistant: go there. Nothing else happens in this step.
  if (req.openApproval) {
    const target = parseTarget(req.openApproval.url)
    if (!target.ok) return { status: 'error', message: target.message }
    const url = target.url.toString()
    const refusal = deps.checkOpen(url)
    if (refusal) return { status: 'error', message: refusal }
    let granted = false
    try { granted = (await deps.authorize({ kind: 'open_site', canonical: openCanonical(url), details: describeApproval('open_site', { host: displayHost(url), url, label: displayHost(url), why: '', fields: [] }), approvalId: req.openApproval.id })).granted } catch { granted = false }
    if (!granted) return { status: 'error', message: 'That approval is no longer valid. Ask Alpha to try again.' }
    return { status: 'continue', step: { n, did: `Opened ${displayHost(url)}`, result: 'Approved by you' }, snapshot: null, navigateTo: url }
  }

  const state: { decision: Decision } = { decision: { t: 'none' } }
  let modelNote: string | undefined

  const decide = async (snap: Snapshot): Promise<LiveAction | null> => {
    const view = viewOf(snap)
    const messages = buildMessages({ goal, steps: req.steps, view, stepsLeft: Math.max(0, AGENT_MAX_STEPS - req.steps.length), notice: modelNote })
    let action: AgentAction | null = null
    for (let attempt = 0; attempt < 2 && !action; attempt++) {
      const said = await deps.askModel(attempt === 0 ? messages : [...messages, { role: 'user', content: 'That was not one valid JSON object. Reply with only one JSON object from the list.' }])
      if (said === null) { state.decision = { t: 'model_failed' }; return null }
      action = parseAgentAction(said)
    }
    if (!action) { state.decision = { t: 'refuse', message: 'Alpha did not give a usable answer, so it did nothing this step.', did: 'Thought about it' }; return null }
    const did = describeAction(action, view)

    if (action.kind === 'finish') { state.decision = { t: 'finish', action, snap }; return null }
    if (action.kind === 'ask_user') { state.decision = { t: 'ask', message: action.message, did }; return null }

    const vetted = vetAgentAction(action, {
      goal, view, stepsTaken: req.steps.length, recent,
      refFor: nn => snap.controls.find(c => c.n === nn)?.ref ?? null,
    })
    if (!vetted.ok) { state.decision = vetted.stop === 'ask_user' ? { t: 'ask', message: vetted.message, did } : { t: 'refuse', message: vetted.message, did }; return null }
    if (vetted.open) { state.decision = { t: 'open', url: vetted.open, did: vetted.describe }; return null }
    if (!vetted.live) { state.decision = { t: 'none' }; return null }
    state.decision = { t: 'act', action: vetted.live, did: vetted.describe }
    return vetted.live
  }

  const outcome = await runLive(
    { url: req.url, prepared: req.prepared, scrollY: req.scrollY, viewport: req.viewport, actor: 'ai' },
    { ...deps.engine, decide },
  )

  const decision: Decision = state.decision
  if (outcome.status === 'error') {
    return { status: 'error', message: outcome.message, step: { n, did: 'Opened the page', result: outcome.message } }
  }
  const snapshot = outcome.status === 'ok' || outcome.status === 'approval' || outcome.status === 'handoff' || outcome.status === 'refused' ? outcome.snapshot : null

  switch (decision.t) {
    case 'model_failed':
      return { status: 'needs_user', message: 'Alpha could not reach its AI just now. Check the AI key in Settings, or try again in a moment.', step: { n, did: 'Tried to think', result: 'The AI did not answer' }, snapshot: snapshot }
    case 'finish': {
      const { action, snap } = decision
      const supported = evidenceHolds(action.evidence, snap.text) && numbersSupported(action.answer, action.evidence)
      return { status: 'done', answer: action.answer, evidence: action.evidence, verified: supported, step: { n, did: 'Finished', result: supported ? 'Answer matches the page' : 'Could not match the answer to the page' }, snapshot: snapshot || snap }
    }
    case 'ask':
      return { status: 'needs_user', message: decision.message, step: { n, did: decision.did, result: 'Needs you' }, snapshot: snapshot }
    case 'refuse':
      return { status: 'continue', step: { n, did: decision.did, result: decision.message }, snapshot: snapshot }
    case 'open': {
      const target = parseTarget(decision.url)
      if (!target.ok) return { status: 'continue', step: { n, did: decision.did, result: target.message }, snapshot: snapshot }
      const url = target.url.toString()
      const refusal = deps.checkOpen(url)
      if (refusal) return { status: 'continue', step: { n, did: decision.did, result: refusal }, snapshot: snapshot }
      const view = snapshot ? viewOf(snapshot) : null
      const needs = view ? openNeedsApproval(url, goal, view, deps.isTrusted) : true
      if (!needs) return { status: 'continue', step: { n, did: decision.did, result: 'Opened' }, snapshot: snapshot, navigateTo: url }
      const details = describeApproval('open_site', { host: displayHost(url), url, label: displayHost(url), why: 'Alpha typed this address itself instead of following a link on the page.', fields: [] })
      let asked: AuthorizeResult
      try { asked = await deps.authorize({ kind: 'open_site', canonical: openCanonical(url), details }) } catch { return { status: 'error', message: 'Approvals need a database update before Alpha can open a new site.' } }
      if (asked.granted) return { status: 'error', message: 'That approval was not asked for.' }
      return { status: 'needs_approval', step: { n, did: decision.did, result: 'Waiting for your OK' }, snapshot: snapshot, approval: details, approvalId: asked.approvalId, resume: { kind: 'open', url } }
    }
    case 'act': {
      if (outcome.status === 'approval') {
        return { status: 'needs_approval', step: { n, did: decision.did, result: 'Waiting for your OK' }, snapshot, approval: outcome.approval, approvalId: outcome.approvalId, resume: { kind: 'live', action: decision.action } }
      }
      if (outcome.status === 'handoff') return { status: 'needs_user', message: outcome.message, step: { n, did: decision.did, result: 'Needs you' }, snapshot }
      if (outcome.status === 'refused') return { status: 'continue', step: { n, did: decision.did, result: outcome.message }, snapshot }
      const notes = outcome.status === 'ok' && outcome.snapshot.notes.length ? ` ${outcome.snapshot.notes[0]}` : ''
      return { status: 'continue', step: { n, did: decision.did, result: `${outcome.status === 'ok' ? outcome.did || 'Done' : 'Done'}.${notes}`.trim() }, snapshot }
    }
    default:
      return { status: 'continue', step: { n, did: 'Looked at the page', result: 'Nothing to do' }, snapshot: snapshot }
  }
}
