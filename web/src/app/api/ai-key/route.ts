import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'
import { writeAuditLog } from '@/lib/audit-log'

export const dynamic = 'force-dynamic'

/**
 * Remove the shop's saved AI provider key.
 *
 * Settings can already replace a key; this is the missing way to take one away. The key is
 * never sent to the browser, so this only needs to say "remove it". Only an owner or admin
 * may do it, it needs the same explicit approval header as every other change, it touches
 * only this shop's one settings row, and it leaves a record in the Activity history.
 * The ChatGPT connection is separate and has its own Disconnect.
 */
const ROLES = new Set(['owner', 'admin'])

function reply(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

export async function DELETE(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (!ROLES.has(auth.role)) return reply({ ok: false, error: 'Only the shop owner or an admin can remove the AI key.' }, 403)
  if (!checkRateLimit(rateLimitKey('ai-key', auth.userId, auth.shopId), 10, 60_000).ok) return reply({ ok: false, error: 'Too many requests. Wait a moment.' }, 429)
  if (req.headers.get('x-ai-approval') !== 'confirm') return reply({ ok: false, error: 'Confirm before removing the key.', approvalRequired: true }, 409)

  const db = getServiceClient()
  const { data: row, error: lookupError } = await db.from('settings').select('id,ai_api_key').eq('shop_id', auth.shopId).order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (lookupError) return reply({ ok: false, error: 'Your settings could not be checked, so nothing was changed.' }, 500)
  if (!row?.id) return reply({ ok: true, removed: false, message: 'There is no saved AI key.' })
  if (!(typeof row.ai_api_key === 'string' && row.ai_api_key.trim())) return reply({ ok: true, removed: false, message: 'There is no saved AI key.' })

  const { error } = await db.from('settings').update({ ai_api_key: null, updated_at: new Date().toISOString() }).eq('id', row.id).eq('shop_id', auth.shopId)
  if (error) return reply({ ok: false, error: 'The key could not be removed. Nothing was changed.' }, 500)

  await writeAuditLog({
    shopId: auth.shopId, userId: auth.userId, action: 'ai.key.cleared', targetType: 'settings', targetId: String(row.id),
    permission: 'write', approved: true, idempotencyKey: `${auth.shopId}:key-cleared:${randomUUID()}`,
    metadata: { summary: 'Removed the saved AI key', undoReason: 'Paste the key again in Settings to put it back.' },
  })
  return reply({ ok: true, removed: true, message: 'The saved AI key was removed.' })
}
