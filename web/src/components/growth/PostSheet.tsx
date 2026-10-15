'use client'
import { useRef, useState } from 'react'
import Sheet from '@/components/Sheet'
import Notice from '@/components/Notice'
import Icon from '@/components/Icon'
import { getAuthJsonHeaders } from './helpers'

const PLATFORMS = [
  { key: 'facebook', label: 'Facebook' },
  { key: 'instagram', label: 'Instagram' },
  { key: 'google', label: 'Google' },
  { key: 'tiktok', label: 'TikTok' },
]

interface Props {
  shopName: string
  onClose: () => void
  onSaved: (message: string) => void
}

/** Writes a post and saves it as a draft. Nothing is published from here. */
export default function PostSheet({ shopName, onClose, onSaved }: Props) {
  const [text, setText] = useState('')
  const [platforms, setPlatforms] = useState(['facebook', 'google'])
  const [media, setMedia] = useState<File[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [tried, setTried] = useState(false)
  const busy = useRef(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const textErr = !text.trim() ? 'Write something for the post first.' : ''
  const platformErr = platforms.length === 0 ? 'Choose at least one place for it.' : ''

  const save = async () => {
    setTried(true)
    if (textErr || platformErr || busy.current) return
    busy.current = true; setSaving(true); setError('')
    try {
      const mediaUrls: string[] = []
      const mediaPaths: string[] = []
      for (const file of media) {
        const form = new FormData()
        form.append('file', file)
        const headers = await getAuthJsonHeaders()
        delete headers['Content-Type']
        const upload = await fetch('/api/growth/social-media', { method: 'POST', headers, body: form })
        const uploadData = await upload.json().catch(() => ({}))
        if (!upload.ok || !uploadData.url) throw new Error(uploadData.error || `${file.name} did not upload`)
        mediaUrls.push(uploadData.url)
        if (typeof uploadData.path === 'string') mediaPaths.push(uploadData.path)
      }
      const r = await fetch('/api/growth/social-post', {
        method: 'POST',
        headers: await getAuthJsonHeaders(),
        body: JSON.stringify({ text: text.trim(), platforms, media_urls: mediaUrls, media_paths: mediaPaths }),
      })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.error || 'The draft could not be saved')
      onSaved(d.message || 'Draft saved. Nothing was published.')
    } catch (e) {
      setError(`The draft was not saved. ${e instanceof Error && e.message ? e.message : 'Check your connection and try again.'} What you wrote is still here.`)
    } finally { busy.current = false; setSaving(false) }
  }

  return (
    <Sheet open onClose={onClose} title="Write a post">
      <div className="space-y-4">
        <div role="group" aria-label="Where this post is for">
          <p className="form-label">Where it is for</p>
          <div className="flex flex-wrap gap-2">
            {PLATFORMS.map(p => {
              const on = platforms.includes(p.key)
              return (
                <button key={p.key} type="button" aria-pressed={on} onClick={() => setPlatforms(prev => prev.includes(p.key) ? prev.filter(x => x !== p.key) : [...prev, p.key])} className={`btn ${on ? 'border-blue bg-blue/10 text-blue' : 'btn-secondary'}`}>
                  {on ? <Icon name="check" className="h-4 w-4" strokeWidth={2.4} /> : <Icon name="globe" className="h-4 w-4" />}
                  {p.label}
                </button>
              )
            })}
          </div>
          {tried && platformErr && <p className="form-error">{platformErr}</p>}
        </div>
        <div>
          <label htmlFor="post-text" className="form-label">What is happening at your shop?</label>
          <textarea id="post-text" className="form-textarea" rows={5} value={text} onChange={e => setText(e.target.value)} placeholder="We have two bays open this afternoon. Walk-ins welcome." aria-invalid={tried && !!textErr} />
          {tried && textErr && <p className="form-error">{textErr}</p>}
          <p className="form-hint">This saves a draft only. Nothing is published until a connected app is authorized.</p>
        </div>
        <div>
          <input ref={fileRef} type="file" multiple accept="image/*,video/*" className="sr-only" tabIndex={-1} aria-label="Choose photos or videos" onChange={e => { if (e.target.files) setMedia(Array.from(e.target.files)) }} />
          <button type="button" className="btn btn-secondary" onClick={() => fileRef.current?.click()}><Icon name="image" className="h-5 w-5" />{media.length ? 'Change photos' : 'Add photos'}</button>
          {media.length > 0 && (
            <ul className="mt-2 divide-y divide-border rounded-md border border-border">
              {media.map((f, i) => (
                <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2 pl-3 text-[0.9375rem]">
                  <span className="min-w-0 truncate">{f.name}</span>
                  <button type="button" className="btn-icon shrink-0" aria-label={`Remove ${f.name}`} onClick={() => { setMedia(m => m.filter((_, j) => j !== i)); if (fileRef.current) fileRef.current.value = '' }}><Icon name="close" className="h-5 w-5" /></button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {text.trim() && (
          <div className="rounded-lg border border-border bg-bg-base p-3" aria-label="Preview">
            <p className="mb-2 flex items-center gap-2 text-[0.8125rem] font-bold text-text-secondary"><Icon name="eye" className="h-4 w-4" />Preview</p>
            <div className="flex items-center gap-2">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-bg-hover font-bold" aria-hidden="true">{(shopName || 'S').charAt(0).toUpperCase()}</span>
              <p className="min-w-0 truncate font-bold">{shopName || 'Your shop'}</p>
            </div>
            <p className="mt-2 whitespace-pre-wrap break-words text-[0.9375rem]">{text}</p>
            {media.length > 0 && <p className="mt-2 text-[0.875rem] text-text-secondary">{media.length} {media.length === 1 ? 'photo or video' : 'photos or videos'} attached</p>}
            <p className="mt-2 text-[0.8125rem] text-text-secondary">For: {platforms.length ? platforms.map(x => PLATFORMS.find(p => p.key === x)?.label || x).join(', ') : 'no place chosen yet'}</p>
          </div>
        )}
        {error && <Notice kind="error">{error}</Notice>}
        <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save draft'}</button>
        </div>
      </div>
    </Sheet>
  )
}
