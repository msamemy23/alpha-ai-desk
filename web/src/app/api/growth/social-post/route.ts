export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { forbidden, getRouteShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { revalidateAutomationInvocation, validateAutomationInvocation } from '@/lib/automation-fencing'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const auth = await getRouteShop(req, body?.shopId)
    if (!auth) return unauthorized()
    const automationCheck = await validateAutomationInvocation(req, body as Record<string, unknown> | null, auth.shopId, ['social_posts'])
    if (!automationCheck.ok) return NextResponse.json({ ok: false, error: automationCheck.error }, { status: automationCheck.status })
    if (auth.role === 'viewer') return forbidden()

    const db = getServiceClient()
    const { data: settings, error: settingsError } = await db.from('settings').select('shop_name').eq('shop_id', auth.shopId).maybeSingle()
    if (settingsError) return NextResponse.json({ ok: false, error: 'Shop settings could not be loaded' }, { status: 500 })
    const shopName = String(settings?.shop_name || 'Your local auto repair shop').slice(0, 120)
    const action = typeof body.action === 'string' ? body.action : 'save_draft'
    const text = typeof body.text === 'string' && body.text.trim()
      ? body.text.trim()
      : action === 'auto_post'
        ? `${shopName}: Keep your vehicle running safely with trusted local auto repair. Message us to schedule service.`
        : ''
    const platforms = Array.isArray(body.platforms)
      ? body.platforms.filter((value: unknown): value is string => typeof value === 'string').slice(0, 5)
      : action === 'auto_post' ? ['facebook', 'instagram'] : []
    const mediaUrls = Array.isArray(body.media_urls)
      ? body.media_urls.filter((value: unknown): value is string => typeof value === 'string').slice(0, 10)
      : []
    const mediaPaths = Array.isArray(body.media_paths)
      ? body.media_paths
          .filter((value: unknown): value is string => typeof value === 'string' && value.startsWith(`${auth.shopId}/`))
          .slice(0, 10)
      : []

    if (!text) return NextResponse.json({ error: 'Post text required' }, { status: 400 })
    if (!platforms.length) return NextResponse.json({ error: 'Select at least one platform' }, { status: 400 })
    if (text.length > 5000) return NextResponse.json({ error: 'Post text is too long' }, { status: 413 })

    let data: Record<string, unknown> | null = null
    let error: { message: string } | null = null
    if (automationCheck.ok && automationCheck.runId && automationCheck.fencingToken !== undefined) {
      const fenced = await db.rpc('insert_social_post_fenced', {
        p_shop_id: auth.shopId,
        p_run_id: automationCheck.runId,
        p_fencing_token: automationCheck.fencingToken,
        p_text: text,
        p_platforms: platforms,
        p_media_urls: mediaUrls,
        p_media_paths: mediaPaths,
        p_status: 'draft',
      })
      data = fenced.data as Record<string, unknown> | null
      error = fenced.error
    } else {
      const beforeWrite = await revalidateAutomationInvocation(req, body as Record<string, unknown>, auth.shopId, ['social_posts'])
      if (!beforeWrite.ok) return NextResponse.json({ ok: false, error: beforeWrite.error }, { status: beforeWrite.status })
      const direct = await db.from('social_posts').insert({
        shop_id: auth.shopId,
        text,
        platforms,
        media_urls: mediaUrls,
        media_paths: mediaPaths,
        status: 'draft',
        created_at: new Date().toISOString(),
      }).select('id,shop_id,text,platforms,media_urls,status,created_at').single()
      data = direct.data as Record<string, unknown> | null
      error = direct.error
    }
    if (error) {
      console.error('[social-post] save failed:', error.message)
      const status = /stale|no longer active/i.test(error.message) ? 409 : 500
      return NextResponse.json({ error: status === 409 ? error.message : 'Draft could not be saved' }, { status })
    }

    return NextResponse.json({
      success: true,
      status: 'draft',
      message: 'Draft saved. Nothing was published. Connect and authorize each platform before publishing.',
      platforms,
      media_urls: mediaUrls,
      media_paths: mediaPaths,
      post: data,
    })
  } catch (e) {
    console.error('[social-post] error:', e)
    return NextResponse.json({ error: 'Failed to create post draft' }, { status: 500 })
  }
}
