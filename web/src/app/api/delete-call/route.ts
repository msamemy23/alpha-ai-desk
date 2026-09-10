import { NextRequest, NextResponse } from 'next/server'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'


export async function DELETE(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()

  const { id } = await req.json()
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const { error } = await getServiceClient().from('ai_calls')
    .delete()
    .eq('id', id)
    .eq('shop_id', auth.shopId)
  if (error) return NextResponse.json({ error: 'Call could not be deleted' }, { status: 500 })
  return NextResponse.json({ ok: true })
}
