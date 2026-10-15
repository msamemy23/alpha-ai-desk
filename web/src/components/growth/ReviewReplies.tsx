'use client'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import { EmptyBlock, ErrorCard, RowsSkeleton } from '@/components/ListKit'
import Notice from '@/components/Notice'
import Sheet from '@/components/Sheet'
import { Segmented } from '@/components/ScreenParts'
import { call, load } from '@/components/automations/api'
import { agoWords } from '@/components/automations/model'
import { Section } from './parts'

type Status = 'draft' | 'approved' | 'posted' | 'dismissed'
export interface ReplyView {
  id: string
  reviewer_name: string
  rating: number
  review_text: string
  reply: string
  drafted_by: 'ai' | 'owner'
  status: Status
  status_words: string
  flags: Array<{ code: string; words: string }>
  approved_at: string | null
  posted_at: string | null
  created_at: string
}

const LAMP: Record<Status, string> = { draft: 'amber', approved: 'blue', posted: 'green', dismissed: 'off' }
const WORD: Record<Status, string> = { draft: 'Needs your approval', approved: 'Approved, not posted yet', posted: 'Posted on Google', dismissed: 'Set aside' }
const stars = (n: number): string => `${n} ${n === 1 ? 'star' : 'stars'}`

interface Props {
  notify: (message: string, kind?: 'success' | 'error' | 'info') => void
}

/**
 * Write a reply to a Google review. The owner pastes the review, Alpha drafts a reply, the owner edits and approves it,
 * then copies it into Google themselves. Nothing is ever posted automatically.
 */
export default function ReviewReplies({ notify }: Props) {
  const [replies, setReplies] = useState<ReplyView[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [error, setError] = useState('')
  const [needsDb, setNeedsDb] = useState(false)
  const [canEdit, setCanEdit] = useState(true)
  const [open, setOpen] = useState<{ kind: 'new' } | { kind: 'view'; id: string } | null>(null)

  const reload = useCallback(async () => {
    const r = await load('/api/growth/review-replies', d => ({ replies: (Array.isArray(d.replies) ? d.replies : []) as ReplyView[], needs: d.needs_database_update === true, canEdit: d.can_edit !== false }))
    if (r.ok) { setReplies(r.value.replies); setNeedsDb(r.value.needs); setCanEdit(r.value.canEdit); setState('ready'); setError('') }
    else { setError(r.error); setState(s => (s === 'ready' ? 'ready' : 'error')) }
  }, [])
  useEffect(() => { void reload() }, [reload])

  const current = open?.kind === 'view' ? replies.find(r => r.id === open.id) || null : null
  const upsert = (r: ReplyView) => setReplies(list => (list.some(x => x.id === r.id) ? list.map(x => (x.id === r.id ? r : x)) : [r, ...list]))

  return (
    <Section
      title="Reply to reviews"
      hint="Paste a Google review and Alpha writes a reply for you to edit. You approve it, then paste it into Google yourself. Nothing is ever posted for you."
      action={canEdit && !needsDb ? <button type="button" className="btn btn-primary" onClick={() => setOpen({ kind: 'new' })}><Icon name="plus" className="h-5 w-5" />Reply to a review</button> : undefined}
    >
      {needsDb ? (
        <Notice kind="info">Saving review replies needs a database update. Ask your developer to apply it. Everything else on this page keeps working.</Notice>
      ) : state === 'loading' ? <RowsSkeleton rows={3} label="Loading review replies" />
        : state === 'error' ? <ErrorCard title="Review replies did not load" message={error || 'Check your connection and try again.'} onRetry={() => { setState('loading'); void reload() }} />
        : replies.length === 0 ? (
          <EmptyBlock icon="star" title="No review replies yet" action={canEdit ? <button type="button" className="btn btn-primary" onClick={() => setOpen({ kind: 'new' })}><Icon name="plus" className="h-5 w-5" />Reply to a review</button> : undefined}>
            Copy a review from Google, paste it here, and get a polite reply to edit. Replying to every review, good or bad, helps new customers trust you.
          </EmptyBlock>
        ) : (
          <ul className="ledger" aria-label="Review replies">
            {replies.map(r => (
              <li key={r.id}>
                <button type="button" className="ledger-row w-full text-left" onClick={() => setOpen({ kind: 'view', id: r.id })} aria-label={`${r.reviewer_name || 'A customer'}, ${stars(r.rating)}. ${WORD[r.status]}`}>
                  <span className={`lamp lamp-${LAMP[r.status]}`} aria-hidden="true" />
                  <span className="ledger-main">
                    <span className="ledger-title block">{r.reviewer_name || 'A customer'} · {stars(r.rating)}</span>
                    <span className="ledger-sub block">{WORD[r.status]} · {agoWords(r.created_at)}</span>
                    <span className="ledger-sub block truncate">{r.review_text || 'No written review, only stars.'}</span>
                  </span>
                  <Icon name="chevronRight" className="h-5 w-5 shrink-0 text-text-muted" />
                </button>
              </li>
            ))}
          </ul>
        )}

      {open?.kind === 'new' && <NewReview onClose={() => setOpen(null)} onCreated={r => { upsert(r); setOpen({ kind: 'view', id: r.id }) }} notify={notify} />}
      {current && <ReplySheet key={current.id} reply={current} canEdit={canEdit} onClose={() => setOpen(null)} onChanged={r => { upsert(r) }} notify={notify} />}
    </Section>
  )
}

function NewReview({ onClose, onCreated, notify }: { onClose: () => void; onCreated: (r: ReplyView) => void; notify: Props['notify'] }) {
  const base = useId()
  const [rating, setRating] = useState('5')
  const [who, setWho] = useState('')
  const [text, setText] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const dirty = Boolean(who.trim() || text.trim())

  const submit = async () => {
    if (busy.current) return
    busy.current = true; setWorking(true); setError('')
    const r = await call('/api/growth/review-replies', { action: 'draft', rating: Number(rating), reviewer_name: who, review_text: text })
    busy.current = false; setWorking(false)
    if (!r.ok) { setError(r.error); return }
    notify(r.data.ai_used === false ? 'A reply was written from a standard template. Add the details that fit this customer.' : 'A reply is ready for you to read.', 'success')
    onCreated(r.data.reply as ReplyView)
  }

  return (
    <Sheet open onClose={() => { if (!working) onClose() }} title="Reply to a review" wide dirty={dirty}>
      <form onSubmit={e => { e.preventDefault(); void submit() }} className="space-y-4 text-[0.9375rem]" noValidate>
        <div>
          <p id={`${base}-stars`} className="form-label">Stars the customer gave</p>
          <div className="max-w-sm"><Segmented label="Stars the customer gave" idPrefix={`${base}-rating`} columns="grid-cols-5" options={['1', '2', '3', '4', '5'].map(k => ({ key: k, label: k }))} value={rating} onChange={setRating} /></div>
        </div>
        <div>
          <label htmlFor={`${base}-who`} className="form-label">Customer name (optional)</label>
          <input id={`${base}-who`} className="form-input" value={who} maxLength={200} onChange={e => setWho(e.target.value)} placeholder="As it shows on Google" autoComplete="off" />
        </div>
        <div>
          <label htmlFor={`${base}-text`} className="form-label">What the review says</label>
          <textarea id={`${base}-text`} className="form-textarea" rows={6} value={text} maxLength={5000} onChange={e => setText(e.target.value)} placeholder="Paste the review here. Leave it empty if they only left stars." />
          <p className="form-hint">The reply only uses what the review and your shop details say. It will not offer discounts or make promises for you.</p>
        </div>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose} disabled={working}>Cancel</button>
          <button type="submit" className="btn btn-primary" disabled={working} aria-busy={working}><Icon name="pen" className="h-5 w-5" />{working ? 'Writing…' : 'Write a reply'}</button>
        </div>
      </form>
    </Sheet>
  )
}

function ReplySheet({ reply, canEdit, onClose, onChanged, notify }: { reply: ReplyView; canEdit: boolean; onClose: () => void; onChanged: (r: ReplyView) => void; notify: Props['notify'] }) {
  const base = useId()
  const [text, setText] = useState(reply.reply)
  const [working, setWorking] = useState<'' | 'save' | 'approve' | 'posted' | 'dismiss' | 'redraft'>('')
  const [error, setError] = useState('')
  const [confirm, setConfirm] = useState<'' | 'dismiss' | 'redraft'>('')
  const busy = useRef(false)
  const editable = canEdit && (reply.status === 'draft' || reply.status === 'approved')
  const changed = text.trim() !== reply.reply.trim()

  const act = async (action: 'save' | 'approve' | 'posted' | 'dismiss' | 'redraft', extra: Record<string, unknown> = {}): Promise<ReplyView | null> => {
    const r = await call('/api/growth/review-replies', { action, id: reply.id, ...extra })
    if (!r.ok) { setError(r.error); return null }
    const next = r.data.reply as ReplyView
    onChanged(next)
    return next
  }

  const run = async (action: 'save' | 'approve' | 'posted' | 'dismiss' | 'redraft', done: string) => {
    if (busy.current) return
    busy.current = true; setWorking(action); setError(''); setConfirm('')
    try {
      // An approval always covers exactly the words on screen.
      if (action === 'approve' && changed) { if (!(await act('save', { text }))) return }
      const next = await act(action, action === 'save' ? { text } : {})
      if (!next) return
      setText(next.reply)
      notify(done, 'success')
      if (action === 'dismiss' || action === 'posted') onClose()
    } finally { busy.current = false; setWorking('') }
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(text.trim()); notify('Reply copied. Paste it into your Google reply box.', 'success') }
    catch { notify('The reply could not be copied. Select the text and copy it by hand.', 'error') }
  }

  return (
    <Sheet open onClose={() => { if (!working) onClose() }} title={`${reply.reviewer_name || 'A customer'}, ${stars(reply.rating)}`} wide dirty={editable && changed}>
      <div className="space-y-4 text-[0.9375rem]">
        <p className="flex items-center gap-2 font-bold"><span className={`lamp lamp-${LAMP[reply.status]}`} aria-hidden="true" />{WORD[reply.status]}</p>

        <section aria-label="The review">
          <h3 className="section-title mb-2">The review</h3>
          <p className="whitespace-pre-wrap break-words rounded-md border border-border bg-bg-hover px-3 py-2.5">{reply.review_text || 'No written review, only stars.'}</p>
        </section>

        {reply.flags.map(f => <Notice key={f.code} kind="warn">{f.words}</Notice>)}

        <div>
          <label htmlFor={`${base}-reply`} className="form-label">Your reply{reply.drafted_by === 'ai' ? ' (drafted by Alpha, edit it freely)' : ''}</label>
          <textarea id={`${base}-reply`} className="form-textarea" rows={7} value={text} maxLength={2000} readOnly={!editable} onChange={e => { setText(e.target.value); setError('') }} />
          <p className="form-hint">
            <span className="num">{[...text].length}</span> characters.
            {reply.status === 'approved' && editable ? ' Editing an approved reply puts it back to needs approval.' : ''}
            {reply.status === 'draft' ? ' It is not approved until you approve it.' : ''}
          </p>
        </div>

        {error && <Notice kind="error">{error}</Notice>}

        {confirm ? (
          <div className="rounded-md border border-border bg-bg-hover p-3" role="alertdialog" aria-label={confirm === 'dismiss' ? 'Confirm setting this aside' : 'Confirm writing a new draft'}>
            <p className="font-bold">{confirm === 'dismiss' ? 'Set this review aside?' : 'Write a new draft?'}</p>
            <p className="mt-1 text-text-secondary">{confirm === 'dismiss' ? 'It stays in your list but you will not be asked to reply to it.' : 'Your edits to this reply are replaced with a fresh draft.'}</p>
            <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="btn btn-secondary" onClick={() => setConfirm('')}>Go back</button>
              <button type="button" className="btn btn-primary" onClick={() => void run(confirm === 'dismiss' ? 'dismiss' : 'redraft', confirm === 'dismiss' ? 'Set aside.' : 'A new draft is ready.')}>{confirm === 'dismiss' ? 'Yes, set it aside' : 'Yes, write a new one'}</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={working !== ''}>Close</button>
            {editable && reply.status === 'draft' && <button type="button" className="btn btn-secondary" onClick={() => (changed ? setConfirm('redraft') : void run('redraft', 'A new draft is ready.'))} disabled={working !== ''} aria-busy={working === 'redraft'}><Icon name="refresh" className="h-5 w-5" />{working === 'redraft' ? 'Writing…' : 'Write a new draft'}</button>}
            {editable && <button type="button" className="btn btn-secondary" onClick={() => setConfirm('dismiss')} disabled={working !== ''}>Set aside</button>}
            {(reply.status === 'approved' || reply.status === 'posted') && !changed && <button type="button" className="btn btn-secondary" onClick={() => void copy()}><Icon name="copy" className="h-5 w-5" />Copy reply</button>}
            {editable && changed && reply.status === 'draft' && <button type="button" className="btn btn-secondary" onClick={() => void run('save', 'Saved. It still needs your approval.')} disabled={working !== ''} aria-busy={working === 'save'}>{working === 'save' ? 'Saving…' : 'Save changes'}</button>}
            {editable && (reply.status === 'draft' || changed) && <button type="button" className="btn btn-primary" onClick={() => void run('approve', 'Approved. Copy it and paste it into Google.')} disabled={working !== '' || !text.trim()} aria-busy={working === 'approve'}><Icon name="check" className="h-5 w-5" />{working === 'approve' ? 'Approving…' : 'Approve reply'}</button>}
            {editable && reply.status === 'approved' && !changed && <button type="button" className="btn btn-primary" onClick={() => void run('posted', 'Marked as posted.')} disabled={working !== ''} aria-busy={working === 'posted'}><Icon name="check" className="h-5 w-5" />{working === 'posted' ? 'Saving…' : 'I posted it on Google'}</button>}
          </div>
        )}
        {reply.status === 'approved' && <p className="form-hint">Alpha cannot post to Google for you. Copy the reply, paste it under the review in your Google Business Profile, then tap I posted it on Google.</p>}
      </div>
    </Sheet>
  )
}
