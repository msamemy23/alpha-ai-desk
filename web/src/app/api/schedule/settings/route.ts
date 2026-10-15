import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'node:crypto'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { cleanCapacity } from '@/lib/schedule-capacity'
import { cleanOnline, makeSlug } from '@/lib/booking'
import { cleanBoard } from '@/lib/jobflow'
import { defaultSchedule, loadSchedule, loadShopInfo, saveSchedule } from '@/lib/schedule-store'

export const dynamic = 'force-dynamic'

/**
 * The shop's scheduling settings: hours, how many cars fit, service times, the public booking page, the calendar feed,
 * and the shop-board options. Reading is open to the team. Changing is for owners, admins and managers.
 * Until migration 050 is applied, reading returns the built-in defaults with `migrated: false` and saving says so.
 */
const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
const canChange = (role: string) => role === 'owner' || role === 'admin' || role === 'manager'

export async function GET() {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  try {
    const [s, info] = await Promise.all([loadSchedule(auth.shopId), loadShopInfo(auth.shopId)])
    return reply({
      ok: true, migrated: s.migrated, capacity: s.capacity, online: s.online, board: s.board, timezone: info.timezone,
      // The feed address is a secret: only people who can change settings are given it.
      icalToken: canChange(auth.role) ? s.icalToken : null, icalOn: Boolean(s.icalToken), canChange: canChange(auth.role),
    })
  } catch {
    return reply({ ok: false, error: 'Schedule settings could not be loaded' }, 500)
  }
}

export async function PUT(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (!canChange(auth.role)) return forbidden()
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return reply({ ok: false, error: 'Nothing was sent' }, 400)

  let current
  try { current = await loadSchedule(auth.shopId) } catch { return reply({ ok: false, error: 'Schedule settings could not be loaded' }, 500) }
  if (!current.migrated) return reply({ ok: false, migrated: false, error: 'Schedule settings need a database update before they can be saved.' }, 409)

  const patch: Parameters<typeof saveSchedule>[1] = {}
  const capacity = body.capacity !== undefined ? cleanCapacity(body.capacity) : current.capacity
  if (body.capacity !== undefined) patch.capacity = capacity
  if (body.board !== undefined) patch.board = cleanBoard(body.board)

  if (body.online !== undefined) {
    let online = cleanOnline({ ...(body.online as object), slug: (body.online as Record<string, unknown>)?.slug || current.online.slug })
    const wantsOn = (body.online as Record<string, unknown>)?.enabled === true
    if (wantsOn) {
      if (capacity.techCount < 1) return reply({ ok: false, error: 'Say how many technicians work on a normal day before you turn on online booking.' }, 400)
      if (!capacity.services.some(s => s.online)) return reply({ ok: false, error: 'Turn on at least one service for online booking.' }, 400)
      if (!online.slug) {
        const info = await loadShopInfo(auth.shopId)
        online = cleanOnline({ ...online, enabled: true, slug: makeSlug(info.name) })
      } else online = cleanOnline({ ...online, enabled: true })
    }
    patch.online = online
  }

  const ical = body.ical
  if (ical === 'on' || ical === 'reset') patch.icalToken = randomBytes(24).toString('base64url')
  else if (ical === 'off') patch.icalToken = null

  // A booking address that is taken is retried with a fresh ending, a few times, before giving up.
  let result = await saveSchedule(auth.shopId, patch)
  for (let tries = 0; !result.ok && result.code === 'slug-taken' && patch.online && tries < 4; tries++) {
    const info = await loadShopInfo(auth.shopId)
    patch.online = cleanOnline({ ...patch.online, enabled: true, slug: makeSlug(info.name) })
    result = await saveSchedule(auth.shopId, patch)
  }
  if (!result.ok) {
    if (result.code === 'missing') return reply({ ok: false, migrated: false, error: 'Schedule settings need a database update before they can be saved.' }, 409)
    return reply({ ok: false, error: 'The settings could not be saved' }, 500)
  }
  const fresh = await loadSchedule(auth.shopId).catch(() => defaultSchedule(true))
  return reply({ ok: true, migrated: true, capacity: fresh.capacity, online: fresh.online, board: fresh.board, icalToken: fresh.icalToken, icalOn: Boolean(fresh.icalToken), canChange: true })
}
