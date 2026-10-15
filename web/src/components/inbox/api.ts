// Small helpers for the Inbox and AI screens' own calls to the app's API. Nothing here throws.
import { supabase } from '@/lib/supabase'

export async function authHeaders(json = true): Promise<Record<string, string>> {
  const headers: Record<string, string> = json ? { 'Content-Type': 'application/json' } : {}
  try {
    const { data } = await supabase.auth.getSession()
    if (data.session?.access_token) headers.Authorization = 'Bearer ' + data.session.access_token
  } catch { /* the request goes without it and the server says so */ }
  return headers
}

export interface ApiResult<T> {
  ok: boolean
  status: number
  data: T | null
  /** Plain words from the server, or a fallback. Empty when ok. */
  error: string
  /** The feature needs a database update that has not been applied yet. */
  unavailable: boolean
}

/** Calls one of the app's own routes. A page that is not JSON, a network drop and a server error all come back as `ok: false`. */
export async function api<T = Record<string, any>>(url: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method: init.method || (init.body === undefined ? 'GET' : 'POST'),
      headers: await authHeaders(init.body !== undefined),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
    })
    const json = await res.json().catch(() => null) as (Record<string, any> | null)
    if (!res.ok || !json || json.ok === false) {
      return { ok: false, status: res.status, data: json as T | null, error: String(json?.error || 'Something went wrong. Try again.'), unavailable: json?.unavailable === true }
    }
    return { ok: true, status: res.status, data: json as T, error: '', unavailable: json.unavailable === true }
  } catch {
    return { ok: false, status: 0, data: null, error: 'Could not reach the server. Check your connection and try again.', unavailable: false }
  }
}
