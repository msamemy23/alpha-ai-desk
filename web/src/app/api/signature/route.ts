import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const documentId = req.nextUrl.searchParams.get('documentId')
  if (!documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 })

  const db = getServiceClient()
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
