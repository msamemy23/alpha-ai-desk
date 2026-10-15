export const dynamic = 'force-dynamic'
import { authed, fail, ok, readBody } from '@/lib/receptionist-api'
import { getThreadState, loadRules, setThreadState } from '@/lib/voice/store'
import { resolveNeedsPerson } from '@/lib/voice/actions'
import { phoneKey } from '@/lib/voice/rules'

/** Whether the assistant is paused on one customer's text thread, and whether it is waiting for a person. */
export async function GET(req: Request) {
  const a = await authed()
  if (!a.ok) return a.res
  const { auth, db } = a
  const key = phoneKey(new URL(req.url).searchParams.get('key'))
  if (key.length < 7) return fail('Missing number.')
  const [thread, loaded] = await Promise.all([getThreadState(db, auth.shopId, 'sms', key), loadRules(db, auth.shopId)])
  const t = thread.state
  const pausedNow = Boolean(t.pausedUntil && Date.parse(t.pausedUntil) > Date.now())
  return ok({
    unavailable: thread.unavailable,
    textsMode: loaded.rules.texts_mode,
    needsPerson: t.needsPerson, needsReason: t.needsReason, needsSince: t.needsSince,
    paused: pausedNow, pausedUntil: pausedNow ? t.pausedUntil : null, pauseReason: pausedNow ? t.pauseReason : null,
  })
}

/** Pause the assistant on this thread, let it answer again, or mark "needs a person" as handled. */
export async function POST(req: Request) {
  const a = await authed({ write: true })
  if (!a.ok) return a.res
  const { auth, db } = a
  const body = await readBody(req)
  const key = phoneKey(body?.key)
  if (!body || key.length < 7) return fail('Missing number.')
  if (body.action === 'pause') {
    const loaded = await loadRules(db, auth.shopId)
    const until = new Date(Date.now() + loaded.rules.takeover_hours * 3_600_000).toISOString()
    const r = await setThreadState(db, auth.shopId, 'sms', key, { pausedUntil: until, pauseReason: 'manual' }, auth.userId)
    return r.ok ? ok({ pausedUntil: until }) : fail(r.unavailable ? 'This needs a database update first.' : 'Could not save.', r.unavailable ? 503 : 500)
  }
  if (body.action === 'resume') {
    const r = await setThreadState(db, auth.shopId, 'sms', key, { pausedUntil: null, pauseReason: null, resumedAt: new Date().toISOString() }, auth.userId)
    return r.ok ? ok({}) : fail(r.unavailable ? 'This needs a database update first.' : 'Could not save.', r.unavailable ? 503 : 500)
  }
  if (body.action === 'resolve') {
    await resolveNeedsPerson(db, auth.shopId, key, auth.userId)
    return ok({})
  }
  return fail('Unknown action.')
}
