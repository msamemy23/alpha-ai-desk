'use client'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Icon from '@/components/Icon'
import Sheet from '@/components/Sheet'
import { api } from './api'
import type { MediaRef } from './useAiOverlay'

/* ---------- shrinking pictures in the browser ---------- */

const MAX_EDGE = 1280
const TARGET_BYTES = 1_100_000
const VIDEO_MAX = 1_500_000

const blobToBase64 = (blob: Blob): Promise<string> => new Promise((resolve, reject) => {
  const r = new FileReader()
  r.onload = () => resolve(String(r.result).split(',')[1] || '')
  r.onerror = () => reject(new Error('read'))
  r.readAsDataURL(blob)
})

async function shrinkImage(file: File): Promise<{ contentType: string; data: string }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
  const w = Math.max(1, Math.round(bitmap.width * scale))
  const h = Math.max(1, Math.round(bitmap.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w; canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas')
  ctx.drawImage(bitmap, 0, 0, w, h)
  bitmap.close?.()
  let quality = 0.85
  for (let i = 0; i < 6; i++) {
    const blob: Blob | null = await new Promise(res => canvas.toBlob(res, 'image/jpeg', quality))
    if (blob && (blob.size <= TARGET_BYTES || i === 5)) {
      if (blob.size > 1_600_000) throw new Error('big')
      return { contentType: 'image/jpeg', data: await blobToBase64(blob) }
    }
    quality -= 0.13
  }
  throw new Error('big')
}

export async function prepareFile(file: File): Promise<{ ok: true; contentType: string; data: string } | { ok: false; error: string }> {
  try {
    if (file.type.startsWith('image/')) {
      const out = await shrinkImage(file)
      return { ok: true, ...out }
    }
    if (file.type === 'video/mp4' || file.type === 'video/3gpp' || file.type === 'video/quicktime') {
      if (file.size > VIDEO_MAX) return { ok: false, error: 'That video is too big to text (the limit is about 1.5 MB). Send a picture or a shorter clip.' }
      return { ok: true, contentType: file.type, data: await blobToBase64(file) }
    }
    return { ok: false, error: 'Pick a picture or a short video.' }
  } catch {
    return { ok: false, error: 'That picture could not be read. Try another one.' }
  }
}

/* ---------- pictures waiting to go out with the next text ---------- */

export interface Pending { localId: string; name: string; preview: string; kind: 'image' | 'video'; status: 'uploading' | 'ready' | 'error'; id?: string; error?: string }

export function useAttachments(toNumber: string) {
  const [items, setItems] = useState<Pending[]>([])
  const urls = useRef<string[]>([])
  useEffect(() => () => { urls.current.forEach(u => URL.revokeObjectURL(u)) }, [])

  const add = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).slice(0, 5)
    for (const file of list) {
      const localId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const preview = file.type.startsWith('image/') ? URL.createObjectURL(file) : ''
      if (preview) urls.current.push(preview)
      const kind: Pending['kind'] = file.type.startsWith('video/') ? 'video' : 'image'
      setItems(prev => [...prev.slice(0, 4), { localId, name: file.name || 'Picture', preview, kind, status: 'uploading' }])
      const prepared = await prepareFile(file)
      if (!prepared.ok) { setItems(prev => prev.map(p => (p.localId === localId ? { ...p, status: 'error', error: prepared.error } : p))); continue }
      const r = await api<{ id: string }>('/api/inbox/media', { body: { contentType: prepared.contentType, data: prepared.data, to: toNumber } })
      setItems(prev => prev.map(p => (p.localId === localId
        ? (r.ok && r.data?.id ? { ...p, status: 'ready', id: r.data.id } : { ...p, status: 'error', error: r.error })
        : p)))
    }
  }, [toNumber])

  const remove = useCallback((localId: string) => setItems(prev => prev.filter(p => p.localId !== localId)), [])
  const clear = useCallback(() => setItems([]), [])
  const ready = useMemo(() => items.filter(p => p.status === 'ready' && p.id).map(p => p.id as string), [items])
  const busy = items.some(p => p.status === 'uploading')
  return { items, add, remove, clear, ready, busy }
}

/** The row of small previews above the text box, with a way to take each one off. */
export function PendingStrip({ items, onRemove }: { items: Pending[]; onRemove: (localId: string) => void }) {
  if (!items.length) return null
  return (
    <ul className="mx-auto mb-2 flex max-w-3xl flex-wrap gap-2" aria-label="Pictures to send">
      {items.map(p => (
        <li key={p.localId} className="relative">
          <div className={`grid h-16 w-16 place-items-center overflow-hidden rounded-md border bg-bg-chrome ${p.status === 'error' ? 'border-red' : 'border-border'}`}>
            {p.preview
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={p.preview} alt={`Picture to send: ${p.name}`} className="h-full w-full object-cover" />
              : <Icon name="video" className="h-6 w-6 text-text-secondary" />}
            {p.status === 'uploading' && (
              <span className="absolute inset-0 grid place-items-center bg-bg-card/70" role="status" aria-label="Uploading">
                <span aria-hidden="true" className="spinner inline-block h-5 w-5 rounded-full border-2 border-current border-t-transparent" />
              </span>
            )}
          </div>
          <button type="button" onClick={() => onRemove(p.localId)} className="absolute -right-2 -top-2 grid h-7 w-7 place-items-center rounded-full border border-border bg-bg-card text-text-primary" aria-label={`Remove ${p.name}`}>
            <Icon name="close" className="h-4 w-4" />
          </button>
          {p.status === 'error' && <p role="alert" className="mt-1 w-40 text-[0.8125rem] font-bold text-red">{p.error}</p>}
        </li>
      ))}
    </ul>
  )
}

/** The "add a picture" button. A phone offers the camera as well as the photo library. */
export function AttachButton({ onPick, disabled }: { onPick: (files: FileList) => void; disabled?: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <input ref={input} type="file" accept="image/*,video/mp4,video/quicktime,video/3gpp" multiple className="sr-only" tabIndex={-1} aria-hidden="true"
        onChange={e => { if (e.target.files?.length) onPick(e.target.files); e.target.value = '' }} />
      <button type="button" className="btn-icon h-11 w-11 shrink-0 sm:h-10 sm:w-10" onClick={() => input.current?.click()} disabled={disabled} aria-label="Add a picture or video" title="Add a picture or video">
        <Icon name="image" className="h-5 w-5" />
      </button>
    </>
  )
}

/* ---------- pictures inside the conversation ---------- */

/** Which texts have pictures. Looks up only the texts on screen, and refreshes when new ones arrive. */
export function useThreadMedia(messageIds: string[]) {
  const [map, setMap] = useState<Map<string, MediaRef[]>>(new Map())
  const key = messageIds.join(',')
  useEffect(() => {
    let off = false
    const ids = key ? key.split(',').filter(id => !id.startsWith('blank')).slice(-120) : []
    if (!ids.length) { setMap(new Map()); return }
    api<{ items: MediaRef[] }>(`/api/inbox/media?ids=${encodeURIComponent(ids.join(','))}`).then(r => {
      if (off || !r.ok || !r.data) return
      const m = new Map<string, MediaRef[]>()
      for (const it of r.data.items || []) {
        if (!it.message_id) continue
        const list = m.get(it.message_id)
        if (list) list.push(it); else m.set(it.message_id, [it])
      }
      setMap(m)
    })
    return () => { off = true }
  }, [key])
  return map
}

export function MessageMedia({ items, out, who }: { items: MediaRef[]; out: boolean; who: string }) {
  const [open, setOpen] = useState<MediaRef | null>(null)
  const [failed, setFailed] = useState<Set<string>>(new Set())
  const fail = (id: string) => setFailed(prev => new Set(prev).add(id))
  return (
    <>
      <div className={`mb-1 flex max-w-[86%] flex-wrap gap-1.5 ${out ? 'justify-end' : 'justify-start'}`}>
        {items.map(m => {
          const src = `/api/inbox/media/${encodeURIComponent(m.id)}`
          if (failed.has(m.id)) {
            return <p key={m.id} className="rounded-md border border-dashed border-border px-3 py-2 text-[0.875rem] text-text-secondary">This {m.content_type.startsWith('video/') ? 'video' : 'picture'} is no longer available.</p>
          }
          return m.content_type.startsWith('video/')
            ? <video key={m.id} src={src} controls preload="metadata" className="max-h-64 max-w-full rounded-lg border border-border" aria-label={`Video from ${who}`} onError={() => fail(m.id)} />
            : (
              <button key={m.id} type="button" onClick={() => setOpen(m)} className="block overflow-hidden rounded-lg border border-border" aria-label={`Open picture from ${who}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`Picture from ${who}`} loading="lazy" className="max-h-56 max-w-full object-cover" onError={() => fail(m.id)} />
              </button>
            )
        })}
      </div>
      {open && (
        <Sheet open onClose={() => setOpen(null)} title="Picture" wide>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`/api/inbox/media/${encodeURIComponent(open.id)}`} alt={`Picture from ${who}`} className="mx-auto max-h-[70vh] w-auto max-w-full rounded-md" />
        </Sheet>
      )}
    </>
  )
}
