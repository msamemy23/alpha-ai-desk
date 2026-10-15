import { cleanDecisions, findings, normalizeSections } from '@/lib/dvi'
import type { Counts, Decisions, DviSection } from '@/lib/dvi'

/** One whole inspection, as it is edited. */
export interface DviRow {
  id: string
  job_id: string | null
  customer_id: string | null
  customer_name: string
  vehicle: string
  tech: string
  sections: DviSection[]
  tech_notes: string
  sent_to_customer: boolean
  sent_at: string | null
  customer_approved: boolean
  customer_decisions: Decisions
  customer_decided_at: string | null
  viewed_at: string | null
  has_link: boolean
  created_at: string
  updated_at: string
}

/** One line of the list. Photos are not loaded here, so the counts come from the saved summary. */
export interface DviListRow {
  id: string
  job_id: string | null
  customer_id: string | null
  customer_name: string
  vehicle: string
  tech: string
  overall_status: string
  sent_to_customer: boolean
  sent_at: string | null
  customer_approved: boolean
  customer_decisions: Record<string, string>
  customer_decided_at: string | null
  viewed_at: string | null
  summary: Partial<Counts> | null
  /** When the shop last followed up on work the customer did not act on (migration 049). */
  followup_sent_at: string | null
  followup_count: number
  created_at: string
  updated_at: string
}

// The newer columns come from migration 036. Until it is applied the list asks for the older set.
// The follow-up columns come from migration 049 and are asked for first; the list steps down when they are missing.
export const LIST_NEW = 'id,job_id,customer_id,customer_name,vehicle,tech,overall_status,sent_to_customer,sent_at,customer_approved,customer_decisions,customer_decided_at,viewed_at,summary,created_at,updated_at'
export const LIST_FOLLOW = LIST_NEW.replace(',created_at', ',followup_sent_at,followup_count,created_at')
export const LIST_OLD = 'id,job_id,customer_name,vehicle,tech,overall_status,sent_to_customer,sent_at,customer_approved,created_at,updated_at'

const str = (v: unknown) => (typeof v === 'string' ? v : '')
const strOrNull = (v: unknown) => (typeof v === 'string' && v ? v : null)

export function listRowFrom(r: Record<string, unknown>): DviListRow {
  const dec = r.customer_decisions && typeof r.customer_decisions === 'object' && !Array.isArray(r.customer_decisions) ? (r.customer_decisions as Record<string, string>) : {}
  const sum = r.summary && typeof r.summary === 'object' && !Array.isArray(r.summary) && Object.keys(r.summary as object).length > 0 ? (r.summary as Partial<Counts>) : null
  return {
    id: String(r.id), job_id: strOrNull(r.job_id), customer_id: strOrNull(r.customer_id), customer_name: str(r.customer_name), vehicle: str(r.vehicle), tech: str(r.tech),
    overall_status: str(r.overall_status), sent_to_customer: r.sent_to_customer === true, sent_at: strOrNull(r.sent_at), customer_approved: r.customer_approved === true,
    customer_decisions: dec, customer_decided_at: strOrNull(r.customer_decided_at), viewed_at: strOrNull(r.viewed_at), summary: sum,
    followup_sent_at: strOrNull(r.followup_sent_at), followup_count: typeof r.followup_count === 'number' ? r.followup_count : 0,
    created_at: str(r.created_at), updated_at: str(r.updated_at),
  }
}

export function rowFrom(r: Record<string, unknown>): DviRow {
  const sections = normalizeSections(r.sections)
  const ids = findings(sections).map(f => f.id)
  return {
    id: String(r.id), job_id: strOrNull(r.job_id), customer_id: strOrNull(r.customer_id), customer_name: str(r.customer_name), vehicle: str(r.vehicle), tech: str(r.tech),
    sections, tech_notes: str(r.tech_notes), sent_to_customer: r.sent_to_customer === true, sent_at: strOrNull(r.sent_at), customer_approved: r.customer_approved === true,
    customer_decisions: cleanDecisions(r.customer_decisions, ids), customer_decided_at: strOrNull(r.customer_decided_at), viewed_at: strOrNull(r.viewed_at),
    has_link: typeof r.share_token === 'string' && r.share_token.length > 0, created_at: str(r.created_at), updated_at: str(r.updated_at),
  }
}

/** Open jobs the technician can start an inspection from. */
export interface StartJob {
  id: string; ro_number: string | null; customer_id: string | null; customer_name: string; tech: string
  vehicle_year: string; vehicle_make: string; vehicle_model: string; status: string
}
export const START_JOB_COLUMNS = 'id,ro_number,customer_id,customer_name,tech,vehicle_year,vehicle_make,vehicle_model,status'
