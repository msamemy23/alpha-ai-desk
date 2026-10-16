import { randomUUID } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { forbidden, getAuthedShop, unauthorized } from '@/lib/api-auth'
import { getServiceClient } from '@/lib/supabase'
import { isMissingDbObject } from '@/lib/db-missing'
import { writeAuditLog } from '@/lib/audit-log'
import { loadBook } from '@/lib/customers/server'
import { COMMIT_ROW_CAP, customerInsertRow, importBatchKey, importFingerprint, readImport, rowsToAdd } from '@/lib/customers/import-flow'
import { cleanTags } from '@/lib/customers/segments'

export const dynamic = 'force-dynamic'

const without = (row: Record<string, unknown>, drop: string[]): Record<string, unknown> => Object.fromEntries(Object.entries(row).filter(([k]) => !drop.includes(k)))

/**
 * Adds the customers from a list the owner has already previewed. This only ever INSERTS new customers. It never changes,
 * overwrites or removes a customer that is already there: a row that matches someone in the book (same phone, email or name)
 * is skipped, and so is a repeat of an earlier row in the same file. It refuses unless the request says confirm: true, unless
 * the list still produces exactly the preview that was shown (the fingerprint), and for more than 500 rows. Every new row is
 * stamped with the shop id from the signed-in session; nothing in the file or the request can name a shop.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await getAuthedShop()
    if (!auth) return unauthorized()
    if (auth.role === 'viewer') return forbidden()

    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    if (body?.confirm !== true) return NextResponse.json({ ok: false, error: 'Confirm the import first. Nothing was added.' }, { status: 400 })
    const fingerprint = typeof body.fingerprint === 'string' ? body.fingerprint : ''
    if (!fingerprint) return NextResponse.json({ ok: false, error: 'Preview the list first, then confirm. Nothing was added.' }, { status: 400 })

    const db = getServiceClient()
    const book = await loadBook(db, auth.shopId)
    if (book.failed || book.truncated) return NextResponse.json({ ok: false, error: 'Your customers could not be read to check for repeats. Nothing was added. Try again.' }, { status: 500 })

    // Work the list out again against the book as it is right now.
    const read = readImport(body.text, book.rows, Date.now())
    if (!read.ok) return NextResponse.json({ ok: false, error: `${read.error} Nothing was added.` }, { status: read.status })
    if (importFingerprint(read.preview) !== fingerprint) {
      return NextResponse.json({ ok: false, error: 'Your customer list changed since the preview, so nothing was added. Preview the list again, then confirm.' }, { status: 409 })
    }

    const add = rowsToAdd(read.preview).slice(0, COMMIT_ROW_CAP)
    const skipped = read.preview.counts.duplicate
    const invalid = read.preview.counts.invalid
    if (add.length === 0) return NextResponse.json({ ok: true, added: 0, skipped, invalid, tags_saved: 0, tags_note: '' })

    // The same list is never recorded twice. If the batch table is not set up yet the import still works, it just leaves no record.
    const key = importBatchKey(fingerprint)
    let record = true
    const earlier = await db.from('customer_imports').select('id,created_at').eq('shop_id', auth.shopId).eq('batch_key', key).maybeSingle()
    if (earlier.error) {
      if (isMissingDbObject(earlier.error)) record = false
      else return NextResponse.json({ ok: false, error: 'Whether this list was imported before could not be checked. Nothing was added. Try again.' }, { status: 500 })
    } else if (earlier.data) {
      const when = new Date(String(earlier.data.created_at))
      const day = Number.isFinite(when.getTime()) ? ` on ${when.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}` : ''
      return NextResponse.json({ ok: false, error: `This exact list was already imported${day}. Nothing was added.` }, { status: 409 })
    }

    const nowIso = new Date().toISOString()
    const made = add.map(r => ({ row: r, id: randomUUID() }))
    const rows = made.map(m => customerInsertRow(m.row, auth.shopId, m.id, nowIso))
    // One insert for the whole list, so it is all added or none of it is. shop_id is set from the session on every row.
    const insertRows = (list: Record<string, unknown>[]) => db.from('customers').insert(list.map(r => ({ ...r, shop_id: auth.shopId })))
    let saved = await insertRows(rows)
    // Older databases may not have the vehicle colour column yet; the rest of the row is still worth saving.
    if (saved.error && isMissingDbObject(saved.error)) saved = await insertRows(rows.map(r => without(r, ['vehicle_color'])))
    if (saved.error) {
      console.error('[customers/import/commit] insert failed:', saved.error)
      return NextResponse.json({ ok: false, error: 'The customers could not be saved. Nothing was added. Try again.' }, { status: 500 })
    }

    // Tags go on the new customers' own records. These customers are new, so no existing record is touched.
    let tagsSaved = 0
    let tagsNote = ''
    const tagged = made.map(m => ({ id: m.id, tags: cleanTags(m.row.tags) })).filter(t => t.tags.length > 0)
    if (tagged.length > 0) {
      const insertMeta = db.from('customer_meta').insert(tagged.map(t => ({ shop_id: auth.shopId, customer_id: t.id, tags: t.tags, updated_by: auth.userId, updated_at: nowIso })))
      const meta = await insertMeta
      if (!meta.error) tagsSaved = tagged.length
      else if (isMissingDbObject(meta.error)) tagsNote = 'The customers were added, but tags need a database update first, so no tags were saved.'
      else tagsNote = 'The customers were added, but their tags could not be saved. You can add tags from each customer.'
    }

    if (record) {
      const batch = await db.from('customer_imports').insert({
        shop_id: auth.shopId,
        batch_key: key,
        file_name: typeof body.file_name === 'string' ? body.file_name.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, 200) || null : null,
        total_rows: read.preview.counts.total,
        added: made.length,
        skipped,
        invalid,
        created_ids: made.map(m => m.id),
        created_by: auth.userId,
      })
      if (batch.error) console.error('[customers/import/commit] batch record failed:', batch.error)
    }
    await writeAuditLog({ shopId: auth.shopId, userId: auth.userId, action: 'customer.import', targetType: 'customer', permission: 'write', approved: true, metadata: { added: made.length, skipped, invalid } }).catch(() => undefined)

    return NextResponse.json({ ok: true, added: made.length, skipped, invalid, tags_saved: tagsSaved, tags_note: tagsNote })
  } catch (error) {
    console.error('[customers/import/commit] POST error:', error)
    return NextResponse.json({ ok: false, error: 'The import did not finish. Check your customer list before trying again.' }, { status: 500 })
  }
}
