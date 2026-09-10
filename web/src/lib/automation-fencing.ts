import { getServiceClient } from '@/lib/supabase'

export type AutomationInvocationCheck =
  | { ok: true; runId?: string; fencingToken?: number }
  | { ok: false; status: number; error: string }

/**
 * Validate the identity forwarded by the system-automation coordinator.
 * Ordinary authenticated/manual calls remain supported when no automation
 * identity is present; an incomplete or stale forwarded identity fails closed.
 */
export async function validateAutomationInvocation(
  request: Request,
  body: Record<string, unknown> | null | undefined,
  shopId: string,
  expectedAutomationIds?: readonly string[],
): Promise<AutomationInvocationCheck> {
  const runId = request.headers.get('x-automation-run-id')?.trim()
    || (typeof body?.automationRunId === 'string' ? body.automationRunId.trim() : '')
  const rawToken = request.headers.get('x-automation-fencing-token')?.trim()
    || (body?.automationFencingToken === undefined ? '' : String(body.automationFencingToken).trim())
  if (!runId && !rawToken) return { ok: true }
  if (!runId || !rawToken) return { ok: false, status: 400, error: 'Automation run identity is incomplete' }

  const fencingToken = Number(rawToken)
  if (!Number.isSafeInteger(fencingToken) || fencingToken < 0) {
    return { ok: false, status: 400, error: 'Automation fencing token is invalid' }
  }

  const db = getServiceClient()
  const { data, error } = await db.from('automation_runs')
    .select('id,automation_id,fencing_token,status,lease_expires_at')
    .eq('id', runId)
    .eq('shop_id', shopId)
    .eq('fencing_token', fencingToken)
    .eq('status', 'running')
    .maybeSingle()
  if (error) return { ok: false, status: 503, error: 'Automation run identity could not be verified' }
  if (!data || !data.lease_expires_at || new Date(data.lease_expires_at).getTime() <= Date.now()) {
    return { ok: false, status: 409, error: 'Automation run lease is stale or no longer active' }
  }
  if (expectedAutomationIds?.length && !expectedAutomationIds.includes(String(data.automation_id))) {
    return { ok: false, status: 409, error: 'Automation run does not match this worker' }
  }
  return { ok: true, runId, fencingToken }
}

/** Re-read the lease immediately before a child performs an external or data write. */
export async function revalidateAutomationInvocation(
  request: Request,
  body: Record<string, unknown> | null | undefined,
  shopId: string,
  expectedAutomationIds?: readonly string[],
): Promise<AutomationInvocationCheck> {
  return validateAutomationInvocation(request, body, shopId, expectedAutomationIds)
}
