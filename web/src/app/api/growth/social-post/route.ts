export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  try {
    const { text, platforms, media_urls } = await req.json()
    if (!text) return NextResponse.json({ error: 'Post text required' }, { status: 400 })
    const db = getServiceClient()
    // Save post to database
    await db.from('social_posts').insert({
      text,
      platforms: platforms || ['facebook'],
      media_urls: media_urls || [],
      status: 'draft',
      created_at: new Date().toISOString(),
    })
    // For now, posts are saved as drafts. To auto-post, you'd integrate:
    // - Facebook Graph API (requires Page access token)
    // - Google Business Profile API
    // - Instagram Graph API
    // These require OAuth setup per platform
    const message = platforms?.length > 0
      ? `Post saved! To publish on ${platforms.join(', ')}, connect your accounts in Settings.`
      : 'Post saved as draft!'
    return NextResponse.json({ success: true, message, platforms })
  } catch (e) {
    console.error('Social post error:', e)
    return NextResponse.json({ error: 'Failed to create post' }, { status: 500 })
  }
}
