'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { answerApproval } from './approval-flow'
import { runAgentStep, runLive } from './api'
import { agentBody, agentReduce, canAskNext } from './agent-state'
import type { AgentEvent, AgentRun } from './agent-state'
import { FLOW_DEPS, pickViewport } from './useBrowserTabs'
import { liveBody, initialLive } from './live'
import type { LiveState } from './live'
import { describeFailure } from './failure'

export interface AgentActions {
  /** Start a lookup. The run is global to the screen: one at a time. */
  start: (goal: string, startUrl: string) => void
  /** Stop asking for steps. A step already running on the server may still finish. */
  stop: () => void
  retry: () => void
  answer: (decision: 'approved' | 'denied') => void
  /** Forget the run (only once it is over). */
  clear: () => void
  /** The live page state a person can continue from. */
  liveState: () => LiveState | null
}

export interface AgentApi extends AgentActions {
  run: AgentRun | null
}

/**
 * One "Ask Alpha to look this up" run, step by step. Each step asks the server for ONE action, shows what happened, and
 * only then asks for the next. Stop is the screen no longer asking (and cancelling the step in flight). Anything that needs
 * a person stops the loop until the person answers.
 */
export function useAgentRun(): AgentApi {
  const [run, setRun] = useState<AgentRun | null>(null)
  const ref = useRef<AgentRun | null>(null)
  const mounted = useRef(true)
  const ctl = useRef<AbortController | null>(null)
  const looping = useRef(false)
  const seq = useRef(0)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      ctl.current?.abort()
    }
  }, [])

  const apply = useCallback((e: AgentEvent): AgentRun | null => {
    if (!ref.current && e.type !== 'start') return null
    const next = agentReduce(ref.current as AgentRun, e)
    ref.current = next
    if (mounted.current) setRun(next)
    return next
  }, [])

  const loop = useCallback(async (runId: number): Promise<void> => {
    if (looping.current) return
    looping.current = true
    try {
      while (mounted.current && ref.current && ref.current.id === runId && canAskNext(ref.current)) {
        apply({ type: 'asking' })
        const c = new AbortController()
        ctl.current = c
        const r = await runAgentStep(agentBody(ref.current as AgentRun), c.signal)
        if (ctl.current === c) ctl.current = null
        if (c.signal.aborted || !mounted.current || ref.current?.id !== runId) return
        if (!r.ok) {
          if (!r.aborted) apply({ type: 'failed', failure: r.failure })
          return
        }
        apply({ type: 'result', result: r.data })
      }
    } catch {
      if (mounted.current && ref.current?.id === runId) apply({ type: 'failed', failure: describeFailure({ status: 500 }) })
    } finally {
      looping.current = false
    }
  }, [apply])

  const actions = useMemo<AgentActions>(() => ({
    start: (goal, startUrl) => {
      if (ref.current && (ref.current.status === 'running' || ref.current.status === 'approval' || ref.current.status === 'needs_you')) return
      ctl.current?.abort()
      looping.current = false
      const id = ++seq.current
      apply({ type: 'start', id, goal, startUrl, viewport: pickViewport() })
      void loop(id)
    },
    stop: () => {
      ctl.current?.abort()
      ctl.current = null
      looping.current = false
      apply({ type: 'stop' })
    },
    retry: () => {
      const cur = ref.current
      if (!cur) return
      apply({ type: 'retry' })
      looping.current = false
      void loop(cur.id)
    },
    clear: () => {
      ctl.current?.abort()
      ctl.current = null
      looping.current = false
      ref.current = null
      if (mounted.current) setRun(null)
    },
    liveState: () => {
      const cur = ref.current
      if (!cur) return null
      return { ...initialLive(cur.url, cur.viewport), snapshot: cur.snapshot, prepared: cur.prepared, scrollY: cur.scrollY, busy: !cur.snapshot }
    },
    answer: decision => {
      const cur = ref.current
      const p = cur?.approval
      if (!cur || !p) return
      const runId = cur.id
      void answerApproval(p, decision, FLOW_DEPS, {
        setPhase: (phase, error) => { apply({ type: 'approvalPhase', phase, error }) },
        denied: () => { apply({ type: 'denied' }) },
        gone: message => { apply({ type: 'gone', message }) },
        openApproved: () => {
          apply({ type: 'approvedOpen' })
          looping.current = false
          void loop(runId)
        },
        saved: name => {
          apply({ type: 'saved', name })
          looping.current = false
          void loop(runId)
        },
        fileProblem: message => { apply({ type: 'gone', message }) },
        // Approved: do the one action Alpha asked about, with the approval, then carry on.
        resend: async pending => {
          const now = ref.current
          if (!now || now.id !== runId) return
          const asLive = { ...initialLive(now.url, now.viewport), snapshot: now.snapshot, prepared: now.prepared, scrollY: now.scrollY }
          const c = new AbortController()
          ctl.current = c
          const r = await runLive(liveBody(asLive, { action: pending.action ?? undefined, approvalId: pending.approvalId, actor: 'ai' }), c.signal)
          if (ctl.current === c) ctl.current = null
          if (c.signal.aborted || !mounted.current || ref.current?.id !== runId) return
          if (!r.ok) {
            if (!r.aborted) apply({ type: 'approvalPhase', phase: 'retry', error: r.failure.message })
            return
          }
          apply({ type: 'resumed', outcome: r.data })
          looping.current = false
          void loop(runId)
        },
      })
    },
  }), [apply, loop])

  return { run, ...actions }
}
