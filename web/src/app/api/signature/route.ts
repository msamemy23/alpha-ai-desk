import { NextRequest, NextResponse } from 'next/server'
import { getServiceClient } from '@/lib/supabase'
import { getAuthedShop, unauthorized } from '@/lib/api-auth'
import { verifySignatureRecord } from '@/lib/doc-approval'
import { isMissingSchema } from '@/lib/doc-server'

export const dynamic = 'force-dynamic'

const str = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v))
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
/** The database hands back its own spelling of a time (+00:00); the seal was made from the .000Z spelling. */
const isoOf = (v: unknown): string => { const d = new Date(str(v)); return Number.isNaN(d.getTime()) ? str(v) : d.toISOString() }
const strings = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(rec(v))) if (typeof val === 'string') out[k] = val
  return out
}

/**
 * The signed record for a document, for the staff. New links keep a sealed record (who, when, how, what they chose, the
 * drawn signature and a fingerprint); this checks the stored row against its fingerprint and says so. Documents
 * signed through an older link have only the older signature row, which is returned as before.
 */
export async function GET(req: NextRequest) {
  const auth = await getAuthedShop()
  if (!auth) return unauthorized()

  const documentId = req.nextUrl.searchParams.get('documentId')
  if (!documentId) return NextResponse.json({ error: 'documentId required' }, { status: 400 })

  const db = getServiceClient()
  // Only serve signatures for documents that belong to the caller's shop.
  const { data: doc } = await db.from('documents').select('id, shop_id, doc_number').eq('id', documentId).eq('shop_id', auth.shopId).maybeSingle()
  if (!doc) return NextResponse.json({ signature_data: null })

  const approvals = await db
    .from('document_approvals')
    .select('*')
    .eq('shop_id', auth.shopId)
    .eq('document_id', documentId)
    .neq('status', 'failed')
    .order('signed_at', { ascending: false })
    .limit(20)
  if (approvals.error && !isMissingSchema(approvals.error)) return NextResponse.json({ error: 'The signed record could not be loaded. Try again.' }, { status: 500 })

  const rows = approvals.error ? [] : ((approvals.data || []) as Record<string, unknown>[])
  if (rows.length) {
    const checked = await Promise.all(rows.map(async (row) => {
      const viewed = rec(rec(row.snapshot).viewed)
      const verified = await verifySignatureRecord({
        documentId, docNumber: str(viewed.docNumber) || str(doc.doc_number), contentHash: str(row.content_hash), signerName: str(row.signer_name),
        signedAt: isoOf(row.signed_at), ip: str(row.signer_ip), userAgent: str(row.signer_agent), decisions: strings(row.decisions),
        options: strings(row.options), note: str(row.note), signatureHash: str(row.signature_hash),
        method: row.method === 'drawn' ? 'drawn' : row.method === 'typed' ? 'typed' : 'click',
      }, str(row.record_hash), typeof row.signature_data === 'string' ? row.signature_data : null).catch(() => ({ ok: false, reason: 'The record could not be checked.' }))
      return { row, verified }
    }))
    const top = checked[0]
    return NextResponse.json({
      source: 'record',
      signature_data: typeof top.row.signature_data === 'string' ? top.row.signature_data : null,
      signer_name: str(top.row.signer_name),
      signed_at: str(top.row.signed_at),
      method: str(top.row.method),
      outcome: str(top.row.outcome),
      device: str(top.row.signer_device),
      ip: str(top.row.signer_ip),
      note: str(top.row.note),
      record_id: str(top.row.record_hash).slice(0, 12),
      verified: top.verified,
      total_before: Number(top.row.total_before) || 0,
      total_after: Number(top.row.total_after) || 0,
      all: checked.map(({ row, verified }) => ({
        id: str(row.id), outcome: str(row.outcome), signer_name: str(row.signer_name), method: str(row.method), signed_at: str(row.signed_at),
        total_before: Number(row.total_before) || 0, total_after: Number(row.total_after) || 0, status: str(row.status), verified,
      })),
    })
  }

  const { data: sig } = await db
    .from('signatures')
    .select('signature_data, signer_name, signed_at')
    .eq('shop_id', auth.shopId)
    .eq('document_id', documentId)
    .not('signed_at', 'is', null)
    .order('signed_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!sig?.signature_data) return NextResponse.json({ signature_data: null })
  return NextResponse.json({ source: 'legacy', signature_data: sig.signature_data, signer_name: sig.signer_name, signed_at: sig.signed_at })
}
