import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()

  const documentId = req.nextUrl.searchParams.get('documentId')
  if (!documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 })

  const db = getServiceClient()
  // Only serve signatures for documents that belong to the caller's shop.
  const { data: doc } = await db
    .from('documents')
    .select('id, shop_id')
    .eq('id', documentId)
    .single()
  if (!doc || (doc.shop_id && doc.shop_id !== auth.shopId)) {
    return NextResponse.json({ signature_data: null })
  }

  const { data: sig } = await db
    .from('signatures')
    .select('signature_data, signer_name, signed_at')
    .eq('document_id', documentId)
    .not('signed_at', 'is', null)
    .order('signed_at', { ascending: false })
    .limit(1)
    .single()

  if (!sig?.signature_data) {
    return NextResponse.json({ signature_data: null })
  }

  return NextResponse.json({
    signature_data: sig.signature_data,
    signer_name: sig.signer_name,
    signed_at: sig.signed_at,
  })
}
