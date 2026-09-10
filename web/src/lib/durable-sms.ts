import { createHash, randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { formatPhone, sendSMS } from '@/lib/telnyx'
import { getIdempotencyKey } from '@/lib/api-response'
import { writeAuditLog } from '@/lib/audit-log'

type SmsSettings = {
  telnyx_api_key?: string | null
  telnyx_phone_number?: string | null
  telnyx_messaging_profile_id?: string | null
}

type DurableSmsInput = {
  request: Request
  db: SupabaseClient
  shopId: string
  userId: string
  to: string
  text: string
  customerId?: string | null
  jobId?: string | null
  documentId?: string | null
  settings: SmsSettings
}

export type DurableSmsResult =
  | {
      ok: true
      messageId: string | null
      idempotent: boolean
      messageRecordSaved: boolean
      auditPending?: boolean
      auditError?: string
    }
  | { ok: false; status: number; error: string; uncertain?: boolean }

function failure(error: string, status = 502, uncertain = false): DurableSmsResult {
  return { ok: false, status, error, ...(uncertain ? { uncertain: true } : {}) }
}

async function markUnknown(db: SupabaseClient, shopId: string, operationKey: string, error: string) {
  await db.from('message_send_operations').update({
    status: 'unknown',
    last_error: error.slice(0, 500),
    lease_expires_at: null,
    heartbeat_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('shop_id', shopId)
    .eq('channel', 'sms')
    .eq('operation_key', operationKey)
    .eq('status', 'sending')
}

async function saveSmsRecords(
  input: DurableSmsInput,
  operationKey: string,
  providerMessageId: string,
) {
  let messageRecordSaved = false
  const existingMessage = await input.db.from('messages')
    .select('id')
    .eq('shop_id', input.shopId)
    .eq('telnyx_message_id', providerMessageId)
    .limit(1)
    .maybeSingle()

  if (!existingMessage.error && existingMessage.data?.id) {
    messageRecordSaved = true
  } else if (!existingMessage.error) {
    const { error } = await input.db.from('messages').insert({
      shop_id: input.shopId,
      direction: 'outbound',
      channel: 'sms',
      from_address: input.settings.telnyx_phone_number || '',
      to_address: input.to,
      body: input.text,
      status: 'sent',
      customer_id: input.customerId || null,
      job_id: input.jobId || null,
      document_id: input.documentId || null,
      telnyx_message_id: providerMessageId,
      ai_handled: false,
      read: true,
    })
    messageRecordSaved = !error
  }

  const audit = await writeAuditLog({
    shopId: input.shopId,
    userId: input.userId,
    action: 'sms.send',
    targetType: 'message',
    targetId: providerMessageId,
    permission: 'external',
    approved: true,
    idempotencyKey: operationKey,
    metadata: { to: input.to, customerId: input.customerId || null, length: input.text.length },
  })

  return {
    messageRecordSaved,
    audit,
  }
}

/**
 * Claim, send, finalize, message-log, and audit an SMS as one durable
 * workflow. A provider timeout becomes `unknown`, so callers never retry a
 * send that may already have been accepted.
 */
export async function sendDurableSms(input: DurableSmsInput): Promise<DurableSmsResult> {
  const formatted = formatPhone(input.to)
  const fromNumber = input.settings.telnyx_phone_number || ''
  const suppliedKey = getIdempotencyKey(input.request, [])
  const payloadHash = createHash('sha256').update(JSON.stringify({
    channel: 'sms',
    to: formatted,
    from: fromNumber,
    customerId: input.customerId || null,
    jobId: input.jobId || null,
    documentId: input.documentId || null,
    body: input.text,
  })).digest('hex')
  const operationKey = suppliedKey
    ? `sms:${createHash('sha256').update(suppliedKey).digest('hex')}`
    : `sms:${randomUUID()}`

  const { data: claimed, error: claimError } = await input.db.rpc('claim_sms_send_operation', {
    p_shop_id: input.shopId,
    p_channel: 'sms',
    p_operation_key: operationKey,
    p_payload_hash: payloadHash,
    p_to_number: formatted,
    p_customer_id: input.customerId || null,
    p_body: input.text,
  })
  if (claimError) return failure('SMS operation could not be claimed', 503)

  const claim = (claimed || {}) as {
    status?: string
    operation_id?: string
    provider_message_id?: string
    last_error?: string
  }
  if (claim.status === 'sent') {
    if (!claim.provider_message_id) return failure('The SMS was marked sent without a provider message id; reconcile before retrying', 502, true)
    const repaired = await saveSmsRecords(input, operationKey, claim.provider_message_id)
    return {
      ok: true,
      messageId: claim.provider_message_id,
      idempotent: true,
      messageRecordSaved: repaired.messageRecordSaved,
      ...(repaired.audit.ok && repaired.audit.pending ? { auditPending: true } : {}),
      ...(!repaired.audit.ok ? { auditError: repaired.audit.error } : {}),
    }
  }
  if (claim.status === 'in_progress') return failure('This SMS operation is already in progress', 409)
  if (claim.status === 'unknown') return failure('This SMS provider result is uncertain; reconcile it before retrying', 409)
  if (claim.status === 'failed') return failure('This SMS operation has exhausted its retries', 409)

  let providerAccepted = false
  try {
    const result = await sendSMS(formatted, input.text, fromNumber, {
      apiKey: input.settings.telnyx_api_key || '',
      messagingProfileId: input.settings.telnyx_messaging_profile_id || '',
      idempotencyKey: operationKey,
    }) as Record<string, unknown>
    providerAccepted = true
    const providerMessageId = typeof result?.id === 'string' ? result.id : null
    if (!providerMessageId) {
      await markUnknown(input.db, input.shopId, operationKey, 'SMS provider accepted a response without a message id')
      return failure('SMS provider did not return a message id; do not retry automatically', 502, true)
    }

    const { data: savedOperation, error: operationUpdateError } = await input.db
      .from('message_send_operations')
      .update({
        status: 'sent',
        provider_message_id: providerMessageId,
        last_error: null,
        lease_expires_at: null,
        heartbeat_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('shop_id', input.shopId)
      .eq('channel', 'sms')
      .eq('operation_key', operationKey)
      .eq('status', 'sending')
      .select('id')
      .maybeSingle()
    if (operationUpdateError || !savedOperation) {
      await markUnknown(input.db, input.shopId, operationKey, 'Provider accepted the SMS, but the final operation state could not be saved')
      return failure('SMS was accepted by the provider, but its final state could not be saved; do not retry automatically', 502, true)
    }

    const completed = await saveSmsRecords({ ...input, to: formatted }, operationKey, providerMessageId)

    return {
      ok: true,
      messageId: providerMessageId,
      idempotent: false,
      messageRecordSaved: completed.messageRecordSaved,
      ...(completed.audit.ok && completed.audit.pending ? { auditPending: true } : {}),
      ...(!completed.audit.ok ? { auditError: completed.audit.error } : {}),
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SMS provider result is uncertain'
    await markUnknown(input.db, input.shopId, operationKey, message)
    return failure(
      providerAccepted
        ? 'SMS was accepted by the provider, but its final state is uncertain; do not retry automatically'
        : message,
      502,
      true,
    )
  }
}
