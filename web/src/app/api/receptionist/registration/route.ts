export const dynamic = 'force-dynamic'
import { authed, fail, ok, readBody, shopSettings } from '@/lib/receptionist-api'
import { appUrl } from '@/lib/voice-runtime'
import { errKind, loadRules } from '@/lib/voice/store'
import { shopFromSettings } from '@/lib/voice/prompt'
import { computeRegistration, mergeRegistration, normalizeReg, REF_FIELDS, registrationCopy } from '@/lib/voice/registration'
import type { RegState } from '@/lib/voice/registration'

async function load(db: any, shopId: string): Promise<{ state: RegState; unavailable: boolean; failed: boolean }> {
  const { data, error } = await db.from('messaging_registration').select('*').eq('shop_id', shopId).maybeSingle()
  if (error) return { state: normalizeReg(null), unavailable: errKind(error) === 'missing', failed: errKind(error) !== 'missing' }
  return { state: normalizeReg(data), unavailable: false, failed: false }
}

/** How far along the carrier registration is, the checklist, and the words to paste into the forms. */
export async function GET() {
  const a = await authed()
  if (!a.ok) return a.res
  const { auth, db } = a
  const [reg, row, loaded] = await Promise.all([
    load(db, auth.shopId),
    shopSettings(db, auth.shopId, 'shop_name,shop_phone,telnyx_phone_number,shop_address,shop_email,timezone,telnyx_api_key,telnyx_messaging_profile_id'),
    loadRules(db, auth.shopId),
  ])
  const number = String(row?.telnyx_phone_number || row?.shop_phone || '')
  const view = computeRegistration(reg.state, {
    hasKey: Boolean(row?.telnyx_api_key), hasNumber: Boolean(number), hasProfile: Boolean(row?.telnyx_messaging_profile_id), number,
  })
  const base = appUrl()
  const webhook = base ? `${base}/api/sms` : ''
  return ok({
    unavailable: reg.unavailable, failed: reg.failed, state: reg.state, view,
    copy: registrationCopy(shopFromSettings(row), loaded.rules, webhook),
    webhook, refFields: REF_FIELDS, canEdit: ['owner', 'admin', 'manager'].includes(auth.role),
  })
}

/** Saves the checklist: which number type, which steps are done, reference numbers and status. */
export async function PUT(req: Request) {
  const a = await authed({ manage: true })
  if (!a.ok) return a.res
  const { auth, db } = a
  const body = await readBody(req)
  if (!body) return fail('Nothing to save.')
  const current = await load(db, auth.shopId)
  if (current.unavailable) return fail('Saving this checklist needs a database update first.', 503, { unavailable: true })
  const now = new Date().toISOString()
  const merged = mergeRegistration(current.state, body, now)
  const { error } = await db.from('messaging_registration').upsert({
    shop_id: auth.shopId, path: merged.path, status: merged.status, items: merged.items, refs: merged.refs, notes: merged.notes || null,
    submitted_at: merged.submitted_at, approved_at: merged.approved_at, updated_by: auth.userId, updated_at: now,
  }, { onConflict: 'shop_id' })
  if (error) return fail('Could not save the checklist. Try again.', 500)
  return ok({ state: merged })
}
