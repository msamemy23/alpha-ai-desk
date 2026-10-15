'use client'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import { Fact, OnOff, Status } from './parts'
import { agoWords, cardStatus, iconFor, plural, scheduleWords, whenWords } from './model'
import type { Card, Rules } from './model'

interface Props {
  card: Card
  rules: Pick<Rules, 'master_enabled'>
  timezone: string
  busy: boolean
  running: boolean
  onToggle: (next: boolean) => void
  onPreview: () => void
  onEdit: () => void
  onRun: () => void
}

const channelWords = (card: Card): string => {
  if (card.kind === 'legacy') return 'Nothing is sent to customers. It saves drafts for you to read.'
  return card.channel === 'email' ? 'Email' : 'Text message'
}

export default function AutomationCard({ card, rules, timezone, busy, running, onToggle, onPreview, onEdit, onRun }: Props) {
  const s = card.state
  const status = cardStatus(card, rules)
  const engine = card.kind === 'engine'
  const next = s.enabled && rules.master_enabled && card.next_run ? whenWords(card.next_run, timezone) : null
  return (
    <article className="card h-full" aria-labelledby={`auto-${card.id}`}>
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-bg-hover text-text-secondary">
          <Icon name={iconFor(card.icon)} className="h-5 w-5" />
        </span>
        <h3 id={`auto-${card.id}`} className="min-w-0 flex-1 font-bold leading-tight">{card.name}</h3>
        <OnOff enabled={s.enabled} name={`${card.name} on or paused`} onChange={onToggle} disabled={busy || running} />
      </div>
      <p className="mt-2 text-[0.9375rem] text-text-secondary">{card.blurb}</p>

      <div className="mt-3 space-y-1 text-[0.9375rem]">
        <Fact icon="bolt">{card.trigger}</Fact>
        <Fact icon="clock">{scheduleWords(card.schedule)}{next ? `. Next check ${next}` : ''}</Fact>
        <Fact icon={card.channel === 'email' ? 'mail' : 'phone'}>{channelWords(card)}</Fact>
        {engine && (card.waiting > 0 || card.sent_30d > 0) && (
          <Fact icon="send">
            {card.waiting > 0 && <>{plural(card.waiting, 'message')} waiting to go out{card.next_send ? `, the first ${whenWords(card.next_send, timezone)}` : ''}. </>}
            {card.sent_30d > 0 && <>{plural(card.sent_30d, 'message')} sent in the last 30 days.</>}
          </Fact>
        )}
        <Status lamp={status.lamp}><span className="font-bold">{status.word}</span>{status.detail ? `. ${status.detail}` : ''}</Status>
        {s.last_run && s.enabled && s.last_status !== 'never' && <p className="pl-5 text-text-secondary">Last run {agoWords(s.last_run)}.{s.run_count > 0 ? ` ${plural(s.run_count, 'run')} so far.` : ''}</p>}
      </div>

      {card.setup && !s.enabled && (
        <Notice kind="info" className="mt-3"><span className="font-bold">Before you switch it on: </span>{card.setup}</Notice>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" className="btn btn-secondary" onClick={onPreview} aria-label={`${engine ? 'Preview' : 'What it does'}: ${card.name}`}>
          <Icon name="eye" className="h-5 w-5" />
          {engine ? 'Preview' : 'What it does'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onEdit} aria-label={`Settings: ${card.name}`}>
          <Icon name="settings" className="h-5 w-5" />
          Settings
        </button>
        <button type="button" className="btn btn-ghost" onClick={onRun} disabled={running || busy || !rules.master_enabled} aria-label={`Run now: ${card.name}`}>
          <Icon name="play" className="h-4 w-4" />
          {running ? 'Running…' : 'Run now'}
        </button>
      </div>
    </article>
  )
}
