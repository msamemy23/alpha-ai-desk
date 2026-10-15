import { NextRequest, NextResponse } from 'next/server'
import { forbidden, getAuthedShop, getRouteShop, hasInternalApiSecret, unauthorized } from '@/lib/api-auth'
import type { AuthenticatedShop } from '@/lib/api-auth'
import { writeAuditLog } from '@/lib/audit-log'
import { checkRateLimit } from '@/lib/rate-limit'
import { getServiceClient } from '@/lib/supabase'
import { NeedsDatabaseUpdate } from '@/lib/automation-store'
import { approveItem, cancelForJob, cleanPhotos, confirmOutcome, createItem, editItem, prepareJobItem, recoverStuck, refreshNumbers, retryItem, runShop, skipItem } from '@/lib/posts-engine'
import type { Actor, Outcome, PostPorts } from '@/lib/posts-engine'
import { loadShopContext } from '@/lib/posts-model'
import { createPublisher, forwardAuth, readConnections } from '@/lib/posts-publish'
import { createPostStore } from '@/lib/posts-store'
import type { PostDb } from '@/lib/posts-store'
import { buildFacts, candidateJobIds, jobIsFinished, loadInspectionPhotos, loadJob, prepareJobPost, writeCaption } from '@/lib/posts-source'
import type { SourceDeps } from '@/lib/posts-source'
import { itemViews, photoCounts, summarize } from '@/lib/posts-views'
import { emptyFacts, factsProblems } from '@/lib/posts-facts'
import { DEFAULT_POST_SETTINGS, MODE_WORDS, cleanPlatforms, cleanSettings, isPlatform, postsThisMonth, reachable, resolveMode, usedThisWeek } from '@/lib/posts-rules'
import type { PostMode, PostPlatform, QueueRow } from '@/lib/posts-rules'
import type { PostActionFail, PostActionOk, PostErrorCode, PostOverview } from '@/lib/posts-api-types'

// The repair-post queue. Reading is open to everyone in the shop; changing anything needs owner, admin or manager.
// Nothing here messages a customer. Publishing goes only through /api/connectors/*, which keep their own durable record.

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const json = (body: PostActionOk | PostActionFail | PostOverview | Record<string, unknown>, status = 200) => NextResponse.json(body, { status })
const WRITERS = new Set(['owner', 'admin', 'manager', 'service'])
const UUID = /^[0-9a-f-]{36}$/i
const NEEDS_DB = 'Repair posts need a database update before they can be saved. Ask your developer to apply it.'

const STATUS: Partial<Record<PostErrorCode, number>> = {
  bad_request: 400, forbidden: 403, not_found: 404, limit: 429, database: 409, no_permission: 409, permission_unknown: 409, blocked: 409, flags: 409,
  not_connected: 409, busy: 409, wrong_state: 409, needs_owner: 403, confirm_auto: 409, not_enough: 409,
}

const failBody = (code: PostErrorCode, error: string, extra: Partial<PostActionFail> = {}): PostActionFail => ({ ok: false, error, code, ...extra })
const failResponse = (code: PostErrorCode, error: string, extra: Partial<PostActionFail> = {}) => json(failBody(code, error, extra), STATUS[code] ?? 400)

function errorResponse(error: unknown): NextResponse {
  if (error instanceof NeedsDatabaseUpdate) return json({ ok: false, error: NEEDS_DB, needs_database_update: true, code: 'database' }, 409)
  console.error('[growth/post-queue]', error instanceof Error ? error.message : error)
  return json({ ok: false, error: 'Something went wrong. Try again.' }, 500)
}

function audit(shopId: string, userId: string | undefined, action: string, targetId: string | undefined, metadata: Record<string, unknown>, approved: boolean): void {
  void writeAuditLog({ shopId, userId, action, targetType: 'repair_post', targetId, approved, metadata }).catch(() => undefined)
}

interface Ctx {
  auth: AuthenticatedShop
  req: Request
  internal: boolean
  ai: boolean
  confirmed: boolean
  db: ReturnType<typeof getServiceClient>
  store: PostDb
  deps: SourceDeps
  ports: PostPorts
}

async function context(req: Request, auth: AuthenticatedShop, internal: boolean): Promise<Ctx> {
  const db = getServiceClient()
  const store = createPostStore(db)
  const shop = await loadShopContext(db, auth.shopId)
  const deps: SourceDeps = { db, store, shop }
  const publisher = createPublisher({ db, origin: new URL(req.url).origin, authHeaders: forwardAuth(req, internal) })
  const ports: PostPorts = {
    store,
    now: () => Date.now(),
    ...publisher,
    prepare: (shopId, jobId, platforms) => prepareJobPost(deps, shopId, jobId, platforms),
    candidateJobs: (shopId, since, limit) => candidateJobIds(db, store, shopId, since, limit),
    jobFinished: (shopId, jobId) => jobIsFinished(db, shopId, jobId),
  }
  return {
    auth, req, internal, db, store, deps, ports,
    ai: req.headers.get('x-ai-source') === 'ai',
    confirmed: req.headers.get('x-ai-approval') === 'confirm',
  }
}

const actorOf = (c: Ctx): Actor => ({ id: c.auth.role === 'service' ? null : c.auth.userId, via: c.ai ? 'ask_alpha' : 'owner' })

/** The places a new post goes when the person did not say: the ones chosen in the settings, else the ones that are connected. */
async function defaultPlatforms(c: Ctx, asked: unknown): Promise<PostPlatform[]> {
  const wanted = cleanPlatforms(asked)
  if (wanted.length) return wanted
  const settings = await c.store.settings(c.auth.shopId)
  if (settings.platforms.length) return settings.platforms
  return reachable(['facebook', 'instagram', 'google'], await c.ports.connections(c.auth.shopId))
}

async function outcomeResponse(c: Ctx, out: Outcome<{ item: QueueRow }>, mode: PostMode, extra: Partial<PostActionOk> = {}): Promise<NextResponse> {
  if (out.ok) {
    const [view] = await itemViews(c.db, c.store, c.auth.shopId, [out.item], mode)
    return json({ ok: true, message: out.message, item: view, ...extra })
  }
  const view = out.item ? (await itemViews(c.db, c.store, c.auth.shopId, [out.item], mode))[0] : undefined
  return failResponse(out.code, out.error, { blockers: out.blockers, item: view })
}

/* ---------- reading ---------- */

export async function GET() {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  const canEdit = WRITERS.has(auth.role)
  const db = getServiceClient()
  const store = createPostStore(db)
  try {
    const connections = await readConnections(db, auth.shopId)
    let settings = { ...DEFAULT_POST_SETTINGS }
    let rows: Awaited<ReturnType<PostDb['list']>> = []
    try {
      settings = await store.settings(auth.shopId)
      if (canEdit) await recoverStuck({ store, now: () => Date.now() }, auth.shopId)
      rows = await store.list(auth.shopId)
    } catch (error) {
      if (error instanceof NeedsDatabaseUpdate) {
        return json({
          ok: true, available: false, can_edit: canEdit, settings, used_this_week: 0, posts_this_month: 0, connections, items: [],
          notes: ['Repair posts need a database update before Alpha can prepare or log posts. Until then nothing is posted automatically.'],
        } satisfies PostOverview)
      }
      throw error
    }
    const now = Date.now()
    const notes: string[] = []
    if (settings.mode !== 'off' && settings.platforms.length === 0) notes.push('Choose where posts go.')
    else if (settings.mode !== 'off' && reachable(settings.platforms, connections).length === 0) notes.push('None of the apps you chose is connected, so nothing can be posted. Open Connected apps to connect one.')
    const items = await itemViews(db, store, auth.shopId, rows.slice(0, 100), settings.mode)
    return json({
      ok: true, available: true, can_edit: canEdit, settings, used_this_week: usedThisWeek(rows, now), posts_this_month: postsThisMonth(rows, now), connections, items, notes,
    } satisfies PostOverview)
  } catch (error) {
    return errorResponse(error)
  }
}

/* ---------- acting ---------- */

const str = (v: unknown, max = 5000): string => (typeof v === 'string' ? v : '').slice(0, max)

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const action = str(body.action, 40)
  const internal = hasInternalApiSecret(req)
  const auth = await getRouteShop(req, body.shopId ?? body.shop_id)
  if (!auth) return unauthorized()
  if (!WRITERS.has(auth.role) && !(action === 'set_heard_from' && auth.role !== 'viewer')) return forbidden()
  const id = str(body.id, 60)
  const jobId = str(body.job_id, 60)
  if (id && !UUID.test(id)) return failResponse('bad_request', 'Unknown post.')
  if (jobId && !UUID.test(jobId)) return failResponse('bad_request', 'Unknown job.')

  try {
    const c = await context(req, auth, internal)
    const shopId = auth.shopId
    const actor = actorOf(c)
    const uid = auth.role === 'service' ? undefined : auth.userId

    // Ask Alpha can prepare, skip and read. Anything public, or any change of the rules, needs the owner's yes in the chat first.
    if (c.ai) {
      if (['approve', 'retry', 'confirm_outcome', 'set_settings', 'create', 'edit'].includes(action) && !c.confirmed) return failResponse('needs_owner', 'This needs the owner’s OK first. Ask them, then try again with their yes.')
      if (['set_heard_from', 'unclear', 'refresh_numbers', 'run_due'].includes(action)) return failResponse('needs_owner', 'Only the owner can do that on the Posts screen.')
      if (action === 'set_permission' && body.ok !== false) return failResponse('needs_owner', 'Only the owner can record that the customer said yes. Do that on the job.')
    }
    if (action === 'run_due' && !internal && !WRITERS.has(auth.role)) return forbidden()

    const settings = await c.store.settings(shopId)
    const mode = settings.mode

    switch (action) {
      case 'set_settings': {
        if (c.ai && body.mode === 'auto') return failResponse('needs_owner', 'Only the owner can turn Auto on, on the Posts screen.')
        const change = resolveMode(settings.mode, body.mode ?? settings.mode, body.confirm_auto === true)
        if (change.needsConfirm) return failResponse('confirm_auto', 'Auto needs your yes first. Alpha will post on its own to the apps you chose, for jobs where the customer said yes, up to your weekly limit.')
        const next = cleanSettings({ mode: change.mode, weeklyCap: body.weekly_cap ?? settings.weeklyCap, platforms: body.platforms === undefined ? settings.platforms : body.platforms })
        if (next.mode === 'auto' && next.platforms.length === 0) return failResponse('bad_request', 'Choose where posts go before turning Auto on.')
        await c.store.saveSettings(shopId, next, auth.role === 'service' ? null : auth.userId)
        audit(shopId, uid, 'repair_posts.settings', undefined, { from: settings, to: next, via: actor.via }, true)
        return json({ ok: true, message: change.note || `Posts are now ${next.mode === 'off' ? 'off' : MODE_WORDS[next.mode].word}.`, settings: next })
      }

      case 'set_permission': {
        if (!jobId) return failResponse('bad_request', 'Choose a job first.')
        const job = await loadJob(c.db, shopId, jobId)
        if (!job) return failResponse('not_found', 'That job is not in your shop.')
        const ok = body.ok === true
        await c.store.setPermission(shopId, jobId, ok, auth.role === 'service' ? null : auth.userId, str(body.note, 300))
        const cancelled = ok ? 0 : await cancelForJob(c.ports, shopId, jobId)
        audit(shopId, uid, ok ? 'repair_posts.customer_ok' : 'repair_posts.customer_ok_removed', jobId, { cancelled }, true)
        const info = await c.store.jobInfo(shopId, jobId)
        const counts = await photoCounts(c.db, shopId, [jobId])
        return json({
          ok: true,
          message: ok ? 'Noted: the customer said yes to a post about this job.' : cancelled ? `Noted: no post for this job. ${cancelled} waiting ${cancelled === 1 ? 'post was' : 'posts were'} cancelled.` : 'Noted: no post for this job.',
          job: summarize(job, info, info !== null, counts.get(jobId) ?? 0, null),
        })
      }

      case 'set_heard_from': {
        if (!jobId) return failResponse('bad_request', 'Choose a job first.')
        const job = await loadJob(c.db, shopId, jobId)
        if (!job) return failResponse('not_found', 'That job is not in your shop.')
        await c.store.setHeardFrom(shopId, jobId, str(body.heard_from, 120).replace(/\s+/g, ' ').trim())
        const info = await c.store.jobInfo(shopId, jobId)
        const counts = await photoCounts(c.db, shopId, [jobId])
        return json({ ok: true, message: 'Saved.', job: summarize(job, info, info !== null, counts.get(jobId) ?? 0, null) })
      }

      case 'unclear': {
        const ref = str(body.ref, 300)
        if (!jobId || !ref) return failResponse('bad_request', 'Choose a photo first.')
        const info = await c.store.jobInfo(shopId, jobId)
        if (!info) return failResponse('database', NEEDS_DB)
        await c.store.setCleared(shopId, jobId, info.cleared.filter(x => x.ref !== ref))
        return json({ ok: true, message: 'That photo will not be used again unless you check it again.' })
      }

      case 'prepare_job':
      case 'create': {
        const limit = checkRateLimit(`post-prepare:${shopId}`, 30, 60 * 60_000)
        if (!limit.ok) return failResponse('limit', 'That is a lot of posts for one hour. Try again later.')
        const platforms = await defaultPlatforms(c, body.platforms)
        if (platforms.length === 0) return failResponse('bad_request', 'Choose where the post goes. No app is connected yet.')
        const madeBy = c.ai ? 'ask_alpha' : 'owner'
        if (action === 'prepare_job') {
          if (!jobId) return failResponse('bad_request', 'Choose a job first.')
          const out = await prepareJobItem(c.ports, shopId, jobId, { madeBy, userId: actor.id, platforms })
          return outcomeResponse(c, out, mode, out.ok && out.note ? { message: `${out.message} ${out.note}`.trim() } : {})
        }
        const photos = cleanPhotos(body.photos, shopId)
        if (photos.length === 0) return failResponse('bad_request', 'Add at least one photo.')
        let facts = emptyFacts({ shopName: c.deps.shop.shopName, shopPhone: c.deps.shop.shopPhone, city: c.deps.shop.city })
        let caption = str(body.caption)
        if (jobId) {
          const job = await loadJob(c.db, shopId, jobId)
          if (!job) return failResponse('not_found', 'That job is not in your shop.')
          facts = await buildFacts(c.deps, shopId, job, await loadInspectionPhotos(c.db, shopId, jobId))
          if (!caption.trim()) {
            const problems = factsProblems(facts)
            if (problems.length) return failResponse('not_enough', problems[0])
            caption = (await writeCaption(c.deps.shop.model, facts, platforms)).caption
          }
        } else if (!caption.trim()) return failResponse('bad_request', 'Write the words for the post.')
        const out = await createItem(c.ports, shopId, { jobId: jobId || null, caption, facts, photos, platforms, madeBy, createdBy: actor.id })
        return outcomeResponse(c, out, mode)
      }

      case 'edit': {
        if (!id) return failResponse('bad_request', 'Choose a post first.')
        const out = await editItem(c.ports, shopId, id, {
          caption: body.caption === undefined ? undefined : str(body.caption),
          photos: body.photos === undefined ? undefined : cleanPhotos(body.photos, shopId),
          platforms: body.platforms === undefined ? undefined : cleanPlatforms(body.platforms),
        }, actor.id)
        return outcomeResponse(c, out, mode)
      }

      case 'approve':
      case 'retry': {
        if (!id) return failResponse('bad_request', 'Choose a post first.')
        const limit = checkRateLimit(`post-send:${shopId}`, 20, 60 * 60_000)
        if (!limit.ok) return failResponse('limit', 'That is a lot of posts for one hour. Try again later.')
        await recoverStuck(c.ports, shopId)
        const out = action === 'approve'
          ? await approveItem(c.ports, shopId, id, actor, { acceptFlags: body.accept_flags === true, postAt: typeof body.post_at === 'string' ? body.post_at : null })
          : await retryItem(c.ports, shopId, id, actor)
        if (out.ok || out.item) audit(shopId, uid, `repair_posts.${action}`, id, { via: actor.via, ok: out.ok, state: out.item?.state }, out.ok)
        return outcomeResponse(c, out, mode)
      }

      case 'skip':
        if (!id) return failResponse('bad_request', 'Choose a post first.')
        return outcomeResponse(c, await skipItem(c.ports, shopId, id), mode)

      case 'confirm_outcome': {
        const platform = body.platform
        if (!id || !isPlatform(platform) || (body.outcome !== 'posted' && body.outcome !== 'not_posted')) return failResponse('bad_request', 'Choose the post, the place, and what you saw.')
        const out = await confirmOutcome(c.ports, shopId, id, platform, body.outcome)
        audit(shopId, uid, 'repair_posts.confirm_outcome', id, { platform, outcome: body.outcome }, true)
        return outcomeResponse(c, out, mode)
      }

      case 'refresh_numbers': {
        const limit = checkRateLimit(`post-numbers:${shopId}`, 6, 60 * 60_000)
        if (!limit.ok) return failResponse('limit', 'Numbers were just checked. Try again in a while.')
        const out = await refreshNumbers(c.ports, shopId)
        return json({ ok: true, message: out.ok ? out.message : out.error })
      }

      case 'run_due': {
        if (!internal) {
          const limit = checkRateLimit(`post-run:${shopId}`, 6, 60 * 60_000)
          if (!limit.ok) return failResponse('limit', 'Alpha just looked. Try again in a while.')
        }
        const run = await runShop(c.ports, shopId)
        if (run.posted > 0 || run.prepared > 0) audit(shopId, uid, 'repair_posts.run', undefined, { ...run, via: internal ? 'schedule' : 'owner' }, true)
        // The same visit keeps the numbers fresh; the apps report what they have and nothing else is recorded.
        if (internal) await refreshNumbers(c.ports, shopId).catch(() => undefined)
        const message = run.mode === 'off' ? 'Posts are off, so Alpha did nothing.' : `Prepared ${run.prepared}, posted ${run.posted}, held ${run.held}.`
        return json({ ok: true, message, run })
      }

      default:
        return failResponse('bad_request', 'Unknown action.')
    }
  } catch (error) {
    // The daily run visits every shop. Before the database update is applied that is not a failure, just nothing to do.
    if (error instanceof NeedsDatabaseUpdate && action === 'run_due' && internal) return json({ ok: true, message: 'Repair posts need a database update, so nothing was done.', skipped: true })
    return errorResponse(error)
  }
}

