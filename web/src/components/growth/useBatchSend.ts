'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { SmsResult } from './send'

export interface RunState {
  phase: 'idle' | 'running' | 'waiting' | 'done'
  total: number
  done: number
  sent: number
  optedOut: number
  failed: number
  unlogged: number
  stopped: boolean
  /** Set when the whole run was cut short because every remaining text would fail the same way. */
  halted: string
  current: string
  failures: { name: string; reason: string }[]
}

export const IDLE_RUN: RunState = { phase: 'idle', total: 0, done: 0, sent: 0, optedOut: 0, failed: 0, unlogged: 0, stopped: false, halted: '', current: '', failures: [] }

const wait = (ms: number, shouldStop: () => boolean) => new Promise<void>(resolve => {
  const end = Date.now() + ms
  const tick = () => { if (shouldStop() || Date.now() >= end) resolve(); else setTimeout(tick, 400) }
  tick()
})

/**
 * Sends to people one at a time so it can show progress and be stopped.
 * `sendOne` does the send; `afterSent` records it (a failure there never turns a sent text into a failed one).
 */
export function useBatchSend() {
  const [run, setRun] = useState<RunState>(IDLE_RUN)
  const stopRef = useRef(false)
  const busyRef = useRef(false)
  const aliveRef = useRef(true)
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false } }, [])
  const put = useCallback((next: RunState | ((s: RunState) => RunState)) => { if (aliveRef.current) setRun(next) }, [])

  const start = useCallback(async <T extends Record<string, any>>(
    items: T[],
    sendOne: (item: T) => Promise<SmsResult>,
    afterSent?: (item: T) => Promise<void>,
  ) => {
    if (busyRef.current || items.length === 0) return
    busyRef.current = true
    stopRef.current = false
    let s: RunState = { ...IDLE_RUN, phase: 'running', total: items.length }
    put(s)
    for (const item of items) {
      if (stopRef.current) break
      const who = String(item.name || 'Customer')
      s = { ...s, phase: 'running', current: who }
      put(s)
      let result: SmsResult = { kind: 'failed', error: 'The text did not send.' }
      for (let attempt = 0; attempt < 4; attempt++) {
        result = await sendOne(item)
        if (result.kind !== 'rate' || stopRef.current) break
        s = { ...s, phase: 'waiting' }
        put(s)
        await wait(result.waitMs, () => stopRef.current)
        if (stopRef.current) break
      }
      if (result.kind === 'rate' && stopRef.current) break
      if (result.kind === 'sent') {
        let unlogged = s.unlogged
        try { await afterSent?.(item) } catch { unlogged += 1 }
        s = { ...s, done: s.done + 1, sent: s.sent + 1, unlogged }
      } else if (result.kind === 'optedOut') {
        s = { ...s, done: s.done + 1, optedOut: s.optedOut + 1 }
      } else {
        const reason = result.kind === 'rate' ? 'Too many texts at once. Try the rest in a minute.' : result.error
        s = { ...s, done: s.done + 1, failed: s.failed + 1, failures: [...s.failures, { name: who, reason }] }
        if (result.kind === 'failed' && result.fatal) { s = { ...s, halted: reason }; put(s); break }
      }
      put(s)
    }
    s = { ...s, phase: 'done', stopped: stopRef.current && s.done < s.total, current: '' }
    put(s)
    busyRef.current = false
  }, [put])

  const stop = useCallback(() => { stopRef.current = true }, [])
  const reset = useCallback(() => { if (!busyRef.current) put(IDLE_RUN) }, [put])
  return { run, start, stop, reset }
}
