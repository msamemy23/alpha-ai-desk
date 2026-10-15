'use client'
import { useRef, useState } from 'react'
import Icon from '@/components/Icon'
import Sheet from '@/components/Sheet'
import { MAX_NOTE, MAX_PHOTOS_PER_ITEM, MAX_TECH_NOTE, RATING_WORD, cleanPrice } from '@/lib/dvi'
import type { DviItem, Rating, Urgency } from '@/lib/dvi'
import type { CannedLike } from '@/lib/dvi-canned'
import { clockText } from '@/lib/dvi-media'
import { measureKindFor, ratingAfterMeasure } from '@/lib/dvi-measure'
import type { Measure } from '@/lib/dvi-measure'
import CannedPicker from './CannedPicker'
import ClipRecorder from './ClipRecorder'
import MeasureField from './MeasureField'
import PhotoMarkup from './PhotoMarkup'
import UrgencyPicker from './UrgencyPicker'

const RATINGS: Rating[] = ['green', 'yellow', 'red']
const LAMP: Record<Rating, string> = { green: 'lamp-green', yellow: 'lamp-amber', red: 'lamp-red' }
const ON: Record<Rating, string> = {
  green: 'border-green bg-green/[0.12] text-text-primary',
  yellow: 'border-amber bg-amber/[0.14] text-text-primary',
  red: 'border-red bg-red/[0.10] text-text-primary',
}

/** What the editor offers a row: where files go, the canned jobs, and last visit's reading of this same line. */
export interface RowTools {
  /** False when photos can no longer be added to this inspection. */
  photoRoom: (item: DviItem) => boolean
  urlFor: (src: string) => string | null
  /** Video and voice notes need file storage; false shows a short notice instead of the buttons. */
  clipsOk: boolean
  canned: { jobs: CannedLike[]; loaded: boolean }
  before: (item: DviItem) => { text: string; wear: string } | null
  addPhoto: (file: File) => Promise<void>
  addClip: (kind: 'video' | 'audio', blob: Blob, secs: number) => Promise<void>
  replacePhoto: (index: number, blob: Blob) => Promise<void>
}

/** One thing the technician checks: a rating, and for anything not good, what was found, how soon, a price, and proof. */
export default function ItemRow({ item, tools, onChange, onRemove }: {
  item: DviItem
  tools: RowTools
  onChange: (patch: Partial<DviItem>) => void
  onRemove?: () => void
}) {
  const file = useRef<HTMLInputElement>(null)
  const [priceText, setPriceText] = useState(item.price === null ? '' : String(item.price))
  const [priceBad, setPriceBad] = useState(false)
  const [mediaError, setMediaError] = useState('')
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState<number | null>(null)
  const [mark, setMark] = useState<number | null>(null)
  const [rec, setRec] = useState<'video' | 'audio' | null>(null)
  const [clipView, setClipView] = useState<number | null>(null)
  const [shopNote, setShopNote] = useState(Boolean(item.techNote))
  const needsDetail = item.status === 'yellow' || item.status === 'red'
  const canAdd = tools.photoRoom(item) && item.photos.length < MAX_PHOTOS_PER_ITEM
  const kind = measureKindFor(item.name)
  const clips = item.clips ?? []

  const pick = async (f: File | undefined) => {
    if (!f) return
    setMediaError(''); setBusy(true)
    const err = await tools.addPhoto(f).then(() => '', e => (e instanceof Error ? e.message : 'That photo did not save.'))
    setBusy(false)
    if (err) setMediaError(err)
  }

  const setMeasure = (m: Measure | undefined) => {
    const next = m ? ratingAfterMeasure(item.status, m) : null
    onChange({ measure: m, ...(next ? { status: next } : {}) })
  }

  const viewing = view !== null ? item.photos[view] : undefined
  const viewUrl = viewing ? tools.urlFor(viewing) : null
  const markUrl = mark !== null && item.photos[mark] ? tools.urlFor(item.photos[mark]) : null
  const clipAt = clipView !== null ? clips[clipView] : undefined

  return (
    <div className={`px-3 py-3 ${item.status === 'red' ? 'bg-red/[0.04]' : item.status === 'yellow' ? 'bg-amber/[0.05]' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 break-words font-bold leading-snug">{item.name}</p>
        <div className="flex shrink-0 items-center gap-0.5">
          {item.custom && onRemove && (
            <button type="button" className="btn-icon" onClick={onRemove} aria-label={`Remove ${item.name}`}><Icon name="trash" className="h-5 w-5" /></button>
          )}
          <button
            type="button"
            className="btn-icon relative"
            disabled={!canAdd || busy}
            onClick={() => file.current?.click()}
            aria-label={canAdd ? `Add a photo for ${item.name}` : item.photos.length >= MAX_PHOTOS_PER_ITEM ? 'This item has the most photos it can hold' : 'This inspection has the most photos it can hold'}
          >
            <Icon name="camera" className="h-5 w-5" />
            {item.photos.length > 0 && <span className="num absolute -right-0.5 -top-0.5 grid h-[1.125rem] min-w-[1.125rem] place-items-center rounded-full bg-blue px-1 text-[0.6875rem] font-bold text-[rgb(var(--c-on-blue))]">{item.photos.length}</span>}
          </button>
          <input ref={file} type="file" accept="image/*" capture="environment" className="hidden" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void pick(f) }} />
          {tools.clipsOk && (
            <>
              <button type="button" className="btn-icon" onClick={() => { setMediaError(''); setRec('video') }} disabled={clips.length >= 2} aria-label={`Record a short video for ${item.name}`}><Icon name="video" className="h-5 w-5" /></button>
              <button type="button" className="btn-icon" onClick={() => { setMediaError(''); setRec('audio') }} disabled={clips.length >= 2} aria-label={`Record a voice note for ${item.name}`}><Icon name="mic" className="h-5 w-5" /></button>
            </>
          )}
        </div>
      </div>

      <div role="group" aria-label={`Rating for ${item.name}`} className="mt-2 grid grid-cols-3 gap-2 sm:max-w-lg">
        {RATINGS.map(r => {
          const on = item.status === r
          return (
            <button
              key={r}
              type="button"
              aria-pressed={on}
              onClick={() => onChange({ status: on ? null : r })}
              className={`flex min-h-[44px] items-center justify-center gap-1.5 rounded-md border px-1 text-[0.875rem] font-bold leading-tight transition-colors sm:min-h-[40px] ${on ? ON[r] : 'border-[rgb(var(--c-line))] bg-bg-card text-text-secondary hover:bg-bg-hover'}`}
            >
              <span className={`lamp ${LAMP[r]} !h-2.5 !w-2.5 shrink-0`} aria-hidden="true" />{RATING_WORD[r]}
            </button>
          )
        })}
      </div>

      {kind && kind !== 'pressure' && <MeasureField key={`${item.id}-${kind}`} id={item.id} kind={kind} measure={item.measure?.kind === kind ? item.measure : undefined} before={tools.before(item)} onChange={setMeasure} />}

      {needsDetail && (
        <>
          <div className="mt-2.5 grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_9rem]">
            <div>
              <label className="form-label" htmlFor={`note-${item.id}`}>What did you find?</label>
              <textarea id={`note-${item.id}`} className="form-input" rows={2} maxLength={MAX_NOTE} value={item.note} onChange={e => onChange({ note: e.target.value })} placeholder="For example: pads at 2 mm, grinding noise" />
              <p className="mt-0.5 text-[0.8125rem] text-text-secondary">The customer reads this.</p>
            </div>
            <div>
              <label className="form-label" htmlFor={`price-${item.id}`}>Suggested price</label>
              <div className="relative">
                <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-secondary">$</span>
                <input
                  id={`price-${item.id}`}
                  className="form-input num pl-7"
                  inputMode="decimal"
                  autoComplete="off"
                  value={priceText}
                  placeholder="Optional"
                  onChange={e => { setPriceText(e.target.value); setPriceBad(false); onChange({ price: cleanPrice(e.target.value), canned: undefined }) }}
                  onBlur={() => { const p = cleanPrice(priceText); if (p !== null) setPriceText(String(p)); else setPriceBad(priceText.trim() !== '') }}
                  aria-invalid={priceBad || undefined}
                  aria-describedby={priceBad ? `price-err-${item.id}` : undefined}
                />
              </div>
              {priceBad && <p id={`price-err-${item.id}`} role="alert" className="form-error !mt-1">Use numbers only, like 129.99.</p>}
            </div>
          </div>
          <CannedPicker itemName={item.name} jobs={tools.canned.jobs} loaded={tools.canned.loaded} current={item.canned} onPick={(job, price) => { setPriceText(String(price)); setPriceBad(false); onChange({ price, canned: { id: job.id, name: job.name } }) }} />
          <UrgencyPicker item={item} onChange={(u: Urgency) => onChange({ urgency: u })} />
          {shopNote ? (
            <div className="mt-2.5">
              <label className="form-label flex items-center gap-1.5" htmlFor={`tn-${item.id}`}><Icon name="lock" className="h-4 w-4" />Note for the shop only</label>
              <textarea id={`tn-${item.id}`} className="form-input" rows={2} maxLength={MAX_TECH_NOTE} value={item.techNote ?? ''} onChange={e => onChange({ techNote: e.target.value })} placeholder="Part numbers, what to check next, anything the customer should not read" />
              <p className="mt-0.5 text-[0.8125rem] text-text-secondary">Never sent to the customer or shown on their page or the printed report.</p>
            </div>
          ) : (
            <button type="button" className="btn btn-ghost btn-sm mt-1.5" onClick={() => setShopNote(true)}><Icon name="lock" className="h-4 w-4" />Add a note for the shop only</button>
          )}
        </>
      )}

      {(item.photos.length > 0 || clips.length > 0 || busy) && (
        <ul className="mt-2.5 flex flex-wrap gap-2" aria-label={`Photos and recordings for ${item.name}`}>
          {item.photos.map((src, i) => {
            const url = tools.urlFor(src)
            return (
              <li key={`${src.slice(-24)}-${i}`} className="relative">
                <button type="button" className="block cursor-zoom-in rounded-md" onClick={() => setView(i)} aria-label={`View photo ${i + 1} of ${item.name}, full size`}>
                  {url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={url} alt="" className="h-[4.5rem] w-[4.5rem] rounded-md border border-border object-cover" />
                    : <span className="skeleton block h-[4.5rem] w-[4.5rem]" aria-label="Loading the photo" />}
                </button>
                <button type="button" className="absolute -right-2.5 -top-2.5 grid h-8 w-8 place-items-center rounded-full border border-line bg-bg-card text-text-primary shadow-sm after:absolute after:-inset-1.5 after:content-['']" onClick={() => onChange({ photos: item.photos.filter((_, j) => j !== i) })} aria-label={`Remove photo ${i + 1} from ${item.name}`}>
                  <Icon name="close" className="h-4 w-4" />
                </button>
              </li>
            )
          })}
          {clips.map((c, i) => (
            <li key={c.ref} className="relative">
              <button type="button" className="flex h-[4.5rem] w-[4.5rem] flex-col items-center justify-center gap-1 rounded-md border border-border bg-bg-card text-[0.8125rem] font-bold" onClick={() => setClipView(i)} aria-label={`Play the ${c.kind === 'video' ? 'video' : 'voice note'} for ${item.name}`}>
                <Icon name={c.kind === 'video' ? 'video' : 'mic'} className="h-6 w-6" />
                <span className="num">{c.secs > 0 ? clockText(c.secs) : c.kind === 'video' ? 'Video' : 'Voice'}</span>
              </button>
              <button type="button" className="absolute -right-2.5 -top-2.5 grid h-8 w-8 place-items-center rounded-full border border-line bg-bg-card text-text-primary shadow-sm after:absolute after:-inset-1.5 after:content-['']" onClick={() => onChange({ clips: clips.filter((_, j) => j !== i) })} aria-label={`Remove the ${c.kind === 'video' ? 'video' : 'voice note'} from ${item.name}`}>
                <Icon name="close" className="h-4 w-4" />
              </button>
            </li>
          ))}
          {busy && <li className="skeleton h-[4.5rem] w-[4.5rem]" aria-label="Preparing the photo" />}
        </ul>
      )}
      {mediaError && <p role="alert" className="mt-1.5 text-[0.875rem] font-bold text-red">{mediaError}</p>}

      <Sheet open={view !== null} onClose={() => setView(null)} title={`Photo of ${item.name}`} wide>
        {viewUrl
          // eslint-disable-next-line @next/next/no-img-element -- a stored or inline picture, so next/image has nothing to optimize
          ? <img src={viewUrl} alt={`${item.name}, full size`} className="mx-auto max-h-[65vh] w-auto max-w-full rounded-md" />
          : <div className="skeleton h-64" aria-label="Loading the photo" />}
        {view !== null && (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button type="button" className="btn btn-secondary" disabled={!viewUrl} onClick={() => { setMark(view); setView(null) }}><Icon name="pen" className="h-5 w-5" />Mark up</button>
            <button type="button" className="btn btn-primary" onClick={() => setView(null)}>Done</button>
          </div>
        )}
      </Sheet>

      <Sheet open={mark !== null} onClose={() => setMark(null)} title="Mark up the photo" wide>
        {markUrl && mark !== null && (
          <PhotoMarkup src={markUrl} onCancel={() => setMark(null)} onSave={async blob => { await tools.replacePhoto(mark, blob); setMark(null) }} />
        )}
      </Sheet>

      <Sheet open={rec !== null} onClose={() => setRec(null)} title={rec === 'video' ? 'Record a short video' : 'Record a voice note'}>
        {rec && <ClipRecorder key={rec} kind={rec} onCancel={() => setRec(null)} onUse={async (blob, secs) => { await tools.addClip(rec, blob, secs); setRec(null) }} />}
      </Sheet>

      <Sheet open={clipAt !== undefined} onClose={() => setClipView(null)} title={clipAt?.kind === 'video' ? 'Video' : 'Voice note'}>
        {clipAt && (() => {
          const url = tools.urlFor(clipAt.ref)
          if (!url) return <div className="skeleton h-40" aria-label="Loading the recording" />
          return clipAt.kind === 'video'
            ? <video src={url} controls playsInline className="aspect-video w-full rounded-md border border-border bg-bg-hover" aria-label={`Video for ${item.name}`} />
            : <audio src={url} controls className="w-full" aria-label={`Voice note for ${item.name}`} />
        })()}
      </Sheet>
    </div>
  )
}
