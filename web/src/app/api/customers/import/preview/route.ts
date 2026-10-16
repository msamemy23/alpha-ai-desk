import { NextRequest, NextResponse } from 'next/server'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { loadBook } from '@/lib/customers/server'
import { COMMIT_ROW_CAP, importFingerprint, readImport, slimRows } from '@/lib/customers/import-flow'

export const dynamic = 'force-dynamic'

/**
 * Reads a customer list (CSV text sent as JSON) and shows what an import would do. It writes nothing at all: no customer,
 * no note, no record of the preview. The same code runs again in /import/commit, against the book as it is at that moment.
 * A viewer is refused, like every other part of the import.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()
    if (auth.role === 'viewer') return forbidden()

    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    const db = getServiceClient()
    const book = await loadBook(db, auth.shopId)
    // Without the whole book there is no way to say which rows are already customers, so no preview is better than a wrong one.
    if (book.failed) return NextResponse.json({ ok: false, error: 'Your customers could not be read to check for repeats. Nothing was changed. Try again.' }, { status: 500 })
    if (book.truncated) return NextResponse.json({ ok: false, error: 'Your customer book is too large to check against here. Nothing was changed.' }, { status: 500 })

    const read = readImport(body?.text, book.rows, Date.now())
    if (!read.ok) return NextResponse.json({ ok: false, error: read.error }, { status: read.status })
    return NextResponse.json({
      ok: true,
      counts: read.preview.counts,
      rows: slimRows(read.preview),
      used: read.used,
      ignored: read.ignored,
      fingerprint: importFingerprint(read.preview),
      cap: COMMIT_ROW_CAP,
    })
  } catch (error) {
    console.error('[customers/import/preview] POST error:', error)
    return NextResponse.json({ ok: false, error: 'The list could not be read. Nothing was changed. Try again.' }, { status: 500 })
  }
}
