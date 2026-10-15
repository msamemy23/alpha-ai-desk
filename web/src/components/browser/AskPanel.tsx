'use client'
import { useId, useMemo, useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { ErrorCard } from '@/components/ListKit'
import { addressText, safeLink } from './address'
import { MAX_STEPS, isActive, runStatus, sourceList, startChoices, startUrlFor } from './agent-state'
import type { AgentRun } from './agent-state'
import ApprovalCard from './ApprovalCard'
import { UNVERIFIED_WORDS, answerCopyText, answerPrefill } from './found'
import type { LiveState } from './live'
import { ROLE_WORDS } from './live'
import { OutsideLink, StatusLine } from './parts'
import type { AgentApi } from './useAgentRun'

export interface AskPanelProps {
  agent: AgentApi
  /** The master switch for Alpha. Reading, searching and Live view do not depend on it. */
  aiEnabled: boolean
  canAct: boolean
  canManage: boolean
  /** Whether the shop has an AI key saved (the lookup needs one). Null while that is not known yet. */
  aiReady: boolean | null
  /** The page open in the current tab, offered as a place to start. */
  current: { url: string; label: string } | null
  quick: Array<{ title: string; url: string }>
  initialGoal?: string
  onOpenSettings: () => void
  onOpenAiSettings: () => void
  onOpenPage: (url: string) => void
  onTakeOver: (live: LiveState, title: string) => void
  onCopy: (text: string, what: string) => void
  onAskAlpha: (text: string) => void
}

const GOAL_MAX = 1200

function answerFor(run: AgentRun): { goal: string; text: string; evidence: string; verified: boolean; sourceUrl: string; sourceTitle: string } | null {
  return run.answer ? { goal: run.goal, ...run.answer } : null
}

/**
 * Ask Alpha to look something up. Alpha works one small step at a time, up to 12, and every step is listed here. Stop is
 * always on screen while it works. Anything that sends, buys, agrees or saves a file stops at an approval card first.
 */
export default function AskPanel(p: AskPanelProps) {
  const { agent } = p
  const run = agent.run
  const id = useId()
  const [goal, setGoal] = useState(p.initialGoal || '')
  const [choiceKey, setChoiceKey] = useState('')
  const { current, quick } = p
  const choices = useMemo(() => startChoices(current, quick), [current, quick])
  const choice = choices.find(c => c.key === choiceKey) || choices[0]
  const active = isActive(run)
  const canStart = p.aiEnabled && p.canAct && goal.trim().length > 0 && !active

  const takeOver = () => {
    const live = agent.liveState()
    if (!live) return
    const title = run?.snapshot?.title || ''
    if (active) agent.stop()
    p.onTakeOver(live, title)
  }

  return (
    <section aria-label="Ask Alpha to look this up" className="space-y-3">
      {!p.aiEnabled && (
        <Notice kind="info">
          <p>Alpha lookups are switched off for your shop. Reading pages, searching and Live view still work.</p>
          {p.canManage && <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={p.onOpenSettings}>Open browser settings</button>}
        </Notice>
      )}
      {p.aiEnabled && !p.canAct && <Notice kind="info">{ROLE_WORDS}</Notice>}
      {p.aiEnabled && p.canAct && p.aiReady === false && (
        <Notice kind="warn">
          <p>Alpha needs an AI key before it can look things up. Add one in Settings, then come back. Reading pages, searching and Live view do not need it.</p>
          <button type="button" className="btn btn-secondary btn-sm mt-2" onClick={p.onOpenAiSettings}>Open Settings</button>
        </Notice>
      )}

      {(!run || !active) && !run?.answer && (
        <form
          className="card space-y-3"
          onSubmit={e => {
            e.preventDefault()
            if (!canStart || !choice) return
            agent.start(goal, startUrlFor(choice, goal))
          }}
        >
          <div>
            <label className="form-label" htmlFor={`${id}-goal`}>What should Alpha look up?</label>
            <textarea
              id={`${id}-goal`}
              className="form-textarea"
              rows={3}
              maxLength={GOAL_MAX}
              value={goal}
              onChange={e => setGoal(e.target.value)}
              placeholder="For example: find the part number for front brake pads on a 2016 Honda Civic"
              disabled={!p.aiEnabled || !p.canAct}
            />
          </div>
          <div>
            <label className="form-label" htmlFor={`${id}-start`}>Start from</label>
            <select id={`${id}-start`} className="form-select" value={choice?.key || ''} onChange={e => setChoiceKey(e.target.value)} disabled={!p.aiEnabled || !p.canAct}>
              {choices.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </div>
          <p className="form-hint">Alpha takes up to {MAX_STEPS} steps, one at a time, and you can stop it at any time. Anything that sends, buys or saves a file asks you first.</p>
          <button type="submit" className="btn btn-primary w-full sm:w-auto" disabled={!canStart}>
            <Icon name="alpha" className="h-5 w-5" />Ask Alpha to look this up
          </button>
        </form>
      )}

      {run && (
        <RunView
          run={run}
          agent={agent}
          onTakeOver={takeOver}
          onOpenPage={p.onOpenPage}
          onCopy={p.onCopy}
          onAskAlpha={p.onAskAlpha}
        />
      )}
    </section>
  )
}

function RunView({
  run, agent, onTakeOver, onOpenPage, onCopy, onAskAlpha,
}: {
  run: AgentRun
  agent: AgentApi
  onTakeOver: () => void
  onOpenPage: (url: string) => void
  onCopy: (text: string, what: string) => void
  onAskAlpha: (text: string) => void
}) {
  const status = runStatus(run)
  const active = isActive(run)
  const answer = answerFor(run)
  const sources = sourceList(run)
  const canTakeOver = !!run.snapshot || /^https?:\/\//i.test(run.url)
  // While Alpha works, the picture of what it sees stays open so the person can watch. They can fold it away.
  const [seeing, setSeeing] = useState(true)

  return (
    <div className="space-y-3">
      <div className="card space-y-3">
        <p className="break-words text-[0.9375rem]"><span className="font-bold">You asked:</span> {run.goal}</p>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div role="status" aria-live="polite"><StatusLine lamp={status.lamp}>{status.word}</StatusLine></div>
          {active && (
            <button type="button" className="btn btn-danger btn-sm" onClick={agent.stop}>
              <Icon name="pause" className="h-4 w-4" />Stop
            </button>
          )}
        </div>

        {run.steps.length > 0 || run.working ? (
          <ol className="space-y-2" aria-label="What Alpha has done">
            {run.steps.map(s => (
              <li key={s.n} className="rounded-md border border-border px-3 py-2">
                <p className="break-words font-bold"><span className="num">{s.n}.</span> {s.did || 'Took a step'}</p>
                {s.result && <p className="mt-0.5 break-words text-[0.9375rem] text-text-secondary">{s.result}</p>}
              </li>
            ))}
            {run.working && (
              <li className="rounded-md border border-dashed border-[rgb(var(--c-line))] px-3 py-2 text-text-secondary" aria-hidden="true">
                <span className="num">{run.steps.length + 1}.</span> Working on this step…
              </li>
            )}
          </ol>
        ) : null}

        {run.snapshot?.image && (
          <details open={seeing} onToggle={e => setSeeing(e.currentTarget.open)}>
            <summary className="flex min-h-[44px] cursor-pointer items-center font-bold text-blue">{seeing ? 'Hide what Alpha sees' : 'Show what Alpha sees'}</summary>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={run.snapshot.image} alt={`What Alpha sees: ${run.snapshot.title || addressText(run.snapshot.url)}`} className="mt-2 block h-auto w-full rounded-md border border-border" decoding="async" />
            <p className="mt-1 break-all text-[0.875rem] text-text-secondary">{addressText(run.snapshot.url)}</p>
          </details>
        )}
      </div>

      {run.approval && (
        <ApprovalCard pending={run.approval} onApprove={() => agent.answer('approved')} onDeny={() => agent.answer('denied')} />
      )}

      {run.status === 'needs_you' && (
        <Notice kind="warn">
          <p className="font-bold">Alpha needs you</p>
          <p className="mt-1 break-words">{run.message}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {canTakeOver && <button type="button" className="btn btn-primary btn-sm" onClick={onTakeOver}>Take over</button>}
            <OutsideLink url={run.url} />
          </div>
        </Notice>
      )}

      {run.status === 'failed' && (
        <ErrorCard
          title="Alpha could not continue"
          message={run.message || 'That did not work. Try again in a moment.'}
          onRetry={() => agent.retry()}
        />
      )}

      {run.status === 'stopped' && (
        <Notice kind="info">{run.message || 'Stopped.'}</Notice>
      )}

      {answer && (
        <section className="card space-y-3" aria-label="What Alpha found">
          <StatusLine lamp="green">Alpha found this</StatusLine>
          <p className="whitespace-pre-wrap break-words text-base leading-relaxed">{answer.text || 'Alpha did not write an answer.'}</p>
          {answer.evidence && (
            <div>
              <p className="text-[0.8125rem] font-bold text-text-secondary">What the page says</p>
              <blockquote className="mt-1 break-words border-l-4 border-[rgb(var(--c-line))] pl-3 text-[0.9375rem]">{answer.evidence}</blockquote>
            </div>
          )}
          {answer.verified
            ? <StatusLine lamp="green" className="text-[0.9375rem]">The words Alpha quoted are on the page</StatusLine>
            : <Notice kind="warn">{UNVERIFIED_WORDS}</Notice>}
          <div>
            <p className="text-[0.8125rem] font-bold text-text-secondary">Sources</p>
            <ul className="mt-1 space-y-1">
              {(sources.length ? sources : [answer.sourceUrl]).filter(Boolean).map(u => {
                const link = safeLink(u)
                if (!link || link.kind !== 'web') return null
                return (
                  <li key={u} className="min-w-0">
                    <a
                      href={link.url}
                      rel="nofollow noopener noreferrer"
                      className="inline-flex min-h-[44px] items-center break-all text-blue underline sm:min-h-0"
                      onClick={e => { if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) { e.preventDefault(); onOpenPage(link.url) } }}
                    >
                      {addressText(link.url)}
                    </a>
                  </li>
                )
              })}
            </ul>
          </div>
        </section>
      )}

      {!active && (
        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {answer && (
            <>
              <button type="button" className="btn btn-secondary" onClick={() => onCopy(answerCopyText(answer), 'The answer')}>
                <Icon name="copy" className="h-5 w-5" />Copy
              </button>
              <button type="button" className="btn btn-secondary" onClick={() => onAskAlpha(answerPrefill(answer))}>
                <Icon name="alpha" className="h-5 w-5" />Ask Alpha about this
              </button>
            </>
          )}
          {canTakeOver && <button type="button" className="btn btn-secondary" onClick={onTakeOver}>Take over</button>}
          {answer && <button type="button" className="btn btn-ghost" onClick={agent.clear}>Ask something else</button>}
        </div>
      )}
    </div>
  )
}

