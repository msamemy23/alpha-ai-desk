'use client'
import { useId, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import Sheet from '@/components/Sheet'
import { agoWords } from '@/components/automations/model'
import { PLATFORM_LABEL, reachable } from '@/lib/posts-rules'
import type { Connection, PostPhoto, PostPlatform } from '@/lib/posts-rules'
import type { PostAction, PostActionOk, QueueItemView } from '@/lib/posts-api-types'
import PhotoCheckSheet from './PhotoCheckSheet'
import PlacesPicker from './PlacesPicker'
import { fetchJobPhoto } from './postsApi'
import type { Done } from './postsApi'

interface Props {
  item: QueueItemView
  canEdit: boolean
  connections: Record<PostPlatform, Connection>
  act: (action: PostAction) => Promise<Done<PostActionOk>>
  onClose: () => void
  notify: (message: string, kind?: 'success' | 'error' | 'info') => void
}

type Working = '' | 'save' | 'post' | 'skip' | 'retry' | 'confirm'

const joinPlaces = (ps: readonly PostPlatform[]): string => {
  const names = ps.map(p => PLATFORM_LABEL[p])
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** One post: its photos, its words, what stops it, and every way it can go out or be set aside. Nothing is public until Post now is confirmed. */
export default function PostItemSheet({ item, canEdit, connections, act, onClose, notify }: Props) {
  const base = useId()
  const [caption, setCaption] = useState(item.caption)
  const [platforms, setPlatforms] = useState<PostPlatform[]>(item.platforms)
  const [acceptFlags, setAcceptFlags] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [working, setWorking] = useState<Working>('')
  const [error, setError] = useState('')
  const [checking, setChecking] = useState<number | null>(null)
  const busy = useRef(false)

  const waiting = item.state === 'needs_review' || item.state === 'ready'
  const editable = canEdit && waiting
  const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(x => b.includes(x))
  const changed = caption.trim() !== item.caption.trim() || !sameSet(platforms, item.platforms)

  // The server worked out what stops the post when it last saved. Words and places edited on screen are checked here until they are saved.
  const stale = ['no_caption', 'no_platform', 'too_long']
  const stops = [
    ...item.blockers.filter(b => !(changed && stale.includes(b.code))).map(b => b.words),
    ...(changed && !caption.trim() ? ['The post has no words yet.'] : []),
    ...(changed && platforms.length === 0 ? ['Choose where the post goes.'] : []),
  ]
  const goesTo = reachable(platforms, connections)
  const skippedPlaces = platforms.filter(p => !goesTo.includes(p))
  const flagsOpen = item.flags.length > 0 && !changed
  const failedOrPartly = item.state === 'failed' || item.state === 'partly_posted'
  const awaitingAnswer = item.results_view.some(r => r.can_confirm)
  const canPost = editable && stops.length === 0 && goesTo.length > 0 && (!flagsOpen || acceptFlags)

  const run = async (kind: Working, go: () => Promise<boolean>) => {
    if (busy.current) return
    busy.current = true; setWorking(kind); setError(''); setConfirming(false)
    try { await go() } finally { busy.current = false; setWorking('') }
  }

  const saveEdits = async (): Promise<boolean> => {
    if (!changed) return true
    const r = await act({ action: 'edit', id: item.id, caption, platforms })
    if (!r.ok) { setError(r.error); return false }
    return true
  }

  const save = () => run('save', async () => {
    if (!(await saveEdits())) return false
    notify('Saved. The checks ran again on your words.', 'success')
    return true
  })

  const post = () => run('post', async () => {
    // What goes out is exactly what is on the screen, so edits are saved first.
    if (!(await saveEdits())) return false
    const r = await act({ action: 'approve', id: item.id, accept_flags: acceptFlags })
    if (!r.ok) { setError(r.error); return false }
    notify(r.data.message, r.data.item?.state === 'posted' ? 'success' : 'info')
    return true
  })

  const skip = () => run('skip', async () => {
    const r = await act({ action: 'skip', id: item.id })
    if (!r.ok) { setError(r.error); return false }
    notify(r.data.message, 'success')
    onClose()
    return true
  })

  const retry = () => run('retry', async () => {
    const r = await act({ action: 'retry', id: item.id })
    if (!r.ok) { setError(r.error); return false }
    notify(r.data.message, r.data.item?.state === 'posted' ? 'success' : 'info')
    return true
  })

  const confirmOutcome = (platform: PostPlatform, outcome: 'posted' | 'not_posted') => run('confirm', async () => {
    const r = await act({ action: 'confirm_outcome', id: item.id, platform, outcome })
    if (!r.ok) { setError(r.error); return false }
    notify(r.data.message, 'success')
    return true
  })

  const removePhoto = (index: number) => run('save', async () => {
    const photos: PostPhoto[] = item.photos.filter((_, i) => i !== index)
    const r = await act({ action: 'edit', id: item.id, photos })
    if (!r.ok) { setError(r.error); return false }
    return true
  })

  const photoChecked = (index: number, saved: { path: string; covered: boolean }) => {
    setChecking(null)
    void run('save', async () => {
      const photos: PostPhoto[] = item.photos.map((p, i) => (i === index ? { ...p, path: saved.path, covered: saved.covered } : p))
      const r = await act({ action: 'edit', id: item.id, photos })
      if (!r.ok) { setError(r.error); return false }
      notify('Photo checked.', 'success')
      return true
    })
  }

  const checkingPhoto = checking === null ? null : item.photos[checking] ?? null

  return (
    <>
    <Sheet open onClose={() => { if (working === '' && checking === null) onClose() }} title={item.title} wide dirty={editable && changed}>
      <div className="space-y-4 text-[0.9375rem]">
        <div>
          <p className="flex items-center gap-2 font-bold"><span className={`lamp lamp-${item.state_lamp}`} aria-hidden="true" />{item.state_word}</p>
          <p className="mt-0.5 text-text-secondary">
            {item.made_by_words} · {agoWords(item.created_at)}
            {item.decided_by_words ? ` · ${item.decided_by_words}` : ''}
          </p>
        </div>

        {item.error && !awaitingAnswer && <Notice kind={failedOrPartly ? 'error' : 'warn'}>{item.error}</Notice>}

        {item.results_view.length > 0 && (
          <section aria-label="Where it went">
            <h3 className="section-title mb-1.5">Where it went</h3>
            <ul className="space-y-2">
              {item.results_view.map(r => (
                <li key={r.platform} className="rounded-md border border-border bg-bg-hover px-3 py-2.5">
                  <p className="flex items-start gap-2"><span className={`lamp lamp-${r.lamp} mt-1.5 shrink-0`} aria-hidden="true" /><span className="min-w-0 break-words">{r.word}</span></p>
                  {r.can_confirm && canEdit && (
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                      <button type="button" className="btn btn-secondary" disabled={working !== ''} onClick={() => void confirmOutcome(r.platform, 'posted')}>It is on {PLATFORM_LABEL[r.platform]}</button>
                      <button type="button" className="btn btn-secondary" disabled={working !== ''} onClick={() => void confirmOutcome(r.platform, 'not_posted')}>It did not post</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section aria-label="Photos">
          <h3 className="section-title mb-1.5">Photos</h3>
          {item.photos.length === 0 ? (
            <p className="text-text-secondary">This post has no photos.</p>
          ) : (
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {item.photos.map((p, i) => {
                const url = item.photo_urls[i] || ''
                const name = p.label || `Photo ${i + 1}`
                return (
                  <li key={`${p.path || p.ref || 'photo'}-${i}`} className="min-w-0">
                    <div className="aspect-square overflow-hidden rounded-md border border-border bg-bg-hover">
                      {url
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={url} alt={name} loading="lazy" decoding="async" className="h-full w-full object-cover" />
                        : <div className="grid h-full place-items-center p-2 text-center text-[0.8125rem] text-text-secondary">{p.path ? 'Preview not available' : 'Not checked yet, so no preview'}</div>}
                    </div>
                    <p className="mt-1 flex items-center gap-1.5 text-[0.8125rem] text-text-secondary">
                      <span className={`lamp ${p.path ? 'lamp-green' : 'lamp-amber'}`} aria-hidden="true" />
                      {p.path ? (p.covered ? 'Checked, plate or VIN covered' : 'Checked, nothing covered') : 'Not checked yet'}
                    </p>
                    {editable && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {!p.path && p.ref && item.job_id && <button type="button" className="btn btn-secondary btn-sm" disabled={working !== ''} onClick={() => setChecking(i)}>Check this photo</button>}
                        {item.photos.length > 1 && <button type="button" className="btn btn-ghost btn-sm" disabled={working !== ''} aria-label={`Take ${name} out of the post`} onClick={() => void removePhoto(i)}>Take out</button>}
                      </div>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <div>
          <label htmlFor={`${base}-words`} className="form-label">The words{item.made_by === 'alpha' ? ' (written by Alpha from the job, edit them freely)' : ''}</label>
          <textarea id={`${base}-words`} className="form-textarea" rows={7} value={caption} maxLength={5000} readOnly={!editable} onChange={e => { setCaption(e.target.value); setError('') }} />
          <p className="form-hint">
            <span className="num">{[...caption].length}</span> characters. Alpha never adds prices, offers, warranties or credentials. If you add one, make sure it is true.
            {editable && changed ? ' Save to run the checks on your changes.' : ''}
          </p>
        </div>

        {editable ? (
          <PlacesPicker value={platforms} onChange={setPlatforms} connections={connections} disabled={working !== ''} legend="Where it goes" />
        ) : (
          <p className="text-text-secondary">Where it goes: {item.platforms.length ? joinPlaces(item.platforms) : 'nowhere chosen'}</p>
        )}

        {flagsOpen && (
          <Notice kind="warn">
            <p className="font-bold">Alpha’s wording check found {item.flags.length === 1 ? 'something' : 'some things'} to look at</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5">{item.flags.map(f => <li key={f}>{f}</li>)}</ul>
            {editable && (
              <label className="mt-2 flex min-h-[44px] items-start gap-2.5">
                <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[rgb(var(--c-blue))]" checked={acceptFlags} onChange={e => setAcceptFlags(e.target.checked)} />
                <span>I read this and the words are true. Post it anyway.</span>
              </label>
            )}
          </Notice>
        )}

        {editable && stops.length > 0 && (
          <section aria-label="What stops this post">
            <h3 className="section-title mb-1.5">What stops this post</h3>
            <ul className="space-y-1.5">
              {stops.map(s => <li key={s} className="flex items-start gap-2"><span className="lamp lamp-amber mt-1.5 shrink-0" aria-hidden="true" />{s}</li>)}
            </ul>
          </section>
        )}

        {editable && stops.length === 0 && goesTo.length === 0 && (
          <Notice kind="warn">None of the places you chose is connected, so nothing can post. <a href="/connectors" className="font-bold text-blue">Open Connected apps</a> to connect one.</Notice>
        )}

        <p className="text-text-secondary">{item.undo.words}</p>

        {error && <Notice kind="error">{error}</Notice>}

        {confirming ? (
          <div className="rounded-md border border-border bg-bg-hover p-3" role="alertdialog" aria-label="Confirm posting">
            <p className="font-bold">Post this now?</p>
            <p className="mt-1 text-text-secondary">
              It goes public right away on {joinPlaces(goesTo)}.{skippedPlaces.length ? ` ${joinPlaces(skippedPlaces)} ${skippedPlaces.length === 1 ? 'is' : 'are'} not connected and will be skipped.` : ''} Alpha cannot take it down afterwards.
            </p>
            <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" className="btn btn-secondary" onClick={() => setConfirming(false)}>Go back</button>
              <button type="button" className="btn btn-primary" onClick={() => void post()} disabled={working !== ''} aria-busy={working === 'post'}>{working === 'post' ? 'Posting…' : 'Yes, post it'}</button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={working !== ''}>Close</button>
            {canEdit && (waiting || item.state === 'scheduled') && (
              <button type="button" className="btn btn-secondary" onClick={() => void skip()} disabled={working !== ''} aria-busy={working === 'skip'}>{working === 'skip' ? 'Working…' : item.state === 'scheduled' ? 'Cancel this post' : 'Skip this post'}</button>
            )}
            {canEdit && failedOrPartly && !awaitingAnswer && (
              <button type="button" className="btn btn-secondary" onClick={() => void retry()} disabled={working !== ''} aria-busy={working === 'retry'}><Icon name="refresh" className="h-5 w-5" />{working === 'retry' ? 'Trying…' : 'Try again'}</button>
            )}
            {editable && changed && (
              <button type="button" className="btn btn-secondary" onClick={() => void save()} disabled={working !== ''} aria-busy={working === 'save'}>{working === 'save' ? 'Saving…' : 'Save changes'}</button>
            )}
            {editable && (
              <button type="button" className="btn btn-primary" onClick={() => setConfirming(true)} disabled={working !== '' || !canPost}><Icon name="send" className="h-5 w-5" />Post now</button>
            )}
          </div>
        )}
      </div>
    </Sheet>
    {checkingPhoto && checking !== null && item.job_id && checkingPhoto.ref && (
      <PhotoCheckSheet
        key={checkingPhoto.ref}
        title="Check this photo"
        load={() => fetchJobPhoto(item.job_id as string, checkingPhoto.ref as string)}
        meta={{ jobId: item.job_id, ref: checkingPhoto.ref, label: checkingPhoto.label }}
        onSaved={saved => photoChecked(checking, saved)}
        onClose={() => setChecking(null)}
      />
    )}
    </>
  )
}
