'use client'
import { useId, useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { EmptyBlock, ErrorCard } from '@/components/ListKit'
import type { LiveAction } from '../../lib/browser/actions'
import type { SnapControl, Snapshot } from '../../lib/browser/engine'
import { addressText, safeLink } from './address'
import ApprovalCard from './ApprovalCard'
import BlockedNotice from './BlockedNotice'
import {
  clickAction, controlTitle, fillAction, groupControls, handoffText, hitBox, kindWord, liveStatus, planTap, pressAction, riskWord, ROLE_WORDS,
  scrollAction, selectAction, vetTyped,
} from './live'
import type { LiveState } from './live'
import { OutsideLink, PageSkeleton, StatusLine } from './parts'
import type { SettingsPayload } from './settings'

export interface LivePanelProps {
  live: LiveState
  canAct: boolean
  canManage: boolean
  payload: SettingsPayload | null
  onOpenSettings: () => void
  onTap: (action: LiveAction) => void
  onSelect: (n: number | null) => void
  onRefresh: () => void
  onAnswer: (decision: 'approved' | 'denied') => void
  onDismiss: () => void
}

const BOX: Record<SnapControl['risk'], string> = {
  safe: 'border-blue/70',
  approve: 'border-amber',
  handoff: 'border-red',
}

function ControlPanel({
  control, snap, canAct, locked, onTap, onClose,
}: { control: SnapControl; snap: Snapshot; canAct: boolean; locked: boolean; onTap: (a: LiveAction) => void; onClose: () => void }) {
  const id = useId()
  const plan = planTap(control, canAct)
  const risk = riskWord(control)
  const options = control.options
  const [typed, setTyped] = useState(control.sensitive ? '' : control.value)
  const [chosen, setChosen] = useState(options.includes(control.value) ? control.value : options[0] ?? '')
  const problem = plan.mode === 'type' ? vetTyped(typed) : null
  const link = control.kind === 'link' ? safeLink(control.href) : null

  return (
    <section className="card space-y-3" aria-label={`Selected: ${controlTitle(control)}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="section-title break-words">{controlTitle(control)}</h3>
          <p className="mt-0.5 text-[0.875rem] text-text-secondary">{kindWord(control.kind)}</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={onClose}>Close</button>
      </div>
      <StatusLine lamp={risk.lamp}>{risk.word}</StatusLine>
      {control.value && !control.sensitive && <p className="break-words text-[0.9375rem]"><span className="font-bold">Now:</span> {control.value}</p>}

      {!plan.enabled && (
        <>
          <p className="break-words text-[0.9375rem] text-text-secondary">{plan.reason}</p>
          {control.risk === 'handoff' && <OutsideLink url={snap.url} />}
        </>
      )}

      {plan.enabled && plan.asks && (
        <p className="text-[0.9375rem] text-text-secondary">Alpha will show you exactly what this does and wait for your OK before anything is sent.</p>
      )}

      {plan.enabled && (plan.mode === 'open' || plan.mode === 'press' || plan.mode === 'tick') && (
        <>
          {plan.mode === 'open' && link && link.kind === 'web' && <p className="break-all text-[0.875rem] text-text-secondary">Goes to {addressText(link.url)}</p>}
          <button type="button" className="btn btn-primary w-full sm:w-auto" disabled={locked} onClick={() => onTap(clickAction(control))}>{plan.word}</button>
        </>
      )}

      {plan.enabled && plan.mode === 'type' && (
        <div>
          <label className="form-label" htmlFor={`${id}-value`}>What to type</label>
          {control.kind === 'textarea' ? (
            <textarea id={`${id}-value`} className="form-textarea" rows={3} value={typed} autoComplete="off" onChange={e => setTyped(e.target.value)} aria-invalid={problem ? true : undefined} aria-describedby={problem ? `${id}-problem` : undefined} />
          ) : (
            <input
              id={`${id}-value`}
              type="text"
              className="form-input"
              value={typed}
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              inputMode={control.kind === 'tel' ? 'tel' : control.kind === 'number' ? 'decimal' : control.kind === 'email' ? 'email' : 'text'}
              onChange={e => setTyped(e.target.value)}
              aria-invalid={problem ? true : undefined}
              aria-describedby={problem ? `${id}-problem` : undefined}
            />
          )}
          {problem && <p id={`${id}-problem`} className="form-error" role="alert">{problem}</p>}
          <p className="form-hint">Never type passwords, card numbers or security codes here. Do those on the website yourself.</p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <button type="button" className="btn btn-primary w-full sm:w-auto" disabled={locked || !!problem} onClick={() => onTap(fillAction(control, typed))}>{plan.word}</button>
            <button type="button" className="btn btn-secondary w-full sm:w-auto" disabled={locked} onClick={() => onTap(pressAction(control))}>Press Enter in this box</button>
          </div>
        </div>
      )}

      {plan.enabled && plan.mode === 'choose' && (
        options.length === 0 ? (
          <p className="text-[0.9375rem] text-text-secondary">No choices were found in this list.</p>
        ) : (
          <div>
            <label className="form-label" htmlFor={`${id}-choice`}>Choose one</label>
            <select id={`${id}-choice`} className="form-select" value={chosen} onChange={e => setChosen(e.target.value)}>
              {options.map((o, i) => <option key={`${o}-${i}`} value={o}>{o}</option>)}
            </select>
            <button type="button" className="btn btn-primary mt-3 w-full sm:w-auto" disabled={locked || !chosen} onClick={() => onTap(selectAction(control, chosen))}>{plan.word}</button>
          </div>
        )
      )}
    </section>
  )
}

function ControlRow({ c, on, onPick }: { c: SnapControl; on: boolean; onPick: () => void }) {
  const risk = riskWord(c)
  return (
    <li>
      <button type="button" className={`ledger-row ${on ? 'bg-blue/10' : ''}`} aria-pressed={on} onClick={onPick}>
        <span className="num w-7 shrink-0 text-right font-bold text-text-secondary" aria-hidden="true">{c.n}</span>
        <span className="ledger-main">
          <span className="ledger-title block">{controlTitle(c)}</span>
          <span className="ledger-sub flex items-center gap-1.5">
            <span className={`lamp lamp-${risk.lamp}`} aria-hidden="true" />
            <span className="truncate">{kindWord(c.kind)}{c.value && !c.sensitive ? `: ${c.value}` : ''} · {risk.word}</span>
          </span>
        </span>
        {on && <Icon name="check" className="h-5 w-5 shrink-0 text-blue" strokeWidth={2.4} />}
      </button>
    </li>
  )
}

/**
 * Live view: a picture of the page and the things on it you can use. One tap does one thing. Anything that sends, buys,
 * agrees or saves a file stops at an approval card first, and sign-ins, codes and card numbers are always yours to do.
 */
export default function LivePanel(p: LivePanelProps) {
  const { live, canAct } = p
  const snap = live.snapshot
  const status = liveStatus(live)

  if (!snap) {
    if (live.error) {
      return live.error.blocked
        ? <BlockedNotice url={live.url} message={live.error.message} payload={p.payload} canManage={p.canManage} onOpenSettings={p.onOpenSettings} />
        : <ErrorCard title="The page could not be shown" message={live.error.message} onRetry={p.onRefresh} />
    }
    return (
      <div className="space-y-3">
        <StatusLine lamp={status.lamp}>{status.word}</StatusLine>
        <PageSkeleton label="Opening the page in Live view" />
      </div>
    )
  }

  const locked = live.busy || !!live.approval
  const { shown, below } = groupControls(snap)
  const selected = live.selected !== null ? snap.controls.find(c => c.n === live.selected) ?? null : null
  const handoff = handoffText(live)
  const vh = snap.viewport.h
  const atTop = snap.scrollY <= 0
  const atBottom = snap.scrollHeight > 0 && vh > 0 && snap.scrollY + vh >= snap.scrollHeight - 2

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1" role="status" aria-live="polite">
        <StatusLine lamp={status.lamp}>{status.word}</StatusLine>
        {!live.approval && !live.busy && <span className="text-[0.875rem] text-text-secondary">One tap does one thing on the page.</span>}
      </div>

      {!canAct && <Notice kind="info">{ROLE_WORDS}</Notice>}

      {live.approval && (
        <ApprovalCard pending={live.approval} onApprove={() => p.onAnswer('approved')} onDeny={() => p.onAnswer('denied')} />
      )}

      {handoff && (
        <Notice kind="warn">
          <p className="font-bold">{handoff.title}</p>
          <p className="mt-1 break-words">{handoff.body}</p>
          <div className="mt-2"><OutsideLink url={snap.url} /></div>
        </Notice>
      )}

      {live.notice && (
        <Notice kind={live.notice.kind}>
          <p className="break-words">{live.notice.text}</p>
          <button type="button" className="btn btn-ghost btn-sm mt-1 -ml-3" onClick={p.onDismiss}>Dismiss</button>
        </Notice>
      )}
      {live.saved && (
        <Notice kind="success">
          <p className="break-words">{live.saved}</p>
          <button type="button" className="btn btn-ghost btn-sm mt-1 -ml-3" onClick={p.onDismiss}>Dismiss</button>
        </Notice>
      )}
      {live.did && !live.notice && !live.approval && <p className="break-words text-[0.9375rem]"><StatusLine lamp="green">{live.did}</StatusLine></p>}

      {snap.injection.suspected && (
        <Notice kind="warn">This page has text that reads like instructions to an AI. Alpha treats page text as information only and does not act on it.</Notice>
      )}
      {snap.blocked.length > 0 && (
        <Notice kind="info">
          <p>Parts of this page were not loaded because of site rules.</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5 text-[0.875rem] text-text-secondary">
            {snap.blocked.slice(0, 3).map((b, i) => <li key={i} className="break-words">{b.reason || addressText(b.url)}</li>)}
          </ul>
        </Notice>
      )}

      <div className="relative overflow-hidden rounded-md border border-border bg-bg-chrome" aria-busy={live.busy}>
        {snap.image ? (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={snap.image} alt={`Picture of the page${snap.title ? `: ${snap.title}` : ''}. The list below names everything you can use.`} className="block h-auto w-full" decoding="async" />
            {shown.map(c => {
              const box = hitBox(c, snap)
              if (!box) return null
              const on = c.n === live.selected
              return (
                <button
                  key={c.n}
                  type="button"
                  tabIndex={-1}
                  aria-hidden="true"
                  disabled={live.busy}
                  onClick={() => p.onSelect(on ? null : c.n)}
                  className={`absolute rounded-sm ${on ? 'border-4 bg-blue/20' : 'border-2'} ${BOX[c.risk]}`}
                  style={{ left: `${box.left}%`, top: `${box.top}%`, width: `${box.width}%`, height: `${box.height}%` }}
                />
              )
            })}
          </>
        ) : (
          <div className="grid min-h-40 place-items-center p-6 text-center text-[0.9375rem] text-text-secondary">
            There is no picture of this page right now. Tap Look again to get one.
          </div>
        )}
        {live.busy && (
          <div className="absolute inset-0 grid place-items-center bg-bg-card/60">
            <span className="rounded-md border border-border bg-bg-card px-3 py-2 font-bold">Working…</span>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary btn-sm" disabled={locked || atTop} onClick={() => p.onTap(scrollAction(live, 'up'))}>
          <Icon name="chevronDown" className="h-4 w-4 rotate-180" />Scroll up
        </button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={locked || atBottom} onClick={() => p.onTap(scrollAction(live, 'down'))}>
          <Icon name="chevronDown" className="h-4 w-4" />Scroll down
        </button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={locked} onClick={p.onRefresh}>
          <Icon name="refresh" className="h-4 w-4" />Look again
        </button>
      </div>

      {selected && (
        <ControlPanel key={`${snap.url}-${selected.n}`} control={selected} snap={snap} canAct={canAct} locked={locked} onTap={p.onTap} onClose={() => p.onSelect(null)} />
      )}

      <section aria-label="What you can use on this page">
        <h3 className="section-title mb-1">On the page</h3>
        {snap.controls.length === 0 ? (
          <EmptyBlock icon="list" title="No buttons or boxes found" action={<button type="button" className="btn btn-primary" disabled={locked} onClick={p.onRefresh}>Look again</button>}>
            Scroll down to look further, or look again if the page was still loading.
          </EmptyBlock>
        ) : (
          <>
            <p className="mb-2 text-[0.875rem] text-text-secondary">Tap one on the picture or in this list, then choose what to do.</p>
            {shown.length > 0 && (
              <ul className="ledger" aria-label="On the screen now">
                {shown.map(c => <ControlRow key={c.n} c={c} on={c.n === live.selected} onPick={() => p.onSelect(c.n === live.selected ? null : c.n)} />)}
              </ul>
            )}
            {below.length > 0 && (
              <details className="mt-3">
                <summary className="flex min-h-[44px] cursor-pointer items-center font-bold text-blue">Further down the page ({below.length})</summary>
                <ul className="ledger" aria-label="Further down the page">
                  {below.map(c => <ControlRow key={c.n} c={c} on={c.n === live.selected} onPick={() => p.onSelect(c.n === live.selected ? null : c.n)} />)}
                </ul>
              </details>
            )}
          </>
        )}
      </section>

      {snap.text && (
        <details>
          <summary className="flex min-h-[44px] cursor-pointer items-center font-bold text-blue">Text on this page</summary>
          <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-bg-chrome p-3 text-[0.875rem] leading-snug">{snap.text}</pre>
        </details>
      )}
    </div>
  )
}
