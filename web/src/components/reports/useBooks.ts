'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { getJson, postJson } from '@/lib/client-api'
import type { ApiResult } from '@/lib/client-api'
import type { SavedAccount } from '@/lib/accounting'
import type { BooksSettings, Resource } from '@/lib/books-store'
import { DEFAULT_SETTINGS } from '@/lib/books-store'
import type { Expense } from '@/lib/expenses'
import type { CloseSaved } from '@/lib/month-close'

/** The shop's books as the server sends them. Each part has its own state, so one missing table never hides the rest. */
export interface BooksData {
  settings: Resource<BooksSettings>
  mappings: Resource<SavedAccount[]>
  expenses: Resource<Expense[]>
  closes: Resource<CloseSaved[]>
}

export type BooksState =
  | { status: 'loading' }
  /** The signed-in person's role cannot see the books. Reports built from invoices still work. */
  | { status: 'forbidden' }
  | { status: 'error'; message: string }
  | { status: 'ready'; books: BooksData }

const NONE = <T,>(value: T): Resource<T> => ({ state: 'ok', value, error: '' })
/** Stable empty lists, so a fallback never makes a memo or an effect see a new value on every render. */
export const NO_ACCOUNTS: SavedAccount[] = []
export const NO_EXPENSES: Expense[] = []
export const NO_CLOSES: CloseSaved[] = []
export const EMPTY_BOOKS: BooksData = { settings: NONE({ ...DEFAULT_SETTINGS }), mappings: NONE([]), expenses: NONE([]), closes: NONE([]) }

/**
 * Settings, account names, bills and month-end checklists. Loaded only when `enabled`, because most report tabs do not need them.
 * `act` runs one change and, when it worked, reads everything again so the screen always shows what was really saved.
 */
export function useBooks(enabled: boolean) {
  const [state, setState] = useState<BooksState>({ status: 'loading' })
  const seq = useRef(0)
  const started = useRef(false)

  const load = useCallback(async () => {
    const mine = ++seq.current
    const r = await getJson<BooksData>('/api/accounting/books')
    if (mine !== seq.current) return
    if (r.ok) setState({ status: 'ready', books: r.data })
    else if (r.forbidden) setState({ status: 'forbidden' })
    else setState({ status: 'error', message: r.message })
  }, [])

  useEffect(() => {
    if (!enabled || started.current) return
    started.current = true
    void load()
  }, [enabled, load])
  useEffect(() => { const stop = () => { seq.current += 1 }; return stop }, [])

  const act = useCallback(async <T = Record<string, unknown>>(body: Record<string, unknown>): Promise<ApiResult<T>> => {
    const r = await postJson<T>('/api/accounting/books', body)
    if (r.ok) await load()
    return r
  }, [load])

  return { state, reload: load, act }
}
