export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'node:crypto'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'

const BUCKET = 'social-post-media'
const MAX_BYTES = 10 * 1024 * 1024

export async function POST(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'file is required' }, { status: 400 })
  if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) {
    return NextResponse.json({ error: 'Only image and video files are allowed' }, { status: 415 })
  }
  if (file.size <= 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'Media must be between 1 byte and 10 MB' }, { status: 413 })
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || 'media'
  const path = `${auth.shopId}/${randomUUID()}-${safeName}`
  const db = getServiceClient()
  const { error } = await db.storage.from(BUCKET).upload(path, file, {
    contentType: file.type,
    cacheControl: '3600',
    upsert: false,
  })
  if (error) {
    console.error('[social-media] upload failed:', error.message)
    return NextResponse.json({ error: 'Media upload failed' }, { status: 500 })
  }
  const { data, error: signedUrlError } = await db.storage.from(BUCKET).createSignedUrl(path, 24 * 60 * 60)
  if (signedUrlError || !data?.signedUrl) {
    console.error('[social-media] signed URL failed:', signedUrlError?.message)
    return NextResponse.json({ error: 'Media preview could not be created' }, { status: 500 })
  }
  return NextResponse.json({ url: data.signedUrl, path })
}
