// How the paperwork screens talk to the server routes. Every call returns the same small shape, never throws, and
// turns a dropped connection into plain words, so a screen only has to look at `ok` and `error`.

import { supabase } from '@/lib/supabase'
import type { DocPrefs } from '@/lib/doc-prefs'
import type { CannedExtras } from '@/lib/canned-match'
import type { LinkSummary } from '@/lib/doc-history'
import type { OptionGroup } from '@/lib/doc-approval'

export interface ApiResult<T> { ok: boolean; status: number; data: T; error: string; needsUpdate: boolean }

export async function authHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  try {
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    if (token) headers.Authorization = `Bearer ${token}`
  } catch {
    // Cookie sign-in can still work; the route answers with the real error if not.
  }
  return headers
}

export const OFFLINE = 'Could not reach the server. Check your connection and try again.'

export async function api<T = Record<string, unknown>>(url: string, init: { method?: string; body?: unknown } = {}): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method: init.method || (init.body === undefined ? 'GET' : 'POST'),
      headers: await authHeaders(),
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: 'no-store',
    })
    const data = (await res.json().catch(() => ({}))) as T & { error?: string; available?: boolean }
    const needsUpdate = res.status === 503 && (data as { available?: boolean }).available === false
    return { ok: res.ok, status: res.status, data, error: res.ok ? '' : String((data as { error?: string }).error || 'That did not work. Try again.'), needsUpdate }
  } catch {
    return { ok: false, status: 0, data: {} as T, error: OFFLINE, needsUpdate: false }
  }
}

/* ───────── paperwork settings, templates, extras, links, options ───────── */

export interface Template {
  id: string; name: string; description: string | null; kind: string
  parts: Record<string, unknown>[]; labors: Record<string, unknown>[]
  shop_supplies: number | null; notes: string | null; warranty_type: string | null
  created_at?: string; updated_at?: string
}

export interface DeclinedWork {
  id: string; document_id: string | null; customer_id: string | null; customer_name: string | null; vehicle: string | null
  job: string; amount: number; lines: { description?: string; total?: number }[] | null; source: string; status: string
  declined_at: string; remind_after: string | null; note: string | null
}

export const getPrefs = () => api<{ prefs: DocPrefs; available: boolean; canEdit: boolean }>('/api/document-data/settings')
export const savePrefs = (prefs: DocPrefs) => api<{ prefs: DocPrefs }>('/api/document-data/settings', { method: 'PUT', body: { prefs } })

export const getTemplates = () => api<{ templates: Template[]; available: boolean }>('/api/document-data/templates')
export const saveTemplate = (body: { name: string; description?: string; kind: 'estimate' | 'invoice' | 'any'; parts: unknown[]; labors: unknown[]; shop_supplies?: number; notes?: string; warranty_type?: string }) =>
  api<{ template: Template }>('/api/document-data/templates', { method: 'POST', body })
export const deleteTemplate = (id: string) => api('/api/document-data/templates?id=' + encodeURIComponent(id), { method: 'DELETE' })

export const getExtras = () => api<{ extras: Record<string, CannedExtras>; available: boolean }>('/api/document-data/canned-extras')
export const saveExtras = (cannedJobId: string, extras: CannedExtras) => api<{ extras: CannedExtras }>('/api/document-data/canned-extras', { method: 'PUT', body: { cannedJobId, extras } })

export const getLinkSummaries = () => api<{ summaries: Record<string, LinkSummary>; available: boolean }>('/api/document-data/links')

export const getOptions = (documentId: string) => api<{ options: OptionGroup[]; available: boolean }>('/api/document-data/options?documentId=' + encodeURIComponent(documentId))
export const saveOptionGroup = (body: { documentId: string; id?: string; name: string; choices: unknown[] }) =>
  api<{ id: string }>('/api/document-data/options', { method: body.id ? 'PUT' : 'POST', body })
export const deleteOptionGroup = (id: string) => api('/api/document-data/options?id=' + encodeURIComponent(id), { method: 'DELETE' })

export const getDeclinedWork = (opts: { customerId?: string; all?: boolean } = {}) => {
  const q = new URLSearchParams()
  if (opts.customerId) q.set('customerId', opts.customerId)
  if (opts.all) q.set('status', 'all')
  return api<{ work: DeclinedWork[]; available: boolean }>('/api/document-data/declined-work' + (q.toString() ? `?${q}` : ''))
}
export const updateDeclinedWork = (body: { id: string; status: string; remindAfter?: string; note?: string }) => api('/api/document-data/declined-work', { method: 'PATCH', body })

/* ───────── history and actions ───────── */

export interface HistoryEventRow { id: string; kind: string; actor: string; summary: string; created_at: string; detail?: { changes?: string[] } }
export interface HistoryLinkRow {
  id: string; purpose: string; channel: string; sent_to: string | null; created_at: string; expires_at: string; revoked_at: string | null
  first_viewed_at: string | null; last_viewed_at: string | null; view_count: number | null; email_opened_at: string | null; email_open_count: number | null
  completed_at: string | null; response: string | null
}
export interface HistoryApprovalRow {
  id: string; status: string; outcome: string; signer_name: string | null; method: string | null; signer_device: string | null
  note: string | null; total_before: number | null; total_after: number | null; signed_at: string
}
export interface HistoryRevisionRow { id: string; revision_no: number; reason: string; total: number; created_at: string }
export interface HistoryData {
  events: HistoryEventRow[]
  payments: { id: string; amount: number | string; method?: string | null; note?: string | null; paid_at?: string | null; created_at?: string | null }[]
  links: HistoryLinkRow[]
  approvals: HistoryApprovalRow[]
  revisions: HistoryRevisionRow[]
  available: { events: boolean; links: boolean; approvals: boolean; revisions: boolean }
}

export const getHistory = (documentId: string) => api<HistoryData>('/api/document-history?documentId=' + encodeURIComponent(documentId))
export const getRevision = (documentId: string, revisionId: string) =>
  api<{ revision: { id: string; revision_no: number; reason: string; total: number; snapshot: Record<string, unknown>; created_at: string } }>(
    `/api/document-history?documentId=${encodeURIComponent(documentId)}&revision=${encodeURIComponent(revisionId)}`)

/** Writes a history line. Failing to write history never blocks the work itself, so callers ignore the result. */
export const logHistory = (body: { documentId: string; kind: 'edited' | 'status' | 'converted' | 'supplement' | 'options' | 'extended' | 'created' | 'note'; summary?: string; detail?: unknown; before?: unknown; from?: string; to?: string }) =>
  api<{ logged?: boolean; summary?: string }>('/api/document-history', { method: 'POST', body })

export const docAction = (documentId: string, action: 'void' | 'restore' | 'delete' | 'revoke_links' | 'extend', extra: { reason?: string; expiresDate?: string } = {}) =>
  api<{ status?: string; linksTurnedOff?: number; count?: number; expiresDate?: string }>('/api/document-actions', { method: 'POST', body: { documentId, action, ...extra } })

/* ───────── sending ───────── */

export interface SendPreview { channel: string; to: string; subject: string; text: string; html: string; blocked: string; total: number }
export const previewSend = (documentId: string, channel: 'email' | 'sms' | 'copy', contact: { email?: string; phone?: string }) =>
  api<{ preview: SendPreview }>('/api/send-document', { method: 'POST', body: { documentId, channel, preview: true, ...contact } })
export const sendNow = (documentId: string, channel: 'email' | 'sms' | 'copy', contact: { email?: string; phone?: string }) =>
  api<{ link: string; linkKind: string; status: string; sentAt: string; expiresAt: string }>('/api/send-document', { method: 'POST', body: { documentId, channel, ...contact } })

/** What the saved signature record says: who, when, how, and whether the stored record still matches its seal. */
export interface SignatureInfo {
  source?: 'record' | 'legacy'
  signature_data?: string | null; signer_name?: string | null; signed_at?: string | null
  method?: string | null; outcome?: string | null; device?: string | null; ip?: string | null; note?: string | null; record_id?: string | null
  verified?: { ok: boolean; reason: string } | null
  total_before?: number | null; total_after?: number | null
  all?: { id: string; outcome: string; signer_name: string; method: string; signed_at: string; total_before: number; total_after: number; status: string; verified: { ok: boolean; reason: string } }[]
}
export const getSignature = (documentId: string) => api<SignatureInfo>('/api/signature?documentId=' + encodeURIComponent(documentId))
