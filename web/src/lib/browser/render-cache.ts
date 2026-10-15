/**
 * Small helpers so a picture of a page is not taken twice when it does not need to be.
 *
 *  - RenderCache keeps a few finished results for a few minutes, and when two people ask for the same thing at once it runs
 *    once and gives both the answer.
 *  - Gate limits how many pages render at the same time on one server, so a busy moment cannot start dozens of browsers.
 *
 * Both live in the memory of one server instance. That is enough: a miss only costs one more picture.
 * Plain TypeScript with no imports, so it runs on the server and under `node --test`.
 */

export interface CacheOptions {
  maxEntries: number
  maxBytes: number
  ttlMs: number
  now?: () => number
}

interface Entry<T> { value: T; bytes: number; at: number }

export class RenderCache<T> {
  private items = new Map<string, Entry<T>>()
  private running = new Map<string, Promise<T>>()
  private total = 0
  private opts: CacheOptions

  constructor(opts: CacheOptions) {
    this.opts = opts
  }

  private now(): number { return (this.opts.now || Date.now)() }

  get(key: string): T | undefined {
    const hit = this.items.get(key)
    if (!hit) return undefined
    if (this.now() - hit.at > this.opts.ttlMs) { this.drop(key); return undefined }
    // Most recently used goes to the back, so the front is always the oldest.
    this.items.delete(key)
    this.items.set(key, hit)
    return hit.value
  }

  set(key: string, value: T, bytes: number): void {
    if (bytes > this.opts.maxBytes) return
    this.drop(key)
    this.items.set(key, { value, bytes, at: this.now() })
    this.total += bytes
    while (this.items.size > this.opts.maxEntries || this.total > this.opts.maxBytes) {
      const oldest = this.items.keys().next().value
      if (oldest === undefined) break
      this.drop(oldest)
    }
  }

  private drop(key: string) {
    const hit = this.items.get(key)
    if (hit) { this.total -= hit.bytes; this.items.delete(key) }
  }

  /** Run `make` once for this key at a time. Everyone who asks while it runs gets the same answer (or the same failure). */
  dedupe(key: string, make: () => Promise<T>): Promise<T> {
    const going = this.running.get(key)
    if (going) return going
    const p = make().finally(() => { this.running.delete(key) })
    this.running.set(key, p)
    return p
  }

  get size(): number { return this.items.size }
  get bytes(): number { return this.total }
  get inFlight(): number { return this.running.size }
}

/** At most `max` things at once. `enter()` returns a function that lets the next one in, or null if it is full. */
export class Gate {
  private active = 0
  private max: number

  constructor(max: number) {
    this.max = Math.max(1, max)
  }

  enter(): (() => void) | null {
    if (this.active >= this.max) return null
    this.active++
    let done = false
    return () => { if (!done) { done = true; this.active = Math.max(0, this.active - 1) } }
  }

  get busy(): number { return this.active }
}
