import { useEffect, useState } from 'react'

/**
 * The shop's logo, kept in memory for the life of the page so the sidebar, the documents and Settings
 * all read the same copy, and an upload shows up everywhere at once.
 */
type LogoState = { logo: string | null; available: boolean }

const CHANGED = 'shop:logo-changed'
let current: LogoState | null = null
let inflight: Promise<LogoState> | null = null

export async function loadShopLogo(force = false): Promise<LogoState> {
  if (current && !force) return current
  if (inflight && !force) return inflight
  inflight = (async () => {
    try {
      const res = await fetch('/api/shop-logo', { cache: 'no-store' })
      const data = await res.json().catch(() => ({}))
      current = res.ok && data.ok === true
        ? { logo: typeof data.logo === 'string' ? data.logo : null, available: data.available !== false }
        : { logo: null, available: true }
    } catch {
      current = { logo: null, available: true }
    }
    inflight = null
    return current
  })()
  return inflight
}

export function useShopLogo(): LogoState & { ready: boolean } {
  const [state, setState] = useState<LogoState | null>(current)
  useEffect(() => {
    let live = true
    loadShopLogo().then(s => { if (live) setState(s) })
    const onChange = () => { if (live && current) setState({ ...current }) }
    window.addEventListener(CHANGED, onChange)
    return () => { live = false; window.removeEventListener(CHANGED, onChange) }
  }, [])
  return { logo: state?.logo ?? null, available: state?.available ?? true, ready: state !== null }
}

/** Saves a new logo, or removes it with null. Returns a plain-words error, or nothing on success. */
export async function saveShopLogo(logo: string | null): Promise<{ error?: string }> {
  try {
    const res = await fetch('/api/shop-logo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ logo }),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok || data.ok !== true) {
      if (data.available === false) current = { logo: null, available: false }
      return { error: data.error || 'The logo could not be saved. Try again.' }
    }
    current = { logo, available: true }
    window.dispatchEvent(new Event(CHANGED))
    return {}
  } catch {
    return { error: 'The logo could not be saved. Check your connection and try again.' }
  }
}

const TYPES = ['image/png', 'image/jpeg', 'image/webp']
const MAX_CHARS = 280_000 // the server accepts 300,000; stay clear of it

/**
 * Turns the picture the owner chose into a small data URL: scaled so the longest side is at most 320px,
 * which is plenty for the sidebar and for a printed letterhead. Throws an Error with a plain message.
 */
export async function logoFromFile(file: File): Promise<string> {
  if (!TYPES.includes(file.type)) throw new Error('Choose a PNG, JPG or WebP picture.')
  if (file.size > 15 * 1024 * 1024) throw new Error('That picture is over 15 MB. Choose a smaller one.')

  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('That file could not be read as a picture. Try another.'))
      el.src = url
    })
    const w = img.naturalWidth, h = img.naturalHeight
    if (!w || !h) throw new Error('That file could not be read as a picture. Try another.')

    for (const side of [320, 256, 192, 128]) {
      const scale = Math.min(1, side / Math.max(w, h))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(w * scale))
      canvas.height = Math.max(1, Math.round(h * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('This browser could not prepare the picture.')
      ctx.imageSmoothingQuality = 'high'
      if (file.type === 'image/png') {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        const png = canvas.toDataURL('image/png')
        if (png.length <= MAX_CHARS) return png // keeps see-through backgrounds
      }
      // Photos and anything big: JPEG on white, which is how it will be shown anyway.
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      const jpg = canvas.toDataURL('image/jpeg', 0.9)
      if (jpg.length <= MAX_CHARS) return jpg
    }
    throw new Error('That picture is too detailed to shrink enough. Try a simpler version.')
  } finally {
    URL.revokeObjectURL(url)
  }
}
