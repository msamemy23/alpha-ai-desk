// Gives a signed-in person their shop the first time they arrive, and finds it again every time after.
// The database no longer lets the browser run the shop-creating function, so the sign-in screens ask the server
// (app/api/shop/ensure), and the server does the same steps here with the service client:
//   1. an active membership already exists  -> that shop, nothing created
//   2. the person once had a shop or a membership (now revoked) -> refuse, never create a replacement
//   3. otherwise create the shop profile (the database trigger makes them its owner) and check they are the owner

interface Query { [method: string]: (...args: unknown[]) => unknown }
export interface BootstrapDb { from: (table: string) => Query }

export class BootstrapError extends Error {
  status: number
  constructor(message: string, status: number) { super(message); this.status = status }
}

type Row = Record<string, unknown>
type Result<T> = { data: T | null; error: { message?: string } | null }

// Typed thin wrappers so the logic below reads plainly.
const q = (db: BootstrapDb, table: string) => db.from(table) as unknown as {
  select: (cols: string) => {
    eq: (c: string, v: string) => {
      eq: (c: string, v: string) => { order: (c: string, o: { ascending: boolean }) => { order: (c: string, o: { ascending: boolean }) => { limit: (n: number) => { maybeSingle: () => Promise<Result<Row>> } } } }
      limit: (n: number) => Promise<Result<Row[]>>
      maybeSingle: () => Promise<Result<Row>>
    }
  }
  insert: (row: Row) => { select: (cols: string) => { single: () => Promise<Result<Row>> } } & Promise<Result<null>>
}

const inFlight = new Map<string, Promise<{ id: string; created: boolean }>>()

async function activeShop(db: BootstrapDb, userId: string): Promise<{ id: string } | null> {
  const { data, error } = await q(db, 'shop_memberships').select('shop_id').eq('user_id', userId).eq('status', 'active')
    .order('created_at', { ascending: true }).order('shop_id', { ascending: true }).limit(1).maybeSingle()
  if (error) throw new BootstrapError('Your shop could not be looked up. Try again.', 500)
  return data?.shop_id ? { id: String(data.shop_id) } : null
}

export function cleanShopName(value: unknown): string {
  const text = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
  return (text || 'My Shop').slice(0, 120)
}

async function run(db: BootstrapDb, userId: string, shopName: string): Promise<{ id: string; created: boolean }> {
  const existing = await activeShop(db, userId)
  if (existing) return { id: existing.id, created: false }

  const profile = await q(db, 'shop_profiles').select('id').eq('user_id', userId).limit(1)
  const member = await q(db, 'shop_memberships').select('shop_id').eq('user_id', userId).limit(1)
  if (profile.error || member.error) throw new BootstrapError('Your shop could not be looked up. Try again.', 500)
  if ((profile.data || []).length > 0 || (member.data || []).length > 0) {
    throw new BootstrapError('Your shop access is inactive. Contact the shop owner.', 403)
  }

  const made = await q(db, 'shop_profiles').insert({ user_id: userId, shop_name: shopName }).select('id').single()
  if (made.error || !made.data?.id) {
    // Two sign-ins at the same moment: the other one won, so use the shop it made.
    const raced = await activeShop(db, userId).catch(() => null)
    if (raced) return { id: raced.id, created: false }
    throw new BootstrapError('Your shop could not be created. Try again.', 500)
  }
  const shopId = String(made.data.id)

  // The database trigger makes the creator the owner. If it did not, do the same thing it would have done.
  const owner = await activeShop(db, userId)
  if (!owner) {
    const added = await q(db, 'shop_memberships').insert({ shop_id: shopId, user_id: userId, role: 'owner', status: 'active' }) as unknown as Result<null>
    if (added.error) throw new BootstrapError('Your shop was created but could not be opened. Try again.', 500)
  }
  return { id: shopId, created: true }
}

/** Same person asking twice at once (two tabs, a double redirect) gets one answer and one shop. */
export function ensureShopForUser(db: BootstrapDb, userId: string, shopName: unknown): Promise<{ id: string; created: boolean }> {
  const running = inFlight.get(userId)
  if (running) return running
  const job = run(db, userId, cleanShopName(shopName)).finally(() => { inFlight.delete(userId) })
  inFlight.set(userId, job)
  return job
}
