/**
 * The location check at clock-in: how far a device is from the shop, and whether that counts as at the shop. The device
 * location is used for the check and thrown away: only inside, outside or unknown and the distance are kept. Imports nothing.
 */

export interface Point { lat: number; lng: number }

const R = 6_371_000
const rad = (d: number): number => (d * Math.PI) / 180

/** Metres between two points on the earth (haversine). */
export function distanceM(a: Point, b: Point): number {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)))
}

export interface DeviceFix { lat: number; lng: number; accuracy: number | null }

/** A fix from a request body, or null when it is missing or nonsense. */
export function readFix(v: unknown): DeviceFix | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const lat = Number(o.lat)
  const lng = Number(o.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
  const acc = Number(o.accuracy)
  return { lat, lng, accuracy: Number.isFinite(acc) && acc >= 0 ? acc : null }
}

export type LocationStatus = 'inside' | 'outside' | 'unknown'

export interface LocationCheck { status: LocationStatus; distanceM: number | null }

/**
 * Inside when the device is within the shop's radius, with the device's own stated accuracy (up to 100 m) allowed for.
 * Unknown when there is no usable fix or the device says it is accurate only to a kilometre or worse.
 */
export function checkLocation(fence: { lat: number; lng: number; radiusM: number }, fix: DeviceFix | null): LocationCheck {
  if (!fix) return { status: 'unknown', distanceM: null }
  if (fix.accuracy !== null && fix.accuracy > 1000) return { status: 'unknown', distanceM: Math.round(distanceM(fence, fix)) }
  const d = distanceM(fence, fix)
  const slack = Math.min(fix.accuracy ?? 0, 100)
  return { status: d <= fence.radiusM + slack ? 'inside' : 'outside', distanceM: Math.round(d) }
}

/** "about 250 m" or "about 1.4 km", for a message. */
export function distanceWords(m: number): string {
  return m < 1000 ? `about ${Math.round(m / 10) * 10} m` : `about ${(m / 1000).toFixed(1)} km`
}
