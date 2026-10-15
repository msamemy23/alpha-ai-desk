/**
 * The small part of the database client the reports, accounting and parts code uses. Anything that fits this shape works:
 * the signed-in browser client, the server's service client (cast at the call site) and the in-memory stand-in the tests use.
 * Keeping it this small is what lets the server rules be tested without a database.
 */
export type Row = Record<string, unknown>

export interface DbError { code?: string; message?: string; details?: string; hint?: string }
export interface DbResult<T> { data: T | null; error: DbError | null; count?: number | null }

export interface Query extends PromiseLike<DbResult<Row[]>> {
  select(columns?: string, options?: { count?: 'exact'; head?: boolean }): Query
  insert(values: Row | Row[]): Query
  update(values: Row): Query
  upsert(values: Row | Row[], options?: { onConflict?: string }): Query
  delete(): Query
  eq(column: string, value: unknown): Query
  neq(column: string, value: unknown): Query
  gt(column: string, value: unknown): Query
  gte(column: string, value: unknown): Query
  lt(column: string, value: unknown): Query
  lte(column: string, value: unknown): Query
  in(column: string, values: unknown[]): Query
  is(column: string, value: null | boolean): Query
  not(column: string, operator: string, value: unknown): Query
  or(filter: string): Query
  order(column: string, options?: { ascending?: boolean }): Query
  limit(count: number): Query
  range(from: number, to: number): Query
  maybeSingle(): PromiseLike<DbResult<Row>>
  single(): PromiseLike<DbResult<Row>>
}

export interface Db {
  from(table: string): Query
  rpc(fn: string, args?: Row): PromiseLike<DbResult<unknown>>
}
