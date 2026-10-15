/**
 * The device's location for the clock-in check. Asked for once, when a person clocks in, and sent to our own server only; the
 * server keeps "inside", "outside" or "unknown" and the distance, not the coordinates. Nothing here talks to any other service.
 */
export interface Fix { lat: number; lng: number; accuracy: number }

export interface FixResult { fix: Fix | null; problem: string }

export function readDeviceFix(timeoutMs = 9000): Promise<FixResult> {
  if (typeof navigator === 'undefined' || !navigator.geolocation) {
    return Promise.resolve({ fix: null, problem: 'This device cannot share its location.' })
  }
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ fix: { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }, problem: '' }),
      err => resolve({
        fix: null,
        problem: err.code === 1 ? 'Location is blocked for this page. Allow it in the browser settings and try again.'
          : err.code === 3 ? 'The device took too long to find its location. Try again.'
          : 'The device could not find its location.',
      }),
      { enableHighAccuracy: false, timeout: timeoutMs, maximumAge: 60_000 },
    )
  })
}
