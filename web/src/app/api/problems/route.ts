import { NextResponse } from 'next/server'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import type { Db } from '@/lib/db-types'
import { mayViewProblems } from '@/lib/problems'
import { listProblems } from '@/lib/problems-store'

export const dynamic = 'force-dynamic'

/**
 * The "Problems reported" list for Settings: screens that broke for someone in this shop in the last 7 days, one line per distinct problem.
 * Owner and admins only. It reads counts the server kept (see lib/problems-store.ts) and nothing else; it changes nothing.
 * `needsUpdate` is true when the database update that adds the count table has not been applied yet.
 */
export async function GET() {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (!mayViewProblems(auth.role)) return forbidden()

  const result = await listProblems(getServiceClient() as unknown as Db, auth.shopId)
  if (result.state === 'failed') return NextResponse.json({ ok: false, error: 'The list could not be loaded. Try again in a minute.' }, { status: 502 })
  return NextResponse.json({ ok: true, needsUpdate: result.state === 'needs-update', problems: result.problems })
}
