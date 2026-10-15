// The sums behind the "Cover plate or VIN" tool: how big the cleaned photo is, and where a dragged box lands.
// Pure: no browser, no network. The drawing itself is in the Posts screen.

export interface Box { x: number; y: number; w: number; h: number }

/** A box smaller than this on either side is a stray touch, not a cover. */
export const MIN_BOX = 12

/** The size of the cleaned photo: the long side is at most `max`, never enlarged. */
export function fitSize(width: number, height: number, max = 1600): { width: number; height: number } {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  const scale = Math.min(1, max / Math.max(w, h))
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) }
}

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n))

/** The box between two drag points, in either direction, kept inside the photo. Null when it is too small to be a cover. */
export function boxFromDrag(x0: number, y0: number, x1: number, y1: number, width: number, height: number, min = MIN_BOX): Box | null {
  if (![x0, y0, x1, y1, width, height].every(Number.isFinite) || width <= 0 || height <= 0) return null
  const left = clamp(Math.min(x0, x1), 0, width)
  const right = clamp(Math.max(x0, x1), 0, width)
  const top = clamp(Math.min(y0, y1), 0, height)
  const bottom = clamp(Math.max(y0, y1), 0, height)
  const w = right - left
  const h = bottom - top
  if (w < min || h < min) return null
  return { x: left, y: top, w, h }
}

/** A band across the whole photo for people who cannot drag: the top, middle or bottom third. */
export function stripBox(which: 'top' | 'middle' | 'bottom', width: number, height: number): Box {
  const third = height / 3
  const y = which === 'top' ? 0 : which === 'middle' ? third : height - third
  return { x: 0, y, w: width, h: third }
}
