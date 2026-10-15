'use client'
import { useId, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import Notice from '@/components/Notice'
import Sheet from '@/components/Sheet'
import { MAX_ITEM_PHOTOS, POST_PLATFORMS, reachable } from '@/lib/posts-rules'
import type { PostPhoto, PostPlatform } from '@/lib/posts-rules'
import type { PostAction, PostActionOk, PostOverview, QueueItemView } from '@/lib/posts-api-types'
import PhotoCheckSheet from './PhotoCheckSheet'
import PlacesPicker from './PlacesPicker'
import type { Done } from './postsApi'

interface Props {
  overview: PostOverview
  act: (action: PostAction) => Promise<Done<PostActionOk>>
  onClose: () => void
  onMade: (item: QueueItemView) => void
  notify: (message: string, kind?: 'success' | 'error' | 'info') => void
}

interface SavedPhoto { name: string; path: string; url: string; covered: boolean }

/**
 * A post from photos on this phone or computer. Each photo is redrawn in the browser (which drops location and camera details),
 * checked by the owner, and saved. The words are the owner's own: Alpha cannot see the photo, so it writes nothing about it.
 */
export default function DevicePostSheet({ overview, act, onClose, onMade, notify }: Props) {
  const base = useId()
  const input = useRef<HTMLInputElement>(null)
  const busy = useRef(false)
  const [todo, setTodo] = useState<File[]>([])
  const [total, setTotal] = useState(0)
  const [done, setDone] = useState<SavedPhoto[]>([])
  const [caption, setCaption] = useState('')
  const [chosen, setChosen] = useState<PostPlatform[] | null>(null)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  const places = chosen ?? (overview.settings.platforms.length ? overview.settings.platforms : reachable(POST_PLATFORMS, overview.connections))
  const room = MAX_ITEM_PHOTOS - done.length - todo.length

  const pick = (files: FileList | null) => {
    const list = Array.from(files ?? []).filter(f => !f.type || f.type.startsWith('image/')).slice(0, Math.max(0, room))
    if (input.current) input.current.value = ''
    if (list.length === 0) { setError(files && files.length > 0 ? 'Choose photos only. Pictures are JPG, PNG or WebP.' : ''); return }
    setError('')
    setTotal(todo.length === 0 ? list.length : total + list.length)
    setTodo(t => [...t, ...list])
  }

  const nextFile = () => setTodo(t => t.slice(1))
  const current = todo[0] ?? null
  const position = total - todo.length + 1

  const make = async () => {
    if (busy.current) return
    busy.current = true; setWorking(true); setError('')
    try {
      const photos: PostPhoto[] = done.map((d, i) => ({ ref: null, path: d.path, covered: d.covered, label: `Photo ${i + 1}` }))
      const r = await act({ action: 'create', job_id: null, photos, caption, platforms: places })
      if (!r.ok) { setError(r.error); return }
      if (r.data.item) { notify('Your post is ready. Look it over, then post it.', 'success'); onMade(r.data.item) }
    } finally { busy.current = false; setWorking(false) }
  }

  const canMake = overview.can_edit && done.length > 0 && todo.length === 0 && caption.trim().length > 0 && places.length > 0

  return (
    <>
      <Sheet open onClose={() => { if (!current && !working) onClose() }} title="Post photos from this device" wide dirty={done.length > 0 || caption.trim().length > 0}>
        <div className="space-y-4 text-[0.9375rem]">
          <Notice kind="info">
            Choose photos saved on this phone or computer. Each one is redrawn here, which removes its location and camera details, and you check it before it can be posted. Pictures that live only in Google Photos or Apple iCloud are not connected to Alpha: save them to this device first.
          </Notice>

          <section aria-label="Photos">
            <h3 className="section-title mb-1.5">Photos</h3>
            {done.length === 0 ? (
              <p className="text-text-secondary">No photos yet. Pick up to {MAX_ITEM_PHOTOS}. You will look at each one before it is used.</p>
            ) : (
              <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {done.map((d, i) => (
                  <li key={d.path} className="min-w-0">
                    <div className="aspect-square overflow-hidden rounded-md border border-border bg-bg-hover">
                      {d.url
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={d.url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
                        : <div className="grid h-full place-items-center p-2 text-center text-[0.8125rem] text-text-secondary">Saved. Preview not available</div>}
                    </div>
                    <p className="mt-1 flex items-center gap-1.5 text-[0.8125rem] text-text-secondary"><span className="lamp lamp-green" aria-hidden="true" />{d.covered ? 'Checked, covered' : 'Checked, nothing covered'}</p>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={working} aria-label={`Take photo ${i + 1} out of the post`} onClick={() => setDone(list => list.filter(x => x.path !== d.path))}>Take out</button>
                  </li>
                ))}
              </ul>
            )}
            <input ref={input} type="file" accept="image/*" multiple className="sr-only" tabIndex={-1} onChange={e => pick(e.target.files)} />
            <button type="button" className="btn btn-secondary mt-3" disabled={working || room <= 0} onClick={() => input.current?.click()}>
              <Icon name="upload" className="h-5 w-5" />{done.length === 0 ? 'Choose photos' : 'Add more photos'}
            </button>
            {room <= 0 && <p className="form-hint">That is the most a post can hold ({MAX_ITEM_PHOTOS} photos).</p>}
          </section>

          <div>
            <label htmlFor={`${base}-words`} className="form-label">The words for the post</label>
            <textarea id={`${base}-words`} className="form-textarea" rows={6} value={caption} maxLength={5000} onChange={e => { setCaption(e.target.value); setError('') }} placeholder="Say what the photos show, in your own words." />
            <p className="form-hint">Alpha cannot see your photo, so it does not write about it. It checks your words for prices, offers, warranties and credentials before the post can go out. If the photo shows a customer’s car, make sure they said it is fine.</p>
          </div>

          <PlacesPicker value={places} onChange={setChosen} connections={overview.connections} disabled={working} legend="Where it goes" />

          {error && <Notice kind="error">{error}</Notice>}

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={working}>Close</button>
            <button type="button" className="btn btn-primary" onClick={() => void make()} disabled={!canMake || working} aria-busy={working}>
              <Icon name="plus" className="h-5 w-5" />{working ? 'Making the post…' : 'Make the post'}
            </button>
          </div>
          <p className="form-hint">Making the post does not publish it. It waits in your queue for you to look it over and tap Post now.</p>
        </div>
      </Sheet>
      {current && (
        <PhotoCheckSheet
          key={`${current.name}:${current.size}:${position}`}
          title="Check this photo"
          progress={total > 1 ? `Photo ${position} of ${total}` : undefined}
          load={async () => ({ ok: true as const, data: current })}
          meta={{ label: `Photo ${done.length + 1}` }}
          saveLabel={todo.length > 1 ? 'Save and go to the next photo' : 'Save and finish'}
          onSaved={saved => { setDone(list => [...list, { name: current.name, ...saved }]); nextFile() }}
          onSkip={nextFile}
          onClose={() => { setTodo([]); setTotal(0) }}
        />
      )}
    </>
  )
}
