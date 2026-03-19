import { NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function POST() {
  const sb = getServiceClient()

  // 1. Fetch all Receipt docs
  const { data: receipts, error: fetchErr } = await sb
    .from('documents')
    .select('id, doc_number')
    .eq('type', 'Receipt')

  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 })
  if (!receipts || receipts.length === 0) return NextResponse.json({ migrated: 0, message: 'No receipts found' })

  // 2. For each receipt, update type to Invoice and rename REC- prefix to INV-
  const results = []
  for (const r of receipts) {
    const newDocNumber = (r.doc_number || '').replace(/^REC-/, 'INV-')
    const { error } = await sb
      .from('documents')
      .update({ type: 'Invoice', doc_number: newDocNumber, updated_at: new Date().toISOString() })
      .eq('id', r.id)
    results.push({ id: r.id, old: r.doc_number, new: newDocNumber, ok: !error, err: error?.message })
  }

  return NextResponse.json({ migrated: results.length, results })
}
