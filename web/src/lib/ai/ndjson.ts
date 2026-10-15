/**
 * Reads the assistant's live progress stream: one JSON object per line.
 *
 *   {"type":"progress","kind":"status","label":"Reading your request"}
 *   {"type":"progress","kind":"tool","tool":"searchCustomers","status":"running"}
 *   {"type":"final","status":200,"body":{ ...the same answer the plain JSON call gives... }}
 *
 * A line that is cut in half stays in `rest` until the rest of it arrives. A line that is not
 * valid JSON is dropped, never guessed at. Only the `final` line is an answer: a stream that
 * ends without one is a failure, and the caller must say so instead of inventing a result.
 *
 * Pure module: no imports from '@/' so node:test can load it directly.
 */

export type StreamProgress =
  | { type: 'progress'; kind: 'status'; label: string }
  | { type: 'progress'; kind: 'tool'; tool: string; status: 'running' | 'ok' | 'error'; detail?: string }

export type StreamFinal = { type: 'final'; status: number; body: unknown }
export type StreamEvent = StreamProgress | StreamFinal

function plainText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

/** Accept only the shapes the server sends; anything else is ignored. */
export function toStreamEvent(value: unknown): StreamEvent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  if (item.type === 'final') {
    return typeof item.status === 'number' && Number.isFinite(item.status) ? { type: 'final', status: item.status, body: item.body } : null
  }
  if (item.type !== 'progress') return null
  if (item.kind === 'status') {
    const label = plainText(item.label, 120)
    return label ? { type: 'progress', kind: 'status', label } : null
  }
  if (item.kind === 'tool') {
    const tool = plainText(item.tool, 60)
    if (!tool || !['running', 'ok', 'error'].includes(String(item.status))) return null
    const detail = plainText(item.detail, 200)
    return { type: 'progress', kind: 'tool', tool, status: item.status as 'running' | 'ok' | 'error', ...(detail ? { detail } : {}) }
  }
  return null
}

/** Split what has arrived so far into whole events and the unfinished tail. */
export function parseNdjsonChunk(buffer: string): { events: StreamEvent[]; rest: string } {
  const lines = buffer.split('\n')
  const rest = lines.pop() ?? ''
  const events: StreamEvent[] = []
  for (const line of lines) {
    const text = line.trim()
    if (!text) continue
    try {
      const event = toStreamEvent(JSON.parse(text))
      if (event) events.push(event)
    } catch { /* a damaged line is dropped, never guessed at */ }
  }
  return { events, rest }
}

/** The last `final` event wins; there is no answer without one. */
export function finalOf(events: StreamEvent[]): StreamFinal | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event.type === 'final') return event
  }
  return null
}
