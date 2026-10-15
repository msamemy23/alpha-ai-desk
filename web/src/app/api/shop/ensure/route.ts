export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getSessionUser, unauthorized } from '@/lib/api-auth'
import { checkRateLimit } from '@/lib/rate-limit'
import { BootstrapError, ensureShopForUser } from '@/lib/shop-bootstrap'
import type { BootstrapDb } from '@/lib/shop-bootstrap'

// Called by the sign-in screens right after a person signs in or signs up. Returns the shop they belong to, and
// creates one only for a person who has never had one.
export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return unauthorized()
  if (!checkRateLimit(`shop-ensure:${user.id}`, 20, 60_000).ok) return NextResponse.json({ error: 'Too many tries. Wait a minute.' }, { status: 429 })
  const body = await req.json().catch(() => null)
  try {
    const shop = await ensureShopForUser(getServiceClient() as unknown as BootstrapDb, user.id, body && typeof body === 'object' ? (body as { shopName?: unknown }).shopName : undefined)
    return NextResponse.json({ id: shop.id, created: shop.created })
  } catch (error) {
    if (error instanceof BootstrapError) return NextResponse.json({ error: error.message }, { status: error.status })
    console.error('[shop] ensure failed:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Your shop could not be set up. Try again.' }, { status: 500 })
  }
}
