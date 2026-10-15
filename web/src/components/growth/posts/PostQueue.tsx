'use client'
import Icon from '@/components/Icon'
import { EmptyBlock } from '@/components/ListKit'
import { agoWords } from '@/components/automations/model'
import { PLATFORM_LABEL } from '@/lib/posts-rules'
import type { PostMode } from '@/lib/posts-rules'
import type { QueueItemView } from '@/lib/posts-api-types'

interface Props {
  waiting: QueueItemView[]
  log: QueueItemView[]
  mode: PostMode
  canEdit: boolean
  running: boolean
  onOpen: (id: string) => void
  onPickShop: () => void
  onRun: () => void
}

const places = (i: QueueItemView): string => (i.platforms.length ? i.platforms.map(p => PLATFORM_LABEL[p]).join(', ') : 'No place chosen')

function Row({ item, log, onOpen }: { item: QueueItemView; log: boolean; onOpen: (id: string) => void }) {
  const thumb = item.photo_urls.find(Boolean) || ''
  const when = agoWords(item.posted_at || item.updated_at || item.created_at)
  return (
    <li>
      <button type="button" className="ledger-row w-full text-left" onClick={() => onOpen(item.id)}>
        <span className={`lamp shrink-0 lamp-${item.state_lamp}`} aria-hidden="true" />
        {thumb
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={thumb} alt="" loading="lazy" decoding="async" className="h-12 w-12 shrink-0 rounded object-cover" />
          : <span className="grid h-12 w-12 shrink-0 place-items-center rounded bg-bg-hover text-text-muted" aria-hidden="true"><Icon name="image" className="h-5 w-5" /></span>}
        <span className="ledger-main">
          <span className="ledger-title block">{item.title}</span>
          <span className="ledger-sub block">{item.state_word} · {when}</span>
          <span className="ledger-sub block">{log && item.results_view.length > 0 ? item.results_view.map(r => r.word).join(' · ') : `${places(item)} · ${item.made_by_words}`}</span>
        </span>
        <Icon name="chevronRight" className="h-5 w-5 shrink-0 text-text-muted" />
      </button>
    </li>
  )
}

/** What waits for the owner, then the log of everything that went out or was set aside. */
export default function PostQueue({ waiting, log, mode, canEdit, running, onOpen, onPickShop, onRun }: Props) {
  return (
    <>
      <section aria-label="Waiting for you">
        <div className="mb-1.5 flex flex-wrap items-end justify-between gap-2">
          <h3 className="section-title">Waiting for you{waiting.length > 0 ? ` (${waiting.length})` : ''}</h3>
          {canEdit && mode !== 'off' && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={onRun} disabled={running} aria-busy={running}><Icon name="refresh" className="h-4 w-4" />{running ? 'Looking…' : 'Look for jobs to post now'}</button>
          )}
        </div>
        {waiting.length === 0 ? (
          <EmptyBlock icon="image" title="Nothing is waiting" action={canEdit ? <button type="button" className="btn btn-primary" onClick={onPickShop}><Icon name="image" className="h-5 w-5" />Pick shop photos</button> : undefined}>
            {mode === 'off'
              ? 'Posts are off, so Alpha prepares nothing by itself. Make one yourself from a finished job, or turn on Suggest and Alpha will prepare them.'
              : 'Alpha looks at finished jobs where the customer said yes and prepares posts here for you to check. You can also make one yourself.'}
            {canEdit && ' Photos saved on this phone work too: use Post photos from this device above.'}
          </EmptyBlock>
        ) : (
          <ul className="ledger" aria-label="Posts waiting for you">{waiting.map(i => <Row key={i.id} item={i} log={false} onOpen={onOpen} />)}</ul>
        )}
      </section>

      <section aria-label="Log of posts" className="mt-6">
        <h3 className="section-title mb-1.5">Log of posts</h3>
        {log.length === 0 ? (
          <p className="rounded-md border border-border px-3 py-3 text-text-secondary">Nothing has been posted or set aside yet. Every post, and who or what sent it, is recorded here.</p>
        ) : (
          <>
            <ul className="ledger" aria-label="Posts that went out or were set aside">{log.map(i => <Row key={i.id} item={i} log onOpen={onOpen} />)}</ul>
            <p className="form-hint">Open a post to see who sent it and whether it can be taken back. Posts that went out cannot be undone from Alpha.</p>
          </>
        )}
      </section>
    </>
  )
}
