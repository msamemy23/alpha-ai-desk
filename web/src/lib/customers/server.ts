/**
 * Read helpers the /api/customers routes share. Everything here only reads. A caller passes a function that builds one page
 * of a query (already filtered by the signed-in shop), and this walks the pages so a shop with more than 1,000 rows is read
 * whole instead of cut off at the database's default page size.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { DupInput } from './duplicates.ts'

export const PAGE_SIZE = 1000

type Page<T> = PromiseLike<{ data: T[] | null; error: unknown }>

export interface ReadAll<T> {
  rows: T[]
  /** True when the read failed part way. The rows are then incomplete and must not be used as if they were everything. */
  failed: boolean
  /** The error, so a caller can tell a missing table from any other failure. */
  error: unknown
  /** True when there were more than `max` rows and the rest were not read. */
  truncated: boolean
}

export async function readAll<T>(page: (from: number, to: number) => Page<T>, max = 20000): Promise<ReadAll<T>> {
  const rows: T[] = []
  for (let from = 0; from < max; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1)
    if (error) return { rows, failed: true, error, truncated: false }
    const got = data || []
    rows.push(...got)
    if (got.length < PAGE_SIZE) return { rows, failed: false, error: null, truncated: false }
  }
  return { rows, failed: false, error: null, truncated: true }
}

/** Splits a long list of ids into groups small enough for one query. */
export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}

/** A customer id as the routes accept it: a UUID, nothing else. */
export const isCustomerId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f-]{32,36}$/i.test(v.trim())

export type BookRow = DupInput & { name: string; phone: string; email: string; vehicle_vin: string; vehicle_plate: string }

/** Every customer of this shop with just the fields the duplicate checks compare. The shop id is part of the query. */
export async function loadBook(db: SupabaseClient, shopId: string): Promise<ReadAll<BookRow>> {
  return readAll<BookRow>((a, b) => db.from('customers').select('id,name,phone,email,vehicle_vin,vehicle_plate').eq('shop_id', shopId).order('id').range(a, b))
}

/** One customer of this shop (just the id and name), or null when the id is not one of this shop's customers. */
export async function loadCustomerRef(db: SupabaseClient, shopId: string, customerId: unknown): Promise<{ customer: { id: string; name: string } | null; failed: boolean }> {
  if (!isCustomerId(customerId)) return { customer: null, failed: false }
  const { data, error } = await db.from('customers').select('id,name').eq('shop_id', shopId).eq('id', customerId.trim()).maybeSingle()
  if (error) return { customer: null, failed: true }
  return { customer: data ? { id: String(data.id), name: String(data.name || '').trim() } : null, failed: false }
}
