import { NextRequest, NextResponse } from 'next/server'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { checkRateLimit, rateLimitKey } from '@/lib/rate-limit'
import { checkUpload, MEDIA_BUCKET, newMediaName, SIGNED_URL_SECONDS } from '@/lib/dvi-media'
import { makeStorageRef, storageRefParts } from '@/lib/dvi'

export const dynamic = 'force-dynamic'

/**
 * Photos, video and voice notes for the shop's own inspections, kept in the private `dvi-media` bucket.
 *   POST { action: 'upload', dvi_id, contentType, size }  -> a one-time upload address for that file
 *   POST { action: 'sign', refs: [...] }                  -> short-lived viewing addresses
 * A file's name starts with the id of the inspection it belongs to. Every request is checked against the signed-in
 * shop's own inspections, so one shop can never write to or read from another shop's folder.
 * Until migration 049 creates the bucket, this answers 503 { code: 'no_storage' } and the editor keeps photos inside the row.
 */
const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'private, no-store' } })
const DVI_ID = /^[A-Za-z0-9-]{1,64}$/
const noBucket = (e: { message?: string; statusCode?: string | number } | null) => Boolean(e) && /bucket not found|not found|does not exist/i.test(e?.message || '')

export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  if (auth.role === 'viewer') return forbidden()
  if (!checkRateLimit(rateLimitKey('dvi-media', auth.userId, auth.shopId), 240, 60_000).ok) return reply({ ok: false, error: 'Too many requests. Wait a moment.' }, 429)

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const action = body?.action
  const sb = getServiceClient()

  if (action === 'upload') {
    const dviId = typeof body?.dvi_id === 'string' ? body.dvi_id : ''
    if (!DVI_ID.test(dviId)) return reply({ ok: false, error: 'Missing inspection' }, 400)
    const check = checkUpload(body?.contentType, body?.size)
    if (!check.ok) return reply({ ok: false, error: check.error }, 400)

    const { data: row, error } = await sb.from('dvi').select('id').eq('id', dviId).eq('shop_id', auth.shopId).maybeSingle()
    if (error) return reply({ ok: false, error: 'The inspection could not be checked' }, 500)
    if (!row) return reply({ ok: false, error: 'Inspection not found' }, 404)

    const name = newMediaName()
    const ref = makeStorageRef(dviId, name, check.ext)
    const parts = storageRefParts(ref)
    if (!parts) return reply({ ok: false, error: 'Could not name the file' }, 500)
    const { data, error: upErr } = await sb.storage.from(MEDIA_BUCKET).createSignedUploadUrl(parts.path)
    if (upErr || !data) {
      if (noBucket(upErr)) return reply({ ok: false, code: 'no_storage', error: 'Photo storage needs a database update before video and voice notes can be saved.' }, 503)
      console.error('[inspection/media] upload address failed:', upErr?.message)
      return reply({ ok: false, error: 'The file could not be prepared. Try again.' }, 500)
    }
    return reply({ ok: true, ref, path: data.path, token: data.token, kind: check.kind })
  }

  if (action === 'sign') {
    const refs = Array.isArray(body?.refs) ? body.refs.filter((r): r is string => typeof r === 'string').slice(0, 60) : []
    const parts = refs.map(r => ({ ref: r, p: storageRefParts(r) })).filter((x): x is { ref: string; p: NonNullable<ReturnType<typeof storageRefParts>> } => x.p !== null)
    if (parts.length === 0) return reply({ ok: true, urls: {} })
    const folders = [...new Set(parts.map(x => x.p.folder))]
    const { data: mine, error } = await sb.from('dvi').select('id').in('id', folders).eq('shop_id', auth.shopId)
    if (error) return reply({ ok: false, error: 'The inspections could not be checked' }, 500)
    const allowed = new Set((mine || []).map(r => String(r.id)))
    const okParts = parts.filter(x => allowed.has(x.p.folder))
    if (okParts.length === 0) return reply({ ok: true, urls: {} })
    const { data, error: signErr } = await sb.storage.from(MEDIA_BUCKET).createSignedUrls(okParts.map(x => x.p.path), SIGNED_URL_SECONDS)
    if (signErr || !data) {
      if (noBucket(signErr)) return reply({ ok: true, urls: {}, code: 'no_storage' })
      return reply({ ok: false, error: 'The files could not be opened' }, 500)
    }
    const urls: Record<string, string> = {}
    for (const item of data) {
      const hit = okParts.find(x => x.p.path === item.path)
      if (hit && item.signedUrl) urls[hit.ref] = item.signedUrl
    }
    return reply({ ok: true, urls })
  }

  return reply({ ok: false, error: 'Unknown request' }, 400)
}
