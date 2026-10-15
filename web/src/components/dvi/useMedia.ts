'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { isStorageRef } from '@/lib/dvi'
import { MEDIA_BUCKET, baseType, checkUpload } from '@/lib/dvi-media'

export type Stored = { ok: true; ref: string } | { ok: false; reason: 'no_storage' | 'failed'; error: string }

const REFRESH_MS = 50 * 60 * 1000

/**
 * Pictures, video and voice notes for one inspection. Files go to private storage and the row keeps only a short name;
 * viewing addresses are fetched from the server (they expire, so they are renewed). If storage is not set up yet the
 * caller is told, and keeps the old way (photos inside the row).
 */
export function useMedia(dviId: string, refs: string[]) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [storage, setStorage] = useState<'unknown' | 'yes' | 'no'>('unknown')
  const asked = useRef<Set<string>>(new Set())
  const signedAt = useRef(0)

  const sign = useCallback(async (list: string[]) => {
    if (list.length === 0) return
    try {
      const res = await fetch('/api/inspection/media', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'sign', refs: list.slice(0, 60) }) })
      const d = await res.json().catch(() => ({})) as { ok?: boolean; urls?: Record<string, string> }
      if (res.ok && d.ok && d.urls) { signedAt.current = Date.now(); setUrls(u => ({ ...u, ...d.urls })) }
    } catch { /* the picture shows a placeholder; the next change tries again */ }
  }, [])

  const key = refs.filter(isStorageRef).sort().join('|')
  useEffect(() => {
    const need = key ? key.split('|').filter(r => !asked.current.has(r)) : []
    if (need.length === 0) return
    need.forEach(r => asked.current.add(r))
    void sign(need)
  }, [key, sign])

  // Viewing addresses last an hour; renew them well before that while the inspection stays open.
  useEffect(() => {
    if (!key) return
    const t = setInterval(() => { if (Date.now() - signedAt.current > REFRESH_MS) void sign(key.split('|')) }, 60_000)
    return () => clearInterval(t)
  }, [key, sign])

  /** The address to show for a picture or clip, or null while it is being fetched. Pictures stored in the row show as they are. */
  const urlFor = useCallback((src: string): string | null => (isStorageRef(src) ? urls[src] || null : src), [urls])

  /** Sends one file to storage. */
  const store = useCallback(async (blob: Blob, contentType?: string): Promise<Stored> => {
    const type = baseType(contentType || blob.type)
    const check = checkUpload(type, blob.size)
    if (!check.ok) return { ok: false, reason: 'failed', error: check.error }
    if (storage === 'no') return { ok: false, reason: 'no_storage', error: 'Video and voice notes need a database update first.' }
    try {
      const res = await fetch('/api/inspection/media', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'upload', dvi_id: dviId, contentType: type, size: blob.size }) })
      const d = await res.json().catch(() => ({})) as { ok?: boolean; ref?: string; path?: string; token?: string; code?: string; error?: string }
      if (res.status === 503 && d.code === 'no_storage') { setStorage('no'); return { ok: false, reason: 'no_storage', error: d.error || 'Video and voice notes need a database update first.' } }
      if (!res.ok || !d.ok || !d.ref || !d.path || !d.token) return { ok: false, reason: 'failed', error: d.error || 'The file could not be prepared. Try again.' }
      const up = await supabase.storage.from(MEDIA_BUCKET).uploadToSignedUrl(d.path, d.token, blob, { contentType: type })
      if (up.error) return { ok: false, reason: 'failed', error: 'The file did not upload. Check your connection and try again.' }
      setStorage('yes')
      void sign([d.ref])
      return { ok: true, ref: d.ref }
    } catch {
      return { ok: false, reason: 'failed', error: 'No connection. Check your internet and try again.' }
    }
  }, [dviId, storage, sign])

  return { urlFor, store, storage }
}
