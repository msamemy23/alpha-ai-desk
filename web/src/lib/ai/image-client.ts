/**
 * Gets a photo ready for the assistant, in the browser: reads the picture, turns it the right way up,
 * shrinks it so it uploads fast on a phone, and makes a small thumbnail for the chat.
 *
 * The big copy goes to the model for ONE message and is never stored in the chat history.
 * Only the thumbnail is kept, so a saved chat stays small.
 *
 * Browser-only (uses canvas). The sizing rules live in images.ts so they can be tested.
 */
import { fitWithin, MAX_IMAGE_CHARS } from './images.ts'

export type PreparedPhoto = { name: string; full: string; thumb: string }
export type PhotoResult = { photo: PreparedPhoto; error?: undefined } | { photo?: undefined; error: string }

const FULL_STEPS: [number, number][] = [[1280, 0.82], [1024, 0.72], [800, 0.62]]
const THUMB_SIDE = 160

async function decode(file: File): Promise<{ source: CanvasImageSource; width: number; height: number; release: () => void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { source: bitmap, width: bitmap.width, height: bitmap.height, release: () => bitmap.close() }
    } catch { /* fall through to an <img> */ }
  }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.decoding = 'async'
    image.src = url
    await image.decode()
    return { source: image, width: image.naturalWidth, height: image.naturalHeight, release: () => URL.revokeObjectURL(url) }
  } catch (error) {
    URL.revokeObjectURL(url)
    throw error
  }
}

function draw(source: CanvasImageSource, from: { width: number; height: number }, side: number, quality: number): string {
  const size = fitWithin(from.width, from.height, side)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('canvas unavailable')
  // JPEG has no see-through: a transparent PNG would otherwise turn black.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, size.width, size.height)
  context.drawImage(source, 0, 0, size.width, size.height)
  return canvas.toDataURL('image/jpeg', quality)
}

export async function preparePhoto(file: File): Promise<PhotoResult> {
  if (!/^image\//i.test(file.type)) return { error: 'That file is not a picture.' }
  if (file.size > 40 * 1024 * 1024) return { error: 'That photo is too large. Pick one under 40 MB.' }
  let decoded: Awaited<ReturnType<typeof decode>>
  try { decoded = await decode(file) } catch {
    return { error: 'This browser could not open that photo. Take it again, or share it as a JPEG, then try once more.' }
  }
  try {
    let full = ''
    for (const [side, quality] of FULL_STEPS) {
      full = draw(decoded.source, decoded, side, quality)
      if (full.length <= MAX_IMAGE_CHARS) break
    }
    if (!full || full.length > MAX_IMAGE_CHARS) return { error: 'That photo is too detailed to send. Take a closer shot of the part you want looked at.' }
    const thumb = draw(decoded.source, decoded, THUMB_SIDE, 0.7)
    return { photo: { name: file.name || 'photo.jpg', full, thumb } }
  } catch {
    return { error: 'That photo could not be prepared. Try a different one.' }
  } finally {
    decoded.release()
  }
}
