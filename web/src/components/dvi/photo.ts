import { MAX_PHOTO_CHARS } from '@/lib/dvi'

const TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']

/**
 * Turns a photo from the phone's camera into a small JPEG data URL. A camera photo is 3 to 8 MB; saved as is it
 * would make every inspection slow to open and slow for the customer to load. The longest side becomes 1000px
 * (800 or 640 if it is still too big), which is sharp on a phone and plenty for a repair photo.
 * Throws an Error with a plain-words message.
 */
export async function photoFromFile(file: File): Promise<string> {
  if (file.type && !TYPES.includes(file.type)) throw new Error('Choose a photo (JPG, PNG or WebP).')
  if (file.size > 30 * 1024 * 1024) throw new Error('That photo is over 30 MB. Take it again or choose a smaller one.')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('That photo could not be read. Try taking it again.'))
      el.src = url
    })
    const w = img.naturalWidth, h = img.naturalHeight
    if (!w || !h) throw new Error('That photo could not be read. Try taking it again.')
    for (const side of [1000, 800, 640, 480]) {
      const scale = Math.min(1, side / Math.max(w, h))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(w * scale))
      canvas.height = Math.max(1, Math.round(h * scale))
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('This browser could not prepare the photo.')
      ctx.imageSmoothingQuality = 'high'
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      for (const q of [0.74, 0.62]) {
        const jpg = canvas.toDataURL('image/jpeg', q)
        if (jpg.length <= MAX_PHOTO_CHARS) return jpg
      }
    }
    throw new Error('That photo is too detailed to shrink enough. Try again from a little farther back.')
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** The same shrinking, but to a file for storage instead of text for the row. Bigger and sharper: 1600px on the long side. */
export async function photoBlobFromFile(file: File): Promise<Blob> {
  if (file.type && !TYPES.includes(file.type)) throw new Error('Choose a photo (JPG, PNG or WebP).')
  if (file.size > 30 * 1024 * 1024) throw new Error('That photo is over 30 MB. Take it again or choose a smaller one.')
  const url = URL.createObjectURL(file)
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => reject(new Error('That photo could not be read. Try taking it again.'))
      el.src = url
    })
    return await blobFromImage(img)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/** Draws a loaded image onto a canvas at most 1600px wide or tall and writes it as a JPEG under about 1.2 MB. */
export async function blobFromImage(img: HTMLImageElement): Promise<Blob> {
  const w = img.naturalWidth, h = img.naturalHeight
  if (!w || !h) throw new Error('That photo could not be read. Try taking it again.')
  for (const side of [1600, 1280, 1000, 800]) {
    const scale = Math.min(1, side / Math.max(w, h))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(w * scale))
    canvas.height = Math.max(1, Math.round(h * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This browser could not prepare the photo.')
    ctx.imageSmoothingQuality = 'high'
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/jpeg', 0.8))
    if (blob && blob.size <= 1_200_000) return blob
  }
  throw new Error('That photo is too detailed to shrink enough. Try again from a little farther back.')
}

/** A data URL back into a file. Used when an in-row photo is marked up and moved to storage. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',')
  const type = /data:([^;]+)/.exec(head)?.[1] || 'image/jpeg'
  const bin = atob(body || '')
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new Blob([bytes], { type })
}
