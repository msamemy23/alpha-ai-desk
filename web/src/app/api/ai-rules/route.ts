import { NextRequest, NextResponse } from 'next/server'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'
import { writeAuditLog } from '@/lib/audit-log'
import { loadShopRules, saveShopRules } from '@/lib/ai/shop-rules-server'
import { describeRulesChange } from '@/lib/ai/shop-rules'

export const dynamic = 'force-dynamic'

/**
 * The shop's AI rules (tone, what the assistant may do, what it must never do, facts it may state).
 * Everyone signed in can read them (the assistant needs them); owners and admins can change them.
 * If the database column is not there yet, say so plainly and keep the safe built-in defaults.
 */
const EDIT_ROLES = new Set(['owner', 'admin'])

function reply(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
}

export async function GET() {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  const loaded = await loadShopRules(getServiceClient(), auth.shopId)
  if (loaded.status === 'error') return reply({ ok: false, error: 'The assistant rules could not be loaded.' }, 500)
  return reply({ ok: true, rules: loaded.rules, available: loaded.status === 'ok', canEdit: EDIT_ROLES.has(auth.role) })
}

export async function PUT(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (!EDIT_ROLES.has(auth.role)) return forbidden()
  if (!checkRateLimit(rateLimitKey('ai-rules', auth.userId, auth.shopId), 30, 60_000).ok) return reply({ ok: false, error: 'Too many requests. Wait a moment.' }, 429)
  const body: unknown = await req.json().catch(() => null)
  const record = body && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : null
  if (!record) return reply({ ok: false, error: 'Send the rules as an object.' }, 400)

  const db = getServiceClient()
  const before = await loadShopRules(db, auth.shopId)
  const saved = await saveShopRules(db, auth.shopId, record.rules)
  if (!saved.ok) return reply({ ok: false, error: saved.error, ...(saved.needsDatabaseUpdate ? { available: false } : {}) }, saved.status)

  const summary = describeRulesChange(before.rules, saved.rules)
  if (summary) {
    // The rules govern what the assistant may do, so every change is on the record.
    await writeAuditLog({
      shopId: auth.shopId, userId: auth.userId, action: 'ai.rules.updated', targetType: 'settings', permission: 'write', approved: true,
      idempotencyKey: `${auth.shopId}:rules:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      metadata: { summary },
    })
  }
  return reply({ ok: true, rules: saved.rules, available: true, canEdit: true })
}
