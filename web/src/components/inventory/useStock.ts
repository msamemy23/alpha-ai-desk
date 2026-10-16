'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getJson, postJson } from '@/lib/client-api'
import type { ApiResult } from '@/lib/client-api'
import type { InventoryData } from '@/lib/inventory-store'
import type { SoldLine } from '@/lib/inventory-logic'

/** Everything /api/inventory sends for the Inventory screen: each part of it has its own state, so one missing table never hides the rest. */
export interface StockData extends InventoryData {
  sold: { state: 'ok' | 'error'; lines: SoldLine[]; error: string } | null
  shop: { name: string; address: string; phone: string; email: string }
  today: string
  /** The signed-in person may order, price and manage vendors. Everyone but a viewer may count, receive and log returns. */
  canBuy: boolean
  /** Counting, receiving and logging returns: everyone but a viewer. */
  canAdjust: boolean
}

export type StockState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: StockData }

/** What panels get: the data, a way to change something, and a way to say it worked. */
export type StockAct = <T = Record<string, unknown>>(body: Record<string, unknown>) => Promise<ApiResult<T>>

/** Never-changing empty lists, so a fallback does not make a memo see a new value on every render. */
export const NO_ROWS: never[] = []

/**
 * Vendors, orders, returns, prices and the sales behind the reorder list. `act` runs one change and, when it worked, reads everything
 * again, so the screen always shows what was really saved. The parts themselves are loaded by the Inventory page.
 */
export function useStock() {
  const [state, setState] = useState<StockState>({ status: 'loading' })
  const seq = useRef(0)

  const load = useCallback(async () => {
    const mine = ++seq.current
    const r = await getJson<StockData>('/api/inventory?sold=90')
    if (mine !== seq.current) return
    if (r.ok) setState({ status: 'ready', data: r.data })
    else setState(prev => (prev.status === 'ready' ? prev : { status: 'error', message: r.message }))
  }, [])

  useEffect(() => { void load() }, [load])
  useEffect(() => () => { seq.current += 1 }, [])

  const act = useCallback<StockAct>(async <T,>(body: Record<string, unknown>) => {
    const r = await postJson<T>('/api/inventory', body)
    if (r.ok) await load()
    return r
  }, [load])

  return { state, reload: load, act }
}
