import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getIdempotencyKey } from '@/lib/api-response'
import { sendEmail } from '@/lib/email'
import { writeAuditLog } from '@/lib/audit-log'

type DurableEmailInput = {
  request: Request
  db: SupabaseClient
  shopId: string
  userId: string
  to: string
  subject: string
  html: string
  messageBody: string
  fromAddress: string
  replyTo?: string
  apiKey?: string | null
  customerId?: string | null
  jobId?: string | null
  documentId?: string | null
}

export type DurableEmailResult =
  | { ok: true; message: Record<string, unknown> | null; idempotent: boolean; auditPending?: boolean; auditError?: string }
  | { ok: false; status: number; error: string; uncertain?: boolean }

function failure(error: string, status = 502, uncertain = false): DurableEmailResult {
  return { ok: false, status, error, ...(uncertain ? { uncertain: true } : {}) }
}

function samePayload(row: Record<string, unknown>, input: DurableEmailInput) {
  return String(row.to_address || '') === input.to
    && String(row.subject || '') === input.subject
    && String(row.body || '') === input.messageBody
    && String(row.customer_id || '') === String(input.customerId || '')
    && String(row.job_id || '') === String(input.jobId || '')
    && String(row.document_id || '') === String(input.documentId || '')
}

/**
 * Claims an email message row before calling Gmail/Resend. The local unique
 * idempotency key is the fence for SMTP too, since Gmail has no idempotency
 * API. A lost provider response therefore leaves a visible sending/unknown
 * record instead of allowing a retry to send a duplicate email.
 */
export async function sendDurableEmail(input: DurableEmailInput): Promise<DurableEmailResult> {
  const suppliedKey = getIdempotencyKey(input.request, [])
  if (!suppliedKey) return failure('Idempotency-Key is required to send email', 400)
  const payloadHash = createHash('sha256').update(JSON.stringify({
    to: input.to,
    subject: input.subject,
    body: input.messageBody,
    customerId: input.customerId || null,
    jobId: input.jobId || null,
    documentId: input.documentId || null,
  })).digest('hex')
  const key = `email:${createHash('sha256').update(`${input.shopId}:${suppliedKey}`).digest('hex')}`

  const loadExisting = async (idempotencyKey: string) => input.db.from('messages')
    .select('id,status,to_address,subject,body,customer_id,job_id,document_id,from_address,channel')
    .eq('shop_id', input.shopId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle()

  let { data: row, error: lookupError } = await loadExisting(key)
  if (lookupError) return failure('Previous email delivery could not be checked', 503, true)
  // Before the durable email fence existed, the two send routes stored the
  // un-hashed request key directly on messages. Reconcile those rows too so a
  // deployment does not resend an email that was already delivered.
  if (!row && suppliedKey !== key) {
    const legacy = await loadExisting(suppliedKey)
    if (legacy.error) return failure('Previous email delivery could not be checked', 503, true)
    row = legacy.data
  }
  if (!row) {
    const inserted = await input.db.from('messages').insert({
      shop_id: input.shopId,
      direction: 'outbound',
      channel: 'email',
      from_address: input.fromAddress,
      to_address: input.to,
      subject: input.subject,
      body: input.messageBody,
      status: 'sending',
      customer_id: input.customerId || null,
      job_id: input.jobId || null,
      document_id: input.documentId || null,
      idempotency_key: key,
      read: true,
    }).select('id,status,to_address,subject,body,customer_id,job_id,document_id,from_address,channel').maybeSingle()
    if (inserted.error && inserted.error.code !== '23505') return failure('Email operation could not be recorded before sending', 503, true)
    row = inserted.data || null
    if (!row) {
      const replay = await loadExisting(key)
      row = replay.data || null
      lookupError = replay.error
      if (lookupError) return failure('Concurrent email operation could not be checked', 503, true)
    }
  }

  if (!row) return failure('Email operation could not be claimed', 503, true)
  if (!samePayload(row as Record<string, unknown>, input)) return failure('Idempotency key was used for different email content', 409)
  const rowStatus = String(row.status || '')
  if (rowStatus === 'sent') return { ok: true, message: row as Record<string, unknown>, idempotent: true }
  if (rowStatus === 'unknown' || rowStatus === 'sending') return failure('The previous email outcome is uncertain; reconcile it before retrying', 409, true)
  if (rowStatus === 'failed') return failure('The previous email operation failed; create a new send attempt', 409)

  const messageId = String(row.id)
  try {
    await sendEmail({
      to: input.to,
      subject: input.subject,
      html: input.html,
      replyTo: input.replyTo,
      apiKey: input.apiKey || undefined,
      from: input.fromAddress,
      idempotencyKey: key,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Email provider result is uncertain'
    await input.db.from('messages').update({ status: 'unknown' })
      .eq('id', messageId).eq('shop_id', input.shopId).eq('status', 'sending')
    return failure(`${message}; do not retry automatically`, 502, true)
  }

  const saved = await input.db.from('messages').update({ status: 'sent' })
    .eq('id', messageId).eq('shop_id', input.shopId).eq('status', 'sending')
    .select('id,status,to_address,subject,body,customer_id,job_id,document_id,from_address,channel').maybeSingle()
  if (saved.error || !saved.data) {
    await input.db.from('messages').update({ status: 'unknown' })
      .eq('id', messageId).eq('shop_id', input.shopId).eq('status', 'sending')
    return failure('Email was accepted, but its local record could not be finalized; do not retry automatically', 502, true)
  }

  const audit = await writeAuditLog({
    shopId: input.shopId,
    userId: input.userId,
    action: 'email.send',
    targetType: 'message',
    targetId: messageId,
    permission: 'external',
    approved: true,
    idempotencyKey: key,
    metadata: { to: input.to, customerId: input.customerId || null, documentId: input.documentId || null, payloadHash },
  })
  if (!audit.ok) {
    return failure('Email sent, but its audit record could not be saved; do not retry automatically', 502, true)
  }
  return { ok: true, message: saved.data as Record<string, unknown>, idempotent: false, ...(audit.pending ? { auditPending: true } : {}) }
}
