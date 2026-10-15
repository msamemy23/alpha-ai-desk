'use client'
import { useRef, useState } from 'react'
import Icon from '@/components/Icon'
import { MAX_NOTE, MAX_PHOTOS_PER_ITEM, RATING_WORD, cleanPrice } from '@/lib/dvi'
import type { DviItem, Rating } from '@/lib/dvi'

const RATINGS: Rating[] = ['green', 'yellow', 'red']
const LAMP: Record<Rating, string> = { green: 'lamp-green', yellow: 'lamp-amber', red: 'lamp-red' }
const ON: Record<Rating, string> = {
  green: 'border-green bg-green/[0.12] text-text-primary',
  yellow: 'border-amber bg-amber/[0.14] text-text-primary',
  red: 'border-red bg-red/[0.10] text-text-primary',
}

/** One thing the technician checks: a rating, and for anything not good, what was found, a price and photos. */
export default function ItemRow({ item, photoRoom, onChange, onPhoto, onRemove, onView }: {
  item: DviItem
  /** False when the whole inspection already holds as many photos as it can. */
  photoRoom: boolean
  onChange: (patch: Partial<DviItem>) => void
  onPhoto: (file: File) => Promise<void>
  onRemove?: () => void
  onView: (src: string) => void
}) {
  const file = useRef<HTMLInputElement>(null)
  const [priceText, setPriceText] = useState(item.price === null ? '' : String(item.price))
  const [priceBad, setPriceBad] = useState(false)
  const [photoError, setPhotoError] = useState('')
  const [busy, setBusy] = useState(false)
  const needsDetail = item.status === 'yellow' || item.status === 'red'
  const canAdd = photoRoom && item.photos.length < MAX_PHOTOS_PER_ITEM

  const pick = async (f: File | undefined) => {
    if (!f) return
    setPhotoError(''); setBusy(true)
    const err = await onPhoto(f).then(() => '', e => (e instanceof Error ? e.message : 'That photo did not save.'))
    setBusy(false)
    if (err) setPhotoError(err)
  }

  return (
    <div className={`px-3 py-3 ${item.status === 'red' ? 'bg-red/[0.04]' : item.status === 'yellow' ? 'bg-amber/[0.05]' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 break-words font-bold leading-snug">{item.name}</p>
        <div className="flex shrink-0 items-center gap-1">
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

      {needsDetail && (
        <div className="mt-2.5 grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_9rem]">
          <div>
            <label className="form-label" htmlFor={`note-${item.id}`}>What did you find?</label>
            <textarea id={`note-${item.id}`} className="form-input" rows={2} maxLength={MAX_NOTE} value={item.note} onChange={e => onChange({ note: e.target.value })} placeholder="For example: pads at 2 mm, grinding noise" />
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
                onChange={e => { setPriceText(e.target.value); setPriceBad(false); onChange({ price: cleanPrice(e.target.value) }) }}
                onBlur={() => { const p = cleanPrice(priceText); if (p !== null) setPriceText(String(p)); else setPriceBad(priceText.trim() !== '') }}
                aria-invalid={priceBad || undefined}
                aria-describedby={priceBad ? `price-err-${item.id}` : undefined}
              />
            </div>
            {priceBad && <p id={`price-err-${item.id}`} role="alert" className="form-error !mt-1">Use numbers only, like 129.99.</p>}
          </div>
        </div>
      )}

      {item.photos.length > 0 && (
        <ul className="mt-2.5 flex flex-wrap gap-2" aria-label={`Photos for ${item.name}`}>
          {item.photos.map((src, i) => (
            <li key={i} className="relative">
              <button type="button" className="block cursor-zoom-in rounded-md" onClick={() => onView(src)} aria-label={`View photo ${i + 1} of ${item.name}, full size`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="h-[4.5rem] w-[4.5rem] rounded-md border border-border object-cover" />
              </button>
              <button type="button" className="absolute -right-2.5 -top-2.5 grid h-8 w-8 place-items-center rounded-full border border-line bg-bg-card text-text-primary shadow-sm after:absolute after:-inset-1.5 after:content-['']" onClick={() => onChange({ photos: item.photos.filter((_, j) => j !== i) })} aria-label={`Remove photo ${i + 1} from ${item.name}`}>
                <Icon name="close" className="h-4 w-4" />
              </button>
            </li>
          ))}
          {busy && <li className="skeleton h-[4.5rem] w-[4.5rem]" aria-label="Preparing the photo" />}
        </ul>
      )}
      {item.photos.length === 0 && busy && <div className="skeleton mt-2.5 h-[4.5rem] w-[4.5rem]" aria-label="Preparing the photo" />}
      {photoError && <p role="alert" className="mt-1.5 text-[0.875rem] font-bold text-red">{photoError}</p>}
    </div>
  )
}
