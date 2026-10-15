'use client'
import { useState } from 'react'
import Icon from '@/components/Icon'
import { EmptyBlock, ErrorCard } from '@/components/ListKit'
import Notice from '@/components/Notice'
import { agoWords, messageStatus, plural, whenWords } from './model'
import type { Card, HistoryRow, RunRow } from './model'
import type { HistoryState } from './useAutomationData'

interface Props {
  cards: Card[]
  timezone: string
  filter: { automation: string; status: string }
  onFilter: (next: { automation: string; status: string }) => void
  history: HistoryState & { reload: () => Promise<void>; more: () => Promise<void> }
}

const STATUS_CHOICES: Array<[string, string]> = [['', 'Everything'], ['sent', 'Sent'], ['queued', 'Waiting to send'], ['skipped', 'Left out'], ['failed', 'Did not send'], ['cancelled', 'Cancelled'], ['unknown', 'Not confirmed']]

/** Every message an automation handled: who, what was said, when, and what happened. */
export default function HistoryPanel({ cards, timezone, filter, onFilter, history }: Props) {
  const [open, setOpen] = useState<string | null>(null)
  const engineCards = cards.filter(c => c.kind === 'engine')
  const empty = history.state === 'ready' && history.messages.length === 0

  return (
    <div>
      <div className="mb-4 grid gap-3 sm:grid-cols-2 sm:max-w-xl">
        <div>
          <label htmlFor="hist-auto" className="form-label">Automation</label>
          <select id="hist-auto" className="form-select" value={filter.automation} onChange={e => onFilter({ ...filter, automation: e.target.value })}>
            <option value="">All automations</option>
            {engineCards.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="hist-status" className="form-label">What happened</label>
          <select id="hist-status" className="form-select" value={filter.status} onChange={e => onFilter({ ...filter, status: e.target.value })}>
            {STATUS_CHOICES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </div>
      </div>

      {history.state === 'loading' ? (
        <div className="space-y-2" role="status" aria-busy="true" aria-label="Loading the history">{[0, 1, 2, 3, 4].map(i => <div key={i} className="skeleton h-16" />)}</div>
      ) : history.state === 'error' && history.messages.length === 0 ? (
        <ErrorCard title="The history did not load" message={history.error || 'Check your connection and try again.'} onRetry={() => void history.reload()} />
      ) : !history.available ? (
        <Notice kind="info">The message history needs a database update before it can be shown. Ask your developer to apply it. Automations keep working in the meantime.</Notice>
      ) : empty ? (
        <EmptyBlock icon="list" title={filter.automation || filter.status ? 'Nothing matches that' : 'Nothing has been sent yet'}>
          {filter.automation || filter.status ? 'Try a different automation or status.' : 'When an automation texts or emails a customer, it is written down here with what happened.'}
        </EmptyBlock>
      ) : (
        <>
          {history.state === 'error' && <Notice kind="error" className="mb-3">The list could not be refreshed. {history.error}</Notice>}
          <ul className="ledger" aria-label="Messages">
            {history.messages.map(m => <Row key={m.id} m={m} timezone={timezone} open={open === m.id} onToggle={() => setOpen(open === m.id ? null : m.id)} />)}
          </ul>
          {history.next && (
            <button type="button" className="btn btn-secondary mt-3" onClick={() => void history.more()} disabled={history.loadingMore} aria-busy={history.loadingMore}>
              {history.loadingMore ? 'Loading…' : 'Show older messages'}
            </button>
          )}
        </>
      )}

      {history.runs.length > 0 && (
        <section className="mt-8" aria-labelledby="runs-h">
          <h2 id="runs-h" className="section-title mb-1">Recent runs</h2>
          <p className="mb-3 text-[0.9375rem] text-text-secondary">Each time an automation looked for people to message.</p>
          <ul className="ledger">{history.runs.map(r => <RunLine key={r.id} r={r} timezone={timezone} />)}</ul>
        </section>
      )}
    </div>
  )
}

function Row({ m, timezone, open, onToggle }: { m: HistoryRow; timezone: string; open: boolean; onToggle: () => void }) {
  const st = messageStatus(m)
  const when = m.sent_at || m.send_after || m.created_at
  return (
    <li>
      <button type="button" className="ledger-row w-full text-left" onClick={onToggle} aria-expanded={open}>
        <span className="ledger-main">
          <span className="ledger-title block break-words">{m.name || 'Customer'}{m.is_test ? ' (test)' : ''}</span>
          <span className="ledger-sub block break-words">{m.automation} · {m.channel === 'email' ? 'Email' : 'Text'}{m.to ? ` to ${m.to}` : ''}</span>
          <span className="mt-1 flex items-center gap-2 text-[0.9375rem]"><span className={`lamp lamp-${st.lamp}`} aria-hidden="true" /><span className="font-bold">{st.word}</span>{m.reason ? <span className="text-text-secondary">· {m.reason}</span> : null}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[0.8125rem] text-text-secondary">
          <span title={when ? whenWords(when, timezone) : ''}>{agoWords(when)}</span>
          <Icon name={open ? 'chevronDown' : 'chevronRight'} className="h-4 w-4" />
        </span>
      </button>
      {open && (
        <div className="space-y-2 border-t border-border bg-bg-hover px-4 py-3 text-[0.9375rem]">
          {m.subject && <p className="break-words"><span className="font-bold">Subject: </span>{m.subject}</p>}
          {m.body ? <p className="whitespace-pre-wrap break-words rounded-md border border-border bg-bg-card px-3 py-2">{m.body}</p> : <p className="text-text-secondary">No message was written for this person.</p>}
          {m.why && <p className="text-text-secondary">Why: {m.why}</p>}
          {m.status === 'queued' && m.send_after && <p className="text-text-secondary">{m.held ? 'Held for quiet hours. ' : ''}Goes out {whenWords(m.send_after, timezone)}.</p>}
          {m.sent_at && <p className="text-text-secondary">Sent {whenWords(m.sent_at, timezone)}.</p>}
          {m.attempts > 1 && <p className="text-text-secondary">{plural(m.attempts, 'attempt')} so far.</p>}
          {m.error && m.status !== 'sent' && <Notice kind="error"><span className="font-bold">What went wrong: </span>{m.error}</Notice>}
        </div>
      )}
    </li>
  )
}

function RunLine({ r, timezone }: { r: RunRow; timezone: string }) {
  const ok = r.status === 'succeeded'
  const bad = r.status === 'failed'
  const lamp = ok ? 'green' : bad ? 'red' : r.status === 'running' ? 'blue' : 'amber'
  const word = ok ? 'Worked' : bad ? 'Failed' : r.status === 'running' ? 'Running' : 'Not confirmed'
  return (
    <li>
      <div className="ledger-row">
        <span className="ledger-main">
          <span className="ledger-title block">{r.automation}{r.manual ? ' (run by you)' : ''}</span>
          <span className="ledger-sub block break-words">{r.message || (r.sent !== null ? `${r.sent} sent, ${r.skipped ?? 0} left out, ${r.failed ?? 0} failed.` : 'No details were recorded.')}</span>
          <span className="mt-1 flex items-center gap-2"><span className={`lamp lamp-${lamp}`} aria-hidden="true" /><span className="font-bold">{word}</span></span>
        </span>
        <span className="shrink-0 text-[0.8125rem] text-text-secondary" title={whenWords(r.started_at, timezone)}>{agoWords(r.started_at)}</span>
      </div>
    </li>
  )
}
